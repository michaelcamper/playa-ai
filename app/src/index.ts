import "./env";

import { hingeSwitch$ } from "./io/hinge";
import { welcomeAndRoute } from "./workflow/flow";

hingeSwitch$().subscribe((active) => {
  if (!active) return;
  welcomeAndRoute();
});
