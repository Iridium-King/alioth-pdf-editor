"""PDF command-line interface. Imports the shared engine only for operations."""

import argparse
import json
import sys


class UsageError(ValueError):
    pass


class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise UsageError(message)


def app_version():
    from alioth import app_version as read_version
    return read_version()


def positive(value):
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return number


def page_list(value):
    try:
        pages = [positive(part.strip()) for part in value.split(",")]
    except (ValueError, argparse.ArgumentTypeError):
        raise argparse.ArgumentTypeError("use page numbers separated by commas, e.g. 1,3,2") from None
    return pages


def rotation(value):
    try:
        page, angle = value.split(":")
        page, angle = positive(page), int(angle)
        if angle not in (90, 180, 270):
            raise ValueError()
    except (ValueError, argparse.ArgumentTypeError):
        raise argparse.ArgumentTypeError("use PAGE:ANGLE with angle 90, 180 or 270, e.g. 1:90") from None
    return str(page), angle


def _json_option(parser):
    # SUPPRESS keeps a root-level --json when a subparser has no local flag.
    parser.add_argument("--json", action="store_true", default=argparse.SUPPRESS,
                        help="Write machine-readable JSON; errors go to stderr")


def build_parser():
    parser = Parser(prog="AliothPDF", description="PDF editor, command-line tools and MCP server")
    _json_option(parser)
    parser.add_argument("--version", action="version", version=f"Alioth PDF Editor {app_version()}")
    commands = parser.add_subparsers(dest="command", required=True)

    def command(name, description, tool, filepath=True):
        cmd = commands.add_parser(name, help=description, description=description)
        _json_option(cmd)
        cmd.set_defaults(tool=tool)
        if filepath:
            cmd.add_argument("filepath", help="Input PDF path; relative paths use the current directory")
        cmd.add_argument("--password", default="", help="Password for encrypted input PDFs")
        return cmd

    def page(cmd, default):
        cmd.add_argument("--page", "--page-number", dest="page_number", type=int, default=default,
                         help="Page number (1-based); 0 selects all pages when supported")

    def output(cmd, required=True):
        cmd.add_argument("-o", "--output", dest="output_path", required=required, default="",
                         help="Output path; overwriting an input PDF is rejected")

    command("info", "Inspect PDF metadata and page dimensions", "pdf_get_info")
    cmd = command("text", "Extract PDF text, blocks or words", "pdf_read_text")
    page(cmd, 1)
    cmd.add_argument("--detail", dest="detail_level", choices=["text", "blocks", "words"], default="text")
    cmd = command("search", "Find text with page numbers and coordinates", "pdf_search_text")
    cmd.add_argument("query")
    page(cmd, 0)
    cmd.add_argument("--case-sensitive", action="store_true")
    cmd = command("replace", "Replace text in a PDF page", "pdf_splice_text")
    cmd.add_argument("old_text")
    cmd.add_argument("new_text")
    page(cmd, 1)
    output(cmd)
    cmd.add_argument("--font-name", default="")
    cmd.add_argument("--font-size", type=float, default=0.0)
    cmd.add_argument("--color", dest="color_hex", default="")
    cmd = command("redact", "Permanently remove matching text or patterns", "pdf_redact_sensitive_data")
    cmd.add_argument("patterns", nargs="+")
    page(cmd, 0)
    output(cmd)
    cmd.add_argument("--fill-color", default="black")
    cmd = command("render", "Render a PDF page as a PNG", "pdf_render_page_image")
    page(cmd, 1)
    output(cmd, required=False)
    cmd.add_argument("--dpi", type=positive, default=150)
    cmd = command("organize", "Rotate, delete or reorder PDF pages", "pdf_organize_pages")
    output(cmd)
    cmd.add_argument("--rotate", action="append", type=rotation, default=[], metavar="PAGE:ANGLE")
    cmd.add_argument("--delete", dest="delete_pages", type=page_list)
    cmd.add_argument("--order", dest="reorder_pages", type=page_list)
    cmd = command("merge", "Merge PDFs in the specified order", "pdf_merge", filepath=False)
    cmd.add_argument("input_paths", nargs="+")
    output(cmd)
    cmd = command("split", "Split a PDF by ranges or individual pages", "pdf_split")
    cmd.add_argument("-o", "--output-dir", dest="output_dir", required=True)
    cmd.add_argument("--ranges", nargs="+", help="1-based ranges, e.g. 1-3 4-6, or 1-3,4-6")
    cmd = command("tables", "Extract tables as Markdown, CSV or JSON", "pdf_extract_tables")
    page(cmd, 1)
    cmd.add_argument("--format", dest="output_format", choices=["markdown", "csv", "json"], default="markdown")

    # The entrypoint handles these modes before importing the engine or GUI.
    commands.add_parser("gui", help="Open the graphical editor")
    mcp = commands.add_parser("mcp", help="MCP server and connection diagnostics")
    sub = mcp.add_subparsers(dest="mcp_command", required=True)
    sub.add_parser("serve", help="Serve MCP over stdin/stdout")
    check = sub.add_parser("check", help="Verify the actual MCP connection")
    check.add_argument("--timeout", type=float, default=15)
    sub.add_parser("config", help="Print a JSON MCP configuration for this installation")
    return parser


def _arguments(namespace):
    arguments = vars(namespace).copy()
    for key in ["json", "command", "tool"]:
        arguments.pop(key, None)
    if namespace.command == "merge" and len(namespace.input_paths) < 2:
        raise UsageError("merge requires at least two input PDFs")
    if namespace.command == "organize":
        rotations = arguments.pop("rotate")
        arguments["rotations"] = dict(rotations) or None
        if not any(arguments.get(key) for key in ["rotations", "delete_pages", "reorder_pages"]):
            raise UsageError("organize requires --rotate, --delete or --order")
    if namespace.command == "split" and arguments["ranges"]:
        arguments["ranges"] = [part.strip() for item in arguments["ranges"] for part in item.split(",")]
    return arguments


def _print_result(result, command, as_json):
    if as_json:
        print(json.dumps(result, ensure_ascii=False, allow_nan=False))
    elif command == "text" and ("text" in result or "pages" in result):
        if "text" in result:
            print(result["text"])
        elif all("text" in page for page in result["pages"]):
            print("\n\f\n".join(page["text"] for page in result["pages"]))
        else:
            print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
    elif command == "tables" and all(isinstance(table["content"], str) for table in result.get("tables", [])):
        print("\n\n".join(table["content"] for table in result.get("tables", [])))
    else:
        print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))


def _print_error(message, code, as_json):
    if as_json:
        print(json.dumps({"error": str(message), "code": code}, ensure_ascii=False), file=sys.stderr)
    else:
        print(f"{code}: {message}", file=sys.stderr)


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0] in ("pdf", "--cli"):
        argv.pop(0)
    as_json = "--json" in argv
    try:
        args = build_parser().parse_args(argv)
        if args.command in ("gui", "mcp"):
            raise UsageError("use alioth.py as the entrypoint for GUI and MCP modes")
        arguments = _arguments(args)
        from _pdf_engine import execute
        result = execute(args.tool, arguments)
        if "error" in result:
            _print_error(result["error"], result.get("code", "PDF_ERROR"), as_json)
            return 1
        _print_result(result, args.command, as_json)
        return 0
    except UsageError as exc:
        _print_error(exc, "USAGE_ERROR", as_json)
        return 2
    except SystemExit as exc:
        return exc.code
    except KeyboardInterrupt:
        _print_error("Interrupted", "INTERRUPTED", as_json)
        return 130
    except Exception as exc:
        _print_error(exc, "RUNTIME_ERROR", as_json)
        return 1


if __name__ == "__main__":
    sys.exit(main())
