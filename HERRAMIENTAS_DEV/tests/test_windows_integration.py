import ctypes
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import _windows_integration as integration


class WindowsIntegrationTests(unittest.TestCase):
    def test_certificate_requires_exact_der_and_encoding(self):
        with patch.object(integration.ssl, 'enum_certificates', return_value=[(b'other', 'x509_asn', True), (b'root', 'pkcs_7_asn', True)]):
            self.assertFalse(integration.certificate_installed(b'root'))
        with patch.object(integration.ssl, 'enum_certificates', return_value=[(b'root', 'x509_asn', True)]):
            self.assertTrue(integration.certificate_installed(b'root'))

    def test_existing_certificate_does_not_reinstall(self):
        with patch.object(integration, 'certificate_installed', return_value=True), patch.object(ctypes, 'WinDLL') as dll:
            self.assertTrue(integration.install_certificate(b'root'))
            dll.assert_not_called()

    def test_native_install_only_adds_embedded_root_to_current_user(self):
        crypt = Mock()
        crypt.CertOpenStore.return_value = 123
        crypt.CertAddEncodedCertificateToStore.return_value = True
        with patch.object(integration, 'certificate_installed', side_effect=[False, True]), patch.object(ctypes, 'WinDLL', return_value=crypt):
            self.assertTrue(integration.install_certificate(b'embedded-root'))
        args = crypt.CertOpenStore.call_args.args
        self.assertEqual(args[:4], (10, 0, None, 0x14000))
        self.assertEqual(ctypes.cast(args[4], ctypes.c_wchar_p).value, 'ROOT')
        args = crypt.CertAddEncodedCertificateToStore.call_args.args
        self.assertEqual(args[:2], (123, 1))
        self.assertEqual(bytes(args[2]), b'embedded-root')
        self.assertEqual(args[3:], (13, 2, None))
        crypt.CertCloseStore.assert_called_once_with(123, 0)

    def test_certificate_policy_denial_closes_store(self):
        crypt = Mock()
        crypt.CertOpenStore.return_value = 123
        crypt.CertAddEncodedCertificateToStore.return_value = False
        with patch.object(integration, 'certificate_installed', return_value=False), patch.object(ctypes, 'WinDLL', return_value=crypt), patch.object(ctypes, 'get_last_error', return_value=5):
            with self.assertRaises(OSError):
                integration.install_certificate(b'root')
        crypt.CertCloseStore.assert_called_once_with(123, 0)

    def test_certificate_store_denial_never_adds_certificate(self):
        crypt = Mock()
        crypt.CertOpenStore.return_value = 0
        with patch.object(integration, 'certificate_installed', return_value=False), patch.object(ctypes, 'WinDLL', return_value=crypt), patch.object(ctypes, 'get_last_error', return_value=5):
            with self.assertRaises(OSError):
                integration.install_certificate(b'root')
        crypt.CertAddEncodedCertificateToStore.assert_not_called()

    def test_registration_quotes_paths_without_changing_default(self):
        target = r'C:\Portable con espacios\Alioth_PDF_Editor_Personal.exe'
        entries = integration.registration_entries(target)
        command = next(value for path, name, value in entries if path == r'Software\Classes\Alioth.PDF\shell\open\command')
        self.assertEqual(command, f'"{target}" "%1"')
        self.assertFalse(any('UserChoice' in path for path, _, _ in entries))
        self.assertTrue(all(path.startswith('Software\\') for path, _, _ in entries))
        self.assertTrue(any('Applications\\Alioth_PDF_Editor_Personal.exe' in path for path, _, _ in entries))

    def test_source_registration_uses_launcher_not_python_application(self):
        entries = integration.registration_entries(r'C:\Windows\wscript.exe', r'C:\PDF TOOL\_server.vbs', r'C:\PDF TOOL\ICONO 1.ico')
        self.assertFalse(any('Classes\\Applications\\' in path for path, _, _ in entries))
        self.assertIn('"C:\\Windows\\wscript.exe" "C:\\PDF TOOL\\_server.vbs" "%1"', [value for _, _, value in entries])

    def test_matching_registration_does_not_rewrite_or_notify(self):
        with patch.object(integration, 'registration_matches', return_value=True), patch('winreg.OpenKey', side_effect=FileNotFoundError), patch('winreg.CreateKey') as create, patch('ctypes.windll.shell32.SHChangeNotify') as notify:
            self.assertTrue(integration.register_pdf(r'C:\Portable\Alioth.exe'))
        create.assert_not_called()
        notify.assert_not_called()

    def test_moved_portable_repairs_current_user_commands(self):
        writes = {}
        class Key:
            def __init__(self, path): self.path = path
            def __enter__(self): return self
            def __exit__(self, *_): pass
        def write(key, name, reserved, kind, value): writes[(key.path, name)] = value
        target = r'D:\Nueva carpeta\Alioth_PDF_Editor_Distribucion.exe'
        with patch.object(integration, 'registration_matches', return_value=False), patch('winreg.OpenKey', side_effect=FileNotFoundError), patch('winreg.CreateKey', side_effect=lambda parent, path: Key(path)), patch('winreg.SetValueEx', side_effect=write), patch('ctypes.windll.shell32.SHChangeNotify') as notify:
            integration.register_pdf(target)
        self.assertEqual(writes[(r'Software\Classes\Alioth.PDF\shell\open\command', '')], f'"{target}" "%1"')
        self.assertIn((r'Software\Classes\.pdf\OpenWithProgids', 'Alioth.PDF'), writes)
        self.assertFalse(any('UserChoice' in path for path, _ in writes))
        notify.assert_called_once()

    def test_status_distinguishes_registered_from_default(self):
        with patch.object(integration, 'certificate_installed', return_value=True), patch.object(integration, 'registration_matches', return_value=True), patch.object(integration, 'default_pdf_executable', return_value=r'C:\Adobe\Acrobat.exe'):
            status = integration.integration_status(b'root', r'C:\Portable\Alioth.exe')
        self.assertTrue(status['certificateInstalled'])
        self.assertTrue(status['registered'])
        self.assertFalse(status['defaultIsAlioth'])

    def test_status_reports_policy_failures_without_changing_settings(self):
        with patch.object(integration, 'certificate_installed', side_effect=PermissionError), patch.object(integration, 'registration_matches', side_effect=PermissionError), patch.object(integration, 'default_pdf_executable', return_value=None):
            status = integration.integration_status(b'root', r'C:\Portable\Alioth.exe')
        self.assertEqual(status['errors'], ['certificateInstalled', 'registered'])
        self.assertFalse(status['registered'])


if __name__ == '__main__':
    unittest.main()
