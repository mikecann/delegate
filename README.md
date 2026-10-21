# delegate

A skill that lets your main Claude Code session hand work to your other AI subscriptions, and get a second (and third, and fourth) opinion on things

macOS

## What it is

I kept running out of tokens on my main Claude account a day or so before the weekly reset, which is annoying when I've also got Codex, Grok, Muse and other Claude accounts sitting there with loads of room left. When I looked into where the tokens went, most of it was Claude Code's own sub-agents, and those always bill the account you're signed in with.

So this skill teaches my main session to hand jobs to the other subscriptions instead, by running their CLIs headless and only reading back a short answer. Opus on another Claude account does the building and most other jobs, because it makes better choices. Codex, Grok and Muse get the menial stuff, give second opinions, and cover when the Claude accounts run low.

This used to be a CLI, with hooks and a stats command and whatnot. The trouble was it ran every job with the same locked down permissions, so Codex couldn't even resolve DNS on a research job, and its browser got every site declined. So rather than bolting more and more permission flags onto it, I've gone with letting my main session call `codex`, `claude`, `grok` and `muse` itself, with whatever permissions the job actually needs, and a skill that tells it how. The old CLI lives on in the git history.

## What the skill covers

- Which of my accounts to use for what, and checking who has room left with [Token Stats](https://github.com/mikecann/token-stats) (`token-stats limits`). It never touches my main account, or the one the session is running on.
- Keeping work code with the work account. Anything Convex only goes to my Convex Claude account, and that account never gets anything else.
- Stripping the parent session's Claude environment variables, which otherwise make a child `claude` run as the wrong account. That one caught me out for a while.
- Where each job runs. Read-only jobs get a throwaway copy of the repo with your uncommitted changes in it, because I found Grok and Muse would still write files when asked to stay read-only. Write jobs get their own worktree and branch, never commit, and come back as a patch you look at before applying.
- Access levels, from read-only up to network, write and full access, with the exact flags for each CLI that I've actually tested. Full access and Codex driving my real Chrome only happen once I've said yes for that job.
- A preamble for every brief, so delegates don't answer as if I'm sitting there, or hand the job off again to yet another agent.
- Consensus panels by hand. The same question goes to Codex, Grok, Muse and Opus without them seeing each other's answers, then a fresh Fable reads them all with the names hidden and writes up where they agree, where they don't, and the best point only one of them made. It's become my go-to for "hmm, which way should we do this" questions.

It's all pretty specific to my accounts and setup, so you'll want to change the account table and the Convex rule in `skill/SKILL.md` to suit yours.

## Get it

Paste this into your AI coding agent (Claude Code, Codex, Cursor...):

> Clone https://github.com/mikecann/delegate and make it my own. It's one of Mike
> Cann's personal tools, so read the README first, change anything specific to his
> setup in skill/SKILL.md to suit mine (the accounts and the Convex rule especially),
> then help me get it installed.

### Or set it up by hand

You'll need Git and whichever of these CLIs you have, signed in: [Codex](https://github.com/openai/codex) (`codex login`), Grok Build (`grok login`), Muse Code (`muse login`) and [Claude Code](https://claude.com/claude-code).

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
