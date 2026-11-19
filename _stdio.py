"""Restore inherited standard streams for Windows GUI executables.

PyInstaller's windowed bootloader and pythonw leave sys.std* as None even when
a harness supplied pipes. Reopen those handles rather than creating a console
or replacing the protocol streams with the null device.
"""

import io
import os
import sys


class StdioUnavailableError(RuntimeError):
    """A command was launched without the standard streams it needs."""


def _available(stream):
    return stream is not None and not getattr(stream, "closed", False)


def _restore_windows_streams(required):
    import ctypes
    from ctypes import wintypes
    import msvcrt

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.GetStdHandle.argtypes = [wintypes.DWORD]
    kernel32.GetStdHandle.restype = wintypes.HANDLE
    kernel32.GetFileType.argtypes = [wintypes.HANDLE]
    kernel32.GetFileType.restype = wintypes.DWORD
    kernel32.AttachConsole.argtypes = [wintypes.DWORD]
    kernel32.AttachConsole.restype = wintypes.BOOL
    kernel32.GetCurrentProcess.restype = wintypes.HANDLE
    kernel32.DuplicateHandle.argtypes = [
        wintypes.HANDLE, wintypes.HANDLE, wintypes.HANDLE,
        ctypes.POINTER(wintypes.HANDLE), wintypes.DWORD, wintypes.BOOL, wintypes.DWORD,
    ]
    kernel32.DuplicateHandle.restype = wintypes.BOOL
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL

    ids = {"stdin": -10, "stdout": -11, "stderr": -12}
    invalid = ctypes.c_void_p(-1).value

    def valid(handle):
        return bool(handle) and handle != invalid and kernel32.GetFileType(handle) != 0

    inherited = {name: kernel32.GetStdHandle(identifier & 0xFFFFFFFF)
                 for name, identifier in ids.items()}
    # Preserve inherited pipes if attaching to a terminal changes the Win32 slots.
    if any(not _available(getattr(sys, name)) and not valid(inherited[name]) for name in required):
        kernel32.AttachConsole(0xFFFFFFFF)  # ATTACH_PARENT_PROCESS; never AllocConsole.

    process = kernel32.GetCurrentProcess()
    for target_fd, name in enumerate(ids):
        if _available(getattr(sys, name)):
            continue
        handle = inherited[name]
        if not valid(handle):
            handle = kernel32.GetStdHandle(ids[name] & 0xFFFFFFFF)
        if not valid(handle):
            continue
        duplicate = wintypes.HANDLE()
        if not kernel32.DuplicateHandle(process, handle, process, ctypes.byref(duplicate),
                                        0, False, 2):  # DUPLICATE_SAME_ACCESS
            continue
        flags = os.O_BINARY | (os.O_RDONLY if name == "stdin" else os.O_WRONLY)
        try:
            descriptor = msvcrt.open_osfhandle(duplicate.value, flags)
        except OSError:
            kernel32.CloseHandle(duplicate)
            continue
        try:
            if descriptor != target_fd:
                os.dup2(descriptor, target_fd, inheritable=False)
            binary = io.FileIO(target_fd, "rb" if name == "stdin" else "wb", closefd=False)
            stream = io.TextIOWrapper(binary, encoding="utf-8", errors="strict",
                                      line_buffering=name != "stdin", write_through=name != "stdin")
        except OSError:
            continue
        finally:
            if descriptor != target_fd:
                os.close(descriptor)
        setattr(sys, name, stream)
        if not _available(getattr(sys, f"__{name}__", None)):
            setattr(sys, f"__{name}__", stream)


def prepare_stdio(*, require_stdin=False):
    """Make UTF-8 output/error streams available, and stdin for an MCP server.

    Existing Python streams (including test/capture streams) are preserved.
    Invalid or missing handles produce a command failure; they never open the GUI.
    """
    required = ("stdin", "stdout", "stderr") if require_stdin else ("stdout", "stderr")
    if os.name == "nt" and any(not _available(getattr(sys, name)) for name in required):
        _restore_windows_streams(required)
    missing = [name for name in required if not _available(getattr(sys, name))]
    if missing:
        raise StdioUnavailableError("Standard streams unavailable: " + ", ".join(missing))
    if require_stdin and hasattr(sys.stdin, "reconfigure"):
        sys.stdin.reconfigure(encoding="utf-8", errors="strict")
    for name in ("stdout", "stderr"):
        stream = getattr(sys, name)
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="strict", line_buffering=True, write_through=True)
