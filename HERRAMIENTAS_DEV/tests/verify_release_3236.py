"""Inspect both local editions without executing them or disclosing config."""
import hashlib
import json
import marshal
from pathlib import Path
import sys
import types
from PyInstaller.archive.readers import CArchiveReader

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'HERRAMIENTAS_DEV/publicacion'))
from publication_security import configured_secrets, scan

RELEASE = ROOT.parent / 'ALIOTH PDF EDITOR EJECUTABLES/Version_3.2.36'
proof = ROOT / 'HERRAMIENTAS_DEV/qa-runtime'
known = configured_secrets(ROOT)


def identity(code):
    return (code.co_code, code.co_names, code.co_varnames, code.co_freevars, code.co_cellvars,
            tuple(identity(item) if isinstance(item, types.CodeType) else item for item in code.co_consts))


results = []
for edition in ['Personal', 'Distribucion']:
    path = RELEASE / edition / f'Alioth_PDF_Editor_{edition}.exe'
    archive = CArchiveReader(str(path))
    assert ('config.ini' in archive.toc) == (edition == 'Personal')
    names = [name.replace('\\', '/').lower() for name in archive.toc]
    assert not any(name.startswith(('fonts/standard_fonts/', 'fonts_cache/', 'iconos/otros/')) for name in names)
    assert not any(name.endswith(('.pfx', '.p12', '.key', 'aliothpdfhost.test.exe')) for name in names)
    files = [ROOT / 'BASE.html', ROOT / 'js/version.js', ROOT / 'Alioth-PDF-Local-Root.cer']
    files += list((ROOT / 'js').rglob('*.js')) + list((ROOT / 'css').glob('*.css'))
    for source in files:
        name = source.relative_to(ROOT).as_posix()
        assert archive.extract(name.replace('/', '\\')) == source.read_bytes(), name
    embedded = marshal.loads(archive.extract('_proxy'))
    assert identity(embedded) == identity(compile((ROOT / '_proxy.py').read_text(encoding='utf-8'), '_proxy.py', 'exec'))
    python = archive.open_embedded_archive('PYZ.pyz')
    for module in ['_system_fonts', '_windows_integration', '_process_lifecycle', '_native_host']:
        embedded = python.extract(module)
        assert identity(embedded) == identity(compile((ROOT / (module + '.py')).read_text(encoding='utf-8'), module + '.py', 'exec')), module
    if edition == 'Distribucion':
        for name in archive.toc:
            normalized = name.replace('\\', '/')
            if normalized.endswith(('.js', '.css', '.html')) or name == '_proxy':
                assert not scan(archive.extract(name), normalized, known), normalized
        for module in python.toc:
            if module.startswith('_') and (ROOT / (module + '.py')).is_file():
                assert not scan(marshal.dumps(python.extract(module)), module, known), module
    (proof / f'host-{edition}-3236.exe').write_bytes(archive.extract(r'native_host\AliothPDFHost.exe'))
    results.append({'edition': edition, 'ok': True, 'bytes': path.stat().st_size,
                    'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'verifiedAssets': len(files),
                    'windowsFontsBundled': False, 'oldIconsBundled': False, 'personalConfiguration': edition == 'Personal'})
(proof / 'release-verification-3236.json').write_text(json.dumps(results, indent=2)+'\n')
(RELEASE / 'SHA256.txt').write_text(''.join(f"{r['sha256']}  {r['edition']}/Alioth_PDF_Editor_{r['edition']}.exe\n" for r in results))
print(json.dumps(results, indent=2))
