---
name: history
description: Draft and save a history entry for a recent change in this repo. Use after a meaningful commit or set of commits. Provide the "why" as an argument — /history the reason this change was made.
allowed-tools: Bash(git *) Bash(date *) Bash(mkdir *) Read Glob Write
---

Draft a history entry and save it to `history/` following this repo's conventions.

## Steps

1. Run `git log --oneline -15` to see recent commits and identify which ones this entry covers.
2. Run `git show --stat` on the relevant commit(s) to see what changed.
3. Read `history/PROMPT.md` — it contains the full writing instructions. Follow them.
4. Read 1–2 recent files under `history/` to match their tone and structure.
5. The **why** is: `$ARGUMENTS`. If empty, ask the user for it before proceeding — do not skip or guess.
6. Draft the entry. Use today's date for the filename. Use `## h2` sections for substantial entries, inline bold labels for small ones.
7. If any commit hashes are uncertain or not yet merged, leave them as `<!-- TODO -->`.
8. Create the year directory if needed (`history/YYYY/`), then write the file to `history/YYYY/YYYY-MM-DD-topic.md`.
9. Show the user the saved file path and content. Ask them to review before committing.
