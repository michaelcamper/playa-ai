import * as grpc from "@grpc/grpc-js";

import { ALSAAudioStream } from "./audio-stream";
import { AudioEncoding } from "./proto/riva_audio_pb";
import { RivaSpeechSynthesisClient } from "./proto/riva_tts_grpc_pb";
import { SynthesizeSpeechRequest } from "./proto/riva_tts_pb";

const tts = new RivaSpeechSynthesisClient(
  "localhost:50051",
  grpc.credentials.createInsecure(),
);

export function speak(text: string, audioDevice?: string): Promise<void> {
  const req = new SynthesizeSpeechRequest();
  req.setText(text);
  req.setLanguageCode("en-US");
  req.setEncoding(AudioEncoding.LINEAR_PCM);
  req.setSampleRateHz(ALSAAudioStream.SAMPLE_RATE);

  return new Promise((resolve, reject) => {
    const audioStream = new ALSAAudioStream(audioDevice);
    const stream = tts.synthesizeOnline(req);

    stream.on("data", (chunk) => {
      const buffer = Buffer.from(chunk.getAudio_asU8());
      if (!audioStream.write(buffer)) {
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
