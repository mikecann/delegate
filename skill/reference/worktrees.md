# Worktrees

For any child job that reads or changes a git repo. Every snippet here was tested on 23 Oct 2026 in a throwaway repo with modified, staged, deleted, renamed, untracked, binary, symlinked and mode-changed files.

## 1. Record the starting state

From inside the repo:

```zsh
RUN=~/.delegate/runs/$(date +%Y%m%d-%H%M%S)-<slug>; mkdir -p "$RUN"
git rev-parse --show-toplevel > "$RUN/repo"
GIT_INDEX_FILE="$RUN/base.index" git add -A && GIT_INDEX_FILE="$RUN/base.index" git write-tree > "$RUN/base"
echo "$RUN"; cat "$RUN/base"
```

`base` is a git tree of everything in the working tree that isn't ignored, uncommitted and untracked files included. It's built in a throwaway index, so Mike's index and files aren't touched and nothing is committed.

## 2. Make the worktree

- If this session's working directory is in that repo, pass `isolation: "worktree"`. T3 runs `git worktree add` from this checkout's HEAD commit into `~/.t3/worktrees/<repo folder>/` on a new branch, runs the T3 project's setup script if it has one, and starts the child there. It doesn't copy uncommitted changes, so use the brief's worktree line (SKILL.md, "Writing the brief"), which has the child restore `base` first.
- Otherwise `isolation: "worktree"` would check out the wrong repo, or fail. Make the worktree yourself, then run the child shared, using the brief's line for a worktree you made:

  ```zsh
  RUN=<run folder>; REPO=$(cat "$RUN/repo")
  git -C "$REPO" worktree add --quiet --detach "$RUN/wt" HEAD && git -C "$RUN/wt" restore --source="$(cat "$RUN/base")" --worktree -- :/
  ```

## 3. See what it changed

`WT` is the path the child ended its answer with, or `$RUN/wt`:

```zsh
RUN=<run folder>; WT=<worktree path>; B=$(cat "$RUN/base"); rm -f "$RUN/now.index"
GIT_INDEX_FILE="$RUN/now.index" git -C "$WT" add -A
NOW=$(GIT_INDEX_FILE="$RUN/now.index" git -C "$WT" write-tree)
git -C "$WT" diff --binary "$B" "$NOW" > "$RUN/patch.diff"; git -C "$WT" diff --stat "$B" "$NOW"
```

The stat should list only what the child says it changed. If it also shows Mike's own changes undone (his new files deleted, his edits reverted), the child skipped the restore: run it again with `B=$(git -C "$WT" rev-parse 'HEAD^{tree}')`. Read `$RUN/patch.diff`, skimming tests and docs and reading the core files properly.

## 4. Apply it to the real tree (write jobs)

```zsh
RUN=<run folder>; REPO=$(cat "$RUN/repo")
git -C "$REPO" apply --check --allow-empty "$RUN/patch.diff" && git -C "$REPO" apply --allow-empty "$RUN/patch.diff"
```

New files arrive untracked and Mike's index is left alone. If the check fails, nothing was changed: Mike's tree has moved on, so apply the relevant hunks by hand. Then run the tests yourself.

## 5. Remove the worktree

Do this when you're done with it, read-only jobs included. T3 leaves a child's worktree in place (its storage cleanup is off unless Mike turns it on). The guard refuses anything that isn't under `~/.t3/worktrees` or your own `$RUN/wt`:

```zsh
RUN=<run folder>; REPO=$(cat "$RUN/repo"); WT=<worktree path>
BR=$(git -C "$WT" branch --show-current)
[[ $WT != "$REPO" && ( $WT == "$HOME/.t3/worktrees/"* || $WT == "$RUN/wt" ) ]] && git -C "$REPO" worktree remove --force "$WT" && { [[ -z $BR ]] || git -C "$REPO" branch -D "$BR"; }
```

## Check the first time

What T3 does with `isolation: "worktree"` comes from reading T3's source on 23 Oct 2026, not a live run. The first time, check that the child reports a path under `~/.t3/worktrees/<repo folder>/` and is on a branch, that `git restore` worked there, and that T3 doesn't mind its child's worktree being removed. If Mike has moved T3's worktree folder (Settings > Storage), use that path in the guard.
