# Command reference

Checked live on 21 Oct 2026 with codex-cli 0.163.0, grok 1.0.62, Muse Code 1.4.11 and Claude Code 2.1.304, on macOS with zsh. If a CLI has updated since, check its `--help` before trusting a flag.

Every call below assumes, in the same Bash call:

```zsh
clean() { env $(env | awk -F= '/^(CLAUDE|ANTHROPIC)/ {printf "-u %s ", $1}') "$@"; }
RUN=<run folder>     # holds brief.md; answer.md and log.txt get written here
DIR=<where it runs>  # snapshot, write worktree, or (Codex read-only only) the real folder
```

Run each with Bash `run_in_background: true`, then `head -80 "$RUN/answer.md"`.

## Codex

The brief goes in on stdin. `-o` gets only the final message, and everything else goes to the log.

Read-only. Its sandbox reliably stops writes, so it can run in place. The shell has no network (`dig` and `curl` both fail):

```zsh
clean codex exec --skip-git-repo-check --ephemeral -C "$DIR" -s read-only -c approval_policy='"never"' -o "$RUN/answer.md" - < "$RUN/brief.md" > "$RUN/log.txt" 2>&1
```

Web search tool: put `--search` before `exec` (`clean codex --search exec ...`). It adds the search tool only, not shell network.

Network: swap `-s read-only` for the line below. It can now write in its folder, so read-only jobs at this level go in a snapshot:

```zsh
-s workspace-write -c sandbox_workspace_write.network_access=true
```

Write. Its sandbox otherwise breaks Swift and clang builds, so add each build cache that exists:

```zsh
CACHES=(); for c in ~/.cache/clang ~/Library/Caches/org.swift.swiftpm ~/.bun/install/cache ~/.npm/_cacache; do if [[ -d $c ]]; then CACHES+=(--add-dir "$c"); fi; done
clean codex exec --skip-git-repo-check --ephemeral -C "$DIR" -s workspace-write "${CACHES[@]}" -c approval_policy='"never"' -o "$RUN/answer.md" - < "$RUN/brief.md" > "$RUN/log.txt" 2>&1
```

Add `-c sandbox_workspace_write.network_access=true` for write plus network.

Browser, with approvals answered by an AI reviewer (only with Mike's yes for this job): drop `-c approval_policy='"never"'` and add `--approve-for-me`. It opens pages in Mike's real Chrome, headless. With `approval_policy="never"` the browser is declined ("The origin approval gate did not grant access").

Full access (only with Mike's yes for this job): drop `-s ...` and `-c approval_policy=...`, add `--dangerously-bypass-approvals-and-sandbox`. This can use the browser too.

Options: `-m <model>`, `-c model_reasoning_effort='"low"'` (or `"medium"`, `"high"`). The defaults come from `~/.codex/config.toml`.

## Claude (Opus)

The system note, passed with `--append-system-prompt` on top of the brief's preamble:

```zsh
NOTE="You are running headless as a delegate for another AI agent, not chatting with a person. Do the work yourself: don't hand it to other agents, sub-agents or AI CLIs. End with your answer itself: no closing status line about what the user needs to do, no questions, no offers of next steps."
READ="Read,Grep,Glob,WebSearch,WebFetch,Bash(git log *),Bash(git diff *),Bash(git show *),Bash(git status *),Bash(git blame *),Bash(ls *),Bash(rg *)"
```

Claude has no working-directory flag, so `cd` first. Read-only (always in a snapshot, since `git diff --output=x` can still write):

```zsh
cd "$DIR" && clean claude -p --model opus --no-session-persistence --strict-mcp-config --output-format text --append-system-prompt "$NOTE" --permission-mode dontAsk --allowedTools "$READ" < "$RUN/brief.md" > "$RUN/answer.md" 2> "$RUN/log.txt"
```

`--strict-mcp-config` stops it starting Mike's global MCP servers. It still reads his global `~/.claude/CLAUDE.md`, which is why the brief's preamble and `$NOTE` matter.

Network for shell lookups: `--allowedTools "$READ,Bash(dig *),Bash(curl *),Bash(whois *)"`, with no sandbox setting.

Write:

```zsh
SANDBOX='{"sandbox":{"enabled":true,"failIfUnavailable":true,"autoAllowBashIfSandboxed":true,"allowUnsandboxedCommands":false}}'
cd "$DIR" && clean claude -p --model opus --no-session-persistence --strict-mcp-config --output-format text --append-system-prompt "$NOTE" --permission-mode dontAsk --allowedTools "$READ,Edit(./**),Bash" --settings "$SANDBOX" < "$RUN/brief.md" > "$RUN/answer.md" 2> "$RUN/log.txt"
```

Use `Edit(./**)` only: it covers every file-editing tool, and `Write(./**)` isn't matched by file permission checks. In this sandbox the network is blocked (`curl` gets 403 from the sandbox proxy).

Write plus network:

```zsh
SANDBOX='{"sandbox":{"enabled":true,"failIfUnavailable":true,"autoAllowBashIfSandboxed":true,"allowUnsandboxedCommands":false,"network":{"allowedDomains":["*"]}}}'
```

HTTP works then, but raw DNS (`dig`) still fails inside the sandbox. For DNS lookups use the read-only network setup.

Full access (only with Mike's yes for this job): replace `--permission-mode`, `--allowedTools` and `--settings` with `--dangerously-skip-permissions`.

Accounts: the commands above use the default `~/.claude` login (mike@cannstudios.com), so `CLAUDE_CONFIG_DIR` must stay unset. For the Convex account put it after `clean`:

```zsh
clean CLAUDE_CONFIG_DIR="$HOME/Library/Application Support/Token Stats/Accounts/claude-2" claude -p ...
```

Options: `--model claude-fable-5-1` for Fable (consensus chairs), `--model sonnet` for menial jobs, `--effort <level>`.

## Grok

```zsh
clean grok --prompt-file "$RUN/brief.md" --output-format plain --cwd "$DIR" --always-approve --sandbox workspace > "$RUN/answer.md" 2> "$RUN/log.txt"
```

- `--output-format text` is invalid. The values are `plain`, `json`, `streaming-json` and `streaming-messages-json`.
- Network is always on: `dig` and `curl` both work. Its docs say child-network blocking is Linux-only, so even `--sandbox read-only` doesn't block it on macOS.
- It writes inside its working directory even for read-only jobs, so always use a snapshot.
- Full access (only with Mike's yes for this job): `--sandbox off`.
- Options: `-m <model>`, `--effort <level>`.

## Muse

```zsh
clean muse exec --prompt-file "$RUN/brief.md" --workspace "$DIR" --approval-mode never --trust-workspace --no-session-log --disable-write > "$RUN/answer.md" 2> "$RUN/log.txt"
```

- stdout is just the final answer. The banner lines go to stderr.
- `--disable-write` is for read-only jobs, but it isn't reliable (it has written files anyway), so always use a snapshot. Drop it for write jobs.
- Default network goes through a proxy: `curl` works, `dig` doesn't. `--sandbox-network enabled` makes both work.
- Full access (only with Mike's yes for this job): `--yolo` (no approvals, no sandbox), without `--disable-write`.
