import type { GreplicaConfig, EmbeddingConfig } from "../../config/greplica-config.js";

const rankingConfig = {
  semanticThreshold: 0.1,
  selectionThreshold: 0.72,
  minimumSelectedClaims: 3,
  weights: {
    semantic: 1,
    bm25: 0.075,
    exact: 0,
  },
  bm25: {
    k1: 1.5,
    b: 0.75,
  },
  claimSupport: {
    weight: 1,
    countBoost: 0.03,
  },
  directObject: {
    weight: 0.85,
  },
  graphBoost: {
    containsParentToChild: 0.85,
    containsChildToParent: 0.85,
    aboutClaimToObject: 0,
    aboutObjectToClaim: 0,
    touchesFlowToComponent: 0,
    touchesComponentToFlow: 0,
    maxSources: 3,
  },
} as const;

export interface GraphContextConfig {
  version: string;
  embedding: EmbeddingConfig;
  ranking: typeof rankingConfig;
}

export const graphContextConfig: GraphContextConfig = {
  version: "graph-context-v3-graph-boost",
  embedding: {
    provider: "local",
    model: "all-mpnet-base-v2",
    dimensions: 768,
    batchSize: 16,
  },
  ranking: rankingConfig,
};

export function graphContextConfigFromGreplicaConfig(config: GreplicaConfig): GraphContextConfig {
  return {
    ...graphContextConfig,
    version: `${graphContextConfig.version}:${config.embedding.provider}:${config.embedding.model}:${config.embedding.dimensions}`,
    embedding: { ...config.embedding },
  };
}
