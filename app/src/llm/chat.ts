import { ChatOpenAI } from "@langchain/openai";

import { env } from "../env";

// Global reference to track active LLM instances
let activeLLMInstances: Set<ChatOpenAI> = new Set();

export function buildChatModel(options?: { temperature?: number }): ChatOpenAI {
  const llm = new ChatOpenAI({
    temperature: options?.temperature ?? 0.3,
    configuration: {
      baseURL: `http://${env.LLM_HOST}:${env.LLM_PORT}/v1`,
      apiKey: "sk-no-key",
    },
  });
  
  // Track the instance for cleanup
  activeLLMInstances.add(llm);
  
  return llm;
}

/**
 * Clean up all active LLM instances
 */
export async function cleanupLLMInstances(): Promise<void> {
  try {
    // Close all active LLM connections
    for (const llm of activeLLMInstances) {
      try {
        // Note: ChatOpenAI doesn't have a direct close method, but we can clean up resources
        // This is a placeholder for when more sophisticated cleanup is needed
        // For now, we just track instances for potential future cleanup
      } catch (error) {
        console.error("Error cleaning up LLM instance:", error);
      }
    }
    
    // Clear the set
    activeLLMInstances.clear();
  } catch (error) {
    console.error("Error during LLM cleanup:", error);
  }
}
