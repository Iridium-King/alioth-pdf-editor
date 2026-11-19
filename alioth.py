"""Single entry point for the Alioth editor, PDF CLI, and MCP stdio server."""

from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

PDF_COMMANDS = frozenset({
    "info", "text", "search", "replace", "redact", "render", "organize", "merge", "split", "tables",
})


def app_version():
    """Read the same version source used by the UI and packaging, without GUI imports."""
    source = (ROOT / "js/version.js").read_text(encoding="utf-8")
    match = re.search(r"const ALIOTH_VERSION = '([0-9]+(?:\.[0-9]+)*)'", source)
    return match.group(1) if match else "unknown"


def mcp_configuration():
    """A relocatable harness config for this exact source tree or future executable."""
    args = ["mcp", "serve"]
    if not getattr(sys, "frozen", False):
        args.insert(0, str(Path(__file__).resolve()))
    return {"mcpServers": {"alioth-pdf": {"command": sys.executable, "args": args}}}


def _launch_gui(args):
    import runpy

    original = sys.argv
    # The legacy startup owns forwarding PDFs and opening the native window.
    # Source launches through alioth.py should open that window just like double click.
    gui_args = list(args)
    if "--launch-browser" not in gui_args:
        gui_args.append("--launch-browser")
    sys.argv = [original[0], *gui_args]
    try:
        runpy.run_module("_proxy", run_name="__main__")
    finally:
        sys.argv = original
    return 0


def _mcp_main(args):
    import argparse
    import json

    parser = argparse.ArgumentParser(prog="alioth mcp", description="MCP stdio tools for local PDF files")
    commands = parser.add_subparsers(dest="action", required=True)
    commands.add_parser("serve", help="Serve MCP using stdin/stdout")
    check = commands.add_parser("check", help="Verify initialize, tools/list and PDF calls")
    check.add_argument("--timeout", type=float, default=15)
    commands.add_parser("config", help="Print harness configuration for this program")
    options = parser.parse_args(args)
    if options.action == "config":
        print(json.dumps(mcp_configuration(), ensure_ascii=False, indent=2))
        return 0
    if options.action == "check":
        from _mcp_check import main as check_main

        config = mcp_configuration()["mcpServers"]["alioth-pdf"]
        return check_main(["--timeout", str(options.timeout)],
                          server_command=[config["command"], *config["args"]])
    from _stdio import prepare_stdio
    prepare_stdio(require_stdin=True)
    import mcp_server
    return mcp_server.main([]) or 0


def main(argv=None):
    args = list(sys.argv[1:] if argv is None else argv)
    if not args or args[0] in {"gui", "--launch-browser"} or args[0].lower().endswith(".pdf"):
        return _launch_gui(args[1:] if args[:1] == ["gui"] else args)
    if args[0] in {"--mcp", "--cli"}:
        args = (["mcp", "serve", *args[1:]] if args[0] == "--mcp" else args[1:])
    if args[:1] == ["pdf"]:
        args = args[1:]
    from _stdio import StdioUnavailableError, prepare_stdio
    try:
        prepare_stdio()
        if args[:1] == ["mcp"]:
            return _mcp_main(args[1:])
        from _cli import main as cli_main
        return cli_main(args)
    except StdioUnavailableError as exc:
        if sys.stderr is not None:
            print(f"Alioth: {exc}", file=sys.stderr)
        return 2
    except BrokenPipeError:
        return 1


if __name__ == "__main__":
    sys.exit(main())
