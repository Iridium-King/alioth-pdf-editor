(() => {
    const viewer = window.pdfjsLib;

    // Mozilla GHSA-wgrm-67xf-hhpq. Force the safe path for every PDF entry point.
    window.pdfjsLib = {
        ...viewer,
        getDocument(source) {
            let options = source;
            if (typeof source === 'string' || source instanceof URL) {
                options = { url: source };
            } else if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
                options = { data: source };
            }
            return viewer.getDocument({ ...options, isEvalSupported: false });
        }
    };
})();
