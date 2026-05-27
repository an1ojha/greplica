import { existsSync, readFileSync } from "node:fs";

export interface AgentMetricInput {
  transcriptPath: string;
}

export interface AgentMetrics {
  tool_calls: number;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
}

export function collectAgentMetrics(input: AgentMetricInput): AgentMetrics {
  const transcript = readOptional(input.transcriptPath);
  const toolCalls = countToolCalls(transcript);
  const usage = usageFromTranscript(transcript);
  const inputTokens = usage?.input_tokens ?? null;
  const outputTokens = usage?.output_tokens ?? null;

  return {
    tool_calls: toolCalls,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: inputTokens === null || outputTokens === null ? null : inputTokens + outputTokens,
  };
}

function countToolCalls(jsonl: string): number {
  if (jsonl.trim().length === 0) return 0;

  let count = 0;
  for (const line of jsonl.split("\n")) {
    const event = parseJsonLine(line);
    if (!event) continue;
    if (isRecord(event) && event.type === "item.started" && isRecord(event.item) && event.item.type === "command_execution") {
      count += 1;
      continue;
    }
    const text = JSON.stringify(event).toLowerCase();
    if (
      text.includes("exec_command") ||
      text.includes("command_begin") ||
      text.includes("command_start") ||
      text.includes("\"type\":\"tool_call\"") ||
      text.includes("\"type\":\"function_call\"")
    ) {
      count += 1;
    }
  }
  return count;
}

function usageFromTranscript(jsonl: string): { input_tokens: number; output_tokens: number } | undefined {
  let latest: { input_tokens: number; output_tokens: number } | undefined;

  for (const line of jsonl.split("\n")) {
    const event = parseJsonLine(line);
    if (!isRecord(event) || !isRecord(event.usage)) continue;
    const inputTokens = event.usage.input_tokens;
    const outputTokens = event.usage.output_tokens;
    if (typeof inputTokens === "number" && typeof outputTokens === "number") {
      latest = {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
      };
    }
  }

  return latest;
}

function parseJsonLine(line: string): unknown | undefined {
  const trimmed = line.trim();
  if (trimmed.length === 0) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

function readOptional(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
