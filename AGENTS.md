# Agent guidance

This repo is delegate, a skill that tells a main AI session running in T3 Code how to hand work to Mike's other AI subscriptions through T3's `delegate_task` tool, and how to run multi-lab consensus panels. There's no code: just the skill in `skill/`, and `install.sh` / `uninstall.sh`, which link it into `~/.claude/skills` and `~/.codex/skills`.

It used to be a Bun CLI with hooks, and then a skill that called the `codex`, `claude`, `grok` and `muse` CLIs directly. Both live only in git history now. Mike uses T3 only, so don't bring back a CLI path.

## Rules

- Git snippets in the skill (starting state, worktrees, diff, apply, cleanup, the Convex check) get tested in a throwaway git repo under `$TMPDIR` before they go in, including uncommitted, untracked and binary changes. Point `HOME` at a temp folder so nothing lands in the real `~/.delegate` or `~/.t3`.
- Claims about how T3 behaves (`delegate_task`, isolation, runtime modes, provider IDs, model options) must have been checked live by an orchestrator session in T3 before they go in, with the date noted in the skill. A child can't call `delegate_task`, so anything only read from T3's docs or source gets marked "check the first time".
- Never let a child work in Mike's real tree for a read-only job that needs the code. It gets a worktree.
- Write jobs never commit or push. The orchestrator reviews the patch and applies it.
- Keep the Convex rule intact: Convex work only goes to the Convex Claude account (`claudeConvex`), and that account gets nothing else.
- Test `install.sh` and `uninstall.sh` with `HOME` pointed at a temp folder, never your real one.

## Writing

- `skill/SKILL.md` and `skill/reference/` are instructions for agents: plain and direct. Keep SKILL.md as short as it can be while staying unambiguous, and put long recipes in the references.
- README and PR text are written in Mike's voice. Read the mike-voice skill before writing them.
