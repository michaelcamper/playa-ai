import { ChatOpenAI } from "@langchain/openai";

import { env } from "../env";

export function buildChatModel(options?: { temperature?: number }) {
  return new ChatOpenAI({
    temperature: options?.temperature ?? 0.3,
    configuration: {
      baseURL: `http://${env.LLM_HOST}:${env.LLM_PORT}/v1`,
      apiKey: "sk-no-key",
    },
  });
}
