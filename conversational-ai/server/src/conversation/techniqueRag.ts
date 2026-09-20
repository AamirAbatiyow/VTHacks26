import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { logger } from "../logger.js";
import { serverRoot } from "../paths.js";
import type { GeminiClient } from "../services/gemini.js";
import {
  chunkToEmbeddingText,
  SLP_STEPHEN_CHUNKS,
  type PatternTag,
  type TechniqueChunk,
} from "./slpStephenCorpus.js";

const CACHE_PATH = path.join(serverRoot, "data", "slp-stephen-embeddings.json");
const CACHE_VERSION = 1;

interface CachedIndex {
  version: number;
  modelNote: string;
  ids: string[];
  vectors: number[][];
}

export interface RetrievedChunk {
  chunk: TechniqueChunk;
  score: number;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function ageBoost(chunk: TechniqueChunk, age?: number): number {
  if (age === undefined) return 0;
  if (age <= 6) return chunk.band === "preschool" ? 0.12 : chunk.band === "school" ? -0.04 : -0.1;
  if (age <= 12) return chunk.band === "school" ? 0.1 : chunk.band === "preschool" ? 0.02 : 0.04;
  return chunk.band === "adolescent" ? 0.1 : chunk.band === "school" ? 0.05 : -0.08;
}

function patternBoost(chunk: TechniqueChunk, patterns: PatternTag[]): number {
  if (patterns.length === 0) return 0;
  const hits = chunk.patterns.filter((tag) => patterns.includes(tag)).length;
  return hits * 0.07;
}

export class TechniqueRagIndex {
  private vectors: number[][] | null = null;
  private loading: Promise<void> | null = null;

  constructor(private readonly gemini: GeminiClient) {}

  async warmup(): Promise<void> {
    await this.ensure();
  }

  async retrieve(query: string, patterns: PatternTag[], age?: number, k = 6): Promise<RetrievedChunk[]> {
    await this.ensure();
    try {
      const [queryVector] = await this.gemini.embed([query], "RETRIEVAL_QUERY");
      if (!queryVector || !this.vectors) return this.fallbackRank(patterns, age, k);
      const scored = SLP_STEPHEN_CHUNKS.map((chunk, index) => ({
        chunk,
        score:
          cosine(queryVector, this.vectors![index] ?? []) +
          patternBoost(chunk, patterns) +
          ageBoost(chunk, age),
      }));
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, k);
    } catch (err) {
      logger.warn("RAG", "query embedding failed, using tag rank", String(err));
      return this.fallbackRank(patterns, age, k);
    }
  }

  fallbackRank(patterns: PatternTag[], age?: number, k = 6): RetrievedChunk[] {
    const scored = SLP_STEPHEN_CHUNKS.map((chunk) => ({
      chunk,
      score: 0.2 + patternBoost(chunk, patterns) + ageBoost(chunk, age),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }

  private async ensure(): Promise<void> {
    if (this.vectors) return;
    if (this.loading) return this.loading;
    this.loading = this.loadOrBuild().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  private async loadOrBuild(): Promise<void> {
    const cached = await readCache();
    const ids = SLP_STEPHEN_CHUNKS.map((chunk) => chunk.id);
    if (
      cached &&
      cached.version === CACHE_VERSION &&
      cached.ids.length === ids.length &&
      cached.ids.every((id, i) => id === ids[i]) &&
      cached.vectors.length === ids.length
    ) {
      this.vectors = cached.vectors;
      logger.info("RAG", `loaded ${this.vectors.length} technique embeddings from cache`);
      return;
    }
    logger.info("RAG", `embedding ${ids.length} SLP Stephen passages`);
    const texts = SLP_STEPHEN_CHUNKS.map(chunkToEmbeddingText);
    this.vectors = await this.gemini.embed(texts, "RETRIEVAL_DOCUMENT");
    await writeCache({ version: CACHE_VERSION, modelNote: "gemini-embedding", ids, vectors: this.vectors });
    logger.info("RAG", `cached ${this.vectors.length} technique embeddings`);
  }
}

async function readCache(): Promise<CachedIndex | null> {
  try {
    const raw = JSON.parse(await readFile(CACHE_PATH, "utf8")) as CachedIndex;
    if (!Array.isArray(raw.ids) || !Array.isArray(raw.vectors)) return null;
    return raw;
  } catch {
    return null;
  }
}

async function writeCache(cache: CachedIndex): Promise<void> {
  try {
    await mkdir(path.dirname(CACHE_PATH), { recursive: true });
    await writeFile(CACHE_PATH, JSON.stringify(cache));
  } catch (err) {
    logger.warn("RAG", "could not persist embedding cache", String(err));
  }
}

export { cosine as cosineSimilarity };
