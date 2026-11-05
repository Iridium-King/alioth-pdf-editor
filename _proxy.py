# ============================================================
# ALIOTH PDF EDITOR - Servidor + Proxy AI (v3.1)
# ============================================================

import sys, http.server, json, mimetypes, os, ssl, urllib.request, urllib.error, urllib.parse, configparser, base64, hashlib
import tempfile, shutil, subprocess, threading, time, queue, uuid, weakref, re, email.utils
from contextlib import contextmanager
_proxy_module_dir = os.path.dirname(os.path.abspath(__file__))
if _proxy_module_dir not in sys.path:
    sys.path.insert(0, _proxy_module_dir)
from _native_file_dialog import DialogBusyError, NativeFileDialog
from _native_save import NativeSaveStore
from _transfer_store import TransferStore
from _pdf_text import extract_pdf_text, PDF_TEXT_LIMIT
from _user_preferences import UserPreferences, preference_key
from _native_host import HOST_ORIGIN, launch_native_host, notify_ready, active_host_count, host_executable, startup_failure_choice
from _browser_migration import browser_migration
from _file_origin import explorer_paths, resolve_file_origin
from _windows_integration import install_certificate, register_pdf, integration_status, initialize_once
from _process_lifecycle import reap_inactive_hosts
from _system_fonts import resolve_font

if getattr(sys, 'frozen', False):
    bundle_dir = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
    exe_dir = os.path.dirname(sys.executable)
else:
    bundle_dir = os.path.dirname(os.path.abspath(__file__))
    exe_dir = bundle_dir

base_dir = bundle_dir
os.chdir(base_dir)

class AliothHTTPServer(getattr(http.server, 'ThreadingHTTPServer', http.server.HTTPServer)):
    allow_reuse_address = False

def create_secure_ssl_context():
    """Valida cadena y hostname; tolera CAs corporativas heredadas sin Key Usage."""
    try:
        ctx = ssl.create_default_context()
    except Exception:
        import certifi
        ctx = ssl.create_default_context(cafile=certifi.where())
    strict_flag = getattr(ssl, 'VERIFY_X509_STRICT', 0)
    if strict_flag:
        ctx.verify_flags &= ~strict_flag
    return ctx

_SSL_CTX = create_secure_ssl_context()

UA_BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
_TRANSFER_STORE = TransferStore()
MAX_REQUEST_BODY_BYTES = 100 * 1024 * 1024
_TRANSLATION_PDF_LIMIT = 64 * 1024 * 1024
_TRANSLATION_FONT_LIMIT = 16 * 1024 * 1024
_TRANSLATION_LOCK = threading.Lock()
_TRANSLATION_MODULE = None
_TRANSLATION_MODULE_MTIME = None


def _load_translation_module():
    global _TRANSLATION_MODULE, _TRANSLATION_MODULE_MTIME
    path = os.path.join(bundle_dir, 'js', 'pdf_translation.py')
    mtime = os.stat(path).st_mtime_ns
    if _TRANSLATION_MODULE is None or _TRANSLATION_MODULE_MTIME != mtime:
        import importlib.util
        spec = importlib.util.spec_from_file_location('alioth_pdf_translation', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        _TRANSLATION_MODULE = module
        _TRANSLATION_MODULE_MTIME = mtime
    return _TRANSLATION_MODULE


def _translation_request(data):
    import math
    if not isinstance(data, dict) or set(data) - {'operation', 'pdfBase64', 'pageIndices', 'occurrences', 'fonts'}:
        raise ValueError('INVALID_TRANSLATION_REQUEST')
    operation = data.get('operation')
    if operation not in ('extract', 'extract-notes', 'preflight', 'reconstruct'):
        raise ValueError('INVALID_TRANSLATION_REQUEST')
    encoded = data.get('pdfBase64')
    if not isinstance(encoded, str) or not encoded:
        raise ValueError('INVALID_TRANSLATION_SOURCE')
    if len(encoded) > ((_TRANSLATION_PDF_LIMIT + 2) // 3) * 4:
        raise OverflowError('TRANSLATION_NATIVE_LIMIT')
    try:
        pdf = base64.b64decode(encoded, validate=True)
    except Exception:
        raise ValueError('INVALID_TRANSLATION_SOURCE') from None
    if len(pdf) > _TRANSLATION_PDF_LIMIT:
        raise OverflowError('TRANSLATION_NATIVE_LIMIT')
    if operation in ('extract', 'extract-notes'):
        pages = data.get('pageIndices')
        if pages is not None and (not isinstance(pages, list) or any(type(page) is not int or page < 0 for page in pages)):
            raise ValueError('INVALID_TRANSLATION_REQUEST')
        if pages is not None and len(pages) > 2000:
            raise OverflowError('TRANSLATION_NATIVE_LIMIT')
        return operation, pdf, pages, None
    occurrences, fonts = data.get('occurrences'), data.get('fonts', {})
    if not isinstance(occurrences, list) or not occurrences or not isinstance(fonts, dict):
        raise ValueError('INVALID_TRANSLATION_REQUEST')
    if len(occurrences) > 20000 or len(fonts) > 128:
        raise OverflowError('TRANSLATION_NATIVE_LIMIT')
    font_bytes = 0
    for key, value in fonts.items():
        if not isinstance(key, str) or not 1 <= len(key) <= 256 or not isinstance(value, str):
            raise ValueError('INVALID_TRANSLATION_FONT')
        if len(value) > ((_TRANSLATION_FONT_LIMIT + 2) // 3) * 4:
            raise OverflowError('TRANSLATION_NATIVE_LIMIT')
        try:
            font_bytes += len(base64.b64decode(value, validate=True))
        except Exception:
            raise ValueError('INVALID_TRANSLATION_FONT') from None
        if font_bytes > _TRANSLATION_FONT_LIMIT:
            raise OverflowError('TRANSLATION_NATIVE_LIMIT')
    builtins = {'helv', 'hebo', 'heit', 'hebi', 'tiro', 'tibo', 'tiit', 'tibi', 'cour', 'cobo', 'coit', 'cobi'}
    def number(value):
        return type(value) in (int, float) and math.isfinite(value)
    for item in occurrences:
        if not isinstance(item, dict):
            raise ValueError('INVALID_TRANSLATION_OCCURRENCE')
        rect, color, origin, font = item.get('rect'), item.get('color'), item.get('origin'), item.get('fontKey')
        if (not isinstance(item.get('id'), str) or not item['id']
                or type(item.get('pageIndex')) is not int or item['pageIndex'] < 0
                or any(not isinstance(item.get(key), str) or not item[key].strip() for key in ('sourceText', 'translatedText'))
                or not isinstance(rect, dict) or not all(number(rect.get(key)) for key in ('x0', 'y0', 'x1', 'y1'))
                or rect['x1'] <= rect['x0'] or rect['y1'] <= rect['y0']
                or not isinstance(color, list) or len(color) != 3 or any(not number(channel) or not 0 <= channel <= 1 for channel in color)
                or not number(item.get('fontSize')) or item['fontSize'] <= 0
                or item.get('fitMode', 'strict') not in ('strict', 'shrink', 'adaptive')
                or item.get('renderMode', 'replace') not in ('replace', 'scan-overlay')
                or not isinstance(font, str) or not (font in builtins or re.fullmatch(r'embedded:\d+', font) or font in fonts)
                or origin is not None and (not isinstance(origin, list) or len(origin) != 2 or not all(number(value) for value in origin))):
            raise ValueError('INVALID_TRANSLATION_OCCURRENCE')
    return operation, pdf, occurrences, fonts

def get_config_path():
    # 1. Config.ini junto al ejecutable .exe (permite personalizar)
    local_cfg = os.path.join(exe_dir, 'config.ini')
    if os.path.exists(local_cfg):
        return local_cfg

    # Los paquetes one-file extraen sus recursos en una carpeta temporal.
    # Las credenciales nuevas deben escribirse en un directorio persistente.
    if not getattr(sys, 'frozen', False):
        return os.path.join(bundle_dir, 'config.ini')

    app_name = 'AliothPDF-Distribucion' if 'distribucion' in os.path.basename(sys.executable).lower() else 'AliothPDF'
    appdata_dir = os.path.join(os.environ.get('APPDATA', exe_dir), app_name)
    try: os.makedirs(appdata_dir, exist_ok=True)
    except: pass
    return os.path.join(appdata_dir, 'config.ini')

def load_config():
    cfg = configparser.ConfigParser()
    if getattr(sys, 'frozen', False):
        # La configuración embebida aporta únicamente las claves personales.
        bundled_cfg = os.path.join(bundle_dir, 'config.ini')
        if os.path.isfile(bundled_cfg):
            cfg.read(bundled_cfg, encoding='utf-8')
    p = get_config_path()
    if os.path.exists(p):
        cfg.read(p, encoding='utf-8')
    return cfg


def _preferences_store():
    directory = os.path.dirname(get_config_path())
    if getattr(sys, 'frozen', False):
        app_name = 'AliothPDF-Distribucion' if 'distribucion' in os.path.basename(sys.executable).lower() else 'AliothPDF'
        directory = os.path.join(os.environ.get('APPDATA', exe_dir), app_name)
    return UserPreferences(os.path.join(directory, 'preferences.json'))


_USER_PREFERENCES = _preferences_store()

_TRANSLATION_METRICS_LOCK = threading.Lock()
_TRANSLATION_METRICS_MAX_BYTES = 10 * 1024 * 1024
_TRANSLATION_CHECKPOINT_LOCK = threading.Lock()
_TRANSLATION_METRIC_FIELDS = {
    'jobId', 'event', 'clientTimestamp', 'documentName', 'targetLanguage',
    'scopePages', 'totalPages', 'totalUnits', 'eligibleUnits', 'uniqueTexts',
    'skippedUnits', 'totalBatches', 'maxBatchItems', 'maxBatchCharacters',
    'concurrency', 'batchId', 'batchIndex', 'attemptKind', 'itemCount',
    'characterCount', 'durationMs', 'provider', 'model', 'providerAttempts',
    'returnedCount', 'missingCount', 'completedUnits', 'status', 'errorCode',
    'extractionMs', 'providerMs', 'validationMs', 'readyCount',
    'exceptionCount', 'retainedCount', 'selectedUnits', 'reconstructedPages',
    'applyMs', 'attemptNumber', 'operation', 'httpStatus', 'errorType',
    'reasonType', 'timeoutMs', 'remainingBudgetMs', 'retryAfterSeconds', 'retryNumber',
    'stage', 'sourceIndex', 'pageIndex', 'imageIndex', 'byteLength', 'imageCount',
    'unitCount', 'pixelCount', 'ocrRegionCount', 'engine'
}


def get_translation_metrics_path():
    log_dir = os.path.join(os.path.dirname(get_config_path()), 'logs')
    os.makedirs(log_dir, exist_ok=True)
    return os.path.join(log_dir, 'translation-metrics.jsonl')


def _validated_translation_metric(data):
    if not isinstance(data, dict) or set(data) - _TRANSLATION_METRIC_FIELDS:
        raise ValueError('INVALID_TRANSLATION_METRIC')
    event, job_id = data.get('event'), data.get('jobId')
    if not isinstance(event, str) or not re.fullmatch(r'[a-z][a-z0-9_]{1,48}', event):
        raise ValueError('INVALID_TRANSLATION_METRIC')
    if not isinstance(job_id, str) or not re.fullmatch(r'translation-job_[a-z0-9_\-]{6,80}', job_id):
        raise ValueError('INVALID_TRANSLATION_METRIC')
    clean = {'serverTimestamp': time.strftime('%Y-%m-%dT%H:%M:%S', time.localtime())}
    for key, value in data.items():
        if isinstance(value, bool) or value is None:
            clean[key] = value
        elif isinstance(value, (int, float)) and not isinstance(value, bool):
            clean[key] = value
        elif isinstance(value, str):
            clean[key] = value[:300]
        else:
            raise ValueError('INVALID_TRANSLATION_METRIC')
    return clean


def record_translation_metric(data):
    metric = _validated_translation_metric(data)
    encoded = (json.dumps(metric, ensure_ascii=False, separators=(',', ':')) + '\n').encode('utf-8')
    path = get_translation_metrics_path()
    with _TRANSLATION_METRICS_LOCK:
        if os.path.exists(path) and os.path.getsize(path) + len(encoded) > _TRANSLATION_METRICS_MAX_BYTES:
            previous = path + '.1'
            try:
                if os.path.exists(previous): os.remove(previous)
                os.replace(path, previous)
            except OSError:
                pass
        with open(path, 'ab') as stream:
            stream.write(encoded)
    return path


def try_record_translation_metric(data):
    try:
        record_translation_metric(data)
    except Exception:
        pass


_APP_DIAG_LOCK = threading.Lock()
_APP_DIAG_MAX_BYTES = 10 * 1024 * 1024


def get_app_diag_log_path():
    log_dir = os.path.join(os.path.dirname(get_config_path()), 'logs')
    os.makedirs(log_dir, exist_ok=True)
    return os.path.join(log_dir, 'app-diag.jsonl')


def record_app_diag_log(entry):
    if not isinstance(entry, dict):
        return
    clean_entry = dict(entry)
    if 'serverTimestamp' not in clean_entry:
        clean_entry['serverTimestamp'] = time.strftime('%Y-%m-%dT%H:%M:%S', time.localtime())
    try:
        encoded = (json.dumps(clean_entry, ensure_ascii=False) + '\n').encode('utf-8')
    except Exception:
        encoded = b'{"serialization":"failed"}\n'
    path = get_app_diag_log_path()
    with _APP_DIAG_LOCK:
        if os.path.exists(path) and os.path.getsize(path) + len(encoded) > _APP_DIAG_MAX_BYTES:
            previous = path + '.1'
            try:
                if os.path.exists(previous):
                    os.remove(previous)
                os.replace(path, previous)
            except OSError:
                pass
        with open(path, 'ab') as stream:
            stream.write(encoded)
    return path


def _translation_extraction_diagnostics(data):
    if (not isinstance(data, dict) or set(data) != {'jobId', 'sourceIndex'}
            or type(data.get('sourceIndex')) is not int or data['sourceIndex'] < 0):
        return None
    try:
        _validated_translation_metric({**data, 'event': 'extraction_stage_started'})
    except (ValueError, TypeError):
        return None
    def diagnostics(event):
        try:
            try_record_translation_metric({**event, **data, 'engine': 'native'})
        except Exception:
            pass
    return diagnostics


@contextmanager
def _translation_extraction_stage(diagnostics, stage, **fields):
    if not callable(diagnostics):
        yield fields
        return
    def emit(event, **extra):
        try:
            diagnostics({'event': event, 'stage': stage, **fields, **extra})
        except Exception:
            pass
    started = time.perf_counter()
    emit('extraction_stage_started')
    try:
        yield fields
    except Exception as exc:
        emit('extraction_stage_completed', status='failed', errorType=type(exc).__name__,
             durationMs=round((time.perf_counter() - started) * 1000))
        raise
    else:
        emit('extraction_stage_completed', status='ok',
             durationMs=round((time.perf_counter() - started) * 1000))


def _translation_checkpoint_file(key, index):
    if not isinstance(key, str) or not re.fullmatch(r'[0-9a-f]{64}', key):
        raise ValueError('INVALID_TRANSLATION_CHECKPOINT')
    if type(index) is not int or not 0 <= index < 5000:
        raise ValueError('INVALID_TRANSLATION_CHECKPOINT')
    directory = os.path.join(os.path.dirname(get_config_path()), 'translation-checkpoints', key)
    return directory, os.path.join(directory, f'{index}.dat')


def _read_translation_checkpoint(path, expected, allow_partial=False):
    try:
        with open(path, 'r', encoding='ascii') as stream:
            saved = json.loads(_unprotect_secret(stream.read()))
        if saved.get('expectedIds') != expected or time.time() - saved.get('updated', 0) > 7 * 86400:
            return {}
        result = saved.get('translations')
        if not isinstance(result, dict) or not result:
            return {}
        valid_ids = set(result) <= set(expected) if allow_partial else set(result) == set(expected)
        return result if valid_ids and all(isinstance(v, str) and v.strip() and len(v) <= 12000 for v in result.values()) else {}
    except (OSError, ValueError, TypeError, AttributeError):
        return {}


def translation_checkpoint(data):
    if not isinstance(data, dict) or set(data) - {'operation', 'key', 'batchIndex', 'expectedIds', 'translations', 'allowPartial'}:
        raise ValueError('INVALID_TRANSLATION_CHECKPOINT')
    allow_partial = data.get('allowPartial', False)
    if type(allow_partial) is not bool:
        raise ValueError('INVALID_TRANSLATION_CHECKPOINT')
    operation, expected = data.get('operation'), data.get('expectedIds')
    if operation not in ('load', 'store') or not isinstance(expected, list) or not 1 <= len(expected) <= 64:
        raise ValueError('INVALID_TRANSLATION_CHECKPOINT')
    if any(not isinstance(item, str) or not re.fullmatch(r'u\d{1,7}', item) for item in expected) or len(set(expected)) != len(expected):
        raise ValueError('INVALID_TRANSLATION_CHECKPOINT')
    directory, path = _translation_checkpoint_file(data.get('key'), data.get('batchIndex'))
    if operation == 'load':
        return _read_translation_checkpoint(path, expected, allow_partial)
    result = data.get('translations')
    if (not isinstance(result, dict) or not result
            or (not set(result) <= set(expected) if allow_partial else set(result) != set(expected))
            or any(not isinstance(v, str) or not v.strip() or len(v) > 12000 for v in result.values())):
        raise ValueError('INVALID_TRANSLATION_CHECKPOINT')
    os.makedirs(directory, exist_ok=True)
    with _TRANSLATION_CHECKPOINT_LOCK:
        if allow_partial:
            result = {**_read_translation_checkpoint(path, expected, True), **result}
        encoded = _protect_secret(json.dumps({'expectedIds': expected, 'translations': result, 'updated': time.time()}, ensure_ascii=False))
        temporary = path + '.' + uuid.uuid4().hex + '.tmp'
        try:
            with open(temporary, 'w', encoding='ascii') as stream:
                stream.write(encoded)
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.remove(temporary)
    return {}

_SECRET_PREFIX = 'dpapi:'

def _protect_secret(value):
    import win32crypt
    encrypted = win32crypt.CryptProtectData(value.encode('utf-8'), 'Alioth PDF API key', None, None, None, 0)
    if isinstance(encrypted, tuple): encrypted = encrypted[-1]
    return _SECRET_PREFIX + base64.b64encode(encrypted).decode('ascii')

def _unprotect_secret(value):
    if not value or not value.startswith(_SECRET_PREFIX):
        return value or ''
    try:
        import win32crypt
        decrypted = win32crypt.CryptUnprotectData(base64.b64decode(value[len(_SECRET_PREFIX):]), None, None, None, 0)
        if isinstance(decrypted, tuple): decrypted = decrypted[-1]
        return decrypted.decode('utf-8')
    except Exception:
        return ''

def _config_keys(cfg, section):
    return [_unprotect_secret(v.strip()) for k, v in cfg.items(section) if k.startswith('api_key') and v.strip()] if cfg.has_section(section) else []

_CFG = load_config()
GEMINI_KEYS = _config_keys(_CFG, 'gemini')
GROQ_KEYS   = _config_keys(_CFG, 'groq')
MISTRAL_KEYS = _config_keys(_CFG, 'mistral')
HUGGINGFACE_KEYS = _config_keys(_CFG, 'huggingface')
OPENROUTER_KEYS = _config_keys(_CFG, 'openrouter')
NVIDIA_KEYS = _config_keys(_CFG, 'nvidia')

_GEMINI_MODEL_FALLBACKS = ('gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash')
_GROQ_MODEL_FALLBACKS = ('openai/gpt-oss-20b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-120b')
_GEMINI_MODEL_CACHE = {}
_GEMINI_MODEL_CACHE_SECONDS = 900
_GEMINI_VISION_MODEL_CACHE = {}
_GROQ_VISION_MODEL_CACHE = {}
_VISION_MODEL_LOCK = threading.Lock()
_KNOWN_RETIRED_VISION_MODELS = {
    'gemini': frozenset(),
    'groq': frozenset(('meta-llama/llama-4-scout-17b-16e-instruct', 'meta-llama/llama-4-maverick-17b-128e-instruct')),
}
_VISION_MEMORY_PATH = os.path.join(os.environ.get('LOCALAPPDATA') or tempfile.gettempdir(), 'AliothPDF', 'vision-models.json')

def _load_retired_vision_models():
    try:
        with open(_VISION_MEMORY_PATH, encoding='utf-8') as stream:
            saved = json.load(stream)
        return {provider: {model: expiry for model, expiry in saved.get(provider, {}).items()
                if isinstance(model, str) and re.fullmatch(r'[A-Za-z0-9_./-]{1,120}', model)
                and isinstance(expiry, (int, float)) and expiry > time.time()}
                for provider in ('gemini', 'groq')}
    except (OSError, ValueError, TypeError, AttributeError):
        return {'gemini': {}, 'groq': {}}

_RETIRED_VISION_MODELS = _load_retired_vision_models()

def _vision_model_retired(provider, model):
    if model in _KNOWN_RETIRED_VISION_MODELS.get(provider, ()):
        return True
    with _VISION_MODEL_LOCK:
        return _RETIRED_VISION_MODELS.get(provider, {}).get(model, 0) > time.time()

def _remember_retired_vision_model(provider, model):
    if provider not in ('gemini', 'groq') or not re.fullmatch(r'[A-Za-z0-9_./-]{1,120}', model):
        return
    with _VISION_MODEL_LOCK:
        _RETIRED_VISION_MODELS[provider][model] = time.time() + 30 * 86400
        directory = os.path.dirname(_VISION_MEMORY_PATH)
        temporary = _VISION_MEMORY_PATH + '.' + uuid.uuid4().hex + '.tmp'
        try:
            os.makedirs(directory, exist_ok=True)
            with open(temporary, 'w', encoding='utf-8') as stream:
                json.dump(_RETIRED_VISION_MODELS, stream)
            os.replace(temporary, _VISION_MEMORY_PATH)
        except OSError:
            try: os.remove(temporary)
            except OSError: pass

def _vision_model_gone(status, body):
    if status == 404:
        return True
    if status != 400:
        return False
    try:
        error = json.loads(body).get('error', {})
        code = str(error.get('code') or error.get('type') or '').lower()
        message = str(error.get('message') or '').lower()
        return code in ('model_decommissioned', 'model_not_found', 'model_disabled') or 'decommissioned' in message
    except (ValueError, TypeError, AttributeError):
        return False
_TRANSLATION_PROVIDER_COOLDOWNS = {}
_TRANSLATION_PROVIDER_RATE_LIMITS = {}
_TRANSLATION_PROVIDER_QUOTA_STRIKES = {}
_TRANSLATION_PROVIDER_PROBES = {}
_TRANSLATION_PROVIDER_COOLDOWN_LOCK = threading.Lock()
_TRANSLATION_PROVIDER_COOLDOWN_SECONDS = 60
_TRANSLATION_PROVIDER_PREFERENCE = None
_TRANSLATION_PROVIDER_PREFERENCE_SECONDS = 300
_TRANSLATION_MODEL_STATES = {}
_TRANSLATION_CREDENTIAL_STATES = {}
_TRANSLATION_MODEL_LOCK = threading.Lock()


def _translation_model_identity(provider, key, model):
    import hashlib
    return hashlib.sha256(json.dumps([provider, key, model]).encode('utf-8')).digest()


def _translation_credential_wait(provider, key):
    identity = _translation_model_identity(provider, key, '')
    with _TRANSLATION_MODEL_LOCK:
        deadline = _TRANSLATION_CREDENTIAL_STATES.get(identity)
        if deadline and deadline <= time.monotonic():
            del _TRANSLATION_CREDENTIAL_STATES[identity]
            deadline = None
    return max(1, round(deadline - time.monotonic())) if deadline else 0


def _translation_mark_credential_payment_required(provider, key):
    identity = _translation_model_identity(provider, key, '')
    with _TRANSLATION_MODEL_LOCK:
        if len(_TRANSLATION_CREDENTIAL_STATES) >= 512 and identity not in _TRANSLATION_CREDENTIAL_STATES:
            oldest = min(_TRANSLATION_CREDENTIAL_STATES, key=_TRANSLATION_CREDENTIAL_STATES.get)
            del _TRANSLATION_CREDENTIAL_STATES[oldest]
        _TRANSLATION_CREDENTIAL_STATES[identity] = time.monotonic() + 3600


def _translation_model_wait(provider, key, model):
    identity = _translation_model_identity(provider, key, model)
    with _TRANSLATION_MODEL_LOCK:
        state = _TRANSLATION_MODEL_STATES.get(identity)
        if state and state[1] <= time.monotonic():
            del _TRANSLATION_MODEL_STATES[identity]
            state = None
    return (state[0], max(1, round(state[1] - time.monotonic()))) if state else (None, 0)


def _translation_retry_after(value):
    value = value.strip() if isinstance(value, str) else ''
    if re.fullmatch(r'\d{1,9}', value):
        return max(1, min(int(value), 3600))
    try:
        return max(1, min(round(email.utils.parsedate_to_datetime(value).timestamp() - time.time()), 3600))
    except (ValueError, TypeError, OverflowError):
        return 30


def _translation_mark_model_failure(provider, key, model, error):
    if not isinstance(error, urllib.error.HTTPError) or error.code not in (404, 410, 429, 503):
        return 0
    if error.code in (429, 503):
        raw = error.headers.get('Retry-After') if error.headers else None
        delay = _translation_retry_after(raw) if raw else (300 if error.code == 503 else 30)
    else:
        delay = 3600
    identity = _translation_model_identity(provider, key, model)
    with _TRANSLATION_MODEL_LOCK:
        if len(_TRANSLATION_MODEL_STATES) >= 512 and identity not in _TRANSLATION_MODEL_STATES:
            oldest = min(_TRANSLATION_MODEL_STATES, key=lambda item: _TRANSLATION_MODEL_STATES[item][1])
            del _TRANSLATION_MODEL_STATES[oldest]
        _TRANSLATION_MODEL_STATES[identity] = (error.code, time.monotonic() + delay)
    return delay


class _TranslationGenerationBudget:
    def __init__(self):
        self.started = time.monotonic()
        self.deadline = self.started + 45
        self.attempts = 0
        self.failures = set()
        self.metrics = None
        self.network_attempts = 0
        self.retry_after_seconds = 0
        self.provider_waits = {}
        self.probe_token = object()

    def note_provider_wait(self, provider, delay, replace=False):
        if delay > 0:
            previous = self.provider_waits.get(provider)
            self.provider_waits[provider] = delay if replace or previous is None else min(previous, delay)
            self.retry_after_seconds = min(self.provider_waits.values())

    def read_json(self, request, timeout, provider, model='', operation='generate', credential=None):
        self.network_attempts += 1
        started = time.monotonic()
        metric = {**(self.metrics or {}), 'provider': provider, 'model': model,
                  'operation': operation, 'attemptNumber': self.network_attempts,
                  'timeoutMs': round(timeout * 1000),
                  'remainingBudgetMs': max(0, round((self.deadline - started) * 1000))}
        if self.metrics:
            try_record_translation_metric({**metric, 'event': 'provider_attempt_started'})
        http_status = None
        status, code, error_type, reason_type, retry_after = 'ok', None, None, None, None
        try:
            with urllib.request.urlopen(request, timeout=timeout, context=_SSL_CTX) as response:
                http_status = getattr(response, 'status', 200)
                payload = json.loads(response.read())
            if operation == 'generate':
                try:
                    if provider == 'gemini':
                        candidates = payload.get('candidates') or []
                        content = (candidates[0].get('content') or {}) if candidates else {}
                        has_text = any(isinstance(part.get('text'), str) and part['text'].strip() for part in content.get('parts', []))
                    else:
                        choices = payload.get('choices') or []
                        content = (choices[0].get('message') or {}).get('content') if choices else None
                        has_text = isinstance(content, str) and bool(content.strip())
                    if not has_text:
                        status, code = 'failed', 'PROVIDER_EMPTY_RESPONSE'
                except (AttributeError, TypeError, IndexError, KeyError):
                    status, code = 'failed', 'PROVIDER_RESPONSE_ERROR'
            return payload
        except Exception as exc:
            status, error_type = 'failed', type(exc).__name__
            reason = getattr(exc, 'reason', None)
            reason_type = type(reason).__name__ if reason is not None else None
            if isinstance(exc, urllib.error.HTTPError):
                http_status = exc.code
                if operation == 'generate' and credential and exc.code == 402:
                    _translation_mark_credential_payment_required(provider, credential)
                    self.note_provider_wait(provider, 3600)
                if operation == 'generate' and credential and exc.code in (404, 410, 429, 503):
                    delay = _translation_mark_model_failure(provider, credential, model, exc)
                    if exc.code == 429:
                        self.note_provider_wait(provider, delay)
                code = {401: 'PROVIDER_AUTH_FAILED', 402: 'PROVIDER_PAYMENT_REQUIRED', 403: 'PROVIDER_AUTH_FAILED',
                        429: 'PROVIDER_RATE_LIMITED', 408: 'PROVIDER_TIMEOUT',
                        504: 'PROVIDER_TIMEOUT', 404: 'PROVIDER_NOT_FOUND', 410: 'PROVIDER_NOT_FOUND'}.get(exc.code, 'PROVIDER_HTTP_ERROR')
                retry = exc.headers.get('Retry-After') if exc.headers else None
                if retry:
                    retry_after = _translation_retry_after(retry)
            elif isinstance(exc, TimeoutError) or isinstance(reason, TimeoutError):
                code = 'PROVIDER_TIMEOUT'
            elif isinstance(exc, json.JSONDecodeError):
                code = 'PROVIDER_INVALID_JSON'
            elif isinstance(exc, (urllib.error.URLError, OSError)):
                code = 'PROVIDER_NETWORK_ERROR'
            else:
                code = 'PROVIDER_RESPONSE_ERROR'
            raise
        finally:
            if self.metrics:
                try_record_translation_metric({**metric, 'event': 'provider_attempt_completed',
                    'status': status, 'httpStatus': http_status, 'errorCode': code,
                    'errorType': error_type, 'reasonType': reason_type, 'retryAfterSeconds': retry_after,
                    'durationMs': round((time.monotonic() - started) * 1000)})

    def record_failure(self, error):
        status = getattr(error, 'code', None)
        if status in (401, 403):
            code = 'PROVIDER_AUTH_FAILED'
        elif status == 402:
            code = 'PROVIDER_PAYMENT_REQUIRED'
        elif status == 429:
            code = 'PROVIDER_RATE_LIMITED'
        elif status in (408, 504) or isinstance(error, TimeoutError) or isinstance(getattr(error, 'reason', None), TimeoutError):
            code = 'PROVIDER_TIMEOUT'
        else:
            code = 'PROVIDER_REQUEST_FAILED'
        self.failures.add(code)

    def error_code(self):
        if self.retry_after_seconds and 'PROVIDER_RATE_LIMITED' in self.failures:
            return 'PROVIDER_RATE_LIMITED'
        if time.monotonic() >= self.deadline or 'PROVIDER_TIMEOUT' in self.failures:
            return 'PROVIDER_TIMEOUT'
        if 'PROVIDER_RATE_LIMITED' in self.failures:
            return 'PROVIDER_RATE_LIMITED'
        if 'PROVIDER_PAYMENT_REQUIRED' in self.failures:
            return 'PROVIDER_PAYMENT_REQUIRED'
        if self.failures == {'PROVIDER_AUTH_FAILED'}:
            return 'PROVIDER_AUTH_FAILED'
        return 'PROVIDER_REQUEST_FAILED'

    def timeout(self, limit=15, generation=False):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            if self.metrics:
                try_record_translation_metric({**self.metrics, 'event': 'provider_budget_exhausted',
                    'status': 'failed', 'errorCode': 'PROVIDER_TIMEOUT', 'providerAttempts': self.attempts,
                    'durationMs': round((time.monotonic() - self.started) * 1000)})
            raise TimeoutError('TRANSLATION_PROVIDER_TIMEOUT')
        if generation:
            self.attempts += 1
        return min(limit, remaining)


def _list_gemini_models(key, budget=None):
    """Flash estable más reciente; Pro sólo si no hay un Flash disponible."""
    cached = _GEMINI_MODEL_CACHE.get(key)
    if cached and cached[0] > time.monotonic():
        return cached[1]
    try:
        req = urllib.request.Request('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=' + key, headers={'User-Agent': UA_BROWSER})
        if budget:
            data = budget.read_json(req, budget.timeout(3), 'gemini', operation='list_models')
        else:
            with urllib.request.urlopen(req, timeout=15, context=_SSL_CTX) as resp: data = json.loads(resp.read())
        available = [item.get('name', '').split('/', 1)[-1] for item in data.get('models', []) if 'generateContent' in item.get('supportedGenerationMethods', [])]
        def stable_version(model, tier):
            name = model.lower()
            match = re.fullmatch(r'gemini-(\d+)(?:\.(\d+))?-' + tier, name)
            if not match or any(part in name for part in ('preview', 'experimental', 'image', 'tts', 'live', 'audio', 'embedding', 'robotics', 'computer')): return None
            return int(match.group(1)), int(match.group(2) or 0)
        flash = [(stable_version(model, 'flash'), model) for model in available]
        models = [model for version, model in sorted((item for item in flash if item[0] is not None), reverse=True)]
        if not models:
            pro = [(stable_version(model, 'pro'), model) for model in available]
            models = [model for version, model in sorted((item for item in pro if item[0] is not None), reverse=True)]
        if not models: models = list(_GEMINI_MODEL_FALLBACKS)
        _GEMINI_MODEL_CACHE[key] = (time.monotonic() + _GEMINI_MODEL_CACHE_SECONDS, models)
        return models
    except Exception as exc:
        if budget:
            budget.record_failure(exc)
        if budget and isinstance(exc, urllib.error.HTTPError):
            exc.close()
            if exc.code in (401, 403):
                raise
        return list(_GEMINI_MODEL_FALLBACKS)

def _list_gemini_vision_models(key, timeout=15):
    cached = _GEMINI_VISION_MODEL_CACHE.get(key)
    if cached and cached[0] > time.monotonic():
        return [model for model in cached[1] if not _vision_model_retired('gemini', model)]
    try:
        req = urllib.request.Request('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=' + urllib.parse.quote(key, safe=''), headers={'User-Agent': UA_BROWSER})
        with urllib.request.urlopen(req, timeout=timeout, context=_SSL_CTX) as resp:
            data = json.loads(resp.read())
        ranked = []
        for item in data.get('models', []):
            name = item.get('name', '').split('/', 1)[-1]
            match = re.fullmatch(r'gemini-(\d+)(?:\.(\d+))?-(flash|pro|flash-lite)', name.lower())
            if match and 'generateContent' in item.get('supportedGenerationMethods', []):
                tier = {'flash': 0, 'flash-lite': 1, 'pro': 2}[match.group(3)]
                ranked.append((tier, -int(match.group(1)), -int(match.group(2) or 0), name))
        models = [name for _, _, _, name in sorted(ranked)]
        _GEMINI_VISION_MODEL_CACHE[key] = (time.monotonic() + 900, models)
        return [model for model in models if not _vision_model_retired('gemini', model)]
    except Exception:
        models = cached[1] if cached else _GEMINI_MODEL_FALLBACKS
        return [model for model in models if not _vision_model_retired('gemini', model)]

def _gemini_generate_json(body, keys=None, timeout=150, budget=None):
    """Envía la petición con rotación de claves y modelo estable automático."""
    keys = keys if keys is not None else GEMINI_KEYS
    last_error = None
    for key in dict.fromkeys(k for k in keys if k):
        if budget:
            if _translation_quota_wait('gemini', keys, '', _GEMINI_MODEL_FALLBACKS, budget):
                break
            payment_wait = _translation_credential_wait('gemini', key)
            if payment_wait:
                budget.failures.add('PROVIDER_PAYMENT_REQUIRED')
                budget.note_provider_wait('gemini', payment_wait)
                continue
            budget.timeout()
        try:
            models = _list_gemini_models(key, budget=budget) if budget else _list_gemini_models(key)
        except urllib.error.HTTPError as exc:
            last_error = exc
            continue
        for model in models:
            if budget:
                status, delay = _translation_model_wait('gemini', key, model)
                if status:
                    if status == 429:
                        budget.failures.add('PROVIDER_RATE_LIMITED')
                        budget.note_provider_wait('gemini', delay)
                    continue
                if _translation_quota_wait('gemini', keys, '', _GEMINI_MODEL_FALLBACKS, budget):
                    break
            url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + urllib.parse.quote(key, safe='')
            req = urllib.request.Request(url, data=body, method='POST', headers={'Content-Type': 'application/json', 'User-Agent': UA_BROWSER})
            request_timeout = budget.timeout(generation=True) if budget else timeout
            try:
                if budget:
                    payload = budget.read_json(req, request_timeout, 'gemini', model, credential=key)
                else:
                    with urllib.request.urlopen(req, timeout=request_timeout, context=_SSL_CTX) as response:
                        payload = json.loads(response.read())
                if budget:
                    _translation_clear_provider_cooldown('gemini', keys, '', _GEMINI_MODEL_FALLBACKS)
                return payload, model
            except Exception as exc:
                last_error = exc
                print(f'[Gemini] {model} falló: {type(exc).__name__}')
                if budget:
                    budget.record_failure(exc)
                    quota_blocked = False
                    if isinstance(exc, urllib.error.HTTPError) and exc.code == 429:
                        quota_blocked = _translation_note_quota_failure(
                            'gemini', keys, '', _GEMINI_MODEL_FALLBACKS, _translation_model_wait('gemini', key, model)[1], credential=key)
                        if quota_blocked:
                            _translation_quota_wait('gemini', keys, '', _GEMINI_MODEL_FALLBACKS, budget)
                    if _translation_is_network_failure(exc):
                        _translation_cool_down_provider('gemini', keys, '', _GEMINI_MODEL_FALLBACKS)
                        _translation_release_probe('gemini', budget)
                        if isinstance(exc, urllib.error.HTTPError):
                            exc.close()
                        raise RuntimeError('Gemini no respondió a tiempo') from None
                    if isinstance(exc, urllib.error.HTTPError):
                        exc.close()
                        if exc.code in (401, 402, 403) or quota_blocked:
                            break
    if budget:
        _translation_release_probe('gemini', budget)
        raise RuntimeError('Gemini no respondió') from None
    raise RuntimeError(f'Gemini no respondió: {last_error or "sin modelos compatibles"}')

def _list_groq_models(key):
    try:
        req = urllib.request.Request('https://api.groq.com/openai/v1/models', headers={'Authorization': 'Bearer ' + key, 'User-Agent': UA_BROWSER})
        with urllib.request.urlopen(req, timeout=15, context=_SSL_CTX) as resp: data = json.loads(resp.read())
        available = {item.get('id', '') for item in data.get('data', [])}
        return [model for model in _GROQ_MODEL_FALLBACKS if model in available]
    except Exception: return []

def _list_groq_vision_models(key, timeout=15):
    cached = _GROQ_VISION_MODEL_CACHE.get(key)
    if cached and cached[0] > time.monotonic():
        return [model for model in cached[1] if not _vision_model_retired('groq', model)]
    try:
        req = urllib.request.Request('https://api.groq.com/openai/v1/models', headers={'Authorization': 'Bearer ' + key, 'User-Agent': UA_BROWSER})
        with urllib.request.urlopen(req, timeout=timeout, context=_SSL_CTX) as resp:
            data = json.loads(resp.read())
        available = [item for item in data.get('data', []) if item.get('active') is not False
                     and 'image' in item.get('input_modalities', [])
                     and 'text' in item.get('output_modalities', [])
                     and isinstance(item.get('id'), str)]
        available.sort(key=lambda item: (item['id'] != 'qwen/qwen3.8-27b', -int(item.get('created') or 0)))
        models = [item['id'] for item in available]
        _GROQ_VISION_MODEL_CACHE[key] = (time.monotonic() + 900, models)
        return [model for model in models if not _vision_model_retired('groq', model)]
    except Exception:
        models = cached[1] if cached else ['qwen/qwen3.8-27b']
        return [model for model in models if not _vision_model_retired('groq', model)]

_TEXT_PROVIDER_SPECS = (
    ('groq', GROQ_KEYS, 'https://api.groq.com/openai/v1/chat/completions', _GROQ_MODEL_FALLBACKS),
    ('mistral', MISTRAL_KEYS, 'https://api.mistral.ai/v1/chat/completions', ('mistral-small-latest',)),
    ('openrouter', OPENROUTER_KEYS, 'https://openrouter.ai/api/v1/chat/completions', ('qwen/qwen3.8-27b:free', 'openai/gpt-oss-20b:free')),
    ('nvidia', NVIDIA_KEYS, 'https://integrate.api.nvidia.com/v1/chat/completions', ('meta/llama-3.3-70b-instruct',)),
    ('huggingface', HUGGINGFACE_KEYS, 'https://router.huggingface.co/v1/chat/completions', ('meta-llama/Llama-3.3-70B-Instruct:novita',)),
)


def _translation_provider_signature(provider, keys, endpoint, models):
    import hashlib
    resolved_models = [list(_GEMINI_MODEL_CACHE.get(key, (None, []))[1]) for key in keys] if provider == 'gemini' else []
    settings = json.dumps([list(keys), endpoint, list(models), resolved_models], ensure_ascii=True).encode('utf-8')
    return hashlib.sha256(settings).digest()


def _translation_quota_signature(provider, keys, endpoint, models):
    import hashlib
    settings = json.dumps([provider, list(keys), endpoint, list(models)], ensure_ascii=True).encode('utf-8')
    return hashlib.sha256(settings).digest()


def _translation_order_providers(specs):
    global _TRANSLATION_PROVIDER_PREFERENCE
    signature = tuple(_translation_quota_signature(*spec) for spec in specs)
    with _TRANSLATION_PROVIDER_COOLDOWN_LOCK:
        saved = _TRANSLATION_PROVIDER_PREFERENCE
        if saved and (saved[1] != signature or saved[2] <= time.monotonic()):
            _TRANSLATION_PROVIDER_PREFERENCE = saved = None
        preferred = saved[0] if saved else 'groq'
    return sorted(specs, key=lambda spec: (spec[0] != preferred, spec[0] != 'groq'))


def _translation_remember_provider(provider, specs):
    global _TRANSLATION_PROVIDER_PREFERENCE
    signature = tuple(_translation_quota_signature(*spec) for spec in specs)
    with _TRANSLATION_PROVIDER_COOLDOWN_LOCK:
        _TRANSLATION_PROVIDER_PREFERENCE = (
            provider, signature, time.monotonic() + _TRANSLATION_PROVIDER_PREFERENCE_SECONDS)


def _translation_is_network_failure(error):
    if isinstance(error, urllib.error.HTTPError):
        return error.code in (408, 504)
    return isinstance(error, (TimeoutError, urllib.error.URLError, OSError))


def _translation_cool_down_provider(provider, keys, endpoint, models):
    signature = _translation_provider_signature(provider, keys, endpoint, models)
    with _TRANSLATION_PROVIDER_COOLDOWN_LOCK:
        if provider not in _TRANSLATION_PROVIDER_COOLDOWNS and len(_TRANSLATION_PROVIDER_COOLDOWNS) >= 16:
            oldest = min(_TRANSLATION_PROVIDER_COOLDOWNS, key=lambda name: _TRANSLATION_PROVIDER_COOLDOWNS[name][1])
            del _TRANSLATION_PROVIDER_COOLDOWNS[oldest]
        _TRANSLATION_PROVIDER_COOLDOWNS[provider] = (signature, time.monotonic() + _TRANSLATION_PROVIDER_COOLDOWN_SECONDS)


def _translation_cool_down_quota(provider, keys, endpoint, models, seconds):
    signature = _translation_quota_signature(provider, keys, endpoint, models)
    with _TRANSLATION_PROVIDER_COOLDOWN_LOCK:
        if provider not in _TRANSLATION_PROVIDER_RATE_LIMITS and len(_TRANSLATION_PROVIDER_RATE_LIMITS) >= 16:
            oldest = min(_TRANSLATION_PROVIDER_RATE_LIMITS, key=lambda name: _TRANSLATION_PROVIDER_RATE_LIMITS[name][1])
            del _TRANSLATION_PROVIDER_RATE_LIMITS[oldest]
        previous = _TRANSLATION_PROVIDER_RATE_LIMITS.get(provider)
        active = previous and previous[0] == signature and previous[1] > time.monotonic()
        level = previous[2] if active else min(previous[2] + 1, 6) if previous and previous[0] == signature else 0
        effective_seconds = min(seconds, 3600)
        delay = max(effective_seconds, 30 * 2 ** level)
        deadline = time.monotonic() + max(1, min(delay, 3600))
        _TRANSLATION_PROVIDER_RATE_LIMITS[provider] = (signature, max(previous[1], deadline) if active else deadline, level)


def _translation_note_quota_failure(provider, keys, endpoint, models, seconds, credential=None):
    signature = _translation_quota_signature(provider, keys, endpoint, models)
    unique_keys = set(dict.fromkeys(k for k in keys if k)) if keys else set()
    with _TRANSLATION_PROVIDER_COOLDOWN_LOCK:
        probe = _TRANSLATION_PROVIDER_PROBES.get(provider)
        previous = _TRANSLATION_PROVIDER_QUOTA_STRIKES.get(provider)
        if probe and probe[0] == signature:
            count = 2
            state = 2
        elif len(unique_keys) > 1 and credential:
            failed_creds = set(previous[1]) if previous and previous[0] == signature and previous[2] > time.monotonic() and isinstance(previous[1], (set, list, tuple)) else set()
            failed_creds.add(credential)
            count = len(failed_creds)
            state = failed_creds
        else:
            previous_count = previous[1] if previous and previous[0] == signature and previous[2] > time.monotonic() and isinstance(previous[1], int) else 0
            count = previous_count + 1
            state = count
        if count >= 2:
            _TRANSLATION_PROVIDER_QUOTA_STRIKES.pop(provider, None)
            _TRANSLATION_PROVIDER_PROBES.pop(provider, None)
        else:
            _TRANSLATION_PROVIDER_QUOTA_STRIKES[provider] = (signature, state, time.monotonic() + 60)
    if count >= 2:
        _translation_cool_down_quota(provider, keys, endpoint, models, seconds)
        return True
    return False


def _translation_quota_wait(provider, keys, endpoint, models, budget=None):
    signature = _translation_quota_signature(provider, keys, endpoint, models)
    with _TRANSLATION_PROVIDER_COOLDOWN_LOCK:
        entry = _TRANSLATION_PROVIDER_RATE_LIMITS.get(provider)
        if entry and entry[0] != signature:
            del _TRANSLATION_PROVIDER_RATE_LIMITS[provider]
            entry = None
        delay = max(1, round(entry[1] - time.monotonic())) if entry and entry[1] > time.monotonic() else 0
        if entry and not delay and budget:
            probe = _TRANSLATION_PROVIDER_PROBES.get(provider)
            if probe and (probe[0] != signature or probe[2] <= time.monotonic()):
                del _TRANSLATION_PROVIDER_PROBES[provider]
                probe = None
            if probe and probe[1] is not budget.probe_token:
                delay = max(1, round(probe[2] - time.monotonic()))
            elif not probe:
                _TRANSLATION_PROVIDER_PROBES[provider] = (signature, budget.probe_token, time.monotonic() + 45)
    if delay and budget:
        budget.failures.add('PROVIDER_RATE_LIMITED')
        budget.note_provider_wait(provider, delay, replace=True)
    return delay


def _translation_release_probe(provider, budget):
    if not budget:
        return
    with _TRANSLATION_PROVIDER_COOLDOWN_LOCK:
        probe = _TRANSLATION_PROVIDER_PROBES.get(provider)
        if probe and probe[1] is budget.probe_token:
            del _TRANSLATION_PROVIDER_PROBES[provider]


def _translation_clear_provider_cooldown(provider, keys, endpoint, models):
    signature = _translation_provider_signature(provider, keys, endpoint, models)
    quota_signature = _translation_quota_signature(provider, keys, endpoint, models)
    with _TRANSLATION_PROVIDER_COOLDOWN_LOCK:
        entry = _TRANSLATION_PROVIDER_COOLDOWNS.get(provider)
        if entry and entry[0] == signature:
            del _TRANSLATION_PROVIDER_COOLDOWNS[provider]
        entry = _TRANSLATION_PROVIDER_RATE_LIMITS.get(provider)
        if entry and entry[0] == quota_signature:
            del _TRANSLATION_PROVIDER_RATE_LIMITS[provider]
        entry = _TRANSLATION_PROVIDER_QUOTA_STRIKES.get(provider)
        if entry and entry[0] == quota_signature:
            del _TRANSLATION_PROVIDER_QUOTA_STRIKES[provider]
        entry = _TRANSLATION_PROVIDER_PROBES.get(provider)
        if entry and entry[0] == quota_signature:
            del _TRANSLATION_PROVIDER_PROBES[provider]


def _translation_ready_providers(specs, budget=None):
    ready = set()
    network_cooled = set()
    for provider, keys, endpoint, models in specs:
        signature = _translation_provider_signature(provider, keys, endpoint, models)
        quota_signature = _translation_quota_signature(provider, keys, endpoint, models)
        with _TRANSLATION_PROVIDER_COOLDOWN_LOCK:
            quota = _TRANSLATION_PROVIDER_RATE_LIMITS.get(provider)
            if quota and quota[0] != quota_signature:
                del _TRANSLATION_PROVIDER_RATE_LIMITS[provider]
                quota = None
            entry = _TRANSLATION_PROVIDER_COOLDOWNS.get(provider)
            if entry and (entry[0] != signature or entry[1] <= time.monotonic()):
                del _TRANSLATION_PROVIDER_COOLDOWNS[provider]
                entry = None
            if quota and quota[1] > time.monotonic() and budget:
                budget.failures.add('PROVIDER_RATE_LIMITED')
                delay = max(1, round(quota[1] - time.monotonic()))
                budget.note_provider_wait(provider, delay, replace=True)
            if (not quota or quota[1] <= time.monotonic()) and not entry:
                ready.add(provider)
            elif not quota or quota[1] <= time.monotonic():
                network_cooled.add(provider)
    return ready or network_cooled


def _openai_generate_json(provider, keys, endpoint, models, prompt, temperature, budget=None):
    last_error = None
    for key in dict.fromkeys(k for k in keys if k):
        if budget:
            if _translation_quota_wait(provider, keys, endpoint, models, budget):
                break
            payment_wait = _translation_credential_wait(provider, key)
            if payment_wait:
                budget.failures.add('PROVIDER_PAYMENT_REQUIRED')
                budget.note_provider_wait(provider, payment_wait)
                continue
        for model in models:
            if budget:
                status, delay = _translation_model_wait(provider, key, model)
                if status:
                    if status == 429:
                        budget.failures.add('PROVIDER_RATE_LIMITED')
                        budget.note_provider_wait(provider, delay)
                    continue
                if _translation_quota_wait(provider, keys, endpoint, models, budget):
                    break
            body = json.dumps({'model': model, 'messages': [{'role': 'system', 'content': 'Devuelve exclusivamente JSON válido, sin markdown.'}, {'role': 'user', 'content': prompt}], 'temperature': temperature}).encode('utf-8')
            request = urllib.request.Request(endpoint, data=body, method='POST', headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key, 'User-Agent': UA_BROWSER})
            request_timeout = budget.timeout(generation=True) if budget else 90
            try:
                if budget:
                    payload = budget.read_json(request, request_timeout, provider, model, credential=key)
                else:
                    with urllib.request.urlopen(request, timeout=request_timeout, context=_SSL_CTX) as response: payload = json.loads(response.read())
                text = payload.get('choices', [{}])[0].get('message', {}).get('content', '')
                if isinstance(text, str) and text.strip():
                    if budget:
                        _translation_clear_provider_cooldown(provider, keys, endpoint, models)
                    return (text.strip(), provider, model) if budget else (text.strip(), provider)
                last_error = RuntimeError('respuesta vacía')
                if budget:
                    budget.record_failure(last_error)
            except Exception as exc:
                last_error = exc
                print(f'[AI {provider}] {model} falló: {type(exc).__name__}')
                if budget:
                    budget.record_failure(exc)
                    quota_blocked = False
                    if isinstance(exc, urllib.error.HTTPError) and exc.code == 429:
                        quota_blocked = _translation_note_quota_failure(
                            provider, keys, endpoint, models, _translation_model_wait(provider, key, model)[1], credential=key)
                        if quota_blocked:
                            _translation_quota_wait(provider, keys, endpoint, models, budget)
                    if _translation_is_network_failure(exc):
                        _translation_cool_down_provider(provider, keys, endpoint, models)
                        _translation_release_probe(provider, budget)
                        if isinstance(exc, urllib.error.HTTPError):
                            exc.close()
                        raise RuntimeError(provider + ' no respondió a tiempo') from None
                    if isinstance(exc, urllib.error.HTTPError):
                        exc.close()
                        if exc.code in (401, 402, 403) or quota_blocked:
                            break
    if budget:
        _translation_release_probe(provider, budget)
        raise RuntimeError(provider + ' no respondió') from None
    raise RuntimeError(f'{provider} no respondió: {last_error or "sin modelo compatible"}')

def _generate_text_json_with_fallback(prompt, temperature=0, budget=None):
    """Traducción prioriza Groq o el último proveedor útil; mantiene los respaldos."""
    specs = ([('gemini', GEMINI_KEYS, '', _GEMINI_MODEL_FALLBACKS)] if any(GEMINI_KEYS) else [])
    specs.extend(spec for spec in _TEXT_PROVIDER_SPECS if any(spec[1]))
    if budget and not specs:
        raise RuntimeError('PROVIDER_KEY_REQUIRED')
    ready = _translation_ready_providers(specs, budget) if budget else None
    for provider, keys, endpoint, models in _translation_order_providers(specs) if budget else specs:
        if ready is not None and provider not in ready:
            continue
        try:
            if provider == 'gemini':
                body = json.dumps({'contents': [{'parts': [{'text': prompt}]}], 'generationConfig': {'temperature': temperature, 'responseMimeType': 'application/json'}}).encode('utf-8')
                payload, model = _gemini_generate_json(body, timeout=90, **({'budget': budget} if budget else {}))
                text = ''.join(part.get('text', '') for part in payload.get('candidates', [{}])[0].get('content', {}).get('parts', []))
            elif budget:
                text, _, model = _openai_generate_json(provider, keys, endpoint, models, prompt, temperature, budget=budget)
            else:
                text, resolved_provider = _openai_generate_json(provider, keys, endpoint, models, prompt, temperature)
                return text, resolved_provider, models[0]
            if text.strip():
                if budget:
                    _translation_remember_provider(provider, specs)
                return text.strip(), provider, model
        except Exception as exc:
            print(f'[AI {provider}] fallback activado: {type(exc).__name__}')
    raise RuntimeError(budget.error_code() if budget else 'No hay proveedor de texto disponible o todos fallaron')

# Orígenes permitidos: solo el propio proxy local
_ACTIVE_PORT = 8765
_ALLOWED_ORIGINS = {'http://127.0.0.1:8765', 'http://localhost:8765', HOST_ORIGIN}

# ── Cross-Window Tab Events & Single-Instance Coordination ──
_EVENT_QUEUES = {}  # { client_id: queue.Queue() }
_LAST_ACTIVE_CLIENT = None
_CLIENTS_LOCK = threading.Lock()
_NATIVE_FILE_DIALOG = NativeFileDialog()
_NATIVE_SAVE_STORE = NativeSaveStore()

AZURE_KEYS      = _config_keys(_CFG, 'azure')
AZURE_ENDPOINTS = [v.strip() for k, v in _CFG.items('azure') if k.startswith('endpoint') and v.strip()] if _CFG.has_section('azure') else []
FISHAUDIO_KEYS  = _config_keys(_CFG, 'fishaudio')

# ============================================================
# OFFICE CONVERSION ENGINE
# ============================================================

_office_software_cache = None  # None=no comprobado, dict=comprobado
_office_cache_lock = threading.Lock()

_paddle_ocr_engine = None  # instancia cacheada (evita recargar modelos en cada extracción)

# ── Persistent COM worker threads ────────────────────────────────────────────
# One long-lived STA thread per Office ProgID. The COM app launches once and
# stays alive between conversions, so subsequent calls take 1-3 s instead of
# 15-20 s.

_com_workers      = {}   # progid -> (thread, request_queue)
_com_workers_lock = threading.Lock()
_COM_IDLE_TIMEOUT = 300  # seconds: worker quits if no work arrives

def _com_worker_loop(progid, req_q):
    """Long-lived STA thread that owns one COM instance."""
    try:
        import pythoncom, win32com.client
        pythoncom.CoInitialize()
    except Exception as e:
        print(f"[COM Worker] CoInitialize failed for {progid}: {e}")
        return

    app = None
    try:
        app = win32com.client.DispatchEx(progid)
        app.Visible = False
        app.DisplayAlerts = False
        try: app.AutomationSecurity = 1
        except: pass
        # Para Excel: deshabilitar Protected View (archivos de internet/temp)
        if progid == 'Excel.Application':
            try:
                pvs = app.Application.ProtectedViewSettings
                pvs.EnabledForFilesFromInternet = False
                pvs.EnabledForUnsafeLocations  = False
                pvs.EnabledForFilesFromOutlook  = False
                print(f"[COM Worker] Excel Protected View deshabilitado")
            except Exception as e:
                print(f"[COM Worker] No se pudo deshabilitar Protected View: {e}")
        print(f"[COM Worker] {progid} ready (ver={getattr(app, 'Version', '?')})")

        while True:
            try:
                task = req_q.get(timeout=_COM_IDLE_TIMEOUT)
            except queue.Empty:
                print(f"[COM Worker] {progid} idle timeout — quitting")
                break
            if task is None:
                break
            fn, res, evt = task
            try:
                res[0] = fn(app)
                res[1] = None
            except Exception as e:
                res[0] = None
                res[1] = str(e)
            finally:
                evt.set()
    except Exception as e:
        print(f"[COM Worker] {progid} crashed: {e}")
    finally:
        try:
            if app: app.Quit()
        except: pass
        try:
            import pythoncom
            pythoncom.CoUninitialize()
        except: pass
        with _com_workers_lock:
            _com_workers.pop(progid, None)
        print(f"[COM Worker] {progid} exited")


def _get_com_worker_queue(progid):
    """Return the request queue for progid, starting the worker if needed."""
    with _com_workers_lock:
        entry = _com_workers.get(progid)
        if entry:
            t, q = entry
            if t.is_alive():
                return q
            del _com_workers[progid]
        req_q = queue.Queue()
        t = threading.Thread(target=_com_worker_loop, args=(progid, req_q), daemon=True)
        t.start()
        _com_workers[progid] = (t, req_q)
        return req_q


def _run_on_com_worker(progid, fn, timeout):
    """Execute fn(app) on the persistent COM worker thread. Returns result or raises."""
    q   = _get_com_worker_queue(progid)
    res = [None, None]          # [return_value, error_str]
    evt = threading.Event()
    q.put((fn, res, evt))
    if not evt.wait(timeout):
        # Invalidate the worker so next call spawns a fresh one
        with _com_workers_lock:
            entry = _com_workers.pop(progid, None)
        if entry:
            entry[0].join(0)     # don't block
        raise TimeoutError(f"COM {progid} no respondió en {timeout}s")
    if res[1]:
        raise RuntimeError(f"COM {progid} error: {res[1]}")
    return res[0]


def _test_com_dispatch(progid):
    """Prueba un ProgID COM. Retorna version string o None."""
    result = [None]
    def _run():
        try:
            import pythoncom, win32com.client
            pythoncom.CoInitialize()
            app = win32com.client.DispatchEx(progid)
            ver = getattr(app, 'Version', '?')
            try: app.Quit()
            except: pass
            result[0] = str(ver)
        except Exception as e:
            print(f"[Office] COM test '{progid}' falló: {e}")
        finally:
            try:
                import pythoncom
                pythoncom.CoUninitialize()
            except: pass
    t = threading.Thread(target=_run)
    t.start()
    t.join(10)
    return result[0]


def _detect_msoffice_registry():
    """Detecta MS Office vía registro de Windows. Instantáneo, sin lanzar COM."""
    try:
        import winreg
        print("[Office] Buscando Office en registro (ClickToRun)...")
        # Office 365 / Click-to-Run
        for key_path in [
            r'SOFTWARE\Microsoft\Office\ClickToRun\Configuration',
            r'SOFTWARE\WOW6432Node\Microsoft\Office\ClickToRun\Configuration',
        ]:
            try:
                with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, key_path) as k:
                    ver = winreg.QueryValueEx(k, 'VersionToReport')[0]
                    if ver:
                        print(f"[Office] Registro ClickToRun encontrado: {key_path} → {ver}")
                        return str(ver)
            except Exception as e:
                print(f"[Office] Registro {key_path}: {e}")
        print("[Office] ClickToRun no encontrado, buscando MSI clásico...")
        # MSI Office (instalación clásica)
        for ver in ['16.0', '15.0', '14.0', '12.0']:
            for key_path in [
                rf'SOFTWARE\Microsoft\Office\{ver}\Word\InstallRoot',
                rf'SOFTWARE\WOW6432Node\Microsoft\Office\{ver}\Word\InstallRoot',
            ]:
                try:
                    with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, key_path) as k:
                        path = winreg.QueryValueEx(k, 'Path')[0]
                        if path and os.path.exists(path):
                            print(f"[Office] Registro MSI encontrado: {key_path} → {path}")
                            return ver
                except: pass
        print("[Office] Registro: Office no encontrado en ninguna clave conocida")
    except Exception as e:
        print(f"[Office] Registry check error: {e}")
    return None


def detect_office_software():
    global _office_software_cache
    with _office_cache_lock:
        if _office_software_cache is not None:
            return _office_software_cache

        # 1. Microsoft Office — registro primero (instantáneo)
        reg_ver = _detect_msoffice_registry()
        if reg_ver is not None:
            _office_software_cache = {"software": "msoffice", "name": f"Microsoft Office ({reg_ver})"}
            print(f"[Office] Detectado via registro: {_office_software_cache['name']}")
            return _office_software_cache

        # 2. Microsoft Office via COM (fallback si registro no encontró nada)
        ver = _test_com_dispatch("Word.Application")
        if ver is not None:
            _office_software_cache = {"software": "msoffice", "name": f"Microsoft Office ({ver})"}
            print(f"[Office] Detectado via COM: {_office_software_cache['name']}")
            return _office_software_cache

        # 2. WPS Office via COM
        ver = _test_com_dispatch("WPS.Application")
        if ver is not None:
            _office_software_cache = {"software": "wps", "name": "WPS Office"}
            print(f"[Office] Detectado: WPS Office")
            return _office_software_cache

        # 3. WPS Office via ejecutable
        wps_paths = [
            r"C:\Program Files (x86)\Kingsoft\WPS Office\office6\wps.exe",
            r"C:\Program Files\Kingsoft\WPS Office\office6\wps.exe",
        ]
        for wp in wps_paths:
            if os.path.exists(wp):
                _office_software_cache = {"software": "wps_cli", "name": "WPS Office", "exe": wp}
                print(f"[Office] Detectado WPS CLI: {wp}")
                return _office_software_cache

        # 4. LibreOffice
        lo_paths = [
            r"C:\Program Files\LibreOffice\program\soffice.exe",
            r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
            "soffice",
        ]
        for lo in lo_paths:
            if shutil.which(lo) or os.path.exists(lo):
                _office_software_cache = {"software": "libreoffice", "name": "LibreOffice", "exe": lo}
                print(f"[Office] Detectado LibreOffice: {lo}")
                return _office_software_cache

        # 5. SoftMaker FreeOffice
        sm_paths = [
            r"C:\Program Files\SoftMaker Office\textmaker.exe",
            r"C:\Program Files (x86)\SoftMaker Office\textmaker.exe",
            r"C:\Program Files\FreeOffice\textmaker.exe",
            r"C:\Program Files (x86)\FreeOffice\textmaker.exe",
        ]
        for sm in sm_paths:
            if os.path.exists(sm):
                _office_software_cache = {"software": "softmaker", "name": "SoftMaker FreeOffice", "exe": sm}
                print(f"[Office] Detectado SoftMaker: {sm}")
                return _office_software_cache

        _office_software_cache = {"software": None, "name": None}
        print("[Office] No se detectó software de ofimatica instalado")
        return _office_software_cache


def convert_office_to_pdf(input_path, output_path, software_info, timeout=30, pagesetup_params=None):
    """Convierte un archivo Office a PDF usando el software detectado."""
    sw = software_info.get("software")

    if sw == "msoffice":
        return _convert_via_msoffice_com(input_path, output_path, timeout, pagesetup_params)
    elif sw == "wps":
        return _convert_via_wps_com(input_path, output_path, timeout)
    elif sw == "wps_cli":
        return _convert_via_wps_cli(input_path, output_path, software_info["exe"], timeout)
    elif sw == "libreoffice":
        return _convert_via_libreoffice(input_path, output_path, software_info["exe"], timeout)
    elif sw == "softmaker":
        return _convert_via_softmaker(input_path, output_path, software_info["exe"], timeout)
    else:
        raise ValueError("No hay software de ofimatica disponible")


def convert_pdf_to_docx(input_path, output_path, timeout=180):
    """Usa el reflujo PDF nativo de Word: texto queda como texto e imágenes como objetos."""
    def _do(app):
        doc = None
        try:
            doc = app.Documents.Open(input_path, ReadOnly=True, ConfirmConversions=False,
                                     AddToRecentFiles=False, Visible=False, OpenAndRepair=True)
            if doc is None:
                raise RuntimeError("Word no pudo abrir el PDF")
            try:
                if doc.ProtectionType != -1: doc.Unprotect()
            except: pass
            try: doc.ReadOnlyRecommended = False
            except: pass
            doc.SaveAs2(output_path, FileFormat=16, ReadOnlyRecommended=False)  # wdFormatDocumentDefault (.docx)
        finally:
            if doc:
                try: doc.Close(False)
                except: pass
        return True
    _run_on_com_worker('Word.Application', _do, timeout)
    return True


def _rgb(fill):
    if not fill: return None
    return ''.join(f'{max(0, min(255, round(v * 255))):02X}' for v in fill[:3])


def _pdf_native_tables(page):
    """Detecta cuadrículas PDF y devuelve tablas reales sin usar IA."""
    import fitz
    try: found = page.find_tables()
    except Exception: found = None
    tables = []
    for source in getattr(found, 'tables', []):
        try:
            rect = fitz.Rect(source.bbox)
            rows, cols = int(source.row_count), int(source.col_count)
            values = source.extract()
            if rect.width < 25 or rect.height < 16 or rows < 1 or cols < 1: continue
            cells = [[row, col, str(values[row][col] or '')] for row in range(rows) for col in range(cols) if values[row][col]]
            xs = sorted({round(cell[0], 2) for cell in source.cells if cell} | {round(cell[2], 2) for cell in source.cells if cell})
            ys = sorted({round(cell[1], 2) for cell in source.cells if cell} | {round(cell[3], 2) for cell in source.cells if cell})
            if len(xs) != cols + 1 or len(ys) != rows + 1 or min(b - a for a, b in zip(xs, xs[1:])) < 6 or min(b - a for a, b in zip(ys, ys[1:])) < 4:
                continue
            tables.append((rect, rows, cols, cells, xs, ys))
        except (AttributeError, TypeError, ValueError, IndexError): pass
    return tables or _rect_grid_tables(page)


def _rect_grid_tables(page):
    """Detecta formularios dibujados como rectángulos finos cuando find_tables no los reconoce."""
    import fitz
    horizontal, vertical = {}, {}
    try:
        for drawing in page.get_drawings():
            for item in drawing.get('items', []):
                if item[0] != 're': continue
                rect = item[1]
                if rect.height <= 1 and rect.width >= 20:
                    horizontal.setdefault(round((rect.y0 + rect.y1) / 2, 1), []).append(rect)
                if rect.width <= 1 and rect.height >= 5:
                    vertical.setdefault(round((rect.x0 + rect.x1) / 2, 1), []).append(rect)
    except Exception:
        return []
    table_rows = sorted(y for y, segments in horizontal.items() if len(segments) >= 3)
    groups, current = [], []
    for y in table_rows:
        if not current or y - current[-1] <= 32: current.append(y)
        else: groups.append(current); current = [y]
    if current: groups.append(current)
    words = [(fitz.Rect(word[:4]), str(word[4]).strip()) for word in page.get_text('words') if str(word[4]).strip()]
    results = []
    for ys in groups:
        if len(ys) < 3: continue
        lines = [segment for y in ys for segment in horizontal[y]]
        x0, x1 = min(line.x0 for line in lines), max(line.x1 for line in lines)
        y0, y1 = ys[0], ys[-1]
        xs = sorted(x for x, segments in vertical.items() if x0 - 1 <= x <= x1 + 1 and min(segment.y0 for segment in segments) <= y0 + 1 and max(segment.y1 for segment in segments) >= y1 - 1)
        if len(xs) < 2: continue
        rect = fitz.Rect(xs[0], y0, xs[-1], y1)
        if rect.width < 25 or rect.height < 16: continue
        cells = []
        for row in range(len(ys) - 1):
            for col in range(len(xs) - 1):
                cell_rect = fitz.Rect(xs[col], ys[row], xs[col + 1], ys[row + 1])
                values = [(word_rect, text) for word_rect, text in words if cell_rect.contains(fitz.Point((word_rect.x0 + word_rect.x1) / 2, (word_rect.y0 + word_rect.y1) / 2))]
                if values: cells.append([row, col, _join_positioned_words(values)])
        results.append((rect, len(ys) - 1, len(xs) - 1, cells, xs, ys))
    return results


def _prefer_native_office_conversion(input_path):
    """Usa la estructura exacta del PDF cuando ya contiene texto/vectores editables."""
    import fitz
    with fitz.open(input_path) as pdf:
        if not pdf.page_count: return False
        native_pages = 0
        for page in pdf:
            text_chars = len(''.join(page.get_text('text').split()))
            if not _page_is_image_composed(page) and (text_chars >= 20 or _pdf_native_tables(page)): native_pages += 1
        return native_pages / pdf.page_count >= .6


def _page_is_image_composed(page):
    """Identifica láminas/organigramas donde el texto y las formas viven dentro de una imagen."""
    page_area = max(1, page.rect.width * page.rect.height)
    largest = 0
    try:
        for image in page.get_images(full=True):
            for rect in page.get_image_rects(image[0]):
                clipped = rect & page.rect
                largest = max(largest, clipped.width * clipped.height)
    except Exception: pass
    return largest / page_area >= .55


def _configure_excel_page(ws, page, xs, ys):
    """Mantiene proporción del PDF y configuración de impresión en una hoja de Excel."""
    from openpyxl.utils import get_column_letter
    page_width, page_height = page.rect.width, page.rect.height
    xs = sorted({0.0, page_width, *xs})
    ys = sorted({0.0, page_height, *ys})
    for i in range(len(xs) - 1):
        ws.column_dimensions[get_column_letter(i + 1)].width = max(.5, min(45, (xs[i + 1] - xs[i]) / page_width * 105))
    for i in range(len(ys) - 1):
        ws.row_dimensions[i + 1].height = max(2, min(160, ys[i + 1] - ys[i]))
    ws.sheet_view.showGridLines = False
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_setup.orientation = 'landscape' if page_width > page_height else 'portrait'
    ws.page_setup.fitToWidth, ws.page_setup.fitToHeight = 1, 1
    ws.page_margins.left = ws.page_margins.right = .1
    ws.page_margins.top = ws.page_margins.bottom = .15
    return xs, ys


def _add_pdf_image_clips(page, ws, clips, xs, ys, work_dir, prefix):
    """Inserta recortes visuales (logos, fotos o sellos) anclados a la celda correspondiente."""
    from openpyxl.drawing.image import Image as XLImage
    from openpyxl.utils import get_column_letter
    import fitz
    created = []
    for index, rect in enumerate(clips):
        rect = rect & page.rect
        if rect.width < 8 or rect.height < 8: continue
        path = os.path.join(work_dir, f'{prefix}_{index}.png')
        page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), clip=rect, alpha=False).save(path)
        image = XLImage(path)
        image.width, image.height = max(1, int(rect.width * 1.5)), max(1, int(rect.height * 1.5))
        col = max(1, next((i + 1 for i in range(len(xs) - 1) if xs[i] <= rect.x0 < xs[i + 1]), len(xs) - 1))
        row = max(1, next((i + 1 for i in range(len(ys) - 1) if ys[i] <= rect.y0 < ys[i + 1]), len(ys) - 1))
        ws.add_image(image, f'{get_column_letter(col)}{row}')
        created.append(path)
    return created


def convert_pdf_to_xlsx(input_path, output_path):
    """Reconstruye una cuadrícula editable a partir de texto, líneas y fondos vectoriales del PDF."""
    import fitz
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    wb = Workbook()
    wb.remove(wb.active)
    thin = Side(style='thin', color='A6A6A6')
    image_files = []
    def _clusters(values, tolerance=1.5):
        groups = []
        for value in sorted(values):
            if not groups or value - groups[-1][-1] > tolerance: groups.append([value])
            else: groups[-1].append(value)
        return [sum(group) / len(group) for group in groups]

    with fitz.open(input_path) as pdf:
        for page_no, page in enumerate(pdf, 1):
            words = [(fitz.Rect(word[:4]), word[4]) for word in page.get_text('words') if word[4].strip()]
            if not words:
                continue
            native_tables = _pdf_native_tables(page)
            if native_tables:
                fills = [(item[1], _rgb(drawing.get('fill'))) for drawing in page.get_drawings() if _rgb(drawing.get('fill')) for item in drawing.get('items', []) if item[0] == 're']
                outside_words = [(rect, text) for rect, text in words if not any(table_rect.contains(rect) for table_rect, *_ in native_tables)]
                xs, ys = {0.0, page.rect.width}, {0.0, page.rect.height}
                for _, _, _, _, table_xs, table_ys in native_tables:
                    xs.update(table_xs); ys.update(table_ys)
                xs, ys = _clusters(xs), _clusters(ys)
                ws = wb.create_sheet(f'Pág {page_no}')
                xs, ys = _configure_excel_page(ws, page, xs, ys)
                def locate(bounds, value): return max(1, next((i + 1 for i in range(len(bounds) - 1) if bounds[i] - .5 <= value < bounds[i + 1] - .5), len(bounds) - 1))
                for table_rect, rows, cols, cells, table_xs, table_ys in native_tables:
                    for row in range(rows):
                        for col in range(cols):
                            cell = ws.cell(locate(ys, table_ys[row]), locate(xs, table_xs[col]))
                            cell.border = Border(top=thin, bottom=thin, left=thin, right=thin)
                            if len(table_xs) == cols + 1 and len(table_ys) == rows + 1:
                                cx, cy = (table_xs[col] + table_xs[col + 1]) / 2, (table_ys[row] + table_ys[row + 1]) / 2
                                fill = next((color for fill_rect, color in fills if fill_rect.contains(fitz.Point(cx, cy))), None)
                                if fill: cell.fill = PatternFill('solid', fgColor=fill)
                    
                    
                for table_rect, rows, cols, cells, table_xs, table_ys in native_tables:
                    for row, col, text in cells:
                        cell = ws.cell(locate(ys, table_ys[row]), locate(xs, table_xs[col]))
                        cell.value = text
                        cell.font = Font(name='Arial', size=10, bold=text.isupper() and any(ch.isalpha() for ch in text))
                        cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
                for rect, text in outside_words:
                    cell = ws.cell(locate(ys, rect.y0), locate(xs, rect.x0))
                    cell.value = (str(cell.value) + ' ' if cell.value else '') + text
                    cell.font = Font(name='Arial', size=max(8, min(16, rect.height)), bold=text.isupper() and any(ch.isalpha() for ch in text))
                    cell.alignment = Alignment(vertical='center', wrap_text=True)
                clips = [rect for image in page.get_images(full=True) for rect in page.get_image_rects(image[0])]
                image_files.extend(_add_pdf_image_clips(page, ws, clips, xs, ys, os.path.dirname(output_path), f'xlsx_{page_no}'))
                ws.freeze_panes = 'A1'
                continue
            xs, ys, fills = set(), set(), []
            for drawing in page.get_drawings():
                color = _rgb(drawing.get('fill'))
                for item in drawing.get('items', []):
                    if item[0] == 'l':
                        p1, p2 = item[1], item[2]
                        if abs(p1.x - p2.x) < 1 and abs(p1.y - p2.y) >= 20: xs.add(p1.x)
                        if abs(p1.y - p2.y) < 1 and abs(p1.x - p2.x) >= 20: ys.add(p1.y)
                    elif item[0] == 're':
                        rect = item[1]
                        if rect.width >= 20 and rect.height >= 7:
                            xs.update((rect.x0, rect.x1))
                            ys.update((rect.y0, rect.y1))
                        if color: fills.append((rect, color))
            if len(xs) < 3: xs.update(rect.x0 for rect, _ in words)
            if len(ys) < 3: ys.update(rect.y0 for rect, _ in words)
            xs, ys = _clusters(xs), _clusters(ys)
            ws = wb.create_sheet(f'Pág {page_no}')
            xs, ys = _configure_excel_page(ws, page, xs, ys)
            for row in ws.iter_rows(min_row=1, max_row=len(ys) - 1, min_col=1, max_col=len(xs) - 1):
                for cell in row: cell.border = Border(top=thin, bottom=thin, left=thin, right=thin)
            for rect, text in words:
                col = max(1, next((i + 1 for i in range(len(xs) - 1) if xs[i] - 1 <= rect.x0 < xs[i + 1] - 1), len(xs) - 1))
                row = max(1, next((i + 1 for i in range(len(ys) - 1) if ys[i] - 1 <= rect.y0 < ys[i + 1] - 1), len(ys) - 1))
                cell = ws.cell(row, col)
                cell.value = (str(cell.value) + ' ' if cell.value else '') + text
                center_x, center_y = (rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2
                fill = next((rgb for rect, rgb in fills if rect.contains(fitz.Point(center_x, center_y))), None)
                cell.font = Font(name='Arial', size=max(8, min(16, rect.height)), bold=text.isupper() and any(ch.isalpha() for ch in text))
                cell.alignment = Alignment(vertical='center', wrap_text=True)
                cell.border = Border(top=thin, bottom=thin, left=thin, right=thin)
                if fill: cell.fill = PatternFill('solid', fgColor=fill)
            clips = [rect for image in page.get_images(full=True) for rect in page.get_image_rects(image[0])]
            image_files.extend(_add_pdf_image_clips(page, ws, clips, xs, ys, os.path.dirname(output_path), f'xlsx_{page_no}'))
            ws.freeze_panes = 'A1'
    if not wb.sheetnames: raise RuntimeError('No se encontró texto editable en el PDF')
    wb.save(output_path)
    for path in image_files:
        try: os.remove(path)
        except OSError: pass


def convert_pdf_to_xlsx_ai(input_path, output_path):
    """Reconstruye formularios complejos con Gemini Vision sin enviar claves al navegador."""
    import fitz, base64, io, json as _json, re as _re
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter
    if not GEMINI_KEYS: raise RuntimeError('Configura una API key de Gemini para usar Excel con IA')
    prompt = '''Analiza UNA página PDF como plantilla de Excel. Devuelve SOLO JSON válido, sin markdown ni texto adicional.
Reconstruye cuadros, tablas, filas, columnas, celdas combinadas, rellenos y texto; no uses una celda por palabra.
Usa coordenadas normalizadas 0..1000 y este formato compacto exacto:
{"x":[limites],"y":[limites],"cells":[[x0,y0,x1,y1,"texto","RRGGBB o null",esNegrita,"left|center|right",tamanoFuente]],"images":[[x0,y0,x1,y1]]}
x/y deben incluir todos los bordes de tablas y cuadros. cells incluye SOLO texto o celdas con relleno especial; el resto se crea vacío con borde. images incluye únicamente logos, fotos, sellos o gráficos, nunca texto.'''
    wb = Workbook(); wb.remove(wb.active); thin = Side(style='thin', color='8A8A8A')
    image_files = []
    with fitz.open(input_path) as pdf:
        for page_no, page in enumerate(pdf, 1):
            pix = page.get_pixmap(matrix=fitz.Matrix(.9, .9), alpha=False)
            image_b64 = base64.b64encode(pix.tobytes('jpeg', jpg_quality=60)).decode()
            body = _json.dumps({'contents': [{'parts': [
                {'inline_data': {'mime_type': 'image/jpeg', 'data': image_b64}}, {'text': prompt}
            ]}], 'generationConfig': {
                'responseMimeType': 'application/json', 'temperature': 0.05, 'candidateCount': 1, 'maxOutputTokens': 6000,
                'responseJsonSchema': {'type': 'object', 'properties': {
                    'x': {'type': 'array', 'items': {'type': 'number'}},
                    'y': {'type': 'array', 'items': {'type': 'number'}},
                    'cells': {'type': 'array'}, 'images': {'type': 'array'}
                }, 'required': ['x', 'y', 'cells', 'images']}
            }}).encode()
            result, model = _gemini_generate_json(body, timeout=150)
            print(f'[Excel IA] Modelo usado: {model}')
            raw = result.get('candidates', [{}])[0].get('content', {}).get('parts', [{}])[0].get('text', '')
            raw = _re.sub(r'^```(?:json)?\s*|\s*```$', '', raw.strip(), flags=_re.I)
            try:
                layout = _json.loads(raw)
            except _json.JSONDecodeError as exc:
                raise RuntimeError(f'La IA devolvió una respuesta incompleta para la página {page_no}; inténtalo otra vez') from exc
            raw_cells = layout.get('cells', [])
            cells = []
            for item in raw_cells if isinstance(raw_cells, list) else []:
                if isinstance(item, dict):
                    cells.append(item)
                elif isinstance(item, list) and len(item) >= 5:
                    cells.append({'x0': item[0], 'y0': item[1], 'x1': item[2], 'y1': item[3], 'text': item[4],
                                  'fill': item[5] if len(item) > 5 else None, 'bold': bool(item[6]) if len(item) > 6 else False,
                                  'align': item[7] if len(item) > 7 else 'left', 'font_size': item[8] if len(item) > 8 else 10})
            if not isinstance(cells, list) or not cells: raise RuntimeError(f'La IA no devolvió una cuadrícula para la página {page_no}')
            def coord(value): return max(0, min(1000, float(value)))
            xs = sorted({0.0, 1000.0, *[coord(v) for v in layout.get('x', [])], *[coord(c.get(k, 0)) for c in cells for k in ('x0', 'x1')]})
            ys = sorted({0.0, 1000.0, *[coord(v) for v in layout.get('y', [])], *[coord(c.get(k, 0)) for c in cells for k in ('y0', 'y1')]})
            if len(xs) < 2 or len(ys) < 2: raise RuntimeError(f'Geometría IA inválida en página {page_no}')
            ws = wb.create_sheet(f'Pág {page_no}')
            page_xs, page_ys = _configure_excel_page(ws, page, [x / 1000 * page.rect.width for x in xs], [y / 1000 * page.rect.height for y in ys])
            for row in ws.iter_rows(min_row=1, max_row=len(ys) - 1, min_col=1, max_col=len(xs) - 1):
                for cell in row:
                    cell.border = Border(top=thin, bottom=thin, left=thin, right=thin)
                    cell.alignment = Alignment(vertical='center', wrap_text=True)
            for spec in cells:
                x0, y0, x1, y1 = (coord(spec.get(k, 0)) for k in ('x0', 'y0', 'x1', 'y1'))
                if x1 <= x0 or y1 <= y0: continue
                col, row = xs.index(x0) + 1, ys.index(y0) + 1
                end_col, end_row = max(col, xs.index(x1)), max(row, ys.index(y1))
                cell = ws.cell(row, col, str(spec.get('text', '') or ''))
                fill = str(spec.get('fill') or '').upper()
                cell.font = Font(name='Arial', size=max(8, min(20, float(spec.get('font_size', 10)))), bold=bool(spec.get('bold')))
                cell.alignment = Alignment(horizontal=spec.get('align', 'left'), vertical='center', wrap_text=True)
                cell.border = Border(top=thin, bottom=thin, left=thin, right=thin)
                if _re.fullmatch(r'[0-9A-F]{6}', fill): cell.fill = PatternFill('solid', fgColor=fill)
                if end_col > col or end_row > row:
                    try: ws.merge_cells(start_row=row, start_column=col, end_row=end_row, end_column=end_col)
                    except ValueError: pass
            clips = []
            for image in layout.get('images', []):
                try:
                    values = (image['x0'], image['y0'], image['x1'], image['y1']) if isinstance(image, dict) else image[:4]
                    clips.append(fitz.Rect(coord(values[0]) / 1000 * page.rect.width, coord(values[1]) / 1000 * page.rect.height, coord(values[2]) / 1000 * page.rect.width, coord(values[3]) / 1000 * page.rect.height))
                except (KeyError, TypeError, ValueError): pass
            image_files.extend(_add_pdf_image_clips(page, ws, clips, page_xs, page_ys, os.path.dirname(output_path), f'ai_{page_no}'))
    if not wb.sheetnames: raise RuntimeError('No se pudo reconstruir ninguna página')
    wb.save(output_path)
    for path in image_files:
        try: os.remove(path)
        except OSError: pass


def _native_text_blocks(page):
    """Extrae líneas vectoriales con su geometría real para no degradarlas con OCR."""
    import fitz
    blocks = []
    for block in page.get_text('dict').get('blocks', []):
        if block.get('type') != 0: continue
        for line in block.get('lines', []):
            spans = [span for span in line.get('spans', []) if str(span.get('text', '')).strip()]
            if not spans: continue
            rect = fitz.Rect(line['bbox'])
            text = ''.join(str(span.get('text', '')) for span in spans).strip()
            if not text or rect.width <= 0 or rect.height <= 0: continue
            size = max(float(span.get('size', rect.height)) for span in spans)
            bold = any(int(span.get('flags', 0)) & 16 for span in spans)
            color = f"{int(spans[0].get('color', 0)) & 0xFFFFFF:06X}"
            blocks.append((fitz.Rect(rect.x0 / page.rect.width, rect.y0 / page.rect.height, rect.x1 / page.rect.width, rect.y1 / page.rect.height), text, size, bold, 'left', color))
    return blocks


def _join_positioned_words(values):
    """Conserva los renglones de texto al trasladarlos a una celda editable."""
    if not values: return ''
    values = sorted(values, key=lambda item: (item[0].y0, item[0].x0))
    lines, current, baseline = [], [], None
    for rect, text in values:
        if baseline is not None and abs(rect.y0 - baseline) > max(2, rect.height * .55):
            lines.append(' '.join(current)); current = []; baseline = rect.y0
        elif baseline is None:
            baseline = rect.y0
        current.append(text)
    if current: lines.append(' '.join(current))
    return '\r'.join(lines)


def _merge_native_table_text(page, tables):
    """Rellena tablas IA con texto vectorial exacto cuando el PDF lo contiene."""
    import fitz
    words = [(fitz.Rect(item[:4]), str(item[4]).strip()) for item in page.get_text('words') if str(item[4]).strip()]
    if not words: return tables
    merged = []
    for table_data in tables:
        rect, rows, cols, cells = table_data[:4]
        xs = table_data[4] if len(table_data) > 4 and len(table_data[4]) == cols + 1 else [rect.x0 + rect.width * index / cols for index in range(cols + 1)]
        ys = table_data[5] if len(table_data) > 5 and len(table_data[5]) == rows + 1 else [rect.y0 + rect.height * index / rows for index in range(rows + 1)]
        specs = {(int(cell[0]), int(cell[1])): list(cell) for cell in cells if isinstance(cell, (list, tuple)) and len(cell) >= 3}
        grouped = {}
        for word_rect, text in words:
            point = fitz.Point((word_rect.x0 + word_rect.x1) / page.rect.width / 2, (word_rect.y0 + word_rect.y1) / page.rect.height / 2)
            if not rect.contains(point): continue
            col = next((index for index in range(cols) if xs[index] <= point.x <= xs[index + 1]), None)
            row = next((index for index in range(rows) if ys[index] <= point.y <= ys[index + 1]), None)
            if row is not None and col is not None: grouped.setdefault((row, col), []).append((word_rect, text))
        for key, values in grouped.items():
            text = _join_positioned_words(values)
            current = specs.get(key, [key[0], key[1], ''])
            current[2] = text
            specs[key] = current
        ordered_cells = [specs[key] for key in sorted(specs)]
        merged.append((rect, rows, cols, ordered_cells, xs, ys))
    return merged


def _gemini_text_blocks(page):
    """Obtiene bloques de texto editables de una página, incluso si fue escaneada."""
    import base64, json, re, fitz
    if not GEMINI_KEYS: raise RuntimeError('Configura una API key de Gemini para usar Office con IA')
    prompt = '''Analiza UNA página de documento. Devuelve SOLO JSON válido, sin markdown.
Extrae el texto, detecta toda cuadrícula real y los elementos gráficos editables. Usa coordenadas normalizadas 0..1000.
Formato exacto: {"blocks":[[x0,y0,x1,y1,"texto",tamanoFuente,esNegrita,"left|center|right","RRGGBB o null"]],"tables":[[x0,y0,x1,y1,filas,columnas,[[fila,columna,"texto","RRGGBB o null",esNegrita,"left|center|right"]],[limitesX],[limitesY]]],"shapes":[["rect|roundRect|line",x0,y0,x1,y1,"relleno RRGGBB o null","linea RRGGBB o null",grosorLinea]]}.
Cada table debe incluir limitesX con columnas+1 valores y limitesY con filas+1 valores, siempre en coordenadas 0..1000.
Incluye en shapes cuadros blancos, tarjetas, barras y conectores que puedan editarse; no incluyas fotos, retratos, logos, sellos ni gráficos complejos. No repitas texto de tables en blocks.'''
    pix = page.get_pixmap(matrix=fitz.Matrix(.9, .9), alpha=False)
    body = json.dumps({'contents': [{'parts': [
        {'inline_data': {'mime_type': 'image/jpeg', 'data': base64.b64encode(pix.tobytes('jpeg', jpg_quality=60)).decode()}}, {'text': prompt}
    ]}], 'generationConfig': {
        'responseMimeType': 'application/json', 'temperature': 0.05, 'candidateCount': 1, 'maxOutputTokens': 7000,
        'responseJsonSchema': {'type': 'object', 'properties': {'blocks': {'type': 'array'}, 'tables': {'type': 'array'}, 'shapes': {'type': 'array'}}, 'required': ['blocks', 'tables', 'shapes']}
    }}).encode()
    result, model = _gemini_generate_json(body, timeout=150)
    print(f'[Office IA] Modelo usado: {model}')
    raw = result.get('candidates', [{}])[0].get('content', {}).get('parts', [{}])[0].get('text', '')
    parse_failed = False
    try: data = json.loads(re.sub(r'^```(?:json)?\s*|\s*```$', '', raw.strip(), flags=re.I))
    except json.JSONDecodeError:
        data, parse_failed = {}, True
        print('[Office IA] JSON incompleto; usando estructura nativa del PDF')
    blocks = []
    for item in data.get('blocks', []):
        if not isinstance(item, list) or len(item) < 5: continue
        try:
            rect = fitz.Rect(*[max(0, min(1000, float(v))) / 1000 for v in item[:4]])
            color = str(item[8] or '') if len(item) > 8 else ''
            if not re.fullmatch(r'[0-9A-Fa-f]{6}', color): color = '000000'
            if rect.width > 0 and rect.height > 0 and str(item[4]).strip(): blocks.append((rect, str(item[4]), item[5] if len(item) > 5 else 10, bool(item[6]) if len(item) > 6 else False, item[7] if len(item) > 7 else 'left', color))
        except (TypeError, ValueError): pass
    tables = []
    for item in data.get('tables', []):
        if not isinstance(item, list) or len(item) < 7: continue
        try:
            rect = fitz.Rect(*[max(0, min(1000, float(v))) / 1000 for v in item[:4]])
            rows, cols = int(item[4]), int(item[5])
            raw_cells = item[6] if isinstance(item[6], list) else []
            if raw_cells and not isinstance(raw_cells[0], (list, tuple)): raw_cells = [raw_cells]
            cells = [cell for cell in raw_cells if isinstance(cell, (list, tuple)) and len(cell) >= 3]
            xs = [max(0, min(1000, float(value))) / 1000 for value in item[7]] if len(item) > 7 and isinstance(item[7], list) else []
            ys = [max(0, min(1000, float(value))) / 1000 for value in item[8]] if len(item) > 8 and isinstance(item[8], list) else []
            if len(xs) != cols + 1 or any(right <= left for left, right in zip(xs, xs[1:])): xs = []
            if len(ys) != rows + 1 or any(bottom <= top for top, bottom in zip(ys, ys[1:])): ys = []
            if rect.width > 0 and rect.height > 0 and 0 < rows <= 80 and 0 < cols <= 40: tables.append((rect, rows, cols, cells, xs, ys))
        except (TypeError, ValueError): pass
    shapes = []
    for item in data.get('shapes', []):
        if not isinstance(item, list) or len(item) < 5: continue
        try:
            kind = str(item[0])
            if kind not in ('rect', 'roundRect', 'line'): continue
            rect = fitz.Rect(*[max(0, min(1000, float(v))) / 1000 for v in item[1:5]])
            if rect.width <= 0 or rect.height <= 0: continue
            fill = str(item[5] or '') if len(item) > 5 else ''
            line = str(item[6] or '') if len(item) > 6 else ''
            if not re.fullmatch(r'[0-9A-Fa-f]{6}', fill): fill = ''
            if not re.fullmatch(r'[0-9A-Fa-f]{6}', line): line = ''
            shapes.append((kind, rect, fill, line, max(.25, min(8, float(item[7] if len(item) > 7 else 1)))))
        except (TypeError, ValueError): pass
    # Para PDFs vectoriales, la geometría real es más fiable que la inferencia visual.
    native_tables = []
    native_fills = [(item[1], _rgb(drawing.get('fill'))) for drawing in page.get_drawings() if _rgb(drawing.get('fill')) for item in drawing.get('items', []) if item[0] == 're']
    for rect, rows, cols, cells, xs, ys in _pdf_native_tables(page):
        normalized = fitz.Rect(rect.x0 / page.rect.width, rect.y0 / page.rect.height, rect.x1 / page.rect.width, rect.y1 / page.rect.height)
        styled_cells = []
        for row, col, text in cells:
            center = fitz.Point((xs[col] + xs[col + 1]) / 2, (ys[row] + ys[row + 1]) / 2) if len(xs) == cols + 1 and len(ys) == rows + 1 else None
            fill = next((color for fill_rect, color in native_fills if center and fill_rect.contains(center)), None)
            styled_cells.append([row, col, text, fill])
        native_tables.append((normalized, rows, cols, styled_cells, [x / page.rect.width for x in xs], [y / page.rect.height for y in ys]))
    if native_tables:
        tables = native_tables + [table for table in tables if not any(native[0].intersects(table[0]) for native in native_tables)]
    tables = _merge_native_table_text(page, tables)
    native_blocks = _native_text_blocks(page)
    if native_blocks:
        blocks = [block for block in native_blocks if not any(table[0].contains(fitz.Point((block[0].x0 + block[0].x1) / 2, (block[0].y0 + block[0].y1) / 2)) for table in tables)]
    elif parse_failed:
        blocks = []
        for word in page.get_text('words'):
            rect, text = fitz.Rect(word[:4]), str(word[4]).strip()
            normalized = fitz.Rect(rect.x0 / page.rect.width, rect.y0 / page.rect.height, rect.x1 / page.rect.width, rect.y1 / page.rect.height)
            if text and not any(table[0].contains(normalized) for table in tables):
                blocks.append((normalized, text, max(7, rect.height), False, 'left', '000000'))
    if not blocks and not tables and not shapes: raise RuntimeError('La IA no detectó texto o formas editables en esta página')
    return blocks, tables, shapes


def _render_ai_background(page, blocks, tables, path, shapes=(), mask_tables=True):
    """Conserva el original como respaldo visual y oculta sólo regiones reconstruidas completas."""
    import io, fitz
    from collections import Counter
    from PIL import Image, ImageDraw
    scale = 2
    pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
    image = Image.open(io.BytesIO(pix.tobytes('png'))).convert('RGB')
    draw = ImageDraw.Draw(image)
    for kind, rect, fill, line, line_width in shapes:
        x0, y0, x1, y1 = [int(v * scale) for v in (rect.x0 * page.rect.width, rect.y0 * page.rect.height, rect.x1 * page.rect.width, rect.y1 * page.rect.height)]
        fill_rgb = tuple(int(fill[i:i + 2], 16) for i in (0, 2, 4)) if fill else None
        line_rgb = tuple(int(line[i:i + 2], 16) for i in (0, 2, 4)) if line else None
        if kind == 'line':
            draw.line((x0, y0, x1, y1), fill=line_rgb or fill_rgb or (255, 255, 255), width=max(1, int(line_width * scale)))
        elif kind == 'roundRect':
            draw.rounded_rectangle((x0, y0, x1, y1), radius=max(2, min(abs(x1 - x0), abs(y1 - y0)) // 8), fill=fill_rgb or (255, 255, 255), outline=line_rgb, width=max(1, int(line_width * scale)))
        else:
            draw.rectangle((x0, y0, x1, y1), fill=fill_rgb or (255, 255, 255), outline=line_rgb, width=max(1, int(line_width * scale)))
    for rect, *_ in blocks:
        x0, y0, x1, y1 = [int(v * scale) for v in (rect.x0 * page.rect.width, rect.y0 * page.rect.height, rect.x1 * page.rect.width, rect.y1 * page.rect.height)]
        crop = image.crop((max(0, x0 - 2), max(0, y0 - 2), min(image.width, x1 + 2), min(image.height, y1 + 2)))
        pixels = list(crop.getdata())[::max(1, crop.width * crop.height // 1200)]
        if not pixels: continue
        color, count = Counter((red // 8 * 8, green // 8 * 8, blue // 8 * 8) for red, green, blue in pixels).most_common(1)[0]
        if count / len(pixels) >= .45: draw.rectangle((x0, y0, x1, y1), fill=color)
    for rect, *_ in (tables if mask_tables else []):
        x0, y0, x1, y1 = [int(v * scale) for v in (rect.x0 * page.rect.width, rect.y0 * page.rect.height, rect.x1 * page.rect.width, rect.y1 * page.rect.height)]
        draw.rectangle((x0, y0, x1, y1), fill=(255, 255, 255))
    image.save(path)


def convert_pdf_to_docx_ai(input_path, output_path, timeout=300):
    """Usa Word nativo para PDF vectorial y reconstrucción IA sólo para escaneados."""
    import fitz
    if _prefer_native_office_conversion(input_path):
        try:
            print('[Word IA] PDF vectorial: preservando la conversión nativa de mayor fidelidad')
            return convert_pdf_to_docx(input_path, output_path, timeout)
        except Exception as exc:
            print(f'[Word IA] Conversión nativa falló; usando reconstrucción visual: {exc}')
    image_files = []
    with fitz.open(input_path) as pdf:
        pages = []
        for number, page in enumerate(pdf, 1):
            blocks, tables, shapes = _gemini_text_blocks(page)
            path = os.path.join(os.path.dirname(output_path), f'ai_word_{number}.png')
            _render_ai_background(page, blocks, tables, path, shapes); image_files.append(path)
            pages.append((page.rect.width, page.rect.height, blocks, tables, shapes, path))
    def _do(app):
        doc = app.Documents.Add()
        try:
            def pin_to_page(shape, left, top, shape_width, shape_height):
                shape.RelativeHorizontalPosition = 1; shape.RelativeVerticalPosition = 1
                shape.Left, shape.Top, shape.Width, shape.Height = left, top, shape_width, shape_height
                return shape
            def word_color(value): return int(value[4:6] + value[2:4] + value[0:2], 16)
            for index, (width, height, blocks, tables, shapes, path) in enumerate(pages):
                setup = doc.Sections(doc.Sections.Count).PageSetup
                setup.PageWidth, setup.PageHeight = width, height
                setup.TopMargin = setup.BottomMargin = setup.LeftMargin = setup.RightMargin = 0
                anchor = doc.Range(doc.Content.End - 1, doc.Content.End - 1)
                image = doc.Shapes.AddPicture(path, False, True, 0, 0, width, height, anchor)
                pin_to_page(image, 0, 0, width, height)
                image.WrapFormat.Type = 5
                for kind, rect, fill, line, line_width in shapes:
                    if kind == 'line':
                        shape = doc.Shapes.AddLine(rect.x0 * width, rect.y0 * height, rect.x1 * width, rect.y1 * height, anchor)
                        shape.Line.Visible = -1; shape.Line.Weight = line_width
                        shape.Line.ForeColor.RGB = word_color(line or fill or '000000')
                    else:
                        shape = doc.Shapes.AddShape(5 if kind == 'roundRect' else 1, rect.x0 * width, rect.y0 * height, rect.width * width, rect.height * height, anchor)
                        shape.Fill.Visible = -1 if fill else 0
                        if fill: shape.Fill.ForeColor.RGB = word_color(fill)
                        shape.Line.Visible = -1 if line else 0
                        if line:
                            shape.Line.ForeColor.RGB = word_color(line)
                            shape.Line.Weight = line_width
                    pin_to_page(shape, rect.x0 * width, rect.y0 * height, max(1, rect.width * width), max(1, rect.height * height))
                    shape.ZOrder(0)
                for rect, text, size, bold, align, *style in blocks:
                    font_size = max(6, min(36, float(size)))
                    color = style[0] if style and re.fullmatch(r'[0-9A-Fa-f]{6}', str(style[0])) else '000000'
                    line_count = max(1, len(str(text).splitlines()))
                    box_left = max(0, rect.x0 * width - 2)
                    box_top = max(0, rect.y0 * height - 1)
                    box_width = min(width - box_left, rect.width * width + 4)
                    box_height = max(5, rect.height * height + 4, font_size * 1.35 * line_count + 2)
                    shape = doc.Shapes.AddTextbox(1, box_left, box_top, box_width, box_height, anchor)
                    pin_to_page(shape, box_left, box_top, box_width, box_height)
                    shape.Line.Visible = 0; shape.Fill.Visible = 0
                    shape.ZOrder(0)
                    try:
                        shape.TextFrame.MarginLeft = shape.TextFrame.MarginRight = shape.TextFrame.MarginTop = shape.TextFrame.MarginBottom = 0
                        shape.TextFrame.AutoSize = 0
                    except Exception: pass
                    rng = shape.TextFrame.TextRange; rng.Text = text
                    rng.Font.Name = 'Arial'; rng.Font.Size = font_size; rng.Font.Bold = -1 if bold else 0
                    rng.Font.Color = word_color(color)
                    rng.ParagraphFormat.Alignment = {'left': 0, 'center': 1, 'right': 2}.get(align, 0)
                for table_data in tables:
                    rect, rows, cols, cells = table_data[:4]
                    shape = doc.Shapes.AddTextbox(1, rect.x0 * width, rect.y0 * height, rect.width * width, rect.height * height, anchor)
                    pin_to_page(shape, rect.x0 * width, rect.y0 * height, rect.width * width, rect.height * height)
                    shape.Line.Visible = 0; shape.Fill.Visible = 0
                    shape.ZOrder(0)
                    try:
                        shape.TextFrame.MarginLeft = shape.TextFrame.MarginRight = shape.TextFrame.MarginTop = shape.TextFrame.MarginBottom = 0
                        shape.TextFrame.AutoSize = 0
                    except Exception: pass
                    table = doc.Tables.Add(shape.TextFrame.TextRange, rows, cols)
                    table.AllowAutoFit = False; table.Borders.Enable = 1
                    table.PreferredWidthType = 3; table.PreferredWidth = rect.width * width
                    table.TopPadding = table.BottomPadding = 0; table.LeftPadding = table.RightPadding = 1
                    xs = table_data[4] if len(table_data) > 4 else []
                    ys = table_data[5] if len(table_data) > 5 else []
                    for col in range(cols): table.Columns(col + 1).Width = max(12, ((xs[col + 1] - xs[col]) if len(xs) == cols + 1 else rect.width / cols) * width)
                    for row in range(rows):
                        table.Rows(row + 1).HeightRule = 2
                        table.Rows(row + 1).Height = max(8, ((ys[row + 1] - ys[row]) if len(ys) == rows + 1 else rect.height / rows) * height)
                    for row in range(rows):
                        for col in range(cols):
                            cell = table.Cell(row + 1, col + 1)
                            cell.Shading.BackgroundPatternColor = 0xFFFFFF
                    for cell_data in cells:
                        try:
                            row, col, text = int(cell_data[0]) + 1, int(cell_data[1]) + 1, str(cell_data[2])
                            if 1 <= row <= rows and 1 <= col <= cols:
                                cell = table.Cell(row, col); cell.Range.Text = text
                                row_height = ((ys[row] - ys[row - 1]) if len(ys) == rows + 1 else rect.height / rows) * height
                                line_count = max(1, text.count('\r') + 1)
                                font_size = max(5, min(10, (row_height - 1) / (1.12 * line_count)))
                                cell.Range.Font.Name = 'Arial'; cell.Range.Font.Size = font_size
                                cell.Range.Font.Bold = -1 if len(cell_data) > 4 and cell_data[4] else 0
                                cell.Range.ParagraphFormat.SpaceAfter = 0; cell.Range.ParagraphFormat.SpaceBefore = 0
                                cell.Range.ParagraphFormat.Alignment = 1 if len(cell_data) <= 5 or cell_data[5] == 'center' else (2 if cell_data[5] == 'right' else 0)
                                cell.VerticalAlignment = 1
                                fill = str(cell_data[3] or '') if len(cell_data) > 3 else ''
                                if re.fullmatch(r'[0-9A-Fa-f]{6}', fill): cell.Shading.BackgroundPatternColor = int(fill[4:6] + fill[2:4] + fill[0:2], 16)
                        except (TypeError, ValueError, IndexError): pass
                if index < len(pages) - 1: doc.Range(doc.Content.End - 1, doc.Content.End - 1).InsertBreak(7)
            doc.SaveAs2(output_path, FileFormat=16)
        finally:
            try: doc.Close(False)
            except: pass
        return True
    try: _run_on_com_worker('Word.Application', _do, timeout)
    finally:
        for path in image_files:
            try: os.remove(path)
            except OSError: pass


def _lock_pptx_background(picture):
    """Evita que la imagen de referencia intercepte los clics de las tablas editables."""
    try:
        from pptx.oxml.ns import qn
        picture_props = picture._element.nvPicPr.find(qn('p:cNvPicPr'))
        locks = picture_props.find(qn('a:picLocks')) if picture_props is not None else None
        if locks is not None: locks.set('noSelect', '1')
        picture.name = 'Fondo PDF (bloqueado)'
    except Exception: pass


def convert_pdf_to_pptx_ai(input_path, output_path):
    """Usa geometría PDF nativa cuando existe y reconstrucción IA para escaneados."""
    import fitz
    if _prefer_native_office_conversion(input_path):
        try:
            print('[PowerPoint IA] PDF vectorial: preservando texto y tablas nativas')
            return convert_pdf_to_pptx(input_path, output_path)
        except Exception as exc:
            print(f'[PowerPoint IA] Conversión nativa falló; usando reconstrucción visual: {exc}')
    from pptx import Presentation
    from pptx.util import Pt
    from pptx.dml.color import RGBColor
    from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
    prs = Presentation(); blank = prs.slide_layouts[6]; image_files = []
    with fitz.open(input_path) as pdf:
        if not pdf.page_count: raise RuntimeError('El PDF no contiene páginas')
        first = pdf[0].rect; prs.slide_width, prs.slide_height = int(first.width * 12700), int(first.height * 12700)
        for number, page in enumerate(pdf, 1):
            blocks, tables, _ = _gemini_text_blocks(page)
            path = os.path.join(os.path.dirname(output_path), f'ai_ppt_{number}.png')
            _render_ai_background(page, blocks, tables, path); image_files.append(path)
            slide = prs.slides.add_slide(blank); ratio = min(prs.slide_width / page.rect.width, prs.slide_height / page.rect.height)
            width, height = int(page.rect.width * ratio), int(page.rect.height * ratio); left, top = int((prs.slide_width - width) / 2), int((prs.slide_height - height) / 2)
            background = slide.shapes.add_picture(path, left, top, width, height)
            _lock_pptx_background(background)
            for rect, text, size, bold, align, *style in blocks:
                shape = slide.shapes.add_textbox(left + int(rect.x0 * page.rect.width * ratio), top + int(rect.y0 * page.rect.height * ratio), max(1, int(rect.width * page.rect.width * ratio)), max(1, int(rect.height * page.rect.height * ratio)))
                frame = shape.text_frame; frame.clear(); frame.margin_left = frame.margin_right = frame.margin_top = frame.margin_bottom = 0
                color = str(style[0]) if style and re.fullmatch(r'[0-9A-Fa-f]{6}', str(style[0])) else '000000'
                run = frame.paragraphs[0].add_run(); run.text = text; run.font.name = 'Arial'; run.font.size = Pt(max(5, min(36, float(size)))); run.font.bold = bold; run.font.color.rgb = RGBColor(int(color[0:2], 16), int(color[2:4], 16), int(color[4:6], 16))
                frame.paragraphs[0].alignment = {'left': PP_ALIGN.LEFT, 'center': PP_ALIGN.CENTER, 'right': PP_ALIGN.RIGHT}.get(align, PP_ALIGN.LEFT)
            for table_data in tables:
                rect, rows, cols, cells = table_data[:4]
                table = slide.shapes.add_table(rows, cols, left + int(rect.x0 * page.rect.width * ratio), top + int(rect.y0 * page.rect.height * ratio), int(rect.width * page.rect.width * ratio), int(rect.height * page.rect.height * ratio)).table
                xs = table_data[4] if len(table_data) > 4 else []
                ys = table_data[5] if len(table_data) > 5 else []
                if len(xs) == cols + 1:
                    for col in range(cols): table.columns[col].width = int((xs[col + 1] - xs[col]) * page.rect.width * ratio)
                if len(ys) == rows + 1:
                    for row in range(rows): table.rows[row].height = int((ys[row + 1] - ys[row]) * page.rect.height * ratio)
                for row in range(rows):
                    for col in range(cols):
                        table.cell(row, col).fill.solid(); table.cell(row, col).fill.fore_color.rgb = RGBColor(255, 255, 255)
                for cell_data in cells:
                    try:
                        row, col, text = int(cell_data[0]), int(cell_data[1]), str(cell_data[2])
                        if 0 <= row < rows and 0 <= col < cols:
                            cell = table.cell(row, col); cell.text = text; cell.text_frame.paragraphs[0].font.bold = bool(cell_data[4]) if len(cell_data) > 4 else False
                            fill = str(cell_data[3] or '') if len(cell_data) > 3 else ''
                            if re.fullmatch(r'[0-9A-Fa-f]{6}', fill):
                                cell.fill.solid(); cell.fill.fore_color.rgb = RGBColor(int(fill[0:2], 16), int(fill[2:4], 16), int(fill[4:6], 16))
                    except (TypeError, ValueError, IndexError): pass
    try: prs.save(output_path)
    finally:
        for path in image_files:
            try: os.remove(path)
            except OSError: pass


def convert_pdf_to_pptx(input_path, output_path):
    """Conserva gráficos como fondo y reconstruye el texto como cajas editables."""
    import fitz
    from PIL import Image, ImageDraw, ImageStat
    from pptx import Presentation
    from pptx.util import Pt
    from pptx.dml.color import RGBColor
    from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
    prs = Presentation()
    blank = prs.slide_layouts[6]
    with fitz.open(input_path) as pdf:
        if not pdf.page_count: raise RuntimeError('El PDF no contiene páginas')
        first = pdf[0].rect
        prs.slide_width, prs.slide_height = int(first.width * 12700), int(first.height * 12700)
        for index, page in enumerate(pdf, 1):
            slide = prs.slides.add_slide(blank)
            image_path = os.path.join(os.path.dirname(output_path), f'page_{index}.png')
            scale = 2
            pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
            pix.save(image_path)
            image = Image.open(image_path).convert('RGB')
            draw = ImageDraw.Draw(image)
            span_styles = []
            for block in page.get_text('dict').get('blocks', []):
                for line in block.get('lines', []):
                    span_styles.extend((fitz.Rect(span['bbox']), span) for span in line.get('spans', []) if span.get('text', '').strip())
            text_items = []
            native_tables = _pdf_native_tables(page)
            for word in page.get_text('words'):
                rect, text = fitz.Rect(word[:4]), word[4]
                if not text.strip(): continue
                if any(table_rect.contains(rect) for table_rect, *_ in native_tables): continue
                style = min(span_styles, key=lambda pair: abs(pair[0].x0 - rect.x0) + abs(pair[0].y0 - rect.y0))[1] if span_styles else {}
                text_items.append((rect, text, style))
            for rect, *_ in text_items + native_tables:
                    # El color del fondo se obtiene alrededor del texto: conserva encabezados coloreados y tablas.
                    x0, y0 = max(0, int(rect.x0 * scale - 2)), max(0, int(rect.y0 * scale - 2))
                    x1, y1 = min(image.width, int(rect.x1 * scale + 2)), min(image.height, int(rect.y1 * scale + 2))
                    samples = []
                    for box in ((x0, max(0, y0 - 3), x1, y0), (x0, y1, x1, min(image.height, y1 + 3)), (max(0, x0 - 3), y0, x0, y1), (x1, y0, min(image.width, x1 + 3), y1)):
                        if box[2] > box[0] and box[3] > box[1]: samples.append(ImageStat.Stat(image.crop(box)).mean)
                    background = tuple(int(sum(color[i] for color in samples) / len(samples)) for i in range(3)) if samples else (255, 255, 255)
                    draw.rectangle((x0, y0, x1, y1), fill=background)
                    
            image.save(image_path)
            ratio = min(prs.slide_width / page.rect.width, prs.slide_height / page.rect.height)
            width, height = int(page.rect.width * ratio), int(page.rect.height * ratio)
            left, top = int((prs.slide_width - width) / 2), int((prs.slide_height - height) / 2)
            background = slide.shapes.add_picture(image_path, left, top, width, height)
            _lock_pptx_background(background)
            physical_scale = ratio / 12700
            native_fills = [(item[1], _rgb(drawing.get('fill'))) for drawing in page.get_drawings() if _rgb(drawing.get('fill')) for item in drawing.get('items', []) if item[0] == 're']
            for rect, rows, cols, cells, table_xs, table_ys in native_tables:
                table = slide.shapes.add_table(rows, cols, left + int(rect.x0 * ratio), top + int(rect.y0 * ratio), int(rect.width * ratio), int(rect.height * ratio)).table
                if len(table_xs) == cols + 1:
                    for col in range(cols): table.columns[col].width = int((table_xs[col + 1] - table_xs[col]) * ratio)
                if len(table_ys) == rows + 1:
                    for row in range(rows): table.rows[row].height = int((table_ys[row + 1] - table_ys[row]) * ratio)
                for row in range(rows):
                    for col in range(cols):
                        cell = table.cell(row, col)
                        cx = (table_xs[col] + table_xs[col + 1]) / 2
                        cy = (table_ys[row] + table_ys[row + 1]) / 2
                        fill = next((color for fill_rect, color in native_fills if fill_rect.contains(fitz.Point(cx, cy))), 'FFFFFF')
                        cell.fill.solid(); cell.fill.fore_color.rgb = RGBColor(int(fill[0:2], 16), int(fill[2:4], 16), int(fill[4:6], 16))
                        cell.margin_left = cell.margin_right = Pt(1); cell.margin_top = cell.margin_bottom = 0
                        cell.vertical_anchor = MSO_ANCHOR.MIDDLE
                for row, col, text in cells:
                    cell = table.cell(row, col)
                    cell.text = text
                    cell_rect = fitz.Rect(table_xs[col], table_ys[row], table_xs[col + 1], table_ys[row + 1])
                    style = next((span for span_rect, span in span_styles if span_rect.intersects(cell_rect) and span.get('text', '').strip()), {})
                    paragraph = cell.text_frame.paragraphs[0]; paragraph.alignment = PP_ALIGN.CENTER
                    paragraph.font.name = style.get('font', 'Arial')
                    paragraph.font.size = Pt(max(5, min(18, float(style.get('size', 9)))))
                    paragraph.font.bold = bool(style.get('flags', 0) & 16)
                    color = style.get('color', 0); paragraph.font.color.rgb = RGBColor((color >> 16) & 255, (color >> 8) & 255, color & 255)
            for rect, text, style in text_items:
                shape = slide.shapes.add_textbox(left + int(rect.x0 * ratio), top + int(rect.y0 * ratio), max(1, int(rect.width * ratio)), max(1, int((rect.height + 2) * ratio)))
                frame = shape.text_frame
                frame.clear(); frame.margin_left = frame.margin_right = frame.margin_top = frame.margin_bottom = 0
                paragraph = frame.paragraphs[0]
                run = paragraph.add_run(); run.text = text
                run.font.name = style.get('font', 'Arial')
                run.font.size = Pt(max(5, style.get('size', rect.height) * physical_scale))
                color = style.get('color', 0)
                run.font.color.rgb = RGBColor((color >> 16) & 255, (color >> 8) & 255, color & 255)
                run.font.bold = bool(style.get('flags', 0) & 16)
            os.remove(image_path)
    if not prs.slides: raise RuntimeError('El PDF no contiene páginas')
    prs.save(output_path)


def _get_com_format(ext):
    """Retorna (app_progid, file_format_constant) según extensión."""
    ext = ext.lower()
    if ext in ('.doc', '.docx', '.docm', '.dotx', '.dotm', '.odt', '.rtf'):
        return 'Word.Application', 17       # wdFormatPDF
    elif ext in ('.xls', '.xlsx', '.xlsm', '.xlsb', '.ods', '.csv'):
        return 'Excel.Application', 0       # xlTypePDF (ExportAsFixedFormat Type=0)
    elif ext in ('.ppt', '.pptx', '.pptm', '.ppsx', '.odp'):
        return 'PowerPoint.Application', 32 # ppSaveAsPDF
    raise ValueError(f"Extensión no soportada: {ext}")


def _convert_via_msoffice_com(input_path, output_path, timeout, pagesetup_params=None):
    ext = os.path.splitext(input_path)[1].lower()
    progid, fmt = _get_com_format(ext)

    def _do(app):
        app.DisplayAlerts = False
        try: app.AutomationSecurity = 1
        except: pass

        if progid == 'Word.Application':
            doc = None
            try:
                doc = app.Documents.Open(
                    input_path, ReadOnly=True,
                    ConfirmConversions=False, AddToRecentFiles=False, Visible=False)
                if doc is None:
                    doc = app.ActiveDocument
                if doc is None:
                    raise RuntimeError("Word no pudo abrir el archivo")
                doc.SaveAs2(output_path, FileFormat=fmt)
            finally:
                if doc:
                    try: doc.Close(False)
                    except: pass

        elif progid == 'Excel.Application':
            wb = None
            try:
                app.Workbooks.Open(input_path, ReadOnly=False, UpdateLinks=0)
                wb = app.ActiveWorkbook
                if wb is None:
                    raise RuntimeError("Excel no pudo abrir el archivo (Protected View o acceso denegado)")

                # Aplicar PageSetup si se recibieron parámetros
                if pagesetup_params:
                    ps = wb.ActiveSheet.PageSetup
                    orient = pagesetup_params.get('orientation', '')
                    if orient.lower() == 'landscape':
                        ps.Orientation = 2
                    elif orient.lower() == 'portrait':
                        ps.Orientation = 1

                    paper_size = pagesetup_params.get('paperSize', '')
                    if paper_size:
                        try: ps.PaperSize = int(paper_size)
                        except: pass

                    fit_wide = pagesetup_params.get('fitWide', '')
                    fit_tall = pagesetup_params.get('fitTall', '')
                    zoom_val = pagesetup_params.get('zoom', '')

                    if fit_wide or fit_tall:
                        ps.Zoom = False
                        try: ps.FitToPagesWide = int(fit_wide) if fit_wide and int(fit_wide) > 0 else 0
                        except: pass
                        try: ps.FitToPagesTall = int(fit_tall) if fit_tall and int(fit_tall) > 0 else 0
                        except: pass
                    elif zoom_val:
                        try:
                            ps.FitToPagesWide = 0
                            ps.FitToPagesTall = 0
                        except: pass
                        try: ps.Zoom = int(zoom_val)
                        except: pass

                    print(f"[Office] PageSetup: orient={orient} paper={paper_size} fitWide={fit_wide} fitTall={fit_tall} zoom={zoom_val}")

                wb.ExportAsFixedFormat(fmt, output_path)
            finally:
                if wb:
                    try: wb.Close(False)
                    except: pass

        elif progid == 'PowerPoint.Application':
            prs = None
            try:
                prs = app.Presentations.Open(
                    input_path, ReadOnly=True, WithWindow=False)
                if prs is None:
                    prs = app.ActivePresentation
                if prs is None:
                    raise RuntimeError("PowerPoint no pudo abrir el archivo")
                prs.SaveAs(output_path, fmt)
            finally:
                if prs:
                    try: prs.Close()
                    except: pass
        return True

    _run_on_com_worker(progid, _do, timeout)
    return True


def _convert_via_wps_com(input_path, output_path, timeout):
    ext = os.path.splitext(input_path)[1].lower()

    if ext in ('.doc', '.docx'):
        progid = "WPS.Application"
        def _do(app):
            app.Visible = False
            doc = app.Documents.Open(input_path)
            doc.SaveAs2(output_path, FileFormat=17)
            doc.Close(False)
            return True
    elif ext in ('.xls', '.xlsx'):
        progid = "ET.Application"
        def _do(app):
            app.Visible = False
            wb = app.Workbooks.Open(input_path)
            wb.ExportAsFixedFormat(0, output_path)
            wb.Close(False)
            return True
    elif ext in ('.ppt', '.pptx'):
        progid = "WPP.Application"
        def _do(app):
            app.Visible = False
            prs = app.Presentations.Open(input_path, WithWindow=False)
            prs.SaveAs(output_path, 32)
            prs.Close()
            return True
    else:
        raise ValueError(f"WPS COM: extensión no soportada {ext}")

    _run_on_com_worker(progid, _do, timeout)
    return True


def _convert_via_wps_cli(input_path, output_path, exe, timeout):
    out_dir = os.path.dirname(output_path)
    r = subprocess.run(
        [exe, input_path, "--convert-to", "pdf", "--outdir", out_dir],
        timeout=timeout, capture_output=True
    )
    # WPS CLI genera archivo con mismo nombre base
    expected = os.path.join(out_dir, os.path.splitext(os.path.basename(input_path))[0] + '.pdf')
    if os.path.exists(expected) and expected != output_path:
        os.rename(expected, output_path)
    if not os.path.exists(output_path):
        raise RuntimeError(f"WPS CLI no generó PDF. stderr: {r.stderr.decode(errors='replace')}")
    return True


def _convert_via_libreoffice(input_path, output_path, exe, timeout):
    out_dir = os.path.dirname(output_path)
    r = subprocess.run(
        [exe, "--headless", "--convert-to", "pdf", "--outdir", out_dir, input_path],
        timeout=timeout, capture_output=True
    )
    expected = os.path.join(out_dir, os.path.splitext(os.path.basename(input_path))[0] + '.pdf')
    if os.path.exists(expected) and expected != output_path:
        os.rename(expected, output_path)
    if not os.path.exists(output_path):
        raise RuntimeError(f"LibreOffice no generó PDF. stderr: {r.stderr.decode(errors='replace')}")
    return True


def _convert_via_softmaker(input_path, output_path, exe, timeout):
    r = subprocess.run(
        [exe, "--export-pdf", output_path, input_path],
        timeout=timeout, capture_output=True
    )
    if not os.path.exists(output_path):
        raise RuntimeError(f"SoftMaker no generó PDF. stderr: {r.stderr.decode(errors='replace')}")
    return True


def _detect_office_ext(data, filename=''):
    """Detecta extensión real de un archivo Office por magic bytes y nombre."""
    # ZIP-based (OOXML): PK magic
    if data[:2] == b'PK':
        # Intentar leer [Content_Types].xml dentro del ZIP para identificar tipo exacto
        try:
            import zipfile, io
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                ct = z.read('[Content_Types].xml').decode(errors='replace')
                if 'wordprocessingml' in ct:
                    return '.docm' if 'macroEnabled' in ct else '.docx'
                elif 'spreadsheetml' in ct:
                    return '.xlsm' if 'macroEnabled' in ct else '.xlsx'
                elif 'presentationml' in ct:
                    return '.pptm' if 'macroEnabled' in ct else '.pptx'
        except Exception:
            pass
        # Fallback por nombre original
        fn = filename.lower()
        if any(x in fn for x in ['word', 'doc']): return '.docx'
        if any(x in fn for x in ['excel', 'sheet', 'xls']): return '.xlsx'
        if any(x in fn for x in ['power', 'ppt', 'slide']): return '.pptx'
        return '.docx'  # asumir Word por defecto
    # OLE2 (legacy .doc/.xls/.ppt): D0CF magic
    elif data[:8] == b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1':
        fn = filename.lower()
        if any(x in fn for x in ['excel', 'sheet', 'xls']): return '.xls'
        if any(x in fn for x in ['power', 'ppt', 'slide']): return '.ppt'
        return '.doc'
    return '.docx'


# ============================================================
# EXCEL PAGE SETUP — Inspección y Edición Manual
# ============================================================

# Sesiones activas: session_id -> {path, status, info, thread}
_excel_sessions = {}
_excel_sessions_lock = threading.Lock()


def _excel_inspect_pagesetup(xlsx_path):
    """Abre xlsx con COM invisible, lee PageSetup, cierra. Retorna dict."""
    result = [None, None]
    evt = threading.Event()

    def _run():
        try:
            import pythoncom, win32com.client
            pythoncom.CoInitialize()
            xl = win32com.client.DispatchEx('Excel.Application')
            xl.Visible = False
            xl.DisplayAlerts = False
            try:
                pvs = xl.Application.ProtectedViewSettings
                pvs.EnabledForFilesFromInternet = False
                pvs.EnabledForUnsafeLocations   = False
            except: pass
            wb = xl.Workbooks.Open(xlsx_path, ReadOnly=True, UpdateLinks=0)
            ws = wb.ActiveSheet
            ps = ws.PageSetup

            # xlLandscape=2, xlPortrait=1
            orientation = 'Landscape' if ps.Orientation == 2 else 'Portrait'
            zoom_raw = None
            try:
                zoom_raw = int(ps.Zoom) if ps.Zoom else None
            except: pass

            fit_wide = None
            fit_tall = None
            try:
                fit_wide = int(ps.FitToPagesWide) if ps.FitToPagesWide else 0
                fit_tall = int(ps.FitToPagesTall) if ps.FitToPagesTall else 0
            except: pass

            h_breaks = 0
            v_breaks = 0
            try: h_breaks = ws.HPageBreaks.Count
            except: pass
            try: v_breaks = ws.VPageBreaks.Count
            except: pass

            result[0] = {
                'orientation': orientation,
                'zoom': zoom_raw,
                'fitToPagesWide': fit_wide,
                'fitToPagesTall': fit_tall,
                'hPageBreaks': h_breaks,
                'vPageBreaks': v_breaks,
            }
            wb.Close(False)
            xl.Quit()
        except Exception as e:
            result[1] = str(e)
            try: xl.Quit()
            except: pass
        finally:
            try:
                import pythoncom
                pythoncom.CoUninitialize()
            except: pass
            evt.set()

    t = threading.Thread(target=_run, daemon=True)
    t.start()
    evt.wait(20)
    if result[1]:
        raise RuntimeError(result[1])
    if result[0] is None:
        raise TimeoutError("Excel inspect timeout")
    return result[0]


def _excel_open_for_edit(xlsx_path, session_id):
    """
    Abre Excel visible en Page Break Preview.
    Monitorea en hilo separado; actualiza _excel_sessions[session_id] al cerrar.
    """
    def _monitor():
        try:
            import pythoncom, win32com.client
            pythoncom.CoInitialize()
            xl = win32com.client.DispatchEx('Excel.Application')
            xl.Visible = True
            xl.DisplayAlerts = False
            try:
                pvs = xl.Application.ProtectedViewSettings
                pvs.EnabledForFilesFromInternet = False
                pvs.EnabledForUnsafeLocations   = False
            except: pass

            wb = xl.Workbooks.Open(xlsx_path, ReadOnly=False, UpdateLinks=0)
            ws = wb.ActiveSheet
            # xlPageBreakPreview = 2
            try: ws.Activate(); xl.ActiveWindow.View = 2
            except: pass

            print(f"[Excel Edit] Sesión {session_id}: Excel abierto, esperando cierre...")

            # Polling hasta que el workbook desaparezca o Excel cierre
            while True:
                time.sleep(1.5)
                try:
                    _ = xl.Version       # si Excel cerró, lanza excepción
                    # Verificar si el workbook sigue abierto
                    names = [wb2.Name for wb2 in xl.Workbooks]
                    if not names:
                        break
                    if os.path.basename(xlsx_path) not in names:
                        break
                except:
                    break

            # Leer PageSetup actualizado antes de cerrar
            info_updated = None
            try:
                wb2 = None
                for w in xl.Workbooks:
                    if w.Name == os.path.basename(xlsx_path):
                        wb2 = w
                        break
                if wb2:
                    ps = wb2.ActiveSheet.PageSetup
                    orientation = 'Landscape' if ps.Orientation == 2 else 'Portrait'
                    zoom_raw = None
                    try: zoom_raw = int(ps.Zoom) if ps.Zoom else None
                    except: pass
                    fit_wide = 0; fit_tall = 0
                    try: fit_wide = int(ps.FitToPagesWide) if ps.FitToPagesWide else 0
                    except: pass
                    try: fit_tall = int(ps.FitToPagesTall) if ps.FitToPagesTall else 0
                    except: pass
                    h_breaks = 0; v_breaks = 0
                    try: h_breaks = wb2.ActiveSheet.HPageBreaks.Count
                    except: pass
                    try: v_breaks = wb2.ActiveSheet.VPageBreaks.Count
                    except: pass
                    info_updated = {
                        'orientation': orientation,
                        'zoom': zoom_raw,
                        'fitToPagesWide': fit_wide,
                        'fitToPagesTall': fit_tall,
                        'hPageBreaks': h_breaks,
                        'vPageBreaks': v_breaks,
                    }
                    wb2.Save()
                    wb2.Close(False)
            except: pass

            try: xl.Quit()
            except: pass

        except Exception as e:
            print(f"[Excel Edit] Sesión {session_id} error: {e}")
        finally:
            try:
                import pythoncom
                pythoncom.CoUninitialize()
            except: pass
            with _excel_sessions_lock:
                if session_id in _excel_sessions:
                    _excel_sessions[session_id]['status'] = 'closed'
                    if info_updated:
                        _excel_sessions[session_id]['info'] = info_updated
            print(f"[Excel Edit] Sesión {session_id}: cerrada")

    t = threading.Thread(target=_monitor, daemon=True)
    t.start()
    with _excel_sessions_lock:
        _excel_sessions[session_id] = {
            'status': 'open',
            'path': xlsx_path,
            'info': None,
            'thread': t,
        }

class AliothHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args): pass

    # UA antiguo → Google Fonts devuelve TTF en lugar de WOFF2
    GF_TTF_UA = 'curl/7.68.0'

    def _get_cors_origin(self):
        origin = self.headers.get('Origin', '')
        if origin in _ALLOWED_ORIGINS:
            return origin
        return f'http://127.0.0.1:{_ACTIVE_PORT}'

    def _is_app_referrer(self):
        referrer = self.headers.get('Referer', '')
        return any(referrer.startswith(origin + '/') for origin in _ALLOWED_ORIGINS)

    def _is_static_request(self):
        path = urllib.parse.urlparse(self.path).path
        if path in ('/', '/BASE.html', '/api/get-open-mode'):
            return True
        if path.startswith('/api/open-external-file') or path.startswith('/api/open-file-in-tab'):
            return True
        return os.path.splitext(path)[1].lower() in {
            '.html', '.js', '.css', '.ico', '.png', '.jpg', '.jpeg', '.webp',
            '.woff', '.woff2', '.ttf', '.wasm', '.whl', '.zip', '.json'
        }

    def _is_safe_path(self, fpath):
        """Valida que la ruta no apunte a directorios críticos del sistema y no contenga cruces no permitidos."""
        if not fpath or not isinstance(fpath, str):
            return False
        try:
            # Normalizar y obtener la ruta real absoluta
            norm = os.path.abspath(os.path.realpath(os.path.normpath(fpath)))
            
            # 1. Bloquear accesos a directorios críticos del sistema operativo
            windir = os.path.abspath(os.environ.get('WINDIR', r'C:\Windows'))
            progfiles = os.path.abspath(os.environ.get('ProgramFiles', r'C:\Program Files'))
            progfiles86 = os.path.abspath(os.environ.get('ProgramFiles(x86)', r'C:\Program Files (x86)'))
            progdata = os.path.abspath(os.environ.get('ProgramData', r'C:\ProgramData'))
            
            blocked_dirs = [windir, progfiles, progfiles86]
            for bd in blocked_dirs:
                try:
                    if os.path.commonpath([norm, bd]) == bd:
                        return False
                except Exception:
                    pass
            
            # 2. Bloquear accesos a las carpetas de inicio automático (Startup) para evitar inyección de scripts
            appdata = os.environ.get('APPDATA')
            if appdata:
                startup_user = os.path.abspath(os.path.join(appdata, r'Microsoft\Windows\Start Menu\Programs\Startup'))
                try:
                    if os.path.commonpath([norm, startup_user]) == startup_user:
                        return False
                except Exception:
                    pass
            
            try:
                startup_common = os.path.abspath(os.path.join(progdata, r'Microsoft\Windows\Start Menu\Programs\Startup'))
                if os.path.commonpath([norm, startup_common]) == startup_common:
                    return False
            except Exception:
                pass
            
            # 3. Evitar escribir scripts/ejecutables fuera del directorio de la aplicación
            ext = os.path.splitext(norm)[1].lower()
            if ext in ('.exe', '.dll', '.sys', '.bat', '.cmd', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.ps1', '.lnk'):
                app_dir = os.path.abspath(base_dir)
                try:
                    if os.path.commonpath([norm, app_dir]) != app_dir:
                        return False
                except Exception:
                    return False
        except Exception:
            return False
        return True

    def _check_origin(self):
        """Permite solo la interfaz local y los GET necesarios para el lanzador."""
        origin = self.headers.get('Origin', '')
        if origin in _ALLOWED_ORIGINS or self._is_app_referrer():
            return True
        if not origin and self.command == 'GET' and self._is_static_request():
            return True
        self._send_json(403, {'error': 'Origin not allowed'})
        return False

    def do_GET(self):
        if not self._check_origin():
            return
        font_path = urllib.parse.unquote(self.path.split('?')[0])
        if font_path.startswith('/fonts/standard_fonts/'):
            target = resolve_font(font_path.removeprefix('/fonts/standard_fonts/'), bundle_dir)
            if target is None:
                return self._send_error(404, 'Fuente no disponible')
            return self._send_raw(200, target.read_bytes(), 'font/ttf')
        if self.path.split('?')[0] == '/js/preferences.js':
            with open(os.path.join(bundle_dir, 'js', 'preferences.js'), encoding='utf-8') as script:
                source = script.read()
            seed = json.dumps(_USER_PREFERENCES.read(), ensure_ascii=True)
            body = ('window.__aliothPreferences=' + seed + ';\n' + source).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/javascript; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path.startswith('/api/window/'):
            return self._handle_window_api()
        if self.path.startswith('/api/browser-migration/'):
            return self._handle_browser_migration()
        if self.path.startswith('/api/diag-log'):
            return self._get_app_diag()
        if self.path == '/system/printers':
            return self._list_printers()
        if self.path == '/system/integration-status':
            return self._send_json(200, integration_status(base64.b64decode(ALIOTH_ROOT_CERT_BASE64), *_pdf_registration_target()))
        # Office software detection
        if self.path == '/office-software':
            info = detect_office_software()
            return self._send_json(200, info)

        # Excel: inspeccionar PageSetup de un archivo en sesión
        if self.path.startswith('/excel/inspect'):
            return self._excel_inspect()

        # Excel: estado de sesión de edición manual
        if self.path.startswith('/excel/edit-status'):
            return self._excel_edit_status()

        # Excel: cancelar/limpiar sesión (llamado en beforeunload)
        if self.path.startswith('/excel/cancel-edit'):
            return self._excel_cancel_edit()

        # Exponer configuración de Azure al frontend
        if self.path == '/azure-config':
            return self._send_json(200, {
                'configured': bool(AZURE_KEYS and AZURE_ENDPOINTS),
                'endpoint':   AZURE_ENDPOINTS[0] if AZURE_ENDPOINTS else '',
            })
        if self.path == '/api/secure-credentials/status':
            cfg = load_config()
            providers = ('gemini', 'groq', 'azure', 'fishaudio', 'mistral', 'huggingface', 'openrouter', 'nvidia')
            counts = {p: len(_config_keys(cfg, p)) for p in providers}
            return self._send_json(200, {'providers': {p: bool(counts[p]) for p in providers}, 'counts': counts})

        # Proxy para Google Fonts / gstatic (evita CORS en localhost)
        if self.path.startswith('/gfonts?'):
            return self._proxy_gfonts()
        if self.path.startswith('/gfonts-debug'):
            return self._gfonts_debug()
        if self.path.startswith('/api/tts/fishaudio/voices'):
            return self._fishaudio_voices()

        # Servir un PDF local por ruta absoluta (doble-clic desde Explorer)
        if self.path.startswith('/open-file'):
            return self._serve_local_pdf()

        # Event stream SSE para recibir apertura de pestañas en caliente
        if self.path.startswith('/api/tab-events'):
            return self._handle_tab_events()

        # Recargar todas las ventanas conectadas via SSE
        if self.path.startswith('/api/reload-all'):
            with _CLIENTS_LOCK:
                for q in _EVENT_QUEUES.values():
                    q.put({'action': 'reload', 'time': time.time()})
                count = len(_EVENT_QUEUES)
            return self._send_json(200, {'ok': True, 'reloaded_clients': count})

        # Evaluar código JS en clientes conectados via SSE
        if self.path.startswith('/api/eval-js'):
            query = urllib.parse.urlparse(self.path).query
            params = urllib.parse.parse_qs(query)
            code = params.get('code', [''])[0]
            with _CLIENTS_LOCK:
                for q in _EVENT_QUEUES.values():
                    q.put({'action': 'eval', 'code': code, 'time': time.time()})
                count = len(_EVENT_QUEUES)
            return self._send_json(200, {'ok': True, 'clients': count})

        # Reenviar archivo PDF a pestaña de ventana activa
        if self.path.startswith('/api/open-external-file') or self.path.startswith('/api/open-file-in-tab'):
            return self._handle_open_external_file()

        # Obtener modo de apertura configurado
        if self.path.startswith('/api/get-open-mode'):
            return self._handle_get_open_mode()

        # Transferencia de documentos y páginas entre ventanas
        if self.path.startswith('/transfer-payload'):
            return self._handle_get_transfer_payload()

        raw_path = self.path.split('?')[0].lstrip('/')
        path = urllib.parse.unquote(raw_path)
        if not path:
            path = 'BASE.html'

        target = None
        for d in [exe_dir, bundle_dir]:
            cand = os.path.join(d, path)
            root = os.path.abspath(d)
            if os.path.commonpath([root, os.path.abspath(cand)]) != root:
                continue
            if os.path.exists(cand) and os.path.isfile(cand):
                target = cand
                break
            elif os.path.exists(cand + '.html') and os.path.isfile(cand + '.html'):
                target = cand + '.html'
                break

        if not target:
            return self._send_error(404, f'No se encontro el archivo: {path}')

        ctype, _ = mimetypes.guess_type(target)
        with open(target, 'rb') as f:
            content = f.read()

        # Las claves nunca se exponen al navegador.
        if target.lower().endswith('.html') and b'__GROQ_KEYS_INJECTED__' in content:
            content = content.replace(b'__GROQ_KEYS_INJECTED__', b'[]')

        self._send_raw(200, content, ctype or 'text/html')

    def _convert_office(self):
        global _office_software_cache
        software_info = detect_office_software()
        if not software_info.get("software"):
            return self._send_json(503, {"error": "No se detectó software de ofimatica instalado"})

        # Leer multipart: Content-Type: multipart/form-data; boundary=...
        ctype = self.headers.get('Content-Type', '')
        if 'multipart/form-data' not in ctype:
            return self._send_error(400, "Se esperaba multipart/form-data")

        boundary = None
        for part in ctype.split(';'):
            part = part.strip()
            if part.startswith('boundary='):
                boundary = part[9:].strip('"').encode()
                break
        if not boundary:
            return self._send_error(400, "Falta boundary en multipart")

        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length)

        # Parsear multipart manualmente
        file_data = None
        filename = "document"
        delimiter = b'--' + boundary
        parts = body.split(delimiter)
        for p in parts:
            if b'Content-Disposition' not in p:
                continue
            header_end = p.find(b'\r\n\r\n')
            if header_end == -1:
                continue
            headers_raw = p[:header_end].decode(errors='replace')
            content = p[header_end + 4:]
            if content.endswith(b'\r\n'):
                content = content[:-2]
            if 'name="file"' in headers_raw:
                file_data = content
                # Extraer filename
                for h in headers_raw.split(';'):
                    h = h.strip()
                    if h.startswith('filename='):
                        filename = h[9:].strip('"')
                break

        if not file_data:
            return self._send_error(400, "No se recibió campo 'file'")

        # Leer parámetros opcionales de PageSetup (solo para xlsx)
        pagesetup_params = {}
        for p in parts:
            if b'Content-Disposition' not in p:
                continue
            header_end = p.find(b'\r\n\r\n')
            if header_end == -1:
                continue
            headers_raw = p[:header_end].decode(errors='replace')
            content = p[header_end + 4:]
            if content.endswith(b'\r\n'):
                content = content[:-2]
            for key in ('orientation', 'fitWide', 'fitTall', 'zoom', 'paperSize'):
                if f'name="{key}"' in headers_raw:
                    pagesetup_params[key] = content.decode(errors='replace').strip()

        tmp_dir = None
        try:
            # Usar carpeta temporal dentro del proyecto — COM de MS Office falla con rutas del sistema
            tmp_base = os.path.join(base_dir, '_tmp_office')
            os.makedirs(tmp_base, exist_ok=True)
            tmp_dir = tempfile.mkdtemp(prefix="conv_", dir=tmp_base)
            ext = os.path.splitext(filename)[1].lower()
            print(f'[Office] filename="{filename}" ext="{ext}" data_size={len(file_data)}')

            # Extensiones reales de Office
            VALID_EXTS = {'.docx','.doc','.docm','.dotx','.dotm','.odt','.rtf',
                          '.xlsx','.xls','.xlsm','.xlsb','.ods','.csv',
                          '.pptx','.ppt','.pptm','.ppsx','.odp'}

            # Si la extensión no es válida, detectar por magic bytes
            if ext not in VALID_EXTS:
                print(f'[Office] Extensión "{ext}" no reconocida — detectando por magic bytes')
                ext = _detect_office_ext(file_data, filename)
                print(f'[Office] Extensión detectada: "{ext}"')

            input_path  = os.path.normpath(os.path.join(tmp_dir, "input" + ext))
            output_path = os.path.normpath(os.path.join(tmp_dir, "output.pdf"))
            print(f'[Office] input_path="{input_path}" output_path="{output_path}"')

            with open(input_path, 'wb') as f:
                f.write(file_data)

            convert_office_to_pdf(input_path, output_path, software_info, timeout=180,
                                  pagesetup_params=pagesetup_params if ext in ('.xlsx','.xls','.xlsm','.xlsb') else None)

            with open(output_path, 'rb') as f:
                pdf_bytes = f.read()

            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', self._get_cors_origin())
            self.send_header('Content-Type', 'application/pdf')
            self.send_header('Content-Length', str(len(pdf_bytes)))
            self.send_header('X-Converted-By', software_info.get('name', ''))
            self.end_headers()
            self.wfile.write(pdf_bytes)

        except TimeoutError as e:
            # Invalidar cache para re-detectar en siguiente intento
            _office_software_cache = None
            self._send_json(504, {"error": str(e)})
        except Exception as e:
            print(f"[Office] Error conversión: {e}")
            self._send_json(500, {"error": str(e)})
        finally:
            if tmp_dir and os.path.exists(tmp_dir):
                shutil.rmtree(tmp_dir, ignore_errors=True)

    def _convert_pdf_to_office(self, target):
        """Convierte el PDF actual sin exponer rutas locales."""
        ctype = self.headers.get('Content-Type', '')
        if 'multipart/form-data' not in ctype:
            return self._send_error(400, 'Se esperaba multipart/form-data')
        boundary = next((p.strip()[9:].strip('"').encode() for p in ctype.split(';') if p.strip().startswith('boundary=')), None)
        if not boundary:
            return self._send_error(400, 'Falta boundary en multipart')
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        file_data = None
        for part in body.split(b'--' + boundary):
            if b'Content-Disposition' not in part or b'name="file"' not in part:
                continue
            header_end = part.find(b'\r\n\r\n')
            if header_end >= 0:
                file_data = part[header_end + 4:].rstrip(b'\r\n')
                break
        if not file_data or not file_data.startswith(b'%PDF'):
            return self._send_error(400, 'No se recibió un PDF válido')
        tmp_dir = None
        try:
            tmp_base = os.path.join(base_dir, '_tmp_office')
            os.makedirs(tmp_base, exist_ok=True)
            tmp_dir = tempfile.mkdtemp(prefix=f'pdf_{target}_', dir=tmp_base)
            extension, mime = {
                'word': ('docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
                'word-ai': ('docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
                'excel': ('xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
                'excel-ai': ('xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
                'pptx': ('pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'),
                'pptx-ai': ('pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'),
            }[target]
            input_path, output_path = os.path.join(tmp_dir, 'input.pdf'), os.path.join(tmp_dir, 'output.' + extension)
            with open(input_path, 'wb') as f: f.write(file_data)
            if target == 'word': convert_pdf_to_docx(input_path, output_path)
            elif target == 'word-ai': convert_pdf_to_docx_ai(input_path, output_path)
            elif target == 'excel': convert_pdf_to_xlsx(input_path, output_path)
            elif target == 'excel-ai': convert_pdf_to_xlsx_ai(input_path, output_path)
            elif target == 'pptx-ai': convert_pdf_to_pptx_ai(input_path, output_path)
            else: convert_pdf_to_pptx(input_path, output_path)
            with open(output_path, 'rb') as f: output = f.read()
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', self._get_cors_origin())
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(len(output)))
            self.end_headers()
            self.wfile.write(output)
        except Exception as e:
            print(f'[Office] PDF→{target} error: {e}')
            self._send_json(500, {'error': str(e)})
        finally:
            if tmp_dir and os.path.exists(tmp_dir): shutil.rmtree(tmp_dir, ignore_errors=True)

    def _list_printers(self):
        try:
            import win32print
            from pywintypes import error as PrinterError
            flags = win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS
            names = sorted({printer[2] for printer in win32print.EnumPrinters(flags, None, 1)}, key=str.casefold)
            try:
                default = win32print.GetDefaultPrinter()
            except PrinterError:
                default = ''
            return self._send_json(200, {'printers': names, 'default': default})
        except Exception as exc:
            print(f'[Print] Error al listar impresoras: {exc}')
            return self._send_error(500, 'No se pudieron cargar las impresoras')

    def _print_direct(self):
        """POST /system/print — imprime imágenes locales sin abrir el diálogo del navegador."""
        try:
            payload = json.loads(self._read_body().decode('utf-8'))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return self._send_error(400, 'Solicitud de impresión inválida')

        printer_name = payload.get('printer', '')
        if not isinstance(printer_name, str):
            return self._send_error(400, 'Impresora inválida')

        pages = payload.get('pages')
        if not isinstance(pages, list) or not pages or len(pages) > 999:
            return self._send_error(400, 'Selecciona entre 1 y 999 páginas')

        layout = payload.get('layout') if isinstance(payload.get('layout'), dict) else {}
        paper_sizes = {
            'A4': 'DMPAPER_A4', 'letter': 'DMPAPER_LETTER', 'legal': 'DMPAPER_LEGAL',
            'A3': 'DMPAPER_A3', 'A5': 'DMPAPER_A5',
        }
        paper = layout.get('paper', 'A4')
        orientation = layout.get('orientation', 'portrait')
        scale = layout.get('scale', 'fit')
        margins = layout.get('margins', [10, 10, 10, 10])
        copies = layout.get('copies', 1)
        if paper not in paper_sizes or orientation not in ('portrait', 'landscape'):
            return self._send_error(400, 'Configuración de papel inválida')
        if scale != 'fit' and scale not in (50, 75, 100, 125, 150):
            return self._send_error(400, 'Escala de impresión inválida')
        if not isinstance(copies, int) or not 1 <= copies <= 99:
            return self._send_error(400, 'Número de copias inválido')
        if not isinstance(margins, list) or len(margins) != 4:
            return self._send_error(400, 'Márgenes inválidos')
        try:
            margins = [float(value) for value in margins]
        except (TypeError, ValueError):
            return self._send_error(400, 'Márgenes inválidos')
        if any(value < 0 or value > 80 for value in margins):
            return self._send_error(400, 'Los márgenes deben estar entre 0 y 80 mm')

        try:
            from io import BytesIO
            from PIL import Image
            image_bytes = []
            for page in pages:
                if not isinstance(page, str):
                    raise ValueError('Página inválida')
                encoded = page.split(',', 1)[-1]
                raw = base64.b64decode(encoded, validate=True)
                if not raw or len(raw) > 25 * 1024 * 1024:
                    raise ValueError('Página demasiado grande')
                with Image.open(BytesIO(raw)) as image:
                    if image.format not in ('JPEG', 'PNG') or image.width * image.height > 80_000_000:
                        raise ValueError('Formato de página inválido')
                image_bytes.append(raw)
        except Exception as exc:
            return self._send_error(400, f'No se pudo preparar la página: {exc}')

        printer_dc = None
        printer_handle = None
        doc_started = False
        try:
            import win32con
            import win32gui
            import win32print
            import win32ui
            from PIL import Image, ImageWin

            printer_name = printer_name or win32print.GetDefaultPrinter()
            printer_handle = win32print.OpenPrinter(printer_name)
            devmode = win32print.GetPrinter(printer_handle, 2).get('pDevMode')
            if not devmode:
                raise RuntimeError('No se pudo leer la configuración de la impresora')
            devmode.PaperSize = getattr(win32con, paper_sizes[paper])
            devmode.Orientation = win32con.DMORIENT_LANDSCAPE if orientation == 'landscape' else win32con.DMORIENT_PORTRAIT

            hdc = win32gui.CreateDC('WINSPOOL', printer_name, None)
            hdc = win32gui.ResetDC(hdc, devmode)
            printer_dc = win32ui.CreateDCFromHandle(hdc)
            printable_width = printer_dc.GetDeviceCaps(win32con.HORZRES)
            printable_height = printer_dc.GetDeviceCaps(win32con.VERTRES)
            dpi_x = printer_dc.GetDeviceCaps(win32con.LOGPIXELSX)
            dpi_y = printer_dc.GetDeviceCaps(win32con.LOGPIXELSY)
            if min(printable_width, printable_height, dpi_x, dpi_y) <= 0:
                raise RuntimeError('La impresora no informó un área imprimible')

            left, top, right, bottom = margins
            x = round(left / 25.4 * dpi_x)
            y = round(top / 25.4 * dpi_y)
            available_width = printable_width - x - round(right / 25.4 * dpi_x)
            available_height = printable_height - y - round(bottom / 25.4 * dpi_y)
            if available_width < 1 or available_height < 1:
                raise RuntimeError('Los márgenes dejan el área imprimible vacía')

            printer_dc.StartDoc('Alioth PDF')
            doc_started = True
            for _copy in range(copies):
                for raw in image_bytes:
                    with Image.open(BytesIO(raw)) as source:
                        image = source.convert('RGB')
                    if scale == 'fit':
                        factor = min(available_width / image.width, available_height / image.height)
                    else:
                        factor = (dpi_x / 144.0) * (scale / 100.0)
                    draw_width = max(1, round(image.width * factor))
                    draw_height = max(1, round(image.height * factor))
                    draw_x = x + round((available_width - draw_width) / 2)
                    draw_y = y + round((available_height - draw_height) / 2)
                    printer_dc.StartPage()
                    ImageWin.Dib(image).draw(printer_dc.GetHandleOutput(), (draw_x, draw_y, draw_x + draw_width, draw_y + draw_height))
                    printer_dc.EndPage()
            printer_dc.EndDoc()
            doc_started = False
            return self._send_json(200, {'ok': True, 'printer': printer_name, 'pages': len(image_bytes) * copies})
        except Exception as exc:
            if doc_started:
                try: printer_dc.AbortDoc()
                except Exception: pass
            print(f'[Print] Error: {exc}')
            return self._send_error(500, f'No se pudo enviar a la impresora: {exc}')
        finally:
            if printer_dc:
                try: printer_dc.DeleteDC()
                except Exception: pass
            if printer_handle:
                try: win32print.ClosePrinter(printer_handle)
                except Exception: pass

    def _proxy_gfonts(self):
        """Proxy para Google Fonts. Descarga CSS con UA antiguo (→TTF), luego el archivo TTF.
        Cachea en disco en fonts_cache/. GET /gfonts?family=Montserrat&weight=700&italic=0"""
        import re as _re, os as _os
        from urllib.parse import parse_qs as _pqs
        raw_qs = self.path.split('?', 1)[1]
        params = _pqs(raw_qs)
        family  = params.get('family',  [''])[0].strip()
        weight  = params.get('weight',  ['400'])[0].strip()
        italic  = params.get('italic',  ['0'])[0].strip()
        if not family:
            return self._send_error(400, 'Falta parametro family')

        # Cache en disco
        cache_dir = _os.path.join(base_dir, 'fonts_cache')
        _os.makedirs(cache_dir, exist_ok=True)
        safe_name = family.replace(' ', '_').replace(',', '_')
        cache_file = _os.path.join(cache_dir, f'{safe_name}_{weight}_i{italic}.ttf')

        if _os.path.exists(cache_file):
            with open(cache_file, 'rb') as f:
                body = f.read()
            # Verificar magic — descartar si es WOFF2 o corrupto
            if body[:4] in (b'\x00\x01\x00\x00', b'OTTO') or body[:4] == b'true':
                print(f'[GFonts] Cache hit TTF: {cache_file}')
                return self._send_raw(200, body, 'font/ttf')
            else:
                print(f'[GFonts] Cache corrupto magic={body[:4].hex()} — re-descargando')
                _os.remove(cache_file)

        # Construir URL CSS API v2 con UA antiguo → GF devuelve TTF
        variant = f'ital,wght@{italic},{weight}'
        family_param = family.replace(' ', '+') + ':' + variant
        css_url = f'https://fonts.googleapis.com/css2?family={family_param}&display=swap'
        print(f'[GFonts] Fetching CSS: {css_url}')

        # Probar varios UAs hasta conseguir TTF
        UAS = [
            'curl/7.68.0',
            'curl/7.54.0',
            'Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1)',
            UA_BROWSER,
        ]
        body = None
        font_url = None
        for ua in UAS:
            try:
                req = urllib.request.Request(css_url)
                req.add_header('User-Agent', ua)
                with urllib.request.urlopen(req, timeout=12, context=_SSL_CTX) as resp:
                    css = resp.read().decode('utf-8')
                print(f'[GFonts] UA={ua[:40]} CSS={css[:200]}')
                # Preferir TTF, aceptar cualquier formato
                m = _re.search(r"url\((https://fonts\.gstatic\.com/[^)]+\.ttf)\)", css)
                if not m:
                    m = _re.search(r"url\((https://fonts\.gstatic\.com/[^)]+\.(?:woff(?!2)|otf))\)", css)
                if not m:
                    m = _re.search(r"url\((https://fonts\.gstatic\.com/[^)]+)\)", css)
                if m:
                    font_url = m.group(1)
                    print(f'[GFonts] font_url={font_url} (UA={ua[:40]})')
                    freq = urllib.request.Request(font_url)
                    freq.add_header('User-Agent', ua)
                    with urllib.request.urlopen(freq, timeout=20, context=_SSL_CTX) as fr:
                        body = fr.read()
                    magic = body[:4]
                    print(f'[GFonts] Font {len(body)}B magic={magic.hex()}')
                    # Si TTF u OTF: usar
                    if magic in (b'\x00\x01\x00\x00', b'OTTO') or magic[:4] == b'true':
                        print(f'[GFonts] TTF/OTF confirmado')
                        break
                    # Si WOFF2: seguir intentando con otro UA
                    elif magic[:4] == b'wOF2':
                        print(f'[GFonts] WOFF2 — probando siguiente UA')
                        body = None
                        continue
                    else:
                        print(f'[GFonts] magic desconocido={magic.hex()} — aceptando de todas formas')
                        break
                else:
                    print(f'[GFonts] No font URL in CSS con UA={ua[:40]}')
            except urllib.error.HTTPError as e:
                print(f'[GFonts] HTTPError {e.code} con UA={ua[:40]}')
                body = None
            except Exception as e:
                print(f'[GFonts] Error con UA={ua[:40]}: {e}')
                body = None

        if not body:
            return self._send_error(404, 'No se pudo descargar fuente de Google Fonts')

        # Cachear
        with open(cache_file, 'wb') as f:
            f.write(body)
        print(f'[GFonts] Cached: {cache_file}')
        self._send_raw(200, body, 'font/ttf')

    def do_OPTIONS(self):
        if not self._check_origin():
            return
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', self._get_cors_origin())
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-Alioth-Client-Id')
        self.send_header('Access-Control-Max-Age', '86400')
        self.end_headers()

    def do_POST(self):
        if not self._check_origin():
            return
        try:
            if int(self.headers.get('Content-Length', 0)) > MAX_REQUEST_BODY_BYTES:
                return self._send_error(413, 'La carga excede el límite de 100 MB')
            path_lower = self.path.lower()
            if self.path == '/api/activate-window':
                data = json.loads(self._read_body())
                if not isinstance(data, dict) or set(data) - {'path', 'queued'} or type(data.get('queued', False)) is not bool:
                    return self._send_json(400, {'ok': False})
                file_path = data.get('path')
                if file_path is not None and (not isinstance(file_path, str) or len(file_path) > 32767
                        or not file_path.lower().endswith('.pdf') or not self._is_safe_path(file_path)):
                    return self._send_json(400, {'ok': False})
                request_local_window(file_path, data.get('queued', False))
                return self._send_json(200, {'ok': True})
            if self.path == '/api/native-host/ready':
                data = json.loads(self._read_body())
                return self._send_json(200, {'ok': notify_ready(data.get('token'))})
            if self.path.startswith('/api/browser-migration/'):
                return self._handle_browser_migration()
            if self.path == '/api/preferences':
                try:
                    _USER_PREFERENCES.update(json.loads(self._read_body()))
                except (ValueError, TypeError):
                    return self._send_json(400, {'ok': False, 'error': 'INVALID_PREFERENCES'})
                return self._send_json(200, {'ok': True})
            if self.path == '/save-config':
                return self._save_config()
            if self.path == '/api/secure-credentials':
                return self._save_secure_credential()
            if self.path == '/api/secure-credentials/delete':
                return self._delete_secure_credential()
            if self.path == '/api/ai/generate-json':
                return self._generate_ai_json()
            if self.path == '/api/diag-log':
                return self._record_app_diag()
            if self.path == '/api/translation/metrics':
                return self._record_translation_metric()
            if self.path == '/api/translation/checkpoint':
                return self._translation_checkpoint()
            if self.path in ('/api/pdf/translation', '/api/pdf/translation/v2'):
                return self._translate_pdf()
            if self.path == '/api/pdf/text':
                return self._extract_pdf_text()
            if self.path == '/api/files/pick-save':
                return self._pick_native_save_target()
            if self.path == '/api/files/pick-open':
                return self._pick_native_open_target()
            if self.path == '/api/files/resolve-path':
                return self._resolve_file_path()
            if self.path == '/api/files/save/opened':
                return self._grant_opened_save_target()
            if self.path == '/api/files/save/renew':
                return self._renew_native_save_target()
            if self.path == '/api/files/save/begin':
                return self._begin_native_save()
            if self.path.startswith('/api/files/save/chunk?'):
                return self._write_native_save_chunk()
            if self.path == '/api/files/save/commit':
                return self._commit_native_save()
            if self.path == '/api/files/save/status':
                return self._get_native_save_status()
            if self.path == '/api/files/save/abort':
                return self._abort_native_save()
            if self.path == '/api/files/reveal':
                return self._reveal_file_in_explorer()
            if self.path == '/convert-office':
                return self._convert_office()
            if self.path == '/convert-pdf-to-word':
                return self._convert_pdf_to_office('word')
            if self.path == '/convert-pdf-to-word-ai':
                return self._convert_pdf_to_office('word-ai')
            if self.path == '/convert-pdf-to-excel':
                return self._convert_pdf_to_office('excel')
            if self.path == '/convert-pdf-to-excel-ai':
                return self._convert_pdf_to_office('excel-ai')
            if self.path == '/convert-pdf-to-pptx':
                return self._convert_pdf_to_office('pptx')
            if self.path == '/convert-pdf-to-pptx-ai':
                return self._convert_pdf_to_office('pptx-ai')
            if self.path == '/system/print':
                return self._print_direct()
            elif self.path == '/excel/open-for-edit':
                return self._excel_open_edit()
            elif self.path == '/excel/inspect-upload':
                return self._excel_inspect_upload()
            elif self.path == '/excel/browse':
                return self._excel_browse()
            elif self.path == '/excel/save-dialog':
                return self._excel_save_dialog()
            elif self.path == '/excel/write-direct':
                return self._excel_write_direct()
            elif self.path == '/excel/read-file':
                return self._excel_read_file()
            elif self.path == '/excel/sheets':
                return self._excel_sheets_handler()
            elif self.path == '/excel/write-openpyxl':
                return self._excel_write_openpyxl_handler()
            elif '/v1beta/' in path_lower or 'gemini' in path_lower:
                self._proxy_gemini()
            elif '/groq/' in path_lower:
                self._proxy_groq()
            elif self.path == '/data-extract/azure':
                return self._data_extract_azure()
            elif self.path == '/data-extract/multi':
                return self._data_extract_multi()
            elif self.path.startswith('/api/tts/fishaudio/voices'):
                return self._fishaudio_voices()
            elif self.path == '/api/tts/fishaudio/synthesize':
                return self._fishaudio_synthesize()
            elif self.path.startswith('/api/window/'):
                return self._handle_window_api()
            elif self.path == '/api/client-focus':
                return self._handle_client_focus()
            elif self.path.startswith('/api/open-external-file') or self.path == '/api/open-file-in-tab':
                return self._handle_open_external_file()
            elif self.path == '/system/associate-pdf':
                return self._associate_pdf_handler()
            elif self.path.startswith('/transfer-payload'):
                return self._handle_save_transfer_payload()
            else:
                self._send_error(404, 'Endpoint no soportado')
        except Exception as e:
            print(f"[Proxy POST Error] {self.path}: {e}")
            try:
                self._send_json(500, {'error': str(e)})
            except Exception:
                pass

    def _native_save_session(self):
        session_id = self.headers.get('X-Alioth-Client-Id', '').strip()
        if not session_id or len(session_id) > 160:
            return None
        with _CLIENTS_LOCK:
            return session_id if session_id in _EVENT_QUEUES else None

    def _pick_native_save_target(self):
        session_id = self._native_save_session()
        if not session_id:
            return self._send_json(403, {'ok': False, 'error': 'SESSION_UNAVAILABLE'})
        try:
            body = self._read_body()
            payload = json.loads(body.decode('utf-8')) if body else {}
            suggested_name = payload.get('suggested_name', 'documento.pdf')
            if not isinstance(suggested_name, str) or len(suggested_name) > 255:
                return self._send_json(400, {'ok': False, 'error': 'INVALID_SUGGESTED_NAME'})
            source_path = payload.get('source_path')
            initial_dir = None
            if isinstance(source_path, str) and len(source_path) <= 32767 and self._is_safe_path(source_path):
                parent = os.path.dirname(os.path.abspath(source_path))
                if os.path.isdir(parent):
                    initial_dir = parent
            result = (_NATIVE_FILE_DIALOG.request_save(suggested_name, initial_dir=initial_dir)
                      if initial_dir else _NATIVE_FILE_DIALOG.request_save(suggested_name))
        except DialogBusyError:
            return self._send_json(409, {'ok': False, 'error': 'DIALOG_BUSY'})
        except (OSError, ValueError) as error:
            return self._send_json(400, {'ok': False, 'error': str(error)})
        if result.cancelled:
            return self._send_json(200, {'ok': True, 'cancelled': True})
        if self._native_save_session() != session_id:
            return self._send_json(409, {'ok': False, 'error': 'SESSION_CLOSED'})
        mode = payload.get('mode', 'save-as')
        if mode not in {'save-as', 'copy'}:
            return self._send_json(400, {'ok': False, 'error': 'INVALID_SAVE_MODE'})
        grant = _NATIVE_SAVE_STORE.issue_grant(session_id, result.path, mode)
        return self._send_json(200, {
            'ok': True,
            'cancelled': False,
            'token': grant.token,
            'identity': grant.identity,
            'fingerprint': grant.fingerprint,
            'expires_at': grant.expires_at,
        })

    def _pick_native_open_target(self):
        try:
            body = self._read_body()
            payload = json.loads(body.decode('utf-8')) if body else {}
            title = payload.get('title')
            filter_str = payload.get('filter')
            result = _NATIVE_FILE_DIALOG.request_open(title=title, filter_str=filter_str)
        except DialogBusyError:
            return self._send_json(409, {'ok': False, 'error': 'DIALOG_BUSY'})
        except Exception as error:
            return self._send_json(400, {'ok': False, 'error': str(error)})
        if result.cancelled or not result.path:
            return self._send_json(200, {'ok': True, 'cancelled': True})
        return self._send_json(200, {
            'ok': True,
            'cancelled': False,
            'path': str(result.path)
        })

    def _resolve_file_path(self):
        try:
            body = self._read_body()
            payload = json.loads(body.decode('utf-8')) if body else {}
            if not isinstance(payload, dict):
                return self._send_json(400, {'ok': False, 'error': 'INVALID_FILE_ORIGIN'})
            name = payload.get('name')
            size, digest = payload.get('size'), payload.get('sha256')
            if (not isinstance(name, str) or not name or os.path.basename(name) != name or type(size) is not int or size < 0 or
                    not isinstance(digest, str) or not re.fullmatch(r'[0-9a-fA-F]{64}', digest)):
                return self._send_json(400, {'ok': False, 'error': 'INVALID_FILE_ORIGIN'})
            try:
                candidates = explorer_paths(name)
            except Exception:
                candidates = []
            user_dirs = [
                os.path.expanduser('~\\Desktop'),
                os.path.expanduser('~\\Downloads'),
                os.path.expanduser('~\\Documents'),
                os.path.join(os.path.expanduser('~'), 'OneDrive - SODEXO', 'Escritorio'),
                os.path.join(os.path.expanduser('~'), 'OneDrive - SODEXO'),
                os.path.join(os.path.expanduser('~'), 'OneDrive'),
                r'C:\PDF TOOL'
            ]
            candidates.extend(os.path.join(directory, name) for directory in user_dirs)
            path = resolve_file_origin(name, size, digest, [candidate for candidate in candidates if self._is_safe_path(candidate)])
            if path:
                return self._send_json(200, {'ok': True, 'path': path})
            return self._send_json(200, {'ok': False, 'error': 'PATH_NOT_RESOLVED'})
        except Exception as e:
            return self._send_json(500, {'ok': False, 'error': str(e)})

    def _grant_opened_save_target(self):
        session_id = self._native_save_session()
        if not session_id:
            return self._send_json(403, {'ok': False, 'error': 'SESSION_UNAVAILABLE'})
        try:
            body = self._read_body()
            payload = json.loads(body.decode('utf-8')) if body else {}
            source_path = payload.get('path')
            if not isinstance(source_path, str) or len(source_path) > 32767:
                return self._send_json(400, {'ok': False, 'error': 'INVALID_SOURCE_PATH'})
            source_path = os.path.normpath(source_path)
            if not self._is_safe_path(source_path) or not os.path.isfile(source_path) or os.path.splitext(source_path)[1].lower() != '.pdf':
                return self._send_json(404, {'ok': False, 'error': 'SOURCE_PDF_UNAVAILABLE'})
            grant = _NATIVE_SAVE_STORE.issue_grant(session_id, source_path, 'save')
            return self._send_json(200, {
                'ok': True,
                'token': grant.token,
                'identity': grant.identity,
                'fingerprint': grant.fingerprint,
                'expires_at': grant.expires_at,
            })
        except (OSError, ValueError) as error:
            return self._send_json(400, {'ok': False, 'error': str(error)})

    def _renew_native_save_target(self):
        session_id = self._native_save_session()
        if not session_id:
            return self._send_json(403, {'ok': False, 'error': 'SESSION_UNAVAILABLE'})
        try:
            payload = json.loads(self._read_body().decode('utf-8'))
            grant = _NATIVE_SAVE_STORE.renew_grant(session_id, payload.get('token', ''))
            return self._send_json(200, {'ok': True, 'token': grant.token, 'identity': grant.identity,
                                         'fingerprint': grant.fingerprint, 'expires_at': grant.expires_at})
        except (PermissionError, TypeError, ValueError):
            return self._send_json(403, {'ok': False, 'error': 'SAVE_TOKEN_UNAVAILABLE'})

    def _begin_native_save(self):
        session_id = self._native_save_session()
        if not session_id:
            return self._send_json(403, {'ok': False, 'error': 'SESSION_UNAVAILABLE'})
        try:
            body = self._read_body()
            payload = json.loads(body.decode('utf-8')) if body else {}
            upload = _NATIVE_SAVE_STORE.begin_save(
                session_id,
                payload.get('token', ''),
                payload.get('operation_id', ''),
                payload.get('length'),
                payload.get('sha256', ''),
                payload.get('expected_fingerprint'),
                payload.get('redaction_verification'),
            )
            return self._send_json(200, {'ok': True, 'upload_id': upload.upload_id, 'status': upload.status, 'redaction_verification': bool(upload.redaction_verification)})
        except PermissionError:
            return self._send_json(403, {'ok': False, 'error': 'SAVE_TOKEN_UNAVAILABLE'})
        except (TypeError, ValueError) as error:
            print(f'[NativeSave] begin rejected: {type(error).__name__}: {error}')
            return self._send_json(400, {'ok': False, 'error': str(error)})

    def _write_native_save_chunk(self):
        session_id = self._native_save_session()
        if not session_id:
            return self._send_json(403, {'ok': False, 'error': 'SESSION_UNAVAILABLE'})
        try:
            parsed = urllib.parse.urlparse(self.path)
            query = urllib.parse.parse_qs(parsed.query)
            upload_id = query.get('upload_id', [''])[0]
            index = int(query.get('index', [''])[0])
            offset = int(query.get('offset', [''])[0])
            if int(self.headers.get('Content-Length', 0)) > 4 * 1024 * 1024:
                return self._send_json(413, {'ok': False, 'error': 'CHUNK_TOO_LARGE'})
            data = self._read_body()
            _NATIVE_SAVE_STORE.write_chunk(session_id, upload_id, index, offset, data)
            upload = _NATIVE_SAVE_STORE._uploads[upload_id]
            return self._send_json(200, {'ok': True, 'received': upload.received})
        except PermissionError:
            return self._send_json(403, {'ok': False, 'error': 'UPLOAD_UNAVAILABLE'})
        except (TypeError, ValueError) as error:
            return self._send_json(400, {'ok': False, 'error': str(error)})

    def _commit_native_save(self):
        session_id = self._native_save_session()
        if not session_id:
            return self._send_json(403, {'ok': False, 'error': 'SESSION_UNAVAILABLE'})
        try:
            body = self._read_body()
            payload = json.loads(body.decode('utf-8')) if body else {}
            result = _NATIVE_SAVE_STORE.commit_save(session_id, payload.get('upload_id', ''), payload.get('operation_id', ''))
            return self._send_json(200, {'ok': True, **result})
        except PermissionError:
            return self._send_json(403, {'ok': False, 'error': 'UPLOAD_UNAVAILABLE'})
        except FileExistsError:
            return self._send_json(409, {'ok': False, 'error': 'DESTINATION_CHANGED'})
        except (TypeError, ValueError) as error:
            return self._send_json(400, {'ok': False, 'error': str(error)})

    def _get_native_save_status(self):
        session_id = self._native_save_session()
        if not session_id:
            return self._send_json(403, {'ok': False, 'error': 'SESSION_UNAVAILABLE'})
        try:
            body = self._read_body()
            payload = json.loads(body.decode('utf-8')) if body else {}
            return self._send_json(200, {'ok': True, **_NATIVE_SAVE_STORE.get_save_status(session_id, payload.get('operation_id', ''))})
        except PermissionError:
            return self._send_json(403, {'ok': False, 'error': 'OPERATION_UNAVAILABLE'})

    def _abort_native_save(self):
        session_id = self._native_save_session()
        if not session_id:
            return self._send_json(403, {'ok': False, 'error': 'SESSION_UNAVAILABLE'})
        try:
            body = self._read_body()
            payload = json.loads(body.decode('utf-8')) if body else {}
            return self._send_json(200, {'ok': True, **_NATIVE_SAVE_STORE.abort_save(session_id, payload.get('upload_id', ''))})
        except PermissionError:
            return self._send_json(403, {'ok': False, 'error': 'UPLOAD_UNAVAILABLE'})

    def _reveal_file_in_explorer(self):
        try:
            body = self._read_body()
            payload = json.loads(body.decode('utf-8')) if body else {}
            target_path = payload.get('path', '').strip()
            if not target_path or not os.path.exists(target_path):
                return self._send_json(404, {'ok': False, 'error': 'FILE_NOT_FOUND'})
            norm_path = os.path.abspath(target_path)
            subprocess.Popen(['explorer.exe', f'/select,{norm_path}'])
            return self._send_json(200, {'ok': True, 'path': norm_path})
        except Exception as e:
            return self._send_json(500, {'ok': False, 'error': str(e)})

    def _save_secure_credential(self):
        try:
            data = json.loads(self._read_body())
            provider = data.get('provider', '').strip().lower()
            key = data.get('key', '').strip()
            endpoint = data.get('endpoint', '').strip()
            allowed = {'gemini', 'groq', 'azure', 'fishaudio', 'mistral', 'huggingface', 'openrouter', 'nvidia'}
            if provider not in allowed or not key:
                return self._send_error(400, 'Proveedor o clave inválidos')
            cfg = load_config()
            if not cfg.has_section(provider): cfg.add_section(provider)
            existing = _config_keys(cfg, provider)
            if key in existing:
                return self._send_json(200, {'ok': True, 'count': len(existing), 'duplicate': True})
            indexes = [int(k.rsplit('_', 1)[-1]) for k, _ in cfg.items(provider) if k.startswith('api_key_') and k.rsplit('_', 1)[-1].isdigit()]
            index = max(indexes, default=0) + 1
            cfg.set(provider, f'api_key_{index}', _protect_secret(key))
            if provider == 'azure' and endpoint:
                cfg.set(provider, f'endpoint_{index}', endpoint)
            with open(get_config_path(), 'w', encoding='utf-8') as f: cfg.write(f)
            self._reload_credentials()
            return self._send_json(200, {'ok': True, 'count': len(existing) + 1})
        except Exception as e:
            return self._send_json(500, {'error': str(e)})

    def _delete_secure_credential(self):
        try:
            data = json.loads(self._read_body())
            provider = data.get('provider', '').strip().lower()
            index = data.get('index')
            cfg = load_config()
            if cfg.has_section(provider):
                if isinstance(index, int) and index > 0:
                    cfg.remove_option(provider, f'api_key_{index}')
                    if provider == 'azure': cfg.remove_option(provider, f'endpoint_{index}')
                else:
                    for key in list(cfg[provider]):
                        if key.startswith('api_key') or (provider == 'azure' and key.startswith('endpoint')): cfg.remove_option(provider, key)
                with open(get_config_path(), 'w', encoding='utf-8') as f: cfg.write(f)
            self._reload_credentials()
            return self._send_json(200, {'ok': True})
        except Exception as e:
            return self._send_json(500, {'error': str(e)})

    def _reload_credentials(self):
        global _CFG, GEMINI_KEYS, GROQ_KEYS, MISTRAL_KEYS, HUGGINGFACE_KEYS, OPENROUTER_KEYS, NVIDIA_KEYS, AZURE_KEYS, AZURE_ENDPOINTS, FISHAUDIO_KEYS, _TEXT_PROVIDER_SPECS
        _CFG = load_config()
        GEMINI_KEYS, GROQ_KEYS = _config_keys(_CFG, 'gemini'), _config_keys(_CFG, 'groq')
        MISTRAL_KEYS = _config_keys(_CFG, 'mistral')
        HUGGINGFACE_KEYS = _config_keys(_CFG, 'huggingface')
        OPENROUTER_KEYS = _config_keys(_CFG, 'openrouter')
        NVIDIA_KEYS = _config_keys(_CFG, 'nvidia')
        _TEXT_PROVIDER_SPECS = (
            ('groq', GROQ_KEYS, 'https://api.groq.com/openai/v1/chat/completions', _GROQ_MODEL_FALLBACKS),
            ('mistral', MISTRAL_KEYS, 'https://api.mistral.ai/v1/chat/completions', ('mistral-small-latest',)),
            ('openrouter', OPENROUTER_KEYS, 'https://openrouter.ai/api/v1/chat/completions', ('openai/gpt-oss-20b:free',)),
            ('nvidia', NVIDIA_KEYS, 'https://integrate.api.nvidia.com/v1/chat/completions', ('meta/llama-3.3-70b-instruct',)),
            ('huggingface', HUGGINGFACE_KEYS, 'https://router.huggingface.co/v1/chat/completions', ('meta-llama/Llama-3.3-70B-Instruct:novita',)),
        )
        AZURE_KEYS, FISHAUDIO_KEYS = _config_keys(_CFG, 'azure'), _config_keys(_CFG, 'fishaudio')
        AZURE_ENDPOINTS = [v.strip() for k, v in _CFG.items('azure') if k.startswith('endpoint') and v.strip()] if _CFG.has_section('azure') else []

    def _extract_pdf_text(self):
        try:
            data = json.loads(self._read_body())
            if not isinstance(data, dict) or set(data) - {'pdfBase64', 'pageIndices'}:
                raise ValueError('INVALID_PDF_TEXT_REQUEST')
            encoded = data.get('pdfBase64')
            if not isinstance(encoded, str) or not encoded:
                raise ValueError('INVALID_PDF_TEXT_SOURCE')
            if len(encoded) > ((PDF_TEXT_LIMIT + 2) // 3) * 4:
                return self._send_json(413, {'ok': False, 'error': 'PDF_TEXT_LIMIT'})
            try:
                pdf = base64.b64decode(encoded, validate=True)
            except ValueError:
                raise ValueError('INVALID_PDF_TEXT_SOURCE') from None
            if len(pdf) > PDF_TEXT_LIMIT:
                return self._send_json(413, {'ok': False, 'error': 'PDF_TEXT_LIMIT'})
            pages = extract_pdf_text(pdf, data.get('pageIndices'), bundle_dir)
            body = json.dumps({'ok': True, 'pages': pages}, ensure_ascii=False).encode('utf-8')
            if len(body) > MAX_REQUEST_BODY_BYTES:
                return self._send_json(413, {'ok': False, 'error': 'PDF_TEXT_LIMIT'})
            return self._send_raw(200, body, 'application/json')
        except (ValueError, TypeError):
            return self._send_json(400, {'ok': False, 'error': 'INVALID_PDF_TEXT_REQUEST'})
        except Exception:
            return self._send_json(503, {'ok': False, 'error': 'PDF_TEXT_UNAVAILABLE'})

    def _translate_pdf(self):
        try:
            data = json.loads(self._read_body())
            diagnostics = None
            if isinstance(data, dict) and self.path == '/api/pdf/translation/v2' and data.get('operation') == 'extract-notes':
                diagnostics = _translation_extraction_diagnostics(data.pop('diagnostics', None))
            with _translation_extraction_stage(diagnostics, 'native_request_decode'):
                operation, pdf, options, fonts = _translation_request(data)
            with _translation_extraction_stage(diagnostics, 'lock_wait'):
                _TRANSLATION_LOCK.acquire()
            try:
                try:
                    with _translation_extraction_stage(diagnostics, 'module_load'):
                        module = _load_translation_module()
                except (ImportError, OSError):
                    return self._send_json(503, {'ok': False, 'error': 'TRANSLATION_NATIVE_UNAVAILABLE'})
                if operation == 'extract-notes':
                    with _translation_extraction_stage(diagnostics, 'extract_total', byteLength=len(pdf)):
                        result = module.extract_translation_notes(pdf, json.dumps(options), diagnostics) if diagnostics else module.extract_translation_notes(pdf, json.dumps(options))
                elif operation == 'extract':
                    result = module.extract_translatable_text(pdf, json.dumps(options))
                else:
                    result = module.reconstruct_translated_occurrences(pdf, json.dumps(options), json.dumps(fonts), operation == 'preflight')
            finally:
                _TRANSLATION_LOCK.release()
            if operation == 'reconstruct':
                if not isinstance(result, bytes):
                    raise ValueError('TRANSLATION_OUTPUT_INVALID')
                if len(result) > _TRANSLATION_PDF_LIMIT:
                    raise OverflowError('TRANSLATION_NATIVE_LIMIT')
                return self._send_raw(200, result, 'application/pdf')
            if not isinstance(result, str) or len(result.encode('utf-8')) > MAX_REQUEST_BODY_BYTES:
                raise OverflowError('TRANSLATION_NATIVE_LIMIT')
            parsed = json.loads(result)
            if not isinstance(parsed, list):
                raise ValueError('TRANSLATION_OUTPUT_INVALID')
            body = json.dumps({'ok': True, 'result': parsed}).encode('utf-8')
            if len(body) > MAX_REQUEST_BODY_BYTES:
                raise OverflowError('TRANSLATION_NATIVE_LIMIT')
            return self._send_raw(200, body, 'application/json')
        except OverflowError:
            return self._send_json(413, {'ok': False, 'error': 'TRANSLATION_NATIVE_LIMIT'})
        except (ValueError, TypeError) as exc:
            code = str(exc)
            if not re.fullmatch(r'(?:INVALID_TRANSLATION|TRANSLATION)_[A-Z0-9_]{1,80}', code):
                code = 'INVALID_TRANSLATION_REQUEST' if isinstance(exc, json.JSONDecodeError) else 'TRANSLATION_NATIVE_FAILED'
            body = {'ok': False, 'error': code}
            occurrence_id = getattr(exc, 'occurrence_id', None)
            if isinstance(occurrence_id, str) and re.fullmatch(r'native:[A-Za-z0-9_-]+:\d+:\d+', occurrence_id):
                body['failedOccurrenceId'] = occurrence_id
            occurrence_ids = getattr(exc, 'occurrence_ids', None)
            if isinstance(occurrence_ids, list):
                safe_ids = [identifier for identifier in occurrence_ids
                            if isinstance(identifier, str) and re.fullmatch(r'native:[A-Za-z0-9_-]+:\d+:\d+', identifier)]
                if len(safe_ids) == len(occurrence_ids) and len(safe_ids) <= 20000:
                    body['failedOccurrenceIds'] = safe_ids
            page_index = getattr(exc, 'page_index', None)
            if isinstance(page_index, int) and page_index >= 0:
                body['failedPageIndex'] = page_index
            stage = getattr(exc, 'stage', None)
            if isinstance(stage, str) and stage in ('plan', 'write', 'redaction_verify', 'write_verify', 'location_verify', 'reopen_verify'):
                body['failedStage'] = stage
            return self._send_json(400 if code.startswith('INVALID_') else 422, body)
        except Exception:
            return self._send_json(422, {'ok': False, 'error': 'TRANSLATION_NATIVE_FAILED'})

    def _generate_ai_json(self):
        budget = None
        metrics = None
        try:
            data = json.loads(self._read_body())
            prompt, temperature = data.get('prompt'), data.get('temperature', 0)
            if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 60000: return self._send_error(400, 'Solicitud de IA inválida')
            if not isinstance(temperature, (int, float)) or temperature < 0 or temperature > 1: return self._send_error(400, 'Temperatura inválida')
            if data.get('task') == 'translation' and isinstance(data.get('metrics'), dict):
                try:
                    validated = _validated_translation_metric({**data['metrics'], 'event': 'provider_request'})
                    metrics = {key: value for key, value in validated.items() if key != 'serverTimestamp'}
                except (ValueError, TypeError):
                    metrics = None
            budget = _TranslationGenerationBudget() if data.get('task') == 'translation' else None
            if budget:
                budget.metrics = metrics
            text, provider, model = _generate_text_json_with_fallback(prompt, float(temperature), **({'budget': budget} if budget else {}))
            result = {'ok': True, 'text': text, 'provider': provider, 'model': model}
            if budget:
                result.update(elapsedMs=round((time.monotonic() - budget.started) * 1000), attempts=budget.attempts,
                              rateLimited='PROVIDER_RATE_LIMITED' in budget.failures)
                if metrics:
                    try_record_translation_metric({**metrics, 'event': 'provider_request_completed', 'status': 'ok',
                                                   'provider': provider, 'model': model, 'durationMs': result['elapsedMs'],
                                                   'providerAttempts': budget.attempts})
            return self._send_json(200, result)
        except RuntimeError as exc:
            if budget:
                code = str(exc)
                if code not in {'PROVIDER_KEY_REQUIRED', 'PROVIDER_AUTH_FAILED', 'PROVIDER_PAYMENT_REQUIRED', 'PROVIDER_RATE_LIMITED', 'PROVIDER_TIMEOUT', 'PROVIDER_REQUEST_FAILED'}:
                    code = 'PROVIDER_REQUEST_FAILED'
                if metrics:
                    try_record_translation_metric({**metrics, 'event': 'provider_request_failed', 'status': 'failed',
                                                   'errorCode': code, 'durationMs': round((time.monotonic() - budget.started) * 1000),
                                                   'providerAttempts': budget.attempts})
                return self._send_json(503, {'ok': False, 'error': code,
                                            'elapsedMs': round((time.monotonic() - budget.started) * 1000),
                                            'attempts': budget.attempts,
                                            'retryAfterSeconds': budget.retry_after_seconds if code in {'PROVIDER_RATE_LIMITED', 'PROVIDER_PAYMENT_REQUIRED'} else 0})
            return self._send_error(503, str(exc))
        except Exception:
            if metrics:
                try_record_translation_metric({**metrics, 'event': 'provider_request_failed', 'status': 'failed',
                                               'errorCode': 'PROVIDER_REQUEST_FAILED',
                                               'durationMs': round((time.monotonic() - budget.started) * 1000) if budget else 0,
                                               'providerAttempts': budget.attempts if budget else 0})
            return self._send_error(502, 'El proveedor de IA no pudo completar la solicitud')

    def _record_app_diag(self):
        try:
            body = self._read_body()
            data = json.loads(body)
            if isinstance(data, list):
                for item in data:
                    record_app_diag_log(item)
            elif isinstance(data, dict):
                record_app_diag_log(data)
            return self._send_json(200, {'ok': True})
        except Exception as e:
            return self._send_json(400, {'ok': False, 'error': str(e)})

    def _get_app_diag(self):
        try:
            path = get_app_diag_log_path()
            if not os.path.exists(path):
                return self._send_json(200, {'entries': []})
            with open(path, 'r', encoding='utf-8', errors='ignore') as f:
                lines = f.readlines()
            tail = [json.loads(line) for line in lines[-100:] if line.strip()]
            return self._send_json(200, {'entries': tail, 'total': len(lines)})
        except Exception as e:
            return self._send_json(500, {'ok': False, 'error': str(e)})

    def _record_translation_metric(self):
        try:
            data = json.loads(self._read_body())
            path = record_translation_metric(data)
            return self._send_json(200, {'ok': True, 'path': path})
        except (ValueError, TypeError, json.JSONDecodeError):
            return self._send_json(400, {'ok': False, 'error': 'INVALID_TRANSLATION_METRIC'})
        except OSError:
            return self._send_json(500, {'ok': False, 'error': 'TRANSLATION_METRIC_WRITE_FAILED'})

    def _translation_checkpoint(self):
        try:
            result = translation_checkpoint(json.loads(self._read_body()))
            return self._send_json(200, {'ok': True, 'translations': result})
        except (ValueError, TypeError, json.JSONDecodeError):
            return self._send_json(400, {'ok': False, 'error': 'INVALID_TRANSLATION_CHECKPOINT'})
        except Exception:
            return self._send_json(503, {'ok': False, 'error': 'TRANSLATION_CHECKPOINT_UNAVAILABLE'})

    def _associate_pdf_handler(self):
        try:
            # An explicit preferences action can retry a first-use policy failure.
            try:
                initialize_once(base64.b64decode(ALIOTH_ROOT_CERT_BASE64), *_pdf_registration_target(), force=True)
            except OSError:
                pass
            register_pdf(*_pdf_registration_target())
            try:
                os.startfile('ms-settings:defaultapps?registeredAppUser=AliothPDFEditor')
            except OSError:
                os.startfile('ms-settings:defaultapps')
            return self._send_json(200, {
                'ok': True,
                'message': 'Alioth está registrado. Confirma el visor PDF predeterminado en la ventana de Windows.'
            })
        except Exception as error:
            print(f'[PDF Association] {error}')
            return self._send_json(500, {'ok': False, 'error': 'No se pudo registrar Alioth para archivos PDF.'})

    def _fishaudio_voices(self):
        """Lista voces de Fish Audio (propias o comunitarias)."""
        try:
            parsed = urllib.parse.urlparse(self.path)
            qs = urllib.parse.parse_qs(parsed.query)
            scope = qs.get('scope', ['community'])[0]
            self_param = "true" if scope == "self" else "false"
            
            auth_header = self.headers.get('Authorization', '')
            api_key = ''
            if auth_header.startswith('Bearer '):
                api_key = auth_header[7:].strip()
            elif 'key' in qs:
                api_key = qs['key'][0].strip()
            if not api_key and FISHAUDIO_KEYS:
                api_key = FISHAUDIO_KEYS[0]
                
            headers = {'User-Agent': UA_BROWSER}
            if api_key:
                headers['Authorization'] = f'Bearer {api_key}'
                
            url = f'https://api.fish.audio/model?page_size=100&self={self_param}'
            req = urllib.request.Request(url, headers=headers, method='GET')
            with urllib.request.urlopen(req, context=_SSL_CTX, timeout=15) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                
            items = data.get('items', [])
            voices = []
            for v in items:
                tags = v.get('tags', [])
                gender = 'female' if 'female' in tags else ('male' if 'male' in tags else '')
                langs = v.get('languages', [])
                lang = langs[0] if langs else 'es'
                voices.append({
                    'id': v.get('_id', ''),
                    'name': v.get('title', v.get('_id', '')),
                    'language': lang,
                    'gender': gender,
                    'tags': tags,
                    'description': v.get('description', '')
                })
            return self._send_json(200, {'ok': True, 'voices': voices})
        except urllib.error.HTTPError as he:
            err_content = he.read().decode('utf-8', errors='replace')
            print(f"[FishAudio Voices HTTPError] {he.code}: {err_content}")
            try:
                err_json = json.loads(err_content)
                msg = err_json.get('message') or err_json.get('error') or err_json.get('detail') or str(he)
            except Exception:
                msg = err_content or str(he)
            return self._send_json(he.code, {'ok': False, 'error': msg})
        except Exception as e:
            print(f"[FishAudio Voices] Error: {e}")
            return self._send_json(500, {'ok': False, 'error': str(e)})

    def _fishaudio_synthesize(self):
        """Sintetiza texto a voz usando Fish Audio (BigFish)."""
        try:
            body = json.loads(self._read_body().decode('utf-8'))
            text = body.get('text', '').strip()
            voice_id = body.get('voice_id', '').strip()
            api_key = body.get('api_key', '').strip()
            
            if not api_key:
                auth_header = self.headers.get('Authorization', '')
                if auth_header.startswith('Bearer '):
                    api_key = auth_header[7:].strip()
            if not api_key and FISHAUDIO_KEYS:
                api_key = FISHAUDIO_KEYS[0]
            
            if not text:
                return self._send_json(400, {'error': 'Texto vacío'})
            if not api_key:
                return self._send_json(401, {'error': 'API Key de Fish Audio requerida'})
                
            payload_dict = {
                'text': text,
                'format': 'mp3'
            }
            if voice_id:
                payload_dict['reference_id'] = voice_id
                
            payload = json.dumps(payload_dict).encode('utf-8')
            
            headers = {
                'Authorization': f'Bearer {api_key}',
                'Content-Type': 'application/json',
                'User-Agent': UA_BROWSER,
                'model': 's2.1-pro-free'
            }
            
            req = urllib.request.Request('https://api.fish.audio/v1/tts', data=payload, headers=headers, method='POST')
            try:
                with urllib.request.urlopen(req, context=_SSL_CTX, timeout=60) as resp:
                    audio_bytes = resp.read()
            except urllib.error.HTTPError as he:
                err_content = he.read().decode('utf-8', errors='replace')
                print(f"[FishAudio Synth HTTPError] {he.code}: {err_content}")
                
                # Fallback: retry with 's2.1-pro' or default headers if model header caused issue
                if he.code in (400, 404, 422):
                    try:
                        headers_retry = {
                            'Authorization': f'Bearer {api_key}',
                            'Content-Type': 'application/json',
                            'User-Agent': UA_BROWSER,
                            'model': 's2.1-pro'
                        }
                        req_retry = urllib.request.Request('https://api.fish.audio/v1/tts', data=payload, headers=headers_retry, method='POST')
                        with urllib.request.urlopen(req_retry, context=_SSL_CTX, timeout=60) as resp_retry:
                            audio_bytes = resp_retry.read()
                            return self._send_raw(200, audio_bytes, 'audio/mpeg')
                    except Exception as retry_err:
                        print(f"[FishAudio Retry Error]: {retry_err}")
                
                try:
                    err_json = json.loads(err_content)
                    msg = err_json.get('message') or err_json.get('error') or err_json.get('detail') or str(he)
                except Exception:
                    msg = err_content or str(he)
                return self._send_json(he.code, {'error': msg})
                
            return self._send_raw(200, audio_bytes, 'audio/mpeg')
        except Exception as e:
            print(f"[FishAudio Synth] Error: {e}")
            return self._send_json(500, {'error': str(e)})

    def _excel_inspect_upload(self):
        """POST /excel/inspect-upload — recibe xlsx, guarda en temp, retorna PageSetup + path temporal."""
        ctype = self.headers.get('Content-Type', '')
        if 'multipart/form-data' not in ctype:
            return self._send_error(400, "Se esperaba multipart/form-data")
        boundary = None
        for part in ctype.split(';'):
            part = part.strip()
            if part.startswith('boundary='):
                boundary = part[9:].strip('"').encode()
                break
        if not boundary:
            return self._send_error(400, "Falta boundary")

        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length)

        file_data = None
        filename = 'document.xlsx'
        delimiter = b'--' + boundary
        for p in body.split(delimiter):
            if b'Content-Disposition' not in p: continue
            header_end = p.find(b'\r\n\r\n')
            if header_end == -1: continue
            headers_raw = p[:header_end].decode(errors='replace')
            content = p[header_end + 4:]
            if content.endswith(b'\r\n'): content = content[:-2]
            if 'name="file"' in headers_raw:
                file_data = content
                for h in headers_raw.split(';'):
                    h = h.strip()
                    if h.startswith('filename='):
                        filename = h[9:].strip('"')
                break

        if not file_data:
            return self._send_json(400, {'error': "No se recibió campo 'file'"})

        try:
            tmp_base = os.path.join(base_dir, '_tmp_office')
            os.makedirs(tmp_base, exist_ok=True)
            tmp_dir = tempfile.mkdtemp(prefix="xps_", dir=tmp_base)
            ext = os.path.splitext(filename)[1].lower() or '.xlsx'
            input_path = os.path.normpath(os.path.join(tmp_dir, 'input' + ext))
            with open(input_path, 'wb') as f:
                f.write(file_data)

            info = _excel_inspect_pagesetup(input_path)
            info['path'] = input_path  # ruta para open-for-edit
            return self._send_json(200, info)
        except Exception as e:
            print(f"[Excel InspectUpload] Error: {e}")
            return self._send_json(500, {'error': str(e)})

    def _excel_read_file(self):
        """POST /excel/read-file — body: {path} — lee el archivo y retorna base64."""
        try:
            import base64
            body = json.loads(self._read_body())
            fpath = body.get('path', '').strip()
            if not fpath or not self._is_safe_path(fpath) or not os.path.isfile(fpath):
                return self._send_json(200, {'ok': False, 'error': 'Archivo no encontrado o ruta no válida: ' + fpath})
            with open(fpath, 'rb') as f:
                data = f.read()
            name = os.path.basename(fpath)
            return self._send_json(200, {'ok': True, 'data_base64': base64.b64encode(data).decode(), 'name': name})
        except Exception as e:
            print(f'[Excel ReadFile] Error: {e}')
            return self._send_json(200, {'ok': False, 'error': str(e)})

    def _excel_browse(self):
        """POST /excel/browse — abre diálogo nativo del SO y retorna la ruta seleccionada."""
        try:
            ps_cmd = (
                "[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null;"
                "$dlg = New-Object System.Windows.Forms.OpenFileDialog;"
                "$dlg.Filter = 'Archivos de Excel (*.xlsx;*.xlsm;*.xls)|*.xlsx;*.xlsm;*.xls|Todos los archivos (*.*)|*.*';"
                "$dlg.Title = 'Seleccionar archivo Excel';"
                "$res = $dlg.ShowDialog((New-Object System.Windows.Forms.Form -Property @{TopMost=$true}));"
                "if ($res -eq 'OK') { Write-Output $dlg.FileName }"
            )
            import subprocess
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            res = subprocess.run(
                ["powershell", "-NoProfile", "-Command", ps_cmd],
                capture_output=True, text=True, startupinfo=startupinfo, timeout=120
            )
            fpath = res.stdout.strip()
            return self._send_json(200, {'path': fpath or ''})
        except Exception as e:
            print(f'[Excel Browse] Error: {e}')
            return self._send_json(200, {'path': ''})

    def _excel_save_dialog(self):
        """POST /excel/save-dialog — abre diálogo SaveFileDialog nativo del SO y retorna la ruta elegida."""
        try:
            body_text = self._read_body()
            body = json.loads(body_text) if body_text else {}
            default_name = body.get('default_name', 'Extraccion_Datos.xlsx').replace("'", "").replace('"', '').replace(';', '')
            ps_cmd = (
                "[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null;"
                "$dlg = New-Object System.Windows.Forms.SaveFileDialog;"
                "$dlg.Filter = 'Archivos de Excel (*.xlsx)|*.xlsx|Todos los archivos (*.*)|*.*';"
                f"$dlg.FileName = '{default_name}';"
                "$dlg.Title = 'Guardar nuevo archivo Excel';"
                "$res = $dlg.ShowDialog((New-Object System.Windows.Forms.Form -Property @{TopMost=$true}));"
                "if ($res -eq 'OK') { Write-Output $dlg.FileName }"
            )
            import subprocess
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            res = subprocess.run(
                ["powershell", "-NoProfile", "-Command", ps_cmd],
                capture_output=True, text=True, startupinfo=startupinfo, timeout=120
            )
            fpath = res.stdout.strip()
            return self._send_json(200, {'path': fpath or ''})
        except Exception as e:
            print(f'[Excel Save Dialog] Error: {e}')
            return self._send_json(200, {'path': ''})

    def _excel_write_direct(self):
        """POST /excel/write-direct — body: {path, data_base64} — escribe el workbook directo al disco."""
        try:
            import base64
            body = json.loads(self._read_body())
            fpath = body.get('path', '').strip()
            data_b64 = body.get('data_base64', '')
            if not fpath or not self._is_safe_path(fpath):
                return self._send_json(400, {'ok': False, 'error': 'Ruta no válida o no permitida'})
            data = base64.b64decode(data_b64)
            os.makedirs(os.path.dirname(os.path.abspath(fpath)), exist_ok=True)
            with open(fpath, 'wb') as f:
                f.write(data)
            return self._send_json(200, {'ok': True, 'path': fpath})
        except Exception as e:
            print(f'[Excel WriteDirect] Error: {e}')
            return self._send_json(500, {'ok': False, 'error': str(e)})

    def _excel_sheets_handler(self):
        """POST /excel/sheets — body: {path} — lee las hojas de un archivo Excel."""
        try:
            body = json.loads(self._read_body())
            fpath = body.get('path', '').strip()
            print(f"[Excel Sheets] Solicitadas hojas de: {fpath}")
            if not fpath:
                print("[Excel Sheets] Error: sin ruta")
                return self._send_json(200, {'ok': False, 'error': 'Sin ruta'})
            fpath = os.path.normpath(fpath)
            if not os.path.isfile(fpath):
                print(f"[Excel Sheets] Error: archivo no encontrado: {fpath}")
                return self._send_json(200, {'ok': False, 'error': f'Archivo no encontrado: {fpath}'})
            import openpyxl
            wb = openpyxl.load_workbook(fpath, read_only=True, keep_vba=True)
            sheets = wb.sheetnames
            wb.close()
            print(f"[Excel Sheets] Hojas encontradas: {sheets}")
            return self._send_json(200, {'ok': True, 'sheets': sheets})
        except Exception as e:
            print(f'[Excel Sheets] Error: {e}')
            return self._send_json(200, {'ok': False, 'error': str(e)})

    def _excel_write_openpyxl_handler(self):
        """POST /excel/write-openpyxl
        Body: { path, sheet, headerRow, rowData: {columna: valor, ...} }
        """
        try:
            body = json.loads(self._read_body())
            fpath = body.get('path', '').strip()
            sheet_name = body.get('sheet', '').strip()
            header_row_val = body.get('headerRow', body.get('header_row', 1))
            row_data = body.get('rowData', body.get('data', {}))

            print(f"[Excel WriteOpenpyxl] Recibida petición de escritura.")
            print(f"  - Ruta: {fpath}")
            print(f"  - Hoja: {sheet_name}")
            print(f"  - Fila cabecera: {header_row_val}")
            print(f"  - Datos de fila keys: {list(row_data.keys())}")

            if not fpath:
                print("[Excel WriteOpenpyxl] Error: Sin ruta en la petición")
                return self._send_json(400, {'ok': False, 'error': 'Sin ruta'})
            fpath = os.path.normpath(fpath)
            if not os.path.isfile(fpath):
                print(f"[Excel WriteOpenpyxl] Error: Archivo no encontrado: {fpath}")
                return self._send_json(400, {'ok': False, 'error': f'Archivo no encontrado: {fpath}'})

            header_row_num = int(header_row_val)
            if header_row_num < 1:
                header_row_num = 1

            import openpyxl
            import datetime
            import re
            import unicodedata

            def clean_str(s):
                if s is None:
                    return ""
                s = str(s).strip().lower()
                s = "".join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')
                cleaned = re.sub(r'[^a-z0-9]', '', s)
                return cleaned

            def parse_value(val, key=None):
                if val is None:
                    return None
                s = str(val).strip()
                if not s:
                    return ""

                # Si es una columna de peso, talla, estatura o altura, limpiar unidades de medida
                if key:
                    norm_key = clean_str(key)
                    if 'peso' in norm_key or 'talla' in norm_key or 'estatura' in norm_key or 'altura' in norm_key:
                        # Conservar solo números, puntos, comas y signos menos
                        cleaned = re.sub(r'[^0-9.,-]', '', s)
                        if cleaned:
                            s = cleaned
                            # TALLA: si el valor es >= 100, convertir de cm a metros (184 -> 1.84)
                            if 'talla' in norm_key or 'estatura' in norm_key or 'altura' in norm_key:
                                try:
                                    num_check = float(s.replace(',', '.'))
                                    if num_check >= 100:
                                        s = str(round(num_check / 100, 2))
                                        print(f"    [parse_value] Talla normalizada: {num_check} -> {s} (dividida entre 100)")
                                except ValueError:
                                    pass

                if s.isdigit():
                    return int(s)
                try:
                    candidate = s.replace(',', '.')
                    if re.match(r'^-?\d+\.\d+$', candidate):
                        return float(candidate)
                except ValueError:
                    pass
                date_patterns = [
                    (r'^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$', 'dmy'),
                    (r'^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$', 'ymd')
                ]
                for pat, order in date_patterns:
                    m = re.match(pat, s)
                    if m:
                        try:
                            if order == 'ymd':
                                year = int(m.group(1))
                                month = int(m.group(2))
                                day = int(m.group(3))
                            else:
                                day = int(m.group(1))
                                month = int(m.group(2))
                                yr = int(m.group(3))
                                year = yr + 2000 if yr < 100 else yr
                            return datetime.date(year, month, day)
                        except ValueError:
                            pass
                return s

            # ── INTENTO DE ESCRITURA VÍA COM INTEROP (EXCEL NATIVO) ──
            # Esto conserva imágenes, formas, comentarios, validaciones y actualiza la pantalla en tiempo real
            com_success = False
            com_row = -1
            com_sheet = ""
            excel = None
            wb_com = None
            created_excel = False
            opened_wb = False
            try:
                print("[Excel WriteOpenpyxl] Intentando escritura via COM Interop (Excel)...")
                import win32com.client
                import pythoncom
                
                pythoncom.CoInitialize()
                try:
                    try:
                        excel = win32com.client.GetActiveObject("Excel.Application")
                        print("  - Conectado a instancia activa de Excel")
                    except Exception:
                        excel = win32com.client.Dispatch("Excel.Application")
                        created_excel = True
                        print("  - Creada nueva instancia de Excel")
                    
                    excel.DisplayAlerts = False
                    abs_path = os.path.abspath(fpath)
                    
                    # Buscar si el libro ya está abierto
                    wb_com = None
                    for opened_wb_item in excel.Workbooks:
                        try:
                            # Comparar solo por nombre de archivo para evitar discrepancias de rutas cloud/OneDrive/SharePoint
                            if opened_wb_item.Name.lower() == os.path.basename(abs_path).lower():
                                wb_com = opened_wb_item
                                print("  - El archivo ya está abierto en Excel")
                                break
                        except Exception as wb_err:
                            print(f"  [Excel COM] Error al inspeccionar libro abierto: {wb_err}")
                    
                    
                    if wb_com is None:
                        wb_com = excel.Workbooks.Open(abs_path)
                        opened_wb = True
                    
                    # Seleccionar hoja
                    ws_com = None
                    if sheet_name:
                        try:
                            ws_com = wb_com.Sheets(sheet_name)
                        except Exception:
                            ws_com = wb_com.ActiveSheet
                    else:
                        ws_com = wb_com.ActiveSheet
                        
                    if ws_com:
                        com_sheet = ws_com.Name
                        # Leer cabeceras
                        com_headers = []
                        for col in range(1, 101):
                            val = ws_com.Cells(header_row_num, col).Value
                            com_headers.append(str(val).strip() if val is not None else "")
                            
                        # Determinar siguiente fila vacía
                        nombre_col_idx = -1
                        for idx, h in enumerate(com_headers):
                            if clean_str(h) == 'nombre':
                                nombre_col_idx = idx + 1
                                break
                        
                        next_row = ws_com.UsedRange.Rows.Count + 1
                        if next_row <= header_row_num:
                            next_row = header_row_num + 1
                            
                        if nombre_col_idx > 0:
                            for r in range(header_row_num + 1, next_row + 100):
                                val = ws_com.Cells(r, nombre_col_idx).Value
                                if val is None or str(val).strip() == '':
                                    next_row = r
                                    break
                        else:
                            for r in range(header_row_num + 1, next_row + 100):
                                row_empty = True
                                for col in range(1, len(com_headers) + 1):
                                    val = ws_com.Cells(r, col).Value
                                    if val is not None and str(val).strip() != '':
                                        row_empty = False
                                        break
                                if row_empty:
                                    next_row = r
                                    break
                                    
                        com_row = next_row
                        print(f"  - Fila destino (COM): {com_row}")
                        
                        # Escribir celdas
                        for key, val in row_data.items():
                            col_idx = -1
                            norm_key = clean_str(key)
                            for idx, h in enumerate(com_headers):
                                if clean_str(h) == norm_key:
                                    col_idx = idx + 1
                                    break
                            if col_idx > 0:
                                parsed_val = parse_value(val, key)
                                if isinstance(parsed_val, (datetime.date, datetime.datetime)):
                                    # Escribir como datetime nativo para que Excel lo interprete como fecha real, no texto
                                    dt_val = datetime.datetime(parsed_val.year, parsed_val.month, parsed_val.day)
                                    ws_com.Cells(next_row, col_idx).Value = dt_val
                                else:
                                    ws_com.Cells(next_row, col_idx).Value = parsed_val
                                print(f"    Col {col_idx} ('{com_headers[col_idx-1]}') <- {parsed_val}")
                                    
                        # Fecha de atención auto-complete
                        for idx, h in enumerate(com_headers):
                            norm_h = clean_str(h)
                            if 'fecha' in norm_h and ('atencion' in norm_h or 'servicio' in norm_h):
                                col_idx = idx + 1
                                current_val = ws_com.Cells(next_row, col_idx).Value
                                if current_val is None or str(current_val).strip() == '':
                                    dt_now = datetime.datetime.now()
                                    ws_com.Cells(next_row, col_idx).Value = dt_now
                                    print(f"    Col {col_idx} ('{h}') <- {dt_now} (Auto-fecha nativa)")
                                    
                        wb_com.Save()
                        com_success = True
                        print(f"[Excel COM Interop] Escrito con éxito en fila {com_row} de hoja '{com_sheet}'")
                finally:
                    if opened_wb and wb_com is not None:
                        try:
                            wb_com.Close(SaveChanges=False)
                            print("  - Libro cerrado en Excel COM")
                        except Exception as close_err:
                            print(f"  - Error al cerrar libro: {close_err}")
                    
                    if created_excel and excel is not None:
                        try:
                            excel.Quit()
                            print("  - Instancia de Excel COM finalizada")
                        except Exception as quit_err:
                            print(f"  - Error al finalizar Excel: {quit_err}")
                    
                    wb_com = None
                    excel = None
                    pythoncom.CoUninitialize()
            except Exception as com_err:
                print(f"[Excel COM Interop] Falló: {com_err}. Rebotando a openpyxl...")
                com_success = False

            if com_success:
                return self._send_json(200, {'ok': True, 'row': com_row, 'sheet': com_sheet})

            # ── OPENPYXL FALLBACK ──
            try:
                print(f"[Excel WriteOpenpyxl] Cargando workbook con openpyxl...")
                wb = openpyxl.load_workbook(fpath, keep_vba=True, data_only=False)
            except PermissionError:
                print(f"[Excel WriteOpenpyxl] PermissionError al abrir workbook: {fpath}")
                return self._send_json(200, {
                    'ok': False,
                    'error': 'El archivo Excel está abierto por otro programa (como Excel). Por favor ciérralo e intenta de nuevo.'
                })
            except Exception as e:
                print(f"[Excel WriteOpenpyxl] Error al cargar workbook: {e}")
                return self._send_json(200, {'ok': False, 'error': f'Error al cargar workbook: {str(e)}'})

            if not sheet_name or sheet_name not in wb.sheetnames:
                old_sheet = sheet_name
                sheet_name = wb.sheetnames[0]
                print(f"[Excel WriteOpenpyxl] Hoja '{old_sheet}' no encontrada. Usando primera hoja disponible: '{sheet_name}'")
            ws = wb[sheet_name]

            headers = []
            max_col = ws.max_column
            read_cols = max(max_col, 100)
            for col in range(1, read_cols + 1):
                val = ws.cell(row=header_row_num, column=col).value
                headers.append(str(val).strip() if val is not None else "")

            print(f"[Excel WriteOpenpyxl] Cabeceras leídas en fila {header_row_num}:")
            for col_idx, h in enumerate(headers):
                if h:
                    print(f"  Col {col_idx+1}: '{h}' (normalizado: '{clean_str(h)}')")

            nombre_col_idx = -1
            for idx, h in enumerate(headers):
                if clean_str(h) == 'nombre':
                    nombre_col_idx = idx + 1
                    break

            next_row = ws.max_row + 1
            if nombre_col_idx > 0:
                print(f"[Excel WriteOpenpyxl] Columna 'nombre' detectada en índice {nombre_col_idx}. Buscando primera celda vacía en esa columna...")
                for r in range(header_row_num + 1, ws.max_row + 2):
                    val = ws.cell(row=r, column=nombre_col_idx).value
                    if val is None or str(val).strip() == '':
                        next_row = r
                        break
            else:
                print(f"[Excel WriteOpenpyxl] Columna 'nombre' no detectada. Buscando primera fila completamente vacía...")
                for r in range(header_row_num + 1, ws.max_row + 2):
                    row_empty = True
                    for col in range(1, len(headers) + 1):
                        if ws.cell(row=r, column=col).value is not None:
                            row_empty = False
                            break
                    if row_empty:
                        next_row = r
                        break

            print(f"[Excel WriteOpenpyxl] Fila destino para escritura determinada como: {next_row}")

            written_cols = []
            for key, val in row_data.items():
                col_idx = -1
                norm_key = clean_str(key)
                for idx, h in enumerate(headers):
                    if clean_str(h) == norm_key:
                        col_idx = idx + 1
                        break
                if col_idx > 0:
                    parsed_val = parse_value(val, key)
                    cell = ws.cell(row=next_row, column=col_idx)
                    cell.value = parsed_val
                    if isinstance(parsed_val, (datetime.date, datetime.datetime)):
                        cell.number_format = 'dd/mm/yyyy'
                    written_cols.append(key)
                    print(f"  - Escrito campo '{key}' -> Columna '{headers[col_idx-1]}' (Col {col_idx}), Valor: {parsed_val}")
                else:
                    print(f"  - Campo '{key}' no pudo ser emparejado con ninguna columna de Excel.")

            # FECHA DE ATENCION auto-complete
            for idx, h in enumerate(headers):
                norm_h = clean_str(h)
                if 'fecha' in norm_h and ('atencion' in norm_h or 'servicio' in norm_h):
                    col_idx = idx + 1
                    if not ws.cell(row=next_row, column=col_idx).value:
                        cell = ws.cell(row=next_row, column=col_idx)
                        cell.value = datetime.date.today()
                        cell.number_format = 'dd/mm/yyyy'
                        print(f"  - Auto-completada fecha de atención en columna '{h}' (Col {col_idx})")

            try:
                print(f"[Excel WriteOpenpyxl] Guardando workbook con preservación de assets...")
                import zipfile, io, shutil

                # 1. Guardar la versión modificada de openpyxl en memoria
                buf_new = io.BytesIO()
                wb.save(buf_new)
                wb.close()
                buf_new.seek(0)

                # 2. Leer el ZIP original del disco (tiene imágenes, formas, validaciones, etc.)
                with open(fpath, 'rb') as f_orig:
                    orig_bytes = f_orig.read()

                # 3. Merge ZIP: solo las hojas modificadas vienen de openpyxl; todo lo demás del original.
                # Esto preserva drawings, media, charts, vba, tablas, validaciones, _rels de hojas, etc.
                orig_zip  = zipfile.ZipFile(io.BytesIO(orig_bytes), 'r')
                new_zip_in = zipfile.ZipFile(buf_new, 'r')
                orig_names = set(orig_zip.namelist())
                new_names  = set(new_zip_in.namelist())

                # Solo tomamos del nuevo zip las partes de hojas con datos actualizados
                # Todo lo demás (incluyendo [Content_Types].xml, _rels, drawings, media) viene del original
                TAKE_FROM_NEW = set()
                import re as _re
                for name in new_names:
                    # Solo hojas de cálculo (xl/worksheets/sheetX.xml) y sharedStrings
                    if _re.match(r'^xl/worksheets/sheet\d+\.xml$', name):
                        TAKE_FROM_NEW.add(name)
                    if name == 'xl/sharedStrings.xml':
                        TAKE_FROM_NEW.add(name)

                buf_out = io.BytesIO()
                with zipfile.ZipFile(buf_out, 'w', zipfile.ZIP_DEFLATED) as out_zip:
                    # Primero: original completo (preserva TODO: drawings, media, vba, validaciones)
                    for name in orig_names:
                        if name in TAKE_FROM_NEW:
                            continue  # esta parte la sobreescribimos del nuevo
                        try:
                            out_zip.writestr(name, orig_zip.read(name))
                        except Exception as pe:
                            print(f"    [Preserve-orig] SKIP {name}: {pe}")
                    # Segundo: hojas actualizadas de openpyxl (solo datos de celdas)
                    for name in TAKE_FROM_NEW:
                        try:
                            out_zip.writestr(name, new_zip_in.read(name))
                            print(f"    [Updated] {name}")
                        except Exception as pe:
                            print(f"    [Updated] SKIP {name}: {pe}")

                orig_zip.close()
                new_zip_in.close()

                # 4. Escribir al disco
                buf_out.seek(0)
                with open(fpath, 'wb') as f_out:
                    f_out.write(buf_out.read())
                print(f"[Excel WriteOpenpyxl] Guardado exitoso con assets preservados.")
            except PermissionError:
                print(f"[Excel WriteOpenpyxl] PermissionError al guardar workbook: {fpath}")
                return self._send_json(200, {
                    'ok': False,
                    'error': 'El archivo Excel está abierto por otro programa (como Excel). Por favor ciérralo e intenta de nuevo.'
                })
            except Exception as e:
                import traceback
                print(f"[Excel WriteOpenpyxl] Error al guardar: {e}")
                traceback.print_exc()
                return self._send_json(200, {'ok': False, 'error': f'Error al guardar el archivo: {str(e)}'})

            return self._send_json(200, {'ok': True, 'row': next_row, 'sheet': sheet_name})

        except Exception as e:
            import traceback
            print(f'[Excel WriteOpenpyxl] Error: {e}')
            traceback.print_exc()
            return self._send_json(200, {'ok': False, 'error': str(e)})

    def _excel_inspect(self):
        """GET /excel/inspect?path=<url_encoded_abs_path>"""
        from urllib.parse import parse_qs, urlparse, unquote
        qs = parse_qs(urlparse(self.path).query)
        xlsx_path = unquote(qs.get('path', [''])[0])
        if not xlsx_path or not self._is_safe_path(xlsx_path) or not os.path.isfile(xlsx_path):
            return self._send_json(400, {'error': 'Archivo no encontrado: ' + xlsx_path})
        try:
            info = _excel_inspect_pagesetup(os.path.normpath(xlsx_path))
            return self._send_json(200, info)
        except Exception as e:
            return self._send_json(500, {'error': str(e)})

    def _excel_open_edit(self):
        """POST /excel/open-for-edit  body: JSON {path}"""
        body = self._read_body()
        try:
            data = json.loads(body)
        except:
            return self._send_json(400, {'error': 'JSON inválido'})
        xlsx_path = data.get('path', '')
        if not xlsx_path or not self._is_safe_path(xlsx_path) or not os.path.isfile(xlsx_path):
            return self._send_json(400, {'error': 'Archivo no encontrado: ' + xlsx_path})
        session_id = str(uuid.uuid4())
        _excel_open_for_edit(os.path.normpath(xlsx_path), session_id)
        return self._send_json(200, {'session_id': session_id})

    def _excel_edit_status(self):
        """GET /excel/edit-status?session=<id>"""
        from urllib.parse import parse_qs, urlparse
        qs = parse_qs(urlparse(self.path).query)
        sid = qs.get('session', [''])[0]
        with _excel_sessions_lock:
            sess = _excel_sessions.get(sid)
        if not sess:
            return self._send_json(404, {'error': 'Sesión no encontrada'})
        return self._send_json(200, {
            'status': sess['status'],   # 'open' | 'closed'
            'info': sess.get('info'),   # PageSetup actualizado, o null
        })

    def _excel_cancel_edit(self):
        """GET /excel/cancel-edit?session=<id>  — intenta cerrar Excel para esa sesión"""
        from urllib.parse import parse_qs, urlparse
        qs = parse_qs(urlparse(self.path).query)
        sid = qs.get('session', [''])[0]
        with _excel_sessions_lock:
            sess = _excel_sessions.pop(sid, None)
        # El hilo de monitor detectará el cierre por sí solo; solo marcamos como cancelado
        return self._send_json(200, {'cancelled': True})

    def _proxy_gemini(self):
        body = self._read_body()
        raw_suffix = self.path.split('/v1beta/')[-1]
        suffix_path, _, qs = raw_suffix.partition('?')
        auto_vision = suffix_path.startswith('models/auto-vision:')
        vision_deadline = time.monotonic() + 25 if auto_vision else None
        params = urllib.parse.parse_qs(qs)
        
        # Extraer la clave enviada por el usuario en el query string si existe
        user_key = params.pop('key', [None])[0]
        extra_qs = urllib.parse.urlencode({k: v[0] for k, v in params.items()})

        # Construir la lista de claves a probar (primero la del usuario, luego las del config.ini)
        keys_to_try = []
        if user_key and user_key.strip():
            keys_to_try.append(user_key.strip())
        keys_to_try.extend(GEMINI_KEYS)
        keys_to_try = list(dict.fromkeys(key for key in keys_to_try if key))

        if not keys_to_try:
            print("[Proxy Gemini] Error: No se proporcionó ninguna clave API de Gemini")
            return self._send_error(503, 'Falta Gemini Key')

        print(f"[Proxy Gemini] Procesando request. Claves disponibles: {len(keys_to_try)} (Usuario: {bool(user_key)})")

        last_err = None
        last_err_content = None
        for key in keys_to_try:
            if vision_deadline and time.monotonic() >= vision_deadline: break
            candidates = [suffix_path]
            if suffix_path.startswith('models/'):
                current = suffix_path.split(':', 1)[0].split('/', 1)[-1]
                if auto_vision or re.fullmatch(r'gemini-\d+(?:\.\d+)?-flash', current.lower()):
                    models = _list_gemini_vision_models(key, timeout=min(15, max(1, vision_deadline - time.monotonic()))) if auto_vision else _list_gemini_models(key)
                    candidates = [suffix_path.replace('models/' + current, 'models/' + model, 1) for model in models]
                    if not auto_vision and suffix_path not in candidates: candidates.append(suffix_path)
            for candidate in candidates:
                if vision_deadline and time.monotonic() >= vision_deadline: break
                url = f'https://generativelanguage.googleapis.com/v1beta/{candidate}?key={key}'
                if extra_qs: url += f'&{extra_qs}'
                req = urllib.request.Request(url, data=body, method='POST', headers={'Content-Type': 'application/json', 'User-Agent': UA_BROWSER})
                try:
                    timeout = min(12, max(1, vision_deadline - time.monotonic())) if vision_deadline else 30
                    with urllib.request.urlopen(req, timeout=timeout, context=_SSL_CTX) as resp:
                        print(f"[Proxy Gemini] Éxito con clave: ...{key[-6:] if len(key) > 6 else ''}")
                        return self._send_raw(200, resp.read())
                except urllib.error.HTTPError as e:
                    last_err, last_err_content = e, e.read()
                    if auto_vision and _vision_model_gone(e.code, last_err_content) and candidate.startswith('models/'):
                        _remember_retired_vision_model('gemini', candidate.split(':', 1)[0].split('/', 1)[-1])
                    if auto_vision and (_vision_model_gone(e.code, last_err_content) or e.code in (429, 500, 502, 503)):
                        continue
                    if e.code == 404 and candidate == suffix_path and suffix_path.startswith('models/'):
                        current = suffix_path.split(':', 1)[0].split('/', 1)[-1]
                        candidates.extend(suffix_path.replace('models/' + current, 'models/' + model, 1) for model in _list_gemini_models(key) if model != current and suffix_path.replace('models/' + current, 'models/' + model, 1) not in candidates)
                        continue
                    print(f"[Proxy Gemini] Error HTTP {e.code} con clave ...{key[-6:] if len(key) > 6 else ''}")
                    if e.code in (401, 403, 404, 429, 500, 502, 503): break
                    return self._send_raw(e.code, last_err_content)
                except Exception as e:
                    print(f"[Proxy Gemini] Error de conexión con clave ...{key[-6:]}: {e}")
                    last_err_content = json.dumps({'error': {'message': str(e)}}).encode()
                    break

        err_body = last_err_content if last_err_content else b'{"error": {"message": "Todas las claves fallaron"}}'
        self._send_raw(last_err.code if last_err else 503, err_body)

    def _proxy_groq(self):
        body = self._read_body()
        url = 'https://api.groq.com/openai/v1/chat/completions'
        try:
            payload = json.loads(body)
            is_vision = any(isinstance(message.get('content'), list) and any(
                isinstance(part, dict) and part.get('type') == 'image_url' for part in message['content'])
                for message in payload.get('messages', []))
        except (ValueError, TypeError, AttributeError):
            payload, is_vision = None, False
        vision_deadline = time.monotonic() + 30 if is_vision else None
        
        # Extraer key del request
        auth_header = self.headers.get('Authorization', '')
        user_key = auth_header.replace('Bearer ', '').strip() if auth_header.lower().startswith('bearer ') else None
        
        keys_to_try = []
        if user_key and user_key.strip():
            keys_to_try.append(user_key.strip())
        keys_to_try.extend(GROQ_KEYS)
        
        if not keys_to_try:
            print("[Proxy Groq] Error: No se proporcionó ninguna clave API de Groq")
            return self._send_error(503, 'Falta Groq Key')
            
        print(f"[Proxy Groq] Procesando request. Claves disponibles: {len(keys_to_try)} (Usuario: {bool(user_key)})")
        
        last_err = None
        last_err_content = None
        for key in keys_to_try:
            if vision_deadline and time.monotonic() >= vision_deadline: break
            if is_vision:
                models = _list_groq_vision_models(key, timeout=min(15, max(1, vision_deadline - time.monotonic())))
                preferred = payload.get('model')
                if preferred in models:
                    models.remove(preferred)
                    models.insert(0, preferred)
                bodies = [json.dumps({**payload, 'model': model}).encode() for model in models]
            else:
                bodies = [body]
            for request_body in bodies:
                if vision_deadline and time.monotonic() >= vision_deadline: break
                req = urllib.request.Request(url, data=request_body, method='POST', headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json', 'User-Agent': UA_BROWSER})
                try:
                    timeout = min(15, max(1, vision_deadline - time.monotonic())) if vision_deadline else 30
                    with urllib.request.urlopen(req, timeout=timeout, context=_SSL_CTX) as resp:
                        print(f"[Proxy Groq] Éxito con clave: ...{key[-6:] if len(key) > 6 else ''}")
                        return self._send_raw(200, resp.read())
                except urllib.error.HTTPError as e:
                    last_err, last_err_content = e, e.read()
                    if is_vision and _vision_model_gone(e.code, last_err_content):
                        _remember_retired_vision_model('groq', json.loads(request_body)['model'])
                    if not is_vision and e.code in (400, 404) and request_body is body:
                        try:
                            payload = json.loads(body); current = payload.get('model', '')
                            for model in _list_groq_models(key):
                                if model != current:
                                    clone = dict(payload); clone['model'] = model; bodies.append(json.dumps(clone).encode())
                        except Exception: pass
                        continue
                    print(f"[Proxy Groq] Error HTTP {e.code} con clave ...{key[-6:] if len(key) > 6 else ''}")
                    if is_vision and e.code in (400, 404, 429, 500, 502, 503): continue
                    if e.code in (400, 401, 403, 404, 429, 500, 502, 503): break
                    return self._send_raw(e.code, last_err_content)
                except Exception as e:
                    print(f"[Proxy Groq] Error de conexión con clave ...{key[-6:]}: {e}")
                    last_err_content = json.dumps({'error': {'message': str(e)}}).encode()
                    break

        err_body = last_err_content if last_err_content else b'{"error": {"message": "Todas las claves fallaron"}}'
        self._send_raw(last_err.code if last_err else 503, err_body)

    def _forward(self, req):
        try:
            with urllib.request.urlopen(req, timeout=30, context=_SSL_CTX) as resp:
                self._send_raw(200, resp.read())
        except urllib.error.HTTPError as e:
            self._send_raw(e.code, e.read())
        except Exception as e:
            self._send_json(502, {'error': {'message': str(e)}})

    def _gfonts_debug(self):
        """Diagnóstico: muestra CSS raw de GF con distintos UAs"""
        import re as _re
        results = []
        css_url = 'https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,700&display=swap'
        for ua in [self.GF_TTF_UA, UA_BROWSER, 'curl/7.68.0']:
            try:
                req = urllib.request.Request(css_url, headers={'User-Agent': ua})
                with urllib.request.urlopen(req, timeout=8, context=_SSL_CTX) as r:
                    css = r.read().decode('utf-8', errors='replace')
                    urls = _re.findall(r'url\(([^)]+)\)', css)
                    results.append(f'UA={ua[:50]}\nURLs={urls}\nCSS={css[:300]}\n')
            except Exception as e:
                results.append(f'UA={ua[:50]} ERROR={e}\n')
        body = '\n---\n'.join(results).encode('utf-8')
        self._send_raw(200, body, 'text/plain; charset=utf-8')


    def _data_extract_multi(self):
        """POST /data-extract/multi
        Body: { pdf_base64: str, account_index: int, target_cols: list[str], profile_type: str }
        Pipeline multi-fuente:
          1. Azure Document Intelligence arranca en paralelo con la rasterización
          2. Rasteriza páginas (pypdfium2)
          3. Gemini Vision (lee imágenes directamente)
          4. PyMuPDF/Tesseract OCR propio
          5. Groq consolida y produce JSON final
        """
        import base64, io, threading, time, json as _json, re as _re

        try:
            data = _json.loads(self._read_body())
        except Exception:
            return self._send_error(400, 'JSON inválido')

        pdf_b64      = data.get('pdf_base64', '')
        account_idx  = int(data.get('account_index', 0))
        target_cols  = data.get('target_cols', [])
        profile_type = data.get('profile_type', 'medico')
        name_order   = data.get('name_order', 'nombre_apellidos')
        training_examples = data.get('training_examples', [])
        gemini_api_key_body = data.get('gemini_api_key', '').strip()
        groq_api_key_body = data.get('groq_api_key', '').strip()
        openrouter_api_key_body = data.get('openrouter_api_key', '').strip()
        azure_api_key_body = data.get('azure_api_key', '').strip()
        azure_endpoint_body = data.get('azure_endpoint', '').strip()

        _effective_gemini_keys = GEMINI_KEYS if GEMINI_KEYS else ([gemini_api_key_body] if gemini_api_key_body else [])
        _effective_groq_keys = GROQ_KEYS if GROQ_KEYS else ([groq_api_key_body] if groq_api_key_body else [])
        _effective_azure_keys = AZURE_KEYS if AZURE_KEYS else ([azure_api_key_body] if azure_api_key_body else [])
        _effective_azure_endpoints = AZURE_ENDPOINTS if AZURE_ENDPOINTS else ([azure_endpoint_body] if azure_endpoint_body else [])

        if not pdf_b64:
            return self._send_error(400, 'pdf_base64 requerido')
        try:
            pdf_bytes = base64.b64decode(pdf_b64)
        except Exception:
            return self._send_error(400, 'pdf_base64 inválido')

        # ── 1. AZURE (arranca ya, en paralelo con la rasterización que sigue) ──
        azure_fields = []
        azure_paragraphs = []
        def run_azure():
            nonlocal azure_fields, azure_paragraphs
            try:
                import urllib.request, ssl
                if not _effective_azure_keys or not _effective_azure_endpoints or account_idx >= len(_effective_azure_keys):
                    print("[DEX Multi] Azure: sin key"); return
                api_key  = _effective_azure_keys[account_idx]
                endpoint = _effective_azure_endpoints[account_idx].rstrip('/')
                analyze_url = f'{endpoint}/documentintelligence/documentModels/prebuilt-layout:analyze?api-version=2024-11-30'
                req = urllib.request.Request(analyze_url, data=pdf_bytes,
                    headers={'Ocp-Apim-Subscription-Key': api_key, 'Content-Type': 'application/pdf'}, method='POST')
                ctx = _SSL_CTX
                with urllib.request.urlopen(req, context=ctx, timeout=12) as resp:
                    op_url = resp.headers.get('Operation-Location', '')
                if not op_url: return
                result = None
                for _ in range(6):
                    time.sleep(1.5)
                    pr = urllib.request.Request(op_url, headers={'Ocp-Apim-Subscription-Key': api_key}, method='GET')
                    with urllib.request.urlopen(pr, context=ctx, timeout=10) as r:
                        result = _json.loads(r.read())
                    if result.get('status') == 'succeeded': break
                    elif result.get('status') in ('failed','canceled'): return
                if not result or result.get('status') != 'succeeded': return
                ar = result.get('analyzeResult', {})
                paras = ar.get('paragraphs', [])
                azure_paragraphs = [p.get('content','').strip() for p in paras if p.get('content','').strip()]
                kvs = ar.get('keyValuePairs', [])
                if kvs:
                    for kv in kvs:
                        k = kv.get('key',{}).get('content','').strip()
                        v = kv.get('value',{}).get('content','').strip() if kv.get('value') else ''
                        if k: azure_fields.append({'key': k, 'value': v, 'confidence': round(kv.get('confidence',0), 3)})
                else:
                    seen = set()
                    texts = azure_paragraphs[:]
                    i = 0
                    while i < len(texts):
                        t = texts[i]
                        if len(t) > 300: i+=1; continue
                        m = _re.match(r'^(.+?)(?:\s*:{1,2}\s*|\t+|\s{2,})(.*)$', t)
                        if m:
                            k = m.group(1).strip().rstrip(':').strip()
                            v = m.group(2).strip()
                            if k and len(k) < 80 and k not in seen:
                                seen.add(k)
                                azure_fields.append({'key': k, 'value': v, 'confidence': 0.85})
                        elif 3 < len(t) < 60 and t not in seen:
                            seen.add(t)
                            azure_fields.append({'key': t, 'value': '', 'confidence': 0.5})
                        i += 1
                print(f"[DEX Multi] Azure: {len(azure_fields)} campos, {len(azure_paragraphs)} párrafos")
            except Exception as e:
                print(f"[DEX Multi] Azure error: {e}")

        azure_thread = threading.Thread(target=run_azure)
        azure_thread.start()

        # ── 2. RASTERIZAR PÁGINAS (corre en el hilo principal) ──
        page_images_b64 = []
        raster_error = None
        MAX_PAGES = 8
        try:
            import fitz
            with fitz.open(stream=pdf_bytes, filetype='pdf') as doc:
                for i in range(min(doc.page_count, MAX_PAGES)):
                    page = doc[i]
                    mat  = fitz.Matrix(100/72, 100/72)
                    pix  = page.get_pixmap(matrix=mat, alpha=False)
                    from PIL import Image as _PIL
                    img  = _PIL.frombytes('RGB', [pix.width, pix.height], pix.samples)
                    buf  = io.BytesIO()
                    img.save(buf, format='JPEG', quality=75)
                    page_images_b64.append(base64.b64encode(buf.getvalue()).decode())
            print(f"[DEX Multi] {len(page_images_b64)} páginas rasterizadas (PyMuPDF)")
        except Exception as e:
            try:
                import pypdfium2 as pdfium
                doc = pdfium.PdfDocument(pdf_bytes)
                for i in range(min(len(doc), MAX_PAGES)):
                    page = doc[i]
                    bitmap = page.render(scale=100/72)
                    pil_img = bitmap.to_pil()
                    buf = io.BytesIO()
                    pil_img.save(buf, format='JPEG', quality=75)
                    page_images_b64.append(base64.b64encode(buf.getvalue()).decode())
                doc.close()
                print(f"[DEX Multi] {len(page_images_b64)} páginas rasterizadas (pypdfium2)")
            except Exception as e2:
                raster_error = f'fitz: {e} | pdfium: {e2}'
                print(f"[DEX Multi] Rasterización fallida: {e2}")

        # ── 3. GEMINI VISION ──────────────────────────────────────────────
        gemini_text = ''
        gemini_error = None
        def run_gemini_vision():
            nonlocal gemini_text, gemini_error
            if not page_images_b64:
                gemini_error = 'sin imágenes rasterizadas'
                print("[DEX Multi] Gemini Vision: sin imágenes"); return
            if not _effective_gemini_keys:
                gemini_error = 'sin API key (config.ini ni frontend)'
                print("[DEX Multi] Gemini Vision: sin key (ni config.ini ni frontend)"); return
            print(f"[DEX Multi] Gemini Vision: {len(_effective_gemini_keys)} clave(s), {len(page_images_b64)} páginas")
            import urllib.request, ssl
            parts = []
            for i, img_b64 in enumerate(page_images_b64[:8]):
                parts.append({"inline_data": {"mime_type": "image/jpeg", "data": img_b64}})
            parts.append({"text": f"""Analiza estas páginas de un formulario o documento.
Extrae TODOS los campos de texto llenados y datos clave.
Presta especial atención a:
- Nombre completo del titular/paciente (Apellido Paterno, Apellido Materno, Nombre(s))
- Fecha de nacimiento, edad, sexo, estado civil
- Signos vitales, diagnósticos, resultados numéricos y valores de laboratorio
- Alergias, observaciones, notas
Responde en formato JSON: {{"campo": "valor"}}
Solo incluye campos con valor llenado."""})
            body = _json.dumps({"contents": [{"parts": parts}]}).encode()
            try:
                resp_data, model_name = _gemini_generate_json(body, _effective_gemini_keys, timeout=7)
                text = resp_data.get('candidates',[{}])[0].get('content',{}).get('parts',[{}])[0].get('text','')
                if text:
                    gemini_text = text
                    print(f"[DEX Multi] Gemini Vision OK ({model_name}): {len(text)} chars")
                    return
            except Exception as e:
                gemini_error = str(e)
                print(f"[DEX Multi] Gemini Vision error: {e}")

        # ── 4. EXTRACCIÓN DE TEXTO / OCR ──────────────────────────────────
        ocr_text = ''
        ocr_error = None
        def run_ocr():
            nonlocal ocr_text, ocr_error
            # 4a. Extraer texto nativo directo con PyMuPDF (1 ms para PDFs vectoriales)
            try:
                import fitz
                with fitz.open(stream=pdf_bytes, filetype='pdf') as doc:
                    direct_texts = []
                    for p in doc:
                        txt = p.get_text().strip()
                        if txt: direct_texts.append(txt)
                if direct_texts:
                    ocr_text = '\n\n--- PÁGINA SIGUIENTE ---\n\n'.join(direct_texts)
                    print(f"[DEX Multi] PyMuPDF texto nativo extraído: {len(ocr_text)} chars")
                    return
            except Exception as e_fitz:
                print(f"[DEX Multi] PyMuPDF extract: {e_fitz}")

            if not page_images_b64:
                ocr_error = 'sin imágenes rasterizadas'
                return
            try:
                from paddleocr import PaddleOCR
                from PIL import Image
                import io as _io, numpy as _np
                global _paddle_ocr_engine
                if _paddle_ocr_engine is None:
                    det_dir = os.path.join(base_dir, 'libs', 'paddleocr_models', 'det')
                    rec_dir = os.path.join(base_dir, 'libs', 'paddleocr_models', 'rec')
                    cls_dir = os.path.join(base_dir, 'libs', 'paddleocr_models', 'cls')
                    kwargs = {
                        'use_angle_cls': True,
                        'lang': 'es',
                        'show_log': False,
                        'use_gpu': False
                    }
                    if os.path.exists(det_dir): kwargs['det_model_dir'] = det_dir
                    if os.path.exists(rec_dir): kwargs['rec_model_dir'] = rec_dir
                    if os.path.exists(cls_dir): kwargs['cls_model_dir'] = cls_dir
                    _paddle_ocr_engine = PaddleOCR(**kwargs)
                _ocr_engine = _paddle_ocr_engine
                texts = []
                for img_b64 in page_images_b64[:20]:
                    img = Image.open(_io.BytesIO(base64.b64decode(img_b64))).convert('RGB')
                    img_np = _np.array(img)
                    result = _ocr_engine.ocr(img_np, cls=True)
                    page_lines = []
                    if result and result[0]:
                        for line in result[0]:
                            if line and len(line) >= 2:
                                text_info = line[1]
                                if text_info and len(text_info) >= 2 and text_info[1] > 0.5:
                                    page_lines.append(text_info[0])
                    texts.append('\n'.join(page_lines))
                ocr_text = '\n\n--- PÁGINA SIGUIENTE ---\n\n'.join(texts)
                print(f"[DEX Multi] PaddleOCR: {len(ocr_text)} chars extraídos")
            except Exception as e:
                # Fallback a Tesseract si PaddleOCR falla
                try:
                    import pytesseract, shutil as _shutil
                    _tess_paths = [
                        os.path.join(base_dir, 'Tesseract-OCR', 'tesseract.exe'),
                        _shutil.which('tesseract'),
                        r'C:\Program Files\Tesseract-OCR\tesseract.exe',
                        r'C:\Program Files (x86)\Tesseract-OCR\tesseract.exe',
                        os.path.expandvars(r'%LOCALAPPDATA%\Programs\Tesseract-OCR\tesseract.exe'),
                    ]
                    _tess_cmd = next((p for p in _tess_paths if p and os.path.isfile(p)), None)
                    if _tess_cmd:
                        pytesseract.pytesseract.tesseract_cmd = _tess_cmd
                        from PIL import Image
                        import io as _io
                        texts = []
                        for img_b64 in page_images_b64[:20]:
                            img = Image.open(_io.BytesIO(base64.b64decode(img_b64)))
                            t = pytesseract.image_to_string(img, lang='spa', config='--psm 6')
                            texts.append(t)
                        ocr_text = '\n\n--- PÁGINA SIGUIENTE ---\n\n'.join(texts)
                        print(f"[DEX Multi] Tesseract fallback: {len(ocr_text)} chars")
                except Exception as e2:
                    ocr_error = f'OCR no disponible: {e2}'

        # Gemini y OCR arrancan aquí (necesitan page_images_b64 ya listo); Azure ya viene corriendo desde antes
        threads = [
            azure_thread,
            threading.Thread(target=run_gemini_vision),
            threading.Thread(target=run_ocr),
        ]
        for t in threads:
            if t is not azure_thread: t.start()
        for t in threads: t.join(timeout=10)

        # ── 5. GROQ CONSOLIDACIÓN ─────────────────────────────────────────
        # Construir contexto consolidado para Groq
        azure_summary = '\n'.join(f'{f["key"]}: {f["value"]}' for f in azure_fields if f.get('value')) if azure_fields else 'No disponible'
        ocr_summary   = ocr_text if ocr_text else 'No disponible'
        gemini_summary = gemini_text if gemini_text else 'No disponible'

        cols_str = ', '.join(target_cols) if target_cols else 'NOMBRE, FECHA DE NACIMIENTO, SEXO, PESO, TALLA, TA, GLUC, CHOL, TRIG, EDO CIVIL, ESCOLARIDAD, OIDO DERECHO, OIDO IZQUIERDO, ESPIROMETRIA, ALERGIAS'

        # Si gemini_text es JSON, incluir también su versión parseada legible
        gemini_display = gemini_summary
        try:
            import re as _re2
            _gs = gemini_text.find('{'); _ge = gemini_text.rfind('}')
            if _gs >= 0 and _ge >= 0:
                _gj = _json.loads(gemini_text[_gs:_ge+1])
                gemini_display = '\n'.join(f'{k}: {v}' for k,v in _gj.items() if v)
        except Exception:
            pass

        # Construir bloque few-shot si hay ejemplos de entrenamiento
        few_shot_block = ''
        if training_examples:
            lines = ['=== PATRONES DE CORRECCIÓN APRENDIDOS (aplícalos SOLO si el contexto OCR actual coincide) ===']
            for ex in training_examples[:20]:  # máx 20 ejemplos
                campo    = str(ex.get('campo','')).strip()
                original = str(ex.get('valor_original','')).strip()
                correcto = str(ex.get('valor_correcto','')).strip()
                ctx      = str(ex.get('contexto_ocr','')).strip()[:200]
                if not (campo and correcto):
                    continue
                if ctx:
                    lines.append(
                        f'- Campo "{campo}": cuando el texto OCR alrededor se parezca a "{ctx}", '
                        f'el patrón de corrección observado fue "{original}" -> "{correcto}". '
                        f'Busca ese MISMO patrón (formato, abreviación, ubicación relativa a etiquetas vecinas) '
                        f'en el documento actual; NO copies el valor literal si el paciente/dato es distinto.'
                    )
                elif campo and correcto:
                    lines.append(f'- Campo "{campo}": formato/regla observada -> "{correcto}" (sin contexto asociado, usar con precaución).')
            few_shot_block = '\n'.join(lines) + '\n\n'


        groq_prompt = f"""Eres un experto en extracción de datos de formularios médicos.
{few_shot_block}Tienes los resultados de 3 fuentes independientes para el MISMO documento:

=== FUENTE 1: Azure Document Intelligence (OCR estructurado) ===
{azure_summary}

=== FUENTE 2: Gemini Vision (análisis de imagen) ===
{gemini_display}

=== FUENTE 3: OCR propio (PaddleOCR — escritura a mano) ===
{ocr_summary}

Columnas destino del Excel: {cols_str}

INSTRUCCIONES:
1. Compara las 3 fuentes y elige el valor más confiable para cada campo.
2. Para NOMBRE: busca el nombre COMPLETO en todas las fuentes. Revisa campos como "Paciente", "Nombre completo", "Nombre del trabajador", y también "Apellido Paterno"+"Apellido Materno"+"Nombre(s)" por separado. Si un campo contiene 2+ palabras (ej. "RODRIGUEZ ARISTA"), puede ser apellidos — busca el nombre de pila en otro campo y concaténalos. {"Orden de salida: NOMBRE APELLIDO1 APELLIDO2." if name_order == "nombre_apellidos" else "Orden de salida: APELLIDO1 APELLIDO2 NOMBRE."} NUNCA devuelvas solo una palabra como nombre completo.
3. Para fechas: formato DD/MM/YYYY.
4. Para TA (columna TA en Excel): busca "P.A.", "PA:", "PRESION ARTERIAL", "TENSION ARTERIAL" o "TA" en CUALQUIER fuente. El valor es sistólica/diastólica (ej. "130/90"). Devuelve solo los números con barra.
5. Para CHOL: busca "CHOL", "COLESTEROL", "COLESTEROL TOTAL" en CUALQUIER fuente (mayúsc/minúsc). Solo el número sin unidades (ej. "161").
6. Para GLUC: busca "GLUC", "GLUCOSA", "GLUCOSA BASAL", "GLICEMIA". Para TRIG: busca "TRIG", "TRIGLICERIDOS", "TRIGS". Solo el número sin unidades.
6b. Para AC URICO: busca "AC URICO", "ACIDO URICO", "A. URICO", "AU", "ACID URIC". Para Hemoglobina Glucosilada: busca "HBA1C", "HB A1C", "HEMOGLOBINA GLICADA", "HEMOGLOBINA GLUCOSILADA", "HEMOGLOBINA GLICOSILADA". Solo el número sin unidades.
7. Para SEXO: solo "MASCULINO" o "FEMENINO".
8. Para EDO CIVIL: identifica cuál letra está marcada (✓, X, selected, o cualquier marca visible junto a S/C/UL/V). S=marcado -> "SOLTERO (A)". C=marcado -> "CASADO (A)". UL=marcado -> "UNION LIBRE". V=marcado -> "VIUDO (A)". Si el documento ya trae la palabra completa, normalízala a ese mismo formato.
9. Para ESCOLARIDAD: "BÁSICA", "MEDIA", "TECNICO", "LICENCIATURA" o "POSTGRADO".
10. Para ESPIROMETRIA: solo si hay resultado EXPLÍCITO (NORMAL, PATRON RESTRICTIVO, PATRON OBSTRUCTIVO, ESTUDIO DENTRO DE LIMITES NORMALES). Si no hay resultado claro, usa "".
11. Para OIDO DERECHO/IZQUIERDO: solo si hay resultado EXPLÍCITO de audiometría. Si no, usa "".
12. No inventes valores. Si no hay dato claro en ninguna fuente, usa "".
13. Para PESO: solo el número en kg, sin unidades ni texto (ej. "67", no "67 kg" ni ", kg"). Para TALLA: solo el número en metros con decimal (ej. "1.83", no "1.83 metros"). Si TALLA viene en cm (ej. 183), conviértelo a metros (1.83).
14. Responde ÚNICAMENTE con JSON plano: {{"COLUMNA": "valor"}}"""

        groq_result = {}
        if _effective_groq_keys:
            try:
                key = _effective_groq_keys[0]
                body_groq = _json.dumps({
                    "model": "llama-3.3-70b-versatile",
                    "messages": [{"role": "user", "content": groq_prompt}],
                    "max_tokens": 1024,
                    "temperature": 0,
                    "response_format": {"type": "json_object"}
                }).encode()
                import urllib.request, ssl
                req_g = urllib.request.Request(
                    'https://api.groq.com/openai/v1/chat/completions',
                    data=body_groq, method='POST',
                    headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {key}'}
                )
                ctx = _SSL_CTX
                with urllib.request.urlopen(req_g, context=ctx, timeout=30) as r:
                    gd = _json.loads(r.read())
                raw = gd.get('choices',[{}])[0].get('message',{}).get('content','')
                s = raw.find('{'); e = raw.rfind('}')
                if s >= 0 and e >= 0:
                    groq_result = _json.loads(raw[s:e+1])
                    print(f"[DEX Multi] Groq consolidado: {len(groq_result)} campos")
            except Exception as e:
                print(f"[DEX Multi] Groq error: {e}")
        elif openrouter_api_key_body:
            try:
                body_or = _json.dumps({
                    "model": "meta-llama/llama-3.3-70b-instruct",
                    "messages": [{"role": "user", "content": groq_prompt}],
                    "temperature": 0
                }).encode()
                import urllib.request, ssl
                req_or = urllib.request.Request(
                    'https://openrouter.ai/api/v1/chat/completions',
                    data=body_or, method='POST',
                    headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {openrouter_api_key_body}'}
                )
                ctx = _SSL_CTX
                with urllib.request.urlopen(req_or, context=ctx, timeout=30) as r:
                    gd = _json.loads(r.read())
                raw = gd.get('choices',[{}])[0].get('message',{}).get('content','')
                s = raw.find('{'); e = raw.rfind('}')
                if s >= 0 and e >= 0:
                    groq_result = _json.loads(raw[s:e+1])
                    print(f"[DEX Multi] OpenRouter consolidado: {len(groq_result)} campos")
            except Exception as e:
                print(f"[DEX Multi] OpenRouter error: {e}")

        # Si Groq no respondió, usar Azure como fallback
        if not groq_result and azure_fields:
            for f in azure_fields:
                if f.get('value'):
                    groq_result[f['key']] = f['value']

        # Si Groq tampoco y Gemini Vision devolvió JSON, usarlo
        if not groq_result and gemini_text:
            try:
                _gs = gemini_text.find('{'); _ge = gemini_text.rfind('}')
                if _gs >= 0 and _ge >= 0:
                    groq_result = _json.loads(gemini_text[_gs:_ge+1])
                    print(f"[DEX Multi] Usando Gemini Vision JSON como fallback: {len(groq_result)} campos")
            except Exception:
                pass

        # Si Groq y Azure fallaron pero tenemos Gemini key y texto OCR / PyMuPDF:
        if not groq_result and _effective_gemini_keys and ocr_text:
            try:
                gem_body = _json.dumps({
                    "contents": [{"parts": [{"text": groq_prompt + f"\n\nTEXTO EXTRAÍDO:\n{ocr_text[:8000]}"}]}],
                    "generationConfig": {"temperature": 0}
                }).encode()
                g_data, model_name = _gemini_generate_json(gem_body, _effective_gemini_keys, timeout=12)
                raw_g = g_data.get('candidates',[{}])[0].get('content',{}).get('parts',[{}])[0].get('text','')
                s = raw_g.find('{'); e = raw_g.rfind('}')
                if s >= 0 and e >= 0:
                    groq_result = _json.loads(raw_g[s:e+1])
                    print(f"[DEX Multi] Gemini texto consolidado ({model_name}): {len(groq_result)} campos")
            except Exception as e_gem:
                print(f"[DEX Multi] Gemini texto error: {e_gem}")

        # Fallback heurístico si no hay conexión a APIs externas
        if not groq_result and ocr_text:
            for line in ocr_text.split('\n'):
                m = _re.match(r'^\s*([A-Za-zÁÉÍÓÚáéíóúÑñ\s\.\-_/]+?)\s*[:=]\s*(.+?)\s*$', line)
                if m:
                    k, v = m.group(1).strip(), m.group(2).strip()
                    if 2 <= len(k) <= 40 and v:
                        groq_result[k] = v

        # Construir fields en formato compatible con el frontend
        merged_fields = [{'key': k, 'value': str(v), 'confidence': 0.95}
                         for k, v in groq_result.items() if v]
        # Agregar campos de Azure que Groq no cubrió
        groq_keys_lower = {k.lower() for k in groq_result}
        for af in azure_fields:
            if af.get('key','').lower() not in groq_keys_lower and af.get('value'):
                merged_fields.append(af)

        return self._send_json(200, {
            'fields': merged_fields,
            'paragraphs': azure_paragraphs,
            'provider': 'Multi-Source (Azure + Gemini Vision + OCR + Groq)',
            'total': len(merged_fields),
            'sources': {
                'azure_fields': len(azure_fields),
                'gemini_chars': len(gemini_text),
                'ocr_chars': len(ocr_text),
                'groq_fields': len(groq_result),
                'pages_rasterized': len(page_images_b64),
                'raster_error': raster_error,
                'gemini_error': gemini_error,
                'ocr_error': ocr_error,
            },
            'raw_texts': {
                'azure':  azure_summary,
                'gemini': gemini_summary,
                'ocr':    ocr_summary,
            }
        })

    def _data_extract_azure(self):
        """POST /data-extract/azure
        Body: { pdf_base64: str, account_index: int (0-based) }
        Retorna: { fields: [{key, value, confidence}], provider: str }
        """
        try:
            data = json.loads(self._read_body())
        except Exception:
            return self._send_error(400, 'JSON inválido')

        idx = int(data.get('account_index', 0))
        if not AZURE_KEYS or idx >= len(AZURE_KEYS):
            return self._send_error(503, 'Azure API Key no configurada. Configúrala en Preferencias > API Keys.')
        if not AZURE_ENDPOINTS or idx >= len(AZURE_ENDPOINTS):
            return self._send_error(503, 'Azure Endpoint no configurado. Configúralo en Preferencias > API Keys.')

        api_key  = AZURE_KEYS[idx]
        endpoint = AZURE_ENDPOINTS[idx].rstrip('/')

        pdf_b64 = data.get('pdf_base64', '')
        if not pdf_b64:
            return self._send_error(400, 'pdf_base64 requerido')

        try:
            pdf_bytes = __import__('base64').b64decode(pdf_b64)
        except Exception:
            return self._send_error(400, 'pdf_base64 inválido')

        # 1. Iniciar análisis (POST)
        analyze_url = f'{endpoint}/documentintelligence/documentModels/prebuilt-layout:analyze?api-version=2024-11-30'
        req = urllib.request.Request(
            analyze_url,
            data=pdf_bytes,
            headers={
                'Ocp-Apim-Subscription-Key': api_key,
                'Content-Type': 'application/pdf',
            },
            method='POST'
        )
        try:
            ctx = _SSL_CTX
            with urllib.request.urlopen(req, context=ctx, timeout=30) as resp:
                operation_url = resp.headers.get('Operation-Location', '')
        except urllib.error.HTTPError as e:
            body = e.read().decode('utf-8', errors='replace')
            return self._send_error(502, f'Azure error {e.code}: {body[:300]}')
        except Exception as e:
            return self._send_error(502, f'Error conectando a Azure: {e}')

        if not operation_url:
            return self._send_error(502, 'Azure no devolvió Operation-Location')

        # 2. Polling hasta completar (máx 60s)
        result = None
        for _ in range(20):
            time.sleep(3)
            poll_req = urllib.request.Request(
                operation_url,
                headers={'Ocp-Apim-Subscription-Key': api_key},
                method='GET'
            )
            try:
                ctx = _SSL_CTX
                with urllib.request.urlopen(poll_req, context=ctx, timeout=15) as r:
                    result = json.loads(r.read().decode('utf-8'))
            except Exception as e:
                return self._send_error(502, f'Error en polling Azure: {e}')

            status = result.get('status', '')
            if status == 'succeeded':
                break
            elif status in ('failed', 'canceled'):
                err = result.get('error', {})
                return self._send_error(502, f"Azure falló: {err.get('message', status)}")
            # 'running' o 'notStarted' → seguir esperando

        if not result or result.get('status') != 'succeeded':
            return self._send_error(504, 'Azure timeout — el análisis tardó más de 60s')

        # 3. Extraer key-value pairs
        # prebuilt-layout (F0) no devuelve keyValuePairs; se extraen desde párrafos
        # usando el patrón "Clave: Valor" o "Clave  Valor" (separador tab/múltiples espacios)
        fields = []
        import re as _re
        try:
            ar = result.get('analyzeResult', {})
            kvs = ar.get('keyValuePairs', [])
            if kvs:
                # prebuilt-document / S0 — tiene keyValuePairs nativo
                for kv in kvs:
                    key_content = kv.get('key',   {}).get('content', '').strip()
                    val_content = kv.get('value', {}).get('content', '').strip() if kv.get('value') else ''
                    confidence  = kv.get('confidence', 0)
                    if key_content:
                        fields.append({'key': key_content, 'value': val_content, 'confidence': round(confidence, 3)})
            else:
                # prebuilt-layout / F0 — parsear desde párrafos de forma inteligente
                paragraphs = ar.get('paragraphs', [])
                seen_keys = set()
                
                # Obtener todos los textos de párrafos no vacíos
                para_texts = [p.get('content', '').strip() for p in paragraphs if p.get('content', '').strip()]
                
                i = 0
                while i < len(para_texts):
                    text = para_texts[i]
                    if len(text) > 300:
                        i += 1
                        continue
                    
                    # 1. Separadores: ":", "::", tabulación, 2+ espacios
                    m = _re.match(r'^(.+?)(?:\s*:{1,2}\s*|	+|\s{2,})(.*)$', text)
                    if m:
                        k = m.group(1).strip().rstrip(':').strip()
                        v = m.group(2).strip()
                        if k and len(k) < 80:
                            # Si el valor está vacío en la misma línea, intentar tomar la siguiente línea como valor
                            if not v and i + 1 < len(para_texts):
                                next_text = para_texts[i+1]
                                # Si la siguiente línea es relativamente corta y no parece otra clave
                                if len(next_text) < 50 and not _re.search(r'[:\t]|\s{2,}', next_text):
                                    v = next_text
                                    i += 1 # Consumir la siguiente línea
                            if k not in seen_keys:
                                seen_keys.add(k)
                                fields.append({'key': k, 'value': v, 'confidence': 0.85})
                        i += 1
                        continue
                    
                    # 2. Si la línea termina en dos o tres puntos, o colon, o es un campo conocido
                    is_known_key = text.rstrip(':').strip().lower() in ('peso', 'talla', 'estatura', 'sexo', 'edad', 'nombre', 'estado civil', 'edo civil', 'p.a', 't.a', 'glucosa', 'gluc', 'temp')
                    if (text.endswith(':') or is_known_key) and len(text) < 50:
                        k = text.rstrip(':').strip()
                        v = ''
                        if i + 1 < len(para_texts):
                            next_text = para_texts[i+1]
                            if len(next_text) < 50 and not (next_text.endswith(':') or next_text.rstrip(':').strip().lower() in ('peso', 'talla', 'estatura', 'sexo', 'edad', 'nombre')):
                                v = next_text
                                i += 1 # Consumir la siguiente línea
                        if k not in seen_keys:
                            seen_keys.add(k)
                            fields.append({'key': k, 'value': v, 'confidence': 0.85})
                        i += 1
                        continue
                    
                    # 3. Línea genérica (sin separador y sin ser campo conocido)
                    if 3 < len(text) < 60 and not text[0].isdigit():
                        if text not in seen_keys:
                            seen_keys.add(text)
                            fields.append({'key': text, 'value': '', 'confidence': 0.5})
                    i += 1
        except Exception as e:
            return self._send_error(502, f'Error parseando respuesta Azure: {e}')

        return self._send_json(200, {
            'fields': fields,
            'paragraphs': [p.get('content', '').strip() for p in paragraphs if p.get('content', '').strip()],
            'provider': f'Azure Document Intelligence (cuenta {idx+1})',
            'total': len(fields)
        })

    def _save_config(self):
        """POST /save-config — guarda keys en config.ini. Solo secciones permitidas."""
        try:
            data = json.loads(self._read_body())
        except Exception:
            return self._send_error(400, 'JSON inválido')

        ALLOWED_SECTIONS = {'azure', 'amazon_textract', 'huggingface', 'openrouter', 'nvidia', 'general', 'preferences', 'security'}
        section = data.get('section', '').lower()
        if section not in ALLOWED_SECTIONS:
            return self._send_error(400, 'Sección no permitida')

        cfg = configparser.ConfigParser()
        ini_path = get_config_path()
        if os.path.exists(ini_path):
            cfg.read(ini_path, encoding='utf-8')

        if not cfg.has_section(section):
            cfg.add_section(section)

        for k, v in data.get('values', {}).items():
            # Solo claves alfanuméricas con guiones bajos
            if k.replace('_', '').isalnum():
                if v:
                    cfg.set(section, k, str(v))
                elif cfg.has_option(section, k):
                    cfg.remove_option(section, k)

        with open(ini_path, 'w', encoding='utf-8') as f:
            cfg.write(f)

        # Recargar keys en memoria
        global _CFG, AZURE_KEYS, AZURE_ENDPOINTS
        _CFG = load_config()
        AZURE_KEYS      = [v.strip() for k, v in _CFG.items('azure') if k.startswith('api_key') and v.strip()] if _CFG.has_section('azure') else []
        AZURE_ENDPOINTS = [v.strip() for k, v in _CFG.items('azure') if k.startswith('endpoint') and v.strip()] if _CFG.has_section('azure') else []

        return self._send_json(200, {'ok': True})

    def _read_body(self):
        length = int(self.headers.get('Content-Length', 0))
        if length < 0 or length > MAX_REQUEST_BODY_BYTES:
            raise ValueError('La carga excede el límite de 100 MB')
        return self.rfile.read(length)

    def _serve_local_pdf(self):
        """GET /open-file?path=C%3A%5Cfoo%5Cbar.pdf — sirve un PDF local."""
        try:
            parsed = urllib.parse.urlparse(self.path)
            qs = urllib.parse.parse_qs(parsed.query)
            raw_path = qs.get('path', [None])[0]
            if not raw_path:
                return self._send_error(400, 'Falta parámetro path')
            file_path = os.path.normpath(raw_path)
            if not self._is_safe_path(file_path) or not os.path.isfile(file_path):
                return self._send_error(404, f'Archivo no encontrado: {file_path}')
            ALLOWED_EXTS = {
                '.pdf': 'application/pdf',
                '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                '.doc': 'application/msword',
                '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                '.xls': 'application/vnd.ms-excel',
                '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                '.ppt': 'application/vnd.ms-powerpoint',
                '.png': 'image/png',
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.webp': 'image/webp'
            }
            ext = os.path.splitext(file_path)[1].lower()
            if ext not in ALLOWED_EXTS:
                return self._send_error(403, f'Formato no soportado: {ext}')
            with open(file_path, 'rb') as f:
                content = f.read()
            self._send_raw(200, content, ALLOWED_EXTS[ext])
        except Exception as e:
            print(f"[open-file] Error: {e}")
            self._send_error(500, str(e))

    def _handle_save_transfer_payload(self):
        """POST /transfer-payload?token=... — Conserva temporalmente el payload en disco."""
        try:
            parsed = urllib.parse.urlparse(self.path)
            qs = urllib.parse.parse_qs(parsed.query)
            token = qs.get('token', [None])[0]
            body = self._read_body()
            if not token and body:
                try:
                    data = json.loads(body.decode('utf-8'))
                    token = data.get('token')
                except Exception:
                    pass
            if not token:
                token = 'last_transfer'
            _TRANSFER_STORE.put(token, body)
            return self._send_json(200, {'ok': True, 'token': token})
        except ValueError:
            return self._send_json(503, {'error': 'TRANSFER_STORE_BUSY'})
        except Exception as e:
            print(f"[transfer-payload save] Error: {e}")
            return self._send_json(500, {'error': str(e)})

    def _handle_get_transfer_payload(self):
        """GET /transfer-payload?token=... — Recupera el payload de transferencia."""
        try:
            parsed = urllib.parse.urlparse(self.path)
            qs = urllib.parse.parse_qs(parsed.query)
            token = qs.get('token', [None])[0] or 'last_transfer'
            payload = _TRANSFER_STORE.get(token)
            if payload is not None:
                return self._send_raw(200, payload, 'application/json')
            return self._send_json(404, {'error': 'Payload de transferencia no encontrado'})
        except Exception as e:
            print(f"[transfer-payload get] Error: {e}")
            return self._send_json(500, {'error': str(e)})

    def _handle_tab_events(self):
        """GET /api/tab-events?client_id=... — SSE stream para recibir apertura de pestañas en caliente."""
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        client_id = qs.get('client_id', [None])[0] or f"client_{int(time.time()*1000)}"

        q = queue.Queue()
        with _CLIENTS_LOCK:
            _EVENT_QUEUES[client_id] = q
            global _LAST_ACTIVE_CLIENT
            _LAST_ACTIVE_CLIENT = client_id

        try:
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', self._get_cors_origin())
            self.send_header('Content-Type', 'text/event-stream')
            self.send_header('Cache-Control', 'no-cache, no-transform')
            self.send_header('Connection', 'keep-alive')
            self.send_header('X-Accel-Buffering', 'no')
            self.end_headers()
            init_msg = json.dumps({'action': 'connected', 'client_id': client_id})
            self.wfile.write(f"data: {init_msg}\n\n".encode('utf-8'))
            self.wfile.flush()
            while True:
                try:
                    msg = q.get(timeout=15.0)
                    self.wfile.write(f"data: {json.dumps(msg)}\n\n".encode('utf-8'))
                except queue.Empty:
                    self.wfile.write(b": ping\n\n")
                self.wfile.flush()
        except Exception:
            pass
        finally:
            with _CLIENTS_LOCK:
                if _EVENT_QUEUES.get(client_id) is q:
                    _EVENT_QUEUES.pop(client_id, None)
                    if _LAST_ACTIVE_CLIENT == client_id:
                        _LAST_ACTIVE_CLIENT = next(iter(_EVENT_QUEUES.keys()), None)
                    _NATIVE_SAVE_STORE.revoke_session(client_id)

    def _handle_browser_migration(self):
        parsed = urllib.parse.urlparse(self.path)
        action = parsed.path.rsplit('/', 1)[-1]
        query = urllib.parse.parse_qs(parsed.query)
        token = query.get('token', [''])[0]
        try:
            if action == 'start' and self.command == 'POST':
                token = browser_migration.start(f'http://127.0.0.1:{_ACTIVE_PORT}')
                return self._send_json(200, {'token': token})
            if action == 'next' and self.command == 'GET':
                return self._send_json(200, browser_migration.receive(token, int(query.get('sequence', ['0'])[0])))
            if action == 'ready' and self.command == 'POST':
                browser_migration.exporter_ready(token)
                return self._send_json(200, {'ok': True})
            if action == 'packet' and self.command == 'POST':
                body = self._read_body()
                if len(body) > 12 * 1024 * 1024:
                    return self._send_json(413, {'ok': False})
                browser_migration.publish(token, json.loads(body))
                return self._send_json(200, {'ok': True})
            if action == 'finish' and self.command == 'POST':
                browser_migration._session(token)
                payload = json.loads(self._read_body() or b'{}')
                storage = payload.get('storage', {})
                if not isinstance(storage, dict):
                    raise ValueError('INVALID_PREFERENCES')
                preferences = {key: value for key, value in storage.items() if preference_key(key)}
                if preferences:
                    _USER_PREFERENCES.update(preferences)
                browser_migration.finish(token)
                return self._send_json(200, {'ok': True})
            if action == 'legacy' and self.command == 'POST':
                browser = browser_migration.legacy_browser()
                if browser:
                    arguments = [str(browser), f'--app=http://127.0.0.1:{_ACTIVE_PORT}/BASE.html']
                    if browser_migration.profile:
                        arguments.append('--user-data-dir=' + str(browser_migration.profile))
                    browser_migration._launch(arguments, browser.parent)
                return self._send_json(200, {'ok': bool(browser)})
            return self._send_json(405, {'ok': False})
        except queue.Empty:
            return self._send_json(202, {'waiting': True})
        except queue.Full:
            return self._send_json(503, {'ok': False})
        except KeyError:
            return self._send_json(404, {'ok': False, 'error': 'MIGRATION_EXPIRED'})
        except (ValueError, TypeError, OSError) as error:
            code = str(error) if str(error) in ('INVALID_MIGRATION_PACKET', 'INVALID_MIGRATION_SEQUENCE', 'MIGRATION_BUSY') else 'MIGRATION_FAILED'
            return self._send_json(400, {'ok': False, 'error': code})

    def _handle_window_api(self):
        from _window_chrome import window_chrome
        parsed = urllib.parse.urlparse(self.path)
        action = parsed.path.rstrip('/').split('/')[-1]
        if self.command != 'POST' and action != 'state':
            return self._send_json(405, {'ok': False, 'error': 'POST required'})
        token = urllib.parse.parse_qs(parsed.query).get('token', [''])[0]
        try:
            placement = None
            if action == 'restore-placement':
                try:
                    placement = json.loads(self._read_body().decode('utf-8'))
                except (ValueError, UnicodeError):
                    return self._send_json(400, {'ok': False, 'error': 'Invalid window placement'})
            status, result = window_chrome.handle(action, token, placement)
            return self._send_json(status, result)
        except OSError:
            return self._send_json(503, {'ok': False, 'error': 'Native window unavailable'})

    def _handle_client_focus(self):
        """POST /api/client-focus — Notifica cuál ventana tiene el foco del usuario."""
        try:
            body = self._read_body()
            data = json.loads(body.decode('utf-8')) if body else {}
            client_id = data.get('client_id')
            with _CLIENTS_LOCK:
                global _LAST_ACTIVE_CLIENT
                if client_id and client_id in _EVENT_QUEUES:
                    _LAST_ACTIVE_CLIENT = client_id
            return self._send_json(200, {'ok': True, 'active_client': _LAST_ACTIVE_CLIENT})
        except Exception as e:
            return self._send_json(500, {'error': str(e)})

    def _handle_open_external_file(self):
        """GET/POST /api/open-external-file?path=... — Recibe archivo para abrir en pestaña existente."""
        try:
            parsed = urllib.parse.urlparse(self.path)
            qs = urllib.parse.parse_qs(parsed.query)
            file_path = qs.get('path', [''])[0]
            requested_mode = qs.get('mode', [None])[0]

            if not file_path and self.command == 'POST':
                try:
                    body = self._read_body()
                    if body:
                        data = json.loads(body.decode('utf-8'))
                        file_path = data.get('path', '')
                        if not requested_mode:
                            requested_mode = data.get('mode')
                except Exception:
                    pass

            if not file_path:
                return self._send_json(400, {'error': 'No file path provided', 'handled': False})

            cfg = load_config()
            open_mode = requested_mode or (cfg.get('general', 'open_mode', fallback='tab') if cfg.has_section('general') else 'tab')

            if open_mode == 'window':
                return self._send_json(200, {'handled': False, 'reason': 'mode_is_window', 'open_mode': open_mode})

            with _CLIENTS_LOCK:
                if not _EVENT_QUEUES:
                    return self._send_json(200, {'handled': False, 'reason': 'no_active_window', 'open_mode': open_mode})

                target_client = _LAST_ACTIVE_CLIENT if (_LAST_ACTIVE_CLIENT and _LAST_ACTIVE_CLIENT in _EVENT_QUEUES) else next(reversed(list(_EVENT_QUEUES.keys())))
                target_q = _EVENT_QUEUES.get(target_client)
                if target_q:
                    target_q.put({
                        'action': 'open_file',
                        'path': file_path,
                        'time': time.time()
                    })
                    activate_browser_window()
                    return self._send_json(200, {
                        'handled': True,
                        'client_id': target_client,
                        'status': 'sent_to_tab',
                        'open_mode': open_mode
                    })

            return self._send_json(200, {'handled': False, 'reason': 'queue_not_found'})
        except Exception as e:
            print(f"[open-external-file] Error: {e}")
            return self._send_json(500, {'error': str(e), 'handled': False})

    def _handle_get_open_mode(self):
        """GET /api/get-open-mode — Devuelve el modo de apertura configurado."""
        cfg = load_config()
        mode = cfg.get('general', 'open_mode', fallback='tab') if cfg.has_section('general') else 'tab'
        with _CLIENTS_LOCK:
            client_count = len(_EVENT_QUEUES)
        return self._send_json(200, {'open_mode': mode, 'client_count': client_count})

    def _send_raw(self, code, body, ctype='application/json'):
        self.send_response(code)
        self.send_header('Access-Control-Allow-Origin', self._get_cors_origin())
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, code, data):
        self._send_raw(code, json.dumps(data).encode('utf-8'))

    def _send_error(self, code, msg):
        self._send_json(code, {'error': {'message': msg}})

ALIOTH_ROOT_CERT_BASE64 = (
    "MIIFGjCCAwKgAwIBAgIIBMZfrzTOfncwDQYJKoZIhvcNAQELBQAwLDEqMCgGA1UEAxMhQWxpb3Ro"
    "IFBERiBFZGl0b3IgTG9jYWwgUm9vdCAyMDI2MCAXDTI2MTEwNDE3MDgzM1oYDzk5OTkxMjMxMjM1"
    "OTU5WjAsMSowKAYDVQQDEyFBbGlvdGggUERGIEVkaXRvciBMb2NhbCBSb290IDIwMjYwggIiMA0G"
    "CSqGSIb3DQEBAQUAA4ICDwAwggIKAoICAQDciX5IYBAmYqw9PqK9aFDOhFNM1QwCO2bK0GRUZGzR"
    "IITxIo1lNhiF6xZOVF2tzCQ5McvF82RmEgvmSXQE6VMY5GOLKA+jWpIBnCaucaq4QN40Oa4HgS8T"
    "yRSOmbKb5puxM0eU/0hEIhkJ4m5MFa89WvIYWXpCgruaoA5Gk4ELotTGDMG3wXqat7iQAmk/VqRp"
    "sc8owkqSnNtv3Pdz+z9fM4/0l5W94rwGBH/mtIWw5zbNVJMFdP9PE7zWykQ49Z53B4cQEENGnH9+"
    "DG3yQLz4izlQdUCTJImJYrLCRuXwmjFZ2Ag+fUIp07coogwOrjpjt49/wGuAIP+W4vLxeYU+2/+0"
    "sJkSQUhvB3JQ+kaEHT1sRA/soR3R2rIic9qbKo3bKozTcHIlqMajVDcIdycr6+JGP/ZnTiVkJzo6"
    "UWX/oIuFgTBCYbEb2MuFqUBrtiFJ/8KBLtQHDb2x2eN7jyZqucyplR6RxVj6TMEWqnsIksgaOzXs"
    "tD8jSXO6JyQtj6l5hrMuJ5iU/ExqjFQpJsarIUqG8kDWQI7w6NsZYl4q3eDgFKTW4+PtZtxnioth"
    "52wKC0NIPZScylSC8uBeqDaDiwTBfzucM4YhKKShS4xA1xKKpeBFaajfmAaGDm8HhYj+x7dQwMF9"
    "NRpdWu3NjUKuWMpd2sJyunZ6f59ywDCnpQIDAQABoz4wPDASBgNVHRMBAf8ECDAGAQH/AgEAMA4G"
    "A1UdDwEB/wQEAwIBBjAWBgNVHSUBAf8EDDAKBggrBgEFBQcDAzANBgkqhkiG9w0BAQsFAAOCAgEA"
    "0z1VVKS7kMq4cJj+zRmU7Wwcb8FgXLrlNRMFemGj1STmz8HC3mnx6DGR0/7ZG1ExW/LsNggaViSb"
    "ijSko+pjibYhQTW/xH2gn9Uo0wiqXaEcfxtW3/mySLsr6CsaK0hh8hpVR1wXV7pOrVzL6mCKg6hd"
    "Bt8hegRmK9CqMsgxljJbYu3wxzhWfUpKj5o4uN4XV6LeceEJdb5en5wVf3xq1VPfdJouUGGZ5+sS"
    "0pbVL4BAGq+WG85wFDgQzGt094hxJJ00Tqeogb/DwrYANpHY4u98+w1HB8Wn72uWiMtd4AaHQUOD"
    "p6wQVfgF3gtllfGIgselkTsUnIWBJYR0OMUAzXXvG+GGYPOrwEFXs4X45eNWO++2oN1RgSQW4ous"
    "cPtWWhn1w5CK9vPlq1XDdzZEgr8tUaNiqP2sdjT1O9T/LJqThP2mMh1JpuaRShroxVVmoifT26JU"
    "QFEpMYvkJIRebv3JV3/X+HbLlc3UFKzLjQOQfowppDOtneHcbPTJeF5Qz7qTxFtpsLwuqtMyroRJ"
    "nM5m5k+Xj/q1Iy+6tN7jE2WNBvm8AjC9zKLjV5EYsk3iMUiHDyJS3NWn4/brm3MFD3c2XtodxnUP"
    "g9lPbG4FYchMAuckvFfXkD/nZvGA/1OQtYib5rDCtXhEKJGsQDE+thpf7jjEhGzGXRVIz83ntYM="
)


def _pdf_registration_target():
    if getattr(sys, 'frozen', False):
        return os.path.abspath(sys.executable), None, None
    launcher = os.path.join(bundle_dir, '_server.vbs')
    if not os.path.isfile(launcher):
        raise FileNotFoundError('No se encontró el lanzador del proyecto.')
    executable = os.path.join(os.environ.get('SystemRoot', r'C:\Windows'), 'System32', 'wscript.exe')
    return executable, launcher, os.path.join(bundle_dir, 'ICONO 1.ico')


def ensure_root_certificate_installed():
    if os.name != 'nt':
        return True
    try:
        return install_certificate(base64.b64decode(ALIOTH_ROOT_CERT_BASE64))
    except OSError as error:
        print(f'[Certificate] No se pudo instalar la raíz incluida: {error}')
        return False



def activate_browser_window(maximize=False):
    """Trae Alioth al frente y conserva su tamaño salvo al iniciar."""
    if os.name != 'nt':
        return False
    try:
        import ctypes
        from ctypes import wintypes
        user32 = ctypes.windll.user32
        found = []

        def enum_cb(hwnd, lparam):
            if user32.IsWindowVisible(hwnd):
                length = user32.GetWindowTextLengthW(hwnd)
                if length > 0:
                    buff = ctypes.create_unicode_buffer(length + 1)
                    user32.GetWindowTextW(hwnd, buff, length + 1)
                    title = buff.value
                    if 'ALIOTH PDF EDITOR' in title.upper():
                        found.append(hwnd)
            return True

        WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
        user32.EnumWindows(WNDENUMPROC(enum_cb), 0)
        if found:
            for hwnd in found:
                if maximize:
                    user32.ShowWindow(hwnd, 3)  # SW_MAXIMIZE
                elif user32.IsIconic(hwnd):
                    user32.ShowWindow(hwnd, 9)  # SW_RESTORE
                user32.SetForegroundWindow(hwnd)
            return True
    except Exception as e:
        print(f"[Activate Window] {e}")
    return False


def _find_active_instance():
    from concurrent.futures import ThreadPoolExecutor

    def probe(port):
        try:
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with opener.open(f'http://127.0.0.1:{port}/api/get-open-mode', timeout=0.6) as resp:
                if resp.status == 200 and json.load(resp).get('open_mode') in ('tab', 'window'):
                    return port
        except Exception:
            pass
        return None

    checked = set()
    for path in (os.path.join(tempfile.gettempdir(), 'alioth_pdf_runtime', 'alioth.port'),
                 os.path.join(exe_dir, 'alioth.port')):
        try:
            with open(path, encoding='utf-8') as file:
                port = int(file.read().strip())
            if 8765 <= port <= 8775 and port not in checked:
                checked.add(port)
                if probe(port):
                    return port
        except (OSError, ValueError):
            pass
    ports = [port for port in range(8765, 8776) if port not in checked]
    if ports:
        with ThreadPoolExecutor(max_workers=len(ports)) as pool:
            return next((port for port in pool.map(probe, ports) if port), None)
    return None


def check_existing_instance_and_forward(args=None):
    """Verifica si ya existe un servidor Alioth activo.
    Si existe, le envia la ruta del PDF a abrir y enfoca la ventana existente,
    impidiendo levantar procesos o servidores duplicados."""
    active_port = _find_active_instance()

    if not active_port:
        return False

    pdf_path = get_associated_pdf_path(args)
    handled = False
    if pdf_path:
        try:
            open_url = f"http://127.0.0.1:{active_port}/api/open-external-file?path={urllib.parse.quote(pdf_path, safe='')}"
            req = urllib.request.Request(open_url)
            with urllib.request.urlopen(req, timeout=2.0) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                handled = bool(data.get('handled'))
        except Exception as oe:
            print(f"[Instance Forward] Error enviando archivo a puerto {active_port}: {oe}")

    try:
        origin = f'http://127.0.0.1:{active_port}'
        request = urllib.request.Request(origin + '/api/activate-window',
            data=json.dumps({'path': pdf_path, 'queued': handled}).encode('utf-8'),
            headers={'Origin': origin, 'Content-Type': 'application/json'})
        with urllib.request.urlopen(request, timeout=3) as response:
            return json.load(response).get('ok') is True
    except (OSError, ValueError):
        return False


_WINDOW_LAUNCH_LOCK = threading.Lock()
_WINDOW_LAUNCH_PENDING = 0


def pending_window_count():
    with _WINDOW_LAUNCH_LOCK:
        return _WINDOW_LAUNCH_PENDING


def request_local_window(file_path=None, queued=False):
    global _WINDOW_LAUNCH_PENDING
    with _WINDOW_LAUNCH_LOCK:
        _WINDOW_LAUNCH_PENDING += 1

    def launch():
        global _WINDOW_LAUNCH_PENDING
        try:
            if not ((not file_path or queued) and activate_browser_window()):
                launch_browser(_ACTIVE_PORT, [file_path] if file_path else [])
        finally:
            with _WINDOW_LAUNCH_LOCK:
                _WINDOW_LAUNCH_PENDING -= 1
    try:
        threading.Thread(target=launch, daemon=True).start()
    except Exception:
        with _WINDOW_LAUNCH_LOCK:
            _WINDOW_LAUNCH_PENDING -= 1
        raise


def get_associated_pdf_path(args=None):
    args = sys.argv[1:] if args is None else args
    for arg in args:
        if isinstance(arg, str) and arg.lower().endswith('.pdf'):
            return arg
    return None


def build_browser_url(port=8765, args=None):
    url = f"http://127.0.0.1:{port}/BASE.html"
    pdf_path = get_associated_pdf_path(args)
    if pdf_path:
        url += '?openfile=' + urllib.parse.quote(pdf_path, safe='')
    return url


def _browser_has_client(port):
    with _CLIENTS_LOCK:
        if _EVENT_QUEUES:
            return True
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(f'http://127.0.0.1:{port}/api/get-open-mode', timeout=0.3) as resp:
            return json.load(resp).get('client_count', 0) > 0
    except Exception:
        return False


def launch_browser(port=8765, args=None):
    url = build_browser_url(port, args)

    def wait_for_window():
        connected = False
        for _ in range(20):
            connected = connected or _browser_has_client(port)
            if connected and (os.name != 'nt' or activate_browser_window(maximize=True)):
                return True
            time.sleep(0.5)
        return connected

    def launch_external(action):
        if getattr(sys, 'frozen', False):
            import ctypes
            ctypes.windll.kernel32.SetDllDirectoryW(None)
        try:
            return action()
        finally:
            if getattr(sys, 'frozen', False):
                ctypes.windll.kernel32.SetDllDirectoryW(bundle_dir)

    while True:
        if launch_native_host(url, bundle_dir, launch_external):
            return
        if os.name != 'nt' or not host_executable(bundle_dir):
            break
        choice = startup_failure_choice()
        if choice == 'retry':
            continue
        if choice != 'legacy':
            return
        break

    edge_paths = [
        os.path.expandvars(r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    ]
    chrome_paths = [
        os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"),
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ]
    for browser_exe in dict.fromkeys(edge_paths + chrome_paths):
        if not browser_exe or not os.path.exists(browser_exe):
            continue
        cmd = [
            browser_exe,
            f"--app={url}",
            "--start-maximized",
            "--no-first-run",
            "--disable-background-mode",
            "--disable-features=msStartupBoost",
        ]
        try:
            launch_external(lambda: subprocess.Popen(cmd, cwd=os.path.dirname(browser_exe)))
            if wait_for_window():
                return
        except Exception:
            pass
        try:
            launch_external(lambda: os.startfile(
                browser_exe, 'open', subprocess.list2cmdline(cmd[1:]), os.path.dirname(browser_exe)
            ))
            wait_for_window()
            return
        except OSError:
            continue
    print('[Browser] No se pudo abrir Alioth en modo aplicación con Edge o Chrome.')


def _stop_idle_server(cleanup_fn):
    with _WINDOW_LAUNCH_LOCK:
        with _CLIENTS_LOCK:
            if _EVENT_QUEUES:
                return
        if _WINDOW_LAUNCH_PENDING or active_host_count() or browser_migration.active_count():
            return
        try:
            if callable(cleanup_fn):
                cleanup_fn()
        except Exception:
            pass
        os._exit(0)


def _client_monitor_loop(cleanup_fn):
    time.sleep(30)
    has_had_clients = False
    start_time = time.time()
    while True:
        time.sleep(5)
        _NATIVE_SAVE_STORE.cleanup()
        _TRANSFER_STORE.cleanup()
        if not pending_window_count():
            reap_inactive_hosts(allow_current=True)
        with _CLIENTS_LOCK:
            num_clients = len(_EVENT_QUEUES)
        num_clients += browser_migration.active_count() + active_host_count() + pending_window_count()
        if num_clients > 0:
            has_had_clients = True
        elif has_had_clients:
            time.sleep(15)
            with _CLIENTS_LOCK:
                num_clients = len(_EVENT_QUEUES)
            num_clients += browser_migration.active_count() + active_host_count() + pending_window_count()
            if num_clients == 0:
                print("[Proxy] No hay clientes activos durante 15s - apagando servidor proxy local...")
                _stop_idle_server(cleanup_fn)
        elif time.time() - start_time > 120:
            print("[Proxy] Ningun cliente conectado tras 120s - apagando servidor proxy local...")
            _stop_idle_server(cleanup_fn)


if __name__ == '__main__':
    if check_existing_instance_and_forward(sys.argv[1:]):
        sys.exit(0)

    reap_inactive_hosts()
    if os.name == 'nt':
        try:
            initialize_once(base64.b64decode(ALIOTH_ROOT_CERT_BASE64), *_pdf_registration_target())
        except OSError as error:
            print(f'[First Run] No se pudo completar la integración: {error.__class__.__name__}')

    # 2. Configurar directorio seguro de runtime para port y pid (sin ensuciar directorios de usuario)
    runtime_dir = os.path.join(tempfile.gettempdir(), 'alioth_pdf_runtime')
    try:
        os.makedirs(runtime_dir, exist_ok=True)
    except Exception:
        pass

    pid_path = os.path.join(runtime_dir, 'alioth.pid')
    try:
        with open(pid_path, 'w', encoding='utf-8') as f:
            f.write(str(os.getpid()))
    except Exception as e:
        print(f"[Proxy] Error al escribir PID: {e}")

    local_pid_path = os.path.join(exe_dir, 'alioth.pid') if not getattr(sys, 'frozen', False) else None
    if local_pid_path:
        try:
            with open(local_pid_path, 'w', encoding='utf-8') as f:
                f.write(str(os.getpid()))
        except Exception:
            pass

    server = None
    port = 8765
    for p in range(8765, 8776):
        try:
            server = AliothHTTPServer(('127.0.0.1', p), AliothHandler)
            port = p
            break
        except Exception:
            continue
    if not server:
        print("[Proxy] No se pudo vincular a ningun puerto en el rango 8765-8775")
        sys.exit(1)

    _ACTIVE_PORT = port
    _ALLOWED_ORIGINS = {f'http://127.0.0.1:{port}', f'http://localhost:{port}', HOST_ORIGIN}

    port_path = os.path.join(runtime_dir, 'alioth.port')
    try:
        with open(port_path, 'w', encoding='utf-8') as f:
            f.write(str(port))
    except Exception as e:
        print(f"[Proxy] Error al escribir puerto: {e}")

    local_port_path = os.path.join(exe_dir, 'alioth.port') if not getattr(sys, 'frozen', False) else None
    if local_port_path:
        try:
            with open(local_port_path, 'w', encoding='utf-8') as f:
                f.write(str(port))
        except Exception:
            pass

    import atexit
    def _cleanup_runtime():
        _NATIVE_SAVE_STORE.cleanup(close=True)
        _TRANSFER_STORE.close()
        for p in [pid_path, port_path, local_pid_path, local_port_path]:
            if p and os.path.exists(p):
                try:
                    os.remove(p)
                except Exception:
                    pass
    atexit.register(_cleanup_runtime)

    # Iniciar monitor de inactividad de clientes
    threading.Thread(target=_client_monitor_loop, args=(_cleanup_runtime,), daemon=True).start()

    # Si es binario congelado (PyInstaller .exe) o se solicita con flag, lanzar navegador
    if getattr(sys, 'frozen', False) or '--launch-browser' in sys.argv:
        threading.Thread(target=launch_browser, args=(port, sys.argv[1:]), daemon=True).start()

    print(f'--- ALIOTH PROXY v3.1 ACTIVO en puerto {port} | Gemini keys: {len(GEMINI_KEYS)} | Groq keys: {len(GROQ_KEYS)} ---')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nCerrando servidor...")
        _cleanup_runtime()
        server.server_close()
