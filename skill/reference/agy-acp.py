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
Tool calls, permission answers and errors go to stderr.

Stall watchdog: if the server sends nothing at all for STALL seconds (AGY_STALL, default
below) while a request is open, the session is ended and the whole job retried once from
a fresh server. A second stall exits 5, which seats.zsh records as STALLED. login prints Google's sign-in
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
import time

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


server = sys.argv[1]
login = sys.argv[2:] == ["login"]
models = sys.argv[2:] == ["models"]
cwd, brief_path, out_path, model, mode = (sys.argv[2:7] if not (login or models) else [None] * 5)
# File reads run without asking. "search" also covers web search, so it's
# only allowed with web access.
ALLOW = {"read"} | ({"search", "fetch"} if mode == "research" else set())
# On 20 Nov 2026 one review got its last event straight after a refused command and then
# nothing for 39 minutes, with the server idle, until it was killed by hand; ten other
# reviews that day finished in 5 to 9 minutes. The server doesn't stream its thinking, so a
# healthy turn can be silent for a while too: a 23 KB review that made no tool calls sent
# nothing for 271 s and then streamed its answer (measured the same day). 600 s leaves over
# twice that.
STALL = float(os.environ.get("AGY_STALL") or 600)
STALLED = 5
# agy_seat passes its LIMIT, so a retry that couldn't get a full stall window before
# timeout(1) ends it isn't started: the seat stops as STALLED rather than 124.
LIMIT = float(os.environ.get("AGY_LIMIT") or 0)
START = time.monotonic()
sessions = []  # every server started, so cleanup finds them even mid-construction


def log(msg):
    print(msg, file=sys.stderr, flush=True)


class Stalled(Exception):
    pass


class Session:
    """One server process and its ACP state. A retry gets a new one."""

    def __init__(self):
        self.proc = self.home = self.reader_thread = None
        self.answer = []
        sessions.append(self)
        # The server writes a skills/ folder into its session cwd, so the session runs from
        # an empty folder of its own and the job's folder goes in as an additional directory.
        self.home = tempfile.mkdtemp(prefix="agy-cwd-")
        # Its own process group, so close() also ends localharness_external and any tool it runs.
        # SIGTERM waits until the handle is stored, so cleanup can always find the server.
        signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGTERM})
        try:
            self.proc = subprocess.Popen([server], cwd=self.home, stdin=subprocess.PIPE,
                                         stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
                                         bufsize=1, encoding="utf-8", errors="replace",
                                         start_new_session=True)
        finally:
            signal.pthread_sigmask(signal.SIG_UNBLOCK, {signal.SIGTERM})
        self.lock = threading.Lock()
        self.next_id = 0
        self.waiting = {}
        self.reader_done = threading.Event()
        self.last_event = time.monotonic()
        self.reader_thread = threading.Thread(target=self.reader, daemon=True)
        self.reader_thread.start()

    def close(self):
        if self.proc and self.proc.returncode is None:  # a reaped pid can be reused
            try:
                os.killpg(self.proc.pid, signal.SIGKILL)
            except OSError:
                pass
            self.proc.kill()
            self.proc.wait()
            if self.reader_thread:  # let it take what's left in the pipe into the answer
                self.reader_thread.join(5)
        if self.home:
            shutil.rmtree(self.home, ignore_errors=True)

    def write(self, msg):
        with self.lock:
            self.proc.stdin.write(json.dumps(msg) + "\n")
            self.proc.stdin.flush()

    def send(self, msg):
        try:
            self.write(msg)
        except (OSError, ValueError):  # the server is gone; the reader ends the wait
            pass

    def request(self, method, params, watch=True):
        self.next_id += 1
        rid = self.next_id
        done = threading.Event()
        with self.lock:
            if self.reader_done.is_set():
                raise SystemExit(f"agent stopped answering before {method}")
            self.waiting[rid] = [done, None]
        self.last_event = time.monotonic()
        # Sent from a thread, so a server that stops reading its input (a big brief fills the
        # pipe) is caught by the watch below rather than blocking here.
        threading.Thread(target=self.send, daemon=True,
                         args=({"jsonrpc": "2.0", "id": rid, "method": method, "params": params},)).start()
        while not done.wait(1):
            quiet = time.monotonic() - self.last_event
            if watch and quiet > STALL:
                raise Stalled(f"no event from the agent for {quiet:.0f}s during {method}")
        msg = self.waiting.pop(rid)[1]
        if msg is None:
            raise SystemExit(f"agent exited during {method}")
        if "error" in msg:
            raise SystemExit(f"{method} failed: {json.dumps(msg['error'])[:2000]}")
        return msg["result"]

    def reader(self):
        try:
            for line in self.proc.stdout:
                try:
                    self.handle(line)
                except Exception as e:  # a malformed message shouldn't leave requests waiting
                    log(f"bad message from agent ({e!r}): {line[:300]!r}")
        except Exception as e:
            log(f"reader stopped: {e!r}")
        finally:
            with self.lock:
                self.reader_done.set()
                for entry in list(self.waiting.values()):
                    entry[0].set()

    def handle(self, line):
        try:
            msg = json.loads(line)
        except ValueError:  # BROWSER=/bin/echo prints the sign-in link here
            if "accounts.google.com" in line:
                log("Sign in here: " + line.strip())
            return
        if not isinstance(msg, dict):
            raise ValueError("not an object")
        self.last_event = time.monotonic()  # only real messages count as signs of life
        method = msg.get("method")
        if method is None:
            entry = self.waiting.get(msg.get("id"))
            if entry:
                entry[1] = msg
                entry[0].set()
        elif method == "session/request_permission":
            try:
                self.on_permission(msg)
            except Exception:
                self.write({"jsonrpc": "2.0", "id": msg.get("id"),
                            "result": {"outcome": {"outcome": "cancelled"}}})
                raise
        elif "id" in msg:  # fs, terminal or anything else we didn't offer
            log(f"refused agent request {method}")
            self.write({"jsonrpc": "2.0", "id": msg["id"],
                        "error": {"code": -32601, "message": "not supported"}})
        elif method == "session/update":
            u = msg["params"]["update"]
            kind = u.get("sessionUpdate")
            if kind == "agent_message_chunk" and u.get("content", {}).get("type") == "text":
                self.answer.append(u["content"]["text"])
            elif kind == "tool_call":
                log(f"tool: {u.get('kind')} {u.get('title')!r} {u.get('status') or ''}")
            elif kind == "tool_call_update" and u.get("status") in ("failed",):
                log(f"tool failed: {u.get('toolCallId')}")

    def on_permission(self, msg):
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
            self.write({"jsonrpc": "2.0", "id": msg["id"], "result": {"outcome": {"outcome": "cancelled"}}})
            return
        log(f"permission: {want} {kind} {title!r}")
        self.write({"jsonrpc": "2.0", "id": msg["id"],
                    "result": {"outcome": {"outcome": "selected", "optionId": pick["optionId"]}}})


def run(s):
    s.request("initialize", {"protocolVersion": 1, "clientInfo": {"name": "delegate", "version": "1"},
                             "clientCapabilities": {"fs": {"readTextFile": False, "writeTextFile": False},
                                                    "terminal": False}})
    if login:  # waits on a person, so no stall watch
        r = s.request("authenticate", {"methodId": "oauth-personal"}, watch=False)
        log("signed in, plan: " + json.dumps(r.get("_meta", {}).get("antigravity", {}).get("tier", {}).get("name")))
        return 0
    session = s.request("session/new", {"cwd": s.home, "mcpServers": [],
                                        "additionalDirectories": [cwd or s.home]})
    if models:
        for opt in session.get("configOptions", []):
            if opt.get("id") == "model":
                print("\n".join(o["value"] for o in opt["options"]))
        return 0
    sid = session["sessionId"]
    if model:
        s.request("session/set_config_option", {"sessionId": sid, "configId": "model", "value": model})
    with open(brief_path) as f:
        result = s.request("session/prompt", {"sessionId": sid, "prompt": [{"type": "text", "text": f.read()}]})
    log(f"stop: {result.get('stopReason')}")
    code = 0 if result.get("stopReason") == "end_turn" else 3
    # Quota and capacity errors come back as the whole answer, not as an error.
    if code == 0 and re.match(r"(No capacity available|Quota exceeded|You have exhausted|RESOURCE_EXHAUSTED)",
                              "".join(s.answer).strip()):
        log("agent error: " + "".join(s.answer).strip()[:500])
        code = 4
    return code


# timeout(1) ends a seat at LIMIT with SIGTERM: exit through finally so the answer so
# far is saved and the server and temp folder are cleaned up.
signal.signal(signal.SIGTERM, lambda *_: sys.exit(124))
code = 1
try:
    for attempt in (1, 2):
        try:
            code = run(Session())
            break
        except Stalled as e:
            code = STALLED
            # A write job isn't replayed: its first try may already have changed files.
            if attempt == 2 or mode == "write":
                log(f"stalled{' again' if attempt == 2 else ''}: {e}. Giving up (exit {STALLED}, STALLED).")
                break
            if LIMIT and LIMIT - (time.monotonic() - START) < STALL + 60:
                log(f"stalled: {e}. Not enough of LIMIT left for a retry. Giving up (exit {STALLED}, STALLED).")
                break
            log(f"stalled: {e}. Retrying once from a fresh server.")
            sessions[-1].close()
except SystemExit as e:
    if isinstance(e.code, int):
        code = e.code
    else:
        log(str(e))
        code = 1
finally:
    signal.signal(signal.SIGTERM, signal.SIG_IGN)  # don't let a late SIGTERM skip cleanup
    try:
        for sess in sessions:  # first, so no reader is still adding to the answer
            sess.close()
    finally:
        if out_path and sessions:
            with open(out_path, "w") as f:
                f.write("".join(sessions[-1].answer))
sys.exit(code)
