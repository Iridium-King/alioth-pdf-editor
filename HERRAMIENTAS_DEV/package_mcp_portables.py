"""Add the standalone MCP server to local portable editions and build verified ZIPs."""

import argparse
import hashlib
from importlib import metadata
import json
from pathlib import Path
import shutil
import sys
import zipfile

from PyInstaller.archive.readers import CArchiveReader

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from build_executables import get_app_version


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def license_files(executable):
    archive = CArchiveReader(str(executable))
    names = [name.replace("\\", "/").lower() for name in archive.toc]
    if any(Path(name).name in {"config.ini", "preferences.json"}
           or Path(name).suffix in {".pfx", ".p12", ".key"} for name in names):
        raise RuntimeError("MCP binary contains a prohibited personal file")
    modules = archive.open_embedded_archive("PYZ.pyz")
    assert "_mcp_check" in modules.toc
    used = {module.split(".")[0] for module in modules.toc}
    mapping = metadata.packages_distributions()
    distributions = {name for module in used for name in mapping.get(module, [])}
    files = {"LICENCIAS_MCP/Python/LICENSE.txt": ROOT / "_python/LICENSE.txt"}
    for name in sorted(distributions):
        distribution = metadata.distribution(name)
        for item in distribution.files or []:
            if ".." in item.parts:
                continue
            parts = item.as_posix().split("/")
            if len(parts) < 2 or not parts[0].endswith(".dist-info"):
                continue
            tail = "/".join(parts[1:])
            if (tail == "METADATA" or tail.startswith("licenses/")
                    or Path(tail).name.lower().startswith(("license", "copying", "notice"))):
                source = Path(distribution.locate_file(item))
                if source.is_file():
                    files[f"LICENCIAS_MCP/{name}/{tail}"] = source
    return files


def copy_with_backup(source, target, backup):
    if target.exists() and sha(target) == sha(source):
        return
    if target.exists():
        backup.parent.mkdir(parents=True, exist_ok=True)
        if not backup.exists():
            shutil.copy2(target, backup)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)
    assert sha(target) == sha(source), target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-root", type=Path, required=True)
    parser.add_argument("--mirror-root", type=Path)
    parser.add_argument("--edition", choices=["Personal", "Distribucion", "both"], default="Distribucion")
    parser.add_argument("--mcp-executable", type=Path, default=ROOT / "RELEASE/MCP/Alioth_PDF_MCP.exe")
    args = parser.parse_args()
    release = args.release_root.resolve()
    mcp = args.mcp_executable.resolve()
    version = get_app_version()
    editions = ["Personal", "Distribucion"] if args.edition == "both" else [args.edition]
    backup = release.parent / f"Respaldos_antes_MCP_{version}"
    shared = {name: ROOT / name for name in [
        "CLI_GUIDE.md", "MCP_GUIDE.md", "run_mcp_server.bat", "MOSTRAR_CONFIG_MCP.cmd",
        "LICENSE", "COPYING", "LEGAL_NOTICES.txt", "SOURCE_CODE_NOTICE.txt",
    ]}
    shared["Alioth_PDF_MCP.exe"] = mcp
    shared.update(license_files(mcp))
    result = []
    for edition in editions:
        editor_name = f"Alioth_PDF_Editor_{edition}.exe"
        editor = release / edition / editor_name
        if not editor.is_file():
            raise FileNotFoundError(editor)
        editor_hash = sha(editor)
        stage = ROOT / "build/mcp-package" / version / edition
        stage.mkdir(parents=True, exist_ok=True)
        files = {editor_name: editor, **shared}
        for name, source in files.items():
            target = stage / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
        readme = stage / "LEEME_MCP.txt"
        readme.write_text(
            f"Alioth PDF Editor {version} - {edition}\n\n"
            "Extrae el ZIP completo antes de usarlo.\n"
            f"Editor: {editor_name}\n"
            "El editor tambien ofrece comandos PDF y MCP. Consulta CLI_GUIDE.md.\n"
            "Servidor MCP independiente: Alioth_PDF_MCP.exe (Windows x64).\n"
            "No requiere Python instalado. Transporte: stdio.\n"
            "MOSTRAR_CONFIG_MCP.cmd muestra la configuracion con la ruta actual.\n"
            "Verificacion: run_mcp_server.bat --check\n"
            "Consulta MCP_GUIDE.md para conectar el harness.\n\n"
            + ("La edicion Personal conserva configuracion privada: no publicarla.\n" if edition == "Personal" else "")
            + "Los ejecutables tienen firma local propia.\n",
            encoding="utf-8",
        )
        names = sorted([*files, readme.name])
        hashes = {name: sha(stage / name) for name in names}
        manifest = stage / "SHA256.txt"
        manifest.write_text("".join(f"{hashes[name]}  {name}\n" for name in names), encoding="utf-8")
        names.append(manifest.name)
        destinations = [release / edition]
        if args.mirror_root:
            destinations.append(args.mirror_root.resolve() / edition)
        for destination in destinations:
            for name in names:
                # Snapshot changed files before replacing local portable copies.
                relative = destination.relative_to(release.parent)
                copy_with_backup(stage / name, destination / name, backup / relative / name)

        packages = release / "Paquetes"
        packages.mkdir(parents=True, exist_ok=True)
        package = packages / f"Alioth_PDF_Editor_{edition}_{version}.zip"
        temporary = package.with_suffix(".zip.tmp")
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for name in sorted(names):
                archive.write(stage / name, name)
        with zipfile.ZipFile(temporary) as archive:
            assert archive.testzip() is None
            assert set(archive.namelist()) == set(names)
            for name in names:
                assert hashlib.sha256(archive.read(name)).hexdigest() == sha(stage / name), name
        if package.exists():
            old = backup / "Paquetes" / package.name
            old.parent.mkdir(parents=True, exist_ok=True)
            if not old.exists():
                shutil.copy2(package, old)
        temporary.replace(package)
        assert sha(editor) == editor_hash, "The signed GUI executable changed unexpectedly"
        result.append({"edition": edition, "version": version, "package": str(package),
                       "sha256": sha(package), "bytes": package.stat().st_size,
                       "files": len(names), "editor_sha256": editor_hash,
                       "mcp_sha256": sha(mcp), "destinations": [str(p) for p in destinations]})
    proof = release / "MCP_PORTABLE_VERIFICACION.json"
    proof.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2), flush=True)


if __name__ == "__main__":
    main()
