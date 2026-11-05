import json
import os
from pathlib import Path
import re
import tempfile
import threading


_KEYS = {
    'app_language', 'ribbonCollapsed', 'h-layout', 'ai_btn_pos', 'ai_panel_width',
    'customHeaderColor', 'customRibbonColor', 'customAccentColor', 'customBgApp',
    'dex_profiles', 'dex_default_profile', 'dex_use_multi', 'alioth-form-field-highlight-color',
    'alioth_custom_shortcuts',
}
_ALIOTH = re.compile(r'alioth_(?:theme(?:_favorites|_order)?|last_preset|custom_themes|preset_overrides|'
                     r'(?:group_borders|invert_colors|sidebar_as_header|glass_effect|white_icons)(?:_dark|_light)?|'
                     r'border_ribbon_value|reading_mode|ui_state|custom_shortcut(?:[23]|_form[12])?|shortcut_tab_[a-z0-9_-]+|'
                     r'autosave_(?:enabled|interval)|default_(?:zoom|page-mode|ai_provider|open_mode)|'
                     r'(?:capture_)?search_provider|comment_author|ai_font_size|tts_voice_[a-z0-9_]+)')


def preference_key(key):
    return isinstance(key, str) and (key in _KEYS or bool(_ALIOTH.fullmatch(key)) or
                                    bool(re.fullmatch(r'dex_xl_[a-zA-Z0-9_-]{1,100}|alioth_bookmarks_[A-Za-z0-9+/=]{1,40}', key)))


class UserPreferences:
    def __init__(self, path):
        self.path = Path(path)
        self.lock = threading.Lock()

    def read(self):
        try:
            data = json.loads(self.path.read_text(encoding='utf-8'))
            return {key: value for key, value in data.items()
                    if preference_key(key) and (value is None or isinstance(value, str))}
        except (OSError, ValueError, AttributeError):
            return {}

    def update(self, changes):
        if (not isinstance(changes, dict) or len(changes) > 500 or
                any(not preference_key(key) or value is not None and not isinstance(value, str)
                    for key, value in changes.items())):
            raise ValueError('INVALID_PREFERENCES')
        with self.lock:
            data = self.read()
            for key, value in changes.items():
                data[key] = value
            encoded = json.dumps(data, ensure_ascii=False).encode('utf-8')
            if len(encoded) > 16 * 1024 * 1024:
                raise ValueError('PREFERENCES_LIMIT')
            self.path.parent.mkdir(parents=True, exist_ok=True)
            descriptor, temporary = tempfile.mkstemp(prefix='.preferences-', dir=self.path.parent)
            try:
                with os.fdopen(descriptor, 'wb') as target:
                    target.write(encoded)
                os.replace(temporary, self.path)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)
            return data
