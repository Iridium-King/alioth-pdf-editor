from pathlib import Path
import importlib.util
import json
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from _window_chrome import WindowChrome
from _user_preferences import UserPreferences

spec = importlib.util.spec_from_file_location('pdf_search', ROOT / 'js/pdf_search.py')
search = importlib.util.module_from_spec(spec)
spec.loader.exec_module(search)


class ChromeSearchTests(unittest.TestCase):
    def test_pdf_accents_case_and_enye_keep_glyph_bounds(self):
        with search.fitz.open() as doc:
            page = doc.new_page()
            page.insert_text((72, 72), 'Configuración: año / ano / AÑO', fontsize=16)
            data = doc.tobytes()
            matches = json.loads(search.search_doc(data, 'configuracion'))
            self.assertEqual(len(matches), 1)
            expected = page.search_for('Configuración')[0]
            self.assertAlmostEqual(matches[0]['x0'], expected.x0, places=2)
            self.assertAlmostEqual(matches[0]['x1'], expected.x1, places=2)
            self.assertEqual(len(json.loads(search.search_doc(data, 'año'))), 2)
            self.assertEqual(len(json.loads(search.search_doc(data, 'ano'))), 1)
            self.assertEqual(len(json.loads(search.search_doc(data, 'AÑO', True))), 1)

    def test_ui_state_and_reading_survive_fresh_preference_store(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as directory:
            file = Path(directory) / 'preferences.json'
            state = json.dumps(dict(version=1, grid=True, ruler=True, panel=2, sidebarWidth='200px'))
            UserPreferences(file).update({'alioth_ui_state': state, 'alioth_reading_mode': 'true'})
            restored = UserPreferences(file).read()
            self.assertEqual(restored['alioth_ui_state'], state)
            self.assertEqual(restored['alioth_reading_mode'], 'true')

    def test_native_controls_require_a_valid_registered_window(self):
        controller = WindowChrome()
        self.assertEqual(controller.handle('close', 'invalid')[0], 400)
        with patch.object(controller, '_api', return_value=object()):
            self.assertEqual(controller.handle('close', 'a' * 32)[0], 404)

    def test_native_controls_reject_reused_window_handles(self):
        class API:
            def IsWindow(self, hwnd):
                return True
        controller = WindowChrome()
        token = 'b' * 32
        controller.windows[token] = (1234, 10, 0)
        with patch.object(controller, '_api', return_value=API()), patch.object(controller, '_pid', return_value=11):
            self.assertEqual(controller.handle('close', token)[0], 404)
        self.assertNotIn(token, controller.windows)


if __name__ == '__main__':
    unittest.main()
