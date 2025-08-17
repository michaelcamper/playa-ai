import { close, open } from "./api/speech";

import "./env";

import { hingeSwitch$ } from "./io/hinge";
import { welcomeAndRoute } from "./workflow/flow";

hingeSwitch$().subscribe((active) => {
  if (active) {
    open();
    welcomeAndRoute();
  } else {
    close();
    // TODO clean and save logs
  }
});
