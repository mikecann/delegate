# delegate

Hand work from your main Claude Code session to your other AI subscriptions, and get a second (and third, and fourth) opinion on things

macOS

## What it is

I kept running out of tokens on my main Claude account a day or so before the weekly reset, which is annoying when I've also got Codex, Grok, Muse and a second Claude account sitting there with loads of room left. When I looked into where the tokens went, most of it was Claude Code's own sub-agents, and those always bill the account you're signed in with.

So delegate lets my main session hand a job to one of the other subscriptions instead. It runs that CLI headless, waits for it, and only gives a short answer back, so the main session doesn't fill up with someone else's transcript. Reviews go to Codex and Grok, research goes to Grok, routine changes go to Codex and so on.

There's also `delegate consensus`, which asks the same question to one agent from each lab (OpenAI, xAI, Meta, Anthropic) without them seeing each other's answers. Then one that didn't answer reads them all, with the names hidden, and writes up where they agree, where they don't, and the best point only one of them made. It's become my go-to for "hmm, which way should we do this" questions.

A Claude Code hook keeps it honest. At the start of each session it tells Claude how much room each account has. Whenever Claude reaches for a built-in sub-agent it gets a reminder, and if my main account is below 40% of its weekly limit it gets blocked and told to use delegate instead.

Some things it's careful about:

- **Your working tree is safe.** Read-only jobs run in a throwaway copy of the repo that includes your uncommitted changes. I found Grok and Muse would still write files when asked to stay read-only, so I don't rely on their flags.
- **Changes come back as a patch.** Write jobs get their own worktree and branch, never commit, and you look at the diff before applying it.
- **Runaway jobs get stopped.** Every job has a timeout, and on timeout everything it started gets killed.
- **Work code stays with the work account.** Anything in my employer's repos (Convex) only goes to my Convex Claude account, and that account never gets anything else. Change `employer` in the config to suit you.

It reads plan limits from [Token Stats](https://github.com/mikecann/token-stats), my menu bar app that tracks all my AI subscriptions. It works without it too, it just can't tell you how much room each account has.

## Get it

Paste this into your AI coding agent (Claude Code, Codex, Cursor...):

> Clone https://github.com/mikecann/delegate and make it my own. It's one of Mike
> Cann's personal tools, so read the README first, change anything specific to his
> setup to suit mine (especially config.example.json), then help me get it running.

### Or set it up by hand

You'll need [Bun](https://bun.sh), Git, and whichever of these CLIs you have, signed in: [Codex](https://github.com/openai/codex) (`codex login`), Grok Build (`grok login`), Muse Code (`muse login`), and [Claude Code](https://claude.com/claude-code). Extra Claude accounts are matched by email to a `CLAUDE_CONFIG_DIR` under Token Stats' Accounts folder, so add them there with **Add account**.

```bash
git clone https://github.com/mikecann/delegate.git
cd delegate
bash install.sh
```

This runs `bun install`, links `delegate` into `~/.local/bin`, links the skill into `~/.claude/skills` and `~/.codex/skills` (Grok reads Claude's), writes `~/.config/delegate/config.json` if you don't have one, and adds two hooks to `~/.claude/settings.json` (backing it up first). Pass `--no-hooks` to skip the hooks. Then edit the config: the Claude account emails, your employer's repos, and the hook thresholds.

Re-run `install.sh` if you move the clone. `bash uninstall.sh` takes it all back out.

## Using it

Mostly Claude runs it for me, but you can run it yourself too:

```bash
delegate providers                       # who's ready here, and how much room each has
delegate run --to codex --kind review "Review the uncommitted changes for bugs"
delegate run --to grok --kind research --brief notes.md
delegate run --to codex --kind implement --brief - < task.md
delegate consensus --no-repo "Redis or Postgres for sessions, given ...?"
```

- `--kind` is `ask`, `review`, `research` or `implement`. Only `implement` (or `--write`) can change files.
- After an implement job: `delegate diff <id>` to look, `delegate apply <id>` to bring it into your repo, `delegate clean <id>` to remove its worktree and branch.
- `delegate show <id>` prints the full answer. Everything else (the prompt, raw logs, status) is in `~/.delegate/runs/<id>/`.
- `--no-repo` for questions that don't need the code, `--in-place` to skip the snapshot in a huge repo, `--timeout 30m`, `--model`, `--effort`.
- For consensus: `--deep` adds a second round where each one answers the strongest argument against them, `--devil` gets one to argue the other side, `--all` puts everyone on the panel and skips the chair.
- `delegate hook pause 1h` turns the hook off for a bit, `delegate hook resume` turns it back on.

The skill in `skill/SKILL.md` is what tells Claude which account suits which job and how to write a brief that makes sense without the conversation.

## How it works

| Piece | Detail |
|---|---|
| Providers | `codex exec`, `grok --prompt-file`, `muse exec` and `claude -p` with `CLAUDE_CONFIG_DIR`, each with its own flags for headless runs. Every brief starts with a note saying it's running unattended for another agent, because otherwise they happily answer as if you're there. |
| Read-only jobs | `git worktree add --detach` at HEAD, your uncommitted diff and untracked files copied in and committed as a baseline. Anything the delegate changes is reported and thrown away with the worktree. |
| Write jobs | Same, on a `delegate/<id>` branch. Codex, Grok and Muse run in their write sandboxes (which block your home folder but allow `/tmp`). Claude gets edits plus an allow list of build and test commands. |
| Processes | Each job runs in its own process group with output going straight to files. On timeout the group gets SIGTERM, then SIGKILL. |
| Limits | Token Stats' `limits.json`, or `token-stats limits --json`, cached in `~/.delegate/limits-cache.json`. The hooks only read files so they stay fast. |
| Hooks | `SessionStart` adds one line of budget. `PreToolUse` on `Agent`, `Task` and `Workflow` adds a reminder, or blocks below the thresholds. A sub-agent whose description starts with `local:` always gets through, for jobs that need the session's own tools like the browser. |
| Consensus | Panellists answer in parallel to a fixed format. The answers are shuffled and lettered before the chair sees them, and `key.json` says who was who. |

## Tests

```bash
bun install
bun test
bun run typecheck
```

The integration tests use fake providers and throwaway Git repos, so they don't spend any tokens.

## More tools

You can find my other tools at [mikerosoft.app](https://mikerosoft.app).

MIT licensed.
