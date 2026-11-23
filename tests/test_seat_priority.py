"""Seat resource policy and existing lock arguments, without calling a provider."""
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest


SEATS = pathlib.Path(__file__).resolve().parents[1] / "skill/reference/seats.zsh"


class SeatPriorityTest(unittest.TestCase):
    def run_seat(self, seat, mode):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            binary = root / "bin"
            binary.mkdir()
            run = root / "run"
            run.mkdir()
            work = root / "work"
            work.mkdir()
            (run / "brief-probe.md").write_text("Read-only test brief.")
            home = root / "home"
            token = home / ".gemini/antigravity-acp/acp_token.json"
            token.parent.mkdir(parents=True)
            token.write_text("fake test token")
            log = root / "prefix.json"
            policy = binary / "taskpolicy"
            policy.write_text(
                f"#!{sys.executable}\n"
                "import json, os, pathlib, sys\n"
                "pathlib.Path(os.environ['PREFIX_LOG']).write_text(json.dumps({\n"
                " 'argv': sys.argv[1:],\n"
                " 'config': os.environ.get('OPENCODE_CONFIG_CONTENT')\n"
                "}))\n"
            )
            policy.chmod(0o755)
            for name in ("codex", "opencode"):
                executable = binary / name
                executable.write_text("#!/bin/sh\nprintf '2.0.0\\n'\n")
                executable.chmod(0o755)
            calls = {
                "claude": "claude_seat probe main test-model high",
                "codex": "codex_seat probe test-model high",
                "grok": "grok_seat probe test-model high",
                "opencode": "opencode_seat probe test-model high",
                "agy": "agy_seat probe test-model",
            }
            script = 'source "$1"; RUN=$2; DIR=$3; LIMIT=5; _agy_signed() { return 0; }; ' + calls[seat] + "; wait"
            env = dict(os.environ, HOME=str(home), PATH=str(binary) + os.pathsep + os.environ["PATH"],
                       PREFIX_LOG=str(log), OPENCODE_BIN=str(binary / "opencode"),
                       WRITE="1" if mode == "write" else "", RESEARCH="1" if mode == "research" else "")
            process = subprocess.run(["zsh", "-c", script, "zsh", str(SEATS), str(run), str(work)],
                                     env=env, capture_output=True, text=True, timeout=15)
            self.assertEqual(process.returncode, 0, process.stderr)
            self.assertTrue(log.exists(), process.stderr)
            return json.loads(log.read_text())

    def test_read_only_and_research_use_utility_write_stays_background(self):
        for seat in ("claude", "codex", "grok", "opencode", "agy"):
            for mode in ("ro", "research", "write"):
                with self.subTest(seat=seat, mode=mode):
                    result = self.run_seat(seat, mode)
                    argv = result["argv"]
                    prefix = ["-b"] if mode == "write" else ["-c", "utility"]
                    self.assertEqual(argv[:len(prefix) + 2], prefix + ["timeout", "5"])
                    if seat == "claude":
                        self.assertIn("--strict-mcp-config", argv)
                        self.assertEqual("--tools" in argv, mode != "write")
                        if mode != "write":
                            expected = "Read,Glob,Grep" + (",WebSearch,WebFetch" if mode == "research" else "")
                            self.assertEqual(argv[argv.index("--tools") + 1], expected)
                    elif seat == "codex":
                        self.assertIn("--ignore-user-config", argv)
                        self.assertEqual(argv[argv.index("-s") + 1], "workspace-write" if mode == "write" else "read-only")
                        self.assertEqual([argv[i + 1] for i, value in enumerate(argv) if value == "--disable"], ["apps", "plugins"])
                    elif seat == "grok":
                        self.assertEqual("--tools" in argv, mode != "write")
                        if mode != "write":
                            self.assertEqual(argv[argv.index("--disallowed-tools") + 1], "use_tool,search_tool")
                    elif seat == "opencode":
                        self.assertIn("--standalone", argv)
                        config = json.loads(result["config"])
                        self.assertEqual(config["mcp"], {})
                        self.assertEqual(config.get("permission", {}).get("*"), None if mode == "write" else "deny")
                    else:
                        self.assertEqual(argv[-1], mode)


if __name__ == "__main__":
    unittest.main()
