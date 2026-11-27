"""Build macOS .app bundle for Alioth PDF Editor using PyInstaller."""
import os
import argparse
import hashlib
import json
import platform
from pathlib import Path
import re
import shutil
import subprocess
import sys
import urllib.request
import zipfile

BASE_DIR = Path(__file__).resolve().parent
RELEASE_DIR = BASE_DIR / 'RELEASE' / 'macOS'
VERSION_SOURCE = BASE_DIR / 'js' / 'version.js'

DATA_ITEMS = [
    ('BASE.html', '.'),
    ('ICONO 1.ico', '.'),
    ('favicon.ico', '.'),
    ('ICONOS', 'ICONOS'),
    ('css', 'css'),
    ('fonts', 'fonts'),
    ('js', 'js'),
    ('libs', 'libs'),
    ('LICENSE', '.'),
    ('COPYING', '.'),
    ('LEGAL_NOTICES.txt', '.'),
    ('SOURCE_CODE_NOTICE.txt', '.'),
    ('browser-migration.html', '.'),
]

HIDDEN_IMPORTS = [
    'openpyxl', 'fitz', 'pymupdf', 'pypdfium2', 'PIL', 'PIL.Image',
    'pytesseract', 'pptx', 'certifi', 'pdfplumber', 'pypdf', 'cryptography', 'cryptography.fernet',
    'http.server', 'mimetypes', 'configparser', 'json', 'queue',
    'urllib.request', 'ssl', 'tempfile', 'shutil', 'subprocess',
    'threading', 'time', 'webbrowser',
    '_proxy', '_cli', '_stdio', '_pdf_engine', '_pdf_gui', '_pdf_text',
    '_ocr_service', '_mcp_check', 'mcp_server',
    '_native_file_dialog', '_native_save', '_native_host',
    '_browser_migration', '_file_origin', '_windows_integration',
    '_process_lifecycle', '_system_fonts', '_transfer_store',
    '_user_preferences', '_window_chrome',
]


def get_app_version():
    source = VERSION_SOURCE.read_text(encoding='utf-8')
    match = re.search(r"const ALIOTH_VERSION = '([0-9]+(?:\.[0-9]+)*)'", source)
    if not match:
        raise RuntimeError(f'No se encontró ALIOTH_VERSION en {VERSION_SOURCE}')
    return match.group(1)


def generate_spec(version):
    datas = [(str(BASE_DIR / src), dst) for src, dst in DATA_ITEMS if (BASE_DIR / src).exists()]
    datas_str = '[\n' + ''.join(f'    ({src!r}, {dst!r}),\n' for src, dst in datas) + ']'
    icon_path = str(BASE_DIR / 'AliothPDF.icns')
    spec_content = f'''# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_submodules, collect_data_files, collect_dynamic_libs

block_cipher = None
datas = {datas_str}
datas += collect_data_files('pymupdf') + collect_data_files('certifi')
binaries = collect_dynamic_libs('pymupdf') + collect_dynamic_libs('pypdfium2_raw')

hiddenimports = {HIDDEN_IMPORTS!r} + collect_submodules('pymupdf') + collect_submodules('mcp.server') + ['mcp.types']

a = Analysis(
    [{str(BASE_DIR / 'alioth.py')!r}],
    pathex=[{str(BASE_DIR)!r}],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={{}},
    runtime_hooks=[],
    excludes=['win32com', 'pythoncom', 'win32timezone', 'pywintypes', 'mcp.cli'],
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='AliothPDF',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    icon={icon_path!r},
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='AliothPDF',
)

app = BUNDLE(
    coll,
    name='Alioth PDF Editor.app',
    icon={icon_path!r},
    bundle_identifier='com.alioth.pdfeditor',
    version={version!r},
    info_plist={{
        'CFBundleName': 'Alioth PDF Editor',
        'CFBundleDisplayName': 'Alioth PDF Editor',
        'CFBundleShortVersionString': {version!r},
        'CFBundleVersion': {version!r},
        'NSHighResolutionCapable': True,
        'LSMinimumSystemVersion': '11.0',
        'CFBundleDocumentTypes': [
            {{
                'CFBundleTypeName': 'PDF Document',
                'CFBundleTypeExtensions': ['pdf'],
                'CFBundleTypeMIMETypes': ['application/pdf'],
                'CFBundleTypeRole': 'Editor',
                'LSHandlerRank': 'Alternate',
                'LSItemContentTypes': ['com.adobe.pdf'],
            }}
        ],
    }},
)
'''
    spec_path = BASE_DIR / 'AliothPDF_macOS.spec'
    spec_path.write_text(spec_content, encoding='utf-8')
    return spec_path


def build_native_host():
    host_src = BASE_DIR / 'native_host_macos' / 'AliothMacHost.swift'
    host_bin = BASE_DIR / 'native_host_macos' / 'AliothMacHost'
    print('Compiling native macOS WKWebView host...')
    subprocess.check_call([
        'swiftc', '-O',
        '-target', f'{platform.machine()}-apple-macosx11.3',
        '-framework', 'Cocoa',
        '-framework', 'WebKit',
        '-framework', 'CoreServices',
        str(host_src),
        '-o', str(host_bin),
    ], cwd=BASE_DIR)
    return host_bin


def restore_assets(archive=None):
    lock = json.loads((BASE_DIR / 'HERRAMIENTAS_DEV/build-inputs.lock.json').read_text(encoding='utf-8'))
    assets = [item for item in lock['files'] if item['path'].startswith(('libs/', 'fonts/')) and not item['path'].startswith('libs/poppler/')]
    def valid(item):
        path = BASE_DIR / item['path']
        return path.is_file() and path.stat().st_size == item['bytes'] and hashlib.sha256(path.read_bytes()).hexdigest() == item['sha256']
    missing = [item for item in assets if not valid(item)]
    if not missing:
        return
    if archive is None:
        cache = BASE_DIR / 'HERRAMIENTAS_DEV/build-inputs'
        cache.mkdir(parents=True, exist_ok=True)
        archive = cache / lock['filename']
        if not archive.exists():
            with urllib.request.urlopen(lock['url'], timeout=120) as response, archive.open('wb') as output:
                shutil.copyfileobj(response, output)
    archive = Path(archive)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != lock['sha256']:
        raise ValueError('Build-input archive SHA-256 mismatch')
    with zipfile.ZipFile(archive) as package:
        for item in missing:
            data = package.read(item['path'])
            if len(data) != item['bytes'] or hashlib.sha256(data).hexdigest() != item['sha256']:
                raise ValueError('Build input mismatch: ' + item['path'])
            target = BASE_DIR / item['path']
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)


def main():
    import plistlib
    if sys.platform != 'darwin':
        raise SystemExit('La aplicación macOS debe compilarse en una Mac.')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inputs', type=Path, help='Archivo de recursos verificado para compilar sin conexión')
    args = parser.parse_args()
    restore_assets(args.inputs)
    version = get_app_version()
    print(f'Building Alioth PDF Editor {version} for macOS...')
    host_bin = build_native_host()
    spec_path = generate_spec(version)
    subprocess.check_call([sys.executable, '-m', 'PyInstaller', '--clean', '-y', str(spec_path)], cwd=BASE_DIR)

    built_app = BASE_DIR / 'dist' / 'Alioth PDF Editor.app'
    if not built_app.is_dir():
        raise RuntimeError(f'Expected app bundle not found: {built_app}')

    RELEASE_DIR.mkdir(parents=True, exist_ok=True)
    target_app = RELEASE_DIR / 'Alioth PDF Editor.app'
    if target_app.exists():
        shutil.rmtree(target_app)
    shutil.copytree(built_app, target_app, symlinks=True)

    # Install native macOS WKWebView host as primary CFBundleExecutable
    macos_dir = target_app / 'Contents' / 'MacOS'
    dest_host = macos_dir / 'AliothMacHost'
    shutil.copy2(host_bin, dest_host)
    os.chmod(dest_host, 0o755)

    plist_path = target_app / 'Contents' / 'Info.plist'
    with open(plist_path, 'rb') as f:
        plist = plistlib.load(f)
    plist['CFBundleExecutable'] = 'AliothMacHost'
    plist['LSMinimumSystemVersion'] = '11.3'
    plist['NSAppTransportSecurity'] = {'NSAllowsLocalNetworking': True}
    with open(plist_path, 'wb') as f:
        plistlib.dump(plist, f)

    # Ad-hoc codesign so macOS Apple Silicon allows execution cleanly
    subprocess.check_call(['codesign', '--force', '--deep', '--sign', '-', str(target_app)])
    print(f'Successfully built native macOS app: {target_app}')


if __name__ == '__main__':
    main()
