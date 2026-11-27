from pathlib import Path
import configparser
import os
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
import alioth
import build_macos
import _native_file_dialog as dialogs
import _proxy as proxy
import _system_fonts as fonts


class MacIntegrationTests(unittest.TestCase):
    def test_managed_backend_never_adds_browser_flag(self):
        seen = []
        with patch('runpy.run_module', side_effect=lambda *a, **k: seen.append(sys.argv.copy())):
            self.assertEqual(alioth.main(['--no-browser']), 0)
        self.assertIn('--no-browser', seen[0])
        self.assertNotIn('--launch-browser', seen[0])

    def test_finder_launch_number_is_not_a_cli_command(self):
        with patch('runpy.run_module') as gui:
            alioth.main(['-psn_0_123', 'documento.pdf'])
        gui.assert_called_once()

    def test_mac_save_picker_preserves_unicode_name_and_cancel(self):
        with patch.object(dialogs.subprocess, 'run', return_value=Mock(returncode=0, stdout='/Users/test/café.pdf\n')) as run:
            self.assertEqual(str(dialogs._macos_save_picker('café.pdf')), str(Path('/Users/test/café.pdf')))
        self.assertEqual(run.call_args.args[0][0], '/usr/bin/osascript')
        self.assertIn('café.pdf', run.call_args.args[0][-1])
        with patch.object(dialogs.subprocess, 'run', return_value=Mock(returncode=1, stdout='')):
            self.assertIsNone(dialogs._macos_save_picker('cancelado.pdf'))

    def test_macos_font_filename_is_resolved_before_free_fallback(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(fonts.sys, 'platform', 'darwin'):
            root = Path(directory)
            (root / 'Arial Bold.ttf').write_bytes(b'font fixture')
            self.assertEqual(fonts.resolve_font('arialbd.ttf', root, [root]), root / 'Arial Bold.ttf')

    def test_reveal_uses_finder_and_keeps_special_characters_as_one_argument(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'café & #.pdf'
            path.write_bytes(b'%PDF-1.7')
            handler = object.__new__(proxy.AliothHandler)
            handler._read_body = lambda: __import__('json').dumps({'path': str(path)}).encode()
            handler._send_json = Mock()
            with patch.object(proxy.sys, 'platform', 'darwin'), patch.object(proxy.subprocess, 'Popen') as popen:
                handler._reveal_file_in_explorer()
            popen.assert_called_once_with(['/usr/bin/open', '-R', os.path.abspath(path)])

    def test_deleting_absent_provider_does_not_use_an_uninitialized_config_path(self):
        handler = object.__new__(proxy.AliothHandler)
        handler._read_body = lambda: b'{"provider":"absent"}'
        handler._send_json = Mock()
        handler._reload_credentials = Mock()
        with tempfile.TemporaryDirectory() as directory, patch.object(proxy, 'load_config', return_value=configparser.ConfigParser()), \
                patch.object(proxy, 'get_config_path', return_value=str(Path(directory) / 'config.ini')):
            handler._delete_secure_credential()
        self.assertEqual(handler._send_json.call_args.args[0], 200)

    def test_mac_spec_preserves_cli_stdio_and_declares_pdf_document_type(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(build_macos, 'BASE_DIR', Path(directory)):
            source = build_macos.generate_spec('3.2.53').read_text('utf-8')
        compile(source, 'AliothPDF_macOS.spec', 'exec')
        self.assertIn('console=True', source)
        self.assertIn("'LSItemContentTypes': ['com.adobe.pdf']", source)
        self.assertIn("'LSHandlerRank': 'Alternate'", source)
        self.assertIn("collect_submodules('mcp.server')", source)
        self.assertNotIn("('config.ini', '.')", source)


if __name__ == '__main__':
    unittest.main()
