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

## Roadmap

- Codex and Claude Code plugins so Greplica can be installed and used as a first-class agent integration.
- Review UX for memory updates before the agent applies them.
- HW context benchmark coverage and sharper retrieval evals for real coding tasks.

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
