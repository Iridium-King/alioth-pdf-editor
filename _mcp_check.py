"""Check the real MCP stdio connection without starting an asyncio client loop."""

import argparse
import json
import math
from pathlib import Path
import queue
import subprocess
import sys
import tempfile
import threading
import time


ROOT = Path(sys.executable if getattr(sys, "frozen", False) else __file__).resolve().parent
EXPECTED_TOOLS = {
    "pdf_get_info", "pdf_read_text", "pdf_search_text", "pdf_splice_text",
    "pdf_redact_sensitive_data", "pdf_render_page_image", "pdf_organize_pages",
    "pdf_merge", "pdf_split", "pdf_extract_tables",
}


class StdioClient:
    def __init__(self, command, cwd, timeout):
        self.timeout = timeout
        self.messages = queue.Queue()
        self.errors = []
        self.request_id = 0
        self.process = subprocess.Popen(
            command, cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True, encoding="utf-8",
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        self.readers = [
            threading.Thread(target=self._read_messages, daemon=True),
            threading.Thread(target=self._read_errors, daemon=True),
        ]
        for reader in self.readers:
            reader.start()

    def _read_messages(self):
        try:
            for line in self.process.stdout:
                self.messages.put(json.loads(line))
        except (ValueError, OSError) as exc:
            self.messages.put(RuntimeError(f"Invalid MCP stdout: {exc}"))
        finally:
            self.messages.put(None)

    def _read_errors(self):
        for line in self.process.stderr:
            self.errors.append(line.rstrip())

    def send(self, method, params=None, request_id=None):
        message = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            message["params"] = params
        if request_id is not None:
            message["id"] = request_id
        self.process.stdin.write(json.dumps(message, ensure_ascii=False) + "\n")
        self.process.stdin.flush()

    def request(self, method, params):
        self.request_id += 1
        request_id = self.request_id
        self.send(method, params, request_id)
        deadline = time.monotonic() + self.timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError(f"{method}: no response within {self.timeout:g}s")
            try:
                message = self.messages.get(timeout=remaining)
            except queue.Empty:
                raise TimeoutError(f"{method}: no response within {self.timeout:g}s") from None
            if message is None:
                raise RuntimeError(f"Server closed stdout during {method}")
            if isinstance(message, Exception):
                raise message
            if message.get("id") != request_id:
                continue
            if "error" in message:
                raise RuntimeError(f"{method}: {message['error']}")
            return message["result"]

    def call_tool(self, name, arguments):
        result = self.request("tools/call", {"name": name, "arguments": arguments})
        if result.get("isError"):
            raise RuntimeError(f"{name}: {result}")
        text = next(item["text"] for item in result["content"] if item["type"] == "text")
        data = json.loads(text)
        if "error" in data:
            raise RuntimeError(f"{name}: {data['error']}")
        return data

    def close(self):
        # Closing stdin is the standard stdio shutdown signal.
        try:
            self.process.stdin.close()
        except BrokenPipeError:
            pass
        try:
            self.process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            self.process.terminate()
            self.process.wait(timeout=3)
        for reader in self.readers:
            reader.join(timeout=1)
        self.process.stdout.close()
        self.process.stderr.close()


def check_connection(command=None, timeout=15):
    import fitz

    if command is None:
        command = ([sys.executable] if getattr(sys, "frozen", False)
                   else [sys.executable, "-u", str(ROOT / "mcp_server.py")])
    with tempfile.TemporaryDirectory(prefix="alioth-mcp-") as directory:
        # A different cwd and a Unicode path also exercise desktop harness launches.
        pdf_path = Path(directory) / "prueba conexión.pdf"
        with fitz.open() as doc:
            page = doc.new_page()
            page.insert_text((72, 72), "Alioth MCP transport check")
            doc.save(pdf_path)

        client = StdioClient(command, cwd=directory, timeout=timeout)
        started = time.monotonic()
        try:
            result = client.request("initialize", {
                "protocolVersion": "2025-11-25", "capabilities": {},
                "clientInfo": {"name": "alioth-mcp-check", "version": "1.0"},
            })
            if result["serverInfo"]["name"] != "alioth-pdf-editor":
                raise RuntimeError(f"Unexpected server: {result['serverInfo']}")
            client.send("notifications/initialized")
            print(f"[PASS] initialize ({time.monotonic() - started:.2f}s)", flush=True)

            tools = client.request("tools/list", {})["tools"]
            names = {tool["name"] for tool in tools}
            if not EXPECTED_TOOLS.issubset(names):
                raise RuntimeError(f"Missing tools: {sorted(EXPECTED_TOOLS - names)}")
            print(f"[PASS] tools/list: {len(tools)} tools", flush=True)

            info = client.call_tool("pdf_get_info", {"filepath": str(pdf_path)})
            if info["page_count"] != 1:
                raise RuntimeError(f"Unexpected page count: {info['page_count']}")
            text = client.call_tool("pdf_read_text", {"filepath": str(pdf_path)})
            if "Alioth MCP transport check" not in text["text"]:
                raise RuntimeError("PDF text did not match the test document")
            print("[PASS] tools/call: PDF metadata and text, Unicode file path", flush=True)
        finally:
            client.close()
            if client.errors:
                print("Server stderr:\n" + "\n".join(client.errors[-15:]), file=sys.stderr)
        if client.process.returncode != 0:
            raise RuntimeError(f"Server did not shut down cleanly: {client.process.returncode}")
        print("[PASS] clean shutdown on stdin EOF", flush=True)


def main(argv=None, server_command=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--timeout", type=float, default=15, help="Seconds per MCP request")
    args = parser.parse_args(argv)
    if not math.isfinite(args.timeout) or args.timeout <= 0:
        parser.error("--timeout must be finite and positive")
    try:
        check_connection(command=server_command, timeout=args.timeout)
    except Exception as exc:
        print(f"[FAIL] {exc}", file=sys.stderr)
        if isinstance(exc, TimeoutError):
            print(
                "On restricted Windows hosts, asyncio's internal loopback socket may be blocked. "
                "Check local-process/network permissions and run this check from a normal terminal.",
                file=sys.stderr,
            )
        return 1
    print("MCP STDIO CONNECTION VERIFIED", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
