const BASE_URL = process.env.SPEECH_BASE_URL || "http://localhost:8009";

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
    headers: { "Content-Type": "text/plain" },
    body: text,
  });
  if (!res.ok) {
    const tx = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${tx}`);
  }
}

export async function play(name: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/play`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: name,
  });
  if (!res.ok) {
    const tx = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${tx}`);
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
    const tx = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${tx}`);
  }
  return (await res.json()) as { path: string };
}

export async function listen(
  maxInitialSilence: number,
  maxTailSilence: number,
): Promise<string> {
  const res = await fetch(`${BASE_URL}/listen`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ maxInitialSilence, maxTailSilence }),
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
