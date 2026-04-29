---
name: history
description: Draft a new history entry, or update the most recent one with `--update`. Use after a meaningful commit or set of commits. Provide the "why" as an argument — /history the reason this change was made. Use /history --update to extend the latest entry without prompting.
allowed-tools: Bash(git *) Bash(date *) Bash(mkdir *) Bash(ls *) Read Glob Edit Write
---

Draft a history entry and save it to `history/` following this repo's conventions.

If `$ARGUMENTS` starts with `--update` (or `-u`), follow the **Update mode** steps. Otherwise follow **New entry** steps.

## New entry

1. Run `git log --oneline -15` to see recent commits and identify which ones this entry covers.
2. Run `git show --stat` on the relevant commit(s) to see what changed.
3. Read `history/PROMPT.md` — it contains the full writing instructions. Follow them.
4. Read 1–2 recent files under `history/` to match their tone and structure.
5. The **why** is: `$ARGUMENTS`. If empty, ask the user for it before proceeding — do not skip or guess.
6. Draft the entry. Use today's date for the filename. Use `## h2` sections for substantial entries, inline bold labels for small ones.
7. If any commit hashes are uncertain or not yet merged, leave them as `<!-- TODO -->`.
8. Create the year directory if needed (`history/YYYY/`), then write the file to `history/YYYY/YYYY-MM-DD-topic.md`.
9. Show the user the saved file path and content. Ask them to review before committing.

## Update mode (`--update` / `-u`)

Use this when recent commits extend or correct a topic that already has an entry — do not create a new file, do not ask for a "why".

1. Locate the latest entry: `ls history/*/ | tail` and pick the file with the most recent `YYYY-MM-DD-…` filename. That's the "latest topic".
2. Run `git log --oneline -15` to see recent commits. The commits to add are everything since the **Commits** line in that entry (those hashes already documented). If the entry's hashes don't exist (squashed during merge), use the new commits that touch the same area.
3. Run `git show --stat` on the new commit(s) to see what changed.
4. Read the existing entry in full so updates stay consistent with its structure and tone.
5. Update the entry in place with `Edit`:
   - Append the new commit hashes to the **Commits** line (replace stale/squashed hashes if needed). **Skip commits that only touch `history/`** — entries that exist solely to refine the history doc itself shouldn't be listed as commits the entry "covers".
   - Revise sections affected by the new commits (behavior matrices, migration notes, examples, API names) so the doc reflects the current state — not an addendum tacked on the end.
   - Keep the original filename and date — the file represents the topic, not the latest commit.
   - Anything left ambiguous by the commit messages: leave a `<!-- TODO: ... -->` rather than guessing.
6. Show the user the file path and a summary of what changed (which sections, which commits added). Ask them to review before committing.
