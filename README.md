# delegate

A skill that lets your main AI session in [T3 Code](https://github.com/pingdotgg/t3code) hand work to your other AI subscriptions, and get a second (and third, and fourth) opinion on things

macOS

## What it is

I kept running out of tokens on my main Claude account a day or so before the weekly reset, which is annoying when I've also got Codex, Grok, Muse and other Claude accounts sitting there with loads of room left. When I looked into where the tokens went, most of it was Claude Code's own sub-agents, and those always bill the account you're signed in with.

So this skill teaches my main session to hand jobs to the other subscriptions instead, using T3 Code's `delegate_task` tool, and only read back a short answer. Opus on another Claude account does the building and most other jobs, because it makes better choices. Codex, Grok and Muse get the menial stuff, give second opinions, and cover when the Claude accounts run low.

This used to be a CLI, with hooks and a stats command and whatnot. The trouble was it ran every job with the same locked down permissions, so Codex couldn't even resolve DNS on a research job, and its browser got every site declined. So I swapped it for a skill that had my main session call `codex`, `claude`, `grok` and `muse` itself, which worked but needed a lot of fiddly stuff around it, like stripping env vars so a child `claude` didn't run as the wrong account. Now I run everything in T3 Code, and T3 can start a child agent on any provider and model I've got set up, with each provider tied to one account, so the skill just uses that and most of the fiddly stuff is gone. The older versions live on in the git history.

## What the skill covers

- Which of my accounts to use for what, and checking who has room left with [Token Stats](https://github.com/mikecann/token-stats) (`token-stats limits`). Opus jobs go to whichever of my personal Claude accounts has the most room, and it only picks the one the session is running on when that one has loads more room, since it's already paying for the main session.
- Keeping work code with the work account. Anything Convex only goes to my Convex Claude account, and that account never gets anything else.
- Where each job runs. T3's child agents don't have a proper read-only mode, and I'd already found Grok and Muse would write files when asked not to, so anything that touches the repo gets its own git worktree with your uncommitted changes copied in. Write jobs never commit, and come back as a patch you look at before applying.
- Asking first. Children run with full access, so the brief's rules are the guard, and anything destructive, or a child posting or buying something in my real Chrome, only happens once I've said yes for that job.
- A preamble for every brief, so delegates don't answer as if I'm sitting there, or hand the job off again to yet another agent.
- Consensus panels. The same question goes to Codex, Grok, Muse and Opus without them seeing each other's answers, then a fresh Fable reads them all with the names hidden and writes up where they agree, where they don't, and the best point only one of them made. It's become my go-to for "hmm, which way should we do this" questions.

It's all pretty specific to my accounts and setup, so you'll want to change the account table and the Convex rule in `skill/SKILL.md` to suit yours.

## Get it

Paste this into your AI coding agent (Claude Code, Codex, Cursor...):

> Clone https://github.com/mikecann/delegate and make it my own. It's one of Mike
> Cann's personal tools, so read the README first, change anything specific to his
> setup in skill/SKILL.md to suit mine (the accounts and the Convex rule especially),
> then help me get it installed.

### Or set it up by hand

You'll need Git and [T3 Code](https://github.com/pingdotgg/t3code), with whichever providers you have (Claude, Codex, Grok, Muse) set up and signed in there.

```bash
git clone https://github.com/mikecann/delegate.git
cd delegate
bash install.sh
```

That just links `skill/` to `~/.claude/skills/delegate` and `~/.codex/skills/delegate` (Grok reads Claude's skills, so that covers all three). It's safe to run again, and you'll want to if you move the clone. `bash uninstall.sh` removes the two links.

### Upgrading from the old CLI

If you had the old CLI installed, run the old `bash uninstall.sh` before you pull, so it takes its hooks and the `delegate` command back out. If you've already pulled, remove `~/.local/bin/delegate` and the delegate hooks in `~/.claude/settings.json` by hand, then run `bash install.sh`. You can delete `~/.config/delegate` too, nothing reads it anymore.

## More tools

You can find my other tools at [mikerosoft.app](https://mikerosoft.app).

MIT licensed.
