import { spawn } from "child_process";
import * as readline from "readline";
import {
  debounceTime,
  distinctUntilChanged,
  filter,
  finalize,
  fromEvent,
  map,
  merge,
  Observable,
  takeUntil,
} from "rxjs";

interface Options {
  chip?: string;
  line?: number;
  debounceMs?: number;
  activeHigh?: boolean; // true => rising = pressed (headset down)
  gpiomonPath?: string;
}

/**
 * Emits `true` when handset is down (pressed), `false` when handset is up (released).
 * Handles SIGINT/SIGTERM and kills gpiomon on teardown.
 */
export function hingeSwitch$({
  chip = "gpiochip0",
  line = 105,
  debounceMs = 50,
  activeHigh = true, // keep true here, but invert mapping if needed
  gpiomonPath,
}: Options = {}): Observable<boolean> {
  const shutdown$ = merge(
    fromEvent(process, "SIGINT"),
    fromEvent(process, "SIGTERM"),
  );

  return new Observable<string>((sub) => {
    const bin = gpiomonPath ?? "gpiomon";
    const args = ["-b", "-r", "-f", "-F", "%e", chip, String(line)];

    const proc = spawn(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const rl = readline.createInterface({ input: proc.stdout });

    const onLine = (s: string) => sub.next(s.trim());
    const onErr = (d: Buffer) => sub.error(new Error(d.toString()));
    const onSpawnErr = (e: Error) => sub.error(e);
    const onClose = () => sub.complete();

    rl.on("line", onLine);
    proc.stderr.on("data", onErr);
    proc.on("error", onSpawnErr);
    proc.on("close", onClose);

    return () => {
      rl.off("line", onLine);
      rl.close();
      try {
        proc.kill("SIGINT");
      } catch {}
    };
  }).pipe(
    filter((s) => s === "0" || s === "1"),
    map((e) => {
      const rising = e === "1";
      const pressed = rising === activeHigh;
      return pressed;
    }),
    debounceTime(debounceMs),
    distinctUntilChanged(),
    takeUntil(shutdown$),
    finalize(() => console.log("hookSwitch$ stopped; gpiomon killed")),
  );
}
