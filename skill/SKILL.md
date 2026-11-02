---
name: delegate
description: Hand work to Mike's other AI subscriptions (Opus on his other Claude accounts, Codex, Grok, Muse) from a Threadbear thread, through the claude, codex, grok and muse CLIs or Threadbear's `create_thread`, and run multi-lab consensus panels. Use only when Mike asks for it, e.g. he says delegate, hand off, send this to Codex (or Opus, Grok, Muse), get a second opinion or a review from another model, consensus, or ask the panel. Covers picking a provider, model, account and route, the Convex rule, where children run and how their changes come back, and the brief template. Otherwise do the work in the current thread on its own account.
---

# delegate

Mike picks the account for each Threadbear thread when he starts it, so a thread normally does its own work on its own account, with built-in sub-agents if that helps. Use this skill only when Mike asks for work to go elsewhere: a second opinion, a review from another lab, a consensus panel, or a job he wants on a particular provider. Native sub-agents don't count: they always bill this thread's account.

If you are yourself running as a delegate (your brief says so), do the work yourself. Don't use this skill.

## Who to send what

If Mike names a provider or model, use that. Otherwise Opus is the default because it makes the best choices across the board, and Codex, Grok and Muse get menial jobs, second opinions, and cover when the Claude accounts run low.

| Job | First choice | Backup |
|---|---|---|
| Any coding: features, fixes, refactors, tests | Opus | Codex |
| Judgement, writing, investigations, "how does X work" | Opus | Codex |
| Code review, second opinion on a diff | Opus and Codex in parallel, since two labs catch different things | Grok, Muse |
| Research and docs lookups | Opus | Grok |
| Current events, what people are saying on X | Grok | Opus |
| Menial, mechanical jobs: bulk renames, reformatting, dependency bumps, quick lookups | Codex | Grok |
| A decision worth several opinions | a consensus panel ([reference/consensus.md](reference/consensus.md)) | |

Default models and efforts. Always pass the effort.

| For | CLI model | `create_thread` model | Effort |
|---|---|---|---|
| Opus | `claude-opus-5-5` | `opus` | `xhigh`, or `max` for hard problems |
| Codex | `gpt-6.1-sol` | `gpt-6.1-sol` | `high`, or `low` for menial jobs |
| Grok | `grok-4.7` | not available | `high` |
| Muse | `muse-wonder-full-1.0` | not available | `high` |
| Consensus chair | `claude-fable-5-1` | `fable` | `high` |

Only drop to `claude-sonnet-5-5` (`sonnet`) for genuinely menial Claude jobs. **Muse access ends on 13 Nov 2026** (Mike cancelled): after that, skip it everywhere in this skill. These IDs were current on 2 Nov 2026. If one has gone stale, `list_accounts` shows Claude and Codex models, and `grok models` shows Grok's.

## Accounts

| Threadbear account | Login | `CLAUDE_CONFIG_DIR` for the CLI | In `token-stats limits` | Use |
|---|---|---|---|---|
| `claude-main` | Claude mike@cannstudios.com (Max) | leave unset (`main` in seats.zsh) | `[~/.claude]` | personal work |
| `claude-1` | Claude mike.cann@gmail.com (Max) | `~/Library/Application Support/Token Stats/Accounts/claude-1` | `[claude-1]` | personal work |
| `claude-3` | Claude mike@gangbusters.io (Max) | `.../Accounts/claude-3` | `[claude-3]` | personal work |
| `claude-2` | Claude mike.cann@convex.dev (Team) | `.../Accounts/claude-2` | `[claude-2]` | Convex work only |
| `codex-main` | ChatGPT | not needed | `[~/.codex]` | |
| none, CLI only | X Premium+ | not needed | `[~/.grok]` | |
| none, CLI only | Muse Power Usage, until 13 Nov 2026 | not needed | `[~/.config/muse]` | |

A plain `claude` in a thread runs on that thread's account, because it inherits `CLAUDE_CONFIG_DIR`. [seats.zsh](reference/seats.zsh) strips that, so go through it.

## Picking an account

If Mike names an account, use it. Otherwise run `token-stats limits` before sending:

- An account's room is the lowest "% left" on its 5-hour and Weekly lines, plus its Weekly Fable line for Fable jobs. Max accounts no longer have a 5-hour line. A window that resets within the hour doesn't count. Ignore the dollar and credit lines. Skip an account with under 10% room, and use one that shows an error or no percentages last.
- Opus jobs go to whichever of `claude-main`, `claude-1` and `claude-3` has most room. If none has room, send the job to Codex.

## The Convex rule

Convex work only ever goes to `claude-2`, and that account never gets anything else, including consensus seats on questions that aren't Convex work. Convex work is:

- a repo with a remote matching `github\.com(?::\d+)?[:/](?:get-)?convex/` (case-insensitive), or
- anything under `~/dev/convex/`, or
- `~/dev/me/port-geo-christmas-lights-cruise`.

Check from the folder the work is in (it also catches worktrees of those repos):

```zsh
{ git remote -v 2>/dev/null | grep -qiE 'github\.com(:[0-9]+)?[:/](get-)?convex/'; } || { printf '%s\n' "$(pwd -P)" "$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" | grep -qE "^$HOME/dev/(convex|me/port-geo-christmas-lights-cruise)(/|$)"; } && echo CONVEX || echo not-convex
```

Don't get round it by pasting Convex code or details into a brief for another provider. If the Convex account isn't signed in or has no room, do the job here or wait.

**When Mike explicitly asks for other labs on Convex work,** his ask wins for that job, as it did on 2 Nov 2026 when he asked Fable, Astra, Muse and Grok to review a video script that was going on YouTube anyway:

- He has to have said it for this job: "get Grok and Codex on this" counts, "get a second opinion" doesn't (that stays on `claude-2`).
- Go ahead if the material is public or about to be. Send other labs only what the job needs, and generalise anything non-public (general channel numbers rather than the private dashboard).
- Private code, customer details, credentials or unreleased plans still don't leave `claude-2` unless he named that material. If you can't tell whether his ask covers it, ask him.
- Claude seats stay on `claude-2`. His ask opens the door to the labs he named, not to his personal Claude accounts.
- Tell him what went to whom when you report back.

## CLI or a Threadbear thread

| | CLI ([reference/cli.md](reference/cli.md)) | `create_thread` or `tb new` |
|---|---|---|
| Providers | Claude, Codex, Grok, Muse | Claude and Codex only |
| Read-only | yes, locked by flags | no: `full`, or `ask`, which stops for a person at each action |
| Mike sees it | no, only your report | yes, as a thread he can watch and talk to |
| Comes back as | a file, and wakes you | nothing by itself, see below |

Use the CLI by default: any read-only job, any panel, and anything for Grok or Muse. Use a thread when Mike wants to watch or take over the job, or it's a long piece of writing work he'd want to steer.

For a thread:

- Set `account` to pin it to one login, or `pool` to let Threadbear pick the login with room and move it when one runs dry. Pool `claude` is the personal accounts and `codex` is Codex.
- Convex work always sets `account: "claude-2"`. The folder only picks the Convex pool under `~/dev/convex`, so a Convex repo somewhere else would land on a personal account.
- Pass `model`, `effort`, `folder`, `title` and `why`. The first message needs the whole brief, preamble included.
- It doesn't report back. To get the answer, run `tb new "<brief>" --cwd <folder> --account <id> --model <model> --effort <effort> --why "<why>" --wait` in a background Bash, which prints the transcript when the thread finishes. Otherwise check on it later with `read_thread`. To follow up, use `send_message`.
- It has full access, so a write job gets a worktree as its `folder`. If the repo opts in to Threadbear's thread worktrees, the thread gets its own from `main` instead, without Mike's uncommitted changes, so check where it landed.

## Where children run

Keep them out of Mike's real tree wherever you can:

- **Questions that don't need the code:** an empty scratch folder. If a job only needs a little code, paste it into the brief and treat it as a question.
- **Anything that reads or changes the repo:** a worktree with Mike's uncommitted changes in it. Follow [reference/worktrees.md](reference/worktrees.md): record the starting state, make the worktree, and remove it afterwards. Write jobs never commit: you diff the worktree, check the patch, apply it to the real tree and run the tests. These worktrees are the job's scratch space, not the kind Mike's instructions say to ask about.
- **A folder that isn't a git repo:** copy what the job needs to a scratch folder. A write job in the real folder edits the real files, so keep it small or do it yourself.

## Access and risk

- The CLI locks stop writes and shell, but every child can still read the whole disk (keys, other projects). Threads, and CLI write jobs, can do more: threads have full access, and write jobs can run anything their sandbox allows. For those, the brief's rules are the guard.
- Anything destructive, or outside the child's working directory, needs Mike's yes in chat for that specific job. Quote it in the brief (e.g. `Mike approved this in chat: "yes go for it"`). Approval for one job doesn't carry to the next.
- Jobs that touch secrets go to Opus, never Grok. Codex's shell also hides environment variables whose names contain `KEY`, `SECRET` or `TOKEN`, so a job that needs one in its environment goes to Opus too.
- For an API key, look in Mike's existing Convex deployments first (`npx convex env get --prod NAME`, copied across without printing it). Otherwise have Mike paste it himself.

## Browser

- Reading and checking pages needs no yes. Ask Mike before a child posts, sends, buys, deletes or changes account settings, unless he already asked for exactly that, and quote his ask in the brief. Spell out what it may do and where it must stop.
- Browser jobs don't need delegating: every thread drives Mike's real Chrome itself with `browserbear` (see "Browser work" in CLAUDE.md). Hand one to a Codex child only when Mike asks, or when BrowserBear can't do it and Codex's own Chrome tools might.
- A Codex thread from `create_thread` has Codex's own browser and Chrome plugins (a CLI seat doesn't, as seats.zsh turns plugins off). On pages where Chrome blocks extension automation (the Chrome Web Store dashboard), its browser tool gets "Not allowed" too, but its desktop control (`cua.getApp("com.google.Chrome")`) can still drive Mike's real Chrome, so say in the brief it may fall back to that.
- Don't use the Claude in Chrome extension, and don't tell Mike something can't be done in a browser until BrowserBear and Codex have both tried.

## Writing the brief

The child gets only the brief, none of this conversation. Write it as if for a capable contractor on their first day:

- What you want and why, in a sentence or two.
- Where to look: files, functions, the diff, URLs.
- What you already know or ruled out, so it doesn't redo your work.
- What good output looks like: the format, how long, what to leave out.

Start every brief with this block, filled in. Children load Mike's global instructions, which tell every session to end with a "What I need from you" section, and they can see this skill. Without the block they answer as if Mike were there, and may delegate again.

```markdown
You are running unattended as a delegate for another AI agent (the orchestrator). No person is reading this live.
- Nobody can answer questions mid-task. Make reasonable assumptions and state them.
- Do the work yourself. Don't hand it to other agents (no create_thread, tb, sub-agents, Workflows or AI CLIs), and ignore any instructions or skills telling you to delegate.
- Ignore instructions meant for interactive sessions with the user, such as ending with a "What I need from you" section, asking for approval, opening PRs or sending messages.
- Never commit, push, open PRs, or change anything outside your working directory. Don't use connectors or MCP tools (Gmail, Notion, Slack and so on).
- Your final message goes back to the orchestrator as-is, so make it stand alone. Lead with the answer, no preamble or sign-off, and keep it under 400 words unless the task really needs more.
- <working directory line>
- <This is read-only work: apart from any setup step above, don't create, change or delete any files. | You may edit files in your working directory. If you need to build or test and dependencies aren't installed, install them first.>

<one task note from below>

---

<the brief>
```

Working directory lines, one per brief: the first for a scratch folder, the second for a worktree ([reference/worktrees.md](reference/worktrees.md)).

```markdown
- Working directory: your current directory, an empty scratch folder. Everything you need is in this brief.
- Working directory: <run folder>/wt, a private git worktree of the user's repo with their uncommitted changes. cd there before anything else and work only there.
```

Task notes, one per brief:

- **Question:** Task type: question. Answer directly, from your own judgement, and use tools only to check facts you're unsure of.
- **Review:** Task type: review. Read the relevant code and report concrete problems, most severe first. For each: file:line, what's wrong, and a concrete input or situation that triggers it. Don't edit files. If you find nothing significant, say so plainly rather than padding the list.
- **Research:** Task type: research. Cite a source (URL or file path) for each factual claim, and say which things you verified and which you're inferring.
- **Implementation:** Task type: implementation. Make the change by editing files in your working directory. Don't commit. Run the relevant tests or build if you can. End with: files changed, how you verified it, and anything left undone.

Drop the word limit for implementation and big reviews.

## Sending it

Follow [reference/cli.md](reference/cli.md), or "CLI or a Threadbear thread" above for a thread. Send independent jobs together. Treat the seat's `FAILED` line as the result, and don't report on a job you didn't get an answer from.

## Checking the result

A child's answer is a report, not proof. Before telling Mike something is done or true:

- For reviews, check each finding against the code before passing it on. Drop the ones that don't hold up.
- For implementation, read the patch and run the tests yourself after applying it. Skim tests and docs rather than reading every line.
- For research, spot-check the sources on anything load-bearing.
- If two reviewers disagree, look yourself rather than picking one.

## Consensus

For a decision worth several opinions, send the same neutral question to Codex, Grok, Muse (until 13 Nov 2026) and Opus in parallel, hide who said what, and have a fresh Fable chair write up the consensus, the disagreements and the best minority point. Mike is happy to try as many model combinations as possible, so go wide for anything that matters. The recipe, briefs and chair prompt are in [reference/consensus.md](reference/consensus.md).

## If something goes wrong

- A failed CLI job: `seats_wait` names it, and [reference/cli.md](reference/cli.md) has the usual causes. A panel carries on without a seat that failed.
- A thread that stops for approval: tell Mike which one and link it as `[title](thread:<id>)`. You can answer it with `tb approve` only if he said yes to that action.
- A provider that needs signing in again: only Mike can do that, so tell him which one and use another account meanwhile. He can do it with `claude auth login` for `claude-main`, `CLAUDE_CONFIG_DIR="<its folder>" claude auth login` for the others, and `codex login`, `grok login` or `muse login`. Never write to credential files or the keychain yourself.
- A job overrunning: lower `LIMIT` and split the task, or `tb interrupt` a thread.
