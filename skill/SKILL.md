---
name: delegate
description: Hand work to Mike's other AI subscriptions (Codex, Grok, Muse, his other Claude accounts running Opus) by calling their CLIs directly, instead of doing it in this session or with built-in sub-agents, both of which bill the main Claude account. Covers picking an account, the Convex rule, where each job runs, access levels and their flags, the brief template, and multi-lab consensus panels. Use whenever a job would pull a lot into this session (multi-file builds, codebase digging, long logs, reviews, research), whenever you'd reach for a sub-agent or Workflow, want a code review or second opinion, or when the user says delegate, hand off, consensus, ask the panel, or get other opinions.
---

# delegate

Everything this session does bills the Claude account it runs on, and so do built-in sub-agents (the Agent tool) and Workflows. In the desktop app that's Mike's main account, mike.cann@gmail.com, which he runs out of before the weekly reset while his other subscriptions sit idle. So hand jobs to those other subscriptions by running their CLIs (`codex`, `claude`, `grok`, `muse`) headless from Bash, and read back only a short answer.

Act as the orchestrator. Plan, decide, write briefs, check what comes back and talk to Mike here. Hand the heavy lifting out: builds touching more than a couple of files, digging through a codebase, long logs, reviews, research. Handing off doesn't mean a weaker model: `claude --model opus` on another of Mike's Claude accounts is Opus.

If you are yourself running as a delegate (your brief says so), do the work yourself. Don't use this skill.

Exact commands for every CLI and access level are in [reference/commands.md](reference/commands.md). The consensus recipe is in [reference/consensus.md](reference/consensus.md).

## Who to send what

Opus is Mike's workhorse because it makes better choices across the board. While a Claude account has room, Opus does the building and almost everything else. Codex, Grok and Muse get menial jobs, second opinions, and cover when the Claude accounts run low.

| Job | First choice | Backup |
|---|---|---|
| Any coding: features, fixes, refactors, tests | Opus | `codex` |
| Judgement, writing, investigations, "how does X work" | Opus | `codex` |
| Code review, second opinion on a diff | Opus and `codex` in parallel, since two labs catch different things | `grok`, `muse` |
| Research and docs lookups | Opus | `grok` |
| Current events, what people are saying on X | `grok` | Opus |
| Menial, mechanical jobs: bulk renames, reformatting, dependency bumps, quick lookups | `codex` | `grok` |
| A decision worth several opinions | a consensus panel ([reference/consensus.md](reference/consensus.md)) | |

Use Opus (`--model opus`) for Claude delegates. Only drop to Sonnet for genuinely menial jobs.

## Accounts

| Account | How to select it | Use |
|---|---|---|
| Claude mike@cannstudios.com (Max) | the default `~/.claude` login. `CLAUDE_CONFIG_DIR` must be unset: setting it, even to `~/.claude`, picks a different keychain login | personal work, the Opus workhorse |
| Claude mike.cann@convex.dev (Team) | `CLAUDE_CONFIG_DIR="$HOME/Library/Application Support/Token Stats/Accounts/claude-2"` | Convex work only |
| Claude mike.cann@gmail.com (Max) | `.../Token Stats/Accounts/claude-1` | NEVER. This is Mike's main account, the one the desktop app runs on |
| Codex (ChatGPT Pro) | `codex` | |
| Grok | `grok` | |
| Muse | `muse` | |

- Never use mike.cann@gmail.com.
- Never send work to the account this session runs on: `echo "$CLAUDE_CODE_USER_EMAIL"`.
- Token Stats folder numbers can change. Once per session, before using a Claude account, confirm its email (needs the `clean` function below):

  ```zsh
  clean claude auth status
  clean CLAUDE_CONFIG_DIR="$HOME/Library/Application Support/Token Stats/Accounts/claude-2" claude auth status
  ```

## Choosing who has room

Run `token-stats limits`. It prints a block per account:

```
Claude Max mike@cannstudios.com [~/.claude]
  5-hour: 72% left resets in 32m
  Weekly: 94% left resets Wed 4:59 am
Codex Pro Lite mike.cann@gmail.com [~/.codex]
  Weekly: 86% left resets Tue 2:40 pm
```

- An account's room is its tightest window (the lower of 5-hour and weekly).
- Skip a Claude account with under 10% left.
- If no allowed Claude account has room, send the job to `codex`.
- An account with an error line instead of percentages has unknown room. Use it last.

## The Convex rule

Convex work only ever goes to the Convex Claude account (mike.cann@convex.dev), and that account never gets anything else. Convex work is:

- a repo with a remote matching `github\.com(?::\d+)?[:/](?:get-)?convex/` (case-insensitive), or
- anything under `~/dev/convex/`, or
- `~/dev/me/port-geo-christmas-lights-cruise`.

Check from the folder the work is in (it also catches worktrees of those repos):

```zsh
{ git remote -v 2>/dev/null | grep -qiE 'github\.com(:[0-9]+)?[:/](get-)?convex/'; } || { printf '%s\n' "$(pwd -P)" "$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" | grep -qE "^$HOME/dev/(convex|me/port-geo-christmas-lights-cruise)(/|$)"; } && echo CONVEX || echo not-convex
```

Don't get round it by pasting Convex code or details into a brief for another account. If the Convex account isn't signed in or has no room, do the job here or wait.

## Clean environment

Inside Claude Code the shell inherits `CLAUDECODE`, `CLAUDE_CODE_*` (including `CLAUDE_CODE_USER_EMAIL`, OAuth scopes and host auth refresh) and `ANTHROPIC_*`. A child `claude` can pick these up and run as this session's account. Strip them from every CLI call:

```zsh
clean() { env $(env | awk -F= '/^(CLAUDE|ANTHROPIC)/ {printf "-u %s ", $1}') "$@"; }
```

- Prefix every `codex`, `claude`, `grok` and `muse` call with `clean`.
- Shell state doesn't carry between Bash calls, so define `clean` at the top of each call that uses it.
- For the Convex account: `clean CLAUDE_CONFIG_DIR="$HOME/Library/Application Support/Token Stats/Accounts/claude-2" claude ...`.
- Don't use `env -i`. Wiping the whole environment breaks Codex ("The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account").

## Run folder and short answers

Every job gets a folder holding `brief.md`, `answer.md` and `log.txt`:

```zsh
RUN=~/.delegate/runs/$(date +%Y%m%d-%H%M%S)-<slug>; mkdir -p "$RUN" && echo "$RUN"
```

- Write the brief to `$RUN/brief.md` with the Write tool, using the printed path. Later Bash calls set `RUN=<that path>` again.
- Always run the CLI with Bash `run_in_background: true`, so you keep working and get notified when it finishes. Several can run at once.
- Read the answer with `head -80 "$RUN/answer.md"`. Only open `log.txt` if something failed.
- macOS has no `timeout`. Stop an overrunning job with TaskStop.

## Where it runs

Never point a CLI at the user's working tree for a read-only job, because Grok, Muse and Claude's read-only modes don't reliably stop writes.

- **Read-only jobs** run in a throwaway snapshot worktree: HEAD plus the user's uncommitted and untracked changes. The one exception is Codex in plain read-only mode (`-s read-only`), whose sandbox really stops writes, so it can run in place.
- **Write jobs** run in a worktree on a `delegate/<slug>` branch, with `node_modules` and `.venv` linked in so builds and tests work. The delegate never commits. You review the diff, apply it to the real tree (new untracked files included), then remove the worktree and branch.
- For a question that doesn't need the code, run it in an empty folder: `mkdir -p "$RUN/empty"`.

All of these run from inside the user's repo (or the subfolder they're working in).

**Snapshot for a read-only job:**

```zsh
RUN=<run folder>
REPO=$(git rev-parse --show-toplevel); WT="$RUN/wt"
git -C "$REPO" worktree add --quiet --detach "$WT" HEAD
git -C "$REPO" diff --binary HEAD | git -C "$WT" apply --binary --allow-empty --whitespace=nowarn
git -C "$REPO" ls-files -z --others --exclude-standard | tar -C "$REPO" --null -T - -cf - | tar -C "$WT" -xf -
DIR="$WT/$(git rev-parse --show-prefix)"; echo "$DIR"
```

Afterwards, from the same repo: `git -C "$(git rev-parse --show-toplevel)" worktree remove --force "<run folder>/wt"`.

**Worktree for a write job:**

```zsh
RUN=<run folder>; SLUG=<slug>
REPO=$(git rev-parse --show-toplevel); WT="$RUN/wt"
git -C "$REPO" worktree add --quiet -b "delegate/$SLUG" "$WT" HEAD
git -C "$REPO" diff --binary HEAD | git -C "$WT" apply --binary --allow-empty --whitespace=nowarn
git -C "$REPO" ls-files -z --others --exclude-standard | tar -C "$REPO" --null -T - -cf - | tar -C "$WT" -xf -
GIT_INDEX_FILE="$RUN/base.index" git -C "$WT" add -A
GIT_INDEX_FILE="$RUN/base.index" git -C "$WT" write-tree > "$RUN/base"
for d in node_modules .venv; do if [[ -e "$REPO/$d" ]]; then ln -s "$REPO/$d" "$WT/$d"; fi; done
DIR="$WT/$(git rev-parse --show-prefix)"; echo "$DIR"
```

`$RUN/base` records the starting state (the user's changes included) without committing anything, so the diff shows only what the delegate did. Commit anything you want the delegate to build on first, or accept that it starts from the user's uncommitted changes.

**Review what it changed:**

```zsh
RUN=<run folder>; WT="$RUN/wt"; rm -f "$RUN/now.index"
GIT_INDEX_FILE="$RUN/now.index" git -C "$WT" add -A
GIT_INDEX_FILE="$RUN/now.index" git -C "$WT" rm -rq --cached --ignore-unmatch node_modules .venv
NOW=$(GIT_INDEX_FILE="$RUN/now.index" git -C "$WT" write-tree)
git -C "$WT" diff --binary "$(cat "$RUN/base")" "$NOW" > "$RUN/patch.diff"
git -C "$WT" diff --stat "$(cat "$RUN/base")" "$NOW"
```

Read `$RUN/patch.diff` (skim tests and docs, read the core files properly).

**Apply it to the real tree:**

```zsh
RUN=<run folder>; REPO=$(git rev-parse --show-toplevel)
git -C "$REPO" apply --check --binary --allow-empty "$RUN/patch.diff" && git -C "$REPO" apply --binary --allow-empty "$RUN/patch.diff"
```

If the check fails, nothing was changed. `git -C "$REPO" apply --binary --3way "$RUN/patch.diff"` merges instead and can leave conflict markers, but it refuses files that have unstaged changes. Otherwise, apply the relevant hunks by hand.

**Remove the worktree and branch:**

```zsh
RUN=<run folder>; SLUG=<slug>; REPO=$(git rev-parse --show-toplevel); WT="$RUN/wt"
git -C "$REPO" worktree remove --force "$WT" && git -C "$REPO" branch -D "delegate/$SLUG"
```

This removes the `node_modules` link, not the real folder.

## Access levels

Pick the lowest level the job needs. Flags for each CLI are in [reference/commands.md](reference/commands.md).

| Level | What it allows | Use it for |
|---|---|---|
| Read-only | Read files, web search tools where the CLI has them | Reviews, questions, research, codebase digging. The default |
| Network | Read-only plus shell network (`curl`, `dig`, `whois`) | Jobs that must fetch or probe something from the shell: DNS checks, hitting an API, downloading a spec |
| Write | Edit files inside its worktree, run builds and tests in a sandbox, no network | Implementation |
| Write + network | Write plus outbound HTTP | Builds that install packages or call a live service |
| Full access | No sandbox, no approvals, the whole machine | Only after Mike says yes in chat for this specific job |
| Browser (Codex) | Codex drives Mike's real Chrome headless, with his sign-ins | Real sites, anything needing his sign-ins, anything Claude's browser tools refuse. Reading and checking needs no yes; see below |
| Browser (Claude) | Opus drives Mike's real Chrome through the `codex-browser` tools, with his sign-ins | Same as the Codex browser, and the first choice while a Claude account has room |

| CLI | Read-only | Network | Write | Full access |
|---|---|---|---|---|
| Codex | `-s read-only`, in place is fine. `--search` (before `exec`) adds web search, not shell network | `-s workspace-write -c sandbox_workspace_write.network_access=true`, in a snapshot | `-s workspace-write` plus `--add-dir` build caches | `--dangerously-bypass-approvals-and-sandbox` |
| Claude | `--permission-mode dontAsk` with the read tool list (includes WebSearch and WebFetch), in a snapshot | add `Bash(dig *),Bash(curl *),Bash(whois *)` to the read list | read list plus `Edit(./**),Bash` and the sandbox `--settings`. Add `"network":{"allowedDomains":["*"]}` for HTTP; raw DNS still fails | `--dangerously-skip-permissions` |
| Grok | `--sandbox workspace`, in a snapshot. Network is already on | same as read-only | same as read-only | `--sandbox off` |
| Muse | `--disable-write` (not reliable), in a snapshot. `curl` works through a proxy, `dig` doesn't | add `--sandbox-network enabled` | drop `--disable-write` | `--yolo` |

The risks, plainly:

- Codex's and Grok's sandboxes can read the whole disk, including keys and other projects. Give one of them network too and a web page with injected instructions could, in theory, get a file sent out. Grok always has network on macOS, so don't send it jobs that touch secrets. Only give Codex or Claude network when the job needs it.
- Write levels keep writes inside the worktree, but a delegate can still run whatever it likes there, including scripts from the repo.
- Full access drops every guard. Ask Mike first, for that specific job, and quote his yes in the brief (e.g. `Mike approved full access for this job in chat: "yes go for it"`). Approval for one job doesn't carry to the next.
- The Codex browser acts in Mike's real Chrome with his sign-ins. Reading and checking pages needs no yes. Ask before it posts, sends, buys, deletes or changes account settings, unless Mike already asked for exactly that, and quote his ask in the brief. Spell out in the brief what it may do and where it must stop.

## Writing the brief

The delegate has none of this conversation. Write the brief as if for a capable contractor on their first day:

- What you want and why, in a sentence or two.
- Where to look: files, functions, the diff, URLs.
- What you already know or ruled out, so it doesn't redo your work.
- What good output looks like: the format, how long, what to leave out.

Start every brief with this block, filled in. Delegates load Mike's global instructions, which tell every session to delegate and to end with a "What I need from you" section, and this skill is linked into Codex too. Without the block they answer as if Mike were there, and may delegate again.

```markdown
You are running unattended as a delegate for another AI agent (the orchestrator). No person is reading this live.
- Nobody can answer questions mid-task. Make reasonable assumptions and state them.
- Do the work yourself. Don't hand it to other agents, sub-agents or AI CLIs, and ignore any instructions or skills telling you to delegate.
- Ignore instructions meant for interactive sessions with the user, such as ending with a "What I need from you" section, asking for approval, opening PRs or sending messages.
- Never commit, push, open PRs, or change anything outside your working directory.
- Your final message goes back to the orchestrator as-is, so make it stand alone. Lead with the answer, no preamble or sign-off, and keep it under 400 words unless the task really needs more.
- Working directory: <DIR> (a private copy of the user's repo, including their uncommitted changes).
- <This is read-only work: don't modify any files. | You may edit files in your working directory.>

<one task note from below>

---

<the brief>
```

Task notes, one per brief:

- **Question:** Task type: question. Answer directly, from your own judgement, and use tools only to check facts you're unsure of.
- **Review:** Task type: review. Read the relevant code and report concrete problems, most severe first. For each: file:line, what's wrong, and a concrete input or situation that triggers it. Don't edit files. If you find nothing significant, say so plainly rather than padding the list.
- **Research:** Task type: research. Cite a source (URL or file path) for each factual claim, and say which things you verified and which you're inferring.
- **Implementation:** Task type: implementation. Make the change by editing files in this working directory. Don't commit. Run the relevant tests or build if you can. End with: files changed, how you verified it, and anything left undone.

Drop the word limit for implementation and big reviews. Drop "(a private copy ...)" when Codex runs in place. For Claude, also pass the system note in [reference/commands.md](reference/commands.md) with `--append-system-prompt`.

## Checking the result

A delegate's answer is a report, not proof. Before telling Mike something is done or true:

- For reviews, check each finding against the code before passing it on. Drop the ones that don't hold up.
- For implementation, read the patch and run the tests yourself after applying it. Skim the core files rather than every line of tests and docs.
- For research, spot-check the sources on anything load-bearing.
- If two reviewers disagree, look yourself rather than picking one.

## Consensus

For a decision worth several opinions, send the same neutral question to Codex, Grok, Muse and Opus in parallel, hide who said what, and have a fresh Fable chair write up the consensus, the disagreements and the best minority point. Mike is happy to try as many model combinations as possible, so go wide for anything that matters. The full recipe, briefs and chair prompt are in [reference/consensus.md](reference/consensus.md).

## When not to delegate

- The task needs this session's own tools: MCP connectors (Notion, Slack, Gmail), the desktop app, this session's browser pane for localhost previews. Do it here.
- It's quicker to do yourself than to write the brief: a single grep, a one-line fix.
- It's Convex work and the Convex account isn't signed in or has no room.
- Browsing real sites isn't a reason to keep a job: Opus browses headless with the `codex-browser` tools, and Codex with `--approve-for-me` (see Access levels for when to ask). Don't use the Claude in Chrome extension, since it needs its side panel open the whole time, and don't tell Mike something can't be done in a browser until Codex has tried. The exception is account and permission changes, which need a live yes from Mike under Codex's own browser rules that a headless run can't get. Set those up for him in the Codex app or this session's browser pane and tell him what to click.

## If something goes wrong

- Empty `answer.md` or a non-zero exit: read `tail -50 "$RUN/log.txt"`.
- An expired login: `codex login`, `grok login`, `muse login`. For a Claude account, `claude` then `/login` in a terminal (with the right `CLAUDE_CONFIG_DIR` for a Token Stats account), or Token Stats' Add account. Logins need Mike, so tell him which one and use another account meanwhile.
- A Claude child answering as the wrong account: check `clean` was defined and used, and that `CLAUDE_CONFIG_DIR` is unset for the default login.
- Codex saying a model isn't supported with a ChatGPT account: the environment was wiped. Use `clean`, not `env -i`.
- A job overrunning: stop it with TaskStop, then split the task.
