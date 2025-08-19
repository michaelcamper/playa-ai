import { mkdirSync, writeFileSync } from "node:fs";
import { join as joinPath } from "node:path";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";

import type { KeeperReply } from "../llm/prompts";
import {
  close as closeSpeech,
  listen,
  play,
  record,
  speak,
} from "../api/speech";
import { buildChatModel } from "../llm/chat";
import {
  KEEPER_SYSTEM_PROMPT,
  STORY_STATUS_CLASSIFIER_PROMPT,
} from "../llm/prompts";
import { isWorkflowRunning, setWorkflowActive } from "./state";

// Configuration for conversation context and analytics
const CONVERSATION_CONFIG = {
  maxContextMessages: 10, // Number of recent messages to send to LLM
  enableDetailedLogging: true, // Enable detailed conversation logging
  logToFile: false, // Future: log to file for analytics
} as const;

export async function runMinimalFlow(): Promise<void> {
  // Track conversation and outcome for logging/finalization
  const conversationHistory: Array<HumanMessage | AIMessage> = [];
  const sessionStartTime = new Date();
  let flowStatus: "completed" | "interrupted" | "error" = "interrupted";
  let finalRecordingPath: string | null = null;
  let consecutiveSilences = 0;

  try {
    // Set workflow as active
    setWorkflowActive(true);

    if (!isWorkflowRunning()) {
      return; // Exit if workflow was stopped before we even started
    }

    await new Promise((resolve) => setTimeout(resolve, 2_000));
    // Welcome message
    await play("welcome.wav");
    conversationHistory.push(
      new SystemMessage("The user was welcomed and asked to tell a story"),
    );

    // Create models
    const llm = buildChatModel({ temperature: 0.7 });
    const classifierLlm = buildChatModel({ temperature: 0.0 });

    // Create the system message once (AI's role/instructions)
    const systemMessage = new SystemMessage(KEEPER_SYSTEM_PROMPT);

    // Initialize conversation history (already defined above)

    // Simple conversation loop
    while (isWorkflowRunning()) {
      try {
        // Check if workflow is still active before listening
        if (!isWorkflowRunning()) {
          console.log("Workflow stopped, exiting conversation loop");
          return;
        }

        // Listen for user input
        const userInput = await listen({
          maxInitialSilence: 10_000,
          maxTailSilence: 1_000,
        });

        // Check if workflow was stopped during listen operation
        if (!isWorkflowRunning()) {
          console.log(
            "Workflow stopped during listen, exiting conversation loop",
          );
          return;
        }

        if (!userInput) {
          if (!isWorkflowRunning()) {
            return; // Exit if workflow was stopped
          }
          consecutiveSilences += 1;
          conversationHistory.push(
            new SystemMessage(
              `No input detected (silence ${consecutiveSilences}/3)`,
            ),
          );
          if (consecutiveSilences >= 3) {
            conversationHistory.push(
              new SystemMessage("Ending session due to 3 consecutive silences"),
            );
            flowStatus = "interrupted";
            break; // exit main conversation loop
          }
          await play("silence.wav");
          conversationHistory.push(
            new SystemMessage("The user was told to speak"),
          );
          continue;
        }

        // Reset silence counter on valid input
        consecutiveSilences = 0;

        // Add user message to conversation history
        const userMessage = new HumanMessage(userInput);
        conversationHistory.push(userMessage);

        // Prepare messages for LLM: system message + last N conversation messages
        const recentMessages = conversationHistory.slice(
          -CONVERSATION_CONFIG.maxContextMessages,
        );
        const messages = [systemMessage, ...recentMessages];

        // Get LLM response
        const response = await llm.invoke(messages);

        const keeperResponse = handleKeeperResponse(String(response.content));

        // Add AI response to conversation history
        const aiMessage = new AIMessage(keeperResponse.message);
        conversationHistory.push(aiMessage);

        // Check if workflow is still active before speaking
        if (!isWorkflowRunning()) {
          console.log(
            "Workflow stopped before speaking response, exiting conversation loop",
          );
          return;
        }

        // If the traveler confirmed, play cue, record, and manage story confirmation loop
        if (keeperResponse.confirmed) {
          // Play story cue
          await play("story.wav");
          conversationHistory.push(
            new SystemMessage(
              "The keeper confirmed to listen to the user's story",
            ),
          );

          // Helper to build a WAV buffer from concatenated PCM
          const buildWavFromPcm = (pcm: Buffer): Buffer => {
            const sampleRate = 16000;
            const numChannels = 1;
            const bitsPerSample = 16;
            const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
            const blockAlign = numChannels * (bitsPerSample / 8);
            const dataSize = pcm.length;
            const chunkSize = 36 + dataSize;

            const header = Buffer.alloc(44);
            header.write("RIFF", 0);
            header.writeUInt32LE(chunkSize, 4);
            header.write("WAVE", 8);
            header.write("fmt ", 12);
            header.writeUInt32LE(16, 16); // Subchunk1Size (PCM)
            header.writeUInt16LE(1, 20); // AudioFormat (PCM)
            header.writeUInt16LE(numChannels, 22);
            header.writeUInt32LE(sampleRate, 24);
            header.writeUInt32LE(byteRate, 28);
            header.writeUInt16LE(blockAlign, 32);
            header.writeUInt16LE(bitsPerSample, 34);
            header.write("data", 36);
            header.writeUInt32LE(dataSize, 40);
            return Buffer.concat([header, pcm]);
          };

          // Accumulator for raw PCM (INT16LE) across segments
          const pcmSegments: Buffer[] = [];

          // Loop: record → confirm → act on status
          outerStory: while (isWorkflowRunning()) {
            // Record one segment
            const wavSegment = await record(10_000, 5_000);
            // Extract PCM from WAV (skip 44-byte header)
            const pcmSegment =
              wavSegment.length > 44
                ? wavSegment.subarray(44)
                : Buffer.alloc(0);
            if (pcmSegment.length > 0) {
              pcmSegments.push(pcmSegment);
            }

            await play("confirm-story.wav");
            conversationHistory.push(
              new SystemMessage(
                "The user was asked if their story is finished or should continue",
              ),
            );

            // Ask if the story is finished (loop on unclear)
            let noResponseAttempts = 0;
            while (isWorkflowRunning()) {
              const confirmText = await listen({
                maxInitialSilence: 5_000,
                maxTailSilence: 1000,
              });

              // Count empty response as no-response
              if (!confirmText || !String(confirmText).trim()) {
                noResponseAttempts += 1;
                if (noResponseAttempts >= 3) {
                  flowStatus = "interrupted";
                  break outerStory;
                }
                await play("story-unclear.wav");
                continue;
              }

              const statusResp = await classifierLlm.invoke([
                new SystemMessage(STORY_STATUS_CLASSIFIER_PROMPT),
                new HumanMessage(confirmText || ""),
              ]);
              const label = String(statusResp.content || "")
                .trim()
                .toLowerCase();

              if (label === "finished") {
                await play("story-complete.wav");
                conversationHistory.push(
                  new SystemMessage(
                    "The user was thanked to share their story",
                  ),
                );

                // Persist final WAV (only now)
                const storiesDir = "/home/jetson/playa-ai/output/stories";
                try {
                  mkdirSync(storiesDir, { recursive: true });
                } catch {}
                const timestamp = new Date()
                  .toISOString()
                  .replace(/[:.]/g, "-");
                const finalPcm = Buffer.concat(pcmSegments);
                const finalWav = buildWavFromPcm(finalPcm);
                const recordingPath = joinPath(storiesDir, `${timestamp}.wav`);
                writeFileSync(recordingPath, finalWav);
                finalRecordingPath = recordingPath;
                flowStatus = "completed";
                finalRecordingPath = recordingPath;
                flowStatus = "completed";

                // End the minimal flow after storing the story
                break outerStory;
              }

              if (label === "continue") {
                await play("story-continue.wav");
                conversationHistory.push(
                  new SystemMessage(
                    "The user was asked to continue telling their story",
                  ),
                );
                noResponseAttempts = 0;
                // Go record another segment
                break; // break inner confirm loop to record again
              }

              // Unclear: prompt again
              await play("story-unclear.wav");
              conversationHistory.push(
                new SystemMessage(
                  `The user's response was unclear, so the keeper asked them to clarify: ${confirmText}`,
                ),
              );
              noResponseAttempts += 1;
              if (noResponseAttempts >= 3) {
                flowStatus = "interrupted";
                break outerStory;
              }
              // continue inner loop to ask again
            }
          }

          // Exit the main conversation loop after story flow completes
          break;
        }

        // Speak the response
        await speak(keeperResponse.message);

        // Log conversation for analytics
        if (CONVERSATION_CONFIG.enableDetailedLogging) {
          const turnNumber = Math.floor(conversationHistory.length / 2);
          console.log(`\n🔄 Turn ${turnNumber}:`);
          console.log(`👤 User: ${userInput}`);
          console.log(`🤖 AI: ${keeperResponse}`);
          console.log(
            `📊 Context: ${recentMessages.length} recent messages sent to LLM`,
          );
          console.log(
            `📈 Total history: ${conversationHistory.length} messages`,
          );
          console.log(
            `⏱️  Session duration: ${Math.round((Date.now() - sessionStartTime.getTime()) / 1000)}s`,
          );
          console.log("─".repeat(50));
        }
      } catch (error) {
        // Check if this was an abort error
        if (error instanceof Error && error.message.includes("interrupted")) {
          throw error; // Re-throw interruption errors
        }

        // Handle speech service shutdown errors gracefully
        if (
          error instanceof Error &&
          error.message.includes("Speech server is shutting down")
        ) {
          console.log("Speech server shut down, exiting workflow gracefully");
          return; // Exit gracefully instead of continuing
        }

        // Handle other speech service errors
        if (error instanceof Error && error.message.includes("HTTP 503")) {
          console.log(
            "Speech service unavailable, exiting workflow gracefully",
          );
          return; // Exit gracefully instead of continuing
        }

        console.error("Error in conversation loop:", error);

        // Only try to speak error message if workflow is still running
        if (isWorkflowRunning()) {
          try {
            // TODO prebuild this
            await speak(
              "I encountered an error. Let's continue our conversation.",
            );
          } catch (speakError) {
            // If we can't speak the error message, just log it and continue
            console.error("Could not speak error message:", speakError);
          }
        }
      }
    }

    // Log final conversation summary for analytics
    const sessionDuration = Math.round(
      (Date.now() - sessionStartTime.getTime()) / 1000,
    );
    console.log(`\n🎯 === Conversation Session Complete ===`);
    console.log(
      `📊 Total conversation turns: ${conversationHistory.length / 2}`,
    );
    console.log(`💬 Total messages exchanged: ${conversationHistory.length}`);
    console.log(`⏱️  Session duration: ${sessionDuration} seconds`);
    console.log(`📅 Session ended: ${new Date().toISOString()}`);
    console.log(`=====================================\n`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("interrupted")) {
      console.log("Minimal flow was interrupted by hinge closure");
      flowStatus = "interrupted";
    } else {
      console.error("Error in minimal flow:", error);
      flowStatus = "error";
    }
  } finally {
    // Persist conversation log on any exit
    try {
      const logsDir = "/home/jetson/playa-ai/output/conversations";
      mkdirSync(logsDir, { recursive: true });
      const sessionEndTime = new Date();
      const ts = sessionEndTime.toISOString().replace(/[:.]/g, "-");
      const conversationLog = {
        sessionStart: sessionStartTime.toISOString(),
        sessionEnd: sessionEndTime.toISOString(),
        status: flowStatus,
        messages: conversationHistory.map((m) => ({
          role:
            m instanceof HumanMessage
              ? "human"
              : m instanceof AIMessage
                ? "ai"
                : "system",
          content: String(m.content ?? ""),
        })),
        recording: finalRecordingPath,
      };
      const convoPath = joinPath(logsDir, `${sessionEndTime.getTime()}.json`);
      writeFileSync(convoPath, JSON.stringify(conversationLog, null, 2), {
        encoding: "utf-8",
      });
    } catch (e) {
      console.error("Failed to write conversation log:", e);
    }

    // Close the speech server after a completed flow
    if (flowStatus === "completed") {
      try {
        await closeSpeech();
      } catch (e) {
        console.error("Error closing speech server:", e);
      }
    }

    // Ensure workflow is marked as inactive when we exit
    setWorkflowActive(false);
  }
}

function handleKeeperResponse(response: string): KeeperReply {
  try {
    const keeperResponse = JSON.parse(response) as KeeperReply;
    return keeperResponse;
  } catch (e) {
    console.error("Error parsing keeper response:", e);
    console.log(response);
    return { message: response, confirmed: false };
  }
}
