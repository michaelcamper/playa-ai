import { env } from "../env";

const BASE_URL = `http://${env.SPEECH_HOST}:${env.SPEECH_PORT}`;

export async function open(): Promise<void> {
  const res = await fetch(`${BASE_URL}/open`, { method: "POST" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }
}

export async function close(): Promise<void> {
  const res = await fetch(`${BASE_URL}/close`, { method: "POST" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }
}

export async function speak(text: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/speak`, {
    method: "POST",
    body: text,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }
}

export async function play(path: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/play`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }
}

export async function generate(
  name: string,
  text: string,
): Promise<{ path: string }> {
  const res = await fetch(`${BASE_URL}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, text }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }

  return (await res.json()) as { path: string };
}

export async function listen(options: {
  maxInitialSilence: number;
  maxTailSilence: number;
}): Promise<string> {
  const res = await fetch(`${BASE_URL}/listen`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }
  return res.text();
}

export async function record(
  maxInitialSilence: number,
  maxTailSilence: number,
): Promise<Buffer> {
  const res = await fetch(`${BASE_URL}/record`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ maxInitialSilence, maxTailSilence }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

export const speechApi = {
  open,
  close,
  speak,
  play,
  generate,
  listen,
  record,
};

/**
 * Cleanup function to ensure all speech operations are properly terminated
 */
export async function cleanupSpeech(): Promise<void> {
  try {
    // Close the speech API to stop any ongoing operations
    await close();
  } catch (error) {
    console.error("Error cleaning up speech API:", error);
  }
}
