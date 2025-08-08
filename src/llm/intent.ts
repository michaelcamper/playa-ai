import type { Runnable } from "@langchain/core/runnables";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { z } from "zod";

import { buildChatModel } from "./chat";

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

const INTENT_SCHEMA = z.object({
  intent: z.enum([
    "playa_guide",
    "story_teller",
    "story_collector",
    "unclear_intent",
  ]),
  confidence: z.number().min(0).max(1).optional(),
  reason: z.string().optional(),
});

/**
 * Classify the user's utterance into one of the supported intents.
 * Uses the configured LLM in `buildChatModel`.
 */
export async function classifyIntent(
  utterance: string,
): Promise<IntentClassification> {
  console.log("classifyIntent", utterance);
  const base = buildChatModel({ temperature: 0 });

  // Narrow to models that support structured output
  type StructuredCapable = typeof base & {
    withStructuredOutput: <T>(schema: z.ZodType<T>) => Runnable<unknown, T>;
  };
  const isStructured = (m: unknown): m is StructuredCapable =>
    typeof (m as StructuredCapable).withStructuredOutput === "function";

  if (!isStructured(base)) {
    throw new Error(
      "The configured LLM does not support structured outputs. Please use a model that supports withStructuredOutput.",
    );
  }
  const llm = base.withStructuredOutput<IntentClassification>(INTENT_SCHEMA);

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

  const chain: Runnable<unknown, IntentClassification> = prompt.pipe(llm);
  const ai = await chain.invoke({});
  const parsed = INTENT_SCHEMA.safeParse(ai);
  console.log("parsed", parsed);
  if (!parsed.success) {
    throw new Error(
      "LLM returned invalid structured output for intent classification",
    );
  }
  return parsed.data;
}
