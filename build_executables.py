import os
from pathlib import Path
import re
import shutil
import subprocess

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
RELEASE_DIR = os.path.join(BASE_DIR, 'RELEASE')
VERSION_SOURCE = os.path.join(BASE_DIR, 'js', 'version.js')
VERSION_INFO_PATH = os.path.join(BASE_DIR, 'Alioth_PDF_Editor.version')
COMPANY_NAME = 'ALIOTH TDAH LABS - OPEN SOURCE PROJECT'
PRODUCT_NAME = 'ALIOTH PDF EDITOR'

DATA_FOLDERS = [
    ('BASE.html', '.'), ('ICONO 1.ico', '.'), ('favicon.ico', '.'), ('ICONOS', 'ICONOS'), ('css', 'css'),
    ('fonts', 'fonts'), ('fonts_cache', 'fonts_cache'), ('js', 'js'), ('libs', 'libs'),
    ('LICENSE', '.'), ('LEGAL_NOTICES.txt', '.'), ('SOURCE_CODE_NOTICE.txt', '.'),
    ('browser-migration.html', '.'),
    ('native_host/bin/AliothPDFHost.exe', 'native_host'),
    ('native_host/bin/Microsoft.Web.WebView2.Core.dll', 'native_host'),
    ('native_host/bin/Microsoft.Web.WebView2.WinForms.dll', 'native_host'),
    ('native_host/bin/WebView2Loader.dll', 'native_host'),
    ('native_host/bin/LICENSE.txt', 'native_host'),
]

HIDDEN_IMPORTS = [
    'openpyxl', 'fitz', 'pymupdf', 'pypdfium2', 'PIL', 'PIL.Image', 'pytesseract',
    'win32com', 'win32com.client', 'pythoncom', 'http.server', 'mimetypes',
    'configparser', 'json', 'queue', 'urllib.request', 'ssl', 'tempfile', 'shutil',
    'subprocess', 'threading', 'time', 'webbrowser',
]

POPPLER_ROOT_DLLS = set('''deflate.dll freetype.dll icudt78.dll icuuc78.dll jpeg8.dll
lcms2.dll lerc.dll libcrypto-3-x64.dll libcurl.dll liblzma.dll libpng16.dll
libssh2.dll openjp2.dll poppler.dll psl-5.dll tiff.dll zlib.dll zstd.dll'''.split())


def deduplicate_poppler(binaries, datas):
    import hashlib
    import pefile

    prefix = 'libs/poppler/library/bin/'
    normalize = lambda name: name.replace('\\', '/').lower()
    entries = {normalize(item[0]): item for item in binaries + datas}
    redundant = set()
    for name in POPPLER_ROOT_DLLS:
        original, nested = entries.get(name), entries.get(prefix + name)
        if original and nested and (
            hashlib.sha256(Path(original[1]).read_bytes()).digest() ==
            hashlib.sha256(Path(nested[1]).read_bytes()).digest()
        ):
            redundant.add(name)
    for destination, source, _ in binaries + datas:
        destination = normalize(destination)
        if destination in redundant or destination.startswith(prefix) or Path(source).suffix.lower() not in ('.dll', '.pyd', '.exe'):
            continue
        image = pefile.PE(source, fast_load=True)
        try:
            image.parse_data_directories(directories=[1, 13])
            imports = {item.dll.decode('ascii').lower() for kind in ('DIRECTORY_ENTRY_IMPORT', 'DIRECTORY_ENTRY_DELAY_IMPORT') for item in getattr(image, kind, [])}
        finally:
            image.close()
        if imports & redundant:
            raise RuntimeError(f'{destination} requires Poppler DLLs at archive root: {sorted(imports & redundant)}')
    print(f'Verified duplicate Poppler roots removed: {len(redundant)}')
    return ([item for item in binaries if normalize(item[0]) not in redundant],
            [item for item in datas if normalize(item[0]) not in redundant])


def get_app_version():
    source = Path(VERSION_SOURCE).read_text(encoding='utf-8')
    match = re.search(r"const ALIOTH_VERSION = '([0-9]+(?:\.[0-9]+)*)'", source)
    if not match:
        raise RuntimeError(f'No se encontró ALIOTH_VERSION en {VERSION_SOURCE}')
    return match.group(1)


def write_version_info(output_path=VERSION_INFO_PATH):
    version = get_app_version()
    parts = [int(part) for part in version.split('.')]
    file_parts = tuple((parts + [0, 0, 0, 0])[:4])
    file_version = '.'.join(str(part) for part in file_parts)
    content = f"""VSVersionInfo(
  ffi=FixedFileInfo(
    filevers={file_parts},
    prodvers={file_parts},
    mask=0x3f,
    flags=0x0,
    OS=0x40004,
    fileType=0x1,
    subtype=0x0,
    date=(0, 0)
  ),
  kids=[
    StringFileInfo([
      StringTable(
        '040904B0',
        [
          StringStruct('CompanyName', '{COMPANY_NAME}'),
          StringStruct('FileDescription', '{PRODUCT_NAME}'),
          StringStruct('FileVersion', '{file_version}'),
          StringStruct('InternalName', 'AliothPDF'),
          StringStruct('LegalCopyright', 'Open Source Project'),
          StringStruct('OriginalFilename', 'AliothPDF.exe'),
          StringStruct('ProductName', '{PRODUCT_NAME}'),
          StringStruct('ProductVersion', '{version}')
        ]
      )
    ]),
    VarFileInfo([VarStruct('Translation', [1033, 1200])])
  ]
)
"""
    path = Path(output_path)
    path.write_text(content, encoding='utf-8')
    return path


def generate_spec(output_name, include_personal_config, version_info_path=None):
    version_info_path = Path(version_info_path or write_version_info()).resolve()
    datas = list(DATA_FOLDERS)
    if include_personal_config:
        datas.append(('config.ini', '.'))
    datas_str = '[\n' + ''.join(f"        (r'{src}', r'{dst}'),\n" for src, dst in datas) + '    ]'
    spec_content = f'''# -*- mode: python ; coding: utf-8 -*-
block_cipher = None
datas = {datas_str}
a = Analysis(
    [r'_proxy.py'], pathex=[r'{BASE_DIR}'], binaries=[], datas=datas,
    hiddenimports={HIDDEN_IMPORTS!r}, hookspath=[], hooksconfig={{}}, runtime_hooks=[],
    excludes=[], win_no_prefer_redirects=False, win_private_assemblies=False,
    cipher=block_cipher, noarchive=False,
)
import sys
sys.path.insert(0, r'{BASE_DIR}')
from build_executables import deduplicate_poppler
a.binaries, a.datas = deduplicate_poppler(a.binaries, a.datas)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)
exe = EXE(
    pyz, a.scripts, a.binaries, a.zipfiles, a.datas, [], name='{output_name}', debug=False,
    bootloader_ignore_signals=False, strip=False, upx=False, upx_exclude=[], runtime_tmpdir=None,
    console=False, disable_windowed_traceback=False, argv_emulation=False, target_arch=None,
    version=r'{version_info_path}',
    icon=r'{os.path.join(BASE_DIR, "ICONO 1.ico")}',
)
'''
    spec_path = os.path.join(BASE_DIR, f'{output_name}.spec')
    with open(spec_path, 'w', encoding='utf-8') as file:
        file.write(spec_content)
    return spec_path


def clean_release_directory(directory):
    """Elimina residuos efimeros (alioth.port, alioth.pid, scripts viejos) de la carpeta."""
    for filename in ['alioth.port', 'alioth.pid', 'Instalar-Certificado.cmd', 'Alioth-PDF-Local-Root.cer']:
        target = os.path.join(directory, filename)
        if os.path.exists(target):
            try:
                os.remove(target)
            except Exception:
                pass


def build_exe(output_name, include_personal_config, package_name):
    subprocess.check_call([os.path.join(BASE_DIR, '_python', 'python.exe'),
                           os.path.join(BASE_DIR, 'native_host', 'build.py')], cwd=BASE_DIR)
    version_info_path = write_version_info()
    spec_path = generate_spec(output_name, include_personal_config, version_info_path)
    subprocess.check_call([os.path.join(BASE_DIR, '_python', 'python.exe'), '-m', 'PyInstaller', '--clean', '-y', spec_path], cwd=BASE_DIR)
    source = os.path.join(BASE_DIR, 'dist', f'{output_name}.exe')
    destination_dir = os.path.join(RELEASE_DIR, package_name)
    os.makedirs(destination_dir, exist_ok=True)
    destination = os.path.join(destination_dir, f'{output_name}.exe')
    shutil.copy2(source, destination)
    clean_release_directory(destination_dir)
    return destination


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--release-dir', default=RELEASE_DIR)
    RELEASE_DIR = os.path.abspath(parser.parse_args().release_dir)
    personal = build_exe('Alioth_PDF_Editor_Personal', True, 'Personal')
    distribution = build_exe('Alioth_PDF_Editor_Distribucion', False, 'Distribucion')
    print(f'Personal: {personal}')
    print(f'Distribucion: {distribution}')

