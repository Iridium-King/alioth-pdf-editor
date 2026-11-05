"""Read-only verification of the exact files embedded in the new release."""
import hashlib
import json
import marshal
import struct
from pathlib import Path

import pefile
from PyInstaller.archive.readers import CArchiveReader

ROOT = Path(__file__).resolve().parents[2]
RELEASE = ROOT.parent / 'ALIOTH PDF EDITOR EJECUTABLES' / 'Version_3.2.34'
FILES = ['BASE.html', 'css/app.chrome.css', 'js/app.core.js', 'js/app.pdf.js',
         'js/app.tools.js', 'js/app.pdf_ops.js', 'js/app.agentic.js',
         'js/python_manager.js', 'js/version.js']
results = []


def normalized_host(data):
    """C# rebuilds differ in their PE timestamp and CLR module GUID only."""
    image = pefile.PE(data=data)
    normalized = bytearray(data)
    struct.pack_into('<I', normalized, image.FILE_HEADER.get_field_absolute_offset('TimeDateStamp'), 0)
    clr = image.get_offset_from_rva(image.OPTIONAL_HEADER.DATA_DIRECTORY[14].VirtualAddress)
    metadata = image.get_offset_from_rva(struct.unpack_from('<I', data, clr + 8)[0])
    version_size = struct.unpack_from('<I', data, metadata + 12)[0]
    cursor = (metadata + 16 + version_size + 3) & ~3
    streams = struct.unpack_from('<H', data, cursor + 2)[0]
    cursor += 4
    for _ in range(streams):
        offset, size = struct.unpack_from('<II', data, cursor)
        end = data.index(b'\0', cursor + 8)
        name = data[cursor + 8:end]
        cursor = (end + 4) & ~3
        if name == b'#GUID':
            normalized[metadata + offset:metadata + offset + size] = bytes(size)
    image.close()
    return bytes(normalized)


for edition in ['Personal', 'Distribucion']:
    executable = RELEASE / edition / f'Alioth_PDF_Editor_{edition}.exe'
    archive = CArchiveReader(str(executable))
    for filename in FILES:
        assert archive.extract(filename.replace('/', '\\')) == (ROOT / filename).read_bytes(), filename
    assert normalized_host(archive.extract(r'native_host\AliothPDFHost.exe')) == normalized_host((ROOT / 'native_host/bin/AliothPDFHost.exe').read_bytes())
    assert ('config.ini' in archive.toc) == (edition == 'Personal')
    assert not any(name.endswith(('AliothPDFHost.Test.exe', 'Alioth-PDF-Local-Root.cer', 'Instalar-Certificado.cmd')) for name in archive.toc)
    assert '_proxy' in archive.toc
    backend = marshal.loads(archive.extract('_proxy'))
    expected_backend = compile((ROOT / '_proxy.py').read_text(encoding='utf-8'), '_proxy.py', 'exec')
    assert backend.co_code == expected_backend.co_code and backend.co_names == expected_backend.co_names
    results.append({'edition': edition, 'ok': True, 'bytes': executable.stat().st_size,
                    'sha256': hashlib.sha256(executable.read_bytes()).hexdigest(),
                    'verifiedAssets': len(FILES) + 1, 'personalConfiguration': edition == 'Personal'})
report = ROOT / 'HERRAMIENTAS_DEV/qa-runtime/release-verification.json'
report.write_text(json.dumps(results, indent=2), encoding='utf-8')
(RELEASE / 'SHA256.txt').write_text(''.join(f"{row['sha256']}  {row['edition']}/Alioth_PDF_Editor_{row['edition']}.exe\n" for row in results), encoding='utf-8')
print(json.dumps(results, indent=2))
