import { speak } from "./speak";

export async function talk(
  text: string,
  options?: { retries?: number },
): Promise<void> {
  const retries = options?.retries ?? 1;
  let attempt = 0;
  // Simple retry in case TTS channel is warming up
  while (true) {
    try {
      await speak(text);
      return;
    } catch (err) {
      attempt += 1;
      if (attempt > retries) {
        // Fallback to console if TTS unavailable
        // Keep this visible for debugging in Step 1
        // eslint-disable-next-line no-console
        console.warn("[TTS unavailable]", (err as Error)?.message ?? err);
        // eslint-disable-next-line no-console
        console.log("SAY:", text);
        return;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  }
}
