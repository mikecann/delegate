# Run delegate jobs through the claude, codex, grok and opencode CLIs. Source this from a
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
#
# Every seat runs under taskpolicy -b (macOS background priority, throttled CPU and disk),
# and whatever it spawns inherits that. A Codex reviewer ran xcodebuild in its worktree on
# 5 Nov 2026 and loaded Mike's M5 for ten minutes at full priority. Logins still work under
# it: Codex's ChatGPT login and Claude's keychain login were both tested that day.

# A thread's environment carries its own login and session (CLAUDE_CONFIG_DIR,
# CLAUDE_EFFORT and more), so a child claude would bill the thread's account without this.
# Don't use env -i: wiping everything breaks Codex's ChatGPT login.
_seats_dir=${${(%):-%x}:A:h}
_seat_clean() { env $(env | awk -F= '/^(CLAUDE|ANTHROPIC)/ {printf "-u %s ", $1}') "$@"; }

# claude_seat <name> <account> <model> <effort>
# account: a login folder name (claude-1, claude-2, claude-3, claude-4), or "main" for
# ~/.claude (Threadbear's claude-main), which must leave CLAUDE_CONFIG_DIR unset (setting
# it, even to ~/.claude, picks a different keychain login). The login folders still live
# under "Token Stats/Accounts" though Token Stats itself was retired on 9 Nov 2026.
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
    cd "$DIR" && _seat_clean $cfg taskpolicy -b timeout ${LIMIT:-900} claude -p --model "$model" --effort "$effort" \
      $lock --strict-mcp-config --no-session-persistence \
      < "$RUN/brief-$name.md" > "$RUN/out-$name.md" 2> "$RUN/err-$name.log"
    echo "$name exit $?" >> "$RUN/status"
  ) &
}

# codex_seat <name> <model> <effort>
# -s read-only stops writes but not shell: Codex reads files by running commands, so
# commands still run inside a sandbox that blocks writes and some binaries (ps), and a
# reviewer can still start a build (xcodebuild, 5 Nov 2026). --disable shell_tool
# --disable unified_exec does stop shell, but then it can't read files either (tested
# 5 Nov), so the brief tells reviewers not to build, and taskpolicy -b keeps it light.
# Read-only doesn't stop connectors either, and -c 'mcp_servers={}' doesn't remove them.
# --ignore-user-config drops config.toml's servers (the login still works), and the two
# --disable flags drop the app and plugin ones.
# A global Codex install can come out with the launcher but no binary: on 20 Nov 2026
# `npm install -g @openai/codex@latest` ran a second before that release's
# codex-darwin-arm64 was published, npm skipped the optional package silently, and every
# seat died at once ("Missing optional dependency"). So check it starts, say how to fix
# it, and use Threadbear's own copy (checked before it's activated) until it's fixed.
_codex_bin() {
  if codex --version >/dev/null 2>&1; then print codex; return; fi
  local tb="$HOME/Library/Application Support/Threadbear/tools/codex/current/node_modules/.bin/codex"
  print -u2 "delegate: the codex on PATH ($(command -v codex || echo none)) doesn't start: $(codex --version 2>&1 | grep -m1 -v '^ *at ')"
  print -u2 "  Fix: npm install -g @openai/codex@latest, then check codex --version."
  "$tb" --version >/dev/null 2>&1 || return 1
  print -u2 "  Using Threadbear's copy until then."
  print -r -- "$tb"
}

codex_seat() {
  local name=$1 model=$2 effort=$3 sandbox=read-only bin
  [[ -n $WRITE ]] && sandbox=workspace-write
  bin=$(_codex_bin 2>>"$RUN/err-$name.log") || { echo "$name exit NOCODEX" >> "$RUN/status"; return; }
  (
    taskpolicy -b timeout ${LIMIT:-900} "$bin" exec --ignore-user-config --disable apps --disable plugins \
      -m "$model" -c "model_reasoning_effort=\"$effort\"" -s $sandbox --skip-git-repo-check \
      -C "$DIR" -o "$RUN/out-$name.md" - < "$RUN/brief-$name.md" >> "$RUN/err-$name.log" 2>&1
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
    taskpolicy -b timeout ${LIMIT:-900} grok --prompt-file "$RUN/brief-$name.md" -m "$model" --effort "$effort" $lock \
      --cwd "$DIR" > "$RUN/out-$name.md" 2> "$RUN/err-$name.log" < /dev/null
    local code=$?
    grep -q 'name no tool' "$RUN/err-$name.log" && code=UNLOCKED
    echo "$name exit $code" >> "$RUN/status"
  ) &
}

# opencode_seat <name> <model> <effort>
# OpenCode bills Mike's OpenCode Zen balance (opencode.ai/console), not a subscription, and
# reaches other labs' models through it: opencode/gpt-6.1-sol, opencode/grok-4.7, Gemini.
# The lock is the permission config: "*" deny with read, grep, glob and list allowed. Denied
# tools aren't offered to the model at all, and a control run without it wrote a file and ran
# shell (tested 17 Nov 2026). The two DISABLE flags drop a project opencode.json and Claude
# Code's skills and MCP servers. Reading outside DIR is denied too. effort is the variant
# (low, high, max).
# OpenCode 2 (17 Nov 2026) changed three things the lock rests on. `run` talks to a shared
# background server (`opencode service`) by default and takes that server's config, not
# this one's: with a permissive server up, a deny-all run still wrote a file. --standalone
# gives it a private server, where the lock held. --pure, --variant and --dir are gone: the
# plugins rule turns Mike's plugins off and OpenCode's own (`opencode.*`) back on, the
# variant goes on the model as model#variant, and the job runs from DIR. 1 ignores the rule.
# 2 also imports a plugin (running its top-level code) before that rule applies, and starts
# the user's MCP servers, so it gets an empty OPENCODE_CONFIG_DIR of its own, which replaces
# ~/.config/opencode there (1 adds it as an extra, empty folder). 2 reads
# OPENCODE_CONFIG_PROJECT_DISABLE before the older name, so both are set, and OPENCODE_CONFIG
# (one more file, read even with the project off) is blanked, which reads as unset.
# OpenCode 1 imports a folder's .opencode/plugins/*.js whatever it's told (1.19.5, 17 Nov
# 2026), so a locked seat on 1 refuses a DIR with plugins up the tree.
# OPENCODE_BIN: another OpenCode to try (tests).
opencode_seat() {
  local name=$1 model=$2 effort=$3 oc=${OPENCODE_BIN:-~/.opencode/bin/opencode} run=()
  local cfg='{"permission":{"*":"deny","read":"allow","grep":"allow","glob":"allow","list":"allow"RESEARCH_TOOLS},"mcp":{},"plugins":["-*","opencode.*"]}'
  cfg=${cfg/RESEARCH_TOOLS/${RESEARCH:+,\"webfetch\":\"allow\",\"websearch\":\"allow\"}}
  [[ -n $WRITE ]] && cfg='{"mcp":{},"plugins":["-*","opencode.*"]}'
  [[ -n $_oc_provider ]] && cfg="${cfg%\}},\"provider\":$_oc_provider}"
  if [[ $("$oc" --version 2>/dev/null) =~ '(^|[[:space:]])v?([0-9]+)\.' && $match[2] -ge 2 ]]; then
    run=(run --standalone -m "$model#$effort")
  else
    run=(run -m "$model" --variant "$effort" --dir "$DIR")
    local d=${DIR:A} p
    while [[ -z $WRITE ]]; do
      for p in $d/.opencode/plugin $d/.opencode/plugins; do
        if [[ -d $p && -n $(ls -A "$p" 2>/dev/null) ]]; then
          print -r -- "OpenCode 1 would run the plugins in $p before the read-only lock applies. Update it (opencode upgrade --major) or use another seat." > "$RUN/err-$name.log"
          : > "$RUN/out-$name.md"; echo "$name exit REFUSED" >> "$RUN/status"
          return 1
        fi
      done
      [[ $d == / ]] && break
      d=${d:h}
    done
  fi
  (
    local empty; empty=$(mktemp -d "${TMPDIR:-/tmp}/delegate-opencode-config.XXXXXX") || exit 1
    cd "$DIR" && env OPENCODE_PURE=1 OPENCODE_DISABLE_PROJECT_CONFIG=1 OPENCODE_CONFIG_PROJECT_DISABLE=1 OPENCODE_CONFIG_DIR="$empty" OPENCODE_CONFIG= \
      OPENCODE_DISABLE_CLAUDE_CODE=1 OPENCODE_CONFIG_CONTENT="$cfg" \
      taskpolicy -b timeout ${LIMIT:-900} "$oc" $run \
      "$(< "$RUN/brief-$name.md")" < /dev/null > "$RUN/out-$name.md" 2> "$RUN/err-$name.log"
    local code=$?
    rm -rf "$empty"
    echo "$name exit $code" >> "$RUN/status"
  ) &
}

# gemini_seat <name> <model> <effort>
# Google's models on Mike's own Gemini API key, through OpenCode with opencode_seat's lock.
# The fallback Gemini seat: agy_seat (below) is the default, on Mike's Google plan.
# The key is the "Delegate reviews (M5)" key in AI Studio project Gemini Reviews
# (gen-lang-client-0128847654), billed to the Convex billing account (Convex Ramp card) with
# prepay and a US$90/month spend cap that pauses the API. model is a Gemini API name such as
# gemini-4-neon. The brief gets the reading budget below appended, and the run's cost lands in
# cost-<name>.txt. The key only reaches OpenCode through the environment of this seat's own
# subshell.
# Tier 1 allows 2M input tokens a minute, and a review that reads a lot of files resends a
# big context every turn, so it hits that a few minutes in. OpenCode treats Google's 429 for
# it as a hard quota error and stops (19 Nov 2026), so OpenCode talks to Google through
# gemini-wait.py, which waits out per-minute 429s and passes everything else on. Its log is
# wait-<name>.log.
gemini_seat() {
  local name=$1 model=$2 effort=$3 key=~/.config/gemini/api-key
  if [[ ! -s $key ]]; then
    print -r -- "No Gemini key at $key." > "$RUN/err-$name.log"
    : > "$RUN/out-$name.md"; echo "$name exit NOKEY" >> "$RUN/status"
    return 1
  fi
  (
    local portf=$RUN/.wait-port-$name i
    rm -f "$portf"
    /usr/bin/python3 -I $_seats_dir/gemini-wait.py "$portf" "$RUN/wait-$name.log" &
    local proxy=$!
    for i in {1..50}; do [[ -s $portf ]] && break; sleep 0.1; done
    if [[ ! -s $portf ]]; then
      print -r -- "gemini-wait.py didn't start." > "$RUN/err-$name.log"
      : > "$RUN/out-$name.md"; echo "$name exit NOPROXY" >> "$RUN/status"
      kill $proxy 2>/dev/null; exit 1
    fi
    [[ -z $GEMINI_ROAM ]] && ! grep -q '^## Reading budget' "$RUN/brief-$name.md" && print -r -- "$_gemini_lean" >> "$RUN/brief-$name.md"
    export GOOGLE_GENERATIVE_AI_API_KEY=$(tr -d '\n' < $key)
    _oc_provider="{\"google\":{\"options\":{\"baseURL\":\"http://127.0.0.1:$(< $portf)/v1beta\"}}}"
    local since=$(( $(date +%s) * 1000 ))
    opencode_seat "$name" "google/$model" "$effort" && wait $!
    kill $proxy 2>/dev/null; rm -f "$portf"
    _gemini_cost "$name" $since
  ) &
}

# Pay-per-token seats are billed for every token on every step, and an agent re-sends all it
# has read each step. On 19 Nov 2026 Carbon reviews that roamed the repo cost US$1-3 each
# (5-11M tokens) and used half the US$90 monthly cap in two hours. The same Tandem review with
# the diff inline and this budget cost US$1.04 on Neon (US$3.31 roaming) and found the same
# main bugs. GEMINI_ROAM=1 leaves it off for a job that really has to explore.
_gemini_lean='
## Reading budget

Every file you read stays in your context and is billed again on every later step, so work mostly from what this brief gives you (the diff, the code it quotes):
- Read a file outside it only to confirm or rule out a specific suspicion, and only the lines you need (use offsets), never whole large files.
- Aim for about 8 reads or searches in total, then write your answer. Never re-read something you have already seen.'

# Writes OpenCode's own cost estimate for the seat's run to cost-<name>.txt, which seats_wait
# prints. Google's bill can come out higher than this (19 Nov 2026: about US$29 here against
# a cap alert at US$45), so it's a guide, not the bill.
_gemini_cost() {
  local name=$1 since=$2 db=~/.local/share/opencode/opencode.db dir=${DIR:A}
  [[ -r $db ]] || return 0
  /usr/bin/sqlite3 -readonly "file:$db?mode=ro" \
    "select printf('US\$%.2f, %dk new + %dk cached input, %dk output', sum(cost), sum(tokens_input)/1000, sum(tokens_cache_read)/1000, sum(tokens_output+tokens_reasoning)/1000) from session_v2 where directory in ('${dir//\'/\'\'}', '${DIR//\'/\'\'}') and time_created >= $since" \
    > "$RUN/cost-$name.txt" 2>/dev/null
}

# agy_seat <name> <model>
# Google's models on Mike's Google AI subscription, the way T3 Code runs them: Google's own
# unmodified antigravity-acp server (the ACP Registry build) driven over ACP by
# agy-acp.py, signed in with Mike's Google account. Google's FAQ says wrapping its agents
# in another agent can suspend the account; Mike chose to take that risk on 19 Nov 2026.
# The lock is ACP's permission flow (see agy-acp.py): only read and search tool calls are
# allowed, fetch too with RESEARCH, everything with WRITE. It's signed in from Antigravity's
# own ~/.gemini/antigravity-acp, the login Threadbear's Gemini threads use too (moved there
# from ~/.delegate/agy-home on 20 Nov 2026). Any MCP tool it has is refused by the lock. model is a
# value from the session's model list, e.g. gemini-4-neon (agy_models lists them); empty keeps the default.
# Pinned to 1.4.5: 1.5.0's session/new never answers on this Mac (19 Nov 2026).
# Not signed in: agy_login, see cli.md.
AGY_VERSION=1.4.5
_agy_env() {
  local bin=~/.delegate/agy-acp/$AGY_VERSION home=~/.gemini
  mkdir -p -m 700 $home/antigravity-acp/tmp
  env -u GEMINI_API_KEY -u GOOGLE_API_KEY -u GOOGLE_GENERATIVE_AI_API_KEY -u GOOGLE_APPLICATION_CREDENTIALS \
    GEMINI_HOME=$home AGY_ACP_FORCE_FILE_STORAGE=1 PYTHONUNBUFFERED=1 TMPDIR=$home/antigravity-acp/tmp \
    ANTIGRAVITY_HARNESS_PATH=$bin/localharness_external "$@"
}

# agy_install: downloads the pinned server from Google into a staging folder, checks both
# binaries are intact and signed by Google (team EQHXZ8M8AV), then moves it into place, so
# a half-finished install is never used. An existing install is checked the same way and
# replaced if it fails.
_agy_signed() { codesign --verify --strict -R='anchor apple generic and certificate leaf[subject.OU] = "EQHXZ8M8AV"' "$1" 2>/dev/null; }
agy_install() {
  local bin=~/.delegate/agy-acp/$AGY_VERSION stage
  _agy_signed $bin/agy_acp_server.par && _agy_signed $bin/localharness_external && return 0
  mkdir -p ~/.delegate/agy-acp && stage=$(mktemp -d ~/.delegate/agy-acp/.stage.XXXXXX) || return 1
  if curl -fsSL -o $stage/agy.zip \
      https://dl.google.com/agy-extensions/releases/macos/agy-acp-server-$AGY_VERSION-darwin-arm64.zip \
    && unzip -oq $stage/agy.zip -d $stage/out \
    && _agy_signed $stage/out/agy_acp_server.par && _agy_signed $stage/out/localharness_external; then
    rm -rf $bin && mv $stage/out $bin && rm -rf $stage
  else
    print -r -- "agy_install: download failed or a binary isn't intact and signed by Google."
    rm -rf $stage; return 1
  fi
}

# agy_models: lists the models Mike's plan offers.
agy_models() {
  _agy_env BROWSER=/usr/bin/false timeout 120 /usr/bin/python3 -I $_seats_dir/agy-acp.py \
    ~/.delegate/agy-acp/$AGY_VERSION/agy_acp_server.par models
}

# agy_login: prints a Google sign-in link and waits 5 minutes for it to be used.
agy_login() {
  agy_install || return 1
  _agy_env BROWSER="/bin/echo %s" timeout 300 /usr/bin/python3 -I $_seats_dir/agy-acp.py \
    ~/.delegate/agy-acp/$AGY_VERSION/agy_acp_server.par login
}
agy_seat() {
  local name=$1 model=$2 bin=~/.delegate/agy-acp/$AGY_VERSION mode=ro home=~/.gemini
  [[ -n $RESEARCH ]] && mode=research
  [[ -n $WRITE ]] && mode=write
  if ! _agy_signed $bin/agy_acp_server.par || ! _agy_signed $bin/localharness_external \
     || [[ ! -s $home/antigravity-acp/acp_token.json ]]; then
    print -r -- "antigravity-acp $AGY_VERSION isn't installed (intact and signed by Google) or signed in (see cli.md)." > "$RUN/err-$name.log"
    : > "$RUN/out-$name.md"; echo "$name exit NOLOGIN" >> "$RUN/status"
    return 1
  fi
  (
    _agy_env BROWSER=/usr/bin/false taskpolicy -b timeout ${LIMIT:-900} /usr/bin/python3 -I $_seats_dir/agy-acp.py $bin/agy_acp_server.par \
      "$DIR" "$RUN/brief-$name.md" "$RUN/out-$name.md" "$model" $mode 2> "$RUN/err-$name.log"
    echo "$name exit $?" >> "$RUN/status"
  ) &
}

# Waits for every seat, then prints how each went. A CLI can exit 0 with no answer, so a
# seat only counts as ok with a non-empty answer. 124 means it hit LIMIT. A Gemini API key
# over its monthly spend cap answers 403 "Spend cap breached" on every call (19 Nov 2026),
# which only Mike can lift, so that one is named rather than left in the log.
seats_wait() {
  wait
  local line name code
  while read -r line; do
    name=${line%% *}; code=${line##* }
    if [[ $code == 0 && -s $RUN/out-$name.md ]]; then echo "ok      $name"
    elif grep -qi 'spend cap breached' "$RUN/err-$name.log" 2>/dev/null; then echo "FAILED  $name (Gemini API spend cap hit, tell Mike; use agy_seat meanwhile)"
    else echo "FAILED  $name (exit $code, see err-$name.log)"; fi
    [[ -s $RUN/cost-$name.txt ]] && echo "        cost $(< $RUN/cost-$name.txt)"
  done < "$RUN/status"
  return 0
}
