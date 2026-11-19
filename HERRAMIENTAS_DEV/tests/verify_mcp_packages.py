"""Verify extracted portable packages without Python in PATH or development files."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[2]


def verify(release):
    proof = json.loads((release / "MCP_PORTABLE_VERIFICACION.json").read_text())
    results = []
    for item in proof:
        archive_path = Path(item["package"])
        assert hashlib.sha256(archive_path.read_bytes()).hexdigest() == item["sha256"]
        with tempfile.TemporaryDirectory(prefix="alioth portable sin Python ") as directory:
            temp = Path(directory)
            with zipfile.ZipFile(archive_path) as archive:
                for name in ["Alioth_PDF_MCP.exe", "run_mcp_server.bat", "MOSTRAR_CONFIG_MCP.cmd"]:
                    archive.extract(name, temp)
            assert hashlib.sha256((temp / "Alioth_PDF_MCP.exe").read_bytes()).hexdigest() == item["mcp_sha256"]
            env = dict(os.environ)
            env.pop("PYTHONHOME", None)
            env.pop("PYTHONPATH", None)
            windows = Path(os.environ.get("SYSTEMROOT") or os.environ.get("WINDIR") or "C:/Windows")
            assert (windows / "System32/cmd.exe").is_file()
            env["SYSTEMROOT"] = str(windows)
            env["PATH"] = str(windows / "System32") + ";" + str(windows / "System32/WindowsPowerShell/v1.0")
            command = [str(windows / "System32/cmd.exe"), "/d", "/c"]
            check = subprocess.run(command + ["run_mcp_server.bat", "--check"], cwd=temp, env=env,
                                   capture_output=True, text=True, encoding="utf-8", timeout=60)
            print(item["edition"], check.stdout, check.stderr, flush=True)
            assert check.returncode == 0, check.returncode
            output = subprocess.run(command + ["MOSTRAR_CONFIG_MCP.cmd"], cwd=temp, env=env,
                                    capture_output=True, text=True, encoding="utf-8", timeout=20)
            assert output.returncode == 0, output.stderr
            config = json.loads(output.stdout)
            assert Path(config["mcpServers"]["alioth-pdf"]["command"]) == temp / "Alioth_PDF_MCP.exe"
            assert config["mcpServers"]["alioth-pdf"]["args"] == []
            results.append({"edition": item["edition"], "zip_sha256": item["sha256"],
                            "standalone_check": True, "python_removed_from_path": True,
                            "config_generator": True})
    report = release / "MCP_PRUEBA_ZIP.json"
    report.write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
    print("BOTH PACKAGES VERIFIED WITHOUT PYTHON ON PATH", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("release", type=Path)
    args = parser.parse_args()
    verify(args.release.resolve())
