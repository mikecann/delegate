"""Read failure diagnostics against a fake ACP server, without a Google login."""
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
CLIENT = HERE.parent / "skill" / "reference" / "agy-acp.py"
SERVER = HERE / "fake-acp-server.py"
PY = "/usr/bin/python3" if pathlib.Path("/usr/bin/python3").exists() else sys.executable


class ReadDiagnosticsTest(unittest.TestCase):
    def run_client(self, mode="ro"):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            brief, out = root / "brief.md", root / "out.md"
            brief.write_text("review this")
            env = dict(os.environ, AGY_STALL="2", FAKE_PROMPT="diagnostics",
                       FAKE_COUNT=str(root / "count"), FAKE_PIDS=str(root / "pids"))
            result = subprocess.run([PY, "-I", str(CLIENT), str(SERVER), folder, str(brief),
                                     str(out), "", mode], env=env, capture_output=True,
                                    text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            return result.stderr, out.read_text()

    def test_failed_reads_name_paths_and_causes_without_logging_file_bodies(self):
        err, answer = self.run_client()
        self.assertIn('/workspace/NotARealFile.swift', err)
        self.assertIn('path does not exist', err)
        self.assertIn('/workspace/node_modules/dependency/index.js', err)
        self.assertIn('path resolves outside the workspace', err)
        self.assertNotIn('synthetic-secret-file-body', err)
        self.assertIn('read-null paths=[]: unrecognized error', err)
        self.assertEqual(answer, 'read guidance supplied')

    def test_write_jobs_do_not_get_read_only_guidance(self):
        _, answer = self.run_client(mode="write")
        self.assertEqual(answer, 'no read guidance')


if __name__ == "__main__":
    unittest.main()
