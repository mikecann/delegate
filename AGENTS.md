# Agent guidance

This repo is delegate, a Bun and TypeScript CLI that hands work from a main
Claude Code session to other AI coding CLIs (Codex, Grok, Muse, other Claude
accounts) and runs multi-lab consensus panels. It also installs Claude Code
hooks and a skill.

## Development rules

- Write or update the test first for non-trivial changes, then implement.
- Run `bun test` and `bun run typecheck` before committing.
- Tests must never call a real AI CLI or spend tokens. Use `fakeProvider` from
  `test-helpers.ts` and throwaway repos from `tempRepo()`.
- Never touch the caller's working tree from a read-only run. Read-only work
  runs in a snapshot worktree unless `--in-place` is passed.
- Write runs never commit or push for the user, and must leave the patch for
  the orchestrator to review (`delegate diff` / `apply`).
- Hooks must be fast and must never break a session: read files only, no
  network, and swallow errors (no output means "no opinion").
- The employer policy in `policy.ts` is the guard that keeps work code with the
  work account. Don't add a bypass flag.
- When you change a provider's flags, smoke-test that provider live from a
  disposable repo, in both read and write mode, and check its sandbox claims
  (CLIs' read-only flags have turned out not to be reliable).
- Keep what goes back to the orchestrator short. Full output belongs in the run
  folder, not on stdout.

## Writing

README and PR text are written in Mike's voice. Read the mike-voice skill
before writing them. `skill/SKILL.md` is instructions for agents: plain and
direct.
