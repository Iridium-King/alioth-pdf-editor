const picker = document.getElementById('tts-voice-picker');
const trigger = document.getElementById('tts-voice-trigger');
const list = document.getElementById('tts-voice-options');
const select = document.getElementById('tts-voice-sel');
const app = window.app;

const paths = {
    device: 'M4 5h16v12H4z M2 20h20',
    cloud: 'M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9Z',
    person: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2',
    female: 'M17 8a5 5 0 1 1-10 0 5 5 0 0 1 10 0ZM12 13v8m-3-3h6',
    male: 'M14 14a5 5 0 1 1-10 0 5 5 0 0 1 10 0Zm-1-4 7-7m-6 0h6v6'
};
const ns = 'http://www.w3.org/2000/svg';

function icon(kind) {
    const svg = document.createElementNS(ns, 'svg');
    svg.classList.add('tts-voice-icon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.7');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', paths[kind]);
    svg.append(path);
    return svg;
}

function label(voice) {
    const locale = document.createElement('span');
    locale.className = 'tts-voice-locale';
    locale.textContent = voice.locale || '';
    const name = document.createElement('span');
    name.className = 'tts-voice-name';
    name.textContent = voice.name;
    return [icon(voice.kind), ...(voice.gender ? [icon(voice.gender)] : []), locale, name];
}

app.closeTTSVoiceList = (restoreFocus = false) => {
    list.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus();
};

app.ttsSetVoiceOptions = (voices, selectedValue) => {
    const wasOpen = !list.hidden;
    app.closeTTSVoiceList(wasOpen);
    select.replaceChildren(...voices.map(voice => new Option(voice.name, voice.value)));
    if (voices.some(voice => voice.value === selectedValue)) select.value = selectedValue;
    function sync() {
        const selected = voices[select.selectedIndex];
        trigger.disabled = !selected;
        trigger.title = selected?.name || '';
        trigger.setAttribute('aria-label', selected ? 'Voz de lectura: ' + selected.name : 'Voz de lectura');
        trigger.replaceChildren(...(selected ? label(selected) : ['Sin voces']));
        [...list.children].forEach((option, index) => option.setAttribute('aria-selected', String(index === select.selectedIndex)));
    }
    list.replaceChildren(...voices.map((voice, index) => {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'tts-voice-option';
        option.setAttribute('role', 'option');
        option.tabIndex = -1;
        option.append(...label(voice));
        option.addEventListener('click', () => {
            select.selectedIndex = index;
            sync();
            app.closeTTSVoiceList(true);
        });
        return option;
    }));
    sync();
};

function openList() {
    if (trigger.disabled) return;
    list.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    list.children[Math.max(0, select.selectedIndex)]?.focus();
}

trigger.addEventListener('click', () => list.hidden ? openList() : app.closeTTSVoiceList(true));
picker.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !list.hidden) {
        event.preventDefault();
        event.stopPropagation();
        app.closeTTSVoiceList(true);
    } else if (event.key === 'Tab' && !list.hidden) {
        app.closeTTSVoiceList(true);
    } else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        if (list.hidden) { openList(); return; }
        const options = [...list.children];
        const current = options.indexOf(document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
            : Math.max(0, Math.min(options.length - 1, current + (event.key === 'ArrowUp' ? -1 : 1)));
        options[next]?.focus();
    }
});
document.addEventListener('pointerdown', event => {
    if (!picker.contains(event.target)) app.closeTTSVoiceList();
});
app.ttsSetVoiceOptions([]);
