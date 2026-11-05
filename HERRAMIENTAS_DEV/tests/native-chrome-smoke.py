"""Exercise native controls only on the isolated chrome-browser-server window."""
from pathlib import Path
import ctypes
import json
import sys
import urllib.request
import uuid
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from _window_chrome import WindowChrome
from ctypes import wintypes

origin = 'http://127.0.0.1:' + (sys.argv[1] if len(sys.argv) > 1 else '8875')
windows = []
for _ in range(75):
    with urllib.request.urlopen(origin + '/__qa/windows') as response:
        windows = list({item['hwnd']: item for item in json.load(response)}.values())
    if windows:
        break
    time.sleep(.2)
assert len(windows) == 1, 'Expected exactly one isolated test window'
window = windows[0]
api = WindowChrome()._api()
hwnd = window['hwnd']
assert WindowChrome._pid(api, hwnd) == window['pid']
assert WindowChrome._browser_process(window['pid'])
assert not window['caption'] and window['visible']
original_title = ctypes.create_unicode_buffer(512)
api.GetWindowTextW(hwnd, original_title, 512)
assert 'ALIOTH PDF EDITOR' in original_title.value
api.SetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPCWSTR]
token = uuid.uuid4().hex


def request(action, data=None):
    body = json.dumps(data).encode() if data else b''
    call = urllib.request.Request(origin + f'/api/window/{action}?token={token}', data=body,
                                  headers={'Origin': origin, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(call) as response:
        result = json.load(response)
    assert result['ok'], result
    return result


try:
    api.SetWindowTextW(hwnd, f'ALIOTH PDF EDITOR [{token}]')
    initial = request('init-frameless')
finally:
    api.SetWindowTextW(hwnd, original_title.value)
try:
    toggled = request('toggle-maximize')
    assert toggled['is_maximized'] != initial['is_maximized']
    request('minimize')
    assert api.IsIconic(hwnd)
finally:
    restored = request('restore-placement', initial['placement'])
assert not api.IsIconic(hwnd)
assert restored['is_maximized'] == initial['is_maximized']
assert api.IsWindowVisible(hwnd)
assert not api.GetWindowLongW(hwnd, -16) & 0xC00000
print(json.dumps(dict(visible=True, caption_style_removed=True, maximize=True, minimize=True, restore=True)))
if '--close' in sys.argv:
    request('close')
