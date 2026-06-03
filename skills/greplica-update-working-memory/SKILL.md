---
name: greplica-update-working-memory
description: Update Greplica working memory from the current coding-agent session, recent code changes, and durable decisions. Use only when the user explicitly invokes greplica-update-working-memory or asks to update working memory.
disable-model-invocation: true
---

# Update Greplica Working Memory

Update working memory with durable information learned during this coding session.

## Preconditions

Run from the target repository root or any subdirectory inside it.

1. Run `greplica doctor`.
2. If `greplica` is missing, tell the user to run the Greplica setup prompt from the README.
3. If `OPENAI_API_KEY` is missing, stop. Do not ask the user to paste the key into chat. Tell them to set it in their shell before launching the coding agent, or in repo-root `.env.local`.

`greplica` automatically prepares repo memory state; do not ask the user to run a separate initialization command.

## Gather Evidence

Use the current conversation/session context plus code evidence. Read:

- `git status --short`
- `git diff --stat`
- focused `git diff` for changed areas
- files touched by the session when needed to verify claims
- existing relevant memory with `greplica graph context "<task or changed area>"`

Use the current session as context, but verify durable code facts against files or diffs when possible.

When you have a transcript file, scan it deliberately before writing the proposal. Get its line count first, then read every line in chunks if needed; do not rely only on the first chunk, keyword search, code diffs, or final assistant summary. Prioritize user messages and final accepted decisions over assistant suggestions, and search around terms such as `source`, `evidence`, `session`, `reason`, `metadata`, `future`, `next`, `later`, `out of scope`, `not built`, `proposal`, `eval`, `fixture`, `rubric`, `wrong`, `reject`, `don't`, and `instead`.

When creating a session source, derive its identity from the actual session:

- If a transcript file is available, read its session metadata first. For Codex JSONL transcripts, use `session_meta.payload.id`; also use `session_meta.payload.source` or `session_meta.payload.originator` to identify the session kind when present.
- Build a stable source ID from that metadata, for example `source.codex_session.<session_id_slug>` or `source.claude_code_session.<session_id_slug>`. Slug the session ID by lowercasing it and replacing non-alphanumeric characters with `_`.
- Set `ref` to a stable reference such as `codex-session:<session-id>` or `claude-code-session:<session-id>`, and set `title` to a concise human-readable session title.
- Do not use generic IDs like `source.current_session` when a session ID or transcript identity is available.

Before writing the proposal, scan the session against this checklist:

- What code facts changed?
- What cross-component flows changed?
- What constraints did the user impose?
- What rationale explains why the code was shaped this way?
- What trade-offs or alternatives were discussed, rejected, or deferred?
- What drift did the implementation introduce without an explicit durable decision?
- What tasks remain?
- What future work was explicitly discussed?

Skip a category when the session has no clear evidence for it. Do not invent future work from implementation gaps; future work should be explicit in the session or clearly stated as a deferred part of the larger plan.

## What To Store

Create memory for durable changes only:

- **Code facts**: specific implementation facts verified against code or diffs.
- **Flow facts**: how behavior works across multiple components or commands.
- **Constraints**: rules future agents must preserve while editing.
- **Rationale**: why a design exists when the reason is not obvious from code.
- **Trade-offs**: alternatives discussed, rejected, postponed, or intentionally kept out of scope.
- **Drift**: important behavior or design consequences that exist without a clear explicit decision.
- **Tasks**: next work that should be done.
- **Future work**: planned later capabilities or follow-up directions that should not be forgotten.

When existing memory is now too vague or stale, create a clearer claim with `supersedes[]` pointing at the old claim. In particular, look for old claims returned by `greplica graph context` that describe the changed area broadly but miss the new session nuance. A claim can be worth superseding even when the old text is not false, if it is now materially incomplete and future agents would be misled by leaving it active.

Do not store:

- temporary debugging chatter
- every implementation detail
- command logs
- secrets or environment variable values
- obvious local code facts that a future agent can read immediately
- claims based only on vague conversation unless marked `unknown`

Do not stop at patch-visible facts. Also extract non-obvious session nuance: why the code was shaped this way, what alternatives were rejected, what future work was deferred, and what implicit drift the implementation introduced.

Keep distinct durable memories distinct. "Small update" means no transcript junk or unnecessary implementation detail; it does not mean merging separate code facts, constraints, rationales, trade-offs, drift, tasks, and future work into one broad claim. If the session contains separate durable statements, create separate focused claims with the right claim kind and truth value.

Preserve explicit negative or deferred decisions as first-class memory when they affect future work. Examples include "do not create code sources from code inspection", "proposal JSON remains the primitive", "a session ingest command was discussed but not built", "fixed eval fixtures should stay stable", and "compact shorthand still exists but no longer satisfies reasoned evidence validation".

Avoid broad code-verified claims about entire skills or workflows unless every part was verified against the patch. Prefer narrower claims tied to exact code/doc changes, and keep rationale or policy from the transcript as separate source-verified claims.

## Proposal Format

Write a JSON proposal to a temporary file:

```json
{
  "title": "Update working memory from session",
  "summary": "Durable context learned during the current coding session.",
  "creates": {
    "components": [],
    "flows": [],
    "claims": [
      {
        "id": "claim.example_session_decision",
        "kind": "decision",
        "text": "The session decided to keep the CLI primitive-focused and put workflows in coding-agent skills.",
        "truth": "source_verified",
        "intent": "intended",
        "about": []
      }
    ],
    "sources": [
      {
        "id": "source.codex_session.example_session_id",
        "kind": "session",
        "ref": "codex-session:example-session-id",
        "title": "Codex session example-session-id"
      }
    ],
    "edges": [
      {
        "kind": "evidenced_by",
        "from": "claim.example_session_decision",
        "to": "source.codex_session.example_session_id",
        "metadata": {
          "reason": "The decision was discussed and agreed during the current coding-agent session."
        }
      }
    ]
  }
}
```

Allowed claim kinds: `fact`, `requirement`, `decision`, `task`, `question`, `risk`.
Allowed truth values: `code_verified`, `source_verified`, `unknown`.
Allowed intent values: `intended`, `accidental`, `unknown`.
Allowed source kinds: `session`.

Use compact relationship fields where possible:

- `flow.touches[]` for Flow -> Component.
- `component.contains[]` for Component -> Component.
- `flow.contains[]` for Flow -> Flow.
- `claim.about[]` for Claim -> Component/Flow.
- `claim.supersedes[]`, `component.supersedes[]`, or `flow.supersedes[]` only when replacing known existing memory.

For source-backed claims, use explicit `edges[]` entries with `kind: "evidenced_by"` and `metadata.reason`. Do not use compact `claim.evidenced_by[]`; every evidence edge must explain why the session supports the claim.

If you create a session source, connect non-code session-derived claims with `evidenced_by` edges. Code-verified claims do not need session evidence unless the claim is also recording a session decision, requirement, question, risk, trade-off, or task.

Each source-backed session claim should have its own `evidenced_by` edge to the session source with a reason specific to that claim. Do not use one bundled source-backed claim to cover multiple unrelated decisions, constraints, rationales, trade-offs, drift items, tasks, or future work.

## Quality Bar

- Prefer a small update over broad memory churn.
- Reuse existing components/flows when `greplica graph context` finds them.
- Create new components/flows only when the session introduced or clarified a durable area.
- Use `code_verified` only for claims checked against code.
- Use `source_verified` for claims grounded in the session.
- Use `unknown` for unresolved tasks, questions, and risks.
- Create one `session` source for the current session when storing session-derived claims, with a source ID derived from the actual session metadata.
- Add a concise free-text `metadata.reason` to each `evidenced_by` edge.
- Include tasks and future work only when the session discussed what remains to be built.
- Prefer one precise superseding claim over leaving an older broad claim active beside a more specific update.
- If the session changed validation, proposal normalization, or skill behavior, explicitly query existing memory for those areas and decide whether an older claim should be superseded.

## Validate And Apply

1. Run `greplica proposal validate <proposal-file>`.
2. Fix validation errors until valid.
3. Run `greplica proposal apply <proposal-file>`.
4. Summarize the durable memory update and mention anything intentionally not stored.
