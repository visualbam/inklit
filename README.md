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
| `[`      | jump to first task                                         |
| `]`      | jump to last task                                          |
| `J`      | scroll inspector down 1 line                               |
| `K`      | scroll inspector up 1 line                                 |
| `Ctrl-D` | scroll inspector down half-page                            |
| `Ctrl-U` | scroll inspector up half-page                              |
| `gg`     | jump inspector to top                                      |
| `G`      | jump inspector to bottom (re-anchors agent transcript to live tail) |
| `n`      | new task — prompts for description, then agent (`c`/`x`)  |
| `enter`  | running/waiting → focus pane; ready → resume agent         |
| `q` / `Ctrl-C` | quit                                                 |
| `m`      | review-then-merge — switches inspector to diff and asks y/n |
| `X`      | kill selected task — close pane + remove worktree (with y/n confirm) |
| `f`      | inspector → files (uncommitted, with `+/-` line counts)    |
| `d`      | inspector → diff vs main                                   |
| `l`      | inspector → log of commits ahead of main                   |
| `a`      | inspector → live agent transcript tail                     |
| `/`      | filter list *(stub — phase 2)*                             |
| `?`      | help overlay *(stub — phase 2)*                            |
| `r`      | force refresh *(stub — phase 2)*                           |

### Status icons

| Icon | State    | Meaning                                                  |
| ---- | -------- | -------------------------------------------------------- |
| ●    | running  | a zellij pane named after the slug is alive              |
| ✓    | ready    | worktree exists, no live pane                            |
| ⊙    | waiting  | running pane whose tail looks like a `(y/n)`/`?`/`❯` prompt |
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

### Resume

Closing an agent's zellij pane (or letting it exit) leaves the task in
`✓ ready`. Press `enter` on a `ready` task and lazyagent will spawn a fresh
pane in the existing worktree, running the agent's resume incantation:

- **claude** → `claude --continue` (most recent session in cwd)
- **codex** → `codex resume --last`

The agent picks up its previous conversation; the worktree is unchanged so
any uncommitted work is still there. The status bar verb on `enter` flips
between `focus` (live pane) and `resume` (no pane) so you know which it'll do.

The agent kind is recorded at spawn time in
`$XDG_STATE_HOME/lazyagent/tasks.json` (default `~/.local/state/...`). Tasks
created before lazyagent existed — or via `wt switch` directly — won't have
an entry, so resume opens the agent picker and remembers your choice for
next time. `X` (kill) drops the entry so a future task with the same slug
starts clean.

### Inspector modes

The bottom half of the screen is the inspector. Toggle with `f`/`d`/`l`/`a`:

- **`f` files** — `git status --short --untracked-files=all` parsed into a
  list, each entry colored by status (untracked / modified / added / deleted)
  with `+N -M` line counts from `git diff --numstat HEAD`. Untracked folders
  expand to individual files so brand-new content is never invisible.
- **`d` diff** — unified diff combining `<branch>...main` (committed work) +
  `git diff HEAD` (uncommitted modifications) + per-untracked-file
  `git diff --no-index /dev/null <file>` so brand-new files render in unified
  format. Capped at ~200KB.
- **`l` log** — `git log --oneline --decorate main..HEAD`.
- **`a` agent** — last 200 lines of the agent's zellij pane via
  `zellij action dump-screen -p <pane_id>`. Updates every 1.5s.

The diff and files views also drive the new merge flow: pressing `m` jumps
the inspector to **diff** mode automatically and shows a confirm bar at the
bottom. You see exactly what you're about to merge before pressing `y`.

### Destructive actions

`m` runs `wt -C <worktree> merge main -y` (squash + auto-remove on success).
`X` focuses the pane → `zellij action close-pane` → `wt remove <slug> -y -f -D`
(force the worktree gone even with uncommitted changes; force-delete the
branch even if unmerged). Both prompt for `y`/`n` first; `esc` cancels. `m`
forces the inspector to diff view first; `X` does the same so you can see
what you'd be throwing away.

## Limitations & TODOs (phase 2)

- [ ] `failed` state detection (track pane exit codes in
      `$XDG_STATE_HOME/lazyagent/exits.json`).
- [ ] `merged` fade-out (~30s after `m`).
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
