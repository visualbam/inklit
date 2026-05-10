# lazyagent

A terminal dashboard for managing parallel AI coding agents (Claude Code, Codex
CLI) that each run in their own git worktree. It sits in a Zellij pane next to
your editor and the agent panes themselves — think "Replit-style task list,
scoped to git worktrees."

It is a thin presentation layer over [worktrunk](https://worktrunk.dev) (the
`wt` CLI). Worktrunk handles all worktree/branch operations. lazyagent handles
the dashboard view and Zellij integration.

## Status

v0. The polling loop, list view, new-task spawn, and pane focus all work. A
bunch of features are intentionally stubbed — see the TODO list below.

## Prerequisites

| Tool        | Tested version |
| ----------- | -------------- |
| Node.js     | 25.9.0         |
| `wt`        | 0.48.0         |
| `zellij`    | 0.44.2         |
| `claude` or `codex` CLI | any (the agent CLI you spawn) |

You can run lazyagent outside zellij — the list will render read-only. Spawning
new tasks and focusing panes both require an active zellij session.

## Install

```bash
git clone <this-repo>
cd lazyagent
npm install
npm run build
npm link        # exposes `lazyagent` on your PATH
```

Or run from source without installing globally:

```bash
npm run dev
```

## Usage

Open a zellij session, drop into a git repo, and:

```bash
lazyagent
```

### Keybinds

Movement is Vim/Helix-flavored.

| Key      | Action                                                     |
| -------- | ---------------------------------------------------------- |
| `j` / ↓  | next task                                                  |
| `k` / ↑  | previous task                                              |
| `gg`     | jump to first task                                         |
| `G`      | jump to last task                                          |
| `Ctrl-D` | half-page down                                             |
| `Ctrl-U` | half-page up                                               |
| `n`      | new task — prompts for description, then agent (`c`/`x`)  |
| `enter`  | focus the selected task's zellij pane                      |
| `q` / `Ctrl-C` | quit                                                 |
| `m`      | merge to main *(stub — phase 2)*                           |
| `K`      | kill task *(stub — phase 2)*                               |
| `/`      | filter list *(stub — phase 2)*                             |
| `?`      | help overlay *(stub — phase 2)*                            |
| `r`      | force refresh *(stub — phase 2)*                           |
| `a/d/f/l`| inspector mode toggles *(stubs — phase 2)*                 |

Inspector currently only renders `git status --short --branch` for the
selected worktree.

### Status icons

| Icon | State    | Meaning                                                  |
| ---- | -------- | -------------------------------------------------------- |
| ●    | running  | a zellij pane named after the slug is alive              |
| ✓    | ready    | worktree exists, no live pane                            |
| ⊙    | waiting  | *not yet detected — needs `dump-screen` heuristic*       |
| ✗    | failed   | *not yet detected — needs exit-code state file*          |
| ·    | merged   | *not yet detected — fade-out is phase 2*                 |

A trailing `*` next to the slug means the worktree has uncommitted changes.

## Architecture

Single binary, no daemon. State lives in git + worktrunk; lazyagent does not
duplicate it. Every 1.5s the TUI shells out to `wt list --format json` and
`zellij action list-panes --json` and re-renders.

```
src/
  index.tsx        entry, --version/--help, mounts <App>
  model.ts         Task, AppState, action types
  wt.ts            wrapper over `wt list` (JSON) + git status
  zellij.ts        list-panes, focus-pane-id, new-pane
  agent.ts         spawn helper — composes one zellij+wt invocation
  ui/
    App.tsx        reducer, poll loop, key dispatch
    List.tsx       task list rendering
    Inspector.tsx  inspector pane (v0: git status only)
    StatusBar.tsx  bottom hint bar
    NewTaskPrompt.tsx  description prompt + agent picker
    icons.ts       state → icon/color/label
```

### New-task flow

When you press `n`:

1. Prompt for a description (Ink TextInput).
2. Pick `c` (claude) or `x` (codex).
3. We slugify the description and run, in one invocation:
   ```
   zellij action new-pane -n <slug> --close-on-exit -- \
     wt switch -c <slug> -x <agent> -- "<description>"
   ```
   That single command creates the worktree (worktrunk), launches the agent
   inside it, and surfaces it as a named zellij pane. The next 1.5s poll picks
   it up and shows it as `running`.

## Limitations & TODOs (phase 2)

- [ ] Inspector modes: `[a]` agent transcript via `zellij action dump-screen`,
      `[d]` diff, `[f]` files, `[l]` log.
- [ ] `waiting` state detection (tail dump-screen, look for prompt glyphs).
- [ ] `failed` state detection (track pane exit codes in
      `$XDG_STATE_HOME/lazyagent/exits.json`).
- [ ] `merged` fade-out (~30s after `m`).
- [ ] `m` merge action — wraps `wt merge main` in the selected worktree.
- [ ] `K` kill action — close pane + `wt remove`.
- [ ] `/` filter the list.
- [ ] `?` help overlay.
- [ ] `r` force refresh (today the loop is fixed at 1.5s).
- [ ] Concurrency in the poll loop. v0 is single-threaded and serializes
      `findPaneByName` per task — fine for ≲20 tasks.
- [ ] Validate behavior when `wt` schema changes; the parser is permissive but
      untyped fields could regress silently.

## Demo

`scripts/demo.sh` creates two dummy worktrees in the current git repo so
lazyagent has something to render on first launch:

```bash
./scripts/demo.sh
lazyagent
# tear down: wt remove demo-one demo-two -D
```

## License

MIT (or whatever you'd like — not set yet).
