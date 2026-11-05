"""Abre y cancela únicamente selectores de prueba de este proceso."""
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import sys
import threading
import time
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import _native_file_dialog as dialogs

api = dialogs._open_dialog_api()
signatures = (
    ('CreateWindowExW', [wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD,
                         ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
                         wintypes.HWND, wintypes.HMENU, wintypes.HINSTANCE, wintypes.LPVOID], wintypes.HWND),
    ('DestroyWindow', [wintypes.HWND], wintypes.BOOL),
    ('GetWindowTextW', [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int], ctypes.c_int),
    ('GetClassNameW', [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int], ctypes.c_int),
    ('IsWindowVisible', [wintypes.HWND], wintypes.BOOL),
    ('PostMessageW', [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM], wintypes.BOOL),
)
for name, args, result in signatures:
    function = getattr(api, name)
    function.argtypes, function.restype = args, result
callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
api.EnumThreadWindows.argtypes = [wintypes.DWORD, callback_type, wintypes.LPARAM]
api.EnumChildWindows.argtypes = [wintypes.HWND, callback_type, wintypes.LPARAM]
thread_id = ctypes.windll.kernel32.GetCurrentThreadId()
info = dialogs._MONITORINFO(cbSize=ctypes.sizeof(dialogs._MONITORINFO))
assert api.GetMonitorInfoW(api.MonitorFromWindow(None, 2), ctypes.byref(info))
work = info.rcWork
owner = api.CreateWindowExW(0, 'STATIC', 'Alioth QA owner', 0x00CF0000,
                           work.left + 40, work.top + 40,
                           min(1400, work.right - work.left - 80),
                           min(800, work.bottom - work.top - 80), None, None, None, None)
assert owner


def rect(hwnd):
    value = wintypes.RECT()
    assert api.GetWindowRect(hwnd, ctypes.byref(value))
    return [value.left, value.top, value.right, value.bottom]


def run(positioned):
    title = f'Alioth QA open {os.getpid()} {positioned}'
    proof, errors, positions = {}, [], []
    def observe():
        for _ in range(200):
            found = []
            @callback_type
            def visit(hwnd, _):
                text = ctypes.create_unicode_buffer(256)
                api.GetWindowTextW(hwnd, text, len(text))
                if text.value == title and api.IsWindowVisible(hwnd):
                    found.append(hwnd)
                return True
            api.EnumThreadWindows(thread_id, visit, 0)
            if found:
                hwnd = found[0]
                try:
                    time.sleep(.15)
                    proof['rect'] = rect(hwnd)
                    classes = []
                    @callback_type
                    def child(hwnd, _):
                        name = ctypes.create_unicode_buffer(128)
                        api.GetClassNameW(hwnd, name, len(name))
                        classes.append(name.value)
                        return True
                    api.EnumChildWindows(hwnd, child, 0)
                    proof['controlClasses'] = sorted(set(classes))
                except Exception as error:
                    errors.append(str(error))
                finally:
                    api.PostMessageW(hwnd, 0x0010, 0, 0)
                return
            time.sleep(.025)
        errors.append('QA_DIALOG_NOT_OBSERVED')
    observer = threading.Thread(target=observe, daemon=True)
    observer.start()
    class CommonDialog:
        def GetOpenFileNameW(self, pointer):
            if not positioned:
                with patch.object(dialogs, '_position_open_dialog', return_value=True):
                    return ctypes.windll.comdlg32.GetOpenFileNameW(pointer)
            original = dialogs._position_open_dialog
            def trace_position(hwnd, owner_hwnd, user32):
                before = rect(hwnd)
                result = original(hwnd, owner_hwnd, user32)
                positions.append({'before': before, 'after': rect(hwnd), 'ok': result})
                return result
            with patch.object(dialogs, '_position_open_dialog', side_effect=trace_position):
                return ctypes.windll.comdlg32.GetOpenFileNameW(pointer)
        def CommDlgExtendedError(self):
            return ctypes.windll.comdlg32.CommDlgExtendedError()
    result = dialogs._windows_open_picker(title=title, owner_hwnd=owner, user32=api,
                                         filter_str='QA\0*.__alioth_qa__\0\0', common_dialog=CommonDialog())
    observer.join(6)
    assert not errors, errors
    assert result is None and proof, proof
    proof['positions'] = positions
    return proof


try:
    before, after = run(False), run(True)
    bounds = rect(owner)
    width = after['rect'][2] - after['rect'][0]
    expected_left = max(work.left, min(bounds[2], work.right) - width)
    assert abs(after['rect'][0] - expected_left) <= 2, after
    assert before['rect'][2] - before['rect'][0] == width, (before, after)
    assert before['rect'][3] - before['rect'][1] == after['rect'][3] - after['rect'][1], (before, after)
    assert set(before['controlClasses']) <= set(after['controlClasses']), (before, after)
    print(json.dumps({'ok': True, 'before': before, 'after': after, 'owner': bounds,
                      'expectedLeft': expected_left, 'cancelledBoth': True}))
finally:
    api.DestroyWindow(owner)
