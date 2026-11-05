"""Selector nativo de destinos PDF y apertura de archivos, aislado del servidor HTTP."""

from dataclasses import dataclass
from pathlib import Path, PureWindowsPath
import ctypes
from ctypes import wintypes
import logging
import os
import queue
import threading


OFN_OVERWRITEPROMPT = 0x00000002
OFN_NOCHANGEDIR = 0x00000008
OFN_PATHMUSTEXIST = 0x00000800
OFN_FILEMUSTEXIST = 0x00001000
OFN_EXPLORER = 0x00080000


class DialogBusyError(RuntimeError):
    pass


@dataclass(frozen=True)
class NativeDialogResult:
    cancelled: bool
    path: Path | None = None


@dataclass
class _DialogRequest:
    suggested_name: str
    done: threading.Event
    owner_hwnd: int | None = None
    result: NativeDialogResult | None = None
    error: Exception | None = None
    mode: str = 'save'
    filter_str: str | None = None
    title: str | None = None
    initial_dir: str | None = None


class _OPENFILENAMEW(ctypes.Structure):
    _fields_ = [
        ('lStructSize', wintypes.DWORD),
        ('hwndOwner', wintypes.HWND),
        ('hInstance', wintypes.HINSTANCE),
        ('lpstrFilter', wintypes.LPCWSTR),
        ('lpstrCustomFilter', wintypes.LPWSTR),
        ('nMaxCustFilter', wintypes.DWORD),
        ('nFilterIndex', wintypes.DWORD),
        ('lpstrFile', wintypes.LPWSTR),
        ('nMaxFile', wintypes.DWORD),
        ('lpstrFileTitle', wintypes.LPWSTR),
        ('nMaxFileTitle', wintypes.DWORD),
        ('lpstrInitialDir', wintypes.LPCWSTR),
        ('lpstrTitle', wintypes.LPCWSTR),
        ('Flags', wintypes.DWORD),
        ('nFileOffset', wintypes.WORD),
        ('nFileExtension', wintypes.WORD),
        ('lpstrDefExt', wintypes.LPCWSTR),
        ('lCustData', wintypes.LPARAM),
        ('lpfnHook', ctypes.c_void_p),
        ('lpTemplateName', wintypes.LPCWSTR),
        ('pvReserved', ctypes.c_void_p),
        ('dwReserved', wintypes.DWORD),
        ('FlagsEx', wintypes.DWORD),
    ]


class _MONITORINFO(ctypes.Structure):
    _fields_ = [('cbSize', wintypes.DWORD), ('rcMonitor', wintypes.RECT),
                ('rcWork', wintypes.RECT), ('dwFlags', wintypes.DWORD)]


class _CWPRETSTRUCT(ctypes.Structure):
    _fields_ = [('lResult', ctypes.c_ssize_t), ('lParam', wintypes.LPARAM),
                ('wParam', wintypes.WPARAM), ('message', wintypes.UINT), ('hwnd', wintypes.HWND)]


def _open_dialog_api():
    api = ctypes.WinDLL('user32', use_last_error=True)
    for name, args, result in (
        ('IsWindow', [wintypes.HWND], wintypes.BOOL),
        ('GetClassNameW', [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int], ctypes.c_int),
        ('GetWindowTextW', [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int], ctypes.c_int),
        ('GetWindowRect', [wintypes.HWND, ctypes.POINTER(wintypes.RECT)], wintypes.BOOL),
        ('MonitorFromWindow', [wintypes.HWND, wintypes.DWORD], wintypes.HANDLE),
        ('GetMonitorInfoW', [wintypes.HANDLE, ctypes.POINTER(_MONITORINFO)], wintypes.BOOL),
        ('SetWindowPos', [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int,
                          ctypes.c_int, ctypes.c_int, wintypes.UINT], wintypes.BOOL),
        ('SetWindowsHookExW', [ctypes.c_int, ctypes.c_void_p, wintypes.HINSTANCE, wintypes.DWORD], wintypes.HANDLE),
        ('UnhookWindowsHookEx', [wintypes.HANDLE], wintypes.BOOL),
        ('CallNextHookEx', [wintypes.HANDLE, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM], ctypes.c_ssize_t),
    ):
        function = getattr(api, name)
        function.argtypes, function.restype = args, result
    return api


def _position_open_dialog(hwnd, owner_hwnd, api):
    rect, owner = wintypes.RECT(), wintypes.RECT()
    valid_owner = bool(owner_hwnd and api.IsWindow(owner_hwnd) and api.GetWindowRect(owner_hwnd, ctypes.byref(owner)))
    monitor = api.MonitorFromWindow(owner_hwnd if valid_owner else hwnd, 2)
    info = _MONITORINFO(cbSize=ctypes.sizeof(_MONITORINFO))
    if not api.GetWindowRect(hwnd, ctypes.byref(rect)) or not monitor or not api.GetMonitorInfoW(monitor, ctypes.byref(info)):
        return False
    width, height = rect.right - rect.left, rect.bottom - rect.top
    if width <= 0 or height <= 0:
        return False
    work = info.rcWork
    right = min(owner.right, work.right) if valid_owner else work.right
    x = max(work.left, min(right - width, work.right - width))
    y = max(work.top, min(rect.top, work.bottom - height))
    if (x, y) == (rect.left, rect.top):
        return True
    return bool(api.SetWindowPos(hwnd, None, x, y, 0, 0, 0x0015))


def _suggested_filename(value):
    name = PureWindowsPath(str(value or 'documento.pdf')).name.replace('\x00', '')
    return name or 'documento.pdf'


def _validate_selected_path(value):
    path = Path(value)
    if not path.is_absolute():
        raise ValueError('The selected path must be absolute')
    if path.suffix.lower() != '.pdf':
        raise ValueError('The selected path must be a PDF')
    if not path.parent.is_dir():
        raise ValueError('The selected directory is unavailable')
    return path.resolve()


def _validate_open_path(value):
    path = Path(value)
    if not path.is_absolute():
        raise ValueError('The selected path must be absolute')
    if not path.is_file():
        raise ValueError('The selected file does not exist')
    return path.resolve()


def _foreground_window():
    if os.name != 'nt':
        return None
    user32 = ctypes.windll.user32
    handle = user32.GetForegroundWindow()
    return handle if handle and user32.IsWindow(handle) else None


def _windows_save_picker(suggested_name, owner_hwnd=None, user32=None, common_dialog=None, initial_dir=None):
    if os.name != 'nt':
        raise OSError('Native save dialogs are only available on Windows')
    user32 = user32 or ctypes.windll.user32
    common_dialog = common_dialog or ctypes.windll.comdlg32
    buffer = ctypes.create_unicode_buffer(32768)
    buffer.value = suggested_name
    dialog = _OPENFILENAMEW()
    dialog.lStructSize = ctypes.sizeof(_OPENFILENAMEW)
    if owner_hwnd and user32.IsWindow(owner_hwnd):
        dialog.hwndOwner = owner_hwnd
    dialog.lpstrFilter = 'Documento PDF (*.pdf)\x00*.pdf\x00\x00'
    dialog.lpstrFile = ctypes.cast(buffer, wintypes.LPWSTR)
    dialog.nMaxFile = len(buffer)
    dialog.lpstrTitle = 'Guardar PDF como'
    if initial_dir:
        dialog.lpstrInitialDir = initial_dir
        buffer.value = str(Path(initial_dir) / suggested_name)
    dialog.lpstrDefExt = 'pdf'
    dialog.Flags = OFN_OVERWRITEPROMPT | OFN_NOCHANGEDIR | OFN_PATHMUSTEXIST | OFN_EXPLORER
    if common_dialog.GetSaveFileNameW(ctypes.byref(dialog)):
        return Path(buffer.value)
    error = common_dialog.CommDlgExtendedError()
    if error:
        raise OSError(f'GetSaveFileNameW failed: {error}')
    return None


def _windows_open_picker(filter_str=None, title=None, owner_hwnd=None, user32=None, common_dialog=None):
    if os.name != 'nt':
        raise OSError('Native open dialogs are only available on Windows')
    user32 = user32 or _open_dialog_api()
    common_dialog = common_dialog or ctypes.windll.comdlg32
    buffer = ctypes.create_unicode_buffer(32768)
    dialog = _OPENFILENAMEW()
    dialog.lStructSize = ctypes.sizeof(_OPENFILENAMEW)
    if owner_hwnd and user32.IsWindow(owner_hwnd):
        dialog.hwndOwner = owner_hwnd

    default_filter = (
        'Documentos compatibles (*.pdf;*.docx;*.xlsx;*.pptx;*.doc;*.xls;*.ppt)\x00'
        '*.pdf;*.docx;*.xlsx;*.pptx;*.doc;*.xls;*.ppt\x00'
        'Documentos PDF (*.pdf)\x00*.pdf\x00'
        'Documentos Word (*.docx;*.doc)\x00*.docx;*.doc\x00'
        'Hojas de calculo Excel (*.xlsx;*.xls)\x00*.xlsx;*.xls\x00'
        'Presentaciones PowerPoint (*.pptx;*.ppt)\x00*.pptx;*.ppt\x00'
        'Todos los archivos (*.*)\x00*.*\x00\x00'
    )
    dialog.lpstrFilter = filter_str or default_filter
    dialog.lpstrFile = ctypes.cast(buffer, wintypes.LPWSTR)
    dialog.nMaxFile = len(buffer)
    dialog.lpstrTitle = title or 'Abrir Archivo'
    hook_type = ctypes.WINFUNCTYPE(ctypes.c_ssize_t, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM)
    dialog_hwnd, positioning, user_moved = None, False, False

    @hook_type
    def position_hook(code, wparam, lparam):
        nonlocal dialog_hwnd, positioning, user_moved
        if code >= 0 and lparam and not positioning and not user_moved:
            try:
                event = ctypes.cast(lparam, ctypes.POINTER(_CWPRETSTRUCT)).contents
                if dialog_hwnd is None and event.message == 0x0047:
                    kind, caption = ctypes.create_unicode_buffer(128), ctypes.create_unicode_buffer(256)
                    user32.GetClassNameW(event.hwnd, kind, len(kind))
                    if kind.value == '#32770':
                        user32.GetWindowTextW(event.hwnd, caption, len(caption))
                        if caption.value == dialog.lpstrTitle:
                            dialog_hwnd = event.hwnd
                if event.hwnd == dialog_hwnd:
                    if event.message in (0x0231, 0x0112):
                        user_moved = True
                    elif event.message == 0x0047:
                        positioning = True
                        _position_open_dialog(dialog_hwnd, owner_hwnd, user32)
            except Exception:
                logging.getLogger(__name__).warning('Could not position the open dialog', exc_info=True)
            finally:
                positioning = False
        return user32.CallNextHookEx(None, code, wparam, lparam)

    dialog.Flags = OFN_NOCHANGEDIR | OFN_PATHMUSTEXIST | OFN_FILEMUSTEXIST | OFN_EXPLORER
    hook = user32.SetWindowsHookExW(12, ctypes.cast(position_hook, ctypes.c_void_p), None,
                                  ctypes.windll.kernel32.GetCurrentThreadId())
    if not hook:
        logging.getLogger(__name__).warning('Could not install open-dialog positioning: %s', ctypes.get_last_error())
    try:
        selected = common_dialog.GetOpenFileNameW(ctypes.byref(dialog))
    finally:
        if hook:
            user32.UnhookWindowsHookEx(hook)
    if selected:
        return Path(buffer.value)
    error = common_dialog.CommDlgExtendedError()
    if error:
        raise OSError(f'GetOpenFileNameW failed: {error}')
    return None


class NativeFileDialog:
    """Mantiene un único selector activo en un trabajador dedicado."""

    def __init__(self, picker=None, open_picker=None, foreground_window=None):
        self._picker = picker or _windows_save_picker
        self._open_picker = open_picker or _windows_open_picker
        self._foreground_window = foreground_window or _foreground_window
        self._requests = queue.Queue()
        self._state_lock = threading.Lock()
        self._active = False
        self._worker = threading.Thread(target=self._run, name='AliothNativeFileDialog', daemon=True)
        self._worker.start()

    def request_save(self, suggested_name, initial_dir=None):
        if initial_dir is not None and (not Path(initial_dir).is_absolute() or not Path(initial_dir).is_dir()):
            raise ValueError('INVALID_INITIAL_DIRECTORY')
        request = _DialogRequest(
            _suggested_filename(suggested_name),
            threading.Event(),
            owner_hwnd=self._foreground_window(),
            mode='save',
            initial_dir=initial_dir
        )
        with self._state_lock:
            if self._active:
                raise DialogBusyError('DIALOG_BUSY')
            self._active = True
        self._requests.put(request)
        request.done.wait()
        if request.error:
            raise request.error
        return request.result

    def request_open(self, title=None, filter_str=None):
        request = _DialogRequest(
            '',
            threading.Event(),
            owner_hwnd=self._foreground_window(),
            mode='open',
            filter_str=filter_str,
            title=title
        )
        with self._state_lock:
            if self._active:
                raise DialogBusyError('DIALOG_BUSY')
            self._active = True
        self._requests.put(request)
        request.done.wait()
        if request.error:
            raise request.error
        return request.result

    def _run(self):
        while True:
            request = self._requests.get()
            try:
                if request.mode == 'open':
                    selected = self._open_picker(request.filter_str, request.title, request.owner_hwnd)
                    request.result = NativeDialogResult(True) if selected is None else NativeDialogResult(False, _validate_open_path(selected))
                else:
                    selected = (self._picker(request.suggested_name, request.owner_hwnd, initial_dir=request.initial_dir)
                                if request.initial_dir else self._picker(request.suggested_name, request.owner_hwnd))
                    request.result = NativeDialogResult(True) if selected is None else NativeDialogResult(False, _validate_selected_path(selected))
            except Exception as error:
                request.error = error
            finally:
                with self._state_lock:
                    self._active = False
                request.done.set()
