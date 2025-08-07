import * as grpc from "@grpc/grpc-js";

import { SpeakerStream } from "../io/speaker";
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
    sampleRateHz: SpeakerStream.SAMPLE_RATE,
    voiceName: "",
  };

  return new Promise((resolve, reject) => {
    const audioStream = new SpeakerStream();
    const stream = tts.synthesizeOnline(req);

    stream.on("data", ({ audio }) => {
      const hasWritten = audioStream.write(audio);
      if (!hasWritten) {
        stream.pause();
        audioStream.once("drain", () => stream.resume());
      }
    });

    stream.on("end", () => audioStream.end());
    audioStream.on("close", () => resolve());

    stream.on("error", (err) => {
      audioStream.end();
      reject(err);
    });

    audioStream.on("error", (err) => {
      stream.destroy();
      reject(err);
    });
  });
}
