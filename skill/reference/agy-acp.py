"""Minimal ACP client that runs one prompt through Google's antigravity-acp agent.

agy_seat in seats.zsh runs this. It does what T3 Code does: launch Google's own,
unmodified agy_acp_server over the Agent Client Protocol, signed in with Mike's Google
account, and send it one prompt. The read-only lock is ACP's permission flow: the
session stays in the agent's "default" mode, where every tool call asks the client
first, and this client allows only reads (plus searches and fetches with RESEARCH=1)
and rejects everything else. It also declares no file or terminal access of its own.

python3 -I agy-acp.py <server> <dir> <brief> <out> <model> <mode: ro|research|write>
python3 -I agy-acp.py <server> login
python3 -I agy-acp.py <server> models
Tool calls, permission answers and errors go to stderr. login prints Google's sign-in
link (run the server with BROWSER="/bin/echo %s") and waits up to 5 minutes for it.
"""

import json
import re
import shlex
import os
import subprocess
import sys
import shutil
import signal
import tempfile
import threading

server = sys.argv[1]
login = sys.argv[2:] == ["login"]
models = sys.argv[2:] == ["models"]
cwd, brief_path, out_path, model, mode = (sys.argv[2:7] if not (login or models) else [None] * 5)
# The server writes a skills/ folder into its session cwd, so the session runs from an
# empty folder of its own and the job's folder goes in as an additional directory.
home = tempfile.mkdtemp(prefix="agy-cwd-")
# File reads run without asking. "search" also covers web search, so it's
# only allowed with web access.
ALLOW = {"read"} | ({"search", "fetch"} if mode == "research" else set())

proc = subprocess.Popen([server], cwd=home, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                        stderr=subprocess.DEVNULL, text=True, bufsize=1,
                        encoding="utf-8", errors="replace")
lock = threading.Lock()
next_id = [0]
waiting = {}
reader_done = threading.Event()
answer = []


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def write(msg):
    with lock:
        proc.stdin.write(json.dumps(msg) + "\n")
        proc.stdin.flush()


def request(method, params):
    next_id[0] += 1
    rid = next_id[0]
    done = threading.Event()
    with lock:
        if reader_done.is_set():
            raise SystemExit(f"agent stopped answering before {method}")
        waiting[rid] = [done, None]
    write({"jsonrpc": "2.0", "id": rid, "method": method, "params": params})
    while not done.wait(1):
        pass
    msg = waiting.pop(rid)[1]
    if msg is None:
        raise SystemExit(f"agent exited during {method}")
    if "error" in msg:
        raise SystemExit(f"{method} failed: {json.dumps(msg['error'])[:2000]}")
    return msg["result"]


# The agent has no listing or code-search tool of its own: it runs grep and ls in a shell.
# So read-only seats allow one plain command from this list. Anything that could run
# another program or write (pipes, redirects, ;, &, $, backticks, subshells, env
# assignments) is refused. The shell still expands braces and globs after this check, so
# only programs with no option that writes or runs anything are listed: no find
# (`{-exec,touch}` expands to -exec, Codex review 19 Nov 2026), no rg (--pre), no sort (-o).
READ_COMMANDS = {"grep", "egrep", "fgrep", "ls", "cat", "head", "tail", "wc", "stat"}


def read_only_command(cmd):
    if not isinstance(cmd, str) or re.search(r"[$`\\\n\r!]", cmd):
        return False
    lex = shlex.shlex(cmd, posix=True, punctuation_chars=True)
    lex.whitespace_split = True
    lex.commenters = ""  # the shell only starts a comment at a word boundary
    try:
        words = list(lex)
    except ValueError:
        return False
    if not words or words[0] not in READ_COMMANDS:
        return False
    if any(w and set(w) <= set("();<>|&") for w in words):
        return False
    return True


def on_permission(msg):
    p = msg["params"]
    if os.environ.get("AGY_ACP_DEBUG"):
        log("permission request: " + json.dumps(p)[:3000])
    call = p.get("toolCall") or {}
    kind = call.get("kind") or "other"
    title = call.get("title") or ""
    opts = p.get("options") or []
    allowed = mode == "write" or kind in ALLOW or (
        kind == "execute" and read_only_command((call.get("rawInput") or {}).get("CommandLine")))
    want = "allow" if allowed else "reject"
    # Only a one-shot allow: an "always" grant could let later calls skip this check.
    # Any reject will do, since an "always" reject only refuses more.
    pick = next((o for o in opts if o.get("kind") == want + "_once"), None)
    if pick is None and want == "reject":
        pick = next((o for o in opts if (o.get("kind") or "").startswith("reject")), None)
    if pick is None:
        log(f"permission: no {want} option for {kind} {title!r}, cancelling")
        write({"jsonrpc": "2.0", "id": msg["id"], "result": {"outcome": {"outcome": "cancelled"}}})
        return
    log(f"permission: {want} {kind} {title!r}")
    write({"jsonrpc": "2.0", "id": msg["id"],
           "result": {"outcome": {"outcome": "selected", "optionId": pick["optionId"]}}})


def reader():
    try:
        for line in proc.stdout:
            try:
                handle(line)
            except Exception as e:  # a malformed message shouldn't leave requests waiting
                log(f"bad message from agent ({e!r}): {line[:300]!r}")
    except Exception as e:
        log(f"reader stopped: {e!r}")
    finally:
        with lock:
            reader_done.set()
            for entry in list(waiting.values()):
                entry[0].set()


def handle(line):
    try:
        msg = json.loads(line)
    except ValueError:  # BROWSER=/bin/echo prints the sign-in link here
        if "accounts.google.com" in line:
            log("Sign in here: " + line.strip())
        return
    if not isinstance(msg, dict):
        raise ValueError("not an object")
    method = msg.get("method")
    if method is None:
        entry = waiting.get(msg.get("id"))
        if entry:
            entry[1] = msg
            entry[0].set()
    elif method == "session/request_permission":
        try:
            on_permission(msg)
        except Exception:
            write({"jsonrpc": "2.0", "id": msg.get("id"), "result": {"outcome": {"outcome": "cancelled"}}})
            raise
    elif "id" in msg:  # fs, terminal or anything else we didn't offer
        log(f"refused agent request {method}")
        write({"jsonrpc": "2.0", "id": msg["id"],
               "error": {"code": -32601, "message": "not supported"}})
    elif method == "session/update":
        u = msg["params"]["update"]
        kind = u.get("sessionUpdate")
        if kind == "agent_message_chunk" and u.get("content", {}).get("type") == "text":
            answer.append(u["content"]["text"])
        elif kind == "tool_call":
            log(f"tool: {u.get('kind')} {u.get('title')!r} {u.get('status') or ''}")
        elif kind == "tool_call_update" and u.get("status") in ("failed",):
            log(f"tool failed: {u.get('toolCallId')}")


# timeout(1) ends a seat at LIMIT with SIGTERM: exit through finally so the answer so
# far is saved and the server and temp folder are cleaned up.
signal.signal(signal.SIGTERM, lambda *_: sys.exit(124))
threading.Thread(target=reader, daemon=True).start()
code = 1
try:
    request("initialize", {"protocolVersion": 1, "clientInfo": {"name": "delegate", "version": "1"},
                           "clientCapabilities": {"fs": {"readTextFile": False, "writeTextFile": False},
                                                  "terminal": False}})
    if login:
        r = request("authenticate", {"methodId": "oauth-personal"})
        log("signed in, plan: " + json.dumps(r.get("_meta", {}).get("antigravity", {}).get("tier", {}).get("name")))
        raise SystemExit(0)
    session = request("session/new", {"cwd": home, "mcpServers": [],
                                      "additionalDirectories": [cwd or home]})
    if models:
        for opt in session.get("configOptions", []):
            if opt.get("id") == "model":
                print("\n".join(o["value"] for o in opt["options"]))
        raise SystemExit(0)
    sid = session["sessionId"]
    if model:
        request("session/set_config_option", {"sessionId": sid, "configId": "model", "value": model})
    with open(brief_path) as f:
        result = request("session/prompt", {"sessionId": sid, "prompt": [{"type": "text", "text": f.read()}]})
    log(f"stop: {result.get('stopReason')}")
    code = 0 if result.get("stopReason") == "end_turn" else 3
    # Quota and capacity errors come back as the whole answer, not as an error.
    if code == 0 and re.match(r"(No capacity available|Quota exceeded|You have exhausted|RESOURCE_EXHAUSTED)",
                              "".join(answer).strip()):
        log("agent error: " + "".join(answer).strip()[:500])
        code = 4
except SystemExit as e:
    if isinstance(e.code, int):
        code = e.code
    else:
        log(str(e))
finally:
    try:
        if out_path:
            with open(out_path, "w") as f:
                f.write("".join(answer))
    finally:
        proc.kill()
        shutil.rmtree(home, ignore_errors=True)
sys.exit(code)
