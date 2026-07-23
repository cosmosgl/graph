#!/bin/sh
# Configures core.hooksPath so .githooks/pre-commit runs for this checkout.
#
# Run via the "prepare" npm script on every `npm install`/`npm ci`. Silently
# does nothing when there's no git working tree to configure (e.g. this
# package installed as a registry/tarball dependency elsewhere) -- but if we
# ARE inside a real working tree and the config write itself fails
# (permissions, git missing, a corrupted repo), that's a real problem and
# gets a warning instead of vanishing silently, so hooks don't end up quietly
# unconfigured in exactly the git-worktree scenario this hooks setup exists
# to support (see .githooks/pre-commit).
set -e

if [ "$(git rev-parse --is-inside-work-tree 2>/dev/null)" != "true" ]; then
  exit 0
fi

if ! git config core.hooksPath .githooks; then
  echo "prepare: warning: could not set core.hooksPath -- pre-commit hooks will not run. Run 'git config core.hooksPath .githooks' manually." >&2
fi

exit 0
