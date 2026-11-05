import ctypes
from ctypes import wintypes
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import _native_file_dialog as dialogs


class WindowApi:
    def __init__(self, owner=(0, 0, 1920, 1080), work=(0, 0, 1920, 1040), dialog=(10, 20, 950, 720)):
        self.owner, self.work, self.dialog = owner, work, dialog
        self.moves = []

    def IsWindow(self, hwnd):
        return hwnd == 1 and self.owner is not None

    def GetClassNameW(self, hwnd, buffer, size):
        buffer.value = '#32770'
        return len(buffer.value)

    def GetWindowTextW(self, hwnd, buffer, size):
        buffer.value = 'Abrir QA'
        return len(buffer.value)

    def SetWindowsHookExW(self, kind, callback, module, thread):
        self.hook = ctypes.cast(callback, ctypes.WINFUNCTYPE(ctypes.c_ssize_t, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM))
        self.unhooked = False
        return 3

    def UnhookWindowsHookEx(self, hook):
        self.unhooked = True
        return True

    def CallNextHookEx(self, hook, code, wparam, lparam):
        return 0

    def GetWindowRect(self, hwnd, pointer):
        if hwnd not in (1, 2):
            return False
        values = self.owner if hwnd == 1 else self.dialog
        if values is None:
            return False
        for key, value in zip(('left', 'top', 'right', 'bottom'), values):
            setattr(pointer._obj, key, value)
        return True

    def MonitorFromWindow(self, hwnd, flags):
        return 3

    def GetMonitorInfoW(self, monitor, pointer):
        pointer._obj.rcWork = wintypes.RECT(*self.work)
        return True

    def SetWindowPos(self, *args):
        self.moves.append(args)
        return True


class OpenDialogPositionTests(unittest.TestCase):
    def test_aligns_with_the_right_edge_of_the_app(self):
        api = WindowApi(owner=(100, 50, 1500, 950))
        self.assertTrue(dialogs._position_open_dialog(2, 1, api))
        self.assertEqual(api.moves, [(2, None, 560, 20, 0, 0, 0x15)])

    def test_maximized_app_uses_the_right_edge_of_the_monitor(self):
        api = WindowApi()
        dialogs._position_open_dialog(2, 1, api)
        self.assertEqual(api.moves[0][2:4], (980, 20))

    def test_supports_a_monitor_left_of_the_primary_monitor(self):
        api = WindowApi(owner=(-1920, 0, 0, 1080), work=(-1920, 0, 0, 1040))
        dialogs._position_open_dialog(2, 1, api)
        self.assertEqual(api.moves[0][2:4], (-940, 20))

    def test_keeps_the_dialog_inside_the_work_area(self):
        api = WindowApi(owner=(800, 50, 2300, 950), dialog=(10, 1000, 950, 1700))
        dialogs._position_open_dialog(2, 1, api)
        self.assertEqual(api.moves[0][2:4], (980, 340))

    def test_unavailable_owner_falls_back_to_the_dialog_monitor(self):
        api = WindowApi(owner=None)
        dialogs._position_open_dialog(2, 1, api)
        self.assertEqual(api.moves[0][2:4], (980, 20))

    def test_invalid_dialog_is_not_moved(self):
        api = WindowApi()
        self.assertFalse(dialogs._position_open_dialog(99, 1, api))
        self.assertEqual(api.moves, [])

    def test_layout_hook_moves_only_the_open_dialog_and_preserves_cancellation(self):
        api = WindowApi()
        class CommonDialog:
            def GetOpenFileNameW(self, pointer):
                picker = pointer._obj
                self.flags = picker.Flags
                self.title, self.filter = picker.lpstrTitle, picker.lpstrFilter
                self.native_hook = picker.lpfnHook
                event = dialogs._CWPRETSTRUCT(message=0x0047, hwnd=2)
                api.hook(0, 0, ctypes.addressof(event))
                event.message = 0x0231
                api.hook(0, 0, ctypes.addressof(event))
                event.message = 0x0047
                api.hook(0, 0, ctypes.addressof(event))
                return False
            def CommDlgExtendedError(self):
                return 0
        common = CommonDialog()
        self.assertIsNone(dialogs._windows_open_picker(title='Abrir QA', owner_hwnd=1, user32=api, common_dialog=common))
        self.assertEqual(common.title, 'Abrir QA')
        self.assertIn('*.pdf', common.filter)
        self.assertTrue(common.flags & dialogs.OFN_FILEMUSTEXIST)
        self.assertIsNone(common.native_hook)
        self.assertTrue(api.unhooked)
        self.assertEqual(len(api.moves), 1)
        self.assertEqual(api.moves[0][0], 2)

    def test_a_picker_error_always_releases_the_positioning_hook(self):
        api = WindowApi()
        class CommonDialog:
            def GetOpenFileNameW(self, pointer):
                raise OSError('QA picker failure')
        with self.assertRaisesRegex(OSError, 'QA picker failure'):
            dialogs._windows_open_picker(owner_hwnd=1, user32=api, common_dialog=CommonDialog())
        self.assertTrue(api.unhooked)


if __name__ == '__main__':
    unittest.main()
