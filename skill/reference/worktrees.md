# Worktrees

For any child job that reads or changes a git repo. The git snippets were tested on 23 Oct 2026 in a throwaway repo with modified, staged, deleted, renamed, untracked, binary, symlinked and mode-changed files, and the flow again on 2 Nov 2026.

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

```zsh
RUN=<run folder>; REPO=$(cat "$RUN/repo")
git -C "$REPO" worktree add --quiet --detach "$RUN/wt" HEAD && git -C "$RUN/wt" restore --source="$(cat "$RUN/base")" --worktree -- :/
```

Then set `DIR=$RUN/wt` in the run script, or pass it as the thread's `folder`, and use the brief's worktree line (SKILL.md, "Writing the brief"). A write job through the CLI also sets `WRITE=1`.

## 3. See what it changed

```zsh
RUN=<run folder>; WT=$RUN/wt; B=$(cat "$RUN/base"); rm -f "$RUN/now.index"
GIT_INDEX_FILE="$RUN/now.index" git -C "$WT" add -A
NOW=$(GIT_INDEX_FILE="$RUN/now.index" git -C "$WT" write-tree)
git -C "$WT" diff --binary "$B" "$NOW" > "$RUN/patch.diff"; git -C "$WT" diff --stat "$B" "$NOW"
```

The stat should list only what the child says it changed. Read `$RUN/patch.diff`, skimming tests and docs and reading the core files properly.

## 4. Apply it to the real tree (write jobs)

```zsh
RUN=<run folder>; REPO=$(cat "$RUN/repo")
git -C "$REPO" apply --check --allow-empty "$RUN/patch.diff" && git -C "$REPO" apply --allow-empty "$RUN/patch.diff"
```

New files arrive untracked and Mike's index is left alone. If the check fails, nothing was changed: Mike's tree has moved on, so apply the relevant hunks by hand. Then run the tests yourself.

## 5. Remove the worktree

Do this when you're done with it, read-only jobs included:

```zsh
RUN=<run folder>; REPO=$(cat "$RUN/repo")
git -C "$REPO" worktree remove --force "$RUN/wt"
```
