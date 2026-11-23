"""A run script that's stopped or ends early takes every seat it started with it.

Starts one of each seat in seats.zsh against fake CLIs (no model calls), signals the
run script, and checks nothing it started is still running. The fakes leave a child in the
CLI's group and one in a session of its own that ignores TERM; the agy seat runs
agy-acp.py against fake-acp-server.py, whose server is in a session of its own too.

python3 -m unittest discover -s tests   (from the repo root)
"""
import os, pathlib, shutil, signal, subprocess, sys, tempfile, time, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SEATS = os.path.join(HERE, "..", "skill", "reference", "seats.zsh")
SERVER = os.path.join(HERE, "fake-acp-server.py")
CLIENT = os.path.join(HERE, "..", "skill", "reference", "agy-acp.py")
PY = "/usr/bin/python3" if os.path.exists("/usr/bin/python3") else sys.executable

FAKE_CLI = """#!/bin/sh
[ "$1" = --version ] && { echo 2.0.0; exit 0; }
echo $$ >> "$FAKE_PIDS"
if [ -n "$FAKE_DONE" ]; then
  while [ $# -gt 0 ]; do [ "$1" = -o ] && echo answer > "$2"; shift; done
  echo answer; exit 0
fi
sleep 300 & echo $! >> "$FAKE_PIDS"
perl -e 'use POSIX; POSIX::setsid(); $SIG{TERM} = "IGNORE"; exec "sleep", "301"' & echo $! >> "$FAKE_PIDS"
wait
"""

# claude, codex, grok, opencode and gemini's opencode write 3 pids each, agy's server 2
STARTED = 5 * 3 + 2

RUN_SCRIPT = """source "$SEATS"
_agy_signed() { true; }  # the fake server isn't signed by Google
claude_seat c main m e
codex_seat x m e
grok_seat g m e
opencode_seat o m e
gemini_seat gm m e
agy_seat a m
{EXIT}
seats_wait
"""

EXIT_EARLY = """until [[ -s $FAKE_PIDS && $(wc -l < $FAKE_PIDS) -ge {n} ]]; do sleep 0.2; done
exit 0""".replace("{n}", str(STARTED))


class SeatCleanupTest(unittest.TestCase):
    def start(self, exit_early=False, **env):
        t = self.t = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, t, True)
        home, run, bin_ = (os.path.join(t, d) for d in ("home", "run", "bin"))
        for d in (run, bin_, os.path.join(home, ".config", "gemini"),
                  os.path.join(home, ".gemini", "antigravity-acp"),
                  os.path.join(home, ".delegate", "agy-acp", "1.4.5")):
            os.makedirs(d)
        pathlib.Path(home, ".config", "gemini", "api-key").write_text("fake")
        pathlib.Path(home, ".gemini", "antigravity-acp", "acp_token.json").write_text("{}")
        agy = pathlib.Path(home, ".delegate", "agy-acp", "1.4.5", "agy_acp_server.par")
        shutil.copy(SERVER, agy)
        for name in ("claude", "codex", "grok", "opencode"):
            pathlib.Path(bin_, name).write_text(FAKE_CLI)
        for p in [agy, *pathlib.Path(bin_).iterdir()]:
            p.chmod(0o755)
        for name in ("c", "x", "g", "o", "gm", "a"):
            pathlib.Path(run, f"brief-{name}.md").write_text("review this")
        script = pathlib.Path(run, "run.sh")
        script.write_text(RUN_SCRIPT.replace("{EXIT}", EXIT_EARLY if exit_early else ""))
        self.pids = os.path.join(t, "pids")
        e = dict(os.environ, HOME=home, RUN=run, DIR=t, SEATS=SEATS, PATH=f"{bin_}:{os.environ['PATH']}",
                 OPENCODE_BIN=os.path.join(bin_, "opencode"), FAKE_PIDS=self.pids,
                 FAKE_COUNT=os.path.join(t, "count"), LIMIT="120", **{"FAKE_PROMPT": "child", **env})
        # its own group, like the shell Claude Code runs a background command in
        self.p = subprocess.Popen(["zsh", str(script)], env=e, cwd=t, start_new_session=True,
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.addCleanup(self.kill_leftovers)

    def wait_for_seats(self):
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            if os.path.exists(self.pids) and len(self.recorded()) >= STARTED:
                return
            time.sleep(0.2)
        self.fail(f"seats didn't start: {self.recorded()}")

    def recorded(self):
        return pathlib.Path(self.pids).read_text().split() if os.path.exists(self.pids) else []

    def running(self, full=False):
        """Every recorded pid still alive, and any process naming the test folder."""
        left = []
        for pid in self.recorded():
            try:
                os.kill(int(pid), 0)
                left.append(pid)
            except ProcessLookupError:
                pass
        ps = subprocess.run(["ps", "-axo", "pid=,command="], capture_output=True, text=True).stdout
        named = [l.strip() for l in ps.splitlines() if self.t in l]
        return left + (named if full else [l[:150] for l in named])

    def assert_all_stopped(self):
        self.p.wait(timeout=60)
        deadline = time.monotonic() + 10
        while self.running() and time.monotonic() < deadline:
            time.sleep(0.2)
        self.assertEqual(self.running(), [])

    def kill_leftovers(self):
        for pid in self.running(full=True):
            pid = pid.split()[0]
            try:
                os.kill(int(pid), signal.SIGKILL)
            except ProcessLookupError:
                pass
        if self.p.poll() is None:
            os.killpg(self.p.pid, signal.SIGKILL)
            self.p.wait()
        self.p.stdout.close()
        self.p.stderr.close()

    def test_term_to_the_scripts_group_stops_every_seat(self):
        self.start()
        self.wait_for_seats()
        os.killpg(self.p.pid, signal.SIGTERM)  # what TaskStop did on 23 Nov 2026
        self.assert_all_stopped()

    def test_hup_to_the_script_stops_every_seat(self):
        self.start()
        self.wait_for_seats()
        self.p.send_signal(signal.SIGHUP)
        self.assert_all_stopped()

    def test_int_to_the_script_stops_every_seat(self):
        self.start()
        self.wait_for_seats()
        self.p.send_signal(signal.SIGINT)
        self.assert_all_stopped()

    def test_script_that_exits_without_waiting_stops_every_seat(self):
        self.start(exit_early=True)
        self.wait_for_seats()
        self.assert_all_stopped()

    def test_finished_run_still_reports_every_seat(self):
        self.start(FAKE_DONE="1", FAKE_PROMPT="answer")
        out = self.p.communicate(timeout=120)[0]
        for name in ("c", "x", "g", "o", "gm", "a"):
            self.assertIn(f"ok      {name}\n", out)


class AgyClientSignalTest(unittest.TestCase):
    """agy-acp.py ends its server (in a session of its own) on any stop signal, keeps the answer
    so far, and a second signal can't cut that short."""

    def stop_client(self, *signals, server=False):
        t = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, t, True)
        brief, out, pids = (os.path.join(t, f) for f in ("brief.md", "out.md", "pids"))
        pathlib.Path(brief).write_text("review this")
        e = dict(os.environ, FAKE_PROMPT="partial", FAKE_PIDS=pids, FAKE_COUNT=os.path.join(t, "count"))
        p = subprocess.Popen([PY, "-I", CLIENT, SERVER, t, brief, out, "", "ro"], env=e,
                             stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
        recorded = lambda: pathlib.Path(pids).read_text().split() if os.path.exists(pids) else []
        self.addCleanup(lambda: [os.kill(int(pid), signal.SIGKILL) for pid in recorded() if alive(int(pid))])
        deadline = time.monotonic() + 60
        while not recorded() and time.monotonic() < deadline:
            time.sleep(0.1)
        time.sleep(1)  # let the partial answer arrive
        for sig in signals:
            os.kill(int(recorded()[0]), sig) if server else p.send_signal(sig)
            time.sleep(0.02)
        err = p.communicate(timeout=60)[1]
        time.sleep(0.3)
        return p.returncode, pathlib.Path(out).read_text(), [pid for pid in recorded() if alive(int(pid))], err

    def test_hup_ends_the_server(self):
        code, out, left, err = self.stop_client(signal.SIGHUP)
        self.assertEqual((code, out, left), (128 + signal.SIGHUP, "half an answer", []), err)

    def test_second_term_doesnt_skip_cleanup(self):
        code, out, left, err = self.stop_client(signal.SIGTERM, signal.SIGTERM)
        self.assertEqual((code, out, left), (124, "half an answer", []), err)

    def test_server_takes_a_plain_kill(self):
        # it used to start with SIGTERM blocked, inherited from the client
        code, out, left, err = self.stop_client(signal.SIGTERM, server=True)
        self.assertEqual((code, left), (1, []), err)
        self.assertIn("agent exited", err)


def alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False


if __name__ == "__main__":
    unittest.main()
