import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { envVarSource, loadRepoEnv } from "../env/load-local-env.js";
import { greplicaConfigPath, updateEmbeddingConfig, type EmbeddingProvider } from "../config/greplica-config.js";
import { graphContextConfigFromGreplicaConfig } from "../knowledge-graph/graph-context/config.js";
import { createLocalKnowledgeGraphService } from "../knowledge-graph/service.js";
import type { RepoRef } from "../knowledge-graph/service.js";
import {
  packageRoot,
  platformPaths,
  skillNames,
  type InstallEmbedding,
  type InstallPlatform,
} from "./paths.js";

export interface InstallOptions {
  platform: InstallPlatform;
  embedding: InstallEmbedding;
  repo: RepoRef;
}

export interface InstallResult {
  platform: InstallPlatform;
  skills: string[];
  embedding: InstallEmbedding;
  configFile: string;
  databasePath: string;
  notes: string[];
}

export async function installGreplica(options: InstallOptions): Promise<InstallResult> {
  const paths = platformPaths(options.platform);
  const embedding = configureEmbedding(options.embedding, options.repo);
  const service = createLocalKnowledgeGraphService(graphContextConfigFromGreplicaConfig(embedding.config));
  const init = service.initRepo(options.repo);
  const skills = installSkills(paths.skillsRoot);

  const notes: string[] = [];
  if (options.embedding === "local") {
    notes.push("Local embeddings were configured without prewarming; the first graph-context query may download the local model.");
  }
  notes.push(`Restart ${platformDisplayName(options.platform)} if the new skills do not appear immediately.`);

  return {
    platform: options.platform,
    skills,
    embedding: options.embedding,
    configFile: embedding.configPath,
    databasePath: init.database_path,
    notes,
  };
}

export function platformDisplayName(platform: InstallPlatform): string {
  if (platform === "codex") return "Codex";
  if (platform === "opencode") return "OpenCode";
  return "Claude Code";
}

function installSkills(skillsRoot: string): string[] {
  const root = packageRoot();
  const installed: string[] = [];
  mkdirSync(skillsRoot, { recursive: true });

  for (const skillName of skillNames) {
    const source = join(root, "skills", skillName);
    if (!existsSync(join(source, "SKILL.md"))) throw new Error(`Bundled skill is missing: ${source}`);

    const destination = join(skillsRoot, skillName);
    const staged = `${destination}.tmp`;
    rmSync(staged, { recursive: true, force: true });
    cpSync(source, staged, { recursive: true });
    rmSync(destination, { recursive: true, force: true });
    renameSync(staged, destination);
    installed.push(join(destination, "SKILL.md"));
  }

  return installed;
}
function configureEmbedding(provider: EmbeddingProvider, repo: RepoRef): { config: ReturnType<typeof updateEmbeddingConfig>; configPath: string } {
  const repoRoot = repo.repo_root ?? process.cwd();
  if (provider === "openai") {
    const env = loadRepoEnv(repoRoot);
    if (envVarSource("OPENAI_API_KEY", env) === undefined) {
      throw new Error("OPENAI_API_KEY is required for --embedding openai. Set it in the shell, target-root .env.local, or target-root .env.");
    }
  }

  const config = updateEmbeddingConfig({ provider });
  return {
    config,
    configPath: resolve(greplicaConfigPath()),
  };
}
