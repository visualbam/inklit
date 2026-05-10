#!/usr/bin/env bash
# Spin up two dummy worktrees so lazyagent has something to render.
# Run from the root of any git repo; it'll create branches "demo-one" and "demo-two".
set -euo pipefail

if ! command -v wt >/dev/null 2>&1; then
  echo "wt not found — install worktrunk: https://worktrunk.dev" >&2
  exit 1
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Not inside a git repo. cd into one and re-run." >&2
  exit 1
fi

echo "Creating two demo worktrees…"
wt switch -c demo-one --no-cd
wt switch -c demo-two --no-cd
echo
echo "Now run: cd $(git rev-parse --show-toplevel) && lazyagent"
echo "Tear down with: wt remove demo-one demo-two -D"
