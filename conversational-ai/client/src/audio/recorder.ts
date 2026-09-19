import { AUDIO_SAMPLE_RATE_IN } from "@shared/events";
import { PCM_WORKLET_NAME, PCM_WORKLET_SOURCE } from "./pcm-worklet";

export type MicConsumer = (pcm16: ArrayBuffer) => void;

/**
 * Modular microphone capture with fan-out subscribe().
 * Later: Speech Analysis Service attaches as a second consumer.
 */
export class MicrophoneStream {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private consumers = new Set<MicConsumer>();
  private running = false;

  subscribe(consumer: MicConsumer): () => void {
    this.consumers.add(consumer);
    return () => this.consumers.delete(consumer);
  }

  get isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    if (this.running) return;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
    } catch (err) {
      const e = err as DOMException;
      if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
        throw new Error(
          "Microphone permission denied. Allow mic access and try again.",
        );
      }
      throw new Error(`Microphone error: ${e.message || String(err)}`);
    }

    this.audioContext = new AudioContext({
      // Browser may ignore this; worklet resamples anyway.
      sampleRate: AUDIO_SAMPLE_RATE_IN,
    });

    const blob = new Blob([PCM_WORKLET_SOURCE], {
      type: "application/javascript",
    });
    const url = URL.createObjectURL(blob);
    try {
      await this.audioContext.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }

    this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
    this.workletNode = new AudioWorkletNode(
      this.audioContext,
      PCM_WORKLET_NAME,
      {
        processorOptions: { targetSampleRate: AUDIO_SAMPLE_RATE_IN },
      },
    );

    this.workletNode.port.onmessage = (ev: MessageEvent<ArrayBuffer>) => {
      for (const c of this.consumers) {
        try {
          c(ev.data);
        } catch {
          /* ignore consumer errors */
        }
      }
    };

    // Keep the graph alive without feeding speakers (avoid echo loop).
    const mute = this.audioContext.createGain();
    mute.gain.value = 0;
    this.sourceNode.connect(this.workletNode);
    this.workletNode.connect(mute);
    mute.connect(this.audioContext.destination);

    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }

    this.running = true;
  }

  /** Expose MediaStreamTrack for optional client-side VAD energy metering. */
  getMediaStream(): MediaStream | null {
    return this.stream;
  }

  stop(): void {
    this.running = false;
    try {
      this.workletNode?.port.close();
      this.workletNode?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      this.sourceNode?.disconnect();
    } catch {
      /* ignore */
    }
    this.workletNode = null;
    this.sourceNode = null;

    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;

    void this.audioContext?.close();
    this.audioContext = null;
    this.consumers.clear();
  }
}
