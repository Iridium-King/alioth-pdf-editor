// Coordinación por documento del guardado nativo.

if (!window.app) window.app = {};
const app = window.app;

const ensureSha256 = async function (bytes, candidate) {
    if (typeof candidate === 'string' && /^[0-9a-f]{64}$/i.test(candidate)) return candidate.toLowerCase();
    const cryptoApi = window.crypto || globalThis.crypto;
    if (!cryptoApi?.subtle) throw new Error('SHA256_UNAVAILABLE');
    const digest = await cryptoApi.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
};

const normalizeRedactionVerification = function (value) {
    const occurrences = value?.occurrences;
    if (!Array.isArray(occurrences) || !occurrences.length) return null;
    return { occurrences: occurrences.map(item => {
        const rect = item?.rect || {};
        const kind = item?.kind || 'vector', action = item?.action || 'censor';
        if (!item?.id || !['vector', 'image'].includes(kind) || !['erase', 'censor'].includes(action) || !Number.isSafeInteger(item.pageIndex) || ![rect.x0, rect.y0, rect.x1, rect.y1].every(Number.isFinite) || rect.x1 <= rect.x0 || rect.y1 <= rect.y0) throw new Error('INVALID_REDACTION_VERIFICATION');
        return { id: String(item.id), kind, action, pageIndex: item.pageIndex, rect: { x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y1 } };
    }) };
};

const saveRequest = async function (url, options = {}, renewed = false) {
    const response = await fetch(url, {
        ...options,
        headers: { 'X-Alioth-Client-Id': window.__aliothWindowId || '', ...(options.headers || {}) }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
        if (!renewed && url === '/api/files/save/begin' && payload.error === 'SAVE_TOKEN_UNAVAILABLE') {
            const { token } = JSON.parse(options.body);
            await saveRequest('/api/files/save/renew', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token })
            });
            return saveRequest(url, options, true);
        }
        console.error('[NativeSave] request rejected', {
            endpoint: url.split('?')[0], status: response.status, error: payload.error || 'NATIVE_SAVE_REQUEST_FAILED'
        });
        throw new Error(payload.error || 'NATIVE_SAVE_REQUEST_FAILED');
    }
    return payload;
};

app.nativeSaveTransport = app.nativeSaveTransport || {
    bindOpened: path => saveRequest('/api/files/save/opened', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path })
    }),
    begin: payload => saveRequest('/api/files/save/begin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            token: payload.token,
            operation_id: payload.operationId,
            length: payload.length,
            sha256: payload.sha256,
            expected_fingerprint: payload.expectedFingerprint ?? null,
            redaction_verification: payload.redactionVerification || null
        })
    }).then(result => ({ uploadId: result.upload_id, redactionVerification: result.redaction_verification === true })),
    chunk: (uploadId, index, offset, bytes) => saveRequest(
        '/api/files/save/chunk?upload_id=' + encodeURIComponent(uploadId) + '&index=' + index + '&offset=' + offset,
        { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes }
    ),
    commit: (uploadId, operationId) => saveRequest('/api/files/save/commit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ upload_id: uploadId, operation_id: operationId })
    }),
    status: operationId => saveRequest('/api/files/save/status', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation_id: operationId })
    }),
    abort: uploadId => saveRequest('/api/files/save/abort', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ upload_id: uploadId })
    })
};

Object.assign(app, {
    rememberNativeSaveTarget: function (docId, target) {
        const doc = this.getDocumentById(docId);
        if (!doc || !target?.token) return null;
        if (!(this._nativeSaveTargets instanceof Map)) this._nativeSaveTargets = new Map();
        const normalized = {
            token: target.token,
            identity: target.identity || null,
            fingerprint: target.fingerprint || null,
            expiresAt: target.expiresAt || null
        };
        this._nativeSaveTargets.set(docId, normalized);
        const state = this.ensureDocumentState(doc);
        state.binding = { identity: normalized.identity, fingerprint: normalized.fingerprint };
        return normalized;
    },

    bindOpenedFilePath: async function (docId, path) {
        if (!path || !this.nativeSaveTransport?.bindOpened) return null;
        const result = await this.nativeSaveTransport.bindOpened(path);
        return this.rememberNativeSaveTarget(docId, {
            token: result.token,
            identity: result.identity,
            fingerprint: result.fingerprint,
            expiresAt: result.expires_at
        });
    },

    saveDocument: function (docId, options = {}) {
        return this.withDocumentOperation(docId, 'saving', async (doc, lifecycleEpoch) => {
            const snapshot = await this.captureDocumentSnapshot(docId);
            const prepared = await this.prepareDocumentPdf(snapshot, options, options.signal);
            const transport = this.nativeSaveTransport;
            if (!transport || !options.token) throw new Error('SAVE_TARGET_REQUIRED');
            const redactionVerification = normalizeRedactionVerification(options.redactionVerification || this.ensureDocumentState(doc).redactionVerification);
            const bytes = prepared.bytes instanceof Uint8Array ? prepared.bytes : new Uint8Array(prepared.bytes);
            const sha256 = await ensureSha256(bytes, prepared.sha256);
            console.info('[NativeSave] prepared document', {
                docId, bytes: bytes.byteLength, sha256Ready: true
            });
            let uploadId;
            try {
                const begin = await transport.begin({
                    token: options.token,
                    operationId: options.operationId || ('save_' + snapshot.snapshotId),
                    length: bytes.byteLength,
                    sha256,
                    expectedFingerprint: options.expectedFingerprint || null,
                    redactionVerification
                });
                uploadId = begin.uploadId;
                if (redactionVerification && !begin.redactionVerification) throw new Error('REDACTION_VERIFICATION_UNAVAILABLE');
                const chunkSize = 4 * 1024 * 1024;
                for (let offset = 0, index = 0; offset < bytes.byteLength; offset += chunkSize, index += 1) {
                    await transport.chunk(begin.uploadId, index, offset, bytes.slice(offset, offset + chunkSize));
                }
                let committed;
                try {
                    committed = await transport.commit(begin.uploadId, options.operationId || ('save_' + snapshot.snapshotId));
                } catch (_) {
                    committed = await transport.status(options.operationId || ('save_' + snapshot.snapshotId));
                }
                if (committed.status !== 'committed') throw new Error(committed.error || 'SAVE_COMMIT_UNCERTAIN');
                if (redactionVerification && (!committed.redaction || committed.redaction.rejected?.length || committed.redaction.treated?.length !== redactionVerification.occurrences.length)) throw new Error('REDACTION_OUTPUT_UNVERIFIED');
                const current = this.getDocumentById(docId);
                if (current && this.ensureDocumentState(current).lifecycleEpoch === lifecycleEpoch) {
                    const state = this.ensureDocumentState(current);
                    state.savedRevision = snapshot.revision;
                    this.rememberNativeSaveTarget(docId, {
                        token: options.token,
                        fingerprint: committed.sha256 || sha256,
                        identity: committed.identity || options.targetIdentity || null
                    });
                    if (redactionVerification) state.redactionVerification = { ...redactionVerification, verifiedFingerprint: committed.sha256 || sha256 };
                }
                return { writtenRevision: snapshot.revision, ...committed };
            } catch (error) {
                if (uploadId && transport.abort) await transport.abort(uploadId).catch(() => {});
                throw error;
            }
        });
    },

    saveCopyDocument: function (docId, options = {}) {
        return this.withDocumentOperation(docId, 'copying', async (doc) => {
            let originalState = this.ensureDocumentState(doc);
            if (!originalState.baselineSnapshot && typeof this.setDocumentBaseline === 'function') {
                await this.setDocumentBaseline(docId);
                originalState = this.ensureDocumentState(doc);
            }
            if (!originalState.baselineSnapshot) throw new Error('BASELINE_UNAVAILABLE');
            if (!this.nativeSaveTransport || !options.token) throw new Error('SAVE_TARGET_REQUIRED');
            if (options.targetIdentity && (this.docs || []).some(candidate =>
                this.ensureDocumentState(candidate).binding?.identity === options.targetIdentity
            )) throw new Error('TARGET_ALREADY_OPEN');
            const editedSnapshot = await this.captureDocumentSnapshot(docId);
            const baselineSnapshot = await this.cloneDocumentSnapshot(originalState.baselineSnapshot);
            const prepared = await this.prepareDocumentPdf(editedSnapshot, options, options.signal);
            const bytes = prepared.bytes instanceof Uint8Array ? prepared.bytes : new Uint8Array(prepared.bytes);
            const sha256 = await ensureSha256(bytes, prepared.sha256);
            const redactionVerification = normalizeRedactionVerification(options.redactionVerification || originalState.redactionVerification);
            console.info('[NativeSave] prepared copy', {
                docId, bytes: bytes.byteLength, sha256Ready: true
            });
            const operationId = options.operationId || ('copy_' + editedSnapshot.snapshotId);
            let uploadId;
            let writtenFingerprint = null;
            let writtenIdentity = options.targetIdentity || null;
            try {
                const begin = await this.nativeSaveTransport.begin({
                    token: options.token, operationId, length: bytes.byteLength,
                    sha256, expectedFingerprint: options.expectedFingerprint || null, redactionVerification
                });
                uploadId = begin.uploadId;
                if (redactionVerification && !begin.redactionVerification) throw new Error('REDACTION_VERIFICATION_UNAVAILABLE');
                const chunkSize = 4 * 1024 * 1024;
                for (let offset = 0, index = 0; offset < bytes.byteLength; offset += chunkSize, index += 1) {
                    await this.nativeSaveTransport.chunk(uploadId, index, offset, bytes.slice(offset, offset + chunkSize));
                }
                let committed;
                try { committed = await this.nativeSaveTransport.commit(uploadId, operationId); }
                catch (_) { committed = await this.nativeSaveTransport.status(operationId); }
                if (committed.status !== 'committed') throw new Error('SAVE_COMMIT_UNCERTAIN');
                if (redactionVerification && (!committed.redaction || committed.redaction.rejected?.length || committed.redaction.treated?.length !== redactionVerification.occurrences.length)) throw new Error('REDACTION_OUTPUT_UNVERIFIED');
                writtenFingerprint = committed.sha256 || sha256;
                writtenIdentity = committed.identity || writtenIdentity;
            } catch (error) {
                if (uploadId && this.nativeSaveTransport.abort) await this.nativeSaveTransport.abort(uploadId).catch(() => {});
                throw error;
            }

            const savedRevision = originalState.savedRevision;
            const binding = originalState.binding;
            await this.restoreDocumentSnapshot(docId, baselineSnapshot);
            const restoredState = this.ensureDocumentState(doc);
            restoredState.savedRevision = savedRevision;
            restoredState.binding = binding;

            const copyId = 'doc_' + Date.now() + Math.random().toString(36).slice(2, 7);
            const copySnapshot = await this.cloneDocumentSnapshot(editedSnapshot);
            copySnapshot.docId = copyId;
            copySnapshot.payload.document.name = /\.pdf$/i.test(doc.name || '')
                ? doc.name
                : (doc.name || 'documento') + '.pdf';
            const copy = { id: copyId, name: copySnapshot.payload.document.name, pages: [], sources: {}, history: [], historyIndex: -1 };
            const originalIndex = this.docs.indexOf(doc);
            this.docs.splice(originalIndex + 1, 0, copy);
            await this.restoreDocumentSnapshot(copyId, copySnapshot);
            const copyState = this.ensureDocumentState(copy);
            copyState.baselineSnapshot = await this.cloneDocumentSnapshot(copySnapshot);
            copyState.baselineSnapshotId = copySnapshot.snapshotId;
            copyState.savedRevision = editedSnapshot.revision;
            this.rememberNativeSaveTarget(copyId, {
                token: options.token,
                fingerprint: writtenFingerprint,
                identity: writtenIdentity
            });
            if (redactionVerification) copyState.redactionVerification = { ...redactionVerification, verifiedFingerprint: writtenFingerprint };
            if (this.switchTab) this.switchTab(copyId);
            return { docId: copyId, writtenRevision: editedSnapshot.revision, status: 'committed' };
        });
    }
});
