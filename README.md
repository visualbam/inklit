# inklit

A terminal dashboard for managing parallel AI coding agents (Claude Code, Codex
CLI) that each run in their own git worktree. inklit runs as a TUI inside a
Zellij pane; agents run headlessly in tmux sessions in the background. Pressing
`enter` on a task opens a Zellij floating pane that attaches to the agent's
tmux session — think "Replit-style task list, scoped to git worktrees."

It is a thin presentation layer over [worktrunk](https://worktrunk.dev) (the
`wt` CLI). Worktrunk handles all worktree/branch operations. inklit handles
the dashboard view, Zellij integration, and tmux-based agent execution.

In Replit terms, the local repo checkout is the **main version**. Agent tasks
run in isolated worktrees and `m` applies a reviewed task back into that main
version.

## Status

v0. The polling loop, list view, new-task spawn, and pane focus all work. A
bunch of features are intentionally stubbed — see the TODO list below.

## Prerequisites

| Tool        | Tested version |
| ----------- | -------------- |
| Node.js     | 25.9.0         |
| `wt`        | 0.48.0         |
| `zellij`    | 0.44.2         |
| `tmux`      | any            |
| `claude` or `codex` CLI | any (the agent CLI you spawn) |

You can run inklit outside zellij — the list will render read-only. Spawning
new tasks and focusing panes both require an active zellij session.

AI-generated follow-up suggestions and goal decomposition default to
`codex exec --model gpt-5.4-mini`, using your local Codex subscription auth
rather than an OpenAI API key. Set `INKLIT_CODEX_MODEL=<model>` to change the
Codex model, or `INKLIT_AI_PROVIDER=claude` to use the Claude CLI provider.

## Install

```bash
git clone <this-repo>
cd inklit
npm install
npm run build
npm link        # exposes `inklit` on your PATH
```

Or run from source without installing globally:

```bash
npm run dev
```

## Usage

Open a zellij session, drop into a git repo, and:

```bash
inklit
```

Use a different review/apply target with `--main` (also used as the default
base for new dashboard-spawned tasks):

```bash
inklit --main develop
```

### Headless spawn

Outside agents can create inklit tasks without driving the TUI:

```bash
inklit spawn --agent codex --branch H2040-api-validation --base develop -- \
  "Fix API validation for H2040"
```

For several tasks that share a ticket prefix, use `--branch-prefix` and
`--count`; each task gets a unique branch/worktree name:

```bash
inklit spawn --agent codex --branch-prefix H2040-jira-ticket-desc --count 3 -- \
  "Work H2040 item {{index}}/{{count}} on {{branch}}"
```

That creates `H2040-jira-ticket-desc-1`, `H2040-jira-ticket-desc-2`, and
`H2040-jira-ticket-desc-3`.

For richer orchestration, pass a JSON task list:

```bash
inklit spawn --file tasks.json --format json
```

```json
[
  {
    "branch": "H2040-api-validation",
    "agent": "codex",
    "base": "develop",
    "prompt": "Fix API validation for H2040"
  },
  {
    "branch": "H2040-ui-error-state",
    "agent": "claude",
    "base": "develop",
    "prompt": "Add the H2040 UI error state"
  }
]
```

Use `--cwd <repo>` when the calling process is outside the target checkout.
Headless and dashboard-spawned agents both use no-prompt permission modes so
the pane keeps moving instead of waiting for approval: Claude gets
`--permission-mode bypassPermissions`, and Codex gets `--ask-for-approval never`.

### Keybinds

Movement is Vim/Helix-flavored.

| Key      | Action                                                     |
| -------- | ---------------------------------------------------------- |
| `j` / ↓  | next task                                                  |
| `k` / ↑  | previous task                                              |
| `[`      | jump to first task                                         |
| `]`      | jump to last task                                          |
| `:`      | open the command palette for task/view actions             |
| `J`      | scroll inspector down 1 line                               |
| `K`      | scroll inspector up 1 line                                 |
| `Ctrl-D` | scroll inspector down half-page                            |
| `Ctrl-U` | scroll inspector up half-page                              |
| `gg`     | jump inspector to top                                      |
| `G`      | jump inspector to bottom (re-anchors agent transcript to live tail) |
| `v`      | toggle detailed table / compact task-card board            |
| `z`      | show or hide archived tasks                                |
| `n`      | new task — prompts for description, then agent (`c`/`x`)  |
| `T` / `1` | start the top suggested next task for the selected task  |
| `2`      | start the second suggested next task when shown            |
| `enter`  | running/waiting → open a Zellij float attached to the agent's tmux session; ready → resume agent in a new tmux session |
| `i`      | send a one-line message into the selected agent's pane (Enter sends + presses return; esc cancels) |
| `q` / `Ctrl-C` | exit the dashboard only; live agents keep running in zellij |
| `Q`      | close all live agent panes after confirmation; worktrees survive |
| `m`      | apply selected task to the target branch — switches inspector to diff and asks y/n, then merges in background |
| `A`      | archive/restore a ready, failed, or recently applied task without deleting the worktree |
| `X`      | kill selected task — close pane + remove worktree (with y/n confirm) |
| `t`      | inspector → task view (status, next action, checkpoint)      |
| `f`      | inspector → files changed vs target branch                 |
| `d`      | inspector → final patch vs target branch                   |
| `l`      | inspector → log of commits ahead of target branch          |
| `a`      | inspector → live agent transcript tail                     |
| `?`      | help overlay (toggle — `?` / esc / q to close)             |
| `/`      | filter task list by slug, subject, lifecycle, pane state, or path |
| `r`      | force refresh task board and visible inspector caches       |
| `esc`    | cancel the selected background merge, when one is running   |

### Task Lifecycle

The top line shows the **main version**: branch, short SHA, clean/dirty state,
the current review/apply target when it differs, and the checkout path that
receives applied task work. The task list shows two separate concepts:

- **stage** is the Replit-style task lifecycle: `active` while an agent pane is
  live, `ready` when work is available for review without a live pane,
  `applying` while a background merge is running, `failed` when an apply
  operation needs attention, and `done` for recently applied work.
- **pane** is the local zellij/process state: `running`, `waiting`, `idle`,
  `no pane`, or `merging` for a background apply job.
- **review** is a readable readiness summary. The underlying counts are changed
  files, commits ahead, and untracked files, rendered as badges such as
  `3 files`, `2 commits`, and `1 untracked`.
- **suggested next tasks** appear in the task inspector for `ready` rows. Press
  `T`/`1` or `2` to launch one through the normal agent picker. Recently
  applied `done` rows can show AI-generated follow-up suggestions based on the
  captured merge diff.

The board is grouped by urgency (`Waiting`, `Running`, `Idle`, `Merging`,
`Ready`, `Failed`, `Done`, then archived rows when visible). Press `v` to
switch between the detailed table and compact two-line task cards; inklit
remembers that layout across restarts. When the board outgrows the pane, it
keeps the selected task inside the visible window and shows hidden-task markers
above or below instead of letting the inspector cover task rows.

### Pane Icons

| Icon | Pane     | Meaning                                                  |
| ---- | -------- | -------------------------------------------------------- |
| ●    | running  | a tmux session named after the slug is alive             |
| ◐    | idle     | running tmux session whose output hasn't changed for ≥30s — labelled `idle 1m` etc. |
| ✓    | no pane  | worktree exists, no live tmux session; `enter` resumes   |
| ↻    | merging  | background apply job is merging into the target branch   |
| ⊙    | waiting  | running tmux session whose tail looks like a `(y/n)`/`?`/`❯` prompt |
| ✗    | failed   | apply failed or the task is otherwise marked failed; task view shows details |
| ·    | applied  | task was applied and remains visible briefly before fade-out |

Tasks are sorted by urgency: `waiting`, `running`, `idle`, `merging`, `ready`,
`failed`, recently applied `done` rows, then archived/cancelled rows when
visible.

### Notifications

When a task transitions into `⊙ waiting` (the agent is asking you something),
`ready` (available for review), or `failed`, inklit fires a macOS
Notification Center popup so you can stay focused in your editor and only come
back when there's something to answer or review. Best-effort and silent on
Linux/Windows for now.

## Architecture

Single binary, no daemon. State lives in git + worktrunk; inklit does not
duplicate it. The TUI polls `wt list --format json`, `zellij action list-panes
--json`, and `tmux -L inklit ls` for cheap project status, then captures tmux
pane output on a separate throttled loop so active agents do not stall input.
Compact review stats are sampled on a separate background loop too, so file
counts do not block list navigation.

```
src/
  index.tsx        entry, --version/--help/spawn, mounts <App>
  cli.ts           headless spawn command + global --main parsing
  model.ts         Task, AppState, action types
  wt.ts            wrapper over `wt list` (JSON) + git review helpers
  zellij.ts        list-panes, open-float, focus-pane-id
  tmux.ts          tmux session lifecycle — spawn, capture, status polling
  agent.ts         spawn helper — composes one tmux+wt invocation
  ui/
    App.tsx        reducer, poll loop, key dispatch
    List.tsx       task list rendering
    MainVersionBar.tsx top chrome with main version + task counts
    Inspector.tsx  Replit-style task/files/diff/log/agent inspector
    StatusBar.tsx  bottom hint bar
    NewTaskPrompt.tsx  description prompt + agent picker
    FilterPrompt.tsx task board filter prompt
    CommandPalette.tsx task/view action menu
    HelpOverlay.tsx keybind reference
    followUps.ts    deterministic pre-apply suggested next tasks
    review.tsx     review-readiness badge helpers
    theme.ts       terminal-safe ANSI color tokens
    icons.ts       state → icon/color/label
```

### New-task flow

When you press `n`:

1. Prompt for a description (Ink TextInput).
2. Pick `c` (claude) or `x` (codex).
3. We slugify the description and run:
   ```
   tmux -L inklit new-session -d -s <slug> -- \
     wt switch -c <slug> -x <agent> -- <agent-permission-flags> "<description>"
   ```
   That creates the worktree (worktrunk) and launches the agent headlessly
   inside a detached tmux session on the `inklit` server. The next status poll
   picks it up and shows it as `running`. Press `enter` to open a Zellij
   floating pane that attaches to the session.

Inklit adds the agent-specific no-prompt permission flags automatically:
`claude --permission-mode bypassPermissions ...` and
`codex --ask-for-approval never ...`. The permission status still exists for
older panes, externally spawned tasks, or agent versions that surface a prompt
despite those flags.

If the dashboard was launched with `inklit --main <branch>`, new dashboard
tasks pass that branch through as `wt switch --base <branch>`.

### Resume

Closing an agent's zellij pane (or letting it exit) leaves the task in
`✓ ready`. Press `enter` on a `ready` task and inklit will spawn a fresh tmux session
in the existing worktree, running the agent's resume incantation:

- **claude** → `claude --permission-mode bypassPermissions --continue`
- **codex** → `codex --ask-for-approval never resume --last`

The agent picks up its previous conversation; the worktree is unchanged so
any uncommitted work is still there. The status bar verb on `enter` flips
between `view` (live tmux session) and `resume` (no session) so you know which it'll do.

The agent kind is recorded at spawn time in
`$XDG_STATE_HOME/inklit/tasks.json` (default `~/.local/state/...`). Tasks
created before inklit existed — or via `wt switch` directly — won't have
an entry, so resume opens the agent picker and remembers your choice for
next time. The same file stores lifecycle overrides for archived rows, recently
applied rows, and UI preferences like detailed/compact board layout, so those
choices survive restarting the TUI. `X` (kill) drops the entry so a future task
with the same slug starts clean.

### Inspector modes

The bottom half of the screen is the inspector. Toggle with `t`/`f`/`d`/`l`/`a`:

- **`t` task** — Replit-style task view: lifecycle, pane state, next action,
  checkpoint, dirty status, review badges, a task timeline, suggested next
  tasks, and pointers to review/thread controls.
- **`f` files** — `git diff --name-status --find-renames <merge-base>` parsed
  into a list of all tracked task changes vs the target branch, plus untracked
  files from `git ls-files --others --exclude-standard`. Rows include best-effort
  `+N -M` counts from `git diff --numstat`.
- **`d` diff** — unified final patch from `git diff --find-renames <merge-base>`
  plus per-untracked-file `git diff --no-index /dev/null <file>` so brand-new
  files render in unified format. Capped at ~200KB.
- **`l` log** — `git log --oneline --decorate <target>..HEAD`.
- **`a` agent** — last 200 lines of the agent's output via
  `tmux -L inklit capture-pane -t <slug>`. The selected session updates about
  once per second; background sessions are scanned more slowly for waiting/idle
  detection.

The diff and files views also drive the apply flow: pressing `m` jumps
the inspector to **diff** mode automatically and shows a confirm bar at the
bottom. You see exactly what you're about to apply before pressing `y`; after
confirmation the merge runs in the background and the row changes to
`applying` / `merging`.

### Destructive actions

`m` runs `wt -C <worktree> merge <target> -y` in the background to apply the
task into the target branch (squash + auto-remove on success). The default
target is `main`; override it with `inklit --main <branch>` or
`INKLIT_MAIN_BRANCH=<branch>`. Merge conflicts are handled by the existing
Claude/Codex resolver path when possible. If apply still fails, the task stays
on the board as `failed`; open the task inspector to read the stored failure
details, then press `m` to retry or `X` to discard.
`X` focuses the pane → `zellij action close-pane` → `wt remove <slug> -y -f -D`
(force the worktree gone even with uncommitted changes; force-delete the
branch even if unapplied). Both prompt for `y`/`n` first; `esc` cancels. `m`
forces the inspector to diff view first; `X` does the same so you can see
what you'd be throwing away.

`Q` closes live agent panes but does not remove worktrees or task records. Use
it when you intentionally want to stop local agent processes; plain `q` keeps
them running in the background like Replit tasks.

`A` archives a selected ready, failed, or recently applied task. Archive is a
dashboard lifecycle marker only: it hides the row by default, but it does not
close panes, delete worktrees, or change branches. Press `z` to show archived
rows and press `A` again to restore one.

## Limitations & TODOs (phase 2)

- [ ] agent-pane `failed` state detection (track pane exit codes in
      `$XDG_STATE_HOME/inklit/exits.json`).
- [ ] Add a Replit-style contextual composer: keep `n` for manual task creation,
      keep power-user shortcuts, and add a single opt-in input (likely `space`)
      that can switch between new task, message selected agent, and suggested
      follow-up without making the board an always-active chat box.
- [ ] Validate behavior when `wt` schema changes; the parser is permissive but
      untyped fields could regress silently.

## Demo

`scripts/demo.sh` creates two dummy worktrees in the current git repo so
inklit has something to render on first launch:

```bash
./scripts/demo.sh
inklit
# tear down: wt remove demo-one demo-two -D
```

## License

MIT (or whatever you'd like — not set yet).
