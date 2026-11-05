import ctypes
from ctypes import wintypes
import hashlib
import json
import os
from pathlib import Path
import ssl
import tempfile


def certificate_installed(certificate):
    if os.name != 'nt':
        return False
    return any(encoded == certificate and encoding == 'x509_asn'
               for encoded, encoding, _ in ssl.enum_certificates('ROOT'))


def install_certificate(certificate):
    if certificate_installed(certificate):
        return True
    crypt = ctypes.WinDLL('crypt32', use_last_error=True)
    crypt.CertOpenStore.argtypes = [ctypes.c_void_p, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD, ctypes.c_void_p]
    crypt.CertOpenStore.restype = ctypes.c_void_p
    crypt.CertAddEncodedCertificateToStore.argtypes = [ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(ctypes.c_ubyte), wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p]
    crypt.CertAddEncodedCertificateToStore.restype = wintypes.BOOL
    crypt.CertCloseStore.argtypes = [ctypes.c_void_p, wintypes.DWORD]
    crypt.CertCloseStore.restype = wintypes.BOOL
    # CERT_STORE_PROV_SYSTEM_W, CURRENT_USER, OPEN_EXISTING.
    store = crypt.CertOpenStore(10, 0, None, 0x00010000 | 0x00004000, ctypes.cast(ctypes.c_wchar_p('ROOT'), ctypes.c_void_p))
    if not store:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        encoded = (ctypes.c_ubyte * len(certificate)).from_buffer_copy(certificate)
        # X509_ASN_ENCODING, CERT_STORE_ADD_USE_EXISTING.
        if not crypt.CertAddEncodedCertificateToStore(store, 1, encoded, len(certificate), 2, None):
            raise ctypes.WinError(ctypes.get_last_error())
    finally:
        crypt.CertCloseStore(store, 0)
    return certificate_installed(certificate)


def registration_entries(executable, launcher=None, icon=None):
    command = f'"{executable}" "{launcher}" "%1"' if launcher else f'"{executable}" "%1"'
    icon = f'"{icon or executable}",0'
    progid = r'Software\Classes\Alioth.PDF'
    capabilities = r'Software\AliothPDFEditor\Capabilities'
    entries = [
        (progid, '', 'Alioth PDF Document'),
        (progid, 'FriendlyTypeName', 'Alioth PDF Document'),
        (progid + r'\DefaultIcon', '', icon),
        (progid + r'\Application', 'ApplicationIcon', icon),
        (progid + r'\Application', 'ApplicationName', 'Alioth PDF Editor'),
        (progid + r'\Application', 'ApplicationCompany', 'ALIOTH TDAH LABS - OPEN SOURCE PROJECT'),
        (progid + r'\shell', '', 'open'),
        (progid + r'\shell\open', 'FriendlyAppName', 'Alioth PDF Editor'),
        (progid + r'\shell\open\command', '', command),
        (capabilities, 'ApplicationDescription', 'Alioth PDF Editor'),
        (capabilities, 'ApplicationName', 'Alioth PDF Editor'),
        (capabilities, 'ApplicationIcon', icon),
        (capabilities + r'\FileAssociations', '.pdf', 'Alioth.PDF'),
        (r'Software\RegisteredApplications', 'AliothPDFEditor', capabilities),
    ]
    if not launcher:
        application = r'Software\Classes\Applications' + '\\' + os.path.basename(executable)
        entries.extend([
            (application, 'FriendlyAppName', 'Alioth PDF Editor'),
            (application + r'\DefaultIcon', '', icon),
            (application + r'\shell\open\command', '', command),
            (application + r'\SupportedTypes', '.pdf', ''),
        ])
    return entries


def registration_matches(entries):
    import winreg
    try:
        for path, name, expected in entries:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, path) as key:
                if winreg.QueryValueEx(key, name)[0] != expected:
                    return False
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Software\Classes\.pdf\OpenWithProgids') as key:
            winreg.QueryValueEx(key, 'Alioth.PDF')
        return True
    except FileNotFoundError:
        return False


def register_pdf(executable, launcher=None, icon=None):
    import winreg
    entries = registration_entries(executable, launcher, icon)
    changed = not registration_matches(entries)
    if changed:
        for path, name, value in entries:
            with winreg.CreateKey(winreg.HKEY_CURRENT_USER, path) as key:
                winreg.SetValueEx(key, name, 0, winreg.REG_SZ, value)
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, r'Software\Classes\.pdf\OpenWithProgids') as key:
            winreg.SetValueEx(key, 'Alioth.PDF', 0, winreg.REG_NONE, b'')
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Software\Classes\Alioth.PDF', 0, winreg.KEY_READ | winreg.KEY_WRITE) as key:
            if winreg.QueryValueEx(key, 'AppUserModelID')[0] == 'Alioth.PDF.Editor':
                winreg.DeleteValue(key, 'AppUserModelID')
                changed = True
    except FileNotFoundError:
        pass
    if changed:
        ctypes.windll.shell32.SHChangeNotify(0x08000000, 0, None, None)
    return True


def initialize_once(certificate, executable, launcher=None, icon=None, *, state_path=None, force=False):
    """Attempt per-user integration once; cache denials too to avoid repeated prompts.

    A different certificate or launch location invalidates only its own result.
    Explicit repair can use force=True. No elevation or default-app override.
    """
    if os.name != 'nt':
        return {'supported': False}
    path = Path(state_path) if state_path is not None else (
        Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'AliothPDFEditor/startup-integration.json')
    certificate_id = hashlib.sha256(certificate).hexdigest()
    target_id = hashlib.sha256(json.dumps(registration_entries(executable, launcher, icon),
                                        ensure_ascii=False).encode('utf-8')).hexdigest()

    def read_state():
        try:
            if path.stat().st_size > 65536:
                return {}
            state = json.loads(path.read_text(encoding='utf-8'))
            return state if isinstance(state, dict) and state.get('version') == 1 else {}
        except (OSError, ValueError):
            return {}

    def completed(state, key, identity):
        entry = state.get(key)
        return isinstance(entry, dict) and entry.get('id') == identity and type(entry.get('ok')) is bool

    def ready(state):
        return completed(state, 'certificate', certificate_id) and completed(state, 'registration', target_id)

    state = read_state()
    if not force and ready(state):
        return state
    path.parent.mkdir(parents=True, exist_ok=True)
    # Two simultaneous launches must not both perform first-use installation.
    import msvcrt
    with path.with_suffix('.lock').open('a+b') as lock:
        if lock.tell() == 0:
            lock.write(b'0')
            lock.flush()
        lock.seek(0)
        try:
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            return {'supported': True, 'busy': True}
        try:
            state = read_state()
            state['version'] = 1
            for key, identity, operation in [
                ('certificate', certificate_id, lambda: install_certificate(certificate)),
                ('registration', target_id, lambda: register_pdf(executable, launcher, icon))
            ]:
                if not force and completed(state, key, identity):
                    continue
                try:
                    state[key] = {'id': identity, 'ok': bool(operation())}
                except OSError as error:
                    state[key] = {'id': identity, 'ok': False, 'error': error.__class__.__name__}
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent,
                                                 prefix='.startup-', delete=False) as output:
                    temporary = Path(output.name)
                    json.dump(state, output, ensure_ascii=False)
                    output.flush()
                    os.fsync(output.fileno())
                os.replace(temporary, path)
            finally:
                if temporary is not None:
                    temporary.unlink(missing_ok=True)
            return state
        finally:
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)


def default_pdf_executable():
    api = ctypes.WinDLL('shlwapi', use_last_error=True).AssocQueryStringW
    api.argtypes = [wintypes.DWORD, wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
    api.restype = ctypes.c_long
    result = ctypes.create_unicode_buffer(32768)
    length = wintypes.DWORD(len(result))
    return result.value if api(0, 2, '.pdf', None, result, ctypes.byref(length)) == 0 else None


def integration_status(certificate, executable, launcher=None, icon=None):
    if os.name != 'nt':
        return {'supported': False}
    result = {'supported': True, 'errors': [], 'certificateInstalled': False,
              'registered': False, 'defaultIsAlioth': False, 'currentExecutableIsDefault': False,
              'certificateThumbprint': hashlib.sha1(certificate).hexdigest().upper()}
    for key, operation in [('certificateInstalled', lambda: certificate_installed(certificate)),
                           ('registered', lambda: registration_matches(registration_entries(executable, launcher, icon)))]:
        try:
            result[key] = operation()
        except OSError:
            result['errors'].append(key)
    try:
        default = default_pdf_executable()
        result['currentExecutableIsDefault'] = bool(default and os.path.normcase(default) == os.path.normcase(executable))
        result['defaultIsAlioth'] = result['currentExecutableIsDefault'] or bool(default and os.path.basename(default).lower().startswith('alioth_pdf_editor_'))
        if launcher:
            import winreg
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.pdf\UserChoice') as key:
                result['defaultIsAlioth'] = winreg.QueryValueEx(key, 'ProgId')[0] == 'Alioth.PDF'
    except OSError:
        result['errors'].append('defaultAssociation')
    return result
