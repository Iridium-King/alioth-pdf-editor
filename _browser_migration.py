"""One-time, bounded, memory-only transfer of this app's legacy browser storage."""
from pathlib import Path
import os
import queue
import secrets
import subprocess
import sys
import threading
import time


class MigrationSession:
    def __init__(self):
        self.queue = queue.Queue(2)
        self.next_sequence = 0
        self.last_packet = None
        self.touched = time.monotonic()
        self.lock = threading.Lock()

    def publish(self, packet):
        if (not isinstance(packet, dict) or type(packet.get('sequence')) is not int or
                not isinstance(packet.get('data', ''), str) or len(packet.get('data', '')) > 4 * 1024 * 1024):
            raise ValueError('INVALID_MIGRATION_PACKET')
        with self.lock:
            self.touched = time.monotonic()
            if packet['sequence'] == self.next_sequence - 1:
                return
            if packet['sequence'] != self.next_sequence:
                raise ValueError('INVALID_MIGRATION_SEQUENCE')
            self.queue.put(packet, timeout=10)
            self.next_sequence += 1

    def receive(self, sequence):
        self.touched = time.monotonic()
        if self.last_packet and sequence == self.last_packet['sequence']:
            return self.last_packet
        expected = self.last_packet['sequence'] + 1 if self.last_packet else 0
        if sequence != expected:
            raise ValueError('INVALID_MIGRATION_SEQUENCE')
        self.last_packet = self.queue.get(timeout=20)
        return self.last_packet


class BrowserMigration:
    def __init__(self, profile=None, launcher=None):
        self.sessions = {}
        self.lock = threading.Lock()
        self.profile = profile
        self.launcher = launcher

    def _session(self, token):
        with self.lock:
            session = self.sessions.get(token)
        if session is None or time.monotonic() - session.touched > 600:
            raise KeyError('MIGRATION_EXPIRED')
        return session

    def active_count(self):
        now = time.monotonic()
        with self.lock:
            return sum(now - session.touched <= 600 for session in self.sessions.values())

    @staticmethod
    def legacy_browser():
        for root in (os.environ.get('ProgramFiles(x86)', ''), os.environ.get('ProgramFiles', '')):
            for relative in ('Microsoft/Edge/Application/msedge.exe', 'Google/Chrome/Application/chrome.exe'):
                browser = Path(root) / relative
                if browser.is_file():
                    return browser
        return None

    def start(self, origin):
        token = secrets.token_hex(16)
        session = MigrationSession()
        with self.lock:
            expired = [key for key, value in self.sessions.items() if time.monotonic() - value.touched > 600]
            for key in expired:
                self.sessions.pop(key, None)
            if len(self.sessions) >= 4:
                raise ValueError('MIGRATION_BUSY')
            self.sessions[token] = session
        url = origin + '/browser-migration.html?mode=export&token=' + token
        browser = self.legacy_browser()
        if self.launcher:
            self.launcher(url)
        elif browser:
            arguments = [str(browser), '--app=' + url, '--no-first-run', '--disable-background-mode']
            if self.profile:
                arguments.append('--user-data-dir=' + str(self.profile))
            self._launch(arguments, browser.parent, hidden=True)
        else:
            session.publish({'sequence': 0, 'data': '{"type":"meta","storage":{},"schema":null}', 'last': True})
            session.publish({'sequence': 1, 'done': True})
        return token

    @staticmethod
    def _launch(arguments, cwd, hidden=False):
        if getattr(sys, 'frozen', False):
            import ctypes
            ctypes.windll.kernel32.SetDllDirectoryW(None)
        try:
            options = {}
            if hidden and os.name == 'nt':
                startup = subprocess.STARTUPINFO()
                startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
                startup.wShowWindow = 0
                options['startupinfo'] = startup
            return subprocess.Popen(arguments, cwd=cwd, **options)
        finally:
            if getattr(sys, 'frozen', False):
                ctypes.windll.kernel32.SetDllDirectoryW(sys._MEIPASS)

    def publish(self, token, packet):
        self._session(token).publish(packet)
        if packet.get('done') or packet.get('error'):
            threading.Thread(target=self._close_exporter, args=(token,), daemon=True).start()

    def receive(self, token, sequence):
        return self._session(token).receive(sequence)

    def finish(self, token):
        with self.lock:
            self.sessions.pop(token, None)
        self._close_exporter(token)

    def exporter_ready(self, token):
        self._session(token)
        threading.Thread(target=self._hide_exporter, args=(token,), daemon=True).start()

    @staticmethod
    def _hide_exporter(token):
        if os.name != 'nt':
            return
        from _window_chrome import WindowChrome
        controller = WindowChrome()
        api = controller._api()
        for _ in range(100):
            hwnd = controller._find(api, token, visible_only=False)
            if hwnd:
                api.ShowWindow(hwnd, 0)
                return
            time.sleep(.05)

    @staticmethod
    def _close_exporter(token):
        if os.name != 'nt':
            return
        from _window_chrome import WindowChrome
        controller = WindowChrome()
        api = controller._api()
        hwnd = controller._find(api, token, visible_only=False)
        if hwnd:
            api.PostMessageW(hwnd, 0x10, 0, 0)


browser_migration = BrowserMigration()
