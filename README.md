# delegate

Hand work from your main Claude Code session to your other AI subscriptions, and get a second (and third, and fourth) opinion on things

macOS

## What it is

I kept running out of tokens on my main Claude account a day or so before the weekly reset, which is annoying when I've also got Codex, Grok, Muse and other Claude accounts sitting there with loads of room left. When I looked into where the tokens went, most of it was Claude Code's own sub-agents, and those always bill the account you're signed in with.

So delegate lets my main session hand a job to one of the other subscriptions instead. It runs that CLI headless, waits for it, and only gives a short answer back, so the main session doesn't fill up with someone else's transcript. Reviews go to Codex and Grok, research goes to Grok, routine changes go to Codex and so on.

There's also `delegate consensus`, which asks the same question to one agent from each lab (OpenAI, xAI, Meta, Anthropic) without them seeing each other's answers. Then one that didn't answer reads them all, with the names hidden, and writes up where they agree, where they don't, and the best point only one of them made. It's become my go-to for "hmm, which way should we do this" questions.

Claude Code hooks keep it honest. At the start of each session they say which account the session bills and how much room each account has. They compare the weekly budget left with the time until reset, so 43% left with 38% of the week to go is fine. If I'm falling behind, each prompt gets a reminder to delegate everything but quick edits. Well behind, built-in sub-agents get blocked.

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

You'll need [Bun](https://bun.sh), Git, and whichever of these CLIs you have, signed in: [Codex](https://github.com/openai/codex) (`codex login`), Grok Build (`grok login`), Muse Code (`muse login`), and [Claude Code](https://claude.com/claude-code). Claude accounts are matched by email to their live login directories in Token Stats' limits data, with its Accounts folder as a fallback. The defaults are `claude-gmail` (mike.cann@gmail.com), `claude-cannstudios` (mike@cannstudios.com) and the work-only `claude-convex` (mike.cann@convex.dev). Add extra logins in Token Stats with **Add account**. The default terminal login in `~/.claude` works too.

```bash
git clone https://github.com/mikecann/delegate.git
cd delegate
bash install.sh
```

This runs `bun install`, links `delegate` into `~/.local/bin`, links the skill into `~/.claude/skills` and `~/.codex/skills` (Grok reads Claude's), writes `~/.config/delegate/config.json` if you don't have one, and adds three hooks to `~/.claude/settings.json` (backing it up first). Pass `--no-hooks` to skip the hooks. Then edit the config: the Claude account emails, your employer's repos, and the hook thresholds.

Re-run `install.sh` if you move the clone. `bash uninstall.sh` takes it all back out.

## Using it

Mostly Claude runs it for me, but you can run it yourself too:

```bash
delegate providers                       # who's ready here, and how much room each has
delegate run --to codex --kind review "Review the uncommitted changes for bugs"
delegate run --to claude --kind implement --brief task.md
delegate run --to grok --kind research --brief notes.md
delegate run --to codex --kind implement --brief - < task.md
delegate consensus --no-repo "Redis or Postgres for sessions, given ...?"
```

- `--to claude` picks the allowed Claude account with the most headroom, measured by its tightest 5-hour or weekly window. It skips this session's account and accounts below 10%. Unknown limits are a last choice. In a Convex repo that means `claude-convex`; elsewhere, while I'm on Gmail, it's usually `claude-cannstudios`. Concrete provider ids still work.
- Claude delegates use Opus unless you pass `--model`. Consensus uses Fable (`claude-fable-5-1`), with extra model seats as described below. Delegated Claude runs use `--strict-mcp-config`, so they don't start my global MCP servers.
- `--kind` is `ask`, `review`, `research` or `implement`. Only `implement` (or `--write`) can change files.
- After an implement job: `delegate diff <id>` to look, `delegate apply <id>` to bring it into your repo, `delegate clean <id>` to remove its worktree and branch. `apply` only changes anything if the patch applies cleanly. Add `--3way` to merge it anyway, which can leave conflict markers.
- `delegate show <id>` prints the full answer. Everything else (the prompt, raw logs, status) is in `~/.delegate/runs/<id>/`.
- `--no-repo` for questions that don't need the code, `--in-place` to skip the snapshot in a huge repo, `--timeout 30m`, `--model`, `--effort`.
- For consensus: `--deep` adds a second round where each one answers the strongest argument against them, `--devil` gets one to argue the other side, `--all` puts every allowed provider on the panel and skips the chair.
- `--wide` puts every allowed provider on the panel and gives the chosen Claude account both a Fable and an Opus seat. A separate fresh call chairs it, even if that account also answered. Combine it with `--deep` and `--devil`, or `--all` to skip the chair. The output lists who sat, including the Claude model seats.
- With fewer than two labs available, as in a Convex repo, consensus uses Fable, Opus and Sonnet on the allowed Claude account, then a separate fresh Opus call as chair. `--all` skips the chair here too; `--wide` uses its two Claude seats instead. The chair gets anonymised answers in every mode.
- `delegate hook pause 1h` turns the hook off for a bit, `delegate hook resume` turns it back on.

The skill in `skill/SKILL.md` is what tells Claude which account suits which job and how to write a brief that makes sense without the conversation.

## Which account is main?

I use the Claude desktop app on Gmail, but my terminal's default `~/.claude` login is Cannstudios. Those aren't the same account, which caught me out for a while.

Delegate reads `CLAUDE_CODE_USER_EMAIL` from the calling session first, then `mainClaudeEmail` from the config (default `mike.cann@gmail.com`). That email identifies the main account in Token Stats. If neither email is set, `mainClaudeConfigDir` still works as a last fallback. Set `mainClaudeEmail` to `null` if you need that old behaviour. An email we can't find has unknown limits; we don't substitute the terminal's account.

The session's own Claude account is shown as **this session** in `delegate providers`, and can't receive a run or sit on a consensus panel, including as chair. For the terminal's default `~/.claude` login, delegate removes `CLAUDE_CONFIG_DIR` from the child's environment. Setting it, even to the same path or an empty string, changes which keychain login Claude Code uses. We don't read `~/.claude.json` to identify that login, because the desktop app overwrites its account details.

Every provider child gets `DELEGATE_CHILD=1`. Hooks then stay silent, and nested `delegate run` or `delegate consensus` calls refuse, so a delegate loading my global Claude hooks doesn't hand the job off again.

## Hook pace settings

The hook calculates `behind = weekLeft% - budgetLeft%` for the main account's weekly window. It uses a reset timestamp when available, otherwise Token Stats' reset text, including relative times and weekday times. Relative times stay anchored to when the limits were fetched.

```json
{
  "mainClaudeEmail": "mike.cann@gmail.com",
  "hook": {
    "behindPaceWarnPercent": 5,
    "behindPaceBlockPercent": 15,
    "blockBelowWeeklyPercent": 10,
    "blockBelowFiveHourPercent": 15
  },
  "chairPreference": ["claude", "codex", "grok", "muse"],
  "panelPreference": ["codex", "grok", "muse", "claude"]
}
```

Below 5 percentage points behind, it's on pace and reminds the session to act as the orchestrator and delegate big chunks. At 5 points behind, it asks for everything but quick edits to be delegated. At 15 points behind, or below either absolute budget floor, built-in sub-agents are blocked. If the reset can't be parsed, the old 40% weekly cutoff applies, along with the configured floors. Unknown limits only get a reminder. `local:` descriptions and `delegate hook pause` still let work through.

`UserPromptSubmit` prints nothing when on pace. When behind, it adds one line of context on each prompt. All event hooks read cached files and start any stale refresh in the background. They don't wait for Token Stats.

The `claude` entry in either consensus preference list means the allowed, non-self Claude account with the most headroom. Concrete provider ids are still accepted. Normal consensus chooses one provider per lab and keeps the chair out of the panel when there are enough providers.

## How it works

| Piece | Detail |
|---|---|
| Providers | `codex exec`, `grok --prompt-file`, `muse exec` and `claude -p` with its account login, each with its own flags for headless runs. Every brief starts with a note saying it's running unattended for another agent, because otherwise they happily answer as if you're there. |
| Read-only jobs | `git worktree add --detach` at HEAD, your uncommitted diff and untracked files copied in and committed as a baseline. Anything the delegate changes is reported and thrown away with the worktree. |
| Write jobs | Same, on a `delegate/<id>` branch. Every CLI runs in its own OS sandbox, which blocks writes outside the worktree (temp folders are allowed, for builds). For Claude that's Claude Code's own sandbox, turned on with `--settings`. Your `node_modules` and `.venv` are linked in so builds and tests work, and the sandboxes stop anything writing through the link. |
| Processes | Each job runs in its own process group with output going straight to files. On timeout the group gets SIGTERM, then SIGKILL. |
| Limits | Token Stats' `limits.json`, or `token-stats limits --json`, cached in `~/.delegate/limits-cache.json`. The hooks only read files so they stay fast. |
| Hooks | `SessionStart` adds budget and pace guidance. `UserPromptSubmit` reminds when behind pace. `PreToolUse` on `Agent`, `Task` and `Workflow` adds a reminder, or blocks when well behind. A sub-agent whose description starts with `local:` always gets through, for jobs that need the session's own tools like the browser. |
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
