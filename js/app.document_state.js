// app.document_state.js
// Estado durable por documento. No guarda DOM, PDF.js ni tareas en curso.

if (!window.app) window.app = {};
const app = window.app;

const transientKeys = new Set([
    'doc', 'pdf', 'pdfDocument', 'loadingTask', 'renderTask', 'promise',
    'originalBuffer', '_thumbCache', '_thumbCacheObjects', '_bgBitmap',
    '_bgBitmapScale', '_bgBitmapW', '_bgBitmapH'
]);

function copyBuffer(value) {
    if (!value) return value;
    if (Object.prototype.toString.call(value) === '[object ArrayBuffer]') {
        return new Uint8Array(value).slice().buffer;
    }
    if (ArrayBuffer.isView(value)) {
        return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice().buffer;
    }
    return value;
}

function cloneDurable(value) {
    if (value === null || typeof value !== 'object') return value;
    const buffer = copyBuffer(value);
    if (buffer !== value) return buffer;
    if (Array.isArray(value)) return value.map(cloneDurable);
    if (value instanceof Date) return new Date(value.getTime());
    const copy = {};
    for (const [key, entry] of Object.entries(value)) {
        if (transientKeys.has(key) || key.startsWith('_history')) continue;
        if (typeof entry !== 'function') copy[key] = cloneDurable(entry);
    }
    return copy;
}

function snapshotId() {
    return 'snapshot_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
}

Object.assign(app, {
    getDocumentById: function (docId) {
        return (this.docs || []).find(doc => doc.id === docId) || null;
    },

    ensureDocumentState: function (doc) {
        if (!doc) return null;
        const current = doc.documentState || {};
        doc.documentState = {
            docId: doc.id,
            revision: Number.isSafeInteger(current.revision) ? current.revision : 0,
            savedRevision: Number.isSafeInteger(current.savedRevision) ? current.savedRevision : null,
            binding: current.binding || null,
            baselineSnapshotId: current.baselineSnapshotId || snapshotId(),
            baselineSnapshot: current.baselineSnapshot || null,
            redactionVerification: current.redactionVerification || null,
            lifecycleEpoch: Number.isSafeInteger(current.lifecycleEpoch) ? current.lifecycleEpoch : 0,
            operation: current.operation || 'idle'
        };
        return doc.documentState;
    },

    trackDocumentEdit: function (docId, task) {
        if (!this._pendingDocumentEdits) this._pendingDocumentEdits = new Map();
        let pending = this._pendingDocumentEdits.get(docId);
        if (!pending) this._pendingDocumentEdits.set(docId, pending = new Set());
        const work = Promise.resolve(task);
        pending.add(work);
        const remove = () => {
            pending.delete(work);
            if (!pending.size) this._pendingDocumentEdits.delete(docId);
        };
        work.then(remove, remove);
        return work;
    },

    flushDocumentEdits: async function (docId) {
        const doc = this.getDocumentById(docId);
        if (!doc) return;
        const active = document.activeElement;
        if (active && typeof active.blur === 'function') active.blur();
        while (this._pendingDocumentEdits?.get(docId)?.size) {
            await Promise.all([...this._pendingDocumentEdits.get(docId)]);
        }
    },

    captureDocumentSnapshot: async function (docId) {
        await this.flushDocumentEdits(docId);
        if (this.hydrateSessionDocument) await this.hydrateSessionDocument(this.getDocumentById(docId));
        const doc = this.getDocumentById(docId);
        if (!doc) throw new Error('DOCUMENT_NOT_FOUND');
        const state = this.ensureDocumentState(doc);
        const payload = {
            document: {
                name: doc.name,
                originalPath: doc.originalPath || doc.filePath || null,
                currentIndex: doc.currentIndex,
                scale: doc.scale,
                indexEntries: cloneDurable(doc.indexEntries || []),
                metadata: cloneDurable(doc.metadata || {})
            },
            pages: cloneDurable(doc.pages || []),
            sources: Object.entries(doc.sources || {}).map(([sourceId, source]) => ({
                sourceId,
                buffer: copyBuffer(source && source.buffer),
                metadata: cloneDurable(source && source.metadata ? source.metadata : {})
            }))
        };
        return {
            schemaVersion: 1,
            snapshotId: snapshotId(),
            docId: doc.id,
            revision: state.revision,
            lifecycleEpoch: state.lifecycleEpoch,
            payload
        };
    },

    cloneDocumentSnapshot: async function (snapshot) {
        if (!snapshot || snapshot.schemaVersion !== 1) throw new Error('INVALID_SNAPSHOT');
        return cloneDurable(snapshot);
    },

    setDocumentBaseline: async function (docId) {
        const snapshot = await this.captureDocumentSnapshot(docId);
        const doc = this.getDocumentById(docId);
        if (!doc) throw new Error('DOCUMENT_NOT_FOUND');
        const state = this.ensureDocumentState(doc);
        state.baselineSnapshot = await this.cloneDocumentSnapshot(snapshot);
        state.baselineSnapshotId = snapshot.snapshotId;
        return state.baselineSnapshot;
    },

    restoreDocumentBaseline: async function (docId) {
        const doc = this.getDocumentById(docId);
        if (!doc) throw new Error('DOCUMENT_NOT_FOUND');
        const state = this.ensureDocumentState(doc);
        if (!state.baselineSnapshot) throw new Error('BASELINE_UNAVAILABLE');
        return this.restoreDocumentSnapshot(docId, state.baselineSnapshot);
    },

    restoreDocumentSnapshot: async function (docId, snapshot) {
        if (!snapshot || snapshot.schemaVersion !== 1) throw new Error('INVALID_SNAPSHOT');
        const doc = this.getDocumentById(docId);
        if (!doc) throw new Error('DOCUMENT_NOT_FOUND');
        const payload = await this.cloneDocumentSnapshot(snapshot.payload ? snapshot : { ...snapshot, payload: {} });
        doc.name = payload.payload.document.name;
        doc.originalPath = payload.payload.document.originalPath || doc.originalPath || null;
        doc.currentIndex = payload.payload.document.currentIndex;
        doc.scale = payload.payload.document.scale;
        doc.indexEntries = payload.payload.document.indexEntries;
        doc.metadata = payload.payload.document.metadata;
        doc.pages = payload.payload.pages;
        doc.sources = Object.fromEntries(payload.payload.sources.map(source => [source.sourceId, {
            buffer: copyBuffer(source.buffer),
            metadata: cloneDurable(source.metadata || {}),
            doc: null
        }]));
        const state = this.ensureDocumentState(doc);
        state.revision = snapshot.revision;
        state.lifecycleEpoch = Math.max(state.lifecycleEpoch + 1, snapshot.lifecycleEpoch + 1);
        state.operation = 'idle';
    },

    markDocumentChanged: function (docId) {
        const doc = this.getDocumentById(docId);
        if (!doc) return;
        const state = this.ensureDocumentState(doc);
        state.revision += 1;
    },

    isDocumentDirty: function (docId) {
        const doc = this.getDocumentById(docId);
        if (!doc) return false;
        const state = this.ensureDocumentState(doc);
        return state.savedRevision === null || state.revision !== state.savedRevision;
    },

    withDocumentOperation: function (docId, kind, task) {
        if (!this._documentOperationQueues) this._documentOperationQueues = new Map();
        const previous = this._documentOperationQueues.get(docId) || Promise.resolve();
        const run = previous.catch(() => {}).then(async () => {
            const doc = this.getDocumentById(docId);
            if (!doc) throw new Error('DOCUMENT_NOT_FOUND');
            const state = this.ensureDocumentState(doc);
            state.operation = kind;
            try {
                return await task(doc, state.lifecycleEpoch);
            } finally {
                const current = this.getDocumentById(docId);
                if (current) this.ensureDocumentState(current).operation = 'idle';
            }
        });
        const tail = run.catch(() => {});
        this._documentOperationQueues.set(docId, tail);
        tail.then(() => {
            if (this._documentOperationQueues.get(docId) === tail) this._documentOperationQueues.delete(docId);
        });
        return run;
    },

    saveStateDebounced: function (delay = 500) {
        const doc = this.getDocumentById(this.activeDocId);
        if (!doc) return;
        const state = this.ensureDocumentState(doc);
        if (!this._saveStateTimers) this._saveStateTimers = new Map();
        const existing = this._saveStateTimers.get(doc.id);
        if (existing) clearTimeout(existing.timer);
        const timer = setTimeout(() => {
            this._saveStateTimers.delete(doc.id);
            const current = this.getDocumentById(doc.id);
            if (!current || this.ensureDocumentState(current).lifecycleEpoch !== state.lifecycleEpoch) return;
            this.saveState(doc.id);
        }, delay);
        this._saveStateTimers.set(doc.id, { timer, lifecycleEpoch: state.lifecycleEpoch });
    }
});
