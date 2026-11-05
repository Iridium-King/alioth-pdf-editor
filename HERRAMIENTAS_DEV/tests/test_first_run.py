from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import _windows_integration as integration


class FirstRunTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / 'state.json'
        certificate = patch.object(integration, 'install_certificate', return_value=True)
        registration = patch.object(integration, 'register_pdf', return_value=True)
        self.install = certificate.start()
        self.register = registration.start()
        self.addCleanup(certificate.stop)
        self.addCleanup(registration.stop)

    def initialize(self, certificate=b'root', executable=r'C:\Alioth\Alioth.exe', **kwargs):
        return integration.initialize_once(certificate, executable, state_path=self.path, **kwargs)

    def test_first_launch_sets_up_once_and_second_launch_only_reads_the_marker(self):
        first = self.initialize()
        self.assertTrue(first['certificate']['ok'])
        self.assertTrue(first['registration']['ok'])
        second = self.initialize()
        self.assertEqual(second, first)
        self.install.assert_called_once_with(b'root')
        self.register.assert_called_once_with(r'C:\Alioth\Alioth.exe', None, None)

    def test_moving_the_portable_updates_registration_without_reinstalling_the_certificate(self):
        self.initialize()
        self.initialize(executable=r'D:\Otra carpeta\Alioth.exe')
        self.install.assert_called_once()
        self.assertEqual(self.register.call_count, 2)

    def test_a_new_certificate_invalidates_only_its_own_marker(self):
        self.initialize()
        self.initialize(certificate=b'new-root')
        self.assertEqual(self.install.call_count, 2)
        self.register.assert_called_once()

    def test_policy_denials_do_not_repeat_at_every_launch_and_can_be_explicitly_retried(self):
        self.install.side_effect = PermissionError('policy')
        self.register.side_effect = PermissionError('policy')
        first = self.initialize()
        self.assertFalse(first['certificate']['ok'])
        self.assertFalse(first['registration']['ok'])
        self.initialize()
        self.install.assert_called_once()
        self.register.assert_called_once()
        self.install.side_effect = self.register.side_effect = None
        result = self.initialize(force=True)
        self.assertTrue(result['certificate']['ok'])
        self.assertTrue(result['registration']['ok'])

    def test_partial_success_does_not_reinstall_when_only_the_registration_target_changes(self):
        self.register.side_effect = PermissionError('policy')
        self.initialize()
        self.register.side_effect = None
        result = self.initialize(executable=r'D:\Moved\Alioth.exe')
        self.assertTrue(result['registration']['ok'])
        self.install.assert_called_once()

    def test_corrupt_marker_is_replaced_by_valid_results(self):
        self.path.write_text('invalid', encoding='utf-8')
        self.initialize()
        self.initialize()
        self.install.assert_called_once()

    def test_another_first_launch_owns_the_setup_lock(self):
        import msvcrt
        with patch.object(msvcrt, 'locking', side_effect=OSError('busy')):
            self.assertTrue(self.initialize()['busy'])
        self.install.assert_not_called()
        self.register.assert_not_called()
        self.assertFalse(self.path.exists())


if __name__ == '__main__':
    unittest.main()
