import dotenv from "dotenv";

import { runMenu } from "./io/cli";
import { speak } from "./speech/speak";
import { welcomeAndRoute } from "./workflow/flow";

dotenv.config();

async function main() {
  // Start screen (simulates a physical start button). After user exits, show again.
  // No timeout here: kiosk-style idle screen.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await runMenu("Press Start to begin the Playa AI assistant:", [
      { label: "Start Assistant", action: async () => welcomeAndRoute() },
      { label: "Quit", action: async () => process.exit(0) },
    ]);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
