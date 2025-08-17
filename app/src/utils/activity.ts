export function activity(caller: string, event: string, meta?: unknown): void {
  const [, time] = new Date().toISOString().split("T");
  const BOLD = "\x1b[1m";
  const BLUE = "\x1b[34m";
  const RESET = "\x1b[0m";
  console.log(
    `[${time.slice(0, -1)}] ${BOLD}${BLUE}${caller}${RESET} ${event}`,
  );
  if (meta) {
    console.log(meta);
  }
}
