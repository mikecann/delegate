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
gemini_seat <name> <model> <effort>   # Convex & Threadbear Gemini reviews, e.g. gemini-4-neon high; OpenCode's lock, Convex's Gemini API key
agy_seat    <name> <model>            # other/personal Gemini runs: Google's Antigravity agent on Mike's Google plan, e.g. gemini-4-neon
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
- How much of the plan is left: `source seats.zsh; agy_usage` prints the Gemini models' weekly and 5-hour windows (and the Claude/GPT group's). The server answers `/usage` itself, so it costs no quota.
- Models depend on the plan: `source seats.zsh; agy_models` lists them. On 19 Nov 2026 it went from only `gemini-3.8-flash` to `gemini-4-neon`, `gemini-4-carbon`, `gemini-4-argon`, `gemini-4-hydrogen` and `gemini-3.8-flash`.
- To try a newer server, set `AGY_VERSION` and check `session/new` answers within a minute before switching. The registry's current build is at `https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json`.

## Checking who pays

`claude auth status` prints the login. Set the folder yourself, because a plain run reports this thread's account:

```zsh
CLAUDE_CONFIG_DIR="$HOME/Library/Application Support/Token Stats/Accounts/claude-2" claude auth status
env -u CLAUDE_CONFIG_DIR claude auth status    # ~/.claude
```

## When it goes wrong

- `FAILED <name> (exit 124)`: it hit `LIMIT`. Split the job or raise the limit. For `agy_seat`, an empty answer does not prove it hung: Gemini can think silently. The startup log says when `LIMIT` is shorter than the prompt silence watchdog.
- Stopping the run script (TaskStop, Ctrl-C, `kill`) stops every seat it started, and everything under them, within about 3 seconds (since 23 Nov 2026). Only `kill -9` of the script skips that: then find the seats with `ps -axo pid,ppid,command | grep -E 'timeout [0-9]+ '` (parent 1, its run folder in the command) and kill each `timeout` and anything under it, `agy_acp_server.par` included.
- `FAILED <name> (stalled ...)`, status `exit STALLED`: an `agy_seat` got no event from the agent for 20 minutes twice, or for 2 minutes during the handshake before the prompt (`initialize`, `session/new`), which should answer in seconds (agy-acp.py retries once from a fresh server first, unless it's a `WRITE` job or `LIMIT` has no room for another window of the phase that stalled; `err-<name>.log` has a `stalled:` line for each, naming the request). A healthy review can be silent for 10 minutes while it thinks (measured 20 Nov 2026), hence 20. With the default `LIMIT` of 900 only the handshake watch can fire first; the 20-minute one matters for `LIMIT=3600` jobs like fix reviews. On 20 Nov 2026 one review went quiet like this after a refused command and sat idle for 39 minutes until it was killed by hand. Carry on without it. `AGY_STALL` and `AGY_INIT_STALL` (seconds) change the prompt and handshake waits for one script. On 23 Nov 2026 reviews sat 20 minutes in `initialize`, twice, before the handshake got its own window.
- A seat that exits 0 with an empty answer counts as failed. Look in `err-<name>.log`. Codex's answer is in `out-<name>.md` and everything else it prints is in the log.
- OpenCode `401 api_key_expired`: its Zen key has run out. Mike makes a new one at opencode.ai/console/account#api-keys (Default Chrome profile, model request and usage read access only) and it goes into `~/.local/share/opencode/auth.json` under `opencode.key`.
- Gemini `exit NOKEY`: `~/.config/gemini/api-key` is missing. Since 27 Nov 2026 it holds Convex's "internal coding tools" Gemini API key from Gautam Gupta (starts `AQ.`). Ask Mike to restore it via `ask_secret` rather than recreating a key yourself.
- Gemini `Generate content input tokens per minute limit exceeded on Tier 1`: the key's per-minute rate limit (2M input tokens a minute), not the spend cap or the credit, so it's no reason to bother Mike or look at a bigger plan. `gemini_seat` waits these out through gemini-wait.py, and `wait-<name>.log` shows each wait. If one still kills a seat, the waits ran out (12 in a row) or the 429 wasn't marked per-minute: check the log, and fix gemini-wait.py rather than rerunning blind. A seat that waits a lot runs long, so give big reviews `LIMIT=3600`.
- Antigravity `exit 4`: the agent answered with a capacity or quota error (the free plan did this often). Try another model, or send a Convex/Threadbear review to `gemini_seat` (leave other personal repos on Codex rather than billing Convex's key).
- Antigravity `exit NOLOGIN`: not installed or not signed in. Run `agy_login` (above).
- Antigravity `tool failed:` lines include requested file paths and a classified reason;
  returned file bodies and arbitrary error output stay out of the log. `path does not
  exist` means discover the filename with one plain `ls` or `grep` command. A path that
  resolves outside the workspace can be a dependency symlink: copy the needed source
  into the scratch worktree or paste it into the brief, keeping the read-only lock.
- Gemini `exit NOPROXY`: gemini-wait.py didn't start (it runs on `/usr/bin/python3`).
- Gemini `FAILED <name> (Gemini API spend cap hit, ...)`: Google answered 403 "Spend cap breached". Tell Mike rather than raising any cap yourself; for Threadbear or personal work you can fall back to `agy_seat` meanwhile.
- Other Gemini errors about billing, quota or a paused service: tell Mike (the key is Convex's "internal coding tools" key from Gautam Gupta; never raise caps or top up billing yourself).
- Claude's `MCP servers blocked by enterprise policy` warning on `claude-2` is normal too.
- Claude's `SessionStart` hooks and global instructions still load on a locked seat, which is why the brief opens with the delegate preamble.
