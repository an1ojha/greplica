import { createWriteStream } from "node:fs";
import { spawn } from "node:child_process";
import { collectAgentMetrics } from "./metrics.js";
import type { AgentRunInput, AgentRunResult } from "./types.js";

export async function runCodexAgent(input: AgentRunInput): Promise<AgentRunResult> {
  const startedAt = Date.now();
  const transcript = createWriteStream(input.transcriptPath, { flags: "w" });
  const result = await runCodexProcess(input, transcript);
  transcript.end();

  const elapsedMs = Date.now() - startedAt;
  const metrics = collectAgentMetrics({
    transcriptPath: input.transcriptPath,
  });

  return {
    agent: "codex",
    model: input.model,
    elapsed_ms: elapsedMs,
    transcript_path: input.transcriptPath,
    final_message_path: input.finalMessagePath,
    exit_code: result.exitCode,
    signal: result.signal,
    ...metrics,
  };
}

function runCodexProcess(
  input: AgentRunInput,
  transcript: NodeJS.WritableStream,
): Promise<{ exitCode: number | null; signal: string | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "codex",
      [
        "--ask-for-approval",
        "never",
        "exec",
        "--json",
        "--model",
        input.model,
        "--cd",
        input.cwd,
        "--sandbox",
        "danger-full-access",
        "--output-last-message",
        input.finalMessagePath,
        "-",
      ],
      {
        cwd: input.cwd,
        env: input.env,
        stdio: ["pipe", "pipe", "inherit"],
      },
    );

    child.once("error", reject);
    child.stdout.pipe(transcript);
    child.stdin.end(input.prompt);
    child.once("close", (exitCode, signal) => {
      resolve({ exitCode, signal });
    });
  });
}
