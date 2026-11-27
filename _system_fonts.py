"""Resolve the editor's fixed font URLs from installed Windows fonts.

Never redistribute Windows font files or expose arbitrary filesystem paths.
The same bytes feed CSS, font metrics and PDF export. Free fallbacks are used
only when the requested font is unavailable on the destination computer.
"""
import os
from pathlib import Path
import sys

FONT_FILES = frozenset('''arial.ttf arialbd.ttf arialbi.ttf ariali.ttf
arialn.ttf arialnb.ttf arialnbi.ttf arialni.ttf
calibri.ttf calibrib.ttf calibrii.ttf calibril.ttf calibrili.ttf calibriz.ttf
consola.ttf consolab.ttf consolai.ttf consolaz.ttf cour.ttf courbd.ttf courbi.ttf couri.ttf
georgia.ttf georgiab.ttf georgiai.ttf georgiaz.ttf impact.ttf
segoeui.ttf segoeuib.ttf segoeuii.ttf segoeuil.ttf segoeuisl.ttf segoeuiz.ttf
tahoma.ttf tahomabd.ttf times.ttf timesbd.ttf timesbi.ttf timesi.ttf
trebuc.ttf trebucbd.ttf trebucbi.ttf trebucit.ttf verdana.ttf verdanab.ttf verdanai.ttf verdanaz.ttf'''.split())


def _fallback(name):
    families = {
        'arial': ('Sans', {'bd': 'Bold', 'bi': 'BoldItalic', 'i': 'Italic'}),
        'arialn': ('SansNarrow', {'b': 'Bold', 'bi': 'BoldItalic', 'i': 'Italic'}),
        'times': ('Serif', {'bd': 'Bold', 'bi': 'BoldItalic', 'i': 'Italic'}),
        'cour': ('Mono', {'bd': 'Bold', 'bi': 'BoldItalic', 'i': 'Italic'}),
        'consol': ('Mono', {'ab': 'Bold', 'az': 'BoldItalic', 'ai': 'Italic'}),
        'georgia': ('Serif', {'b': 'Bold', 'z': 'BoldItalic', 'i': 'Italic'}),
        'calibri': ('Sans', {'b': 'Bold', 'z': 'BoldItalic', 'i': 'Italic', 'li': 'Italic'}),
        'segoeui': ('Sans', {'b': 'Bold', 'z': 'BoldItalic', 'i': 'Italic'}),
        'tahoma': ('Sans', {'bd': 'Bold'}),
        'trebuc': ('Sans', {'bd': 'Bold', 'bi': 'BoldItalic', 'it': 'Italic'}),
        'verdana': ('Sans', {'b': 'Bold', 'z': 'BoldItalic', 'i': 'Italic'}),
        'impact': ('Sans', {}),
    }
    stem = name[:-4]
    for prefix in sorted(families, key=len, reverse=True):
        if stem.startswith(prefix):
            family, styles = families[prefix]
            return f'Liberation{family}-{styles.get(stem[len(prefix):], "Regular")}.ttf'
    raise ValueError('Unknown font')


_MACOS_FONT_NAMES = {
    'arial.ttf': 'Arial.ttf', 'arialbd.ttf': 'Arial Bold.ttf', 'arialbi.ttf': 'Arial Bold Italic.ttf', 'ariali.ttf': 'Arial Italic.ttf',
    'arialn.ttf': 'Arial Narrow.ttf', 'arialnb.ttf': 'Arial Narrow Bold.ttf', 'arialnbi.ttf': 'Arial Narrow Bold Italic.ttf', 'arialni.ttf': 'Arial Narrow Italic.ttf',
    'cour.ttf': 'Courier New.ttf', 'courbd.ttf': 'Courier New Bold.ttf', 'courbi.ttf': 'Courier New Bold Italic.ttf', 'couri.ttf': 'Courier New Italic.ttf',
    'georgia.ttf': 'Georgia.ttf', 'georgiab.ttf': 'Georgia Bold.ttf', 'georgiai.ttf': 'Georgia Italic.ttf', 'georgiaz.ttf': 'Georgia Bold Italic.ttf',
    'impact.ttf': 'Impact.ttf', 'tahoma.ttf': 'Tahoma.ttf', 'tahomabd.ttf': 'Tahoma Bold.ttf',
    'times.ttf': 'Times New Roman.ttf', 'timesbd.ttf': 'Times New Roman Bold.ttf', 'timesbi.ttf': 'Times New Roman Bold Italic.ttf', 'timesi.ttf': 'Times New Roman Italic.ttf',
    'trebuc.ttf': 'Trebuchet MS.ttf', 'trebucbd.ttf': 'Trebuchet MS Bold.ttf', 'trebucbi.ttf': 'Trebuchet MS Bold Italic.ttf', 'trebucit.ttf': 'Trebuchet MS Italic.ttf',
    'verdana.ttf': 'Verdana.ttf', 'verdanab.ttf': 'Verdana Bold.ttf', 'verdanai.ttf': 'Verdana Italic.ttf', 'verdanaz.ttf': 'Verdana Bold Italic.ttf',
}


def resolve_font(name, bundle, roots=None):
    name = name.lower()
    if name not in FONT_FILES:
        return None
    if roots is None:
        if sys.platform == 'darwin':
            roots = [
                Path('/System/Library/Fonts/Supplemental'),
                Path('/Library/Fonts'),
                Path.home() / 'Library/Fonts',
            ]
        else:
            roots = [Path(os.environ.get('WINDIR', r'C:\Windows')) / 'Fonts']
            local = os.environ.get('LOCALAPPDATA')
            if local:
                roots.append(Path(local) / 'Microsoft/Windows/Fonts')
    candidates = [name]
    if sys.platform == 'darwin' and name in _MACOS_FONT_NAMES:
        candidates.insert(0, _MACOS_FONT_NAMES[name])
    for root in roots:
        for candidate in candidates:
            path = Path(root) / candidate
            if path.is_file():
                return path
    fallback = Path(bundle) / 'fonts/fallback' / _fallback(name)
    return fallback if fallback.is_file() else None
