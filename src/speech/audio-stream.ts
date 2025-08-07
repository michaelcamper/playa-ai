import { spawn } from "child_process";
import { Writable } from "stream";

// Custom audio output stream using aplay for RODE NT-USB
export class ALSAAudioStream extends Writable {
  private aplayProcess: any;
  static readonly SAMPLE_RATE = 48_000;

  constructor(audioDevice: string = "hw:2,0") {
    super();
    // Use aplay to play raw PCM audio through specified device
    // Format: 16-bit signed little endian, stereo, 48kHz
    this.aplayProcess = spawn("aplay", [
      "-D",
      audioDevice, // Audio device (default: RODE NT-USB)
      "-f",
      "S16_LE", // 16-bit signed little endian
      "-c",
      "2", // stereo (RODE NT-USB requires 2 channels)
      "-r",
      ALSAAudioStream.SAMPLE_RATE.toString(), // 48kHz sample rate
      "-t",
      "raw", // raw PCM data
    ]);

    this.aplayProcess.on("error", (err: Error) => {
      this.emit("error", err);
    });

    this.aplayProcess.on("exit", () => {
      this.emit("close");
    });
  }

  _write(
    chunk: any,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    if (this.aplayProcess && this.aplayProcess.stdin) {
      // Convert mono TTS audio to stereo by duplicating each 16-bit sample
      const monoBuffer = Buffer.from(chunk);
      const stereoBuffer = Buffer.alloc(monoBuffer.length * 2);

      for (let i = 0; i < monoBuffer.length; i += 2) {
        // Read one 16-bit sample (2 bytes)
        const sample = monoBuffer.readInt16LE(i);

        // Write the same sample to both left and right channels
        stereoBuffer.writeInt16LE(sample, i * 2); // Left channel
        stereoBuffer.writeInt16LE(sample, i * 2 + 2); // Right channel
      }

      this.aplayProcess.stdin.write(stereoBuffer, callback);
    } else {
      callback(new Error("aplay process not available"));
    }
  }

  end(): this {
    if (this.aplayProcess && this.aplayProcess.stdin) {
      this.aplayProcess.stdin.end();
    }
    return super.end();
  }
}
