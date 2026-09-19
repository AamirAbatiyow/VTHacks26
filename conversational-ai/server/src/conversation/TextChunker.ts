/**
 * Accumulates streamed LLM text and flushes chunks suitable for TTS.
 * Balances low latency with enough context for natural prosody.
 */
export class TextChunker {
  private buffer = "";
  private readonly minSize: number;
  private readonly maxSize: number;
  private readonly onChunk: (chunk: string) => void;

  constructor(
    onChunk: (chunk: string) => void,
    opts?: { minSize?: number; maxSize?: number },
  ) {
    this.onChunk = onChunk;
    this.minSize = opts?.minSize ?? 24;
    this.maxSize = opts?.maxSize ?? 120;
  }

  push(text: string): void {
    if (!text) return;
    this.buffer += text;
    this.flushReady(false);
  }

  /** Force-flush remaining buffer (end of generation). */
  flush(): void {
    this.flushReady(true);
  }

  reset(): void {
    this.buffer = "";
  }

  private flushReady(force: boolean): void {
    while (true) {
      const idx = this.findFlushIndex(force);
      if (idx < 0) break;
      const chunk = this.buffer.slice(0, idx).trimStart();
      this.buffer = this.buffer.slice(idx);
      if (chunk.length > 0) {
        this.onChunk(chunk.endsWith(" ") ? chunk : `${chunk} `);
      }
    }

    if (force && this.buffer.trim().length > 0) {
      const chunk = this.buffer.trim();
      this.buffer = "";
      this.onChunk(chunk.endsWith(" ") ? chunk : `${chunk} `);
    }
  }

  private findFlushIndex(force: boolean): number {
    const buf = this.buffer;

    for (let i = 0; i < buf.length; i++) {
      const ch = buf[i]!;
      if (ch === "." || ch === "!" || ch === "?") {
        const next = buf[i + 1];
        if (next === undefined || /\s|"|'|”|’/.test(next)) {
          const end = i + 1;
          let j = end;
          while (j < buf.length && /\s/.test(buf[j]!)) j++;
          if (force || end >= this.minSize || j >= this.minSize) {
            return j > end ? j : end;
          }
        }
      }
    }

    if (buf.length >= this.minSize) {
      const clauseMatch = /[,;:]\s+/.exec(buf);
      if (clauseMatch && clauseMatch.index !== undefined) {
        const end = clauseMatch.index + clauseMatch[0].length;
        if (end >= this.minSize) return end;
      }
    }

    if (buf.length >= this.maxSize) {
      const slice = buf.slice(0, this.maxSize);
      const lastSpace = slice.lastIndexOf(" ");
      if (lastSpace >= this.minSize) return lastSpace + 1;
      return this.maxSize;
    }

    return -1;
  }
}
