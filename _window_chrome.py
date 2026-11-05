"""Controls only the app window identified by a one-time title handshake."""
import ctypes
from ctypes import wintypes
import os
import re
import threading


class Placement(ctypes.Structure):
    _fields_ = [('length', wintypes.UINT), ('flags', wintypes.UINT), ('showCmd', wintypes.UINT),
                ('ptMinPosition', wintypes.POINT), ('ptMaxPosition', wintypes.POINT), ('rcNormalPosition', wintypes.RECT)]


class WindowChrome:
    def __init__(self):
        self.windows = {}
        self.lock = threading.RLock()

    def _api(self):
        if os.name != 'nt':
            raise OSError('Native window controls require Windows')
        api = ctypes.WinDLL('user32', use_last_error=True)
        for name, args, result in (
            ('IsWindow', [wintypes.HWND], wintypes.BOOL),
            ('IsWindowVisible', [wintypes.HWND], wintypes.BOOL),
            ('IsZoomed', [wintypes.HWND], wintypes.BOOL),
            ('IsIconic', [wintypes.HWND], wintypes.BOOL),
            ('GetWindowTextW', [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int], ctypes.c_int),
            ('GetClassNameW', [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int], ctypes.c_int),
            ('GetWindowThreadProcessId', [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)], wintypes.DWORD),
            ('GetWindowLongW', [wintypes.HWND, ctypes.c_int], wintypes.LONG),
            ('SetWindowLongW', [wintypes.HWND, ctypes.c_int, wintypes.LONG], wintypes.LONG),
            ('SetWindowPos', [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.UINT], wintypes.BOOL),
            ('ShowWindow', [wintypes.HWND, ctypes.c_int], wintypes.BOOL),
            ('PostMessageW', [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM], wintypes.BOOL),
            ('SendMessageW', [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM], ctypes.c_ssize_t),
            ('GetWindowPlacement', [wintypes.HWND, ctypes.POINTER(Placement)], wintypes.BOOL),
            ('SetWindowPlacement', [wintypes.HWND, ctypes.POINTER(Placement)], wintypes.BOOL),
        ):
            function = getattr(api, name)
            function.argtypes, function.restype = args, result
        return api

    @staticmethod
    def _pid(api, hwnd):
        pid = wintypes.DWORD()
        api.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        return pid.value

    @staticmethod
    def _browser_process(pid):
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        process = kernel.OpenProcess(0x1000, False, pid)
        if not process:
            return False
        try:
            path = ctypes.create_unicode_buffer(32768)
            size = wintypes.DWORD(len(path))
            return bool(kernel.QueryFullProcessImageNameW(process, 0, path, ctypes.byref(size)) and
                        os.path.basename(path.value).lower() in ('msedge.exe', 'chrome.exe'))
        finally:
            kernel.CloseHandle(process)

    def _find(self, api, token, visible_only=True):
        found = []
        callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

        def visit(hwnd, _):
            title, kind = ctypes.create_unicode_buffer(512), ctypes.create_unicode_buffer(128)
            api.GetWindowTextW(hwnd, title, len(title))
            api.GetClassNameW(hwnd, kind, len(kind))
            if ((not visible_only or api.IsWindowVisible(hwnd)) and title.value == f'ALIOTH PDF EDITOR [{token}]'
                    and kind.value == 'Chrome_WidgetWin_1' and self._browser_process(self._pid(api, hwnd))):
                found.append(hwnd)
            return True

        api.EnumWindows.argtypes = [callback_type, wintypes.LPARAM]
        api.EnumWindows(callback_type(visit), 0)
        return found[0] if len(found) == 1 else None

    def handle(self, action, token, placement=None):
        if not re.fullmatch(r'[a-f0-9]{32}', token or ''):
            return 400, {'ok': False, 'error': 'Invalid window token'}
        api = self._api()
        with self.lock:
            entry = self.windows.get(token)
            if entry and (not api.IsWindow(entry[0]) or self._pid(api, entry[0]) != entry[1]):
                self.windows.pop(token, None)
                entry = None
            if action == 'init-frameless' and not entry:
                hwnd = self._find(api, token)
                if hwnd:
                    entry = (hwnd, self._pid(api, hwnd), api.GetWindowLongW(hwnd, -16))
                    self.windows[token] = entry
            if not entry:
                return 404, {'ok': False, 'error': 'App window not found'}
            hwnd, _, original_style = entry

        if action == 'init-frameless':
            api.SetWindowLongW(hwnd, -16, (original_style & ~0x00C00000) | 0x00040000)
            if not api.SetWindowPos(hwnd, None, 0, 0, 0, 0, 0x37):
                api.SetWindowLongW(hwnd, -16, original_style)
                raise ctypes.WinError(ctypes.get_last_error())
        elif action == 'restore-frame':
            api.SetWindowLongW(hwnd, -16, original_style)
            api.SetWindowPos(hwnd, None, 0, 0, 0, 0, 0x37)
        elif action == 'minimize':
            api.ShowWindow(hwnd, 6)
        elif action == 'toggle-maximize':
            api.ShowWindow(hwnd, 9 if api.IsZoomed(hwnd) else 3)
        elif action == 'restore-placement':
            if not isinstance(placement, dict):
                return 400, {'ok': False, 'error': 'Invalid window placement'}
            rect = placement.get('rect')
            if (not isinstance(rect, list) or len(rect) != 4 or
                    any(type(value) is not int or abs(value) > 100000 for value in rect) or
                    rect[2] - rect[0] < 320 or rect[3] - rect[1] < 240):
                return 400, {'ok': False, 'error': 'Invalid window bounds'}
            left, top = api.GetSystemMetrics(76), api.GetSystemMetrics(77)
            right, bottom = left + api.GetSystemMetrics(78), top + api.GetSystemMetrics(79)
            if rect[2] > left + 100 and rect[0] < right - 100 and rect[3] > top + 60 and rect[1] < bottom - 60:
                bounds = Placement(length=ctypes.sizeof(Placement), showCmd=3 if placement.get('maximized') is True else 1,
                                   rcNormalPosition=wintypes.RECT(*rect))
                api.SetWindowPlacement(hwnd, ctypes.byref(bounds))
        elif action == 'close':
            api.PostMessageW(hwnd, 0x10, 0, 0)
        elif action == 'drag':
            if not api.GetAsyncKeyState(1) & 0x8000:
                return 200, {'ok': True, 'is_maximized': bool(api.IsZoomed(hwnd))}
            cursor = wintypes.POINT()
            api.GetCursorPos(ctypes.byref(cursor))
            edge_thread = api.GetWindowThreadProcessId(hwnd, None)
            current_thread = ctypes.windll.kernel32.GetCurrentThreadId()
            attached = api.AttachThreadInput(current_thread, edge_thread, True)
            try:
                api.ReleaseCapture()
                api.SendMessageW(hwnd, 0xA1, 2, ((cursor.y & 0xffff) << 16) | (cursor.x & 0xffff))
            finally:
                if attached:
                    api.AttachThreadInput(current_thread, edge_thread, False)
        elif action != 'state':
            return 400, {'ok': False, 'error': 'Unknown window action'}
        bounds = Placement(length=ctypes.sizeof(Placement))
        api.GetWindowPlacement(hwnd, ctypes.byref(bounds))
        maximized = bool(api.IsZoomed(hwnd) or (api.IsIconic(hwnd) and bounds.flags & 2))
        rect = bounds.rcNormalPosition
        return 200, {'ok': True, 'is_maximized': maximized,
                     'placement': {'maximized': maximized, 'rect': [rect.left, rect.top, rect.right, rect.bottom]}}


window_chrome = WindowChrome()
