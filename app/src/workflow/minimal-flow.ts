import { platform } from "node:os";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";

import type { KeeperReply } from "../llm/prompts";
import { listen, play, speak } from "../api/speech";
import { buildChatModel } from "../llm/chat";
import { KEEPER_SYSTEM_PROMPT } from "../llm/prompts";
import { isWorkflowRunning, setWorkflowActive } from "./state";

// Configuration for conversation context and analytics
const CONVERSATION_CONFIG = {
  maxContextMessages: 10, // Number of recent messages to send to LLM
  enableDetailedLogging: true, // Enable detailed conversation logging
  logToFile: false, // Future: log to file for analytics
} as const;

export async function runMinimalFlow(): Promise<void> {
  try {
    // Set workflow as active
    setWorkflowActive(true);

    if (!isWorkflowRunning()) {
      return; // Exit if workflow was stopped before we even started
    }

    await new Promise((resolve) => setTimeout(resolve, 2_000));
    // Welcome message
    await play("welcome.wav");

    // Create a simple chat model
    const llm = buildChatModel({ temperature: 0.7 });

    // Create the system message once (AI's role/instructions)
    const systemMessage = new SystemMessage(KEEPER_SYSTEM_PROMPT);

    // Initialize conversation history
    const conversationHistory: Array<HumanMessage | AIMessage> = [];
    const sessionStartTime = new Date();

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
          maxTailSilence: 1000,
        });

        // Check if workflow was stopped during listen operation
        if (!isWorkflowRunning()) {
          console.log(
            "Workflow stopped during listen, exiting conversation loop",
          );
          return;
        }

        if (!userInput) {
          // TODO prebuild this
          if (!isWorkflowRunning()) {
            return; // Exit if workflow was stopped
          }
          await speak("I didn't catch that. Could you please repeat?");
          continue;
        }

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

        console.log(JSON.stringify(response, null, 2));
        const keeperResponse = JSON.parse(
          response.content as string,
        ) as KeeperReply;

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
    } else {
      console.error("Error in minimal flow:", error);
    }
  } finally {
    // Ensure workflow is marked as inactive when we exit
    setWorkflowActive(false);
  }
}
