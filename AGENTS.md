# Agent guidance

This repo is delegate, a skill that tells a main Claude Code session how to hand work to Mike's other AI subscriptions by calling their CLIs directly (`codex`, `claude`, `grok`, `muse`), and how to run multi-lab consensus panels by hand. There's no code: just the skill in `skill/`, and `install.sh` / `uninstall.sh`, which link it into `~/.claude/skills` and `~/.codex/skills`.

It used to be a Bun CLI with hooks. That code lives only in git history now. Don't bring it back.

## Rules

- Every command line in the skill must have been run live before it goes in. Note the CLI version it was checked with in `skill/reference/commands.md`, and update that header when you re-check.
- When you change a CLI's flags, check its sandbox claims live from a disposable repo, in read and write mode. CLIs' read-only flags have turned out not to be reliable.
- Shell snippets that don't call an AI CLI (snapshots, worktrees, diff, apply, the Convex check) get tested in a throwaway git repo under `$TMPDIR`, including uncommitted and untracked changes.
- Never point a real AI CLI at the user's working tree from a read-only job. Use a snapshot worktree, except Codex with `-s read-only`.
- Write jobs never commit or push. The orchestrator reviews the patch and applies it.
- Keep the Convex rule intact: Convex work only goes to the Convex Claude account, and that account gets nothing else. Never route anything to mike.cann@gmail.com.
- Test `install.sh` and `uninstall.sh` with `HOME` pointed at a temp folder, never your real one.

## Writing

- `skill/SKILL.md` and `skill/reference/` are instructions for agents: plain and direct. Keep SKILL.md readable and put long command lists in the references.
- README and PR text are written in Mike's voice. Read the mike-voice skill before writing them.
