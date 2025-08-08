export type ActivityMeta = unknown;

export function activity(event: string, meta?: ActivityMeta): void {
  const [, time] = new Date().toISOString().split("T");
  if (typeof meta !== "undefined") {
    // eslint-disable-next-line no-console
    console.log(`[${time.slice(0, -1)}] ${event}`, meta);
  } else {
    // eslint-disable-next-line no-console
    console.log(`[${time.slice(0, -1)}] ${event}`);
  }
}
