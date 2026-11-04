# History entry guide

Captures **why** a change happened — intent, tradeoffs, migration notes. Git already captures **what** changed.

If the **why** argument starts with `--update` or `-u`, follow **Update mode**. Otherwise follow **New entry**.

## New entry

1. Run `git log --oneline -15` to identify which commits this entry covers.
2. Run `git show --stat` on the relevant commit(s) to see what changed.
3. Ask for the **why** if it wasn't provided — do not skip or guess.
4. Draft the entry (see [Writing rules](#writing-rules) below). Use today's date for the filename.
5. Add the verified PR link when available. Use the citation rules below if the PR has yet to be opened.
6. Create the year directory if needed (`history/YYYY/`), then write the file to `history/YYYY/YYYY-MM-DD-topic.md`.
7. Show the saved file path and content. Ask the user to review before committing.

## Update mode

Use when recent commits extend or correct a topic that already has an entry — do not create a new file, do not ask for a "why".

1. Locate the latest entry: `ls history/*/` and pick the file with the most recent `YYYY-MM-DD-…` filename.
2. Identify the new changes in git and check the PRs already cited in the entry.
3. Run `git show --stat` on the new commit(s).
4. Read the existing entry in full.
5. Update the entry in place:
   - Add links to verified PRs that changed the behavior. Cite each PR once and skip history-only changes.
   - Revise sections affected by the new commits so the doc reflects current state — not an addendum tacked on the end.
   - Keep the original filename and date — the file represents the topic, not the latest commit.
6. Show the file path and a summary of what changed (which sections and PR references changed). Ask the user to review before committing.

## Writing rules

### How it usually looks

- **Filename:** `history/YYYY/YYYY-MM-DD-topic.md` — `topic` names an area of the codebase or a feature, not an action (`gpu-transitions`, `points-rendering`, not `fix-issue-42`). Same-day extras: `-02`, `-03`, ...
- **Length:** fit the change — a few lines for a small fix, longer when the change deserves it.
- **Tone:** plain language for a teammate who was not present.
- **Structure:** flexible. Bold inline labels (`**Why:**`, `**Notes:**`) work for small entries; `## h2` sections work better for larger ones.

### Patterns worth borrowing

- For **breaking changes**, include a `## Migration` section with a before/after snippet.
- For **state-machine or behavior changes**, a small matrix or table often beats prose.
- **Code snippets** are welcome for new APIs or config.
- If a Storybook story or runnable demo was added, include a `## Example` section — path, Storybook title, one sentence on what it demonstrates.

### Ground rules

- Read 1–2 recent entries under `history/` before writing — the corpus is the real source of truth on tone and detail level.
- Use a verified GitHub PR link as the default citation, for example `**PR:** [#290](https://github.com/cosmosgl/graph/pull/290)`. Use `**PRs:**` for multiple changes and add brief labels when they help identify each PR's role.
- If the PR has yet to be opened, use the verified change subject and add the link to the same PR once its URL is available. Omit the citation when there is no verified reference.
- Use a verified commit hash when the exact revision matters, such as a benchmark baseline, the commit that introduced a regression, or a backport target. Keep existing references that serve that purpose.
- Output **only** the markdown content ready to save.

---

## Manual use

Copy this file into any LLM. Fill these context blocks before sending.

**Commits / diff:**
<paste `git log` and/or `git diff --stat` for the relevant range>

**PR or ticket info (if any):**
<paste PR description, ticket, or discussion snippets>

**Why this change happened (your words):**
<1-2 sentences; do not skip>
