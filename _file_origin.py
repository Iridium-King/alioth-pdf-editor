import hashlib
import os
from pathlib import Path


def explorer_paths(name):
    if os.name != 'nt':
        return []
    import pythoncom
    import win32com.client
    pythoncom.CoInitialize()
    try:
        shell = win32com.client.Dispatch('Shell.Application')
        selected, folders = [], []
        for window in shell.Windows():
            try:
                view = window.Document
                selected.extend(str(item.Path) for item in view.SelectedItems())
                folders.append(str(Path(view.Folder.Self.Path) / name))
            except Exception:
                continue
        shortcuts = win32com.client.Dispatch('WScript.Shell')
        for folder in ['Desktop', 'MyDocuments']:
            try:
                folders.append(str(Path(shortcuts.SpecialFolders(folder)) / name))
            except Exception:
                pass
        try:
            recent = Path(shortcuts.SpecialFolders('Recent'))
            for filename in [name + '.lnk', Path(name).stem + '.lnk']:
                link = recent / filename
                if link.is_file():
                    folders.append(str(shortcuts.CreateShortcut(str(link)).TargetPath))
        except Exception:
            pass
        return selected + folders
    finally:
        pythoncom.CoUninitialize()


def resolve_file_origin(name, size, sha256, candidates):
    if (not isinstance(name, str) or Path(name).name != name or '\\' in name or
            type(size) is not int or size < 0 or not isinstance(sha256, str) or len(sha256) != 64):
        raise ValueError('INVALID_FILE_ORIGIN')
    seen = set()
    for candidate in candidates:
        try:
            path = Path(candidate)
            normalized = os.path.normcase(str(path))
            if normalized in seen:
                continue
            seen.add(normalized)
            if not path.is_absolute() or path.name.casefold() != name.casefold() or path.stat().st_size != size:
                continue
            digest = hashlib.sha256()
            with path.open('rb') as source:
                for block in iter(lambda: source.read(1024 * 1024), b''):
                    digest.update(block)
            if digest.hexdigest() == sha256.lower():
                return str(path.resolve())
        except (OSError, ValueError, TypeError):
            continue
    return None
