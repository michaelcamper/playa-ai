import { listen, speak } from "../api/speech";
import { env } from "../env";
import { runMenu } from "../io/cli";
import { classifyIntent } from "../llm/intent";
import { activity } from "../utils/activity";

// Mocked agent instruction speakers for Step 1
export async function runPlayaGuideMock(): Promise<void> {
  const text =
    "Playa Guide: Ask any question about Burning Man. I will answer briefly.";
  await speak(text);
}

export async function runStoryTellerMock(): Promise<void> {
  const text =
    "Story Teller: Tell me the kind of story you want to hear, then I will tell it.";
  await speak(text);
}

export async function runStoryCollectorMock(): Promise<void> {
  const text =
    "Story Collector: After the beep, share your story. Say 'done' when finished.";
  await speak(text);
}

export async function welcomeAndRoute(): Promise<void> {
  activity("flow", "welcome:start");
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  await speak(
    "Welcome to the Playa AI assistant. You can ask for playa guidance, hear a story, or record your own story.",
  );
  activity("flow", "welcome:done");

  // Intent selection: CLI menu (if INTENT_CLI is set) or LLM-based classification via speech
  // Loop until a definitive action (guide/teller/collector) or exit
  let lastAction: "guide" | "teller" | "collector" | null = null;
  const useCli = /^(1|true|yes)$/i.test(env.INTENT_CLI ?? "");
  activity("flow", "intent_mode", {
    mode: useCli ? "cli" : "llm",
  });
  if (useCli) {
    while (true) {
      const result = await runMenu(
        "Choose an intent:",
        [
          { label: "Playa Guide (Q&A)", action: async () => {} },
          { label: "Story Teller (hear a past story)", action: async () => {} },
          {
            label: "Story Collector (record your story)",
            action: async () => {},
          },
          {
            label: "Unclear intent (ask for clarification)",
            action: async () => {},
          },
          {
            label: "Repeat options (speak available choices)",
            action: async () => {},
          },
          { label: "Exit", action: async () => {} },
        ],
        { timeoutMs: 90_000 },
      );

      if (result.status === "timeout") {
        activity("flow", "intent:timeout");
        await speak("No response detected. I will be here when you return.");
        return;
      }

      const idx = result.selectedIndex ?? -1;
      if (idx === 3) {
        activity("flow", "intent:unclear");
        await speak("Could you clarify what you want to do today?");
        continue; // show "Choose an intent:" again
      }
      if (idx === 4) {
        activity("flow", "intent:repeat_options");
        await speak(
          "Available options are: Playa Guide, Story Teller, Story Collector, Unclear intent, Repeat options, or Exit.",
        );
        continue; // repeat menu
      }
      if (idx === 5) {
        activity("flow", "intent:exit");
        await speak("Goodbye. Stay safe on the playa!");
        return;
      }

      if (idx === 0) {
        activity("flow", "intent:guide");
        await runPlayaGuideMock();
        lastAction = "guide";
        break;
      } else if (idx === 1) {
        activity("flow", "intent:teller");
        await runStoryTellerMock();
        lastAction = "teller";
        break;
      } else if (idx === 2) {
        activity("flow", "intent:collector");
        await runStoryCollectorMock();
        lastAction = "collector";
        break;
      }
    }
  } else {
    while (true) {
      await speak("What would you like to do?");
      const utterance = await listen({
        maxInitialSilence: 5_000,
        maxTailSilence: 1_000,
      });
      // activity("flow", "intent:heard", { utterance });
      if (!utterance) {
        await speak("I didn't catch that. Please try again.");
        continue;
      }
      try {
        const intent = await classifyIntent(utterance);
        if (intent === "unclear_intent") {
          await speak("Could you clarify what you want to do today?");
          continue;
        }
        if (intent === "playa_guide") {
          activity("flow", "intent:guide");
          await runPlayaGuideMock();
          lastAction = "guide";
          break;
        }
        if (intent === "story_teller") {
          activity("flow", "intent:teller");
          await runStoryTellerMock();
          lastAction = "teller";
          break;
        }
        if (intent === "story_collector") {
          activity("flow", "intent:collector");
          await runStoryCollectorMock();
          lastAction = "collector";
          break;
        }
      } catch (err) {
        activity("flow", "intent:classify:error", {
          error: String(err),
        });
        await speak("I had trouble understanding. Let's try again.");
        continue;
      }
    }
  }

  // After finishing one action, ask the user what to do next
  while (true) {
    const again = await runMenu(
      "What would you like to do next?",
      [
        {
          label: "Repeat last action",
          action: async () => {
            activity("flow", "next:repeat", { lastAction });
            if (lastAction === "guide") await runPlayaGuideMock();
            if (lastAction === "teller") await runStoryTellerMock();
            if (lastAction === "collector") await runStoryCollectorMock();
          },
        },
        {
          label: "Choose another action",
          action: async () => {
            activity("flow", "next:another");
            await welcomeAndRoute();
          },
        },
        { label: "Exit", action: async () => speak("Goodbye. See you later!") },
      ],
      { timeoutMs: 60_000 },
    );

    if (again.status === "timeout") {
      activity("flow", "next:timeout");
      await speak("No response. Ending the session for now.");
      return;
    }
    return; // one cycle per interaction in Step 1
  }
}
