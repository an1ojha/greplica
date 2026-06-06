import type { EmbeddingConfig } from "../../config/greplica-config.js";
import { LocalEmbedder } from "./local-embedder.js";
import { OpenAIEmbedder } from "./openai-embedder.js";

export interface Embedder {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

export function createEmbedder(config: EmbeddingConfig): Embedder {
  if (config.provider === "openai") return new OpenAIEmbedder(config);
  return new LocalEmbedder(config);
}
