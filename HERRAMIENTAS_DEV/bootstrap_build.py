"""Restore the hashed, public build inputs and build Distribution only.

Run with Python 3 on Windows. No certificate creation, signing key, personal
configuration, registration or application launch occurs in this workflow.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import subprocess
import sys
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
LOCK = Path(__file__).with_name('build-inputs.lock.json')


def restore(archive, lock, destination):
    if hashlib.sha256(archive.read_bytes()).hexdigest() != lock['sha256']:
        raise ValueError('Build-input archive SHA-256 mismatch')
    expected = {item['path']: item for item in lock['files']}
    with zipfile.ZipFile(archive) as package:
        if len(package.namelist()) != len(expected) or set(package.namelist()) != set(expected):
            raise ValueError('Unexpected or missing build input')
        for name in package.namelist():
            path = PurePosixPath(name)
            if path.is_absolute() or '..' in path.parts or '\\' in name or ':' in name:
                raise ValueError('Unsafe archive path')
            data = package.read(name)
            if len(data) != expected[name]['bytes'] or hashlib.sha256(data).hexdigest() != expected[name]['sha256']:
                raise ValueError('Build input mismatch: ' + name)
        # Validate the entire archive before writing any entry.
        package.extractall(destination)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inputs', type=Path, help='Use the locked archive offline')
    parser.add_argument('--restore-only', action='store_true')
    parser.add_argument('--release-dir', type=Path, default=ROOT / 'RELEASE')
    args = parser.parse_args()
    if os.name != 'nt':
        parser.error('The portable is built on Windows x64')
    lock = json.loads(LOCK.read_text(encoding='utf-8'))
    cache = ROOT / 'HERRAMIENTAS_DEV/build-inputs'
    cache.mkdir(parents=True, exist_ok=True)
    archive = args.inputs
    if archive is None:
        archive = cache / lock['filename']
        if not archive.exists():
            with urllib.request.urlopen(lock['url'], timeout=120) as response:
                archive.write_bytes(response.read())
    restore(archive, lock, ROOT)
    for source, destination in [
        ('python-3.14.5-embed-amd64.zip', ROOT / '.build-python'),
        ('compiler-4.14.0.nupkg', ROOT / 'HERRAMIENTAS_DEV/compiler'),
        ('net462-1.0.3.nupkg', ROOT / 'HERRAMIENTAS_DEV/reference-assemblies'),
    ]:
        with zipfile.ZipFile(cache / source) as package:
            package.extractall(destination)
    runtime = ROOT / '.build-python'
    (runtime / 'python314._pth').write_text('python314.zip\n.\nLib/site-packages\nimport site\n', encoding='utf-8')
    python = runtime / 'python.exe'
    wheelhouse = cache / 'wheelhouse'
    # Invoke pip directly from its pinned wheel; no mutable get-pip bootstrap.
    pip = next(wheelhouse.glob('pip-26.1.2-*.whl'))
    environment = dict(os.environ, PYTHONPATH=str(pip), PYTHONHASHSEED='0',
                       SOURCE_DATE_EPOCH=str(lock['source_date_epoch']))
    code = 'import sys;sys.path.insert(0,sys.argv.pop(1));from pip._internal.cli.main import main;sys.exit(main())'
    subprocess.run([str(python), '-c', code, str(pip), 'install', '--no-index', '--only-binary=:all:',
                    '--find-links', str(wheelhouse), '--require-hashes', '-r',
                    str(ROOT / 'HERRAMIENTAS_DEV/requirements.lock')], check=True, cwd=ROOT, env=environment)
    if not args.restore_only:
        environment.pop('ALIOTH_SIGN_LOCAL', None)
        subprocess.run([str(python), str(ROOT / 'build_executables.py'), '--edition', 'Distribucion',
                        '--release-dir', str(args.release_dir.resolve())], check=True, cwd=ROOT, env=environment)


if __name__ == '__main__':
    main()
