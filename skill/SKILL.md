---
name: delegate
description: Get answers from other AI labs and models (Codex, Grok, Muse, Fable, Opus) and run multi-lab consensus panels, through the claude, codex, grok and muse CLIs with read-only locks that hold. Use when Mike asks for it, e.g. he says send this to Codex (or Grok, Muse), get a second opinion or a review from another model or lab, consensus, or ask the panel, and to review a security fix or non-trivial bug fix before calling it done. Covers the Convex rule for other labs, where jobs run, the brief template and checking the answers. Picking a Claude or Codex login is Threadbear's job, through pools, so ordinary work stays in the current thread.
---

# delegate

For a second opinion, a review from another lab, a consensus panel, or a job Mike wants on a particular provider. Use it when he asks, and without asking for one standing case: reviewing a security fix or a non-trivial bug fix before calling it done (CLAUDE.md, "Other accounts"). Otherwise work in this thread, with built-in sub-agents if that helps.

## Reviewing a fix

Mike asked on 5 Nov 2026, after Threadbear's security fixes came back from a second scan with 6 of 10 still open: spend the tokens on a cross-lab review before anyone says "fixed".

- One Codex review (`gpt-6.1-sol`, effort `high`) in a worktree at the fix, task type Review. For Convex work, the Convex rule below still applies: use `claude-2`, not another lab.
- Give it the original report word for word (for a scanner, the finding and its "Remediation tests"), the diff (`git diff <base>..<fix>`), and the job: try to break the fix. First-use and old-version paths, inputs an attacker controls, and every remediation test the report lists.
- Check each thing it finds against the code, fix what holds up, and run the review again if the fix changed much. Tell Mike what it found and what you did about each.

Threadbear's pools already move threads between Claude and Codex logins as they run out of room, so don't delegate just to find room. If you are yourself running as a delegate (your brief says so), do the work yourself.

## Routes

- **Read-only answers, panels, and anything for Grok or Muse:** the CLIs, through [reference/cli.md](reference/cli.md). Grok and Muse aren't Threadbear accounts, and a Threadbear thread can't be read-only.
- **A Claude or Codex job Mike wants to watch or take over:** a new thread, with `create_thread` or `tb new`. Pass the whole brief, `pool` (`claude` or `codex`), `model`, `effort`, `folder`, `title` and `why`. Convex work sets `account: "claude-2"` instead of a pool, because a Convex repo outside `~/dev/convex` would otherwise land on a personal login. A thread doesn't report back by itself, so read it later with `read_thread`, or add `--wait` to `tb new` in a background Bash to get the transcript when it finishes. A thread has full access, so a write job's `folder` is a worktree.

## Models

If Mike names a model, use that. Always pass the effort.

| For | CLI model | `create_thread` model | Effort |
|---|---|---|---|
| Opus | `claude-opus-5-5` | `opus` | `xhigh`, or `max` for hard problems |
| Codex | `gpt-6.1-sol` | `gpt-6.1-sol` | `high` |
| Grok (the pick for current events and X) | `grok-4.7` | not available | `high` |
| Muse | `muse-wonder-full-1.0` | not available | `high` |
| Consensus chair | `claude-fable-5-1` | `fable` | `high` |

**Muse access ends on 13 Nov 2026** (Mike cancelled): after that, skip it everywhere in this skill. These IDs were current on 2 Nov 2026. If one has gone stale, `list_accounts` shows Claude and Codex models, and `grok models` shows Grok's.

A Claude seat on the CLI has no pool, so it names a login: `main`, `claude-1` or `claude-3` for personal work, whichever has most room in `token-stats limits` (`main` shows as `[~/.claude]`). Skip one under 10%. Go through [seats.zsh](reference/seats.zsh) rather than running `claude` yourself: a plain `claude` in a thread inherits that thread's login.

## The Convex rule

Convex work only ever goes to `claude-2`, and that account never gets anything else, including consensus seats on questions that aren't Convex work. Convex work is:

- a repo with a remote matching `github\.com(?::\d+)?[:/](?:get-)?convex/` (case-insensitive), or
- anything under `~/dev/convex/`, or
- `~/dev/me/port-geo-christmas-lights-cruise`.

Check from the folder the work is in (it also catches worktrees of those repos):

```zsh
{ git remote -v 2>/dev/null | grep -qiE 'github\.com(:[0-9]+)?[:/](get-)?convex/'; } || { printf '%s\n' "$(pwd -P)" "$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" | grep -qE "^$HOME/dev/(convex|me/port-geo-christmas-lights-cruise)(/|$)"; } && echo CONVEX || echo not-convex
```

Don't get round it by pasting Convex code or details into a brief for another provider. If `claude-2` isn't signed in or has no room, do the job here or wait.

**When Mike explicitly asks for other labs on Convex work,** his ask wins for that job, as it did on 2 Nov 2026 when he asked Fable, Astra, Muse and Grok to review a video script that was going on YouTube anyway:

- He has to have said it for this job: "get Grok and Codex on this" counts, "get a second opinion" doesn't (that stays on `claude-2`).
- Go ahead if the material is public or about to be. Send other labs only what the job needs, and generalise anything non-public (general channel numbers rather than the private dashboard).
- Private code, customer details, credentials or unreleased plans still don't leave `claude-2` unless he named that material. If you can't tell whether his ask covers it, ask him.
- Claude seats stay on `claude-2`. His ask opens the door to the labs he named, not to his personal Claude accounts.
- Tell him what went to whom when you report back.

## Where jobs run

- **Questions that don't need the code:** an empty scratch folder. If a job only needs a little code, paste it into the brief.
- **Anything that reads or changes the repo:** a worktree with Mike's uncommitted changes in it ([reference/worktrees.md](reference/worktrees.md)). Write jobs never commit: you diff the worktree, check the patch, apply it to the real tree and run the tests. These worktrees are the job's scratch space, not the kind Mike's instructions say to ask about.
- **A folder that isn't a git repo:** copy what the job needs to a scratch folder.

## Access and risk

- The CLI locks stop writes and shell, but every job can still read the whole disk (keys, other projects). For threads and write jobs, which can do more, the brief's rules are the guard.
- Anything destructive, or outside the job's working directory, needs Mike's yes in chat for that specific job. Quote it in the brief (e.g. `Mike approved this in chat: "yes go for it"`). The same goes for a job posting, sending or buying anything.
- Jobs that touch secrets stay in this thread or go to Opus, never Grok.
- Browser work doesn't need this skill: see "Browser work" in CLAUDE.md. Where Chrome blocks extensions (the Chrome Web Store dashboard), a Codex thread's desktop control (`cua.getApp("com.google.Chrome")`) can still drive it, so say so in that brief.

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

## Checking the result

A child's answer is a report, not proof. Before telling Mike something is done or true:

- For reviews, check each finding against the code before passing it on. Drop the ones that don't hold up.
- For implementation, read the patch and run the tests yourself after applying it. Skim tests and docs rather than reading every line.
- For research, spot-check the sources on anything load-bearing.
- If two reviewers disagree, look yourself rather than picking one.

## Consensus

For a decision worth several opinions, send the same neutral question to Codex, Grok, Muse (until 13 Nov 2026) and Opus in parallel, hide who said what, and have a fresh Fable chair write up the consensus, the disagreements and the best minority point. Mike is happy to try as many model combinations as possible, so go wide for anything that matters. The recipe, briefs and chair prompt are in [reference/consensus.md](reference/consensus.md).

## If something goes wrong

- A failed CLI job: `seats_wait` names it, and [reference/cli.md](reference/cli.md) has the usual causes. A panel carries on without a seat that failed. Don't report on a job you got no answer from.
- A provider that needs signing in again: only Mike can do that, so tell him which one and carry on without it. He can use `claude auth login` for `main`, `CLAUDE_CONFIG_DIR="<its folder>" claude auth login` for the others, and `codex login`, `grok login` or `muse login`. Never write to credential files or the keychain yourself.
