---
name: delegate
description: Hand work to Mike's other AI subscriptions (Codex, Grok, Muse, his other Claude accounts running Opus) with the `delegate` CLI instead of doing it in this session or with built-in sub-agents, both of which bill the main Claude account, and run multi-lab `delegate consensus` panels. Use whenever a job would pull a lot into this session (multi-file builds, codebase digging, long logs, reviews, research), whenever you'd reach for a sub-agent or Workflow, want a code review or second opinion, or when the user says delegate, hand off, consensus, ask the panel, or get other opinions.
---

# delegate

Everything this session does bills the Claude account it runs on, and so do built-in sub-agents (the Agent tool) and Workflows. In the desktop app that's Mike's main account, mike.cann@gmail.com, which he runs out of before the weekly reset while his other subscriptions sit idle. `delegate` runs a job headless on one of those instead, and only a short answer comes back into your context.

So act as the orchestrator. Plan, decide, write briefs, check what comes back and talk to Mike here. Hand the heavy lifting out: builds touching more than a couple of files, digging through a codebase, long logs, reviews, research. Handing off doesn't mean a weaker model: `--to claude` runs Opus on another of Mike's Claude accounts.

Check who's available and how much room each has with `delegate providers`. delegate works out which account this session runs on and never sends work there.

## Who to send what

| Job | First choice | Backup |
|---|---|---|
| Needs Claude's judgement or writing, or a build touching several files | `claude` (Opus on another Claude account) | `codex` |
| Routine implementation (tests, refactors, mechanical edits) | `codex` (`--kind implement`) | `claude` |
| Code review, second opinion on a diff | `codex` and `claude` in parallel | `grok`, `muse` |
| Web research, current events, docs lookups | `grok` (`--kind research`) | `codex` |
| Finding things in a codebase, "how does X work" | `codex` | `claude` |
| A decision worth several opinions | `delegate consensus` | |

`--to claude` picks whichever allowed Claude account (not this session's) has the most room: usually `claude-cannstudios`, and `claude-convex` in Convex folders. Pick the provider with the most room when two fit.

Convex work (any `get-convex` or `convex` org repo, or `~/dev/convex/convex-videos`) may only go to `claude-convex`, and `claude-convex` never gets anything else. delegate enforces this from the working directory. Don't get round it by pasting Convex code into a brief run from somewhere else.

## Running it

Always run it with Bash and `run_in_background: true`, so you can keep working and get notified when it finishes. Several can run at once.

```bash
delegate run --to claude --kind implement --brief - <<'EOF'
Add rate limiting to the /api/upload route (src/api/upload.ts) ...
EOF
```

- `--kind ask | review | research | implement`. Everything except `implement` is read-only.
- Read-only runs get a throwaway copy of the repo that includes the user's uncommitted and untracked changes. Your working tree is never touched, even when a CLI ignores its read-only flags (Grok and Muse do).
- `implement` (or `--write`) runs in its own worktree on a `delegate/<id>` branch and never commits. Review with `delegate diff <id>`, bring it in with `delegate apply <id>` (add `--3way` if it doesn't apply cleanly), then `delegate clean <id>`. Commit anything you want the delegate to build on first, or know that it gets your uncommitted changes as its starting point.
- Claude delegates use Opus. Pass `--model sonnet` for simple, high-volume jobs. `--effort` passes through to every CLI.
- `--no-repo` for pure questions that don't need the code. `--in-place` skips the snapshot for read-only work in huge repos, or in a folder that isn't a git repo.
- `--timeout 30m` (defaults: 20m read, 45m write).
- The answer comes back capped at 80 lines. `delegate show <id>` prints the full answer, and everything (prompt, raw logs, status.json) is under `~/.delegate/runs/<id>/`.

## Writing the brief

The delegate has none of this conversation. Write the brief as if for a capable contractor on their first day:

- What you want and why, in a sentence or two.
- Where to look: files, functions, the diff, URLs.
- What you already know or ruled out, so it doesn't redo your work.
- What good output looks like: the format, how long, what to leave out.

delegate already tells it that it's unattended, read-only or not, and not to sign off with questions, so you don't need to.

## Checking the result

A delegate's answer is a report, not proof. Before telling the user something is done or true:

- For reviews, check each finding against the code before passing it on. Drop the ones that don't hold up.
- For implementation, read `delegate diff <id>` and run the tests yourself after applying. Skim the core files rather than every line of tests and docs.
- For research, spot-check the sources on anything load-bearing.
- If two reviewers disagree, look yourself rather than picking one.

## Consensus

`delegate consensus` sends one question to a panel. Each answers alone (position, reasons, strongest counter-argument, confidence), then a chair that didn't answer synthesises the anonymised answers into consensus, disagreements and the best minority point.

```bash
delegate consensus --no-repo "Should we store sessions in Redis or Postgres for <context>? ..."
delegate consensus --wide --kind review "Is the retry logic in src/queue/worker.ts safe under concurrent workers?"
```

- Default: Codex, Grok and Muse answer, and Fable on another Claude account chairs.
- `--wide` puts every allowed provider on the panel plus both Fable and Opus, with a separate fresh chair. Mike is happy to try as many model combinations as possible, so use it for anything that matters.
- In Convex folders, where only `claude-convex` is allowed, the panel is Fable, Opus and Sonnet on that account, with a fresh Opus chair.
- `--deep` adds a second round where each panellist answers the strongest opposing argument. Use it for big, contested decisions, since it doubles the time.
- `--devil` asks one panellist (labelled) to argue the other side.
- `--all` puts everyone on the panel with no chair, and you get the anonymised answers to weigh yourself.
- About 2 to 4 minutes in total. Phrase the question neutrally and don't hint at the answer you'd prefer. Agreement isn't proof, since they share training data: a test or the code beats a vote.

## The hooks

At session start you get one line: which account this session runs on, its budget left against the share of the week left, and the other accounts' room.

- **On pace:** delegate the big chunks.
- **Behind pace:** every prompt gets a reminder. Delegate everything but quick edits.
- **Well behind** (15 points behind, or under 10% weekly or 15% of the 5-hour window): built-in sub-agents are blocked.

A sub-agent whose description starts with `local:` always gets through. The user can pause the hooks with `delegate hook pause 1h`.

## When not to delegate

- The task needs this session's own tools: the browser, MCP connectors (Notion, Slack, Gmail), the desktop app. Use a built-in sub-agent with a description starting `local:`.
- It's quicker to do yourself than to write the brief: a single grep, a one-line fix.
- It's Convex work and `claude-convex` isn't signed in.

Delegates can't delegate again: delegate refuses inside a delegated run.

## If something goes wrong

- `failed` or `empty`: read `~/.delegate/runs/<id>/stderr.log`. A login may have expired (`codex login`, `grok login`, Token Stats' Add account for Claude accounts, or `claude` then `/login` in a terminal for `claude-cannstudios`).
- `timeout`: it was stopped, along with everything it started. Split the task or raise `--timeout`.
- "that's the account this session runs on": you named this session's own account. Use `--to claude` or another provider.
