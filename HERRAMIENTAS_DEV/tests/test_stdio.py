"""Exercise actual inherited pipes using pythonw, without creating an executable."""

import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from _stdio import prepare_stdio, StdioUnavailableError


class StdioTests(unittest.TestCase):
    def test_existing_capture_streams_are_preserved(self):
        stdout, stderr, stdin = io.StringIO(), io.StringIO(), io.StringIO("input")
        with patch.object(sys, "stdout", stdout), patch.object(sys, "stderr", stderr), patch.object(sys, "stdin", stdin):
            prepare_stdio(require_stdin=True)
            self.assertIs(sys.stdout, stdout)
            self.assertIs(sys.stderr, stderr)
            self.assertIs(sys.stdin, stdin)

    def test_missing_handles_raise_instead_of_redirecting_protocol_output(self):
        with patch.object(sys, "stdout", None), patch.object(sys, "stderr", None), patch("_stdio._restore_windows_streams"):
            with self.assertRaisesRegex(StdioUnavailableError, "stdout, stderr"):
                prepare_stdio()

    @unittest.skipUnless(os.name == "nt", "pythonw pipe recovery is Windows-specific")
    def test_pythonw_restores_unicode_pipes_and_standard_fds(self):
        pythonw = Path(sys.executable).with_name("pythonw.exe")
        if not pythonw.exists():
            self.skipTest("pythonw.exe is not installed")
        code = (
            f"import sys; sys.path.insert(0, {str(ROOT)!r}); "
            "from _stdio import prepare_stdio; prepare_stdio(require_stdin=True); "
            "import json; print(json.dumps({'line':sys.stdin.readline().strip(), "
            "'fds':[sys.stdin.buffer.fileno(),sys.stdout.buffer.fileno(),sys.stderr.buffer.fileno()]},ensure_ascii=False)); "
            "print('diagnóstico separado',file=sys.stderr)"
        )
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run([str(pythonw), "-c", code], cwd=directory,
                                    input="conexión PDF\n", capture_output=True, text=True,
                                    encoding="utf-8", timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {"line": "conexión PDF", "fds": [0, 1, 2]})
        self.assertEqual(result.stderr.strip(), "diagnóstico separado")


if __name__ == "__main__":
    unittest.main()
