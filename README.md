# delegate

A skill that lets your main AI session in Threadbear get a second (and third, and fourth) opinion from other labs and models

macOS

## What it is

This started because I kept running out of tokens on my main Claude account a day or so before the weekly reset, so it taught my main session to hand jobs to my other accounts. Threadbear's pools do that bit for me now, moving a thread to another login when one runs low, so I've cut all of that out.

What's left is the stuff pools don't do. Sometimes I want a review from another lab, or to ask a few of them the same question and see where they disagree, and Grok and Muse aren't Threadbear accounts anyway, so this calls their CLIs and reads back a short answer.

This used to be a CLI, with hooks and a stats command and whatnot. The trouble was it ran every job with the same locked down permissions, so Codex couldn't even resolve DNS on a research job, and its browser got every site declined. So I swapped it for a skill that called `codex`, `claude`, `grok` and `muse` directly, and then for a while it ran on T3 Code's `delegate_task` tool. Now I run everything in Threadbear, which doesn't have that tool, so it's back to calling the CLIs, plus Threadbear's own `create_thread` when I want to watch a job as its own thread. The older versions live on in the git history.

The skill only kicks in when I ask for it, otherwise a thread just gets on with the job itself.

## What the skill covers

- Keeping work code with the work account. Anything Convex only goes to my Convex Claude account, and that account never gets anything else, unless I specifically ask for other labs on something that's going public anyway.
- Where each job runs and what it's allowed to do. Getting a CLI to actually be read-only is fiddlier than you'd think (`--allowedTools Read` on Claude still happily wrote files when I tested it), so the flags that really hold live in one small script. Anything that touches the repo also gets its own git worktree with your uncommitted changes copied in. Write jobs never commit, and come back as a patch you look at before applying.
- Asking first. Threads and write jobs can do a lot, so the brief's rules are the guard there, and anything destructive, or a child posting or buying something in my real Chrome, only happens once I've said yes for that job.
- A preamble for every brief, so delegates don't answer as if I'm sitting there, or hand the job off again to yet another agent.
- Consensus panels. The same question goes to Codex, Grok, Muse (my Muse access ends on 13 Nov so that seat's going away) and Opus without them seeing each other's answers, then a fresh Fable reads them all with the names hidden and writes up where they agree, where they don't, and the best point only one of them made. It's become my go-to for "hmm, which way should we do this" questions.

It's all pretty specific to my accounts and setup, so you'll want to change the logins and the Convex rule in `skill/SKILL.md` to suit yours.

## Get it

Paste this into your AI coding agent (Claude Code, Codex, Cursor...):

> Clone https://github.com/mikecann/delegate and make it my own. It's one of Mike
> Cann's personal tools, so read the README first, change anything specific to his
> setup in skill/SKILL.md to suit mine (the accounts and the Convex rule especially),
> then help me get it installed.

### Or set it up by hand

You'll need Git, zsh and whichever CLIs you have (`claude`, `codex`, `grok`, `muse`) installed and signed in. Threadbear is only needed for the bit that starts new threads.

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
