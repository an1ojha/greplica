# Greplica

Greplica (`greplica`) stores lightweight codebase memory for coding agents. The CLI provides small graph-memory primitives; agent workflows are provided as skills.

## Requirements

- Node.js and npm.
- Build tools needed by native npm packages such as `better-sqlite3`.
- An embedding provider for graph context search and proposal application. Local embeddings run in-process by default; OpenAI embeddings require `OPENAI_API_KEY` when configured.

## Agent Setup

Copy this prompt into the coding agent from the repository you want to use with Greplica:

````txt
Install Greplica for this repo.

Goal:
- Install the `greplica` CLI from the Greplica GitHub repo.
- Install the bundled Greplica skills into this coding agent's user-level skills directory.
- Ask me whether to use local or OpenAI embeddings, then initialize Greplica with that choice.

Use this repo unless I provide a different URL or branch:

```txt
git@github.com:Autoloops/greplica.git
```

Do the install in the way that fits this environment. A typical CLI install flow is:

```bash
git clone --depth 1 git@github.com:Autoloops/greplica.git /tmp/greplica
npm install --prefix /tmp/greplica
npm run --prefix /tmp/greplica build
npm install -g /tmp/greplica
```

If `/tmp/greplica` already exists, update it or use a fresh temporary clone.

If global npm install is not allowed, use the agent's normal npm prefix/tool-install approach and make sure `greplica` is on PATH for future sessions. For an isolated npm prefix, use the equivalent of `npm install -g --prefix <prefix-dir> /tmp/greplica` and add `<prefix-dir>/bin` to PATH.

Install these two skill folders from the cloned repo:

```txt
/tmp/greplica/skills/greplica-bootstrap
/tmp/greplica/skills/greplica-update-working-memory
```

Use the native skill install location for the coding agent:

- Claude Code personal skills: `~/.claude/skills/<skill-name>/SKILL.md`
- Claude Code project skills, only if I ask for repo-local install: `.claude/skills/<skill-name>/SKILL.md`
- Codex personal skills: `${CODEX_HOME:-~/.codex}/skills/<skill-name>/SKILL.md`
- Other SKILL.md-compatible agents: use their user-level skill directory.

The installed directories should be named exactly:

```txt
greplica-bootstrap
greplica-update-working-memory
```

Before running Greplica init, ask me whether to use local embeddings or OpenAI embeddings.

Local is the default recommendation: it runs on this laptop without an API key and downloads the local embedding model into `~/.greplica/models`. OpenAI may be faster or higher quality, but requires `OPENAI_API_KEY`.

If I choose local, run:

```bash
greplica init --local
```

If I choose OpenAI, verify `OPENAI_API_KEY` is available in the environment, this repo's `.env.local`, or this repo's `.env`, then run:

```bash
greplica init --openai
```

If OpenAI is selected and `OPENAI_API_KEY` is missing or invalid, stop and ask me to set it. Do not ask me to paste the key into chat. I can set it either in my shell before starting the coding agent, or in this repo's `.env.local` file:

```txt
OPENAI_API_KEY=...
```

After setup, tell me:
- where the CLI was installed
- where the two skills were installed
- which embedding mode was selected
- where the Greplica config file is
- whether I need to restart the coding agent for skills to appear
- how to invoke `greplica-bootstrap` and `greplica-update-working-memory`
````

## Using Greplica

After setup, invoke the skills by asking your coding agent to use them:

```txt
Use greplica-bootstrap for this repo.
```

```txt
Use greplica-update-working-memory for this session.
```

Run bootstrap once near the start of using Greplica in a repo. Run update working memory near the end of a coding session when the session contains durable decisions, changed flows, constraints, follow-up work, or useful implementation context.

Do not run `greplica doctor` before normal Greplica commands. Use the intended command directly, such as `greplica graph context "<query>"`; if it fails, use the error message to decide whether `doctor` would help diagnose installation, repo detection, or OpenAI configuration.

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

`greplica init --local` and `greplica init --openai` also update the same config file to provider defaults while initializing repo memory and checking that the selected embedding provider is ready.

Local embeddings run in-process with a quantized Hugging Face Transformers model and cache model files under `~/.greplica/models`. The first `greplica init --local` or local embedding check downloads the configured model; subsequent runs reuse the cache.

Useful local model choices:

- `all-mpnet-base-v2`, 768 dimensions, default local model.
- `all-MiniLM-L6-v2`, 384 dimensions, smaller local option.

`greplica` looks for `OPENAI_API_KEY` in this order:

1. the process environment
2. `<repo-root>/.env.local`
3. `<repo-root>/.env`

The key is never printed by `greplica doctor`.

Memory is stored in `~/.greplica/graph.db` by default. Set `GREPLICA_HOME` only for tests or advanced isolated runs.

## Commands

```bash
greplica init [--local|--openai]
greplica config
greplica doctor [--check-embeddings]
greplica graph read
greplica graph context "<query>" [--json|--debug]
greplica proposal validate <proposal.json>
greplica proposal apply <proposal.json>
```

`greplica graph context "<query>"` prints concise Markdown for coding-agent use. Use `--json` for compact structured output, or `--debug` for the full retrieval payload with ranking signals and embedding status.

`greplica` automatically prepares repo memory state when commands run, so users should not need a separate init step.

`greplica doctor` is for install verification and diagnosing failures, not a required preflight before every Greplica command.

## Alpha Status

Greplica is ready for small-team dogfooding. The bootstrap flow is the most stable path. The update-working-memory flow validates and applies proposals, but memory quality still needs human review, especially for nuanced session rationale, future work, and superseding older claims.
