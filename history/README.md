# History

Short notes on **why** changes happened. Git has the diff; this has the intent.

Write one when future-you (or another maintainer) would thank you. Skip trivial edits.

**Path:** `history/YYYY/YYYY-MM-DD-topic.md`
Same day again? Use `-02`, `-03`, etc.

**Topic slugs** name an area of the codebase or a feature, not an action — `gpu-transitions`, `points-rendering`, `simulation-cleanup` rather than `fix-issue-42` or `add-stuff`.

**Useful content:**
- commit hash(es) — `<!-- TODO -->` is fine if you write before merge
- why the change happened
- notes worth keeping (tradeoffs, migration, caveats)
- a small matrix or table when behavior gets tangled
- a pointer to a Storybook story or runnable demo if one was added for the feature

Length is up to you. Often a screen, longer when the change deserves it.

**Skeleton:**

```markdown
<!-- suggested path: history/YYYY/YYYY-MM-DD-topic.md -->

# Short title

**Commits:** abc1234

## Why
One or two sentences on the problem or goal.

## Notes
What changed, what's worth knowing later — tradeoffs, caveats, migration steps.
```

**Writing options:**
- Yourself: write directly.
- With an LLM: use [`PROMPT.md`](./PROMPT.md).

See recent files under `history/` for examples — they're the real source of truth on style.
