---
name: history
description: Draft a new history entry, or update the most recent one with `--update`. Use after a meaningful commit or set of commits. Provide the "why" as an argument — /history the reason this change was made. Use /history --update to extend the latest entry without prompting.
allowed-tools: Bash(git *) Bash(date *) Bash(mkdir *) Bash(ls *) Read Glob Edit Write
---

Read `history/PROMPT.md` and follow its instructions.

Prefer a history-only commit after the feature commit. For a combined commit, cite the feature subject with “this commit”. After a merge or rebase rewrites cited hashes, verify their replacements and prepare a focused follow-up PR.

The **why** for this invocation: `$ARGUMENTS`
