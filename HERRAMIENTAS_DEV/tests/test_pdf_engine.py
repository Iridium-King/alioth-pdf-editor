"""Shared-engine contracts: file paths, validation, passwords and safe outputs."""

import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
import _pdf_engine as engine


class SharedEngineTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='alioth-engine-')
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.source = self.root / 'documento conexión.pdf'
        with engine.fitz.open() as document:
            page = document.new_page()
            page.insert_text((72, 72), 'Alpha alpha original text')
            page.insert_text((72, 110), 'Sensitive SECRET123')
            for x in (72, 180, 300):
                page.draw_line((x, 160), (x, 220))
            for y in (160, 190, 220):
                page.draw_line((72, y), (300, y))
            for x, y, text in ((80, 180, 'Name'), (188, 180, 'Value'),
                               (80, 210, 'Alpha'), (188, 210, '42')):
                page.insert_text((x, y), text)
            document.new_page().insert_text((72, 72), 'Second page')
            document.save(self.source)

    def call(self, name, **arguments):
        result = engine.execute(name, arguments)
        self.assertNotIn('error', result, result)
        return result

    def test_relative_paths_use_callers_cwd(self):
        previous = Path.cwd()
        try:
            os.chdir(self.root)
            info = self.call('pdf_get_info', filepath=self.source.name)
            self.assertEqual(Path(info['filepath']), self.source)
            self.assertEqual(info['page_count'], 2)
            self.call('pdf_render_page_image', filepath=self.source.name, output_path='relative.png', dpi=72)
            self.assertTrue((self.root / 'relative.png').is_file())
        finally:
            os.chdir(previous)

    def test_argument_contract_returns_error_objects(self):
        cases = [
            ('unknown', {}, 'UNKNOWN_TOOL'),
            ('pdf_get_info', [], 'INVALID_ARGUMENTS'),
            ('pdf_get_info', {}, 'INVALID_ARGUMENTS'),
            ('pdf_get_info', {'filepath': str(self.source), 'unknown': True}, 'INVALID_ARGUMENTS'),
            ('pdf_get_info', {'filepath': 123}, 'INVALID_ARGUMENTS'),
            ('pdf_get_info', {'filepath': str(self.root / 'missing.pdf')}, 'FILE_NOT_FOUND'),
            ('pdf_read_text', {'filepath': str(self.source), 'page_number': True}, 'INVALID_ARGUMENTS'),
            ('pdf_read_text', {'filepath': str(self.source), 'detail_level': 'invalid'}, 'INVALID_ARGUMENTS'),
        ]
        for name, arguments, code in cases:
            with self.subTest(name=name, arguments=arguments):
                result = engine.execute(name, arguments)
                self.assertEqual(result['code'], code, result)
                self.assertIsInstance(result['error'], str)
                self.assertNotIn('trace', result)

    def test_search_respects_case_sensitive(self):
        insensitive = self.call('pdf_search_text', filepath=str(self.source), query='Alpha')
        sensitive = self.call('pdf_search_text', filepath=str(self.source), query='Alpha', case_sensitive=True)
        self.assertEqual(insensitive['total_matches'], 3)
        self.assertEqual(sensitive['total_matches'], 2)

    def test_every_output_mode_protects_source(self):
        original = hashlib.sha256(self.source.read_bytes()).digest()
        path = str(self.source)
        cases = {
            'pdf_splice_text': {'filepath': path, 'page_number': 1, 'old_text': 'original', 'new_text': 'new'},
            'pdf_redact_sensitive_data': {'filepath': path, 'patterns': ['SECRET123']},
            'pdf_render_page_image': {'filepath': path},
            'pdf_organize_pages': {'filepath': path, 'rotations': {'1': 90}},
            'pdf_merge': {'input_paths': [path, path]},
        }
        for name, arguments in cases.items():
            with self.subTest(name=name):
                result = engine.execute(name, {**arguments, 'output_path': path})
                self.assertEqual(result['code'], 'OUTPUT_CONFLICT', result)
                self.assertEqual(hashlib.sha256(self.source.read_bytes()).digest(), original)

    def test_hardlink_output_is_also_protected(self):
        alias = self.root / 'alias.pdf'
        try:
            os.link(self.source, alias)
        except OSError as error:
            self.skipTest(str(error))
        result = engine.execute('pdf_redact_sensitive_data', {
            'filepath': str(self.source), 'patterns': ['SECRET123'], 'output_path': str(alias),
        })
        self.assertEqual(result['code'], 'OUTPUT_CONFLICT', result)

    def test_invalid_pages_and_ranges_do_not_write(self):
        output = self.root / 'invalid.pdf'
        cases = [
            ('pdf_read_text', {'page_number': -1}),
            ('pdf_search_text', {'page_number': 3, 'query': 'Alpha'}),
            ('pdf_splice_text', {'page_number': 0, 'old_text': 'original', 'new_text': 'new', 'output_path': str(output)}),
            ('pdf_redact_sensitive_data', {'page_number': 3, 'patterns': ['SECRET123'], 'output_path': str(output)}),
            ('pdf_organize_pages', {'reorder_pages': [1, 1], 'output_path': str(output)}),
            ('pdf_organize_pages', {'delete_pages': [1, 2], 'output_path': str(output)}),
            ('pdf_organize_pages', {'rotations': {'1': 45}, 'output_path': str(output)}),
            ('pdf_split', {'ranges': ['2-3'], 'output_dir': str(self.root / 'split-invalid')}),
        ]
        for name, arguments in cases:
            with self.subTest(name=name, arguments=arguments):
                result = engine.execute(name, {'filepath': str(self.source), **arguments})
                self.assertEqual(result['code'], 'INVALID_ARGUMENTS', result)
        self.assertFalse(output.exists())
        self.assertFalse((self.root / 'split-invalid').exists())
        # Invalid requests do not leave an open handle preventing replacement on Windows.
        self.source.rename(self.root / 'renamed.pdf')

    def test_password_applies_to_reading_and_mutation(self):
        encrypted = self.root / 'protected.pdf'
        with engine.fitz.open(self.source) as document:
            document.save(encrypted, encryption=engine.fitz.PDF_ENCRYPT_AES_256,
                          owner_pw='owner-secret', user_pw='reader-secret')
        for password in ('', 'wrong'):
            result = engine.execute('pdf_read_text', {'filepath': str(encrypted), 'password': password})
            self.assertEqual(result['code'], 'PASSWORD_REQUIRED', result)
        info = self.call('pdf_get_info', filepath=str(encrypted), password='reader-secret')
        self.assertTrue(info['is_encrypted'])
        text = self.call('pdf_read_text', filepath=str(encrypted), password='reader-secret')
        self.assertIn('original text', text['text'])
        output = self.root / 'redacted.pdf'
        self.call('pdf_redact_sensitive_data', filepath=str(encrypted), password='reader-secret',
                  patterns=['SECRET123'], output_path=str(output))
        with engine.fitz.open(output) as document:
            self.assertNotIn('SECRET123', document[0].get_text())

    def test_default_output_is_in_application_artifact_directory(self):
        artifacts = self.root / 'application'
        with mock.patch.object(engine, '_ROOT_DIR', artifacts):
            result = self.call('pdf_render_page_image', filepath=str(self.source), dpi=72)
        self.assertEqual(Path(result['output_path']).parent, artifacts / '.mcp_artifacts')

    def test_operational_results_are_json_safe(self):
        path = str(self.source)
        output = self.root / 'organized.pdf'
        self.call('pdf_organize_pages', filepath=path, output_path=str(output),
                  rotations={'1': 90}, reorder_pages=[2, 1])
        with engine.fitz.open(output) as document:
            self.assertIn('Second page', document[0].get_text())
            self.assertEqual(document[1].rotation, 90)
        merged = self.call('pdf_merge', input_paths=[path, str(output)], output_path=str(self.root / 'merged.pdf'))
        self.assertEqual(merged['total_pages'], 4)
        split = self.call('pdf_split', filepath=path, output_dir=str(self.root / 'split'), ranges=['1-2'])
        self.assertEqual(len(split['created_files']), 1)
        table = self.call('pdf_extract_tables', filepath=path, output_format='json')
        self.assertEqual(table['table_count'], 1)
        self.assertIn('42', json.dumps(table))
        json.dumps({'merge': merged, 'split': split, 'table': table}, ensure_ascii=False)


if __name__ == '__main__':
    unittest.main()
