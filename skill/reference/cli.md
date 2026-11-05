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
muse_seat   <name> <model> <effort>
```

Any mix of seats in one script runs in parallel. The script can set `LIMIT` (seconds per seat) above the `source` line.

## The modes

| Mode | Set | What it can do |
|---|---|---|
| Read-only (default) | nothing | read the disk and answer, no writes. Claude, Grok and Muse have no shell. Codex runs shell commands in a sandbox that blocks writes, because that's how it reads files. Claude and Grok have no web. Codex and Muse do |
| Research | `RESEARCH=1` | also search and fetch the web on Claude and Grok |
| Write | `WRITE=1` | edit and run things. Only ever in a worktree or scratch folder ([worktrees.md](worktrees.md)) |

- Read-only locks stop writes, but all of them can still read keys and other projects, so keep secrets out of it ("Access and risk" in SKILL.md).
- A read-only Codex seat can still run commands, builds included. Nothing turns that off without also stopping it reading files, so the brief tells it not to build or run test suites.
- Every seat runs at background priority (`taskpolicy -b`), and so does anything it starts, so a child's work stays off the cores Mike is using.
- Muse keeps its connectors server (Gmail, Notion and so on) in every mode, as nothing turns it off. The server holds sends and deletes for Mike's approval, and the brief says not to use it.
- Grok's X search tools can't go in its read-only lock. For "what are people saying on X", use `WRITE=1` with `DIR` set to an empty scratch folder.
- Grok `exit UNLOCKED` means a name in `--tools` wasn't recognised and it ran with every tool. Throw the answer away, check nothing changed in `DIR`, and fix the names in seats.zsh.

## Checking who pays

`claude auth status` prints the login. Set the folder yourself, because a plain run reports this thread's account:

```zsh
CLAUDE_CONFIG_DIR="$HOME/Library/Application Support/Token Stats/Accounts/claude-2" claude auth status
env -u CLAUDE_CONFIG_DIR claude auth status    # ~/.claude
```

## When it goes wrong

- `FAILED <name> (exit 124)`: it hit `LIMIT`. Split the job or raise the limit.
- A seat that exits 0 with an empty answer counts as failed. Look in `err-<name>.log`. Codex's answer is in `out-<name>.md` and everything else it prints is in the log.
- Muse printing `retrying meta model stream` in its log: its service is struggling. On 2 Nov it worked, then failed for several runs in a row, so drop the seat rather than waiting.
- `muse: Agent delegation: auto unavailable: workspace is untrusted` is normal, and helps.
- Claude's `MCP servers blocked by enterprise policy` warning on `claude-2` is normal too.
- Claude's `SessionStart` hooks and global instructions still load on a locked seat, which is why the brief opens with the delegate preamble.
