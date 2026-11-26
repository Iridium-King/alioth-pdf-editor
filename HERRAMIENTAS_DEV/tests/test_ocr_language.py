from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import _ocr_service as ocr


class OcrLanguageTests(unittest.TestCase):
    def test_explicit_language_never_uses_an_unrelated_installed_language(self):
        for requested in ("es", "spa", "es-MX", "en", "eng", "en-US", "fr"):
            with self.subTest(requested=requested):
                self.assertIsNone(ocr.resolve_windows_ocr_language(requested, [{"tag": "de-DE"}]))

    def test_requested_language_and_regional_alternatives_are_preserved(self):
        installed = [{"tag": "de-DE"}, {"tag": "en-US"}, {"tag": "es-ES"}]
        for requested, expected in (("es", "es-ES"), ("es-MX", "es-ES"), ("en", "en-US"), ("en-US", "en-US")):
            with self.subTest(requested=requested):
                self.assertEqual(ocr.resolve_windows_ocr_language(requested, installed), expected)

    def test_automatic_and_mixed_language_modes_can_select_their_fallback(self):
        for requested in ("auto", "es+en", "spa+eng"):
            self.assertEqual(ocr.resolve_windows_ocr_language(requested, ["de-DE", "en-US"]), "en-US")
            self.assertEqual(ocr.resolve_windows_ocr_language(requested, ["de-DE"]), "de-DE")

    def test_missing_spanish_stops_before_native_ocr_or_pdf_processing(self):
        with patch.object(ocr, "list_windows_ocr_languages", return_value=[{"tag": "en-US"}]), \
             patch.object(ocr.subprocess, "run") as native, patch.object(ocr.fitz, "open") as pdf:
            with self.assertRaisesRegex(RuntimeError, "WINDOWS_OCR_UNAVAILABLE"):
                ocr.ocr_pages_windows(b"unused", lang="es")
            native.assert_not_called()
            pdf.assert_not_called()

    def test_no_installed_languages_returns_no_match(self):
        self.assertIsNone(ocr.resolve_windows_ocr_language("es", []))
