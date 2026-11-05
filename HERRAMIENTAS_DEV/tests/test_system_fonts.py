from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from _system_fonts import FONT_FILES, _fallback, resolve_font


class SystemFontTests(unittest.TestCase):
    def test_installed_font_wins_over_fallback(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'arial.ttf').write_bytes(b'installed')
            self.assertEqual(resolve_font('Arial.ttf', root, [root]).read_bytes(), b'installed')

    def test_missing_font_uses_free_style_variant(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            folder = root / 'fonts/fallback'
            folder.mkdir(parents=True)
            for name in FONT_FILES:
                (folder / _fallback(name)).write_bytes(b'free')
            for name in FONT_FILES:
                self.assertEqual(resolve_font(name, root, []).read_bytes(), b'free')
            self.assertEqual(_fallback('arialnbi.ttf'), 'LiberationSansNarrow-BoldItalic.ttf')
            self.assertEqual(_fallback('consolaz.ttf'), 'LiberationMono-BoldItalic.ttf')
            self.assertEqual(_fallback('timesi.ttf'), 'LiberationSerif-Italic.ttf')

    def test_paths_cannot_escape_allowlist(self):
        for name in ['../config.ini', '/windows/fonts/arial.ttf', 'arial.ttf/extra', '%2e%2e/config.ini', 'unknown.ttf']:
            self.assertIsNone(resolve_font(name, '.', []))
