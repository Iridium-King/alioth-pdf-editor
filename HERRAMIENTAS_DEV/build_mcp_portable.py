"""Build the standalone stdio MCP server; no personal settings are bundled."""

import argparse
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "RELEASE/MCP")
    args = parser.parse_args()
    sys.path.insert(0, str(ROOT))
    from build_executables import write_version_info

    work = ROOT / "build/mcp-portable"
    work.mkdir(parents=True, exist_ok=True)
    version = write_version_info(work / "MCP.version")
    metadata = version.read_text(encoding="utf-8")
    version.write_text(metadata.replace("AliothPDF.exe", "Alioth_PDF_MCP.exe"), encoding="utf-8")
    command = [
        sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean",
        "--onefile", "--console", "--name", "Alioth_PDF_MCP",
        "--distpath", str(args.output_dir.resolve()),
        "--workpath", str(work / "work"), "--specpath", str(work),
        "--paths", str(ROOT), "--version-file", str(version),
        "--icon", str(ROOT / "ICONO 1.ico"),
        "--collect-submodules", "mcp.server", "--collect-submodules", "mcp.shared",
        "--collect-submodules", "mcp.os", "--collect-data", "mcp",
        "--exclude-module", "mcp.cli", "--collect-all", "mcp_types",
        "--collect-all", "pymupdf", "--hidden-import", "win32timezone",
        "--copy-metadata", "mcp", "--copy-metadata", "mcp-types",
        str(ROOT / "mcp_server.py"),
    ]
    subprocess.run(command, cwd=ROOT, check=True)
    print(f"MCP portable: {args.output_dir.resolve() / 'Alioth_PDF_MCP.exe'}", flush=True)


if __name__ == "__main__":
    main()
