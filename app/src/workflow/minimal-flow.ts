import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";

import { listen, speak } from "../api/speech";
import { buildChatModel } from "../llm/chat";
import { isWorkflowRunning } from "./state";

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

    // Welcome message
    await speak("Hello! I'm your AI assistant. How can I help you today?");

    // Create a simple chat model
    const llm = buildChatModel({ temperature: 0.7 });

    // Create the system message once (AI's role/instructions)
    const systemMessage = new SystemMessage(
      "You are a helpful AI assistant. Keep your responses concise and friendly.",
    );

    // Initialize conversation history
    const conversationHistory: Array<HumanMessage | AIMessage> = [];
    const sessionStartTime = new Date();

    // Simple conversation loop
    while (isWorkflowRunning()) {
      try {
        // Listen for user input
        const userInput = await listen({
          maxInitialSilence: 5000,
          maxTailSilence: 1000,
        });

        if (!userInput) {
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
        const responseText = response.content as string;

        // Add AI response to conversation history
        const aiMessage = new AIMessage(responseText);
        conversationHistory.push(aiMessage);

        // Speak the response
        await speak(responseText);

        // Log conversation for analytics
        if (CONVERSATION_CONFIG.enableDetailedLogging) {
          const turnNumber = Math.floor(conversationHistory.length / 2);
          console.log(`\n🔄 Turn ${turnNumber}:`);
          console.log(`👤 User: ${userInput}`);
          console.log(`🤖 AI: ${responseText}`);
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
        if (error instanceof Error && error.message.includes("interrupted")) {
          throw error; // Re-throw interruption errors
        }

        console.error("Error in conversation loop:", error);
        await speak("I encountered an error. Let's continue our conversation.");
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
  }
}
