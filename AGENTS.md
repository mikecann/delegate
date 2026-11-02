# Agent guidance

This repo is delegate, a skill that tells a main AI session running in Threadbear how to get answers from other AI labs and models, through the `claude`, `codex`, `grok` and `muse` CLIs or Threadbear's `create_thread`, and how to run multi-lab consensus panels. It's mostly instructions: the skill in `skill/`, one small sourced helper (`skill/reference/seats.zsh`) that holds the CLI flags, and `install.sh` / `uninstall.sh`, which link the skill into `~/.claude/skills` and `~/.codex/skills`.

It used to be a Bun CLI with hooks, and then ran through T3 Code's `delegate_task`. Both live only in git history now. Mike uses Threadbear now and T3's tools don't exist there, so don't bring them back. Keep the helper small too: it isn't the start of another CLI.

## Rules

- The skill is opt-in. Mike picks the account when he starts a thread, so a thread does its own work there and only delegates when he asks. Don't bring back proactive delegation (the orchestrator pattern) without him asking.
- Finding room on a Claude or Codex login is Threadbear's job, through pools. Mike had the account tables and picking rules cut on 2 Nov 2026, so don't grow them back: this skill is for other labs, panels and read-only jobs.
- Git snippets in the skill (starting state, worktrees, diff, apply, cleanup, the Convex check) get tested in a throwaway git repo under `$TMPDIR` before they go in, including uncommitted, untracked and binary changes. Point `HOME` at a temp folder if a snippet writes under it, so nothing lands in the real `~/.delegate`.
- Any change to the flags in `seats.zsh` gets tested by asking the model to write a file, run a shell command and call a connector, then checking the folder. Several flags that look like locks aren't: `--allowedTools` on Claude, plan mode on Grok, `-s read-only` for Codex's connectors. Grok's `--tools` fails open on a name it doesn't know.
- Claims about how Threadbear behaves (`create_thread`, pools, wake-ups) must have been checked live from a thread before they go in, with the date noted in the skill. Anything only read from its docs gets marked as such.
- Never let a child work in Mike's real tree for a read-only job that needs the code. It gets a worktree.
- Write jobs never commit or push. The orchestrator reviews the patch and applies it.
- Keep the Convex rule intact: Convex work only goes to the Convex Claude account (`claude-2`), and that account gets nothing else. The only exception is the one in SKILL.md, where Mike explicitly asks for other labs on that job. Don't widen it without him asking.
- Test `install.sh` and `uninstall.sh` with `HOME` pointed at a temp folder, never your real one.

## Writing

- `skill/SKILL.md` and `skill/reference/` are instructions for agents: plain and direct. Keep SKILL.md as short as it can be while staying unambiguous, and put long recipes in the references.
- README and PR text are written in Mike's voice. Read the mike-voice skill before writing them.
