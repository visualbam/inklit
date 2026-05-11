# AGENTS.md

## Scope

These instructions apply to the whole repository.

## Project Overview

`inklit` is a Node.js 20+ TypeScript ESM CLI/TUI for managing parallel AI coding
agents in git worktrees. It uses Ink/React for the terminal UI, worktrunk's
`wt` CLI for worktree operations, and zellij for panes.

Important entry points:

- `src/index.tsx`: process entry, root CLI parsing, TUI mount.
- `src/cli.ts`: `inklit spawn`, global `--main`, help text.
- `src/agent.ts`: zellij pane creation plus `wt switch` command composition.
- `src/wt.ts`: `wt list --format json` parsing and git review helpers.
- `src/ui/App.tsx`: reducer, polling, key dispatch, task lifecycle behavior.
- `src/ui/HelpOverlay.tsx` and `README.md`: keep these in sync when user-facing
  commands, keys, or workflows change.

Edit source files under `src/`. Do not edit generated `dist/` output directly.

## Development Commands

- Install dependencies: `npm install`
- Typecheck: `npm run typecheck`
- Run tests: `npm test`
- Build: `npm run build`
- Smoke root help after build: `node dist/index.js --help`
- Smoke spawn help after build: `node dist/index.js spawn --help`
- Final whitespace sanity check: `git diff --check`

Live task spawning needs an active zellij session. If zellij pane creation fails
outside that environment, treat typecheck/build/help output as partial
validation and call out that an end-to-end spawn check still needs a real
zellij session.

## Coding Conventions

- Keep TypeScript strict. The repo uses `moduleResolution: "NodeNext"`, so local
  imports should use the emitted `.js` extension.
- Prefer `execa` with explicit argv arrays over shell strings, especially for
  git, zellij, and `wt` commands.
- Parse external tool output defensively. `wt` JSON fields are intentionally
  treated as optional because the schema may drift.
- Preserve the distinction between the dashboard "main version" and the
  configurable review/apply target branch. Use the configured target from
  `--main` or `INKLIT_MAIN_BRANCH`; do not hardcode `main` in review, apply,
  diff, files, log, or spawn-base behavior.
- For repeated headless task creation, use `--branch-prefix` plus `--count` so
  every task gets a unique branch. Do not reuse one exact `--branch` name for
  multiple tasks.
- Keep destructive workflows explicit and previewable. Apply, kill, and pane
  closing paths should continue to require confirmation where the UI already
  does so.
- Keep terminal UI changes consistent with the existing theme, icon, text, and
  windowing helpers. Favor compact, keyboard-first views over web-style panels.

## Tests

Tests live in `tests/*.test.ts` and run through Node's built-in test runner via
`tsx`. Add focused tests when changing parsing, state persistence, command
availability, lifecycle transitions, review/apply behavior, or target-branch
plumbing.

For CLI/user-facing changes, update both README examples and the in-app help
overlay, then verify the built help output when practical.

## Worktree Hygiene

This repo may have unrelated in-progress edits. Before changing code, check the
working tree and avoid reverting or restaging user-owned changes. Keep patches
scoped to the requested behavior and leave unrelated files alone.
