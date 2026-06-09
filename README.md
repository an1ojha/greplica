# Greplica

Greplica (`greplica`) stores lightweight codebase memory for coding agents. The CLI provides small graph-memory primitives; agent workflows are provided as skills.

Greplica normally stores the current Git repository's real remote URL and target root path. If the current directory is not inside a Git repository, Greplica stores memory against that folder path with no remote URL.

## Requirements

- Node.js and npm.
- Build tools needed by native npm packages such as `better-sqlite3`.
- An embedding provider for graph context search and proposal application. Local embeddings run in-process by default; OpenAI embeddings require `OPENAI_API_KEY` when configured.

## Agent Setup

Copy this prompt into the coding agent from the repository you want to use with Greplica:

`````txt
Install Greplica for this repo.

First install the CLI from the Greplica repo. If the package has already been published, use:

```bash
npm install -g greplica
```

Otherwise install the current checkout:

```bash
npm install -g <path-to-greplica>
```

Then run exactly one of these commands.

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
- Run "Use greplica-bootstrap for this repo." once per repo to initialize memory. If repo memory already exists, do not run it again.
- During work, use `greplica graph context "<question>"` to fetch relevant repo context, including prior working memory, before broad manual exploration.
- Near the end of useful sessions, run "Use greplica-update-working-memory for this session." so durable decisions, constraints, changed flows, and follow-up work stay up to date.
- Tell me to add the Greplica guidance block manually to AGENTS.md or CLAUDE.md if I want always-on repo guidance.
`````

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

If Greplica was installed from a persistent source checkout, update it with:

```bash
GREPLICA_SRC="${GREPLICA_SRC:-$HOME/.greplica/src/greplica}"
before="$(git -C "$GREPLICA_SRC" rev-parse HEAD)"
git -C "$GREPLICA_SRC" pull --ff-only --prune
after="$(git -C "$GREPLICA_SRC" rev-parse HEAD)"

if [ "$before" != "$after" ]; then
  npm install --prefix "$GREPLICA_SRC"
  npm install -g "$GREPLICA_SRC"
fi
```

If the checkout changed, copy the two skill folders from `$GREPLICA_SRC/skills/` over the installed skill folders again so agent instructions stay current.

Current source-install benchmark on this machine:

- Fresh documented clone/install/build/global-install flow: about 9.7s.
- Fresh persistent-checkout flow without the redundant explicit build: about 9.0s.
- Full cold start after deleting `~/.greplica`, with local embedding pre-warm via `greplica init --local`: about 38.9s.
- Optimized local cold start without pre-warming embeddings: about 7.6s; first graph-context query pays the local model download later.
- No-op update with unconditional reinstall: about 9.2s.
- No-op update with the conditional reinstall command above: about 2.9s.
- Direct `npm install -g git+ssh://...` is not reliable yet because the git dependency prepare step can fail before `tsc` is available.

The better long-term install path is to publish or attach a built package artifact that already contains `dist/`, `skills/`, and `README.md`. Then install/update can become a single `npm install -g <package-or-tarball>` command without cloning the repo or compiling TypeScript during user setup.

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
greplica init [--local|--openai]
greplica config
greplica doctor [--check-embeddings]
greplica graph read
greplica graph context "<query>" [--json|--debug]
greplica proposal validate <proposal.json>
greplica proposal apply <proposal.json>
```

`greplica graph context "<query>"` prints concise Markdown for coding-agent use. Use `--json` for compact structured output, or `--debug` for the full retrieval payload with ranking signals and embedding status.

`greplica` automatically prepares memory state when commands run, so users should not need a separate init step.

`greplica doctor` is for install verification and diagnosing failures, not a required preflight before every Greplica command.

## Alpha Status

Greplica is ready for small-team dogfooding. The bootstrap flow is the most stable path. The update-working-memory flow validates and applies proposals, but memory quality still needs human review, especially for nuanced session rationale, future work, and superseding older claims.
