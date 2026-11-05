from pathlib import Path
import json
import os
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import _process_lifecycle as lifecycle


class ProcessLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.folder = Path(self.directory.name)
        self.now = 1800000000
        self.created = int((self.now - 180 + 11644473600) * 10_000_000)
        self.owner = {'pid': os.getpid(), 'created': 42, 'image': 'owner.exe'}
        self.host = {'pid': 12345, 'created': self.created, 'image': r'C:\App\native_host\AliothPDFHost.exe'}
        self.child, self.parent = Mock(), Mock()
        self.child.identity.return_value = self.host
        self.child.has_windows.return_value = False
        self.child.terminate.return_value = True
        self.parent.identity.return_value = self.owner
        def process(pid, **kwargs):
            result = self.child if pid == self.host['pid'] else self.parent
            result.__enter__ = Mock(return_value=result)
            result.__exit__ = Mock(return_value=False)
            return result
        guard = patch.object(lifecycle, 'WindowsProcess', side_effect=process)
        guard.start()
        self.addCleanup(guard.stop)
        self.write_record()

    def write_record(self):
        self.path = self.folder / f"{self.host['pid']}-{self.host['created']}.json"
        self.path.write_text(json.dumps({'owner': self.owner, 'host': self.host}), encoding='utf-8')

    def reap(self, allow_current=False, now=None):
        return lifecycle.reap_inactive_hosts(directory=self.folder, allow_current=allow_current,
                                             now=self.now if now is None else now)

    def test_startup_preserves_the_host_of_a_live_backend(self):
        self.assertEqual(self.reap(), 0)
        self.child.terminate.assert_not_called()

    def test_idle_monitor_terminates_only_its_own_old_host_without_windows(self):
        self.assertEqual(self.reap(allow_current=True), 1)
        self.child.terminate.assert_called_once()
        self.assertFalse(self.path.exists())

    def test_another_live_backend_is_never_terminated_by_the_idle_monitor(self):
        self.owner['pid'] += 10
        self.write_record()
        self.assertEqual(self.reap(allow_current=True), 0)
        self.child.terminate.assert_not_called()

    def test_an_orphan_with_a_dead_backend_is_reaped_at_startup(self):
        self.parent.identity.return_value = None
        self.assertEqual(self.reap(), 1)

    def test_a_visible_or_minimized_app_window_is_preserved_even_if_its_backend_exited(self):
        self.parent.identity.return_value = None
        self.child.has_windows.return_value = True
        self.assertEqual(self.reap(allow_current=True), 0)
        self.child.terminate.assert_not_called()

    def test_slow_initialization_is_protected_by_the_two_minute_grace_period(self):
        self.assertEqual(self.reap(allow_current=True, now=self.now - 100), 0)
        self.child.terminate.assert_not_called()

    def test_recycled_pid_and_changed_executable_are_never_terminated(self):
        for identity in [{**self.host, 'created': self.created + 1}, {**self.host, 'image': 'unrelated.exe'}]:
            self.write_record()
            self.child.identity.return_value = identity
            self.assertEqual(self.reap(allow_current=True), 0)
        self.child.terminate.assert_not_called()

    def test_a_window_opened_between_checks_prevents_termination(self):
        self.child.has_windows.side_effect = [False, True]
        self.assertEqual(self.reap(allow_current=True), 0)
        self.child.terminate.assert_not_called()

    def test_uncertain_permissions_and_corrupt_records_do_not_terminate_anything(self):
        self.child.identity.side_effect = PermissionError('blocked')
        self.assertEqual(self.reap(allow_current=True), 0)
        self.path.write_text('{}', encoding='utf-8')
        self.assertEqual(self.reap(allow_current=True), 0)
        self.child.terminate.assert_not_called()


if __name__ == '__main__':
    unittest.main()
