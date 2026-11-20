"""Stall watchdog in skill/reference/agy-acp.py, against a fake ACP server.

python3 -m unittest discover -s tests   (from the repo root; takes about 35 seconds)
"""
import os, pathlib, shutil, subprocess, sys, tempfile, time, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
CLIENT = os.path.join(HERE, "..", "skill", "reference", "agy-acp.py")
SEATS = os.path.join(HERE, "..", "skill", "reference", "seats.zsh")
SERVER = os.path.join(HERE, "fake-acp-server.py")
# seats.zsh runs the client on the system Python
PY = "/usr/bin/python3" if os.path.exists("/usr/bin/python3") else sys.executable


class StallTest(unittest.TestCase):
    term_after = 0
    def run_client(self, mode="ro", brief="review this", **env):
        t = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, t, True)
        brief_path, out = os.path.join(t, "brief.md"), os.path.join(t, "out.md")
        pathlib.Path(brief_path).write_text(brief)
        self.pids = os.path.join(t, "pids")
        self.count = os.path.join(t, "count")
        e = dict(os.environ, **{"AGY_STALL": "2", "FAKE_COUNT": self.count, "FAKE_PIDS": self.pids, **env})
        start = time.monotonic()
        p = subprocess.Popen([PY, "-I", CLIENT, SERVER, t, brief_path, out, "", mode],
                             env=e, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if self.term_after:
            time.sleep(self.term_after)
            p.terminate()  # what timeout(1) sends at LIMIT
        self.err = p.communicate(timeout=60)[1]
        self.elapsed = time.monotonic() - start
        self.out = pathlib.Path(out).read_text() if os.path.exists(out) else None
        return p.returncode

    def servers_started(self):
        return int(pathlib.Path(self.count).read_text())

    def left_running(self):
        time.sleep(0.3)
        left = []
        for pid in pathlib.Path(self.pids).read_text().split():
            try:
                os.kill(int(pid), 0)
                left.append(pid)
            except ProcessLookupError:
                pass
        return left

    def test_quiet_twice_gives_up_with_its_own_exit(self):
        self.assertEqual(self.run_client(FAKE_PROMPT="quiet"), 5, self.err)
        self.assertIn("Retrying once", self.err)
        self.assertIn("stalled again", self.err)
        self.assertEqual(self.servers_started(), 2)
        self.assertLess(self.elapsed, 15)
        self.assertEqual(self.left_running(), [])

    def test_quiet_once_then_retry_answers(self):
        self.assertEqual(self.run_client(FAKE_FIRST="quiet", FAKE_PROMPT="answer"), 0, self.err)
        self.assertIn("Retrying once", self.err)
        self.assertEqual(self.out, "answer from server 2")
        self.assertEqual(self.left_running(), [])

    def test_children_holding_stdout_are_ended_too(self):
        self.assertEqual(self.run_client(FAKE_PROMPT="child"), 5, self.err)
        self.assertLess(self.elapsed, 15)
        self.assertEqual(self.left_running(), [])

    def test_server_that_stops_reading_a_big_brief_is_caught(self):
        self.assertEqual(self.run_client(FAKE_PROMPT="deaf", brief="x" * 1_000_000), 5, self.err)
        self.assertLess(self.elapsed, 15)
        self.assertEqual(self.left_running(), [])

    def test_slow_but_busy_session_is_left_alone(self):
        self.assertEqual(self.run_client(FAKE_PROMPT="chatty", FAKE_SECONDS="5"), 0, self.err)
        self.assertNotIn("stalled", self.err)
        self.assertEqual(self.out, "answer from server 1")

    def test_write_job_is_not_replayed(self):
        self.assertEqual(self.run_client(mode="write", FAKE_PROMPT="quiet"), 5, self.err)
        self.assertEqual(self.servers_started(), 1)

    def test_no_retry_without_room_in_limit(self):
        self.assertEqual(self.run_client(FAKE_PROMPT="quiet", AGY_LIMIT="10"), 5, self.err)
        self.assertIn("Not enough of LIMIT", self.err)
        self.assertEqual(self.servers_started(), 1)

    def test_other_failure_after_a_stall_is_not_called_a_stall(self):
        self.assertEqual(self.run_client(FAKE_FIRST="quiet", FAKE_PROMPT="error"), 1, self.err)
        self.assertIn("session/prompt failed", self.err)

    def test_limit_keeps_the_answer_so_far(self):
        self.term_after = 2
        self.assertEqual(self.run_client(FAKE_PROMPT="partial", AGY_STALL="30"), 124, self.err)
        self.assertEqual(self.out, "half an answer")
        self.assertEqual(self.left_running(), [])

    def test_seats_wait_names_a_stall(self):
        run = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, run, True)
        pathlib.Path(run, "status").write_text("gemini exit STALLED\n")
        p = subprocess.run(["zsh", "-c", 'source "$1"; RUN=$2; seats_wait', "zsh", SEATS, run],
                           capture_output=True, text=True, timeout=30)
        self.assertIn("FAILED  gemini (stalled", p.stdout)


if __name__ == "__main__":
    unittest.main()
