(function () {
    const seed = window.__aliothPreferences || {};
    delete window.__aliothPreferences;
    const keyAllowed = key => /^(?:app_language|ribbonCollapsed|h-layout|ai_btn_pos|ai_panel_width|custom(?:HeaderColor|RibbonColor|AccentColor|BgApp)|dex_(?:profiles|default_profile|use_multi|xl_[a-zA-Z0-9_-]{1,100})|alioth-form-field-highlight-color|alioth_custom_shortcuts|alioth_bookmarks_[A-Za-z0-9+/=]{1,40})$/.test(key) ||
        /^alioth_(?:theme(?:_favorites|_order)?|last_preset|custom_themes|preset_overrides|(?:group_borders|invert_colors|sidebar_as_header|glass_effect|white_icons)(?:_dark|_light)?|border_ribbon_value|reading_mode|ui_state|custom_shortcut(?:[23]|_form[12])?|shortcut_tab_[a-z0-9_-]+|autosave_(?:enabled|interval)|default_(?:zoom|page-mode|ai_provider|open_mode)|(?:capture_)?search_provider|comment_author|ai_font_size|tts_voice_[a-z0-9_]+)$/.test(key);
    const pending = new Map();
    const storage = window.localStorage;
    const originalSet = Storage.prototype.setItem;
    const originalRemove = Storage.prototype.removeItem;
    const originalClear = Storage.prototype.clear;
    let timer, sending = false;
    let completion = Promise.resolve();

    for (const [key, value] of Object.entries(seed)) {
        if (!keyAllowed(key)) continue;
        if (value === null) originalRemove.call(storage, key);
        else if (typeof value === 'string') originalSet.call(storage, key, value);
    }
    for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (keyAllowed(key) && !(key in seed)) pending.set(key, storage.getItem(key));
    }

    async function flush() {
        clearTimeout(timer);
        if (sending) { await completion; return flush(); }
        if (!pending.size || !/^https?:$/.test(location.protocol)) return;
        sending = true;
        let complete;
        completion = new Promise(resolve => { complete = resolve; });
        const changes = Object.fromEntries(pending);
        pending.clear();
        try {
            const body = JSON.stringify(changes);
            const response = await fetch('/api/preferences', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body, keepalive: new Blob([body]).size < 60000
            });
            if (!response.ok) throw new Error('PREFERENCES_NOT_SAVED');
        } catch (_) {
            for (const [key, value] of Object.entries(changes)) {
                if (!pending.has(key)) pending.set(key, value);
            }
        } finally {
            sending = false;
            complete();
            if (pending.size) timer = setTimeout(flush, 1000);
        }
    }
    function changed(key, value) {
        if (!keyAllowed(key)) return;
        pending.set(key, value);
        clearTimeout(timer);
        timer = setTimeout(flush, 150);
    }
    Storage.prototype.setItem = function (key, value) {
        originalSet.call(this, key, value);
        if (this === storage) changed(String(key), String(value));
    };
    Storage.prototype.removeItem = function (key) {
        originalRemove.call(this, key);
        if (this === storage) changed(String(key), null);
    };
    Storage.prototype.clear = function () {
        const keys = this === storage ? Object.keys(storage).filter(keyAllowed) : [];
        originalClear.call(this);
        keys.forEach(key => changed(key, null));
    };
    window.addEventListener('pagehide', () => {
        if (pending.size) navigator.sendBeacon('/api/preferences',
            new Blob([JSON.stringify(Object.fromEntries(pending))], { type: 'application/json' }));
    });
    window.aliothPreferences = { flush };
    if (pending.size) timer = setTimeout(flush, 150);
})();
