import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
import zipfile

script = Path(__file__).resolve().parents[1] / 'bootstrap_build.py'
spec = importlib.util.spec_from_file_location('bootstrap_build', script)
bootstrap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bootstrap)


class BuildInputTests(unittest.TestCase):
    def archive(self, root, name='allowed.txt'):
        path = root / 'inputs.zip'
        with zipfile.ZipFile(path, 'w') as archive:
            archive.writestr(name, b'locked')
        return path, {'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'files': [
            {'path': name, 'bytes': 6, 'sha256': hashlib.sha256(b'locked').hexdigest()}]}

    def test_archive_hash_mismatch_writes_nothing(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); archive, lock = self.archive(root)
            archive.write_bytes(archive.read_bytes() + b'changed')
            with self.assertRaisesRegex(ValueError, 'SHA-256 mismatch'):
                bootstrap.restore(archive, lock, root / 'out')
            self.assertFalse((root / 'out').exists())

    def test_unexpected_member_writes_nothing(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); archive, lock = self.archive(root)
            lock['files'] = []
            with self.assertRaisesRegex(ValueError, 'Unexpected or missing'):
                bootstrap.restore(archive, lock, root / 'out')
            self.assertFalse((root / 'out').exists())

    def test_even_locked_traversal_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); archive, lock = self.archive(root, '../escaped.txt')
            with self.assertRaisesRegex(ValueError, 'Unsafe archive path'):
                bootstrap.restore(archive, lock, root / 'out')
            self.assertFalse((root / 'escaped.txt').exists())
