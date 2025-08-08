import type { MicrophoneConfig } from "../io/microphone";
import { activity } from "../utils/activity";
import { listen } from "./listen";
import { speak } from "./speak";

export async function askAndListen(
  question: string,
  options?: { delayMs?: number; mic?: Partial<MicrophoneConfig> },
): Promise<string> {
  activity("ask:start", { question });
  await speak(question); // resolves when audio stream closes

  const text = await listen();
  activity("ask:result", { text });
  return (text ?? "").trim();
}
