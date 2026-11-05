import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from _file_origin import resolve_file_origin
from _native_file_dialog import NativeFileDialog, _windows_save_picker
from _user_preferences import UserPreferences
import _proxy as proxy


class OriginPreferencesTests(unittest.TestCase):
    def test_origin_uses_content_not_only_the_name_and_size(self):
        with tempfile.TemporaryDirectory() as directory:
            first, second = [Path(directory) / folder for folder in ['uno', 'dos ñ']]
            first.mkdir()
            second.mkdir()
            wrong, original = first / 'base.pdf', second / 'base.pdf'
            wrong.write_bytes(b'otro')
            original.write_bytes(b'base')
            digest = hashlib.sha256(b'base').hexdigest()
            self.assertEqual(resolve_file_origin('base.pdf', 4, digest, [wrong, original]), str(original.resolve()))
            self.assertIsNone(resolve_file_origin('base.pdf', 4, digest, [wrong]))

    def test_dialog_keeps_original_directory_even_after_a_different_destination(self):
        captured = []
        with tempfile.TemporaryDirectory() as directory:
            dialog = NativeFileDialog(picker=lambda name, owner, initial_dir=None:
                                      captured.append((name, initial_dir)), foreground_window=lambda: None)
            self.assertTrue(dialog.request_save('editado.pdf', initial_dir=directory).cancelled)
            self.assertEqual(captured, [('editado.pdf', directory)])
            with self.assertRaises(ValueError):
                dialog.request_save('editado.pdf', initial_dir='relative')

    def test_windows_picker_receives_directory_and_full_unicode_filename(self):
        captured = {}
        class Dialog:
            def GetSaveFileNameW(self, pointer):
                captured.update(directory=pointer._obj.lpstrInitialDir, file=pointer._obj.lpstrFile)
                return False
            def CommDlgExtendedError(self):
                return 0
        with tempfile.TemporaryDirectory(prefix='origen_ñ_') as directory:
            _windows_save_picker('modificado.pdf', common_dialog=Dialog(), initial_dir=directory)
            self.assertEqual(captured['directory'], directory)
            self.assertEqual(captured['file'], str(Path(directory) / 'modificado.pdf'))

    def test_save_endpoint_passes_the_original_folder_to_the_native_picker(self):
        captured = []
        class Picker:
            def request_save(self, name, initial_dir=None):
                captured.append((name, initial_dir))
                return type('Cancelled', (), {'cancelled': True})()
        with tempfile.TemporaryDirectory() as directory:
            handler = object.__new__(proxy.AliothHandler)
            handler.headers = {'X-Alioth-Client-Id': 'origin-test'}
            handler._read_body = lambda: json.dumps({'suggested_name': 'editado.pdf', 'source_path': str(Path(directory) / 'base.pdf')}).encode()
            handler._send_json = lambda code, payload: (code, payload)
            with patch.object(proxy, '_NATIVE_FILE_DIALOG', Picker()), patch.dict(proxy._EVENT_QUEUES, {'origin-test': object()}):
                self.assertEqual(handler._pick_native_save_target()[0], 200)
            self.assertEqual(captured, [('editado.pdf', directory)])

    def test_preferences_survive_a_new_store_and_deletions_do_not_resurrect(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'preferences.json'
            store = UserPreferences(path)
            store.update({'alioth_theme': 'dark', 'customAccentColor': '#ff0088', 'dex_profiles': '[]'})
            store.update({'customAccentColor': None, 'app_language': 'es'})
            result = UserPreferences(path).read()
            self.assertEqual(result['alioth_theme'], 'dark')
            self.assertIsNone(result['customAccentColor'])
            self.assertEqual(result['dex_profiles'], '[]')
            self.assertEqual(result['app_language'], 'es')

    def test_preferences_reject_credentials_transfers_and_invalid_values(self):
        with tempfile.TemporaryDirectory() as directory:
            store = UserPreferences(Path(directory) / 'preferences.json')
            for payload in [{'gemini_api_key': 'secret'}, {'alioth_encryption_token': 'secret'},
                            {'alioth_transfer_meta_1': 'x'}, {'alioth_theme': []}, ['dark']]:
                with self.assertRaises(ValueError):
                    store.update(payload)
            self.assertEqual(store.read(), {})

    def test_bootstrap_from_a_restarted_server_restores_settings_before_scripts_run(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'preferences.json'
            handler = object.__new__(proxy.AliothHandler)
            handler.path = '/api/preferences'
            handler._check_origin = lambda: True
            handler.headers = {'Content-Length': '0'}
            handler._read_body = lambda: json.dumps({'alioth_theme': 'dark', 'customAccentColor': '#ff0088'}).encode()
            handler._send_json = lambda code, payload: (code, payload)
            with patch.object(proxy, '_USER_PREFERENCES', UserPreferences(path)):
                self.assertEqual(handler.do_POST()[0], 200)
            handler.path = '/js/preferences.js'
            handler.wfile = io.BytesIO()
            handler.send_response = handler.send_header = handler.end_headers = lambda *args: None
            with patch.object(proxy, '_USER_PREFERENCES', UserPreferences(path)):
                handler.do_GET()
            body = handler.wfile.getvalue().decode()
            seed = json.loads(body.split('=', 1)[1].split(';\n', 1)[0])
            self.assertEqual(seed, {'alioth_theme': 'dark', 'customAccentColor': '#ff0088'})
            self.assertLess(body.index('window.__aliothPreferences='), body.index('(function ()'))


if __name__ == '__main__':
    unittest.main()
