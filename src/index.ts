import { listen } from "./speech/listen";
import { speak } from "./speech/speak";

// speak(`It was Tuesday, somewhere between noon and who-the-hell-cares, when Alex found the piano.

// He'd been biking aimlessly, already sunburned and crusted in alkaline dust, when he saw it standing in the middle of the open playa. A full upright, half-buried in sand, no shade, no sign, no explanation. Just there.

// He stopped, dropped the bike, walked over, and pressed a key.`).then(() => {
//   console.log("I have spoken");
// });

listen({
  maxInitialSilenceMs: 5_000,
  maxTrailingSilenceMs: 5_000,
}).then((text) => {
  console.log(text || "no speech detected");
  process.exit(0);
});
