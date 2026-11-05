import base64
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import fitz

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
import _pdf_text as kernel


class PdfTextTests(unittest.TestCase):
    def source(self):
        with fitz.open() as document:
            document.new_page().insert_text((30, 60), 'Uno')
            document.new_page()
            document.new_page().insert_text((30, 60), 'Final inter-\nnacional')
            return document.tobytes()

    def test_poppler_preserves_page_boundaries_empty_pages_short_text_and_hyphens(self):
        pages = kernel.extract_pdf_text(self.source(), resource_dir=ROOT)
        self.assertEqual([p['page'] for p in pages], [1, 2, 3])
        self.assertEqual([p['text'] for p in pages], ['Uno', '', 'Final inter-\nnacional'])
        self.assertEqual(pages[0]['engine'], 'poppler')
        self.assertTrue(pages[0]['hasText'])

    def test_requested_pages_keep_their_order(self):
        pages = kernel.extract_pdf_text(self.source(), [2, 0], ROOT)
        self.assertEqual([p['page'] for p in pages], [3, 1])
        self.assertEqual([p['engine'] for p in pages], ['poppler', 'poppler'])

    def test_missing_poppler_and_timeouts_preserve_native_extraction(self):
        with tempfile.TemporaryDirectory() as directory:
            pages = kernel.extract_pdf_text(self.source(), resource_dir=directory)
        self.assertEqual(pages[0]['text'], 'Uno')
        self.assertEqual(pages[0]['engine'], 'pymupdf')
        with patch.object(kernel, '_poppler_pages', side_effect=subprocess.TimeoutExpired('pdftotext', 30)):
            pages = kernel.extract_pdf_text(self.source(), resource_dir=ROOT)
        self.assertEqual([p['page'] for p in pages], [1, 2, 3])
        self.assertTrue(all(p['engine'] == 'pymupdf' for p in pages))

    def test_cropped_pages_exclude_text_outside_the_visible_page(self):
        for rotation in [0, 90, 180, 270]:
            with fitz.open() as document:
                page = document.new_page()
                page.insert_text((30, 60), 'FUERA')
                page.insert_text((30, 350), 'VISIBLE')
                page.set_cropbox(fitz.Rect(0, 200, page.mediabox.width, page.mediabox.height))
                page.set_rotation(rotation)
                data = document.tobytes()
            result = kernel.extract_pdf_text(data, resource_dir=ROOT)
            self.assertNotIn('FUERA', result[0]['text'])
            self.assertEqual(result[0]['engine'], 'pymupdf')
            self.assertTrue(result[0]['text'])

    def test_invalid_pages_are_rejected(self):
        for indices in [[True], [-1], [3], '0', {}]:
            with self.assertRaises(ValueError):
                kernel.extract_pdf_text(self.source(), indices, ROOT)

    def test_incomplete_poppler_output_does_not_discard_pages(self):
        with patch.object(kernel, '_poppler_pages', side_effect=ValueError('PDF_TEXT_PAGE_MISMATCH')):
            result = kernel.extract_pdf_text(self.source(), resource_dir=ROOT)
        self.assertEqual(len(result), 3)
        self.assertIn('Final', result[2]['text'])


class PdfTextEndpointTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location('pdf_text_proxy_test', ROOT / '_proxy.py')
        cls.proxy = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.proxy)

    def request(self, body):
        handler = object.__new__(self.proxy.AliothHandler)
        handler.path = '/api/pdf/text'
        handler.headers = {'Origin': 'http://127.0.0.1:8765', 'Content-Length': str(len(body))}
        handler.rfile = io.BytesIO(body)
        handler._send_json = lambda status, payload: (status, payload)
        handler._send_raw = lambda status, payload, mime: (status, json.loads(payload))
        return handler.do_POST()

    def test_endpoint_extracts_supplied_bytes_without_accepting_paths_or_cli_options(self):
        pdf = PdfTextTests().source()
        request = {'pdfBase64': base64.b64encode(pdf).decode(), 'pageIndices': [2]}
        status, payload = self.request(json.dumps(request).encode())
        self.assertEqual(status, 200, payload)
        self.assertEqual(payload['pages'][0]['page'], 3)
        self.assertEqual(payload['pages'][0]['engine'], 'poppler')
        self.assertEqual(self.request(json.dumps({**request, 'path': 'C:/private.pdf'}).encode())[0], 400)

    def test_malformed_requests_fail_without_document_content_in_errors(self):
        for body in [b'{', b'[]', b'{"pdfBase64":"not-base64"}']:
            status, payload = self.request(body)
            self.assertEqual(status, 400)
            self.assertEqual(payload['error'], 'INVALID_PDF_TEXT_REQUEST')


if __name__ == '__main__':
    unittest.main()
