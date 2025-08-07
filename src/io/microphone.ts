import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import {
  debounceTime,
  filter,
  map,
  merge,
  Observable,
  Subject,
  Subscriber,
  switchMap,
  take,
  takeUntil,
  timer,
} from "rxjs";
import VAD from "webrtcvad";

export interface MicrophoneConfig {
  // maximum time to wait for the first speech activity
  maxInitialSilenceMs: number;
  // silence duration after speech to consider utterance complete
  maxTrailingSilenceMs: number;
}

const DEFAULT_CONFIG: MicrophoneConfig = {
  maxInitialSilenceMs: 2000,
  maxTrailingSilenceMs: 800,
};

/**
 * Streams raw PCM audio from ALSA (`arecord`) as an RxJS Observable of Buffers.
 * All audio is forwarded to subscribers for maximum ASR quality. In parallel,
 * audio is framed and fed to WebRTC VAD to detect end-of-speech (EOS).
 *
 * The stream automatically completes when either:
 * - No speech is detected within `maxInitialSilenceMs` (initial silence)
 * - After first speech, `maxTrailingSilenceMs` of silence is observed (trailing silence)
 */
export class MicrophoneObservable extends Observable<Buffer> {
  private arecordProcess: ChildProcessWithoutNullStreams;
  static readonly SAMPLE_RATE = 16_000;
  static readonly ALSA_DEVICE = "plughw:2,0";
  private readonly vad = new VAD(MicrophoneObservable.SAMPLE_RATE, 3);

  private audioBuffer: Buffer = Buffer.alloc(0);
  private config: MicrophoneConfig;
  private isCompleted = false;
  private framesSubject = new Subject<Buffer>();

  /**
   * Build an Observable that emits once on either initial-silence timeout or
   * trailing-silence after the first detected speech frame.
   */
  private buildEndObservable() {
    const frames$ = this.framesSubject.asObservable();
    const speech$ = frames$.pipe(
      map((frame) => this.vad.process(frame)),
      filter(Boolean),
    );

    const firstSpeech$ = speech$.pipe(take(1));
    const endOnInitialSilence$ = timer(this.config.maxInitialSilenceMs).pipe(
      takeUntil(firstSpeech$),
      take(1),
    );
    const endOnTrailingSilence$ = firstSpeech$.pipe(
      switchMap(() =>
        speech$.pipe(debounceTime(this.config.maxTrailingSilenceMs), take(1)),
      ),
    );
    return merge(endOnInitialSilence$, endOnTrailingSilence$).pipe(take(1));
  }

  /**
   * Slice arbitrary-length PCM chunks into fixed 20ms frames and emit them via callback.
   * Any remainder smaller than a full frame is retained in an internal buffer.
   */
  private emitVadFrames(chunk: Buffer, onFrame: (frame: Buffer) => void): void {
    const VAD_FRAME_BYTES = 640; // 20ms at 16kHz, 16-bit mono
    this.audioBuffer = Buffer.concat([this.audioBuffer, chunk]);
    while (this.audioBuffer.length >= VAD_FRAME_BYTES) {
      onFrame(this.audioBuffer.subarray(0, VAD_FRAME_BYTES));
      this.audioBuffer = this.audioBuffer.subarray(VAD_FRAME_BYTES);
    }
  }

  /**
   * Idempotent termination: stop capture, remove listeners, and complete the subscriber.
   */
  private endCapture(subscriber: Subscriber<Buffer>): void {
    if (this.isCompleted) return;
    this.isCompleted = true;
    try {
      this.arecordProcess.kill();
    } catch (_) {
      // ignore
    }
    this.arecordProcess.removeAllListeners();
    subscriber.complete();
  }

  // /**
  //  * Forward raw audio to subscribers and feed framed audio into the VAD pipeline.
  //  */
  // private onAudioData(subscriber: Subscriber<Buffer>, chunk: Buffer): void {

  // }

  /**
   * Attach process lifecycle handlers so any termination of `arecord` triggers cleanup.
   */
  private attachProcessLifecycle(subscriber: Subscriber<Buffer>): void {
    this.arecordProcess.stdout.once("end", () => this.endCapture(subscriber));
    this.arecordProcess.once("exit", () => this.endCapture(subscriber));
    this.arecordProcess.once("error", () => this.endCapture(subscriber));
  }

  /**
   * Spawn `arecord` configured for 16kHz, 16-bit mono PCM on the hardcoded ALSA device.
   */
  private startArecordProcess(): ChildProcessWithoutNullStreams {
    return spawn("arecord", [
      "-D",
      MicrophoneObservable.ALSA_DEVICE,
      "-q",
      "-t",
      "raw",
      "-c",
      "1",
      "-f",
      "S16_LE",
      "-r",
      MicrophoneObservable.SAMPLE_RATE.toString(),
    ]);
  }

  /**
   * Create a microphone stream. You may override silence thresholds via `options`.
   */
  constructor(options?: Partial<MicrophoneConfig>) {
    super((subscriber) => {
      const end$ = this.buildEndObservable();
      const endSub = end$.subscribe(() => this.endCapture(subscriber));

      this.arecordProcess.stdout.on("data", (chunk: Buffer) => {
        if (!this.isCompleted) subscriber.next(chunk);
        this.emitVadFrames(chunk, (frame) => this.framesSubject.next(frame));
      });
      this.attachProcessLifecycle(subscriber);

      return () => {
        endSub.unsubscribe();
        this.framesSubject.complete();
        this.endCapture(subscriber);
      };
    });

    this.config = { ...DEFAULT_CONFIG, ...options };

    this.arecordProcess = this.startArecordProcess();
  }
}
