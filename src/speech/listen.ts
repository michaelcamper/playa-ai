import * as grpc from "@grpc/grpc-js";
import { catchError, EMPTY, skipUntil, tap, timer } from "rxjs";

import type { MicrophoneConfig } from "../io/microphone";
import { MicrophoneObservable } from "../io/microphone";
import { activity } from "../utils/activity";
import {
  RecognitionConfig,
  RivaSpeechRecognitionClient,
  StreamingRecognitionConfig,
  StreamingRecognizeRequest,
  StreamingRecognizeResponse,
} from "./proto/riva_asr";
import { AudioEncoding } from "./proto/riva_audio";

const asr = new RivaSpeechRecognitionClient(
  "localhost:50051",
  grpc.credentials.createInsecure(),
);

const recognitionConfig: RecognitionConfig = {
  encoding: AudioEncoding.LINEAR_PCM,
  sampleRateHertz: 16_000,
  languageCode: "en-US",
  maxAlternatives: 1,
  profanityFilter: false,
  speechContexts: [],
  audioChannelCount: 1,
  enableWordTimeOffsets: false,
  enableAutomaticPunctuation: true,
  enableSeparateRecognitionPerChannel: false,
  model: "",
  verbatimTranscripts: false,
  customConfiguration: {},
};

const streamingConfig: StreamingRecognitionConfig = {
  config: recognitionConfig,
  interimResults: true,
};

export const listen = async (options?: MicrophoneConfig): Promise<string> => {
  // Create ASR stream only when called
  return new Promise((resolve, reject) => {
    activity("listen", "start", options);
    const stream = asr.streamingRecognize();
    let isResolved = false;
    const finalSegments: string[] = [];
    const streamRecognizeRequest: StreamingRecognizeRequest = {
      streamingConfig,
    };

    stream.write(streamRecognizeRequest);

    // Start microphone capture only when called
    // Drop initial mic frames to avoid any residual TTS bleed-through from hardware buffers
    const ignoreMs = Number(process.env.LISTEN_IGNORE_MS ?? 250);
    const micStream$ = new MicrophoneObservable(options).pipe(
      skipUntil(timer(ignoreMs)),
      tap((chunk) => {
        stream.write({ audioContent: chunk });
      }),
      catchError((err) => {
        stream.destroy(err);
        return EMPTY;
      }),
    );

    const micSubscription = micStream$.subscribe({
      complete: () => {
        activity("listen", "mic_complete");
        stream.end();
      },
    });

    stream.on("data", ({ results }: StreamingRecognizeResponse) => {
      if (!results || results.length === 0) return;

      // Collect any final transcripts; do not resolve yet
      for (const r of results) {
        if (r.isFinal) {
          const text = r.alternatives?.[0]?.transcript?.trim();
          if (text && text.length > 0) {
            finalSegments.push(text);
            activity("listen", "transcript", { text });
          }
        }
      }
    });

    stream.on("error", (err) => {
      micSubscription.unsubscribe();
      if (!isResolved) {
        isResolved = true;
        activity("listen", "error", { error: String(err) });
        reject(err);
      }
    });

    stream.on("end", () => {
      micSubscription.unsubscribe();
      if (!isResolved) {
        isResolved = true;
        activity("listen", "end", {
          text: finalSegments.join(" "),
        });
        resolve(finalSegments.join(" "));
      }
    });
  });
};
