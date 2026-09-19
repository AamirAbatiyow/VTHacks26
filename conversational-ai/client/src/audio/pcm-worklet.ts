/**
 * AudioWorklet processor: resamples input to 16 kHz mono PCM16 and posts
 * ~20 ms frames to the main thread.
 *
 * Loaded as a Blob URL from recorder.ts (no separate static file needed).
 */
export const PCM_WORKLET_NAME = "pcm-capture-processor";

export const PCM_WORKLET_SOURCE = `
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetRate = (options.processorOptions && options.processorOptions.targetSampleRate) || 16000;
    this.frameSamples = Math.round(this.targetRate * 0.02); // 20 ms
    this._buf = [];
    this._ratio = sampleRate / this.targetRate;
    this._srcPos = 0;
    this._srcBuf = [];
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const ch0 = input[0];
    // Mix to mono if multiple channels
    let mono = ch0;
    if (input.length > 1 && input[1]) {
      mono = new Float32Array(ch0.length);
      for (let i = 0; i < ch0.length; i++) {
        let sum = ch0[i];
        for (let c = 1; c < input.length; c++) sum += input[c][i] || 0;
        mono[i] = sum / input.length;
      }
    }

    for (let i = 0; i < mono.length; i++) this._srcBuf.push(mono[i]);

    // Linear resample from source rate → 16 kHz
    while (this._srcPos + this._ratio < this._srcBuf.length) {
      const i0 = Math.floor(this._srcPos);
      const frac = this._srcPos - i0;
      const s0 = this._srcBuf[i0] || 0;
      const s1 = this._srcBuf[i0 + 1] || s0;
      const sample = s0 + (s1 - s0) * frac;
      const clamped = Math.max(-1, Math.min(1, sample));
      const int16 = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      this._buf.push(int16);
      this._srcPos += this._ratio;

      if (this._buf.length >= this.frameSamples) {
        const frame = new Int16Array(this.frameSamples);
        for (let j = 0; j < this.frameSamples; j++) frame[j] = this._buf[j];
        this._buf = this._buf.slice(this.frameSamples);
        this.port.postMessage(frame.buffer, [frame.buffer]);
      }
    }

    // Drop consumed source samples
    const drop = Math.floor(this._srcPos);
    if (drop > 0) {
      this._srcBuf = this._srcBuf.slice(drop);
      this._srcPos -= drop;
    }

    return true;
  }
}

registerProcessor('${PCM_WORKLET_NAME}', PcmCaptureProcessor);
`;
