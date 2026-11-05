(() => {
    const HIDE_KEY = 'alioth_api_keys_welcome_hidden_v1';
    let hasConfiguredKeys = false;

    function storageGet(key) {
        try { return localStorage.getItem(key); } catch (_) { return null; }
    }

    function currentCopy() {
        const locale = window.i18n?.getCurrentLanguage?.() || document.documentElement.lang || 'es';
        return window.aliothLegal?.getCopy(locale) || window.aliothLegal?.getCopy('es');
    }

    function finishLegalChoice(state) {
        window.aliothLegal?.setNoticeState(localStorage, state);
        document.getElementById('alioth-legal-welcome')?.remove();
        window.dispatchEvent(new CustomEvent('alioth:legal-ready', { detail: { state } }));
    }

    function renderLegalNotice(notice) {
        const copy = currentCopy();
        if (!copy) return;
        const locale = window.i18n?.getCurrentLanguage?.() || document.documentElement.lang || 'es';
        const actions = window.aliothLegal?.getActions(locale) || window.aliothLegal?.getActions('es');
        notice.querySelector('[data-title]').textContent = copy.terms.title;
        notice.querySelector('[data-terms]').textContent = copy.terms.body;
        notice.querySelector('[data-privacy]').textContent = copy.privacy.body;
        notice.querySelector('[data-ai]').textContent = copy.ai.body;
        notice.querySelector('[data-local]').textContent = actions.local;
        notice.querySelector('[data-ai-action]').textContent = actions.ai;
        notice.querySelector('[data-details]').textContent = actions.details;
    }

    function showLegalNotice() {
        if (!window.aliothLegal || window.aliothLegal.getNoticeState(localStorage) || document.getElementById('alioth-legal-welcome')) return;
        const notice = document.createElement('div');
        notice.id = 'alioth-legal-welcome';
        notice.setAttribute('role', 'dialog');
        notice.setAttribute('aria-modal', 'true');
        notice.setAttribute('aria-labelledby', 'alioth-legal-welcome-title');
        notice.style.cssText = 'position:fixed;inset:0;z-index:31000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(7,10,20,.72);backdrop-filter:blur(6px);';
        notice.innerHTML = `
            <section style="position:relative;width:min(620px,100%);max-height:88vh;overflow:auto;padding:28px;border:1px solid rgba(129,140,248,.38);border-radius:18px;background:rgba(25,31,51,.97);box-shadow:0 24px 70px rgba(0,0,0,.55);color:#e8edf9;font-family:inherit;">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;color:#a5b4fc;"><span style="display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:rgba(99,102,241,.18);font-size:18px;">ⓘ</span><strong id="alioth-legal-welcome-title" data-title style="font-size:17px;"></strong></div>
                <p data-terms style="margin:0 0 12px;color:#cbd5e1;line-height:1.55;font-size:13px;"></p>
                <p data-privacy style="margin:0 0 12px;color:#aebbd2;line-height:1.55;font-size:12px;"></p>
                <p data-ai style="margin:0 0 20px;color:#aebbd2;line-height:1.55;font-size:12px;"></p>
                <div style="display:flex;gap:9px;flex-wrap:wrap;align-items:center;">
                    <button type="button" data-local style="flex:1;min-width:190px;padding:10px 14px;border:1px solid rgba(255,255,255,.18);border-radius:9px;background:rgba(255,255,255,.06);color:#dbe4f5;font-weight:600;cursor:pointer;"></button>
                    <button type="button" data-ai-action style="flex:1;min-width:190px;padding:10px 14px;border:0;border-radius:9px;background:#6366f1;color:#fff;font-weight:600;cursor:pointer;"></button>
                    <button type="button" data-details style="width:100%;padding:8px;border:0;background:transparent;color:#a5b4fc;text-decoration:underline;cursor:pointer;font-size:11px;"></button>
                </div>
                <div style="margin-top:12px;color:#7f8baa;font-size:10px;line-height:1.45;">ALIOTH TDAH LABS - OPEN SOURCE PROJECT · aliothgm@gmail.com</div>
            </section>`;
        renderLegalNotice(notice);
        notice.querySelector('[data-local]').onclick = () => finishLegalChoice('local');
        notice.querySelector('[data-ai-action]').onclick = () => finishLegalChoice('ai');
        notice.querySelector('[data-details]').onclick = () => { finishLegalChoice('local'); window.app?.showAbout(); };
        window.addEventListener('app:languagechange', () => {
            if (document.getElementById('alioth-legal-welcome') === notice) renderLegalNotice(notice);
        });
        document.body.append(notice);
        notice.querySelector('[data-local]').focus();
    }

    function closeNotice(neverShow) {
        if (neverShow) {
            try { localStorage.setItem(HIDE_KEY, '1'); } catch (_) {}
        }
        document.getElementById('alioth-api-keys-welcome')?.remove();
    }

    function showNotice() {
        if (storageGet(HIDE_KEY) || !window.aliothLegal?.getNoticeState(localStorage) || document.getElementById('alioth-api-keys-welcome')) return;
        const notice = document.createElement('div');
        notice.id = 'alioth-api-keys-welcome';
        notice.setAttribute('role', 'dialog');
        notice.setAttribute('aria-modal', 'true');
        notice.setAttribute('aria-labelledby', 'alioth-api-keys-welcome-title');
        notice.style.cssText = 'position:fixed;inset:0;z-index:30000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(7,10,20,.64);backdrop-filter:blur(5px);';
        notice.innerHTML = `
            <section style="position:relative;width:min(460px,100%);padding:28px;border:1px solid rgba(255,255,255,.18);border-radius:18px;background:rgba(25,31,51,.92);box-shadow:0 24px 70px rgba(0,0,0,.5);color:#e8edf9;font-family:inherit;">
                <button type="button" aria-label="Cerrar" data-close style="position:absolute;top:12px;right:12px;width:30px;height:30px;border:1px solid rgba(255,255,255,.2);border-radius:50%;background:transparent;color:#d8e0f2;font-size:18px;cursor:pointer;line-height:1;">×</button>
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;color:#a5b4fc;"><span style="display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:rgba(99,102,241,.18);font-size:18px;">🔑</span><strong id="alioth-api-keys-welcome-title" style="font-size:17px;">Configura tus API Keys</strong></div>
                <p style="margin:0 0 10px;color:#cbd5e1;line-height:1.55;font-size:13px;">Esta versión no incluye claves. Para usar las funciones de IA, agrega tus propias API Keys en Preferencias → API Keys.</p>
                <p style="margin:0 0 20px;color:#94a3b8;line-height:1.5;font-size:12px;">Ahí encontrarás las instrucciones y enlaces para obtener una clave de cada proveedor.</p>
                <div style="display:flex;gap:9px;flex-wrap:wrap;"><button type="button" data-open style="flex:1;min-width:190px;padding:10px 14px;border:0;border-radius:9px;background:#6366f1;color:#fff;font-weight:600;cursor:pointer;">Abrir configuración de API Keys</button><button type="button" data-never style="padding:10px 14px;border:1px solid rgba(255,255,255,.15);border-radius:9px;background:rgba(255,255,255,.05);color:#cbd5e1;cursor:pointer;">No mostrar nunca más</button></div>
            </section>`;
        notice.querySelector('[data-close]').onclick = () => closeNotice(false);
        notice.querySelector('[data-never]').onclick = () => closeNotice(true);
        notice.querySelector('[data-open]').onclick = () => { closeNotice(false); window.app?.showPreferencesModal('pref-apikeys'); };
        document.body.append(notice);
    }

    async function checkStatus() {
        try {
            const response = await fetch('/api/secure-credentials/status');
            const counts = response.ok ? (await response.json()).counts || {} : {};
            hasConfiguredKeys = Object.values(counts).some(Boolean);
            if (!window.aliothLegal?.getNoticeState(localStorage)) showLegalNotice();
            else if (!hasConfiguredKeys) showNotice();
        } catch (_) {
            if (!window.aliothLegal?.getNoticeState(localStorage)) showLegalNotice();
        }
    }

    window.addEventListener('alioth:legal-ready', () => { if (!hasConfiguredKeys) showNotice(); });
    document.addEventListener('DOMContentLoaded', () => setTimeout(checkStatus, 300));
})();
