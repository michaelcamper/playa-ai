import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import { Writable } from "stream";

// Plays 16-bit PCM audio via ALSA `aplay`. Accepts mono input and duplicates to stereo.
export class SpeakerStream extends Writable {
  private aplayProcess: ChildProcessWithoutNullStreams;
  private isClosed = false;
  static readonly SAMPLE_RATE = 48_000;
  static readonly ALSA_DEVICE = "hw:2,0";

  private startAplayProcess(): ChildProcessWithoutNullStreams {
    return spawn("aplay", [
      "-D",
      SpeakerStream.ALSA_DEVICE,
      "-f",
      "S16_LE",
      "-c",
      "2",
      "-r",
      SpeakerStream.SAMPLE_RATE.toString(),
      "-t",
      "raw",
    ]);
  }

  private attachProcessLifecycle(): void {
    this.aplayProcess.once("error", (err: Error) => this.emit("error", err));
    this.aplayProcess.once("exit", () => {
      this.isClosed = true;
      this.emit("close");
    });
  }

  private toStereo(monoBuffer: Buffer): Buffer {
    // Duplicate each 16-bit sample into left and right channels
    const stereoBuffer = Buffer.allocUnsafe(monoBuffer.length * 2);
    for (let i = 0; i < monoBuffer.length; i += 2) {
      const sample = monoBuffer.readInt16LE(i);
      const outIndex = i * 2;
      stereoBuffer.writeInt16LE(sample, outIndex);
      stereoBuffer.writeInt16LE(sample, outIndex + 2);
    }
    return stereoBuffer;
  }

  constructor() {
    super();
    this.aplayProcess = this.startAplayProcess();
    this.attachProcessLifecycle();
  }

  _write(
    chunk: any,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    if (this.isClosed || !this.aplayProcess || !this.aplayProcess.stdin) {
      callback(new Error("aplay process not available"));
      return;
    }

    const monoBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const stereoBuffer = this.toStereo(monoBuffer);
    this.aplayProcess.stdin.write(stereoBuffer, callback);
  }

  end(): this {
    if (this.aplayProcess && this.aplayProcess.stdin && !this.isClosed) {
      this.aplayProcess.stdin.end();
      this.isClosed = true;
    }
    return super.end();
  }
}
