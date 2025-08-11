import type { MicrophoneConfig } from "../io/microphone";
import { listen } from "./listen";
import { speak } from "./speak";

export async function askAndListen(
  question: string,
  options?: { delayMs?: number; mic?: Partial<MicrophoneConfig> },
): Promise<string> {
  await speak(question); // resolves when audio stream closes

  const text = await listen();
  return (text ?? "").trim();
}
