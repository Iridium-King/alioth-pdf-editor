"""Resolve the editor's fixed font URLs from installed Windows fonts.

Never redistribute Windows font files or expose arbitrary filesystem paths.
The same bytes feed CSS, font metrics and PDF export. Free fallbacks are used
only when the requested font is unavailable on the destination computer.
"""
import os
from pathlib import Path

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


def resolve_font(name, bundle, roots=None):
    name = name.lower()
    if name not in FONT_FILES:
        return None
    if roots is None:
        roots = [Path(os.environ.get('WINDIR', r'C:\Windows')) / 'Fonts']
        local = os.environ.get('LOCALAPPDATA')
        if local:
            roots.append(Path(local) / 'Microsoft/Windows/Fonts')
    for root in roots:
        path = Path(root) / name
        if path.is_file():
            return path
    fallback = Path(bundle) / 'fonts/fallback' / _fallback(name)
    return fallback if fallback.is_file() else None
