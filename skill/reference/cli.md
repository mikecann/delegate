# Sending jobs through the CLIs

[seats.zsh](seats.zsh) holds the commands, so nobody retypes the flags. Tested on 2 Nov 2026 from a Threadbear thread on a Claude account.

## A job

Make a run folder, write the filled-in brief to `brief-<name>.md`, and write a small script:

```zsh
RUN=~/.delegate/runs/$(date +%Y%m%d-%H%M%S)-<slug>; mkdir -p "$RUN/scratch"
```

```zsh
#!/bin/zsh
# $RUN/run.sh
RUN=<run folder>; DIR=$RUN/scratch        # or $RUN/wt for a job that needs the repo
source ~/.claude/skills/delegate/reference/seats.zsh

claude_seat review claude-1 claude-opus-5-5 xhigh

seats_wait
```

Run it with Bash's `run_in_background`. A Claude thread is woken when it exits, so end your turn or get on with something else. Threadbear's docs say a Codex thread isn't woken by background work, so a Codex thread runs the script in the foreground (up to the 10-minute limit) or polls `$RUN/status`. Then read `$RUN/out-<name>.md`.

The seats, with the models and efforts from SKILL.md:

```zsh
claude_seat <name> main|claude-1|claude-2|claude-3 <model> <effort>
codex_seat  <name> <model> <effort>
grok_seat   <name> <model> <effort>
opencode_seat <name> opencode/<model> <effort>   # effort is low, high or max
agy_seat    <name> <model>            # the Gemini default: Google's Antigravity agent on Mike's Google plan, e.g. gemini-4-neon
gemini_seat <name> <model> <effort>   # the Gemini fallback, e.g. gemini-4-neon high; OpenCode's lock, the paid Gemini API key
```

Any mix of seats in one script runs in parallel. The script can set `LIMIT` (seconds per seat) above the `source` line.

## The modes

| Mode | Set | What it can do |
|---|---|---|
| Read-only (default) | nothing | read the disk and answer, no writes. Claude, Grok and OpenCode have no shell, and OpenCode can't read outside `DIR`. Codex runs shell commands in a sandbox that blocks writes, because that's how it reads files. Claude and Grok have no web. Codex does |
| Research | `RESEARCH=1` | also search and fetch the web on Claude, Grok and OpenCode |
| Write | `WRITE=1` | edit and run things. Only ever in a worktree or scratch folder ([worktrees.md](worktrees.md)) |

- Read-only locks stop writes, but all of them can still read keys and other projects, so keep secrets out of it ("Access and risk" in SKILL.md).
- A read-only Codex seat can still run commands, builds included. Nothing turns that off without also stopping it reading files, so the brief tells it not to build or run test suites.
- Every seat runs at background priority (`taskpolicy -b`), and so does anything it starts, so a child's work stays off the cores Mike is using.
- Grok's X search tools can't go in its read-only lock. For "what are people saying on X", use `WRITE=1` with `DIR` set to an empty scratch folder.
- Codex `exit NOCODEX`: neither the global `codex` nor Threadbear's copy starts. If err-<name>.log says the global one is "Missing optional dependency", the install raced a Codex release (its platform package goes up a few minutes after the main one): run `npm install -g @openai/codex@latest` again and check `codex --version`. While only the global one is broken, seats say so in err-<name>.log and use Threadbear's copy.
- Grok `exit UNLOCKED` means a name in `--tools` wasn't recognised and it ran with every tool. Throw the answer away, check nothing changed in `DIR`, and fix the names in seats.zsh.

## The Antigravity seat

`agy_seat` runs Google's `agy_acp_server` (from the ACP Registry, signed by Google, pinned to 1.4.5 because 1.5.0 never finishes starting a session here) through [agy-acp.py](agy-acp.py), the way T3 Code does. It's installed in `~/.delegate/agy-acp/` and signed in from `~/.gemini/antigravity-acp`, the same login Threadbear's Gemini threads use. The lock is ACP's permission prompts. File reads run without asking. The agent has no listing or code-search tool of its own and runs `grep` and `ls` in a shell instead, so a read-only seat allows one plain `grep`, `ls`, `cat`, `head`, `tail`, `wc` or `stat` with no pipes, redirects, `;`, `&`, `$` or backticks. These programs have no option that writes or runs anything, which matters because the shell still expands braces and globs after the check (`find` came out for that: `{-exec,touch}`). Other commands, file writes and subagents are refused, and so are web searches and fetches unless `RESEARCH` is set. Tested 19 Nov 2026: `grep` and `ls` ran, `touch`, `grep > file`, file creation and web search were refused, and the folder was unchanged. It can still read outside `DIR`, like the Claude and Grok seats.

- Sign in (first time, or after `exit NOLOGIN`): run `source seats.zsh; agy_login` in the background. It installs the server if needed and prints a `Sign in here:` link. Open it in Mike's personal Chrome profile with `browserbear open <link> --profile mike.cann@gmail.com`, pick mike.cann@gmail.com and click Sign in (no password was needed on 19 Nov 2026). It prints the plan when done.
- Models depend on the plan: `source seats.zsh; agy_models` lists them. On 19 Nov 2026 it went from only `gemini-3.8-flash` to `gemini-4-neon`, `gemini-4-carbon`, `gemini-4-argon`, `gemini-4-hydrogen` and `gemini-3.8-flash`.
- To try a newer server, set `AGY_VERSION` and check `session/new` answers within a minute before switching. The registry's current build is at `https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json`.

## Checking who pays

`claude auth status` prints the login. Set the folder yourself, because a plain run reports this thread's account:

```zsh
CLAUDE_CONFIG_DIR="$HOME/Library/Application Support/Token Stats/Accounts/claude-2" claude auth status
env -u CLAUDE_CONFIG_DIR claude auth status    # ~/.claude
```

## When it goes wrong

- `FAILED <name> (exit 124)`: it hit `LIMIT`. Split the job or raise the limit.
- A seat that exits 0 with an empty answer counts as failed. Look in `err-<name>.log`. Codex's answer is in `out-<name>.md` and everything else it prints is in the log.
- OpenCode `401 api_key_expired`: its Zen key has run out. Mike makes a new one at opencode.ai/console/account#api-keys (Default Chrome profile, model request and usage read access only) and it goes into `~/.local/share/opencode/auth.json` under `opencode.key`.
- Gemini `exit NOKEY`: `~/.config/gemini/api-key` is missing. The key is "Delegate reviews (M5)" in [AI Studio](https://aistudio.google.com/apikey) (project Gemini Reviews, Mike's personal Google account). Its copy button puts it on the clipboard only while Chrome is frontmost, and new keys start `AQ.`, not `AIza`.
- Gemini `Generate content input tokens per minute limit exceeded on Tier 1`: the key's per-minute rate limit (2M input tokens a minute), not the spend cap or the credit, so it's no reason to bother Mike or look at a bigger plan. `gemini_seat` waits these out through gemini-wait.py, and `wait-<name>.log` shows each wait. If one still kills a seat, the waits ran out (12 in a row) or the 429 wasn't marked per-minute: check the log, and fix gemini-wait.py rather than rerunning blind. A seat that waits a lot runs long, so give big reviews `LIMIT=3600`.
- Antigravity `exit 4`: the agent answered with a capacity or quota error (the free plan did this often). Try another model, or send a fix review to `gemini_seat`.
- Antigravity `exit NOLOGIN`: not installed or not signed in. Run `agy_login` (above).
- Gemini `exit NOPROXY`: gemini-wait.py didn't start (it runs on `/usr/bin/python3`).
- Gemini `FAILED <name> (Gemini API spend cap hit, ...)`: Google answered 403 "Spend cap breached". The key's US$90 monthly cap is used up (it was from 19 Nov 2026 until it reset on 1 Dec). Every call fails until the month turns or Mike raises the cap, so use `agy_seat` and tell Mike. Never raise it yourself.
- Other Gemini errors about billing, quota or a paused service: the spend cap or the prepaid credit ran out. Don't raise either; tell Mike (cap: [Budgets and caps](https://console.cloud.google.com/billing/017432-88C7C0-85D05A/budgets), credit: [AI Studio billing](https://aistudio.google.com/billing?billing=017432-88C7C0-85D05A)).
- Claude's `MCP servers blocked by enterprise policy` warning on `claude-2` is normal too.
- Claude's `SessionStart` hooks and global instructions still load on a locked seat, which is why the brief opens with the delegate preamble.
