"""Exercise all ten MCP tools against a source command or binary and temporary PDFs."""

import argparse
from pathlib import Path
import sys
import tempfile

import fitz

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from _mcp_check import StdioClient, check_connection


def verify(executable, server_args=()):
    command = [str(executable), *server_args]
    check_connection(command, timeout=30)
    with tempfile.TemporaryDirectory(prefix="alioth-mcp-tools-") as directory:
        temp = Path(directory)
        source = temp / "documento de prueba.pdf"
        with fitz.open() as doc:
            page = doc.new_page()
            page.insert_text((72, 72), "Alioth original text")
            page.insert_text((72, 110), "Sensitive SECRET123 data")
            for x in [72, 180, 300]:
                page.draw_line((x, 160), (x, 220))
            for y in [160, 190, 220]:
                page.draw_line((72, y), (300, y))
            for x, y, text in [(80, 180, "Name"), (188, 180, "Value"),
                               (80, 210, "Alpha"), (188, 210, "42")]:
                page.insert_text((x, y), text)
            doc.new_page().insert_text((72, 72), "Second page")
            doc.save(source)

        client = StdioClient(command, cwd=directory, timeout=30)
        try:
            client.request("initialize", {
                "protocolVersion": "2025-11-25", "capabilities": {},
                "clientInfo": {"name": "alioth-portable-verification", "version": "1.0"},
            })
            client.send("notifications/initialized")
            call = client.call_tool
            path = str(source)
            assert call("pdf_get_info", {"filepath": path})["page_count"] == 2
            assert "Second page" in str(call("pdf_read_text", {"filepath": path, "page_number": 0}))
            assert call("pdf_search_text", {"filepath": path, "query": "original"})["total_matches"] == 1

            edited = temp / "edited.pdf"
            call("pdf_splice_text", {"filepath": path, "page_number": 1,
                 "old_text": "original", "new_text": "updated", "output_path": str(edited)})
            with fitz.open(edited) as doc:
                assert "updated" in doc[0].get_text() and "original" not in doc[0].get_text()

            redacted = temp / "redacted.pdf"
            call("pdf_redact_sensitive_data", {"filepath": path, "patterns": ["SECRET123"],
                 "output_path": str(redacted)})
            with fitz.open(redacted) as doc:
                assert "SECRET123" not in doc[0].get_text()

            image = temp / "render.png"
            call("pdf_render_page_image", {"filepath": path, "dpi": 72, "output_path": str(image)})
            assert image.read_bytes().startswith(b"\x89PNG\r\n\x1a\n")

            organized = temp / "organized.pdf"
            call("pdf_organize_pages", {"filepath": path, "output_path": str(organized),
                 "rotations": {"1": 90}, "reorder_pages": [2, 1]})
            with fitz.open(organized) as doc:
                assert "Second page" in doc[0].get_text() and doc[1].rotation == 90

            merged = temp / "merged.pdf"
            call("pdf_merge", {"input_paths": [path, str(organized)], "output_path": str(merged)})
            with fitz.open(merged) as doc:
                assert len(doc) == 4

            split = call("pdf_split", {"filepath": path, "output_dir": str(temp / "split")})
            assert len(split["created_files"]) == 2
            for item in split["created_files"]:
                with fitz.open(item) as doc:
                    assert len(doc) == 1
            tables = call("pdf_extract_tables", {"filepath": path, "output_format": "json"})
            assert tables["table_count"] == 1 and "Alpha" in str(tables["tables"])
            print("[PASS] all 10 MCP tools: verified PDF outputs, PNG and table contents", flush=True)
        finally:
            client.close()
        assert client.process.returncode == 0, client.errors


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("executable", type=Path)
    parser.add_argument("server_args", nargs=argparse.REMAINDER,
                        help="Optional source entrypoint and arguments, using absolute paths")
    args = parser.parse_args()
    verify(args.executable.resolve(), args.server_args)
