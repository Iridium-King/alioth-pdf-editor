(function () {
    const parameters = new URLSearchParams(location.search);
    const status = document.getElementById('status');
    const marker = 'alioth_native_storage_ready';
    const recoveryKey = 'alioth_native_migration_recovery';
    const databases = ['AliothPDFEditor', 'AliothFirmasDB', 'AliothAI'];
    const progress = { mode: parameters.get('mode'), phase: 'start', records: 0, packets: 0 };
    const diagnose = async (event, error) => {
        const details = { scope: 'browser-migration', event, ...progress,
            errorName: error?.name, errorMessage: error?.message?.slice(0, 180) };
        if (error) console.error('[Browser migration]', details);
        try {
            await fetch('/api/diag-log', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(details), signal: AbortSignal.timeout(5000) });
        } catch (_) {}
    };
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const request = async (path, body) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 35000);
        try {
            return await fetch('/api/browser-migration/' + path, { signal: controller.signal,
                ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
        } finally { clearTimeout(timeout); }
    };
    const waitRequest = request => new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    const allowedKey = key => key !== recoveryKey && (/^(?:alioth[_-](?!transfer_|page_ack_|native_storage_ready)|dex_|custom(?:HeaderColor|RibbonColor|AccentColor|BgApp)$)/.test(key) ||
        /^(?:app_language|ribbonCollapsed|h-layout|ai_btn_pos|ai_panel_width|favRecents_migrated|favoriteDocs|recentDocs|GEMINI_API_KEY|GROQ_API_KEY|groq-api-key|(?:gemini|groq|mistral|azure|nvidia|openrouter|huggingface|fishaudio)_(?:api_key|endpoint))$/.test(key));

    function preserveEmptyRecord(database, store, value, record) {
        if (store.keyPath === null || record !== null && record !== undefined) return false;
        const saved = JSON.parse(localStorage.getItem(recoveryKey) || '[]');
        if (!Array.isArray(saved)) throw new Error('MIGRATION_RECOVERY_INVALID');
        const entry = { database, store: value.store, key: value.key, value: value.value };
        const signature = JSON.stringify(entry);
        if (!saved.some(item => JSON.stringify(item) === signature)) {
            saved.push(entry);
            localStorage.setItem(recoveryKey, JSON.stringify(saved));
        }
        return true;
    }

    function encode(buffer) {
        const bytes = new Uint8Array(buffer);
        let text = '';
        for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768));
        return btoa(text);
    }

    async function pack(value) {
        if (value === undefined) return { type: 'undefined' };
        if (value === null || typeof value !== 'object') return { type: 'primitive', value };
        if (value instanceof ArrayBuffer) return { type: 'buffer', value: encode(value) };
        if (ArrayBuffer.isView(value)) return { type: 'typed', name: value.constructor.name, value: encode(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)) };
        if (value instanceof Blob) return { type: value instanceof File ? 'file' : 'blob', value: encode(await value.arrayBuffer()), mime: value.type, name: value.name, modified: value.lastModified };
        if (value instanceof Date) return { type: 'date', value: value.toISOString() };
        if (Array.isArray(value)) return { type: 'array', value: await Promise.all(value.map(pack)) };
        return { type: 'object', value: await Promise.all(Object.entries(value).map(async ([key, child]) => [key, await pack(child)])) };
    }

    function unpack(value) {
        if (value.type === 'undefined') return undefined;
        if (value.type === 'primitive') return value.value;
        if (value.type === 'date') return new Date(value.value);
        if (value.type === 'array') return value.value.map(unpack);
        if (value.type === 'object') return Object.fromEntries(value.value.map(([key, child]) => [key, unpack(child)]));
        const binary = atob(value.value), bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        if (value.type === 'file') return new File([bytes], value.name, { type: value.mime, lastModified: value.modified });
        if (value.type === 'blob') return new Blob([bytes], { type: value.mime });
        const constructors = { Uint8Array, Uint8ClampedArray, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array, DataView };
        if (value.type === 'typed' && constructors[value.name]) return new constructors[value.name](bytes.buffer);
        return bytes.buffer;
    }

    async function openExisting(dbName) {
        if (indexedDB.databases && !(await indexedDB.databases()).some(db => db.name === dbName)) return null;
        return new Promise((resolve, reject) => {
            const call = indexedDB.open(dbName);
            let absent = false;
            call.onupgradeneeded = () => { absent = true; call.transaction.abort(); };
            call.onerror = () => absent ? resolve(null) : reject(call.error);
            call.onsuccess = () => resolve(call.result);
        });
    }

    async function exportStorage() {
        const token = parameters.get('token');
        if (!/^[a-f0-9]{32}$/.test(token || '')) throw new Error('INVALID_MIGRATION_TOKEN');
        document.title = 'ALIOTH PDF EDITOR [' + token + ']';
        await request('ready?token=' + token, {});
        let sequence = 0;
        const postPacket = async packet => {
            for (let attempt = 0; attempt < 60; attempt++) {
                let response;
                try { response = await request('packet?token=' + token, { ...packet, sequence }); }
                catch (_) { await pause(250); continue; }
                if (response.ok) { sequence++; progress.packets = sequence; return; }
                if (![429, 503].includes(response.status)) {
                    const detail = await response.json().catch(() => ({}));
                    throw new Error(detail.error || 'MIGRATION_TRANSFER_FAILED');
                }
                await pause(250);
            }
            throw new Error('MIGRATION_TRANSFER_TIMEOUT');
        };
        const send = async value => {
            progress.phase = 'serialize';
            const json = JSON.stringify(value), size = 2 * 1024 * 1024;
            progress.phase = 'send';
            for (let start = 0; start < json.length; start += size)
                await postPacket({ data: json.slice(start, start + size), last: start + size >= json.length });
        };
        try {
            const storage = Object.fromEntries(Object.keys(localStorage).filter(allowedKey).map(key => [key, localStorage.getItem(key)]));
            for (const database of databases) {
                const db = await openExisting(database);
                try {
                    const stores = [];
                    if (db) for (const name of db.objectStoreNames) {
                        const store = db.transaction(name).objectStore(name);
                        stores.push({ name, keyPath: store.keyPath, autoIncrement: store.autoIncrement,
                            indexes: [...store.indexNames].map(name => { const index = store.index(name); return { name, keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry }; }) });
                    }
                    await send({ type: 'meta', database, storage, schema: db ? { version: db.version, stores } : null });
                    if (db) for (const { name } of stores) {
                        const keys = await waitRequest(db.transaction(name).objectStore(name).getAllKeys());
                        for (const key of keys) {
                            progress.phase = 'read';
                            const value = await waitRequest(db.transaction(name).objectStore(name).get(key));
                            progress.phase = 'encode';
                            await send({ type: 'record', database, store: name, key: await pack(key), value: await pack(value) });
                            progress.records++;
                        }
                    }
                } finally { db?.close(); }
            }
            await postPacket({ done: true });
            status.textContent = 'Datos conservados. Puedes continuar en la nueva ventana.';
        } catch (error) {
            await diagnose('failed', error);
            await postPacket({ error: true }).catch(() => {});
            throw error;
        }
    }

    async function createTarget(dbName, schema) {
        if (!schema) return null;
        return new Promise((resolve, reject) => {
            const call = indexedDB.open(dbName, schema.version);
            let blocked = false;
            call.onblocked = () => {
                blocked = true;
                reject(new Error('MIGRATION_DATABASE_BUSY'));
            };
            call.onupgradeneeded = () => {
                if (blocked) { call.transaction.abort(); return; }
                for (const definition of schema.stores) {
                    if (call.result.objectStoreNames.contains(definition.name)) continue;
                    const store = call.result.createObjectStore(definition.name, { keyPath: definition.keyPath, autoIncrement: definition.autoIncrement });
                    for (const index of definition.indexes) store.createIndex(index.name, index.keyPath, { unique: index.unique, multiEntry: index.multiEntry });
                }
            };
            call.onsuccess = () => { if (blocked) call.result.close(); else resolve(call.result); };
            call.onerror = () => reject(call.error);
        });
    }

    async function importStorage() {
        const target = parameters.get('target') || '/BASE.html';
        if (!/^\/BASE\.html(?:\?|$)/.test(target)) throw new Error('INVALID_TARGET');
        if (localStorage.getItem(marker) === '1') { location.replace(target); return; }
        const start = await request('start', {});
        if (!start.ok) throw new Error('MIGRATION_START_FAILED');
        const { token } = await start.json();
        let sequence = 0, partial = '', storage = {}, records = 0;
        const connections = new Map();
        try {
            while (true) {
                progress.phase = 'receive';
                const response = await request('next?token=' + token + '&sequence=' + sequence);
                if (response.status === 202) continue;
                if (!response.ok) throw new Error('MIGRATION_RECEIVE_FAILED');
                const packet = await response.json();
                if (packet.error) throw new Error('MIGRATION_EXPORT_FAILED');
                if (packet.done) break;
                partial += packet.data;
                sequence++;
                progress.packets = sequence;
                if (!packet.last) continue;
                progress.phase = 'parse';
                const value = JSON.parse(partial);
                partial = '';
                const database = value.database || databases[0];
                if (!databases.includes(database)) throw new Error('INVALID_DATABASE');
                if (value.type === 'meta') { storage = value.storage; connections.set(database, await createTarget(database, value.schema)); }
                else if (value.type === 'record') {
                    progress.phase = 'decode';
                    const db = connections.get(database);
                    const tx = db.transaction(value.store, 'readwrite');
                    const store = tx.objectStore(value.store), record = unpack(value.value);
                    progress.phase = 'write';
                    if (preserveEmptyRecord(database, store, value, record)) {
                        store.delete(unpack(value.key));
                        progress.recovered = (progress.recovered || 0) + 1;
                    } else if (store.keyPath === null) store.put(record, unpack(value.key)); else store.put(record);
                    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error); });
                    status.textContent = 'Conservando tus datos locales… ' + (++records) + ' registros';
                    progress.records = records;
                }
            }
            for (const [key, value] of Object.entries(storage)) if (allowedKey(key) && typeof value === 'string') localStorage.setItem(key, value);
            const finished = await request('finish?token=' + token, { storage });
            if (!finished.ok) throw new Error('MIGRATION_FINALIZE_FAILED');
            localStorage.setItem(marker, '1');
            await diagnose('completed');
            location.replace(target);
        } catch (error) {
            await diagnose('failed', error);
            throw error;
        } finally {
            for (const db of connections.values()) db?.close();
            await request('finish?token=' + token, {}).catch(() => {});
        }
    }

    const work = parameters.get('mode') === 'export' ? exportStorage : importStorage;
    work().catch(error => {
        status.textContent = error.message === 'MIGRATION_DATABASE_BUSY'
            ? 'Otra ventana mantiene ocupada la base local. Ciérrala y pulsa Reintentar. Tus datos originales se conservan.'
            : 'No se pudo completar la transferencia. Tus datos originales se conservan en el navegador anterior.';
        document.getElementById('actions').style.display = 'flex';
    });
    document.getElementById('retry').onclick = () => location.reload();
    document.getElementById('legacy').onclick = () => request('legacy', {});
})();
