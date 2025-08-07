import * as grpc from "@grpc/grpc-js";

import { RivaSpeechRecognitionClient } from "./proto/riva_asr_grpc_pb";
import {
  RecognitionConfig,
  StreamingRecognitionConfig,
  StreamingRecognizeRequest,
} from "./proto/riva_asr_pb";
import { AudioEncoding } from "./proto/riva_audio_pb";

const asr = new RivaSpeechRecognitionClient(
  "localhost:50051",
  grpc.credentials.createInsecure(),
);

const recognitionConfig = new RecognitionConfig();
recognitionConfig.setEncoding(AudioEncoding.LINEAR_PCM);
recognitionConfig.setSampleRateHertz(16_000);
recognitionConfig.setLanguageCode("en-US");

const streamingConfig = new StreamingRecognitionConfig();
streamingConfig.setConfig(recognitionConfig);
streamingConfig.setInterimResults(true);

export const listen = async (): Promise<string> => {
  return new Promise((resolve, reject) => {
    const stream = asr.streamingRecognize();

    const streamRecognizeRequest = new StreamingRecognizeRequest();

    streamRecognizeRequest.setStreamingConfig(streamingConfig);

    stream.write(streamRecognizeRequest);

    // stream microphone bytes here
    // mic.on('data', (chunk) => stream.write({ audioContent: chunk }));

    stream.on("data", (resp) => {
      const result = resp.getResultsList()[0];
      const alt = result?.getAlternativesList()[0];
      if (alt) {
        console.log(
          `[${result.getIsFinal() ? "FINAL" : "partial"}] ${alt.getTranscript()}`,
        );
      }
    });

    stream.on("error", (err) => {
      reject(err);
    });

    stream.on("end", () => {
      resolve("");
    });
  });
};
