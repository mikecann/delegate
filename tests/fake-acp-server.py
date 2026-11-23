#!/usr/bin/env python3
"""A stand-in for agy_acp_server, for test_agy_stall.py.

FAKE_PROMPT says what it does:
  answer   send a reply chunk and end the turn
  quiet    on session/prompt send one tool call, then nothing again (the 20 Nov 2026 hang)
  child    like quiet, but first start a child that holds stdout open (localharness_external)
  deaf     stop reading stdin after session/new, so a big prompt fills the pipe
  chatty   send an update every second for FAKE_SECONDS, then answer
  error    answer session/prompt with a JSON-RPC error
  partial  send part of an answer, then nothing again
  mute     never answer initialize (the 23 Nov 2026 handshake hang)
  nosession  answer initialize, never answer session/new
FAKE_FIRST overrides FAKE_PROMPT for the first server started (counted in FAKE_COUNT).
Every server and child writes its pid to FAKE_PIDS.
"""
import json, os, subprocess, sys, time

count_file = os.environ["FAKE_COUNT"]
n = int(open(count_file).read() or 0) + 1 if os.path.exists(count_file) else 1
with open(count_file, "w") as f:
    f.write(str(n))


def note_pid(pid):
    with open(os.environ["FAKE_PIDS"], "a") as f:
        f.write(f"{pid}\n")


note_pid(os.getpid())
behaviour = os.environ.get("FAKE_FIRST") if n == 1 and os.environ.get("FAKE_FIRST") else os.environ["FAKE_PROMPT"]


def send(msg):
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


def update(u):
    send({"jsonrpc": "2.0", "method": "session/update", "params": {"sessionId": "s1", "update": u}})


if behaviour == "child":
    note_pid(subprocess.Popen(["sleep", "300"], stdin=subprocess.DEVNULL).pid)

for line in sys.stdin:
    msg = json.loads(line)
    method, rid = msg.get("method"), msg.get("id")
    if behaviour == "mute" or (behaviour == "nosession" and method == "session/new"):
        continue
    if method == "initialize":
        send({"jsonrpc": "2.0", "id": rid, "result": {"protocolVersion": 1}})
    elif method == "session/new":
        send({"jsonrpc": "2.0", "id": rid, "result": {"sessionId": "s1"}})
        if behaviour == "deaf":
            while True:
                time.sleep(60)
    elif method == "session/set_config_option":
        send({"jsonrpc": "2.0", "id": rid, "result": {}})
    elif method == "session/prompt":
        if behaviour == "diagnostics":
            update({"sessionUpdate": "tool_call", "toolCallId": "read-missing", "kind": "read",
                    "title": "Running view_file", "status": "in_progress",
                    "rawInput": {"AbsolutePath": "/workspace/NotARealFile.swift"}})
            update({"sessionUpdate": "tool_call_update", "toolCallId": "read-missing", "status": "failed",
                    "content": [{"type": "content", "content": {"type": "text",
                    "text": "Cannot view file /workspace/NotARealFile.swift which does not exist."}}]})
            update({"sessionUpdate": "tool_call", "toolCallId": "read-symlink", "kind": "read",
                    "title": "Running view_file", "status": "failed",
                    "locations": [{"path": "/workspace/node_modules/dependency/index.js"}],
                    "rawOutput": {"error": "Access to path is denied. It is outside the allowed workspace directories."}})
            for status in ("completed", "failed"):
                update({"sessionUpdate": "tool_call", "toolCallId": status, "kind": "read",
                        "title": "Running view_file", "status": status,
                        "content": [{"type": "content", "content": {"type": "text",
                        "text": "synthetic-secret-file-body-that-must-not-be-logged"}}]})
            update({"sessionUpdate": "tool_call", "toolCallId": "read-null", "kind": "read",
                    "title": "Running view_file", "status": "failed", "locations": None, "content": None})
            prompt = msg["params"]["prompt"][0]["text"]
            answer = "read guidance supplied" if "one plain ls or grep command" in prompt else "no read guidance"
            update({"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": answer}})
            send({"jsonrpc": "2.0", "id": rid, "result": {"stopReason": "end_turn"}})
            continue
        if behaviour == "partial":
            update({"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "half an answer"}})
            while True:
                time.sleep(60)
        if behaviour in ("quiet", "child"):
            update({"sessionUpdate": "tool_call", "kind": "read", "title": "view_file", "status": "pending"})
            while True:
                time.sleep(60)
        if behaviour == "error":
            send({"jsonrpc": "2.0", "id": rid, "error": {"code": -32000, "message": "boom"}})
            continue
        if behaviour == "chatty":
            for _ in range(int(os.environ.get("FAKE_SECONDS", "5"))):
                update({"sessionUpdate": "agent_thought_chunk", "content": {"type": "text", "text": "."}})
                time.sleep(1)
        update({"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": f"answer from server {n}"}})
        send({"jsonrpc": "2.0", "id": rid, "result": {"stopReason": "end_turn"}})
