"""Launch the optional shared-runtime WebView2 host without changing browser data."""
from pathlib import Path
import os
import secrets
import subprocess
import threading
import time
from _process_lifecycle import track_host

HOST_ORIGIN = 'http://alioth.localhost'
_sessions = {}
_processes = set()
_lock = threading.Lock()


def active_host_count():
    with _lock:
        _processes.intersection_update(process for process in tuple(_processes) if process.poll() is None)
        return len(_processes)


def notify_ready(token):
    with _lock:
        event = _sessions.get(token)
    if event:
        event.set()
    return event is not None


def host_executable(bundle):
    root = Path(bundle) / 'native_host'
    for path in (root / 'AliothPDFHost.exe', root / 'bin/AliothPDFHost.exe'):
        if path.is_file():
            return path
    return None


def startup_failure_choice():
    import ctypes
    answer = ctypes.windll.user32.MessageBoxW(
        None,
        'No se pudo abrir la ventana del editor. Tus datos guardados se conservan.\n\n'
        'Reintentar: volver a abrir el editor.\n'
        'Omitir: abrir la interfaz anterior, cuyos datos pueden estar desactualizados.\n'
        'Anular: cancelar este intento.',
        'ALIOTH PDF EDITOR', 0x132)
    return {4: 'retry', 5: 'legacy'}.get(answer, 'cancel')


def _clear_late_ready(token, event, process):
    while not event.wait(1):
        if process.poll() is not None:
            break
    with _lock:
        _sessions.pop(token, None)


def launch_native_host(url, bundle, launch_external=lambda action: action(), profile=None):
    executable = host_executable(bundle)
    if os.name != 'nt' or not executable:
        return False
    if profile is None:
        profile = Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'AliothPDFEditor/WebView2'
    token = secrets.token_hex(24)
    event = threading.Event()
    with _lock:
        _sessions[token] = event
    process = None
    ready = False
    late_ready = False
    try:
        process = launch_external(lambda: subprocess.Popen(
            [str(executable), url, str(profile), str(Path(bundle).resolve()), token], cwd=executable.parent))
        track_host(process, executable)
        with _lock:
            _processes.add(process)
        until = time.monotonic() + 30
        while time.monotonic() < until:
            if event.wait(.2):
                ready = process.poll() is None
                return ready
            if process.poll() is not None:
                return False
        if process.poll() is None:
            ready = True
            late_ready = True
            threading.Thread(target=_clear_late_ready, args=(token, event, process), daemon=True).start()
            print('[NativeHost] Confirmacion de arranque pendiente; se conserva la ventana actual.')
            return True
        return False
    except OSError:
        return False
    finally:
        with _lock:
            if not late_ready:
                _sessions.pop(token, None)
            if not ready:
                _processes.discard(process)
