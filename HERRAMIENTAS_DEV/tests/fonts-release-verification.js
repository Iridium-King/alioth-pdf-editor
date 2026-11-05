// Native WebView2 verification, served only by the isolated QA server.
(async () => {
    const check = (value, label) => { if (!value) throw Error(label); };
    const fontResults = [];
    const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).join(',');
    for (const name of ['ARIALN.TTF', 'ARIALNB.TTF', 'ARIALNI.TTF', 'ARIALNBI.TTF']) {
        const installed = await (await fetch('/fonts/standard_fonts/' + name)).arrayBuffer();
        const baseline = await (await fetch('/__qa/original-font/' + name)).arrayBuffer();
        check(await hash(installed) === await hash(baseline), 'Ribbon font bytes changed: ' + name);
    }
    for (const [key, info] of Object.entries(app.fontRegistry.fonts)) {
        if (!info.path?.includes('standard_fonts') || info.pdfStandard) continue;
        const bytes = await app.fontRegistry.loadFontBytes(key);
        check(bytes?.byteLength > 1000, 'Font unavailable: ' + key);
        const font = fontkit.create(new Uint8Array(bytes));
        check(font.layout('Guardar como áéíóú ñ 123').glyphs.length > 10, 'Cannot shape: ' + key);
        fontResults.push(key);
    }
    for (const weight of [400, 700]) {
        await document.fonts.load(weight + ' 12px "Alioth Ribbon UI"');
        check(document.fonts.check(weight + ' 12px "Alioth Ribbon UI"'), 'Ribbon font not loaded');
    }
    const pdf = await PDFLib.PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const page = pdf.addPage([600, 800]);
    const fallbackResults = [];
    let y = 760;
    for (const [key, filename] of [['Arial', 'arial.ttf'], ['Arial-Bold', 'arialbd.ttf'],
        ['Arial-Italic', 'ariali.ttf'], ['Arial-BoldItalic', 'arialbi.ttf'], ['Times New Roman', 'times.ttf'], ['Courier New', 'cour.ttf']]) {
        const installed = await pdf.embedFont(await app.fontRegistry.loadFontBytes(key), {subset: true});
        const response = await fetch('/__qa/free-font/' + filename);
        check(response.ok, 'Fallback unavailable: ' + key);
        const free = await pdf.embedFont(await response.arrayBuffer(), {subset: true});
        const text = key + ': áéíóú ñ € 123';
        page.drawText(text, {x: 30, y, font: installed, size: 12}); y -= 22;
        page.drawText(text, {x: 30, y, font: free, size: 12}); y -= 28;
        fallbackResults.push(key);
    }
    const bytes = await pdf.save();
    window.__qaFontPdf = btoa(String.fromCharCode(...bytes));
    app.showAbout();
    document.querySelectorAll('#about-main-tabs button')[2].click();
    const windowsTab = Array.from(document.querySelectorAll('#about-legal-tabs button')).find(button => button.textContent === 'Windows y firma local');
    check(windowsTab, 'About Windows tab missing'); windowsTab.click();
    check(document.getElementById('about-legal-body').textContent.includes('certmgr.msc'), 'Removal notice missing');
    return {ok: true, ribbonBytesUnchanged: true, fontsShaped: fontResults, exportedStyles: fallbackResults,
        aboutNotice: true, uiFont: getComputedStyle(document.querySelector('.toolbar-area')).fontFamily};
})()
