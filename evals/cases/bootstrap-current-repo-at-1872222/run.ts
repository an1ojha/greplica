import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { runCodexAgent } from "../../../libs/agent-runner/codex.js";
import type { AgentRunResult } from "../../../libs/agent-runner/types.js";

const caseId = "bootstrap-current-repo-at-1872222";
const targetRepoUrl = "git@github.com:Autoloops/engineering-context.git";
const targetCommit = "1872222671c85b347950462bc65ef3da3611ed6e";

interface CommandResult {
  command: string[];
  exit_code: number | null;
  signal: string | null;
}

interface Args {
  proposal?: string;
  agent?: "codex";
  agentModel?: string;
  judge?: "openai";
  judgeModel?: string;
}

interface RunContext {
  repoRoot: string;
  runDir: string;
  targetRepoDir: string;
  ecHomeDir: string;
  proposalPath: string;
  rubricPath: string;
  ecCommand: string[];
}

interface EvalResult {
  case_id: string;
  target_repo_url: string;
  target_commit: string;
  run_dir: string;
  target_repo_dir: string;
  ec_home_dir: string;
  proposal_path: string;
  success: boolean;
  commands: CommandResult[];
  generation?: AgentRunResult;
  judge?: {
    model: string;
    judge_input_path: string;
    judge_output_path: string;
    score: ScoreResult;
  };
}

interface Rubric {
  case_id: string;
  target_repo_url: string;
  target_commit: string;
  score: {
    pass_threshold: number;
    node_coverage_points: number;
    edge_coverage_points: number;
    quality_points: number;
    quality_penalties: {
      noisy_structure_node_points: number;
      noisy_structure_node_max: number;
      bad_claim_points: number;
      bad_claim_max: number;
      bad_anchor_points: number;
      bad_anchor_max: number;
      depth_violation_points: number;
      weak_graph_linking_points: number;
    };
  };
  judge: JudgeRubric;
}

interface JudgeRubric {
  instructions: string[];
  actual_repo_facts: string[];
  expected_nodes: Array<{ id: string; kind: string; description: string }>;
  expected_edges: Array<{ id: string; description: string; from?: string; to?: string }>;
  quality_rules: Record<string, string>;
}

interface JudgeInput {
  task: string;
  rubric: JudgeRubric;
  repo_tree: string[];
  proposal: unknown;
}

interface JudgeOutput {
  nodes: Array<{
    expected_id: string;
    present: boolean;
    matched_ids: string[];
    reason: string;
  }>;
  edges: Array<{
    expected_id: string;
    present: boolean;
    matched: string[];
    reason: string;
  }>;
  quality: {
    noisy_structure_nodes: Array<{ id: string; reason: string }>;
    bad_claims: Array<{ id: string; reason: string }>;
    bad_anchors: Array<{ id: string; anchor: string; reason: string }>;
    depth_violation: { present: boolean; reason: string };
    weak_graph_linking: { present: boolean; reason: string };
  };
}

interface ScoreResult {
  node_score: number;
  edge_score: number;
  quality_score: number;
  final_score: number;
  pass_threshold: number;
  passed: boolean;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const context = prepareRun();
  prepareTargetRepo(context);
  prepareEcHome(context);
  const initCommand = runProductCommand(context, "init");
  const generation = await getProposal(context, args);
  const commands = [
    initCommand,
    ...runProductCommands(context),
  ];
  const commandsSucceeded = commands.every((command) => command.exit_code === 0);
  const judge = commandsSucceeded && args.judge === "openai" ? await runOpenAiJudge(context, args) : undefined;
  const success = commandsSucceeded && (judge === undefined || judge.score.passed);
  writeResult(context, commands, success, generation, judge);

  console.log(success ? "Eval run passed." : "Eval run failed.");
  console.log(`Run directory: ${context.runDir}`);
  if (judge) {
    console.log(`Score: ${judge.score.final_score.toFixed(2)} / 100`);
  }
  process.exitCode = success ? 0 : 1;
}

function prepareRun(): RunContext {
  const repoRoot = findRepoRoot();
  const runDir = resolve(repoRoot, "eval-runs", timestamp(), caseId);
  const targetRepoDir = resolve(runDir, "target-repo");
  const ecHomeDir = resolve(runDir, "ec-home");
  const proposalPath = resolve(runDir, "proposal.json");
  const rubricPath = resolve(repoRoot, "evals/cases/bootstrap-current-repo-at-1872222/rubric.json");
  const ecCommand = ["node", resolve(repoRoot, "dist/apps/cli/main.js")];

  mkdirSync(runDir, { recursive: true });

  return {
    repoRoot,
    runDir,
    targetRepoDir,
    ecHomeDir,
    proposalPath,
    rubricPath,
    ecCommand,
  };
}

function prepareTargetRepo(context: RunContext): void {
  runOrThrow(["git", "clone", targetRepoUrl, context.targetRepoDir], context.repoRoot);
  runOrThrow(["git", "checkout", targetCommit], context.targetRepoDir);
}

function prepareEcHome(context: RunContext): void {
  mkdirSync(context.ecHomeDir, { recursive: true });
}

async function getProposal(context: RunContext, args: Args): Promise<AgentRunResult | undefined> {
  if (args.proposal) {
    copyFileSync(resolve(args.proposal), context.proposalPath);
    return undefined;
  }

  if (args.agent === "codex") {
    const model = args.agentModel ?? "gpt-5.4-mini";
    const result = await runCodexAgent({
      cwd: context.targetRepoDir,
      env: { ...process.env, ENGINEERING_CONTEXT_HOME: context.ecHomeDir },
      model,
      prompt: codexBootstrapPrompt(context),
      transcriptPath: resolve(context.runDir, "agent-events.jsonl"),
      finalMessagePath: resolve(context.runDir, "agent-final-message.txt"),
      proposalPath: context.proposalPath,
    });
    if (result.exit_code !== 0) {
      throw new Error(`Codex agent failed with exit code ${String(result.exit_code)}.`);
    }
    if (!existsSync(context.proposalPath)) {
      throw new Error(`Codex agent did not create proposal at ${context.proposalPath}.`);
    }
    return result;
  }

  throw new Error("Expected either --proposal <path> or --agent codex.");
}

function runProductCommands(context: RunContext): CommandResult[] {
  const commands = [
    [...context.ecCommand, "proposal", "validate", context.proposalPath],
    [...context.ecCommand, "proposal", "apply", context.proposalPath],
  ];

  return commands.map((command) => runProductCommand(context, ...command.slice(context.ecCommand.length)));
}

function runProductCommand(context: RunContext, ...args: string[]): CommandResult {
  const env = { ...process.env, ENGINEERING_CONTEXT_HOME: context.ecHomeDir };
  return run([...context.ecCommand, ...args], context.targetRepoDir, env);
}

async function runOpenAiJudge(
  context: RunContext,
  args: Args,
): Promise<NonNullable<EvalResult["judge"]>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required when using --judge openai.");

  const model = args.judgeModel ?? process.env.OPENAI_MODEL;
  if (!model) throw new Error("Set OPENAI_MODEL or pass --judge-model when using --judge openai.");

  const rubric = readJson<Rubric>(context.rubricPath);
  const proposal = readJson<unknown>(context.proposalPath);
  const judgeInput: JudgeInput = {
    task: "Judge this bootstrap memory proposal for the pinned repo commit. Return JSON classification only; do not compute numeric scores.",
    rubric: rubric.judge,
    repo_tree: repoTree(context.targetRepoDir),
    proposal,
  };
  const judgeInputPath = resolve(context.runDir, "judge-input.json");
  const judgeOutputPath = resolve(context.runDir, "judge-output.json");
  writeFileSync(judgeInputPath, `${JSON.stringify(judgeInput, null, 2)}\n`);

  const judgeOutput = await requestJudge(apiKey, model, judgeInput);
  writeFileSync(judgeOutputPath, `${JSON.stringify(judgeOutput, null, 2)}\n`);

  return {
    model,
    judge_input_path: judgeInputPath,
    judge_output_path: judgeOutputPath,
    score: scoreJudgeOutput(rubric, judgeOutput),
  };
}

function writeResult(
  context: RunContext,
  commands: CommandResult[],
  success: boolean,
  generation: AgentRunResult | undefined,
  judge: EvalResult["judge"],
): void {
  const result: EvalResult = {
    case_id: caseId,
    target_repo_url: targetRepoUrl,
    target_commit: targetCommit,
    run_dir: context.runDir,
    target_repo_dir: context.targetRepoDir,
    ec_home_dir: context.ecHomeDir,
    proposal_path: context.proposalPath,
    success,
    commands,
    generation,
    judge,
  };

  writeFileSync(resolve(context.runDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
}

function parseArgs(args: string[]): Args {
  const proposal = valueAfter(args, "--proposal");
  const agent = valueAfter(args, "--agent");
  if ((proposal === undefined && agent === undefined) || (proposal !== undefined && agent !== undefined)) {
    throw new Error("Usage: npm run eval:bootstrap-current -- (--proposal /path/to/proposal.json | --agent codex) [--agent-model model] [--judge openai] [--judge-model model]");
  }
  if (agent !== undefined && agent !== "codex") throw new Error("Only --agent codex is supported.");

  const judge = valueAfter(args, "--judge");
  if (judge !== undefined && judge !== "openai") {
    throw new Error("Only --judge openai is supported.");
  }

  const agentModel = valueAfter(args, "--agent-model");
  const judgeModel = valueAfter(args, "--judge-model");

  return { proposal, agent, agentModel, judge, judgeModel };
}

function runOrThrow(command: string[], cwd: string): void {
  const result = run(command, cwd, process.env);
  if (result.exit_code !== 0) {
    throw new Error(`Command failed: ${command.join(" ")}`);
  }
}

function run(command: string[], cwd: string, env: NodeJS.ProcessEnv): CommandResult {
  const result = spawnSync(command[0] ?? "", command.slice(1), {
    cwd,
    env,
    stdio: "inherit",
  });

  return {
    command,
    exit_code: result.status,
    signal: result.signal,
  };
}

function codexBootstrapPrompt(context: RunContext): string {
  const skill = readFileSync(resolve(context.repoRoot, "skills/engineering-memory/SKILL.md"), "utf8");
  const ec = context.ecCommand.join(" ");

  return `You are running an engineering-memory bootstrap workflow for this repository.

Use this exact user-facing skill as the workflow contract:

<engineering_memory_skill>
${skill}
</engineering_memory_skill>

Runtime facts for this eval:
- Current working directory is the target repository root.
- ENGINEERING_CONTEXT_HOME is already set to an isolated eval directory.
- Use this ec command exactly: ${ec}
- Write the final proposal JSON exactly here: ${context.proposalPath}
- If this repository contains skills/engineering-memory/SKILL.md, treat that file as part of the repository being bootstrapped. Do not ignore it just because the same skill content is included above as the workflow contract.
- If this repository contains graph schema/type/model files that define components, flows, claims, edges, scopes, memberships, or commits, consider whether they are important top-level memory.

Task:
1. Run the skill workflow for bootstrap memory on this repo.
2. Inspect the repo shallowly. Prefer top-level components, flows, and durable claims.
3. Create a compact proposal JSON at ${context.proposalPath}.
4. Validate it with: ${ec} proposal validate ${context.proposalPath}
5. Fix validation errors until valid.
6. Do not apply the proposal.

The proposal should be useful to a future coding agent and should avoid deep implementation trivia.`;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function repoTree(cwd: string): string[] {
  const output = spawnSync("git", ["ls-tree", "-r", "--name-only", "HEAD"], {
    cwd,
    encoding: "utf8",
  });
  if (output.status !== 0) throw new Error("Failed to read target repo tree.");
  return output.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

async function requestJudge(apiKey: string, model: string, input: JudgeInput): Promise<JudgeOutput> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content:
            "You are an evaluator for engineering-memory bootstrap proposals. Return JSON only. Classify expected nodes, expected edges, and quality issues. Do not calculate numeric scores.",
        },
        {
          role: "user",
          content: JSON.stringify(input),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "bootstrap_eval_judge",
          strict: true,
          schema: judgeOutputSchema(),
        },
      },
    }),
  });

  const body = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`OpenAI judge request failed: ${JSON.stringify(body)}`);
  }

  const outputText = extractOutputText(body);
  return JSON.parse(outputText) as JudgeOutput;
}

function scoreJudgeOutput(rubric: Rubric, judge: JudgeOutput): ScoreResult {
  const presentNodes = new Set(judge.nodes.filter((item) => item.present).map((item) => item.expected_id));
  const presentEdges = new Set(judge.edges.filter((item) => item.present).map((item) => item.expected_id));
  const nodeScore = (presentNodes.size / rubric.judge.expected_nodes.length) * rubric.score.node_coverage_points;
  const edgeScore = (presentEdges.size / rubric.judge.expected_edges.length) * rubric.score.edge_coverage_points;
  const penalties = rubric.score.quality_penalties;
  const qualityPenalty =
    Math.min(judge.quality.noisy_structure_nodes.length * penalties.noisy_structure_node_points, penalties.noisy_structure_node_max) +
    Math.min(judge.quality.bad_claims.length * penalties.bad_claim_points, penalties.bad_claim_max) +
    Math.min(judge.quality.bad_anchors.length * penalties.bad_anchor_points, penalties.bad_anchor_max) +
    (judge.quality.depth_violation.present ? penalties.depth_violation_points : 0) +
    (judge.quality.weak_graph_linking.present ? penalties.weak_graph_linking_points : 0);
  const qualityScore = Math.max(0, rubric.score.quality_points - qualityPenalty);
  const finalScore = nodeScore + edgeScore + qualityScore;

  return {
    node_score: round(nodeScore),
    edge_score: round(edgeScore),
    quality_score: round(qualityScore),
    final_score: round(finalScore),
    pass_threshold: rubric.score.pass_threshold,
    passed: finalScore >= rubric.score.pass_threshold,
  };
}

function extractOutputText(body: Record<string, unknown>): string {
  if (typeof body.output_text === "string") return body.output_text;

  const output = body.output;
  if (!Array.isArray(output)) throw new Error("OpenAI response did not include output text.");

  const texts: string[] = [];
  for (const item of output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (isRecord(content) && typeof content.text === "string") texts.push(content.text);
    }
  }

  const text = texts.join("");
  if (text.length === 0) throw new Error("OpenAI response output text was empty.");
  return text;
}

function judgeOutputSchema(): Record<string, unknown> {
  const reasonedItem = {
    type: "object",
    additionalProperties: false,
    properties: {
      expected_id: { type: "string" },
      present: { type: "boolean" },
      matched_ids: { type: "array", items: { type: "string" } },
      reason: { type: "string" },
    },
    required: ["expected_id", "present", "matched_ids", "reason"],
  };
  const edgeItem = {
    type: "object",
    additionalProperties: false,
    properties: {
      expected_id: { type: "string" },
      present: { type: "boolean" },
      matched: { type: "array", items: { type: "string" } },
      reason: { type: "string" },
    },
    required: ["expected_id", "present", "matched", "reason"],
  };
  const issueItem = {
    type: "object",
    additionalProperties: false,
    properties: {
      id: { type: "string" },
      reason: { type: "string" },
    },
    required: ["id", "reason"],
  };

  return {
    type: "object",
    additionalProperties: false,
    properties: {
      nodes: { type: "array", items: reasonedItem },
      edges: { type: "array", items: edgeItem },
      quality: {
        type: "object",
        additionalProperties: false,
        properties: {
          noisy_structure_nodes: { type: "array", items: issueItem },
          bad_claims: { type: "array", items: issueItem },
          bad_anchors: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                id: { type: "string" },
                anchor: { type: "string" },
                reason: { type: "string" },
              },
              required: ["id", "anchor", "reason"],
            },
          },
          depth_violation: {
            type: "object",
            additionalProperties: false,
            properties: {
              present: { type: "boolean" },
              reason: { type: "string" },
            },
            required: ["present", "reason"],
          },
          weak_graph_linking: {
            type: "object",
            additionalProperties: false,
            properties: {
              present: { type: "boolean" },
              reason: { type: "string" },
            },
            required: ["present", "reason"],
          },
        },
        required: ["noisy_structure_nodes", "bad_claims", "bad_anchors", "depth_violation", "weak_graph_linking"],
      },
    },
    required: ["nodes", "edges", "quality"],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function findRepoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
