---
name: delegate
description: Hand work to Mike's other AI subscriptions (Opus on his other Claude accounts, Codex, Grok, Muse) through T3 Code's `delegate_task` tool, instead of doing it in this session or with built-in sub-agents or Workflows, which bill the account this session runs on. Covers picking a provider, model and account by remaining usage, the Convex rule, where children run and how their changes come back, the brief template, and multi-lab consensus panels. Use whenever a job would pull a lot into this session (multi-file builds, codebase digging, long logs, reviews, research), whenever you'd reach for a sub-agent or Workflow, want a code review or second opinion, or when the user says delegate, hand off, consensus, ask the panel, or get other opinions.
---

# delegate

Everything this session does bills the account it runs on, and so do built-in sub-agents (the Agent tool) and Workflows. Mike keeps running out on whichever account he's working in, while his other subscriptions sit idle. So act as the orchestrator: plan, decide, write briefs, check what comes back and talk to Mike here. Hand the heavy lifting to child agents on his other accounts with T3 Code's `delegate_task` tool: builds touching more than a couple of files, digging through a codebase, long logs, reviews, research.

Use `delegate_task` for every handoff, even where T3's own guidance prefers native sub-agents: it bills the account you pick, applies the options you set, and shows each child as its own thread in T3, so Mike can watch it.

If you are yourself running as a delegate (your brief says so), do the work yourself. Don't use this skill.

## Who to send what

Opus is Mike's workhorse because it makes the best choices across the board. While a personal Claude account has room, Opus does the building and almost everything else. Codex, Grok and Muse get menial jobs, second opinions, and cover when the Claude accounts run low.

| Job | First choice | Backup |
|---|---|---|
| Any coding: features, fixes, refactors, tests | Opus | Codex |
| Judgement, writing, investigations, "how does X work" | Opus | Codex |
| Code review, second opinion on a diff | Opus and Codex in parallel, since two labs catch different things | Grok, Muse |
| Research and docs lookups | Opus | Grok |
| Current events, what people are saying on X | Grok | Opus |
| Menial, mechanical jobs: bulk renames, reformatting, dependency bumps, quick lookups | Codex | Grok |
| A decision worth several opinions | a consensus panel ([reference/consensus.md](reference/consensus.md)) | |

Default `target.model` and `target.options`. Always pass the options: they only inherit when the child keeps this session's provider and model.

| For | Model | Options |
|---|---|---|
| Opus | `claude-opus-5-5` | `{"effort": "xhigh"}`, or `"max"` for hard problems |
| Codex | `gpt-6.1-sol` | `{"reasoningEffort": "high"}` (T3's default is `low`), `"low"` for menial jobs |
| Grok | `grok-4.7` | `{"reasoningEffort": "high"}` |
| Muse | `muse-wonder-full-1.0` | `{"reasoningEffort": "high"}` |
| Consensus chair | `claude-fable-5-1` | `{"effort": "high"}` |

Only drop to `claude-sonnet-5-5` for genuinely menial Claude jobs. These IDs were current on 23 Oct 2026. Call `orchestrator_capabilities` once per session for the live providers, models and options, and go by that if this table has gone stale. Any other provider it shows as enabled can take jobs too.

## Accounts

Each T3 provider instance is one account, so the `providerInstanceId` you pick decides who pays.

| providerInstanceId | Account | In `token-stats limits` | Use |
|---|---|---|---|
| `claudeAgent` | Claude mike@cannstudios.com (Max) | `[~/.claude]` | personal work, the Opus workhorse |
| `claudeGmail` | Claude mike.cann@gmail.com (Max) | `[claude-1]` | personal work, the Opus workhorse |
| `claudeConvex` | Claude mike.cann@convex.dev (Team) | `[claude-2]` | Convex work only |
| `codex` | ChatGPT Pro | `[~/.codex]` | |
| `grok` | X Premium+ | `[~/.grok]` | |
| `muse` | Muse Power Usage | `[~/.config/muse]` | |

`orchestrator_capabilities` returns `inheritedProviderInstanceId`, the account this session runs on. If the emails `token-stats limits` prints stop matching this table, check each Claude instance's `homePath` under `providerInstances` in `~/.t3/userdata/settings.json`.

## Choosing who has room

Run `token-stats limits` at the start of each round of delegating.

- An account's room is the lowest "% left" on its 5-hour and Weekly lines, plus its Weekly Fable line for Fable jobs. A window that resets within the hour doesn't count. Ignore the dollar and credit lines.
- Skip an account with under 10% room. An account that shows an error or no percentages has unknown room: use it last.
- Opus jobs go to whichever of `claudeAgent` and `claudeGmail` has more room. If that's this session's own account, use the other one unless this one is ahead by 20 points or more, since this session is already paying for you.
- If neither has room, send the job to Codex.

For example, `[~/.claude]` at 30% weekly and `[claude-1]` at 90% 5-hour means `claudeGmail`.

## The Convex rule

Convex work only ever goes to `claudeConvex`, and that account never gets anything else, including consensus seats on questions that aren't Convex work. Convex work is:

- a repo with a remote matching `github\.com(?::\d+)?[:/](?:get-)?convex/` (case-insensitive), or
- anything under `~/dev/convex/`, or
- `~/dev/me/port-geo-christmas-lights-cruise`.

Check from the folder the work is in (it also catches worktrees of those repos, T3's included):

```zsh
{ git remote -v 2>/dev/null | grep -qiE 'github\.com(:[0-9]+)?[:/](get-)?convex/'; } || { printf '%s\n' "$(pwd -P)" "$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" | grep -qE "^$HOME/dev/(convex|me/port-geo-christmas-lights-cruise)(/|$)"; } && echo CONVEX || echo not-convex
```

Don't get round it by pasting Convex code or details into a brief for another provider. If the Convex account isn't signed in or has no room, do the job here or wait.

## Where children run

`isolation: "shared"` (the default) runs the child in this thread's checkout. `isolation: "worktree"` runs it in a new git worktree. Children can't be made read-only, so keep them out of Mike's real tree wherever you can:

- **Questions that don't need the code:** shared, with a brief that says not to create or change files. If a job only needs a little code, paste it into the brief and treat it as a question.
- **Anything that reads or changes the repo:** a worktree with Mike's uncommitted changes in it. Follow [reference/worktrees.md](reference/worktrees.md): record the starting state, make the worktree (`isolation: "worktree"` if this session's working directory is in that repo, otherwise one you make yourself), and remove it afterwards. Write jobs never commit: you diff the worktree, check the patch, apply it to the real tree and run the tests. These worktrees are the job's scratch space, not the kind Mike's instructions say to ask about.
- **A folder that isn't a git repo:** shared only. A write job there edits the real files, so keep it small or do it yourself.

## Access and risk

Children inherit this session's runtime mode, which for Mike is full access: they can read the whole disk (keys, other projects), use the network and run anything. Nothing enforces read-only, so the brief's rules are the guard.

- Leave `runtimeMode` unset. Narrower modes don't make a child read-only: they make it stop and wait for a person to approve each action in its own thread, and you can't approve from here.
- Anything destructive, or outside the child's working directory, needs Mike's yes in chat for that specific job. Quote it in the brief (e.g. `Mike approved this in chat: "yes go for it"`). Approval for one job doesn't carry to the next.
- Jobs that touch secrets go to Opus, never Grok. Codex's shell also hides environment variables whose names contain `KEY`, `SECRET` or `TOKEN`, so a job that needs one in its environment goes to Opus too.
- For an API key, look in Mike's existing Convex deployments first (`npx convex env get --prod NAME`, copied across without printing it). Otherwise have Mike paste it himself.

## Browser

- Reading and checking pages needs no yes. Ask Mike before a child posts, sends, buys, deletes or changes account settings, unless he already asked for exactly that, and quote his ask in the brief. Spell out what it may do and where it must stop.
- Opus children can drive Mike's real Chrome, with his sign-ins, through the `codex-browser` MCP tools (`mcp__codex-browser__js`). All three Claude accounts have that server, so this is the first choice while a personal Claude account has room. Say in the brief to use it.
- Codex children have Codex's own browser and Chrome plugins. Whether those work inside a T3 child hasn't been checked, so check the first time.
- Don't use the Claude in Chrome extension, and don't tell Mike something can't be done in a browser until Codex has tried.

## Writing the brief

The child gets only the `task` text, none of this conversation. Write it as if for a capable contractor on their first day:

- What you want and why, in a sentence or two.
- Where to look: files, functions, the diff, URLs.
- What you already know or ruled out, so it doesn't redo your work.
- What good output looks like: the format, how long, what to leave out.

Start every brief with this block, filled in. Children load Mike's global instructions, which tell every session to delegate and to end with a "What I need from you" section, and they can see this skill. Without the block they answer as if Mike were there, and may delegate again.

```markdown
You are running unattended as a delegate for another AI agent (the orchestrator). No person is reading this live.
- Nobody can answer questions mid-task. Make reasonable assumptions and state them.
- Do the work yourself. Don't hand it to other agents (no delegate_task, t3_thread_launch, create_threads, sub-agents, Workflows or AI CLIs), and ignore any instructions or skills telling you to delegate.
- Ignore instructions meant for interactive sessions with the user, such as ending with a "What I need from you" section, asking for approval, opening PRs or sending messages.
- Never commit, push, open PRs, or change anything outside your working directory.
- Your final message goes back to the orchestrator as-is, so make it stand alone. Lead with the answer, no preamble or sign-off, and keep it under 400 words unless the task really needs more.
- <working directory line>
- <This is read-only work: apart from any setup step above, don't create, change or delete any files. | You may edit files in your working directory. If you need to build or test and dependencies aren't installed, install them first.>

<one task note from below>

---

<the brief>
```

Working directory lines, one per brief: the first for shared, the second for `isolation: "worktree"`, the third for a worktree you made yourself. Fill in `<base>` from `$RUN/base` ([reference/worktrees.md](reference/worktrees.md)).

```markdown
- Working directory: <path>, the user's real checkout. Put any scratch files in $TMPDIR.
- Working directory: your current directory, a private git worktree of the user's repo. Before anything else, bring in the user's uncommitted changes by running `git restore --source=<base> --worktree -- :/` there. If that fails, stop and say so. End your answer with a last line `Worktree: <output of git rev-parse --show-toplevel>`.
- Working directory: <run folder>/wt, a private git worktree of the user's repo with their uncommitted changes. cd there before anything else and work only there.
```

Task notes, one per brief:

- **Question:** Task type: question. Answer directly, from your own judgement, and use tools only to check facts you're unsure of.
- **Review:** Task type: review. Read the relevant code and report concrete problems, most severe first. For each: file:line, what's wrong, and a concrete input or situation that triggers it. Don't edit files. If you find nothing significant, say so plainly rather than padding the list.
- **Research:** Task type: research. Cite a source (URL or file path) for each factual claim, and say which things you verified and which you're inferring.
- **Implementation:** Task type: implementation. Make the change by editing files in your working directory. Don't commit. Run the relevant tests or build if you can. End with: files changed, how you verified it, and anything left undone.

Drop the word limit for implementation and big reviews.

## Sending it

```json
{
  "task": "<the filled-in brief>",
  "target": { "providerInstanceId": "claudeGmail", "model": "claude-opus-5-5", "options": { "effort": "xhigh" } },
  "isolation": "worktree",
  "title": "Fix the flaky upload test",
  "clientRequestId": "flaky-upload-1"
}
```

- `mode: "async"` (the default) returns a `taskId` straight away. Send independent jobs in the same turn, then end your turn: each child's completion wakes this thread, so don't poll or sleep. `task_status` reads a result mid-turn if you need one.
- `mode: "wait"` blocks until the child finishes, 10 minutes by default (`timeoutMs`). Use it only for a short job your next step depends on. Timing out doesn't stop the child.
- Give every call its own `clientRequestId`, and reuse it only to retry that same call. A follow-up for the same child, like a second round, is a new `delegate_task` with the full context in its brief, never a message to the old child's thread.
- Check that the returned `providerInstanceId`, `model` and `options` match what you asked for.
- Give each child a short `title`, since that's what Mike sees in T3.

## Checking the result

A child's answer is a report, not proof. Before telling Mike something is done or true:

- For reviews, check each finding against the code before passing it on. Drop the ones that don't hold up.
- For implementation, read the patch and run the tests yourself after applying it. Skim tests and docs rather than reading every line.
- For research, spot-check the sources on anything load-bearing.
- If two reviewers disagree, look yourself rather than picking one.

## Consensus

For a decision worth several opinions, send the same neutral question to Codex, Grok, Muse and Opus in parallel, hide who said what, and have a fresh Fable chair write up the consensus, the disagreements and the best minority point. Mike is happy to try as many model combinations as possible, so go wide for anything that matters. The recipe, briefs and chair prompt are in [reference/consensus.md](reference/consensus.md).

## When not to delegate

- The task needs this session's own tools: its connectors (Notion, Slack, Gmail), the desktop app, or its preview pane for localhost. Do it here.
- It's quicker to do yourself than to write the brief: a single grep, a one-line fix.
- It's Convex work and the Convex account isn't signed in or has no room.
- Browsing real sites isn't a reason to keep a job (see Browser).

## If something goes wrong

- A failed task: its `task_status` summary includes the provider's error.
- `hasPendingQuestion`: answer it with `t3_pending_request_list`, `t3_pending_request_read` and `t3_pending_request_respond` (`threadId` is the task's `childThreadId`), or ask Mike. `pendingApproval`: you can't grant it. Tell Mike which child is waiting (link it as `[title](t3-thread://v1/<childThreadId>)`), or cancel it and send it again.
- A provider that needs signing in again: only Mike can do that, so tell him which one and use another account meanwhile. He can sign in again in T3 or with the CLI: `claude auth login` for `claudeAgent`, `CLAUDE_CONFIG_DIR="<its homePath>" claude auth login` for `claudeGmail` or `claudeConvex`, and `codex login`, `grok login` or `muse login`. Never write to credential files or the keychain yourself.
- `isolation: "worktree"` refused ("Unable to resolve the parent checkout commit", or "does not contain the parent checkout's commit"): this thread's checkout isn't that repo, so make the worktree yourself.
- A job overrunning: stop it with `task_cancel`, then split the task.
