import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline";

import { activity } from "../utils/activity";

export type MenuOption = {
  label: string;
  action: () => Promise<void> | void;
};

export type MenuOptions = {
  timeoutMs?: number; // if provided, will auto-cancel after timeout
};

export async function runMenu(
  title: string,
  options: MenuOption[],
  config: MenuOptions = {},
): Promise<{
  status: "executed" | "timeout" | "cancelled";
  selectedIndex?: number;
}> {
  if (options.length === 0) return { status: "cancelled" };

  const rl = readline.createInterface({ input, output });
  try {
    activity("menu:show", { title, count: options.length });
    output.write(`\n${title}\n`);
    options.forEach((opt, idx) => {
      output.write(`  [${idx + 1}] ${opt.label}\n`);
    });

    const ask = async (): Promise<number> => {
      const question = (q: string) =>
        new Promise<string>((resolve) => rl.question(q, resolve));
      const answer = await question(
        "Select option [1-" + options.length + "]: ",
      );
      const idx = Number.parseInt(answer.trim(), 10) - 1;
      if (Number.isNaN(idx) || idx < 0 || idx >= options.length) {
        output.write("Invalid selection. Please try again.\n");
        return ask();
      }
      return idx;
    };

    const selectionPromise = ask();
    const resultIdx = await (config.timeoutMs && config.timeoutMs > 0
      ? Promise.race<unknown>([
          selectionPromise,
          new Promise((resolve) =>
            setTimeout(() => resolve("__timeout__"), config.timeoutMs),
          ),
        ])
      : selectionPromise);

    if (resultIdx === "__timeout__") {
      return { status: "timeout" };
    }

    const idx = resultIdx as number;
    const chosen = options[idx];
    activity("menu:select", { index: idx, label: chosen.label });
    await Promise.resolve(chosen.action());
    return { status: "executed", selectedIndex: idx };
  } finally {
    rl.close();
  }
}
