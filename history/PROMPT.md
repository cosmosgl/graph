# Prompt: Draft a history entry

Copy this into your LLM. Fill the 3 context blocks at the end. Review the output before committing.

---

You are drafting an entry for this repo's `history/` folder.

Goal: capture **why** a change happened (intent, tradeoffs, migration notes).
Git already captures **what** changed.

Before writing, read one or two recent files under `history/` and match their level of detail, structure, and tone — the corpus is the real source of truth on style.

## How it usually looks

- **Filename:** `history/YYYY/YYYY-MM-DD-topic.md` — `topic` names an area of the codebase or a feature, not an action (`gpu-transitions`, `points-rendering`, not `fix-issue-42`). Same-day extras: `-02`, `-03`, ...
- **First line:** `<!-- suggested path: history/YYYY/YYYY-MM-DD-topic.md -->`
- **Length:** fit the change — a few lines for a small fix, longer when the change deserves it.
- **Tone:** plain language for a teammate who was not present.
- **Structure:** flexible. Bold inline labels (`**Why:**`, `**Notes:**`) work for small entries; `## h2` sections work better for larger ones.

## Patterns worth borrowing

- For **breaking changes**, include a `## Migration` section with a before/after snippet.
- For **state-machine or behavior changes**, a small matrix or table often beats prose.
- **Code snippets** are welcome for new APIs or config.
- If a Storybook story or runnable demo was added for the feature, include a brief `## Example` section pointing to it — path, Storybook title, and one sentence on what it demonstrates.

## A few ground rules

- Don't invent facts. If something's missing or unclear, add `<!-- TODO: ... -->` instead of guessing.
- If the **why** is missing from the context, ask for it.
- Writing before merge? Leave the commit hash as `<!-- TODO -->` and fill it in after.
- Output **only** the markdown content ready to save.

---

## Context for this entry

**Commits / diff:**
<paste `git log` and/or `git diff --stat` for the relevant range>

**PR or ticket info (if any):**
<paste PR description, ticket, or discussion snippets>

**Why this change happened (your words):**
<1-2 sentences; do not skip>
