# Run delegate jobs through the claude, codex, grok and muse CLIs. Source this from a
# zsh script, set RUN and DIR, start seats, then call seats_wait. See cli.md.
#
# Every flag here was tested on 2 Nov 2026 by asking the model to write a file, run a
# shell command and call a connector. Change one only after testing it the same way:
# the obvious flags fail open (see the notes on each seat).
#
#   RUN       absolute run folder, holds brief-<name>.md, and gets out-<name>.md,
#             err-<name>.log and status
#   DIR       absolute folder the job works in: a scratch folder or a worktree
#   RESEARCH  set to 1 to add web tools to the Claude and Grok locks
#   WRITE     set to 1 to drop the locks, in a worktree or scratch folder only
#   LIMIT     seconds before a seat is killed, default 900

# A thread's environment carries its own login and session (CLAUDE_CONFIG_DIR,
# CLAUDE_EFFORT and more), so a child claude would bill the thread's account without this.
# Don't use env -i: wiping everything breaks Codex's ChatGPT login.
_seat_clean() { env $(env | awk -F= '/^(CLAUDE|ANTHROPIC)/ {printf "-u %s ", $1}') "$@"; }

# claude_seat <name> <account> <model> <effort>
# account: claude-1, claude-2 or claude-3, or "main" for ~/.claude, which must leave
# CLAUDE_CONFIG_DIR unset (setting it, even to ~/.claude, picks a different keychain login).
# --allowedTools doesn't lock anything: Mike's permission mode is auto, so writes and shell
# still ran. --tools removes the tools, and --strict-mcp-config removes Gmail, Notion and
# the rest, which --tools leaves in place.
claude_seat() {
  local name=$1 account=$2 model=$3 effort=$4 cfg=() lock=()
  [[ $account != main ]] && cfg=("CLAUDE_CONFIG_DIR=$HOME/Library/Application Support/Token Stats/Accounts/$account")
  if [[ -z $WRITE ]]; then
    lock=(--tools "Read,Glob,Grep${RESEARCH:+,WebSearch,WebFetch}")
  fi
  (
    cd "$DIR" && _seat_clean $cfg timeout ${LIMIT:-900} claude -p --model "$model" --effort "$effort" \
      $lock --strict-mcp-config --no-session-persistence \
      < "$RUN/brief-$name.md" > "$RUN/out-$name.md" 2> "$RUN/err-$name.log"
    echo "$name exit $?" >> "$RUN/status"
  ) &
}

# codex_seat <name> <model> <effort>
# -s read-only stops writes and shell but not connectors, and -c 'mcp_servers={}' doesn't
# remove them. --ignore-user-config drops config.toml's servers (the login still works),
# and the two --disable flags drop the app and plugin ones.
codex_seat() {
  local name=$1 model=$2 effort=$3 sandbox=read-only
  [[ -n $WRITE ]] && sandbox=workspace-write
  (
    timeout ${LIMIT:-900} codex exec --ignore-user-config --disable apps --disable plugins \
      -m "$model" -c "model_reasoning_effort=\"$effort\"" -s $sandbox --skip-git-repo-check \
      -C "$DIR" -o "$RUN/out-$name.md" - < "$RUN/brief-$name.md" > "$RUN/err-$name.log" 2>&1
    echo "$name exit $?" >> "$RUN/status"
  ) &
}

# grok_seat <name> <model> <effort>
# Plain grok writes and runs anything, and --permission-mode plan still runs shell. Only
# --tools locks it, and it fails open: one name it doesn't know leaves every tool available,
# with just a warning on stderr. So the warning is checked after the run. search_tool and
# use_tool are how it reaches connectors, so they go too.
grok_seat() {
  local name=$1 model=$2 effort=$3 lock=()
  if [[ -z $WRITE ]]; then
    lock=(--tools "read_file,grep,list_dir${RESEARCH:+,web_search,web_fetch}" --disallowed-tools use_tool,search_tool)
  fi
  (
    timeout ${LIMIT:-900} grok --prompt-file "$RUN/brief-$name.md" -m "$model" --effort "$effort" $lock \
      --cwd "$DIR" > "$RUN/out-$name.md" 2> "$RUN/err-$name.log" < /dev/null
    local code=$?
    grep -q 'name no tool' "$RUN/err-$name.log" && code=UNLOCKED
    echo "$name exit $code" >> "$RUN/status"
  ) &
}

# muse_seat <name> <model> <effort>
# Muse access ends 13 Nov 2026. --disable-write and --disable-shell both held, but nothing
# turns off its connectors server, so the brief is the guard there. It retries a failing
# stream every 60s up to 10 times, hence the shorter default limit.
muse_seat() {
  local name=$1 model=$2 effort=$3 lock=(--disable-write --disable-shell)
  [[ -n $WRITE ]] && lock=()
  (
    cd "$DIR" && timeout ${LIMIT:-600} muse exec --model "$model" --effort "$effort" $lock --approval-mode never \
      --prompt-file "$RUN/brief-$name.md" > "$RUN/out-$name.md" 2> "$RUN/err-$name.log" < /dev/null
    echo "$name exit $?" >> "$RUN/status"
  ) &
}

# Waits for every seat, then prints how each went. A CLI can exit 0 with no answer, so a
# seat only counts as ok with a non-empty answer. 124 means it hit LIMIT.
seats_wait() {
  wait
  local line name code
  while read -r line; do
    name=${line%% *}; code=${line##* }
    if [[ $code == 0 && -s $RUN/out-$name.md ]]; then echo "ok      $name"; else echo "FAILED  $name (exit $code, see err-$name.log)"; fi
  done < "$RUN/status"
}
