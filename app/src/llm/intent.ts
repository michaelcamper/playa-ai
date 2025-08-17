import type { Runnable } from "@langchain/core/runnables";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

import { activity } from "../utils/activity";

const intentEnum = z.enum([
  "playa_guide",
  "story_teller",
  "story_collector",
  "unclear_intent",
]);

type IntentLabel = z.infer<typeof intentEnum>;

/**
 * Classify the user's utterance into one of the supported intents.
 * Uses the configured LLM in `buildChatModel`.
 */
export async function classifyIntent(utterance: string): Promise<IntentLabel> {
  activity("intent", "classify", { utterance });
  const model = new ChatOpenAI({
    model: process.env.LLAMA_MODEL,
    temperature: 0,
    configuration: {
      baseURL: `http://${process.env.LLAMA_HOST}:${process.env.LLAMA_PORT}/v1`,
      apiKey: "sk-no-key",
    },
  });

  const result = await model.invoke(
    [
      [
        "system",
        [
          "You are an intent classifier for a Burning Man voice assistant.",
          "Classify the user's input into exactly one of these labels:",
          "- playa_guide: user asks a question seeking guidance or information.",
          "- story_teller: user wants to hear a past story.",
          "- story_collector: user wants to tell/record their own story.",
          "- unclear_intent: can't determine.",
          "Only return the intent, no other text.",
        ].join(" \n"),
      ],
      ["user", ["Utterance:", "" + utterance].join(" \n")],
    ],
    {
      response_format: { type: "json_object" },
    },
  );

  const parsed = intentEnum.safeParse(result.content);
  if (parsed.success) {
    return parsed.data;
  }

  for (const intent of intentEnum.options) {
    if (String(result.content).includes(intent)) {
      return intent;
    }
  }

  return "unclear_intent";
}
