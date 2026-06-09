<div align="center">

# Greplica

### Long-term, searchable `AGENTS.md` for coding agents

<p>
  <a href="https://www.npmjs.com/package/greplica"><img alt="npm package" src="https://img.shields.io/npm/v/greplica?color=111111"></a>
  <img alt="Agents" src="https://img.shields.io/badge/agents-Codex%20%7C%20Claude%20Code-2563eb">
  <img alt="Storage" src="https://img.shields.io/badge/storage-local%20SQLite-475569">
  <img alt="Embeddings" src="https://img.shields.io/badge/embeddings-local%20%7C%20OpenAI-16a34a">
</p>

Keep `AGENTS.md` small. Put the rest of the agent's repo memory in Greplica.

</div>

---

`AGENTS.md` works because coding agents need project context. But the useful context quickly grows past what belongs in a short, always-read instruction file: architecture decisions, workflow notes, repo-specific gotchas, evaluation results, implementation history, and follow-up work.

Greplica keeps that deeper engineering context in local repo memory. Your agent can fetch the pieces it needs for the current task instead of rereading everything or rediscovering the codebase from scratch.

| `AGENTS.md` | Greplica |
| --- | --- |
| Always read by the agent | Queried only when relevant |
| Best for stable instructions | Best for deeper engineering context |
| Should stay short and high-signal | Can hold architecture notes, decisions, evals, and gotchas |
| Maintained manually | Maintained through bundled agent skills |

## Agent Quick Start

Most users should not install Greplica by hand. Paste this into your coding agent from inside the repo you want Greplica to remember:

`````txt
Install Greplica for this repo.

First install the CLI:

```bash
npm install -g greplica
```

Then run the installer for the agent I am using:

Codex:
```bash
greplica install --platform codex --embedding local
```

Claude Code:
```bash
greplica install --platform claude --embedding local
```

Do not manually copy skills. Let the installer do it.

After installation, tell me where the skills were installed, which embedding mode was configured, whether I should restart the agent, and how to switch later to OpenAI embeddings if I want that.

Then tell me how to use Greplica:
- If this repo has not been initialized yet, tell me to run "Use greplica-bootstrap for this repo." once. If repo memory already exists, do not run it again.
- Tell me that during work, the agent can use `greplica graph context "<question>"` to fetch relevant repo context, including prior working memory, before broad manual exploration.
- Tell me that near the end of a useful session, I should run "Use greplica-update-working-memory for this session." so decisions, changed flows, constraints, and follow-up work are stored.
- Tell me that OpenAI embeddings are also available later by rerunning `greplica install --platform <codex-or-claude> --embedding openai`.
- IMPORTANT: tell me to add the Greplica guidance block manually to AGENTS.md or CLAUDE.md if I want the agent to keep using Greplica automatically.
`````

After that, the normal workflow is:

| Step | Ask your agent | What happens |
| --- | --- | --- |
| 1 | `Use greplica-bootstrap for this repo.` | Creates the first repo memory map. |
| 2 | Work normally | The agent can query `greplica graph context "<question>"` before broad exploration. |
| 3 | `Use greplica-update-working-memory for this session.` | Durable decisions, constraints, changed flows, and follow-ups are saved. |

<details>
<summary>Manual install commands</summary>

Install the CLI:

```bash
npm install -g greplica
```

Install Greplica for your coding agent.

Codex:

```bash
greplica install --platform codex --embedding local
```

Claude Code:

```bash
greplica install --platform claude --embedding local
```

</details>

That gives the next agent a better starting point: not just files on disk, but remembered decisions, constraints, flows, and follow-up work.

---

## What Gets Stored?

Greplica is for engineering context that is useful later but too detailed for an always-read prompt:

- architecture and service boundaries
- command and workflow behavior
- repo-specific conventions and gotchas
- decisions made during implementation
- constraints, rejected alternatives, and future work
- eval results and benchmark notes
- code anchors that tell future agents where to inspect first

The goal is not to replace source code or documentation. The goal is to give agents a durable map of what matters and where to look next.

## How It Works

Greplica is intentionally split into three layers:

| Layer | Responsibility |
| --- | --- |
| CLI | Detects the current repo, stores memory locally, and exposes graph commands. |
| Skills | Define agent workflows such as bootstrapping repo memory and updating working memory after a session. |
| Retrieval | `greplica graph context "<query>"` returns relevant claims, components, and flows for the current task. |

Memory is stored in SQLite under `~/.greplica/graph.db` by default. Local embeddings run in-process by default and cache model files under `~/.greplica/models`. OpenAI embeddings are also supported when configured.

Graph context search blends multiple retrieval signals, including embeddings, BM25, exact matching, and graph relationships. The output is designed for coding agents: concise enough to fit into the task, but grounded enough to point at the right files and prior decisions.

## Evals And Benchmarks

Greplica includes evals for the workflows that matter most:

- bootstrapping repo memory
- graph context retrieval
- working-memory updates from real sessions
- proposal validation and apply behavior

The search eval scores `greplica graph context` retrieval with `Precision@10`, `Recall@10`, `MRR@10`, `nDCG@10`, and `GradeRecall@10`.

| Eval | Latest local result |
| --- | --- |
| `npm run eval:search-current` | Passed, `80.59 / 100` |
| `P@10` | `0.550` |
| `R@10` | `0.782` |
| `MRR@10` | `0.985` |
| `nDCG@10` | `0.802` |
| `GradeRecall@10` | `0.828` |

Broader context-retrieval benchmarking, including HW context benchmark work, is ongoing and showing promising early results. We will publish those numbers when the harness and methodology are stable enough to compare fairly.

## Status

Greplica is usable today for developer dogfooding and real repository work.

| Mature today | Improving now |
| --- | --- |
| Bootstrap flow | Memory review UX |
| Graph context retrieval | Stale-context handling |
| Local SQLite memory | More eval coverage |
| Codex and Claude Code install flow | Broader context benchmarks |

## Roadmap

- Better review UX for memory updates before they are applied.
- More eval coverage for bootstrap, retrieval, and session-memory quality.
- Ongoing HW context benchmark work and broader context-retrieval comparisons.
- Better handling for stale or superseded memory.
- More examples for real coding-agent workflows.
- More agent integrations beyond Codex and Claude Code.

## Requirements

- Node.js and npm.
- Build tools needed by native npm packages such as `better-sqlite3`.
- An embedding provider for graph context search and proposal application. Local embeddings run in-process by default; OpenAI embeddings require `OPENAI_API_KEY` when configured.

## Using Greplica

After setup, invoke the skills by asking your coding agent to use them:

```txt
Use greplica-bootstrap for this repo.
```

```txt
Use greplica-update-working-memory for this session.
```

Run bootstrap once near the start of using Greplica in a repo. Run update working memory near the end of a coding session when the session contains durable decisions, changed flows, constraints, follow-up work, or useful implementation context.

Do not run `greplica doctor` before normal Greplica commands. Use the intended command directly, such as `greplica graph context "<query>"`; if it fails, use the error message to decide whether `doctor` would help diagnose installation, target detection, or embedding-provider configuration.

## Updating Greplica

Update the published package with:

```bash
npm install -g greplica@latest
```

Then rerun the platform install command so the latest bundled skills are copied into your coding-agent skill directory:

```bash
greplica install --platform codex --embedding local
```

or:

```bash
greplica install --platform claude --embedding local
```

If the install output says to restart your coding agent, do that so the refreshed skills are picked up.

## Configuration

`greplica` stores default CLI config at `~/.greplica/config.json`:

```json
{
  "version": 1,
  "embedding": {
    "provider": "local",
    "model": "all-mpnet-base-v2",
    "dimensions": 768,
    "batchSize": 16
  }
}
```

Print the config path, current JSON, allowed providers, and common examples:

```bash
greplica config
```

Edit the printed JSON file directly to change the selected embedding provider, model, dimensions, or batch size. For example:

```json
{
  "version": 1,
  "embedding": {
    "provider": "openai",
    "model": "text-embedding-3-small",
    "dimensions": 1536,
    "batchSize": 100
  }
}
```

Allowed `embedding.provider` values are `local` and `openai`.

`greplica init --local` and `greplica init --openai` also update the same config file to provider defaults while initializing memory for the current repo or folder and checking that the selected embedding provider is ready.

Local embeddings run in-process with a quantized Hugging Face Transformers model and cache model files under `~/.greplica/models`. The first `greplica init --local` or local embedding check downloads the configured model; subsequent runs reuse the cache.

Useful local model choices:

- `all-mpnet-base-v2`, 768 dimensions, default local model.
- `all-MiniLM-L6-v2`, 384 dimensions, smaller local option.

`greplica` looks for `OPENAI_API_KEY` in this order:

1. the process environment
2. `<target-root>/.env.local`
3. `<target-root>/.env`

The key is never printed by `greplica doctor`.

Memory is stored in `~/.greplica/graph.db` by default. Set `GREPLICA_HOME` only for tests or advanced isolated runs.

## Commands

```bash
greplica install --platform codex|claude --embedding local|openai
greplica init [--local|--openai]
greplica config
greplica doctor [--check-embeddings]
greplica graph read
greplica graph context "<query>" [--json|--debug]
greplica graph export <dir>
greplica proposal validate <proposal.json>
greplica proposal apply <proposal.json>
```

`greplica graph context "<query>"` prints concise Markdown for coding-agent use. Use `--json` for compact structured output, or `--debug` for the full retrieval payload with ranking signals and embedding status.

`greplica` automatically prepares memory state when commands run, so users should not need a separate init step.

`greplica doctor` is for install verification and diagnosing failures, not a required preflight before every Greplica command.
