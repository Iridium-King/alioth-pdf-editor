"""Isolated local UI verification; never writes production preferences."""
from pathlib import Path
import sys
import tempfile
import os
import subprocess
import urllib.parse

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import _proxy as proxy
from _user_preferences import UserPreferences

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8874
proxy._ACTIVE_PORT = port
proxy._ALLOWED_ORIGINS = {f'http://127.0.0.1:{port}', f'http://localhost:{port}', proxy.HOST_ORIGIN}
proxy.browser_migration.profile = Path(__file__).resolve().parents[2] / '_qa_chrome_profile_20261021'
if '--fixture-migration' in sys.argv:
    root = Path(__file__).resolve().parents[2]
    def export_fixture(url):
        subprocess.Popen([str(root / 'native_host/bin/AliothPDFHost.Test.exe'), url,
                          str(root / '_qa_migration_source_20261021'), str(root), 'qa-export',
                          str(root / '_qa_migration_proof_20261021'), 'legacy'])
    proxy.browser_migration.launcher = export_fixture


class VerificationHandler(proxy.AliothHandler):
    def do_GET(self):
        if self.path == '/__qa/windows':
            from _window_chrome import window_chrome
            api = window_chrome._api()
            return self._send_json(200, [{'hwnd': entry[0], 'pid': entry[1],
                                          'caption': bool(api.GetWindowLongW(entry[0], -16) & 0xC00000),
                                          'visible': bool(api.IsWindowVisible(entry[0]))}
                                         for entry in window_chrome.windows.values() if api.IsWindow(entry[0])])
        return super().do_GET()


with tempfile.TemporaryDirectory(prefix='alioth-chrome-qa-', dir=Path(__file__).resolve().parents[2]) as directory:
    proxy._USER_PREFERENCES = UserPreferences(Path(directory) / 'preferences.json')
    server = proxy.AliothHTTPServer(('127.0.0.1', port), VerificationHandler)
    print(f'UI verification: http://127.0.0.1:{port}/BASE.html PID={os.getpid()}', flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()
