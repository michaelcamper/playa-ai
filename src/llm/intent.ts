import type { Runnable } from "@langchain/core/runnables";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

import { activity } from "../utils/activity";

export type IntentLabel =
  | "playa_guide"
  | "story_teller"
  | "story_collector"
  | "unclear_intent";

export interface IntentClassification {
  intent: IntentLabel;
  confidence?: number;
  reason?: string;
}

const INTENT_SCHEMA = z
  .object({
    intent: z
      .enum([
        "playa_guide",
        "story_teller",
        "story_collector",
        "unclear_intent",
      ])
      .describe("Classification label for the user's intent"),
    confidence: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("Optional confidence score from 0 to 1"),
    reason: z
      .string()
      .optional()
      .describe("Optional brief rationale for the classification"),
  })
  .describe(
    "Intent classification result with an intent label and optional confidence/reason",
  );

/**
 * Classify the user's utterance into one of the supported intents.
 * Uses the configured LLM in `buildChatModel`.
 */
export async function classifyIntent(
  utterance: string,
): Promise<IntentClassification> {
  activity("intent", "classify", { utterance });
  const base = new ChatOpenAI({
    model: process.env.LLAMA_INTENT_MODEL || process.env.LLAMA_MODEL || "llama",
    temperature: 0,
    configuration: {
      baseURL:
        process.env.LLAMA_INTENT_BASE_URL ||
        process.env.LLAMA_BASE_URL ||
        "http://localhost:8081/v1",
      apiKey: process.env.OPENAI_API_KEY || "sk-no-key",
    },
  });

  // Prefer JSON object response to avoid OpenAI tools schema incompatibilities on llama.cpp
  const llm = base.bind({
    response_format: { type: "json_object" },
  });

  const prompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      [
        "You are an intent classifier for a Burning Man voice assistant.",
        "Classify the user's input into exactly one of these labels:",
        "- playa_guide: user asks a question seeking guidance or information.",
        "- story_teller: user wants to hear a past story.",
        "- story_collector: user wants to tell/record their own story.",
        "- unclear_intent: can't determine.",
      ].join(" \n"),
    ],
    ["user", ["Utterance:", "" + utterance].join(" \n")],
  ]);

  const chain: Runnable<unknown, unknown> = prompt.pipe(llm);
  const ai: unknown = await chain.invoke({});
  // ai may be an AIMessage with content string; attempt to parse JSON
  let obj: unknown;
  try {
    const text = typeof ai === "string" ? ai : ((ai as any)?.content ?? "");
    obj = typeof text === "string" ? JSON.parse(text) : text;
  } catch (_e) {
    obj = (ai as any)?.content ?? ai;
  }
  const parsed = INTENT_SCHEMA.safeParse(obj);
  activity("intent", "result", parsed.data);
  if (!parsed.success) {
    throw new Error(
      "LLM returned invalid structured output for intent classification",
    );
  }
  return parsed.data;
}
