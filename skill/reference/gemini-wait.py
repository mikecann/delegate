"""Localhost pass-through to the Gemini API that waits out per-minute rate limits.

gemini_seat points OpenCode at this. Gemini answers a request over a per-minute limit
(Tier 1: 2M input tokens a minute) with a 429 whose text says "Quota exceeded", and
OpenCode 2.3 files any "quota exceeded" as a hard quota error and stops the run instead
of retrying (19 Nov 2026). Here a 429 whose quotas are all per-minute is retried after
the delay Google asks for. Any other answer, including per-day limits and the spend cap,
goes back to OpenCode untouched.

The API key travels in OpenCode's own request headers; this never reads or stores it.

python3 -I gemini-wait.py <port-file> <log-file>
Listens on 127.0.0.1 on a free port, writes the port to <port-file>, and exits when its
parent exits or after IDLE seconds without a request.
"""

import http.client
import http.server
import json
import os
import re
import sys
import threading
import time

UPSTREAM = "generativelanguage.googleapis.com"
TRIES = 12  # about 8 minutes of waiting at Google's usual 30-60 s delays
IDLE = 900
HOP = {"connection", "keep-alive", "transfer-encoding", "te", "trailer", "upgrade",
       "proxy-authorization", "proxy-authenticate", "host", "content-length",
       "accept-encoding", "server", "date"}

port_file, log_file = sys.argv[1], sys.argv[2]
log = open(log_file, "a", buffering=1)
last = time.monotonic()
active = 0  # requests in flight; idle time only counts when this is 0
lock = threading.Lock()


def say(msg):
    log.write(time.strftime("%H:%M:%S ") + msg + "\n")


def per_minute_delay(body):
    """Seconds to wait if this 429 is only per-minute limits, else None."""
    try:
        err = json.loads(body)
        err = (err[0] if isinstance(err, list) else err)["error"]
    except Exception:
        return None
    ids, delay = [], None
    for d in err.get("details") or []:
        for v in d.get("violations") or []:
            ids.append(v.get("quotaId") or v.get("quotaMetric") or "")
        if "retryDelay" in d:
            m = re.match(r"([\d.]+)s", str(d["retryDelay"]))
            delay = float(m.group(1)) if m else None
    if ids:
        if not all("PerMinute" in i for i in ids):
            return None
    elif "per minute" not in (err.get("message") or "").lower():
        return None
    return min(max(delay or 30.0, 1.0), 90.0) + 1.0


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def do_POST(self):
        self.relay()

    def do_GET(self):
        self.relay()

    def relay(self):
        global active, last
        with lock:
            active += 1
        try:
            self.forward()
        finally:
            with lock:
                active -= 1
                last = time.monotonic()

    def forward(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n) if n else None
        headers = {k: v for k, v in self.headers.items() if k.lower() not in HOP}
        for attempt in range(1, TRIES + 1):
            conn = http.client.HTTPSConnection(UPSTREAM, timeout=600)
            try:
                conn.request(self.command, self.path, body=body, headers=headers)
                resp = conn.getresponse()
            except OSError as e:
                conn.close()
                say(f"upstream error: {e}")
                self.send_error(502, str(e))
                return
            if resp.status == 429 and attempt < TRIES:
                err = resp.read()
                conn.close()
                wait = per_minute_delay(err)
                if wait is not None:
                    say(f"429 per-minute limit, waiting {wait:.0f}s (try {attempt})")
                    time.sleep(wait)
                    continue
                say("429 that isn't per-minute, passing it on")
                self.answer(resp, err)
                return
            say(f"{self.command} {self.path.split('?')[0]} {resp.status}")
            self.answer(resp, None, conn)
            return

    def answer(self, resp, buffered, conn=None):
        self.send_response(resp.status, resp.reason)
        for k, v in resp.getheaders():
            if k.lower() not in HOP:
                self.send_header(k, v)
        if buffered is not None:
            self.send_header("Content-Length", str(len(buffered)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(buffered)
            self.close_connection = True
            return
        # Stream through chunk by chunk: generation comes back as server-sent events.
        self.send_header("Transfer-Encoding", "chunked")
        self.send_header("Connection", "close")
        self.end_headers()
        try:
            while chunk := resp.read1(65536):
                self.wfile.write(b"%x\r\n%s\r\n" % (len(chunk), chunk))
                self.wfile.flush()
            self.wfile.write(b"0\r\n\r\n")
        except OSError:
            pass
        finally:
            conn.close()
            self.close_connection = True


def watchdog(parent):
    while True:
        time.sleep(5)
        if os.getppid() != parent or (active == 0 and time.monotonic() - last > IDLE):
            os._exit(0)


server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
threading.Thread(target=watchdog, args=(os.getppid(),), daemon=True).start()
with open(port_file + ".tmp", "w") as f:
    f.write(str(server.server_address[1]))
os.replace(port_file + ".tmp", port_file)
server.serve_forever()
