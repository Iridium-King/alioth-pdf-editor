"""Source-only CLI acceptance tests; no binaries are built or launched."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import fitz

ROOT = Path(__file__).resolve().parents[2]
ENTRY = ROOT / "alioth.py"


class CLITests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="alioth-cli-")
        self.addCleanup(self.directory.cleanup)
        self.temp = Path(self.directory.name)
        self.pdf = self.temp / "prueba conexión.pdf"
        with fitz.open() as doc:
            page = doc.new_page()
            page.insert_text((72, 72), "Alioth original text")
            page.insert_text((72, 110), "Sensitive SECRET123 data")
            for x in [72, 180, 300]:
                page.draw_line((x, 160), (x, 220))
            for y in [160, 190, 220]:
                page.draw_line((72, y), (300, y))
            for x, y, text in [(80, 180, "Name"), (188, 180, "Value"),
                               (80, 210, "Alpha"), (188, 210, "42")]:
                page.insert_text((x, y), text)
            doc.new_page().insert_text((72, 72), "Second page")
            doc.save(self.pdf)

    def run_cli(self, *args, code=0, as_json=True):
        arguments = [str(arg) for arg in args]
        if as_json:
            arguments.append("--json")
        result = subprocess.run([sys.executable, str(ENTRY), *arguments], cwd=self.temp,
                                capture_output=True, encoding="utf-8", timeout=30)
        self.assertEqual(result.returncode, code, (result.stdout, result.stderr))
        if code:
            self.assertEqual(result.stdout, "")
            return json.loads(result.stderr) if as_json else result.stderr
        self.assertEqual(result.stderr, "")
        return json.loads(result.stdout) if as_json else result.stdout

    def test_read_commands_json_and_plain_text(self):
        info = self.run_cli("info", self.pdf.name)
        self.assertEqual(info["page_count"], 2)
        self.assertEqual(Path(info["filepath"]), self.pdf.resolve())
        text = self.run_cli("text", self.pdf, "--page", 0)
        self.assertIn("Second page", str(text))
        plain = self.run_cli("text", self.pdf, "--page", 1, as_json=False)
        self.assertIn("Alioth original text", plain)
        found = self.run_cli("search", self.pdf, "original")
        self.assertEqual(found["total_matches"], 1)
        table = self.run_cli("tables", self.pdf, "--format", "json")
        self.assertEqual(table["table_count"], 1)
        self.assertIn("Alpha", str(table))

    def test_pdf_writes_are_observable_and_keep_source(self):
        original = self.pdf.read_bytes()
        edited = self.temp / "edited.pdf"
        self.run_cli("replace", self.pdf, "original", "updated", "-o", edited)
        with fitz.open(edited) as doc:
            self.assertIn("updated", doc[0].get_text())
            self.assertNotIn("original", doc[0].get_text())
        redacted = self.temp / "redacted.pdf"
        self.run_cli("redact", self.pdf, "SECRET123", "-o", redacted)
        with fitz.open(redacted) as doc:
            self.assertNotIn("SECRET123", doc[0].get_text())
        image = self.temp / "page.png"
        self.run_cli("render", self.pdf, "--dpi", 72, "-o", image)
        self.assertTrue(image.read_bytes().startswith(b"\x89PNG\r\n\x1a\n"))
        organized = self.temp / "organized.pdf"
        self.run_cli("organize", self.pdf, "--rotate", "1:90", "--order", "2,1", "-o", organized)
        with fitz.open(organized) as doc:
            self.assertIn("Second page", doc[0].get_text())
            self.assertEqual(doc[1].rotation, 90)
        merged = self.temp / "merged.pdf"
        self.run_cli("merge", self.pdf, organized, "-o", merged)
        with fitz.open(merged) as doc:
            self.assertEqual(len(doc), 4)
        split = self.run_cli("split", merged, "--ranges", "1-2,3-4", "-o", self.temp / "parts")
        self.assertEqual(len(split["created_files"]), 2)
        for path in split["created_files"]:
            with fitz.open(path) as doc:
                self.assertEqual(len(doc), 2)
        self.assertEqual(self.pdf.read_bytes(), original)

    def test_exit_codes_and_machine_readable_errors(self):
        self.assertEqual(self.run_cli("info", "missing.pdf", code=1)["code"], "FILE_NOT_FOUND")
        self.assertEqual(self.run_cli("text", self.pdf, "--page", 99, code=1)["code"], "INVALID_ARGUMENTS")
        self.assertEqual(self.run_cli("replace", self.pdf, "original", "updated", code=2)["code"], "USAGE_ERROR")
        self.assertEqual(self.run_cli("render", self.pdf, "--dpi", 0, code=2)["code"], "USAGE_ERROR")
        self.assertEqual(self.run_cli("organize", self.pdf, "--rotate", "1:45", "-o", "bad.pdf", code=2)["code"], "USAGE_ERROR")
        before = self.pdf.read_bytes()
        error = self.run_cli("redact", self.pdf, "SECRET123", "-o", self.pdf, code=1)
        self.assertEqual(error["code"], "OUTPUT_CONFLICT")
        self.assertEqual(before, self.pdf.read_bytes())

    def test_encrypted_inputs_use_shared_password_handling(self):
        encrypted = self.temp / "encrypted.pdf"
        with fitz.open(self.pdf) as doc:
            doc.save(encrypted, encryption=fitz.PDF_ENCRYPT_AES_256,
                     owner_pw="owner-test", user_pw="reader-test")
        self.assertEqual(self.run_cli("info", encrypted, code=1)["code"], "PASSWORD_REQUIRED")
        info = self.run_cli("info", encrypted, "--password", "reader-test")
        self.assertEqual(info["page_count"], 2)
        text = self.run_cli("text", encrypted, "--password", "reader-test")
        self.assertIn("original", str(text))

    def test_global_json_and_pdf_prefix(self):
        result = self.run_cli("--json", "info", self.pdf, as_json=False)
        self.assertEqual(json.loads(result)["page_count"], 2)
        self.assertEqual(self.run_cli("pdf", "info", self.pdf)["page_count"], 2)


if __name__ == "__main__":
    unittest.main()
