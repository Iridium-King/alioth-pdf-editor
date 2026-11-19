import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import fitz

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
import _pdf_engine as engine
import _proxy as proxy


class PdfGuiEngineTests(unittest.TestCase):
    def request(self, payload, **headers):
        body = payload if isinstance(payload, bytes) else json.dumps(payload).encode('utf-8')
        handler = object.__new__(proxy.AliothHandler)
        handler.path = '/api/pdf-tools'
        handler.command = 'POST'
        handler.headers = {
            'Origin': 'http://127.0.0.1:8765', 'Content-Type': 'application/json',
            'Content-Length': str(len(body)), **headers,
        }
        handler.rfile = io.BytesIO(body)
        sent = []
        def send(status, result):
            sent.append((status, result))
            return status, result
        handler._send_json = send
        handler._send_raw = lambda status, result, mime: send(status, json.loads(result))
        result = handler.do_POST()
        return result if result is not None else sent[-1]

    def test_existing_live_document_extractor_uses_the_shared_engine_contract(self):
        self.assertIs(proxy.extract_pdf_text, engine.read_text_bytes)

    def test_file_operations_use_engine_and_preserve_source_document(self):
        with tempfile.TemporaryDirectory(prefix='gui_motor_') as directory:
            source, redacted = Path(directory) / 'original.pdf', Path(directory) / 'copia.pdf'
            with fitz.open() as document:
                document.new_page().insert_text((40, 60), 'Visible SECRET')
                document.save(source)
            original = source.read_bytes()
            status, data = self.request({'operation': 'pdf_get_info', 'arguments': {'filepath': str(source)}})
            self.assertEqual(status, 200, data)
            self.assertTrue(data['ok'])
            self.assertEqual(data['result']['page_count'], 1)
            status, data = self.request({'operation': 'pdf_redact_sensitive_data', 'arguments': {
                'filepath': str(source), 'patterns': ['SECRET'], 'output_path': str(redacted),
            }})
            self.assertEqual(status, 200, data)
            self.assertEqual(source.read_bytes(), original)
            with fitz.open(redacted) as document:
                self.assertIn('Visible', document[0].get_text())
                self.assertNotIn('SECRET', document[0].get_text())

    def test_origin_and_request_limits_apply_before_any_engine_call(self):
        payload = {'operation': 'pdf_get_info', 'arguments': {'filepath': 'C:/document.pdf'}}
        with patch.object(proxy, 'execute_file_tool') as call:
            self.assertEqual(self.request(payload, Origin='https://foreign.example')[0], 403)
            self.assertEqual(self.request(payload, **{'Content-Length': '65537'})[0], 413)
            self.assertEqual(self.request(payload, **{'Content-Length': '-1'})[0], 400)
            self.assertEqual(self.request(payload, **{'Content-Length': 'invalid'})[0], 400)
            self.assertEqual(self.request(payload, **{'Content-Type': 'text/plain'})[0], 415)
            call.assert_not_called()

    def test_malformed_requests_unknown_functions_and_unsafe_paths_are_rejected(self):
        requests = [
            b'{"private-source":', [], {},
            {'operation': '__import__', 'arguments': {}},
            {'operation': 'pdf_get_info', 'arguments': []},
            {'operation': 'pdf_get_info', 'arguments': {'filepath': 'relative.pdf'}},
            {'operation': 'pdf_get_info', 'arguments': {'filepath': 'C:/Windows/document.pdf'}},
            {'operation': 'pdf_get_info', 'arguments': {'filepath': str(ROOT / 'config.ini')}},
            {'operation': 'pdf_splice_text', 'arguments': {'output_path': str(ROOT / 'injection.js')}},
        ]
        with patch.object(engine, 'execute') as call:
            for payload in requests:
                with self.subTest(payload=payload):
                    status, data = self.request(payload)
                    self.assertEqual(status, 400, data)
                    self.assertTrue(data['error'].startswith('INVALID_PDF_TOOL_'))
                    self.assertNotIn('private-source', str(data))
            call.assert_not_called()

    def test_unexpected_errors_and_engine_tracebacks_are_not_returned(self):
        payload = {'operation': 'pdf_get_info', 'arguments': {}}
        with patch.object(proxy, 'execute_file_tool', side_effect=RuntimeError('Private contents')):
            status, data = self.request(payload)
            self.assertEqual((status, data['error']), (503, 'PDF_ENGINE_UNAVAILABLE'))
            self.assertNotIn('Private', str(data))
        with patch.object(engine, 'execute', return_value={'error': 'Invalid PDF', 'trace': 'Private traceback'}):
            status, data = self.request(payload)
            self.assertEqual(status, 400)
            self.assertNotIn('trace', data)


if __name__ == '__main__':
    unittest.main()
