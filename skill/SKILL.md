---
name: delegate
description: Hand work to Mike's other AI subscriptions (Codex, Grok, Muse, his second Claude account) with the `delegate` CLI instead of built-in sub-agents, which bill the main Claude account, and run multi-lab `delegate consensus` panels. Use whenever you'd reach for a sub-agent or Workflow, want a code review or second opinion, need web research, codebase searches or routine implementation done in parallel, or when the user says delegate, hand off, consensus, ask the panel, or get other opinions.
---

# delegate

Built-in sub-agents (the Agent tool) and Workflows bill the account this session runs on. Mike runs out of his main Claude account before the weekly reset, while his other subscriptions sit idle. `delegate` runs a task headless on one of those instead, and only a short answer comes back into your context.

Check who's available and how much room each has with `delegate providers`. A hook also shows the budget at session start, and it blocks built-in sub-agents when the main account is low.

## Who to send what

| Job | First choice | Backup |
|---|---|---|
| Code review, second opinion on a diff | `codex` and `grok` in parallel | `muse` |
| Web research, current events, docs lookups | `grok` (`--kind research`) | `codex` |
| Finding things in a codebase, "how does X work" | `codex` | `grok` |
| Routine implementation (tests, refactors, mechanical edits) | `codex` (`--kind implement`) | `claude-gmail` |
| Needs Claude's judgement or writing | `claude-gmail` | none |
| A decision worth several opinions | `delegate consensus` | |

Pick the one with the most room when two fit. Never use `claude-gmail` as an automatic fallback for the main Claude account; choose it on purpose.

Convex work (any `get-convex` repo, or `~/dev/convex/convex-videos`) may only go to `claude-convex`, and `claude-convex` never gets anything else. delegate enforces this from the working directory. Don't get round it by pasting Convex code into a brief run from somewhere else.

## Running it

Always run it with Bash and `run_in_background: true`, so you can keep working and get notified when it finishes. Several can run at once.

```bash
delegate run --to codex --kind review --brief - <<'EOF'
Review the uncommitted changes in this repo (git diff HEAD) for correctness bugs.
Context: this adds rate limiting to the /api/upload route; see src/api/upload.ts.
Report findings most severe first with file:line and a concrete failing input.
EOF
```

- `--kind ask | review | research | implement`. Everything except `implement` is read-only.
- Read-only runs get a throwaway copy of the repo that includes the user's uncommitted and untracked changes. Your working tree is never touched, even when a CLI ignores its read-only flags (Grok and Muse do).
- `implement` (or `--write`) runs in its own worktree on a `delegate/<id>` branch and never commits. Review with `delegate diff <id>`, bring it in with `delegate apply <id>` (add `--3way` if it doesn't apply cleanly), then `delegate clean <id>`. Commit anything you want the delegate to build on first, or know that it gets your uncommitted changes as its starting point.
- `--no-repo` for pure questions that don't need the code. `--in-place` skips the snapshot for read-only work in huge repos, or in a folder that isn't a git repo.
- `--timeout 30m` (defaults: 20m read, 45m write). `--model` and `--effort` pass through.
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
- For implementation, read `delegate diff <id>` and run the tests yourself after applying.
- For research, spot-check the sources on anything load-bearing.
- If two reviewers disagree, look yourself rather than picking one.

## Consensus

`delegate consensus` sends one question to a panel from different labs. Each answers alone (position, reasons, strongest counter-argument, confidence), then a chair that didn't answer synthesises the anonymised answers into consensus, disagreements and the best minority point.

```bash
delegate consensus --no-repo "Should we store sessions in Redis or Postgres for <context>? ..."
delegate consensus --kind review "Is the retry logic in src/queue/worker.ts safe under concurrent workers?"
```

- Default: one provider per lab. The first available of `codex`, `claude-gmail`, `grok`, `muse` chairs and sits out the panel.
- `--deep` adds a second round where each panellist answers the strongest opposing argument. Use it for big, contested decisions only, since it doubles the time.
- `--devil` asks one panellist (labelled) to argue the other side.
- `--all` puts everyone on the panel with no chair, and you get the anonymised answers to weigh yourself.
- About 2 to 4 minutes in total. Phrase the question neutrally and don't hint at the answer you'd prefer. Agreement isn't proof, since they share training data: a test or the code beats a vote.

## When not to delegate

- The task needs this session's own tools: the browser, MCP connectors (Notion, Slack, Gmail), the desktop app. Use a built-in sub-agent with a description starting `local:`, which the hook always lets through.
- It's quicker to do yourself than to write the brief: a single grep, a one-line fix.
- It's Convex work and `claude-convex` isn't signed in.

## If something goes wrong

- `failed` or `empty`: read `~/.delegate/runs/<id>/stderr.log`. A login may have expired (`codex login`, `grok login`, Token Stats' Add account for Claude accounts).
- `timeout`: it was stopped, along with everything it started. Split the task or raise `--timeout`.
- The user can pause the hook for a while with `delegate hook pause 1h`.
