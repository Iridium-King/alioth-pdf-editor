"""Autorizaciones efímeras para destinos elegidos por Windows."""

from dataclasses import dataclass
from dataclasses import replace
from functools import wraps
from pathlib import Path
import hashlib
import math
import os
import secrets
import shutil
import tempfile
import threading
import time


def synchronized(method):
    @wraps(method)
    def run(self, *args, **kwargs):
        with self._lock:
            return method(self, *args, **kwargs)
    return run


@dataclass(frozen=True)
class SaveGrant:
    token: str
    path: Path
    identity: str
    fingerprint: str | None
    mode: str
    session_id: str
    expires_at: float


@dataclass
class SaveUpload:
    upload_id: str
    operation_id: str
    session_id: str
    grant: SaveGrant
    length: int
    sha256: str
    expected_fingerprint: str | None
    temp_root: Path
    temp_path: Path
    redaction_verification: tuple = ()
    redaction_result: dict | None = None
    committed_identity: str | None = None
    received: int = 0
    next_index: int = 0
    status: str = 'uploading'
    touched_at: float = 0


class NativeSaveStore:
    def __init__(self, clock=time.monotonic, grant_ttl_seconds=900, temp_root=None, upload_ttl_seconds=600):
        self.clock = clock
        self.grant_ttl_seconds = grant_ttl_seconds
        self._grants = {}
        self._uploads = {}
        self._operations = {}
        self._identities = {}
        self._lock = threading.RLock()
        self._temp_root = Path(temp_root) if temp_root else None
        self.upload_ttl_seconds = upload_ttl_seconds

    def _identity_for_path(self, path):
        try:
            stat = path.stat()
            key = ('file', stat.st_dev, stat.st_ino)
        except OSError:
            key = ('path', os.path.normcase(str(path.resolve())))
        identity = self._identities.get(key)
        if not identity:
            identity = secrets.token_urlsafe(24)
            self._identities[key] = identity
            if len(self._identities) > 1024:
                protected = {grant.identity for grant in self._grants.values()}
                for old_key, old_identity in tuple(self._identities.items()):
                    if old_key != key and old_identity not in protected:
                        del self._identities[old_key]
                        if len(self._identities) <= 1024:
                            break
        return identity

    @synchronized
    def issue_grant(self, session_id, selected_path, mode):
        self.cleanup()
        if len(self._grants) >= 512:
            for token, grant in tuple(self._grants.items()):
                if self.clock() >= grant.expires_at:
                    del self._grants[token]
            if len(self._grants) >= 512:
                raise ValueError('Too many save targets')
        path = Path(selected_path)
        if not session_id or not path.is_absolute():
            raise ValueError('A validated absolute path and session are required')
        if mode not in {'save', 'save-as', 'copy'}:
            raise ValueError('Unsupported save mode')
        resolved_path = path.resolve()
        grant = SaveGrant(
            secrets.token_urlsafe(32), resolved_path, self._identity_for_path(resolved_path),
            self._fingerprint(resolved_path), mode, session_id, self.clock() + self.grant_ttl_seconds,
        )
        self._grants[grant.token] = grant
        return grant

    @synchronized
    def resolve_grant(self, session_id, token):
        grant = self._grants.get(token)
        if not grant or not secrets.compare_digest(grant.session_id, session_id or '') or self.clock() >= grant.expires_at:
            raise PermissionError('Save grant is unavailable')
        return grant

    @synchronized
    def renew_grant(self, session_id, token):
        grant = self._grants.get(token)
        if not grant or not secrets.compare_digest(grant.session_id, session_id or ''):
            raise PermissionError('Save grant is unavailable')
        grant = replace(grant, expires_at=self.clock() + self.grant_ttl_seconds)
        self._grants[token] = grant
        return grant

    @synchronized
    def revoke_session(self, session_id):
        for token, grant in tuple(self._grants.items()):
            if secrets.compare_digest(grant.session_id, session_id or ''):
                del self._grants[token]
        for upload in tuple(self._uploads.values()):
            if upload.session_id == session_id:
                self._discard_upload(upload)

    def _discard_upload(self, upload):
        try:
            upload.temp_path.unlink(missing_ok=True)
        except OSError:
            return
        self._uploads.pop(upload.upload_id, None)
        self._operations.pop(upload.operation_id, None)

    @synchronized
    def cleanup(self, close=False):
        now = self.clock()
        for upload in tuple(self._uploads.values()):
            if close or now - upload.touched_at >= self.upload_ttl_seconds:
                self._discard_upload(upload)
        if close:
            self._grants.clear()
            self._identities.clear()

    @staticmethod
    def _fingerprint(path):
        if not path.exists():
            return None
        digest = hashlib.sha256()
        with path.open('rb') as source:
            for block in iter(lambda: source.read(1024 * 1024), b''):
                digest.update(block)
        return digest.hexdigest()

    @staticmethod
    def _normalize_redaction_verification(value):
        if value is None:
            return ()
        entries = value.get('occurrences') if isinstance(value, dict) else None
        if not isinstance(entries, list) or not entries:
            raise ValueError('Invalid redaction verification')
        normalized = []
        for entry in entries:
            if not isinstance(entry, dict) or set(entry) not in ({'id', 'pageIndex', 'rect'}, {'id', 'pageIndex', 'rect', 'kind', 'action'}):
                raise ValueError('Invalid redaction occurrence')
            identifier, page_index, rect = entry.get('id'), entry.get('pageIndex'), entry.get('rect')
            kind, action = entry.get('kind', 'vector'), entry.get('action', 'censor')
            if not isinstance(identifier, str) or not 0 < len(identifier) <= 180 or kind not in {'vector', 'image'} or action not in {'erase', 'censor'} or not isinstance(page_index, int) or isinstance(page_index, bool) or page_index < 0 or not isinstance(rect, dict) or set(rect) != {'x0', 'y0', 'x1', 'y1'}:
                raise ValueError('Invalid redaction occurrence')
            values = [rect[key] for key in ('x0', 'y0', 'x1', 'y1')]
            if any(isinstance(number, bool) or not isinstance(number, (int, float)) or not math.isfinite(number) for number in values) or values[2] <= values[0] or values[3] <= values[1]:
                raise ValueError('Invalid redaction rectangle')
            normalized.append({'id': identifier, 'kind': kind, 'action': action, 'pageIndex': page_index, 'rect': {key: rect[key] for key in ('x0', 'y0', 'x1', 'y1')}})
        return tuple(normalized)

    @staticmethod
    def _verify_redaction_output(path, occurrences):
        import fitz

        def simple_image_target(document, page, clip):
            candidates = []
            for image in page.get_images(full=True):
                xref, smask = image[0], image[1]
                try:
                    placements = page.get_image_rects(xref, transform=True)
                except Exception:
                    return None
                for image_rect, matrix in placements:
                    if clip.intersects(image_rect):
                        if smask or abs(matrix.b) > 0.000001 or abs(matrix.c) > 0.000001:
                            return None
                        candidates.append((xref, image_rect))
            if len(candidates) != 1:
                return None
            xref, image_rect = candidates[0]
            if sum(len(document[pno].get_image_rects(xref)) for pno in range(document.page_count)) != 1:
                return None
            try:
                pix = fitz.Pixmap(document, xref)
            except Exception:
                return None
            if pix.alpha or pix.colorspace is None or pix.colorspace.n not in (1, 3) or pix.n != pix.colorspace.n:
                return None
            return image_rect, pix

        def image_region_is_sanitized(document, page, clip, action):
            target = simple_image_target(document, page, clip)
            if target is None:
                return False
            image_rect, pix = target
            x0 = max(0, min(pix.width, math.floor((clip.x0 - image_rect.x0) * pix.width / image_rect.width)))
            y0 = max(0, min(pix.height, math.floor((clip.y0 - image_rect.y0) * pix.height / image_rect.height)))
            x1 = max(0, min(pix.width, math.ceil((clip.x1 - image_rect.x0) * pix.width / image_rect.width)))
            y1 = max(0, min(pix.height, math.ceil((clip.y1 - image_rect.y0) * pix.height / image_rect.height)))
            if x1 <= x0 or y1 <= y0:
                return False
            expected = 0 if action == 'censor' else 255
            samples = pix.samples
            for y in range(y0, y1):
                row = y * pix.width * pix.n
                for x in range(x0, x1):
                    start = row + x * pix.n
                    if any(value != expected for value in samples[start:start + pix.n]):
                        return False
            return True

        document = fitz.open(path)
        try:
            treated, rejected = [], []
            for occurrence in occurrences:
                page_index = occurrence['pageIndex']
                if page_index >= document.page_count:
                    rejected.append({'id': occurrence['id'], 'reason': 'PAGE_UNAVAILABLE'})
                    continue
                page = document[page_index]
                rect = occurrence['rect']
                clip = fitz.Rect(rect['x0'], page.rect.height - rect['y1'], rect['x1'], page.rect.height - rect['y0'])
                if not clip.is_valid or clip.is_empty:
                    rejected.append({'id': occurrence['id'], 'reason': 'RECT_UNAVAILABLE'})
                    continue
                if page.get_text('text', clip=clip).strip():
                    rejected.append({'id': occurrence['id'], 'reason': 'TEXT_REMAINS'})
                    continue
                if occurrence['kind'] == 'image' and not image_region_is_sanitized(document, page, clip, occurrence['action']):
                    rejected.append({'id': occurrence['id'], 'reason': 'IMAGE_PIXELS_REMAIN'})
                    continue
                treated.append({'id': occurrence['id'], 'pageIndex': page_index})
            return {'treated': treated, 'rejected': rejected}
        finally:
            document.close()

    @staticmethod
    def _committed_result(upload):
        result = {'status': 'committed', 'sha256': upload.sha256, 'identity': upload.committed_identity}
        if upload.redaction_result is not None:
            result['redaction'] = upload.redaction_result
        return result

    @synchronized
    def begin_save(self, session_id, token, operation_id, length, sha256, expected_fingerprint, redaction_verification=None):
        self.cleanup()
        grant = self.resolve_grant(session_id, token)
        if not isinstance(length, int) or not 0 < length <= 512 * 1024 * 1024:
            raise ValueError('Invalid save length')
        if not isinstance(sha256, str) or len(sha256) != 64 or any(char not in '0123456789abcdef' for char in sha256.lower()):
            raise ValueError('Invalid SHA-256')
        if not operation_id or operation_id in self._operations:
            raise ValueError('Invalid operation')
        if sum(upload.status == 'uploading' for upload in self._uploads.values()) >= 8:
            raise ValueError('Too many pending saves')
        verification = self._normalize_redaction_verification(redaction_verification)
        temp_root = self._temp_root or grant.path.parent
        temp_root.mkdir(parents=True, exist_ok=True)
        reserved = sum(max(0, upload.length - upload.received) for upload in self._uploads.values()
                       if upload.status == 'uploading' and upload.temp_root.anchor == temp_root.anchor)
        if shutil.disk_usage(temp_root).free < length + reserved + 64 * 1024 * 1024:
            raise OSError('Insufficient temporary disk space')
        handle = tempfile.NamedTemporaryFile(prefix='upload-', suffix='.part', dir=temp_root, delete=False)
        handle.close()
        upload = SaveUpload(secrets.token_urlsafe(24), operation_id, session_id, grant, length, sha256.lower(), expected_fingerprint, temp_root, Path(handle.name), verification)
        upload.touched_at = self.clock()
        with self._lock:
            self._uploads[upload.upload_id] = upload
            self._operations[operation_id] = upload
        return upload

    @synchronized
    def write_chunk(self, session_id, upload_id, index, offset, data):
        upload = self._uploads.get(upload_id)
        if not upload or upload.session_id != session_id or upload.status != 'uploading':
            raise PermissionError('Upload is unavailable')
        if not isinstance(data, bytes) or len(data) > 4 * 1024 * 1024 or index != upload.next_index or offset != upload.received:
            raise ValueError('Invalid chunk')
        if upload.received + len(data) > upload.length:
            raise ValueError('Upload exceeds declared length')
        with upload.temp_path.open('ab') as target:
            target.write(data)
        upload.received += len(data)
        upload.next_index += 1
        upload.touched_at = self.clock()

    @synchronized
    def commit_save(self, session_id, upload_id, operation_id):
        upload = self._uploads.get(upload_id)
        if not upload or upload.session_id != session_id or upload.operation_id != operation_id:
            raise PermissionError('Upload is unavailable')
        if upload.status == 'committed':
            return self._committed_result(upload)
        if upload.status == 'verification_failed':
            return self.get_save_status(session_id, operation_id)
        if upload.status != 'uploading' or upload.received != upload.length:
            raise ValueError('Upload is incomplete')
        if self._fingerprint(upload.temp_path) != upload.sha256:
            raise ValueError('Upload hash mismatch')
        try:
            import fitz
            pdf = fitz.open(upload.temp_path)
            if pdf.page_count < 1:
                raise ValueError('Invalid PDF')
            pdf.close()
        except Exception as error:
            raise ValueError('Invalid PDF') from error
        verification_result = self._verify_redaction_output(upload.temp_path, upload.redaction_verification) if upload.redaction_verification else None
        if verification_result and verification_result['rejected']:
            raise ValueError('REDACTION_VERIFICATION_FAILED')
        if self._fingerprint(upload.grant.path) != upload.expected_fingerprint:
            raise FileExistsError('Destination changed')
        try:
            os.replace(upload.temp_path, upload.grant.path)
        except OSError:
            upload.status = 'failed'
            raise
        upload.touched_at = self.clock()
        try:
            if verification_result:
                final_result = self._verify_redaction_output(upload.grant.path, upload.redaction_verification)
                if final_result['rejected']:
                    raise OSError('REDACTION_REOPEN_FAILED')
            upload.committed_identity = self._identity_for_path(upload.grant.path)
        except Exception:
            upload.status = 'verification_failed'
            return self.get_save_status(session_id, operation_id)
        upload.status = 'committed'
        upload.redaction_result = final_result if verification_result else None
        return self._committed_result(upload)

    @synchronized
    def get_save_status(self, session_id, operation_id):
        upload = self._operations.get(operation_id)
        if not upload or upload.session_id != session_id:
            raise PermissionError('Operation is unavailable')
        if upload.status == 'committed':
            return self._committed_result(upload)
        if upload.status == 'verification_failed':
            return {'status': upload.status, 'fileReplaced': True, 'error': 'SAVE_OUTPUT_UNVERIFIED'}
        return {'status': upload.status, 'received': upload.received, 'length': upload.length}

    @synchronized
    def abort_save(self, session_id, upload_id):
        upload = self._uploads.get(upload_id)
        if not upload or upload.session_id != session_id:
            raise PermissionError('Upload is unavailable')
        if upload.status in {'committed', 'verification_failed'}:
            return self.get_save_status(session_id, upload.operation_id)
        temp_root = upload.temp_root.resolve()
        temp_path = upload.temp_path.resolve()
        if os.path.commonpath([str(temp_root), str(temp_path)]) != str(temp_root):
            raise ValueError('Refusing to remove an external path')
        if temp_path.exists():
            temp_path.unlink()
        upload.status = 'aborted'
        upload.touched_at = self.clock()
        return {'status': 'aborted'}
