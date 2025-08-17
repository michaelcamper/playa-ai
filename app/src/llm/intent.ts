import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

import { env } from "../env";
import { activity } from "../utils/activity";
import { registerLangchainOperation, createAbortController, getActiveAbortController } from "../utils/cleanup";

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
  
  // Create abort controller for this operation
  const abortController = createAbortController();
  
  const model = new ChatOpenAI({
    temperature: 0,
    configuration: {
      baseURL: `http://${env.LLM_HOST}:${env.LLM_PORT}/v1`,
      apiKey: "sk-no-key",
    },
  });

  const operation = model.invoke(
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
      signal: abortController.signal,
    },
  );

  // Register the operation for cleanup tracking
  const trackedOperation = registerLangchainOperation(operation);
  
  try {
    const result = await trackedOperation;
    
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
  } catch (error) {
    // Check if operation was aborted
    if (error instanceof Error && error.name === 'AbortError') {
      activity("intent", "classify:aborted");
      throw new Error("Intent classification was interrupted");
    }
    
    activity("intent", "classify:error", { error: String(error) });
    throw error;
  }
}
