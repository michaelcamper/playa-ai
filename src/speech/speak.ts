import { spawn } from "node:child_process";
import * as grpc from "@grpc/grpc-js";

import type { SynthesizeSpeechResponse } from "./proto/riva_tts";
import { activity } from "../utils/activity";
import { AudioEncoding } from "./proto/riva_audio";
import {
  RivaSpeechSynthesisClient,
  SynthesizeSpeechRequest,
} from "./proto/riva_tts";

const tts = new RivaSpeechSynthesisClient(
  "localhost:50051",
  grpc.credentials.createInsecure(),
);

export function speak(text: string): Promise<void> {
  const req: SynthesizeSpeechRequest = {
    text,
    languageCode: "en-US",
    encoding: AudioEncoding.LINEAR_PCM,
    sampleRateHz: 44_100,
    voiceName: "", // use default
  };

  return new Promise((resolve, reject) => {
    activity("speak", "start", { text });
    // FIXME first chunk is not played
    const aplay = spawn("aplay", [
      "--device=plughw:2,0",
      "--format=S16_LE",
      "--channels=1",
      `--rate=${req.sampleRateHz}`,
      "--file-type=raw",
    ]);

    aplay.stdin.on("error", (err) => {
      reject(new Error(`aplay stdin error: ${err.message}`));
    });

    aplay.on("error", (err) => {
      reject(new Error(`aplay failed to start: ${err.message}`));
    });

    aplay.on("close", (code) => {
      if (code === 0) {
        resolve();
        activity("speak", "done");
      } else {
        reject(new Error(`aplay exited with code ${code}`));
      }
    });

    const ttsStream = tts.synthesizeOnline(req);

    ttsStream.on("data", ({ audio }: SynthesizeSpeechResponse) => {
      const ok = aplay.stdin.write(audio);
      if (!ok) {
        ttsStream.pause();
        aplay.stdin.once("drain", () => ttsStream.resume());
      }
    });

    ttsStream.on("end", () => {
      aplay.stdin.end();
    });

    ttsStream.on("error", (err) => {
      aplay.stdin.end();
      reject(err);
    });
  });
}
