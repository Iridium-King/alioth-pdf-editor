"""Routing must keep CLI/MCP launches independent of GUI side effects."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch, Mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
import alioth


class EntrypointTests(unittest.TestCase):
    def test_pdf_and_empty_launches_only_the_gui_with_legacy_arguments(self):
        for args in [[], ["gui"], ["documento con espacios.pdf"], ["--launch-browser", "a.pdf"]]:
            with self.subTest(args=args), patch("runpy.run_module") as gui:
                seen = []
                gui.side_effect = lambda *a, **k: seen.append(sys.argv[1:].copy())
                original = sys.argv
                self.assertEqual(alioth.main(args), 0)
                self.assertIs(sys.argv, original)
                gui.assert_called_once_with("_proxy", run_name="__main__")
                self.assertIn("--launch-browser", seen[0])
                if any(item.endswith(".pdf") for item in args):
                    self.assertIn(args[-1], seen[0])

    def test_cli_arguments_do_not_reach_gui(self):
        cli = types.ModuleType("_cli")
        cli.main = Mock(return_value=7)
        for args, forwarded in [(["info", "a.pdf"], ["info", "a.pdf"]),
                                (["pdf", "text", "a.pdf"], ["text", "a.pdf"]),
                                (["--cli", "info", "a.pdf"], ["info", "a.pdf"]),
                                (["unknown"], ["unknown"])]:
            with self.subTest(args=args), patch.dict(sys.modules, {"_cli": cli}), patch("runpy.run_module") as gui:
                self.assertEqual(alioth.main(args), 7)
                cli.main.assert_called_with(forwarded)
                gui.assert_not_called()

    def test_mcp_serve_uses_only_the_mcp_entrypoint(self):
        mcp = types.ModuleType("mcp_server")
        mcp.main = Mock(return_value=0)
        for args in [["mcp", "serve"], ["--mcp"]]:
            with self.subTest(args=args), patch.dict(sys.modules, {"mcp_server": mcp}), patch("runpy.run_module") as gui:
                self.assertEqual(alioth.main(args), 0)
                mcp.main.assert_called_with([])
                gui.assert_not_called()

    def test_mcp_check_launches_the_unified_entrypoint(self):
        checker = types.ModuleType("_mcp_check")
        checker.main = Mock(return_value=0)
        with patch.dict(sys.modules, {"_mcp_check": checker}):
            self.assertEqual(alioth.main(["mcp", "check", "--timeout", "7"]), 0)
        checker.main.assert_called_once_with(["--timeout", "7.0"], server_command=[
            sys.executable, str(ROOT / "alioth.py"), "mcp", "serve",
        ])

    def test_source_and_frozen_configs_follow_the_current_location(self):
        source = alioth.mcp_configuration()["mcpServers"]["alioth-pdf"]
        self.assertEqual(source["args"], [str(ROOT / "alioth.py"), "mcp", "serve"])
        with patch.object(sys, "frozen", True, create=True), patch.object(sys, "executable", "C:/Portable/Alioth.exe"):
            frozen = alioth.mcp_configuration()["mcpServers"]["alioth-pdf"]
        self.assertEqual(frozen, {"command": "C:/Portable/Alioth.exe", "args": ["mcp", "serve"]})

    def test_config_subprocess_does_not_import_gui_or_mcp_sdk(self):
        code = (
            f"import sys; sys.path.insert(0, {str(ROOT)!r}); import alioth; "
            "alioth.main(['mcp','config']); "
            "assert '_proxy' not in sys.modules; assert 'mcp_server' not in sys.modules; "
            "assert not any(n == 'mcp' or n.startswith('mcp.') for n in sys.modules)"
        )
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run([sys.executable, "-c", code], cwd=directory,
                                    capture_output=True, text=True, encoding="utf-8", timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), alioth.mcp_configuration())

    @unittest.skipUnless(os.name == "nt", "pythonw is Windows-specific")
    def test_pythonw_runs_the_real_cli_with_unicode_relative_pdf_path(self):
        import fitz

        pythonw = Path(sys.executable).with_name("pythonw.exe")
        if not pythonw.exists():
            self.skipTest("pythonw.exe is not installed")
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory) / "datos conexión"
            folder.mkdir()
            pdf = folder / "prueba conexión.pdf"
            with fitz.open() as doc:
                doc.new_page().insert_text((72, 72), "Unified CLI check")
                doc.save(pdf)
            result = subprocess.run([
                str(pythonw), str(ROOT / "alioth.py"), "info",
                str(pdf.relative_to(directory)), "--json",
            ], cwd=directory, capture_output=True, text=True, encoding="utf-8", timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        result = json.loads(result.stdout)
        self.assertEqual(result["page_count"], 1)
        self.assertEqual(Path(result["filepath"]), pdf)

    def test_future_spec_routes_the_same_windowed_executable_to_alioth(self):
        import build_executables
        with tempfile.TemporaryDirectory() as directory, patch.object(build_executables, "BASE_DIR", directory):
            spec = Path(build_executables.generate_spec("test", False, Path(directory) / "version.txt"))
            content = spec.read_text()
            compile(content, str(spec), "exec")  # Syntax only; never run PyInstaller.
        self.assertIn("[r'alioth.py']", content)
        self.assertIn("console=False", content)
        self.assertIn("collect_submodules('mcp.server')", content)
        self.assertIn("excludes=['mcp.cli']", content)
        self.assertNotIn("('config.ini', '.')", content)


if __name__ == "__main__":
    unittest.main()
