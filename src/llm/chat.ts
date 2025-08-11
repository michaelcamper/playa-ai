import { ChatOpenAI } from "@langchain/openai";

export function buildChatModel(options?: { temperature?: number }) {
  return new ChatOpenAI({
    model: process.env.LLAMA_MODEL || process.env.OLLAMA_MODEL || "llama",
    temperature: options?.temperature ?? 0.3,
    configuration: {
      baseURL: process.env.LLAMA_BASE_URL || "http://localhost:8080/v1",
      apiKey: process.env.OPENAI_API_KEY || "sk-no-key",
    },
  });
}
