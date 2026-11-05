from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch
import hashlib
import io
import sys
import threading
import unittest

import fitz

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from _native_save import NativeSaveStore
from _transfer_store import TransferStore
import _proxy as proxy


def pdf_bytes(text):
    with fitz.open() as pdf:
        pdf.new_page().insert_text((72, 72), text)
        return pdf.tobytes()


class SaveStabilityTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory(dir=ROOT, prefix='_qa_save_')
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / 'test.pdf'
        self.path.write_bytes(pdf_bytes('original'))
        self.clock = [0]
        self.store = NativeSaveStore(clock=lambda: self.clock[0])
        self.addCleanup(lambda: self.store.cleanup(close=True))

    def upload(self, operation, text='new'):
        grant = self.store.issue_grant('session', self.path, 'save')
        data = pdf_bytes(text)
        upload = self.store.begin_save('session', grant.token, operation, len(data), hashlib.sha256(data).hexdigest(), grant.fingerprint)
        self.store.write_chunk('session', upload.upload_id, 0, 0, data)
        return upload

    def test_concurrent_commits_cannot_both_replace_the_same_baseline(self):
        first, second = self.upload('first', 'first'), self.upload('second', 'second')
        entered, release = threading.Event(), threading.Event()
        real_replace = proxy.os.replace
        def delayed_replace(source, destination):
            entered.set()
            self.assertTrue(release.wait(3))
            return real_replace(source, destination)
        with ThreadPoolExecutor(2) as pool, patch('_native_save.os.replace', side_effect=delayed_replace):
            one = pool.submit(self.store.commit_save, 'session', first.upload_id, 'first')
            self.assertTrue(entered.wait(3))
            two = pool.submit(self.store.commit_save, 'session', second.upload_id, 'second')
            self.assertFalse(two.done())
            release.set()
            self.assertEqual(one.result(3)['status'], 'committed')
            with self.assertRaises(FileExistsError):
                two.result(3)
        with fitz.open(self.path) as pdf:
            self.assertIn('first', pdf[0].get_text())

    def test_expired_grant_renews_only_for_its_session_without_changing_baseline(self):
        grant = self.store.issue_grant('session', self.path, 'save')
        self.clock[0] = 901
        with self.assertRaises(PermissionError):
            self.store.resolve_grant('session', grant.token)
        with self.assertRaises(PermissionError):
            self.store.renew_grant('other', grant.token)
        self.path.write_bytes(pdf_bytes('external change'))
        renewed = self.store.renew_grant('session', grant.token)
        self.assertEqual(renewed.fingerprint, grant.fingerprint)
        self.assertEqual(self.store.resolve_grant('session', grant.token), renewed)

    def test_disconnect_removes_owned_uploads_and_temporary_files(self):
        upload = self.upload('pending')
        self.assertTrue(upload.temp_path.exists())
        self.store.revoke_session('session')
        self.assertFalse(upload.temp_path.exists())
        self.assertFalse(self.store._uploads)
        self.assertFalse(self.store._operations)

    def test_idle_uploads_expire_without_removing_destination(self):
        upload = self.upload('idle')
        original = self.path.read_bytes()
        self.clock[0] = 601
        self.store.cleanup()
        self.assertFalse(upload.temp_path.exists())
        self.assertEqual(self.path.read_bytes(), original)

    def test_readback_error_reports_replacement_and_never_repeats_it(self):
        upload = self.upload('readback')
        upload.redaction_verification = ({'id': 'test'},)
        with patch.object(self.store, '_verify_redaction_output', side_effect=[{'treated': [], 'rejected': []}, ValueError('readback')]):
            result = self.store.commit_save('session', upload.upload_id, 'readback')
        self.assertEqual(result['status'], 'verification_failed')
        self.assertTrue(result['fileReplaced'])
        self.assertEqual(result, self.store.commit_save('session', upload.upload_id, 'readback'))
        with fitz.open(self.path) as pdf:
            self.assertIn('new', pdf[0].get_text())

    def test_transfer_budget_preserves_existing_entries_and_releases_expired_disk_files(self):
        store = TransferStore(clock=lambda: self.clock[0], ttl=10, max_bytes=10, directory=self.directory.name)
        self.addCleanup(store.close)
        store.put('first', b'123456')
        with self.assertRaises(ValueError):
            store.put('second', b'123456')
        self.assertEqual(store.get('first'), b'123456')
        path = store._items['first'][0]
        self.assertIsInstance(path, Path)
        self.clock[0] = 11
        store.cleanup()
        self.assertFalse(path.exists())
        self.assertEqual(store._bytes, 0)


class EventConnectionTests(unittest.TestCase):
    def handler(self):
        handler = object.__new__(proxy.AliothHandler)
        handler.path = '/api/tab-events?client_id=test-client'
        handler.send_response = Mock()
        handler.send_header = Mock()
        handler.end_headers = Mock()
        handler._get_cors_origin = Mock(return_value='http://127.0.0.1:8884')
        return handler

    def test_old_disconnect_preserves_the_reconnected_queue_and_its_permissions(self):
        handler = self.handler()
        replacement = object()
        def fail_after_reconnect(_):
            proxy._EVENT_QUEUES['test-client'] = replacement
            raise BrokenPipeError()
        handler.wfile = Mock()
        handler.wfile.write.side_effect = fail_after_reconnect
        with patch.object(proxy, '_EVENT_QUEUES', {}), patch.object(proxy, '_NATIVE_SAVE_STORE') as store:
            handler._handle_tab_events()
            self.assertIs(proxy._EVENT_QUEUES['test-client'], replacement)
            store.revoke_session.assert_not_called()

    def test_initial_write_failure_cannot_leave_a_ghost_client(self):
        handler = self.handler()
        handler.wfile = Mock()
        handler.wfile.write.side_effect = BrokenPipeError()
        with patch.object(proxy, '_EVENT_QUEUES', {}), patch.object(proxy, '_NATIVE_SAVE_STORE') as store:
            handler._handle_tab_events()
            self.assertFalse(proxy._EVENT_QUEUES)
            store.revoke_session.assert_called_once_with('test-client')


if __name__ == '__main__':
    unittest.main()
