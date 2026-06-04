#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createLocalKnowledgeGraphService } from "../../libs/knowledge-graph/service.js";
import type { KnowledgeGraphService, RepoRef } from "../../libs/knowledge-graph/service.js";
import { envVarSource, loadRepoEnv, type LoadedRepoEnv } from "../../libs/env/load-local-env.js";
import { graphContextConfig } from "../../libs/knowledge-graph/graph-context/config.js";
import { OpenAIEmbedder } from "../../libs/knowledge-graph/graph-context/openai-embedder.js";
import { buildGraphFolderExport } from "../../libs/knowledge-graph/folder-export.js";
import { detectRepoContext } from "./repo-context.js";

interface CommandContext {
  repo: RepoRef;
  env: LoadedRepoEnv;
  service: KnowledgeGraphService;
}

async function main(argv: string[]): Promise<void> {
  const [area, action, ...rest] = argv;

  if (area === "init" && action === undefined) {
    const { repo, service } = createCommandContext();
    const result = service.initRepo(repo);
    console.log(result.created ? "Initialized Greplica memory." : "Greplica memory already initialized.");
    console.log(`Repo: ${repo.repo_name}`);
    console.log(`Remote: ${repo.remote_url}`);
    console.log(`Default branch: ${repo.default_branch}`);
    console.log(`Database: ${result.database_path}`);
    console.log(`Main scope: ${result.main_scope_id}`);
    console.log(`Working scope: ${result.working_scope_id}`);
    return;
  }

  if (area === "doctor") {
    await runDoctor([action, ...rest].filter((arg): arg is string => arg !== undefined));
    return;
  }

  if (area === "graph" && action === "read") {
    const { repo, service } = createCommandContext();
    const graph = service.readGraph(repo);
    console.log("Current graph view: main + working");
    printSection("Components", graph.components, (item) => `${named(item)} ${anchor(item)}`.trim());
    printSection("Flows", graph.flows, named);
    printSection("Claims", graph.claims, (item) => `${field(item, "kind")}: ${field(item, "text")}`);
    printSection("Sources", graph.sources, (item) => `${field(item, "kind")}: ${field(item, "title") || field(item, "ref")}`);
    printSection("Edges", graph.edges, (item) => `${field(item, "from_type")}:${field(item, "from_id")} -[${field(item, "kind")}]-> ${field(item, "to_type")}:${field(item, "to_id")}`);
    return;
  }

  if (area === "graph" && action === "context") {
    const query = rest.filter((arg) => arg !== "--json").join(" ").trim();
    if (query.length === 0) throw new Error(`Usage: greplica graph ${action} <query>`);
    const { repo, service } = createCommandContext();
    const result = await service.contextGraph(repo, query);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (area === "graph" && action === "export") {
    const outputDir = requireFile(rest[0], "Usage: greplica graph export <dir>");
    const { repo, service } = createCommandContext();
    const files = buildGraphFolderExport(service.readGraph(repo));
    writeGraphFolderExport(outputDir, files);
    console.log(`Exported current graph view to ${outputDir}`);
    console.log(`Files: ${files.length}`);
    return;
  }

  if (area === "proposal" && action === "validate") {
    const file = requireFile(rest[0], "Usage: greplica proposal validate <file>");
    const { repo, service } = createCommandContext();
    const proposal = readProposal(file);
    const result = service.validateProposal(repo, proposal);
    if (result.valid) {
      console.log("Proposal is valid.");
      return;
    }
    console.log("Proposal is invalid:");
    for (const error of result.errors) console.log(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  if (area === "proposal" && action === "apply") {
    const file = requireFile(rest[0], "Usage: greplica proposal apply <file>");
    const { repo, service } = createCommandContext();
    const proposal = readProposal(file);
    const result = await service.applyProposal(repo, proposal);
    console.log("Applied proposal to working memory.");
    console.log(`Memory commit: ${result.memory_commit_id}`);
    console.log(`Scope: ${result.scope_id}`);
    console.log(`Components: ${result.created.components}`);
    console.log(`Flows: ${result.created.flows}`);
    console.log(`Claims: ${result.created.claims}`);
    console.log(`Sources: ${result.created.sources}`);
    console.log(`Edges: ${result.created.edges}`);
    console.log(`Embeddings checked: ${result.embedding_status.checked_objects}`);
    console.log(`Embeddings created: ${result.embedding_status.created}`);
    console.log(`Embeddings reused: ${result.embedding_status.reused}`);
    return;
  }

  printHelp();
  process.exitCode = area === undefined ? 0 : 1;
}

function createCommandContext(): CommandContext {
  const repo = detectRepoContext();
  const env = loadRepoEnv(repo.repo_root ?? process.cwd());
  const service = createLocalKnowledgeGraphService();
  return { repo, env, service };
}

async function runDoctor(args: string[]): Promise<void> {
  let context: CommandContext;
  try {
    context = createCommandContext();
  } catch (error: unknown) {
    console.log("Repo: not detected");
    console.log(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  let ready = true;
  console.log("Greplica doctor");
  console.log(`Repo: ${context.repo.repo_name}`);
  console.log(`Repo root: ${context.repo.repo_root ?? ""}`);
  console.log(`Remote: ${context.repo.remote_url}`);
  console.log(`Default branch: ${context.repo.default_branch}`);

  try {
    const result = context.service.initRepo(context.repo);
    console.log(`Database: ${result.database_path}`);
    console.log(`Memory state: ${result.created ? "initialized" : "ready"}`);
    console.log(`Main scope: ${result.main_scope_id}`);
    console.log(`Working scope: ${result.working_scope_id}`);
  } catch (error: unknown) {
    ready = false;
    console.log("Memory state: failed");
    console.log(error instanceof Error ? error.message : String(error));
  }

  const source = envVarSource("OPENAI_API_KEY", context.env);
  if (source === undefined) {
    ready = false;
    console.log("OPENAI_API_KEY: missing");
    console.log("Set OPENAI_API_KEY in the shell, repo-root .env.local, or repo-root .env.");
  } else if (source.kind === "environment") {
    console.log("OPENAI_API_KEY: found in environment");
  } else {
    console.log(`OPENAI_API_KEY: found in ${source.path}`);
  }

  if (source !== undefined && args.includes("--check-openai")) {
    try {
      const embedder = new OpenAIEmbedder(graphContextConfig.embedding);
      await embedder.embed("greplica doctor");
      console.log("OpenAI embeddings: ok");
    } catch (error: unknown) {
      ready = false;
      console.log("OpenAI embeddings: failed");
      console.log(error instanceof Error ? error.message : String(error));
    }
  }

  process.exitCode = ready ? 0 : 1;
}

function readProposal(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}

function requireFile(file: string | undefined, usage: string): string {
  if (file === undefined || file.trim().length === 0) throw new Error(usage);
  return file;
}

function writeGraphFolderExport(outputDir: string, files: Array<{ path: string; content: string }>): void {
  mkdirSync(outputDir, { recursive: true });
  for (const file of files) {
    const outputPath = join(outputDir, file.path);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, file.content, "utf8");
  }
}

function printSection<T extends { id: string }>(title: string, items: T[], format: (item: T) => string): void {
  console.log(`${title}: ${items.length}`);
  for (const item of items) {
    console.log(`- ${field(item, "id")} ${format(item)}`.trim());
  }
}

function named(item: { id: string; name?: string }): string {
  return item.name ?? item.id;
}

function anchor(item: object): string {
  const record = item as Record<string, unknown>;
  return typeof record.code_anchor === "string" ? `(${record.code_anchor})` : "";
}

function field(item: object, key: string): string {
  const value = (item as Record<string, unknown>)[key];
  return value === undefined || value === null ? "" : String(value);
}

function printHelp(): void {
  const cli = basename(process.argv[1] ?? "greplica");
  console.log(`Usage:
  ${cli} doctor [--check-openai]
  ${cli} graph read
  ${cli} graph context <query>
  ${cli} graph export <dir>
  ${cli} proposal validate <file>
  ${cli} proposal apply <file>`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
