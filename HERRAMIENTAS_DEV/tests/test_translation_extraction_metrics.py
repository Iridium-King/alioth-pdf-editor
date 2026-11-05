import base64
import importlib.util
import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import fitz


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


proxy = load_module('extraction_metrics_proxy', ROOT / '_proxy.py')
kernel = load_module('extraction_metrics_kernel', ROOT / 'js' / 'pdf_translation.py')
CONTEXT = {'jobId': 'translation-job_test_metrics', 'sourceIndex': 0}


def sample_pdf(pages=1, image=False):
    with fitz.open() as document:
        for index in range(pages):
            page = document.new_page()
            page.insert_text((40, 50), f'Private source text for page {index}')
            if image:
                pixmap = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 8, 8), False)
                pixmap.clear_with(255)
                page.insert_image(fitz.Rect(40, 80, 80, 120), pixmap=pixmap)
        return document.tobytes()


class KernelExtractionMetricsTests(unittest.TestCase):
    def test_optional_diagnostics_keep_output_and_only_log_metadata(self):
        pdf = sample_pdf()
        expected = kernel.extract_translation_notes(pdf, 'null')
        events = []
        self.assertEqual(kernel.extract_translation_notes(pdf, 'null', events.append), expected)
        self.assertEqual([event['stage'] for event in events[::2]], [
            'native_pdf_open', 'native_page_text', 'native_page_images', 'native_page_parse'])
        for started, completed in zip(events[::2], events[1::2]):
            self.assertEqual(started['event'], 'extraction_stage_started')
            self.assertEqual(completed['event'], 'extraction_stage_completed')
            self.assertEqual(completed['stage'], started['stage'])
            self.assertEqual(completed['status'], 'ok')
            self.assertGreaterEqual(completed['durationMs'], 0)
            self.assertLessEqual(set(completed), {
                'event', 'stage', 'status', 'durationMs', 'pageIndex', 'byteLength', 'imageCount', 'unitCount'})
        self.assertEqual(events[-1]['unitCount'], len(json.loads(expected)))
        self.assertNotIn('Private source text', json.dumps(events))

    def test_broken_logger_does_not_change_extraction(self):
        pdf = sample_pdf()
        expected = kernel.extract_translation_notes(pdf, 'null')
        logger = Mock(side_effect=OSError('Private path and logger failure'))
        self.assertEqual(kernel.extract_translation_notes(pdf, 'null', logger), expected)
        self.assertTrue(logger.called)

    def test_disabled_diagnostics_do_not_read_clock(self):
        with patch.object(kernel.time, 'perf_counter', side_effect=AssertionError('unrequested timer')):
            self.assertTrue(json.loads(kernel.extract_translation_notes(sample_pdf(), 'null')))

    def test_selected_pages_have_distinct_counts(self):
        events = []
        result = json.loads(kernel.extract_translation_notes(sample_pdf(3), '[2,0,2]', events.append))
        parsed = [event for event in events if event['stage'] == 'native_page_parse'
                  and event['event'] == 'extraction_stage_completed']
        self.assertEqual([event['pageIndex'] for event in parsed], [0, 2])
        self.assertEqual(sum(event['unitCount'] for event in parsed), len(result))
        self.assertEqual({event['pageIndex'] for event in events if 'pageIndex' in event}, {0, 2})

    def test_failed_ocr_keeps_mixed_page_fallback_without_logging_error_text(self):
        pdf = sample_pdf(image=True)
        events = []
        with patch.object(fitz.Page, 'get_textpage_ocr', side_effect=RuntimeError('Private OCR detail')):
            expected = kernel.extract_translation_notes(pdf, 'null')
            self.assertEqual(kernel.extract_translation_notes(pdf, 'null', events.append), expected)
        result = json.loads(expected)
        self.assertTrue(any(item.get('needsOcr') for item in result))
        self.assertTrue(any(item.get('text', '').startswith('Private source text') for item in result))
        ocr = [event for event in events if event['stage'] == 'native_page_ocr'
               and event['event'] == 'extraction_stage_completed']
        self.assertEqual(len(ocr), 1)
        self.assertEqual(ocr[0]['status'], 'failed')
        self.assertEqual(ocr[0]['errorType'], 'RuntimeError')
        self.assertEqual(ocr[0]['imageCount'], 1)
        self.assertEqual(ocr[0]['ocrRegionCount'], 1)
        self.assertNotIn('Private', json.dumps(events))

    def test_invalid_pdf_keeps_error_and_logs_only_type(self):
        events = []
        with self.assertRaises(Exception) as original:
            kernel.extract_translation_notes(b'Private invalid PDF', 'null')
        with self.assertRaises(type(original.exception)) as measured:
            kernel.extract_translation_notes(b'Private invalid PDF', 'null', events.append)
        self.assertEqual(str(measured.exception), str(original.exception))
        self.assertEqual(events[-1]['status'], 'failed')
        self.assertEqual(events[-1]['errorType'], type(original.exception).__name__)
        self.assertNotIn('Private', json.dumps(events))


class NativeExtractionMetricsTests(unittest.TestCase):
    def setUp(self):
        self.events = []
        self.enterContext(patch.object(proxy, 'try_record_translation_metric', side_effect=self.events.append))
        self.module = SimpleNamespace(
            extract_translation_notes=Mock(return_value='[{"text":"Private source text"}]'),
            extract_translatable_text=Mock(return_value='[]'))
        self.enterContext(patch.object(proxy, '_load_translation_module', return_value=self.module))

    def request(self, diagnostics=None, operation='extract-notes', path='/api/pdf/translation/v2'):
        body = {'operation': operation, 'pdfBase64': base64.b64encode(b'Private PDF bytes').decode(),
                'pageIndices': [0]}
        if diagnostics is not None:
            body['diagnostics'] = diagnostics
        handler = object.__new__(proxy.AliothHandler)
        handler.path = path
        handler._read_body = lambda: json.dumps(body)
        handler._send_json = lambda status, result: (status, result)
        handler._send_raw = lambda status, result, mime: (status, result, mime)
        return handler._translate_pdf()

    def test_valid_context_records_balanced_stages_and_keeps_response(self):
        expected = self.request()
        self.assertEqual(self.events, [])
        self.assertEqual(self.request(CONTEXT), expected)
        self.assertEqual([event['stage'] for event in self.events[::2]], [
            'native_request_decode', 'lock_wait', 'module_load', 'extract_total'])
        for started, completed in zip(self.events[::2], self.events[1::2]):
            self.assertEqual(started['event'], 'extraction_stage_started')
            self.assertEqual(completed['event'], 'extraction_stage_completed')
            self.assertEqual(completed['status'], 'ok')
            self.assertGreaterEqual(completed['durationMs'], 0)
        for event in self.events:
            self.assertEqual(event['jobId'], CONTEXT['jobId'])
            self.assertEqual(event['sourceIndex'], 0)
            self.assertEqual(event['engine'], 'native')
            proxy._validated_translation_metric(event)
        self.assertEqual(len(self.module.extract_translation_notes.call_args.args), 3)
        self.assertNotIn('Private', json.dumps(self.events))

    def test_invalid_context_is_ignored_without_changing_extraction(self):
        expected = self.request()
        invalid = [{}, {'jobId': 'bad', 'sourceIndex': 0}, {**CONTEXT, 'sourceIndex': True},
                   {**CONTEXT, 'sourceIndex': -1}, {**CONTEXT, 'text': 'Private source text'}, 'invalid']
        for context in invalid:
            with self.subTest(context=context):
                self.assertEqual(self.request(context), expected)
        self.assertEqual(self.events, [])
        self.assertEqual(len(self.module.extract_translation_notes.call_args.args), 2)

    def test_logger_failure_keeps_success_and_error_responses(self):
        expected = self.request()
        with patch.object(proxy, 'try_record_translation_metric', side_effect=OSError('Private logger detail')):
            self.assertEqual(self.request(CONTEXT), expected)
            self.module.extract_translation_notes.side_effect = ValueError('TRANSLATION_PAGE_UNAVAILABLE')
            self.assertEqual(self.request(CONTEXT), self.request())

    def test_failed_extraction_records_type_and_releases_lock(self):
        self.module.extract_translation_notes.side_effect = ValueError('Private extraction detail')
        response = self.request(CONTEXT)
        self.assertEqual(response, (422, {'ok': False, 'error': 'TRANSLATION_NATIVE_FAILED'}))
        self.assertEqual(self.events[-1]['stage'], 'extract_total')
        self.assertEqual(self.events[-1]['status'], 'failed')
        self.assertEqual(self.events[-1]['errorType'], 'ValueError')
        self.assertNotIn('Private', json.dumps(self.events))
        self.assertTrue(proxy._TRANSLATION_LOCK.acquire(blocking=False))
        proxy._TRANSLATION_LOCK.release()

    def test_diagnostics_are_only_supported_for_v2_notes(self):
        for operation, path in [('extract', '/api/pdf/translation/v2'),
                                ('extract-notes', '/api/pdf/translation')]:
            with self.subTest(operation=operation, path=path):
                self.assertEqual(self.request(CONTEXT, operation, path),
                                 (400, {'ok': False, 'error': 'INVALID_TRANSLATION_REQUEST'}))
        self.assertEqual(self.events, [])


if __name__ == '__main__':
    unittest.main()
