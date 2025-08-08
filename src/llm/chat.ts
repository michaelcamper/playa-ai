import { ChatOllama } from "@langchain/ollama";

export function buildChatModel(options?: { temperature?: number }) {
  return new ChatOllama({
    model: process.env.OLLAMA_MODEL,
    temperature: options?.temperature ?? 0.3,
  });
}
