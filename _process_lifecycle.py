"""Track only Alioth's own hosts and reap invisible, abandoned processes.

Never terminate by executable name, a bare PID file, or a slow HTTP response.
An open process handle plus its creation time protects against recycled PIDs.
"""
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import tempfile
import time

STARTUP_GRACE = 120


class WindowsProcess:
    def __init__(self, pid, *, terminate=False):
        self.pid = pid
        self.handle = None
        self.api = ctypes.WinDLL('kernel32', use_last_error=True)
        self.api.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        self.api.OpenProcess.restype = wintypes.HANDLE
        self.api.CloseHandle.argtypes = [wintypes.HANDLE]
        self.api.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(wintypes.FILETIME)] * 4
        self.api.GetProcessTimes.restype = wintypes.BOOL
        self.api.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
        self.api.QueryFullProcessImageNameW.restype = wintypes.BOOL
        self.api.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        self.api.WaitForSingleObject.restype = wintypes.DWORD
        self.api.TerminateProcess.argtypes = [wintypes.HANDLE, wintypes.UINT]
        self.api.TerminateProcess.restype = wintypes.BOOL
        self.handle = self.api.OpenProcess(0x1000 | 0x100000 | (1 if terminate else 0), False, pid)
        if not self.handle:
            error = ctypes.get_last_error()
            if error != 87:  # ERROR_INVALID_PARAMETER: process no longer exists.
                raise ctypes.WinError(error)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        if self.handle:
            self.api.CloseHandle(self.handle)
            self.handle = None

    def identity(self):
        if not self.handle:
            return None
        status = self.api.WaitForSingleObject(self.handle, 0)
        if status == 0:
            return None
        if status != 258:
            raise ctypes.WinError(ctypes.get_last_error())
        created, exited, kernel, user = [wintypes.FILETIME() for _ in range(4)]
        if not self.api.GetProcessTimes(self.handle, ctypes.byref(created), ctypes.byref(exited),
                                        ctypes.byref(kernel), ctypes.byref(user)):
            raise ctypes.WinError(ctypes.get_last_error())
        image = ctypes.create_unicode_buffer(32768)
        size = wintypes.DWORD(len(image))
        if not self.api.QueryFullProcessImageNameW(self.handle, 0, image, ctypes.byref(size)):
            raise ctypes.WinError(ctypes.get_last_error())
        return {'pid': self.pid, 'created': (created.dwHighDateTime << 32) | created.dwLowDateTime,
                'image': os.path.normcase(os.path.abspath(image.value))}

    def has_windows(self):
        api = ctypes.WinDLL('user32', use_last_error=True)
        callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
        api.EnumWindows.argtypes = [callback_type, wintypes.LPARAM]
        api.EnumWindows.restype = wintypes.BOOL
        api.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
        api.IsWindowVisible.argtypes = [wintypes.HWND]
        api.IsWindowVisible.restype = wintypes.BOOL
        found = False

        @callback_type
        def visit(window, _):
            nonlocal found
            pid = wintypes.DWORD()
            api.GetWindowThreadProcessId(window, ctypes.byref(pid))
            if pid.value == self.pid and api.IsWindowVisible(window):
                found = True
                return False
            return True

        if not api.EnumWindows(visit, 0) and not found:
            raise ctypes.WinError(ctypes.get_last_error())
        return found

    def terminate(self):
        if not self.api.TerminateProcess(self.handle, 0):
            raise ctypes.WinError(ctypes.get_last_error())
        return self.api.WaitForSingleObject(self.handle, 2500) == 0


def _directory(directory=None):
    return Path(directory) if directory is not None else (
        Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'AliothPDFEditor/Processes')


def track_host(process, executable, *, directory=None):
    if os.name != 'nt' or type(process.pid) is not int:
        return
    try:
        with WindowsProcess(os.getpid()) as owner, WindowsProcess(process.pid) as child:
            owner_id, child_id = owner.identity(), child.identity()
        if not owner_id or not child_id or child_id['image'] != os.path.normcase(os.path.abspath(executable)):
            return
        folder = _directory(directory)
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / f"{child_id['pid']}-{child_id['created']}.json"
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(mode='w', dir=folder, encoding='utf-8',
                                             prefix='.host-', delete=False) as output:
                temporary = Path(output.name)
                json.dump({'owner': owner_id, 'host': child_id}, output)
            os.replace(temporary, path)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
    except OSError:
        # Tracking is best effort; a restricted policy must not prevent opening.
        pass


def reap_inactive_hosts(*, allow_current=False, directory=None, now=None):
    if os.name != 'nt':
        return 0
    removed = 0
    try:
        paths = list(_directory(directory).glob('*.json'))
    except OSError:
        return 0
    for path in paths:
        try:
            if path.stat().st_size > 8192:
                continue
            record = json.loads(path.read_text(encoding='utf-8'))
            owner, host = record['owner'], record['host']
            if (type(owner['pid']) is not int or type(host['pid']) is not int or
                    not 0 < owner['pid'] <= 0xFFFFFFFF or not 0 < host['pid'] <= 0xFFFFFFFF or type(host['created']) is not int or
                    Path(host['image']).name.lower() != 'aliothpdfhost.exe' or
                    path.name != f"{host['pid']}-{host['created']}.json"):
                continue
            with WindowsProcess(host['pid'], terminate=True) as child:
                actual = child.identity()
                if actual != host:
                    path.unlink(missing_ok=True)
                    continue
                age = (time.time() if now is None else now) - (host['created'] / 10_000_000 - 11644473600)
                if age < STARTUP_GRACE or child.has_windows():
                    continue
                with WindowsProcess(owner['pid']) as parent:
                    parent_id = parent.identity()
                if parent_id == owner and not (allow_current and owner['pid'] == os.getpid()):
                    continue
                # Recheck immediately before termination, using the same process handle.
                if child.identity() == host and not child.has_windows() and child.terminate():
                    path.unlink(missing_ok=True)
                    removed += 1
        except (OSError, ValueError, TypeError, KeyError):
            # Missing access or uncertain ownership is never a reason to kill.
            continue
    return removed
