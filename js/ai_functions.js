        (function () {
            // Wait for app to be ready
            function initAIFunctions() {
                if (typeof app === 'undefined') {
                    console.warn('[ai_functions] app no disponible en app:ready');
                    return;
                }

                console.log('🤖 Initializing AI Agent Functions...');

                // ============================================================
                // AI PANEL STATE
                // ============================================================
                app.aiPanelState = {
                    isFloating: true,
                    width: 28, // percentage
                    currentConversationId: null,
                    messages: []
                };
                // Apply floating mode class on init
                requestAnimationFrame(function() {
                    const _panel = document.getElementById('ai-panel');
                    const _btn = document.getElementById('ai-toggle-float-btn');
                    if (_panel) _panel.classList.add('floating-mode');
                    if (_btn) _btn.innerHTML = '◫';
                });

                // ============================================================
                // TOGGLE AI PANEL (NEW - LATERAL)
                // ============================================================
                app.toggleAIPanel = function () {
                    const panel = document.getElementById('ai-panel');
                    const workspace = document.getElementById('main-workspace') || document.querySelector('.main-content');

                    if (!panel) {
                        console.error('AI Panel not found');
                        return;
                    }

                    const isVisible = panel.classList.contains('visible');

                    if (isVisible) {
                        // Close panel
                        panel.classList.remove('visible');
                        if (workspace && !this.aiPanelState.isFloating) {
                            workspace.classList.remove('ai-panel-open');
                        }
                        // Stop any TTS
                        if (window.speechSynthesis) {
                            window.speechSynthesis.cancel();
                        }
                    } else {
                        // Open panel
                        panel.classList.add('visible');
                        if (workspace && !this.aiPanelState.isFloating) {
                            workspace.classList.add('ai-panel-open');
                            workspace.style.setProperty('--ai-panel-width', this.aiPanelState.width + '%');
                        }
                        // Focus input
                        setTimeout(() => {
                            if (panel.classList.contains('visible')) {
                                document.getElementById('ai-input')?.focus();
                            }
                        }, 350);
                        // Load current conversation if any
                        this.loadCurrentAIConversation();
                    }
                };

                const aiPanel = document.getElementById('ai-panel');
                const aiToggle = document.getElementById('ai-floating-btn');
                document.addEventListener('click', (event) => {
                    if (!aiPanel?.classList.contains('visible')) return;
                    const path = event.composedPath();
                    if (path.includes(aiPanel) || path.includes(aiToggle)) return;

                    // Defer closing until the clicked control has run and the layout can change safely.
                    requestAnimationFrame(() => {
                        if (aiPanel.classList.contains('visible')) app.toggleAIPanel();
                    });
                }, true);

                // Escape key closes AI panel
                document.addEventListener('keydown', function(e) {
                    if (e.key === 'Escape') {
                        const panel = document.getElementById('ai-panel');
                        if (panel && panel.classList.contains('visible')) {
                            app.toggleAIPanel();
                        }
                    }
                });

                // ============================================================
                // TOGGLE FLOATING MODE
                // ============================================================
                app.toggleAIFloatingMode = function () {
                    const panel = document.getElementById('ai-panel');
                    const workspace = document.getElementById('main-workspace') || document.querySelector('.main-content');
                    const btn = document.getElementById('ai-toggle-float-btn');

                    this.aiPanelState.isFloating = !this.aiPanelState.isFloating;

                    if (this.aiPanelState.isFloating) {
                        panel.classList.add('floating-mode');
                        if (workspace) {
                            workspace.classList.remove('ai-panel-open');
                            workspace.classList.add('ai-panel-floating');
                        }
                        if (btn) btn.innerHTML = '◫';
                        this.showToast?.('Modo flotante activado');
                    } else {
                        panel.classList.remove('floating-mode');
                        if (workspace) {
                            workspace.classList.remove('ai-panel-floating');
                            if (panel.classList.contains('visible')) {
                                workspace.classList.add('ai-panel-open');
                            }
                        }
                        if (btn) btn.innerHTML = '⬛';
                        this.showToast?.('Modo acoplado activado');
                    }
                };

                // ============================================================
                // RESIZE HANDLE FUNCTIONALITY
                // ============================================================
                (function initResizeHandle() {
                    const handle = document.getElementById('ai-resize-handle');
                    const panel = document.getElementById('ai-panel');
                    if (!handle || !panel) return;

                    let isResizing = false;
                    let startX, startWidth;

                    handle.addEventListener('mousedown', (e) => {
                        isResizing = true;
                        startX = e.clientX;
                        startWidth = panel.offsetWidth;
                        document.body.style.cursor = 'ew-resize';
                        document.body.style.userSelect = 'none';
                        e.preventDefault();
                    });

                    document.addEventListener('mousemove', (e) => {
                        if (!isResizing) return;
                        const diff = startX - e.clientX;
                        const newWidth = startWidth + diff;
                        const windowWidth = window.innerWidth;
                        const minWidth = windowWidth * 0.25;
                        const maxWidth = windowWidth * 0.40;

                        if (newWidth >= minWidth && newWidth <= maxWidth) {
                            const widthPercent = (newWidth / windowWidth) * 100;
                            panel.style.width = widthPercent + '%';
                            app.aiPanelState.width = widthPercent;
                            panel.classList.toggle('ai-narrow', newWidth < windowWidth * 0.30);

                            const workspace = document.getElementById('main-workspace') || document.querySelector('.main-content');
                            if (workspace && !app.aiPanelState.isFloating) {
                                workspace.style.setProperty('--ai-panel-width', widthPercent + '%');
                            }
                        }
                    });

                    document.addEventListener('mouseup', () => {
                        if (isResizing) {
                            isResizing = false;
                            document.body.style.cursor = '';
                            document.body.style.userSelect = '';
                            localStorage.setItem('ai_panel_width', app.aiPanelState.width);
                        }
                    });

                    // Restore saved width
                    const savedWidth = localStorage.getItem('ai_panel_width');
                    if (savedWidth) {
                        const w = parseFloat(savedWidth);
                        app.aiPanelState.width = w;
                        panel.style.width = w + '%';
                        panel.classList.toggle('ai-narrow', w < 30);
                    }
                })();

                // ============================================================
                // NEW CHAT
                // ============================================================
                app.aiNewChat = function () {
                    this.stopAIResponse(false);
                    dismissChatRetry();
                    // Save current conversation before starting new
                    if (this.aiPanelState.messages.length > 0) {
                        this.saveAIConversation();
                    }

                    // Clear messages
                    this.aiPanelState.messages = [];
                    this.aiPanelState.currentConversationId = 'conv_' + Date.now();

                    // Reset chat area
                    const chatArea = document.getElementById('ai-chat-area');
                    if (chatArea) {
                        const fontStyle = this._aiFontSize ? ` style="font-size:${this._aiFontSize}px;padding:${this._aiFontPad || ''}"` : '';
                        chatArea.innerHTML = `
                            <div class="ai-message ai" id="ai-welcome-msg"${fontStyle}>
                                <p style="margin: 0 0 8px 0; font-weight: 600;">👋 ¡Hola! Nueva conversación iniciada.</p>
                                <p style="margin: 0; opacity: 0.85;">
                                    Puedo resumir, analizar, extraer datos, traducir documentos y responder preguntas sobre tu PDF.
                                </p>
                            </div>
                        `;
                    }

                    this.showToast?.('Nueva conversación iniciada');
                };

                // ============================================================
                // TOGGLE HISTORY SIDEBAR
                // ============================================================
                app.toggleAIHistory = function () {
                    const sidebar = document.getElementById('ai-history-sidebar');
                    if (!sidebar) return;

                    const isVisible = sidebar.classList.contains('visible');

                    if (isVisible) {
                        sidebar.classList.remove('visible');
                    } else {
                        sidebar.classList.add('visible');
                        this.loadAIHistory();
                    }
                };

                // ============================================================
                // LOAD AI HISTORY FROM INDEXEDDB
                // ============================================================
                app.loadAIHistory = async function () {
                    const listEl = document.getElementById('ai-history-list');
                    if (!listEl) return;

                    try {
                        const conversations = await this.getAIConversations();

                        if (!conversations || conversations.length === 0) {
                            listEl.innerHTML = `
                                <p style="color: rgba(255,255,255,0.5); text-align: center; font-size: 12px; margin-top: 40px;">
                                    No hay conversaciones guardadas
                                </p>
                            `;
                            return;
                        }

                        listEl.innerHTML = conversations.map(conv => `
                            <div class="history-item" onclick="app.loadAIConversation('${conv.id}')">
                                <button class="delete-btn" onclick="event.stopPropagation(); app.deleteAIConversation('${conv.id}')" title="Eliminar">🗑️</button>
                                <div class="doc-name">
                                    📄 ${conv.documentName || 'Sin documento'}
                                </div>
                                <div class="preview">${conv.preview || 'Conversación vacía'}</div>
                                <div class="date">${new Date(conv.timestamp).toLocaleString('es-MX')}</div>
                            </div>
                        `).join('');

                    } catch (e) {
                        console.error('Error loading AI history:', e);
                        listEl.innerHTML = '<p style="color: #ef4444; text-align: center;">Error al cargar historial</p>';
                    }
                };

                // ============================================================
                // INDEXEDDB FUNCTIONS FOR AI CONVERSATIONS
                // ============================================================
                app.getAIConversations = async function () {
                    return new Promise((resolve) => {
                        const request = indexedDB.open('AliothAI', 1);

                        request.onupgradeneeded = (e) => {
                            const db = e.target.result;
                            if (!db.objectStoreNames.contains('conversations')) {
                                db.createObjectStore('conversations', { keyPath: 'id' });
                            }
                        };

                        request.onsuccess = (e) => {
                            const db = e.target.result;
                            const tx = db.transaction('conversations', 'readonly');
                            const store = tx.objectStore('conversations');
                            const getAllReq = store.getAll();

                            getAllReq.onsuccess = () => {
                                // Sort by timestamp descending and filter old ones
                                const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
                                const filtered = getAllReq.result
                                    .filter(c => c.timestamp > sevenDaysAgo)
                                    .sort((a, b) => b.timestamp - a.timestamp);
                                resolve(filtered);
                            };

                            getAllReq.onerror = () => resolve([]);
                        };

                        request.onerror = () => resolve([]);
                    });
                };

                app.saveAIConversation = async function () {
                    if (!this.aiPanelState.messages || this.aiPanelState.messages.length === 0) return;

                    const doc = this.getDoc?.() || {};
                    const conversation = {
                        id: this.aiPanelState.currentConversationId || 'conv_' + Date.now(),
                        documentName: doc.name || 'Sin documento',
                        documentId: doc.id || null,
                        messages: this.aiPanelState.messages,
                        preview: this.aiPanelState.messages[0]?.text?.substring(0, 80) || '',
                        timestamp: Date.now()
                    };

                    return new Promise((resolve) => {
                        const request = indexedDB.open('AliothAI', 1);

                        request.onupgradeneeded = (e) => {
                            const db = e.target.result;
                            if (!db.objectStoreNames.contains('conversations')) {
                                db.createObjectStore('conversations', { keyPath: 'id' });
                            }
                        };

                        request.onsuccess = (e) => {
                            const db = e.target.result;
                            const tx = db.transaction('conversations', 'readwrite');
                            const store = tx.objectStore('conversations');
                            store.put(conversation);
                            tx.oncomplete = () => resolve(true);
                            tx.onerror = () => resolve(false);
                        };

                        request.onerror = () => resolve(false);
                    });
                };

                app.loadAIConversation = async function (convId) {
                    return new Promise((resolve) => {
                        const request = indexedDB.open('AliothAI', 1);

                        request.onsuccess = (e) => {
                            const db = e.target.result;
                            const tx = db.transaction('conversations', 'readonly');
                            const store = tx.objectStore('conversations');
                            const getReq = store.get(convId);

                            getReq.onsuccess = () => {
                                const conv = getReq.result;
                                if (conv) {
                                    this.stopAIResponse(false);
                                    dismissChatRetry();
                                    this.aiPanelState.currentConversationId = conv.id;
                                    this.aiPanelState.messages = conv.messages || [];
                                    this.renderAIChatMessages();
                                    this.toggleAIHistory(); // Close sidebar
                                    this.showToast?.('Conversación cargada');
                                }
                                resolve(conv);
                            };

                            getReq.onerror = () => resolve(null);
                        };

                        request.onerror = () => resolve(null);
                    });
                };

                app.deleteAIConversation = async function (convId) {
                    if (!confirm('¿Eliminar esta conversación?')) return;

                    return new Promise((resolve) => {
                        const request = indexedDB.open('AliothAI', 1);

                        request.onsuccess = (e) => {
                            const db = e.target.result;
                            const tx = db.transaction('conversations', 'readwrite');
                            const store = tx.objectStore('conversations');
                            store.delete(convId);
                            tx.oncomplete = () => {
                                this.loadAIHistory();
                                this.showToast?.('Conversación eliminada');
                                resolve(true);
                            };
                        };
                    });
                };

                app.aiClearHistory = async function () {
                    if (!confirm('¿Borrar TODAS las conversaciones guardadas?')) return;

                    return new Promise((resolve) => {
                        const request = indexedDB.open('AliothAI', 1);

                        request.onsuccess = (e) => {
                            const db = e.target.result;
                            const tx = db.transaction('conversations', 'readwrite');
                            const store = tx.objectStore('conversations');
                            store.clear();
                            tx.oncomplete = () => {
                                this.loadAIHistory();
                                this.showToast?.('Historial borrado');
                                resolve(true);
                            };
                        };
                    });
                };

                app.toggleAIFontSlider = function () {
                    const popup = document.getElementById('ai-font-slider-popup');
                    if (!popup) return;
                    const isVisible = popup.style.display !== 'none';
                    popup.style.display = isVisible ? 'none' : 'block';
                    if (!isVisible) {
                        const closeHandler = (e) => {
                            if (!popup.contains(e.target) && e.target.id !== 'ai-font-size-btn') {
                                popup.style.display = 'none';
                                document.removeEventListener('click', closeHandler);
                            }
                        };
                        setTimeout(() => document.addEventListener('click', closeHandler), 50);
                    }
                };

                app.applyAIFontSize = function (size) {
                    const px = parseInt(size, 10) || 13;
                    const label = document.getElementById('ai-font-size-label');
                    if (label) label.textContent = px + 'px';

                    const slider = document.getElementById('ai-font-size-slider');
                    if (slider && slider.value !== String(px)) slider.value = px;

                    const basePad = Math.max(3, Math.round(px * 0.46));
                    const basePadH = Math.max(5, Math.round(px * 0.69));
                    const padStr = basePad + 'px ' + basePadH + 'px';

                    this._aiFontSize = px;
                    this._aiFontPad = padStr;
                    try { localStorage.setItem('alioth_ai_font_size', String(px)); } catch (_) {}

                    const panel = document.getElementById('ai-panel');
                    if (panel) {
                        panel.style.setProperty('--ai-chat-font-size', px + 'px');
                        panel.style.setProperty('--ai-chat-pad', padStr);
                    }
                    const chatArea = document.getElementById('ai-chat-area');
                    if (chatArea) {
                        chatArea.style.setProperty('--ai-chat-font-size', px + 'px');
                        chatArea.style.setProperty('--ai-chat-pad', padStr);
                    }

                    document.querySelectorAll('.ai-message').forEach(el => {
                        el.style.fontSize = px + 'px';
                        el.style.padding = padStr;
                        el.querySelectorAll('p, span:not(.ai-msg-actions *), div:not(.ai-msg-actions)').forEach(child => {
                            child.style.fontSize = px + 'px';
                        });
                    });
                };

                app.loadCurrentAIConversation = function () {
                    // Just ensure we have a conversation ID
                    if (!this.aiPanelState.currentConversationId) {
                        this.aiPanelState.currentConversationId = 'conv_' + Date.now();
                    }
                };

                app.renderAIChatMessages = function () {
                    const chatArea = document.getElementById('ai-chat-area');
                    if (!chatArea) return;

                    const fontStyle = this._aiFontSize ? ` style="font-size:${this._aiFontSize}px;padding:${this._aiFontPad || ''}"` : '';
                    if (!this.aiPanelState.messages || this.aiPanelState.messages.length === 0) {
                        chatArea.innerHTML = `
                            <div class="ai-message ai" id="ai-welcome-msg"${fontStyle}>
                                <p style="margin: 0 0 8px 0; font-weight: 600;">👋 ¡Hola! Soy tu asistente de IA.</p>
                                <p style="margin: 0; opacity: 0.85;">
                                    Puedo resumir, analizar, extraer datos, traducir documentos y responder preguntas sobre tu PDF.
                                </p>
                            </div>
                        `;
                        return;
                    }

                    chatArea.innerHTML = this.aiPanelState.messages.map((msg, idx) => {
                        const typeClass = msg.type === 'user' ? 'user' : 'ai';
                        let html = window.escapeHTML(msg.text)
                            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                            .replace(/\*(.*?)\*/g, '<em>$1</em>')
                            .replace(/\n/g, '<br>');

                        let actions = '';
                        if (msg.type === 'ai') {
                            actions = `
                                <div class="ai-msg-actions">
                                    <button class="ai-msg-action-btn" onclick="app.copyAIMessage(${idx})">📋 Copiar</button>
                                    <button class="ai-msg-action-btn" onclick="app.speakAIMessage(${idx})">🔊 Leer</button>
                                </div>
                            `;
                        }

                        return `<div class="ai-message ${typeClass}"${fontStyle}>${html}${actions}</div>`;
                    }).join('');

                    chatArea.scrollTop = chatArea.scrollHeight;
                };

                // ============================================================
                // COPY AI MESSAGE
                // ============================================================
                app.copyAIMessage = function (idx) {
                    const msg = this.aiPanelState.messages[idx];
                    if (!msg) return;

                    navigator.clipboard.writeText(msg.text).then(() => {
                        this.showToast?.('📋 Copiado al portapapeles');
                    }).catch(() => {
                        this.showToast?.('❌ Error al copiar');
                    });
                };

                // ============================================================
                // TEXT TO SPEECH - READ AI MESSAGE
                // ============================================================
                app.speakAIMessage = function (idx) {
                    const msg = this.aiPanelState.messages[idx];
                    if (!msg || !window.speechSynthesis) {
                        this.showToast?.('❌ TTS no disponible');
                        return;
                    }

                    // Stop any current speech
                    window.speechSynthesis.cancel();

                    const utterance = new SpeechSynthesisUtterance(msg.text);
                    utterance.lang = 'es-MX';
                    utterance.rate = 1.0;
                    utterance.pitch = 1.0;

                    // Try to get a Spanish voice
                    const voices = window.speechSynthesis.getVoices();
                    const spanishVoice = voices.find(v => v.lang.includes('es'));
                    if (spanishVoice) utterance.voice = spanishVoice;

                    window.speechSynthesis.speak(utterance);
                    this.showToast?.('🔊 Leyendo respuesta...');
                };



                // ============================================================
                // AUTO-CLEANUP OLD CONVERSATIONS (7 days)
                // ============================================================
                (function autoCleanupOldConversations() {
                    const request = indexedDB.open('AliothAI', 1);

                    request.onupgradeneeded = (e) => {
                        const db = e.target.result;
                        if (!db.objectStoreNames.contains('conversations')) {
                            db.createObjectStore('conversations', { keyPath: 'id' });
                        }
                    };

                    request.onsuccess = (e) => {
                        const db = e.target.result;
                        const tx = db.transaction('conversations', 'readwrite');
                        const store = tx.objectStore('conversations');
                        const getAllReq = store.getAll();

                        getAllReq.onsuccess = () => {
                            const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
                            const oldConvs = getAllReq.result.filter(c => c.timestamp < sevenDaysAgo);

                            oldConvs.forEach(conv => {
                                store.delete(conv.id);
                            });

                            if (oldConvs.length > 0) {
                                console.log(`🧹 Auto-cleanup: ${oldConvs.length} conversaciones antiguas eliminadas`);
                            }
                        };
                    };
                })();

                // ============================================================
                // SEND MESSAGE TO AI (Google Gemini API - Free Tier)
                // ============================================================
                // Si no hay API key en localStorage, usar la predefinida del objeto app
                const storedKey = localStorage.getItem('gemini_api_key');
                if (storedKey) {
                    app.geminiApiKey = storedKey;
                }
                // Si app.geminiApiKey ya tiene valor (de la línea 16082), lo conserva

                let activeChat = null;
                let retryNotice = null;

                function setChatBusy(busy) {
                    document.getElementById('ai-send-btn').hidden = busy;
                    document.getElementById('ai-stop-btn').hidden = !busy;
                }

                function dismissChatRetry() {
                    if (retryNotice) retryNotice.remove();
                    retryNotice = null;
                }

                function finishChat(run) {
                    clearTimeout(run.timeout);
                    run.loading?.remove();
                    if (activeChat === run) {
                        activeChat = null;
                        setChatBusy(false);
                    }
                }

                function showChatRetry(question, text, type = 'ai-error') {
                    const id = app.addAIChatMessage(text, type, false);
                    const notice = document.getElementById(id);
                    if (!notice) return;
                    const retry = document.createElement('button');
                    retry.type = 'button';
                    retry.className = 'ai-msg-action-btn ai-chat-retry';
                    retry.textContent = 'Reintentar';
                    retry.addEventListener('click', () => {
                        if (activeChat) return;
                        if (app.getDoc?.() !== question.doc) {
                            app.showToast?.('Vuelve al documento de la consulta para reintentar.');
                            return;
                        }
                        runChat(question);
                    });
                    notice.append(retry);
                    retryNotice = notice;
                    notice.scrollIntoView({ block: 'nearest' });
                }

                function cancelChat(run, status) {
                    if (activeChat !== run) return;
                    run.controller.abort();
                    if (run.requestId) {
                        fetch('/api/ai/chat/cancel', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ requestId: run.requestId }),
                            keepalive: true
                        }).catch(() => {});
                    }
                    finishChat(run);
                    if (status) showChatRetry(run.question, status, 'ai-stopped');
                }

                app.stopAIResponse = function (showStatus = true) {
                    if (activeChat) cancelChat(activeChat, showStatus ? 'Respuesta detenida.' : '');
                };

                function waitForChatRetry(signal) {
                    return new Promise(resolve => {
                        const finish = () => {
                            clearTimeout(timer);
                            signal.removeEventListener('abort', finish);
                            resolve();
                        };
                        const timer = setTimeout(finish, 900);
                        signal.addEventListener('abort', finish, { once: true });
                    });
                }

                async function requestChat(run, payload) {
                    const { signal } = run.controller;
                    const headers = { 'Content-Type': 'application/json' };
                    if (app.geminiApiKey && !window.AliothSecureKeys?.gemini) {
                        headers.Authorization = 'Bearer ' + app.geminiApiKey;
                    }
                    const started = performance.now();
                    for (let attempt = 0; attempt < 2; attempt++) {
                        signal.throwIfAborted();
                        run.requestId = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
                        let result;
                        try {
                            const response = await fetch('/api/ai/chat', {
                                method: 'POST', headers, signal,
                                body: JSON.stringify({ ...payload, requestId: run.requestId })
                            });
                            const data = await response.json().catch(() => ({}));
                            result = { ...data, success: response.ok && data?.ok };
                        } catch (error) {
                            signal.throwIfAborted();
                            if (!(error instanceof TypeError)) throw error;
                            result = { error: 'PROVIDER_NETWORK_ERROR' };
                        }
                        run.requestId = null;
                        signal.throwIfAborted();

                        const mayRetry = result.error === 'PROVIDER_REQUEST_FAILED' || result.error === 'PROVIDER_NETWORK_ERROR';
                        if (attempt || !mayRetry || performance.now() - started > 4000) return result;
                        if (run.loading) run.loading.textContent = 'Reintentando la consulta…';
                        await waitForChatRetry(signal);
                    }
                }

                async function prepareChat(question, signal) {
                    const { doc, message } = question;
                    const totalPages = doc?.pages?.length || 0;
                    const extractedText = totalPages ? await app.extractTextFromAllPages(doc, signal) : '';
                    signal.throwIfAborted();
                    let context = '';
                    if (extractedText) {
                        const limitedText = extractedText.substring(0, 30000);
                        context = '[DOCUMENTO - ' + totalPages + ' páginas]\n\n' + limitedText;
                        if (limitedText.length < extractedText.length) context += '\n[Texto del documento recortado.]';
                        context += '\n\nPREGUNTA DEL USUARIO:\n';
                    } else if (totalPages) {
                        context = '[DOCUMENTO SIN TEXTO EXTRAÍBLE - ' + totalPages + ' páginas]\n\n';
                    }
                    const needsImages = totalPages > 0 && totalPages <= 10
                        && (!extractedText || /imagen|visual|gráfico|foto|diagrama/i.test(message));
                    const images = needsImages ? (await app.captureAllPagesAsImages(10, doc, signal)).map(image => image.data) : [];
                    signal.throwIfAborted();
                    return { prompt: context + message, images };
                }

                async function runChat(question) {
                    if (!window.aliothLegal?.isAiEnabled(localStorage)) {
                        app.addAIChatMessage('Activa las funciones de IA para usar el chat.', 'ai-error', false);
                        return;
                    }
                    dismissChatRetry();
                    const loadingId = app.addAIChatMessage('Preparando la respuesta…', 'ai-loading');
                    const run = { question, controller: new AbortController(), loading: document.getElementById(loadingId) };
                    activeChat = run;
                    run.loading?.setAttribute('role', 'status');
                    setChatBusy(true);
                    run.timeout = setTimeout(() => cancelChat(run, 'La consulta tardó demasiado. Puedes reintentar.'), 26000);
                    const { signal } = run.controller;
                    try {
                        question.payload ??= await prepareChat(question, signal);
                        signal.throwIfAborted();
                        if (run.loading) run.loading.textContent = 'Esperando respuesta…';
                        const result = await requestChat(run, {
                            ...question.payload,
                            preferredProvider: localStorage.getItem('alioth_default_ai_provider') || 'gemini'
                        });
                        signal.throwIfAborted();
                        if (result.success && typeof result.text === 'string' && result.text.trim()) {
                            app.addAIChatMessage(result.text, 'ai');
                            return;
                        }

                        const messages = {
                            PROVIDER_KEY_REQUIRED: 'Vincula una clave API en Preferencias para usar el chat.',
                            PROVIDER_AUTH_FAILED: 'No fue posible autenticar los proveedores configurados. Revisa tus claves en Preferencias.',
                            PROVIDER_PAYMENT_REQUIRED: 'El proveedor requiere revisar la facturación de tu cuenta.',
                            PROVIDER_RATE_LIMITED: 'Los modelos disponibles alcanzaron su límite de solicitudes.',
                            PROVIDER_TIMEOUT: 'Los modelos disponibles tardaron demasiado en responder.',
                            INVALID_AI_CHAT: 'No se pudo enviar la consulta. Intenta con un mensaje más corto o vuelve a abrir el PDF.'
                        };
                        showChatRetry(question, messages[result.error] || 'Ningún modelo disponible pudo responder.');
                        if (result.error === 'PROVIDER_KEY_REQUIRED') app.showApiKeyPrompt();
                    } catch (error) {
                        if (!signal.aborted) {
                            console.warn('No se pudo completar la consulta de IA:', error.name);
                            showChatRetry(question, 'No se pudo completar la consulta de IA.');
                        }
                    } finally {
                        finishChat(run);
                    }
                }

                app.sendAIMessage = function (overrideMessage) {
                    const input = document.getElementById('ai-input');
                    const message = (overrideMessage || input.value).trim();
                    if (!message || activeChat) return;
                    if (!window.aliothLegal?.isAiEnabled(localStorage)) {
                        this.addAIChatMessage('Activa las funciones de IA para usar el chat.', 'ai-error', false);
                        return;
                    }
                    this.addAIChatMessage(message, 'user');
                    if (!overrideMessage) {
                        input.value = '';
                        input.style.height = 'auto';
                    }
                    return runChat({ doc: this.getDoc?.(), message });
                };

                // ============================================================
                // API KEY MANAGEMENT
                // ============================================================
                app.showApiKeyPrompt = function () {
                    const existingPrompt = document.getElementById('api-key-prompt');
                    if (existingPrompt) existingPrompt.remove();

                    const promptHtml = `
                        <div id="api-key-prompt" style="
                            background: var(--ai-response-background);
                            border: 1px solid var(--ai-border);
                            border-radius: 12px;
                            padding: 16px;
                            margin-bottom: 16px;
                        ">
                            <p style="margin: 0 0 12px 0; font-size: 14px; color: white;">
                                🔑 <strong>API Key requerida</strong><br>
                                <span style="font-size: 12px; opacity: 0.8;">
                                    Obtén tu key gratis en 
                                    <a href="https://aistudio.google.com/apikey" target="_blank" 
                                       style="color: var(--ai-text); text-decoration: underline;">Google AI Studio</a>
                                </span>
                            </p>
                            <div style="display: flex; gap: 8px;">
                                <input type="password" id="gemini-key-input" 
                                    placeholder="Pega tu API key aquí..."
                                    style="
                                        flex: 1;
                                        padding: 10px 12px;
                                        border: 1px solid var(--ai-border);
                                        border-radius: 8px;
                                        background: rgba(0,0,0,0.3);
                                        color: white;
                                        font-size: 13px;
                                    "
                                >
                                <button onclick="app.saveApiKey()" style="
                                    background: var(--ai-hover-background);
                                    border: 1px solid var(--ai-border);
                                    color: white;
                                    padding: 10px 16px;
                                    border-radius: 8px;
                                    cursor: pointer;
                                    font-weight: 600;
                                ">Guardar</button>
                            </div>
                        </div>
                    `;

                    const chatArea = document.getElementById('ai-chat-area');
                    chatArea.insertAdjacentHTML('beforeend', promptHtml);
                    chatArea.scrollTop = chatArea.scrollHeight;

                    setTimeout(() => {
                        document.getElementById('gemini-key-input')?.focus();
                    }, 100);
                };

                app.saveApiKey = async function () {
                    const input = document.getElementById('gemini-key-input');
                    const key = input?.value?.trim();

                    if (key && key.length > 20) {
                        try {
                            const response = await fetch('/api/secure-credentials', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ provider: 'gemini', key })
                            });
                            if (!response.ok) throw new Error('No se pudo guardar la clave');
                            this.geminiApiKey = key;
                            localStorage.removeItem('gemini_api_key');
                            await this._refreshSecureKeyStatus?.();
                        } catch (_) {
                            this.showToast?.('No se pudo guardar la clave API.');
                            return;
                        }

                        const prompt = document.getElementById('api-key-prompt');
                        if (prompt) prompt.remove();

                        this.addAIChatMessage('✅ API Key guardada. ¡Ya puedes usar el Agente IA!', 'ai');
                        this.showToast?.('🔑 API Key guardada correctamente');
                    } else {
                        this.showToast?.('⚠️ La API Key parece incorrecta');
                    }
                };

                // ============================================================
                // QUICK ACTIONS (Resumir, Analizar, Extraer, Traducir)
                // ============================================================
                app.aiQuickAction = async function (action) {
                    // Get prompts for each action - Direct references to the open document
                    const prompts = {
                        'resumir': 'Analiza el documento que estoy visualizando y genera un resumen en puntos clave y concisos.',
                        'analizar': 'Analiza detalladamente la estructura, el contenido y los puntos más importantes de este documento que tengo abierto.',
                        'extraer': 'Extrae todos los datos relevantes (nombres, fechas, números, direcciones, tablas o cualquier dato importante) que aparezcan en este documento.',
                        'traducir': 'Traduce todo el contenido de este documento al inglés, manteniendo el sentido y el formato original.'
                    };

                    const prompt = prompts[action] || '';
                    if (!prompt) return;

                    // Send the direct prompt (The vision system will automatically include the document image)
                    this.sendAIMessage(prompt);
                };

                // ============================================================
                // EXTRACT TEXT FROM CURRENT PAGE
                // ============================================================
                // ============================================================
                // CAPTURE CURRENT PAGE AS IMAGE (AI vision)
                // ============================================================
                // ============================================================
                // EXTRACT TEXT FROM ALL PAGES (Reads entire document)
                // ============================================================
                app.extractTextFromAllPages = async function (doc = this.getDoc?.(), signal) {
                    if (!doc?.pages?.length) return '';
                    const sections = [];
                    let characters = 0;
                    for (const [index, record] of doc.pages.entries()) {
                        signal?.throwIfAborted();
                        let text = record.textContent?.trim() || '';
                        const source = doc.sources[record.sourceId];
                        if (!text && source) {
                            try {
                                const pdf = await this.loadSourcePdf(source);
                                signal?.throwIfAborted();
                                const page = await pdf.getPage(record.pageIndex + 1);
                                signal?.throwIfAborted();
                                const content = await page.getTextContent();
                                text = content.items.map(item => item.str).join(' ').trim();
                            } catch (error) {
                                signal?.throwIfAborted();
                                console.warn('No se pudo extraer texto de una página para el chat:', error.name);
                            }
                        }
                        if (!text) continue;
                        const section = 'PÁGINA ' + (index + 1) + ' DE ' + doc.pages.length + '\n' + text;
                        sections.push(section);
                        characters += section.length + 2;
                        if (characters > 30000) break;
                    }
                    return sections.join('\n\n');
                };

                app.captureAllPagesAsImages = async function (maxPages = 10, doc = this.getDoc?.(), signal) {
                    if (!doc?.pages?.length) return [];
                    const images = await Promise.all(doc.pages.slice(0, maxPages).map(async (record, index) => {
                        signal?.throwIfAborted();
                        if (record.canvas) {
                            return { page: index + 1, data: record.canvas.toDataURL('image/jpeg', 0.8).split(',')[1] };
                        }
                        const source = doc.sources[record.sourceId];
                        if (!source) return null;
                        try {
                            const pdf = await this.loadSourcePdf(source);
                            const page = await pdf.getPage(record.pageIndex + 1);
                            signal?.throwIfAborted();
                            const viewport = page.getViewport({ scale: 1, rotation: page.rotate + (record.rotation || 0) });
                            const canvas = document.createElement('canvas');
                            canvas.width = viewport.width;
                            canvas.height = viewport.height;
                            const task = page.render({ canvasContext: canvas.getContext('2d'), viewport });
                            const cancel = () => task.cancel();
                            signal?.addEventListener('abort', cancel, { once: true });
                            try {
                                await task.promise;
                                return { page: index + 1, data: canvas.toDataURL('image/jpeg', 0.8).split(',')[1] };
                            } finally {
                                signal?.removeEventListener('abort', cancel);
                            }
                        } catch (error) {
                            signal?.throwIfAborted();
                            console.warn('No se pudo preparar una imagen para el chat:', error.name);
                            return null;
                        }
                    }));
                    return images.filter(Boolean);
                };

                // ============================================================
                // LEGACY FUNCTIONS (Keep for compatibility)
                // ============================================================
                app.captureCurrentPageImage = async function () {
                    try {
                        const panelId = this.splitView?.activePanel || 'primary';
                        const mainViewId = panelId === 'secondary' ? 'mainViewSecondary' : 'mainViewPrimary';
                        const mainView = document.getElementById(mainViewId);
                        const canvas = mainView?.querySelector('canvas');

                        if (!canvas) return null;

                        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
                        return dataUrl.split(',')[1];
                    } catch (error) {
                        console.error('Error capturing page image for AI:', error);
                        return null;
                    }
                };

                app.extractTextFromCurrentPage = async function () {
                    try {
                        const doc = this.getDoc ? this.getDoc() : null;
                        if (!doc || !doc.pages || doc.pages.length === 0) return '';
                        const currentPage = doc.pages[doc.currentIndex];
                        if (!currentPage) return '';

                        // ── 🆕 MEJORA 9: PyMuPDF para texto de página actual ─────────────────
                        if (window.PythonManager?.extractPageText && currentPage.sourceId) {
                            const src = doc.sources[currentPage.sourceId];
                            if (src && src.buffer) {
                                try {
                                    const pyText = await PythonManager.extractPageText(src.buffer, currentPage.pageIndex);
                                    if (pyText && pyText.trim().length > 0) {
                                        console.log(`🐍 PyMuPDF page text: ${pyText.length} chars`);
                                        return pyText;
                                    }
                                } catch (pyErr) {
                                    console.warn("🐍 extractPageText failed, using JS fallback:", pyErr);
                                }
                            }
                        }

                        // ── Fallback 1: texto en el text-layer del DOM ───────────────────────
                        const panelId = this.splitView?.activePanel || 'primary';
                        const overlayId = panelId === 'secondary' ? 'overlay-layer-secondary' : 'overlay-layer';
                        const textLayer = document.querySelector(`#${overlayId}`)?.parentElement?.querySelector('.text-layer');
                        if (textLayer) {
                            const spans = textLayer.querySelectorAll('span');
                            const text = Array.from(spans).map(s => s.textContent).join(' ');
                            if (text.trim()) return text;
                        }

                        // ── Fallback 2: textContent cacheado ────────────────────────────────
                        if (currentPage.textContent) return currentPage.textContent;

                        // ── Fallback 3: PDF.js getTextContent ───────────────────────────────
                        if (currentPage.sourceId && doc.sources && doc.sources[currentPage.sourceId]) {
                            const sourceData = doc.sources[currentPage.sourceId];
                            if (sourceData.buffer && window.pdfjsLib) {
                                const pdf = await pdfjsLib.getDocument({ data: sourceData.buffer }).promise;
                                const page = await pdf.getPage(currentPage.pageIndex + 1);
                                const textContent = await page.getTextContent();
                                return textContent.items.map(item => item.str).join(' ');
                            }
                        }
                        return '';
                    } catch (e) { return ''; }
                };

                // ============================================================
                // ADD CHAT MESSAGE (UI Helper) - ENHANCED
                // ============================================================
                let aiMessageSequence = 0;
                app.addAIChatMessage = function (text, type, record = true) {
                    const chatArea = document.getElementById('ai-chat-area');
                    if (!chatArea) return null;

                    const id = 'ai-msg-' + Date.now() + '-' + ++aiMessageSequence;
                    const msgIndex = this.aiPanelState?.messages?.length || 0;

                    // Save to state (except loading messages)
                    if (record && type !== 'ai-loading' && type !== 'loading' && this.aiPanelState) {
                        this.aiPanelState.messages.push({
                            id: id,
                            type: type === 'user' ? 'user' : 'ai',
                            text: text,
                            timestamp: Date.now()
                        });
                        // Auto-save conversation periodically
                        if (this.aiPanelState.messages.length % 4 === 0) {
                            this.saveAIConversation?.();
                        }
                    }

                    // Type class for CSS
                    let typeClass = 'ai';
                    if (type === 'user') typeClass = 'user';
                    else if (type === 'ai-error' || type === 'error') typeClass = 'ai error';
                    else if (type === 'ai-loading' || type === 'loading') typeClass = 'ai loading';

                    // Process markdown-like formatting in AI responses
                    let displayText = window.escapeHTML(text);
                    if (type === 'ai' || type === 'ai-error') {
                        displayText = displayText
                            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                            .replace(/\*(.*?)\*/g, '<em>$1</em>')
                            .replace(/\n/g, '<br>');
                    }

                    // Add action buttons for AI responses (not loading or error)
                    let actionButtons = '';
                    if (type === 'ai') {
                        actionButtons = `
                            <div class="ai-msg-actions">
                                <button class="ai-msg-action-btn" onclick="app.copyAIMessage(${msgIndex})" title="Copiar">📋 Copiar</button>
                                <button class="ai-msg-action-btn" onclick="app.speakAIMessage(${msgIndex})" title="Leer en voz alta">🔊 Leer</button>
                            </div>
                        `;
                    }

                    const html = `
                        <div id="${id}" class="ai-message ${typeClass}"${this._aiFontSize ? ` style="font-size:${this._aiFontSize}px;padding:${this._aiFontPad || ''}"` : ''}>
                            ${displayText}
                            ${actionButtons}
                        </div>
                    `;

                    chatArea.insertAdjacentHTML('beforeend', html);
                    chatArea.scrollTop = chatArea.scrollHeight;

                    return id;
                };

                // Add CSS for loading animation
                if (!document.getElementById('ai-agent-styles')) {
                    const style = document.createElement('style');
                    style.id = 'ai-agent-styles';
                    style.textContent = `
                        @keyframes pulse {
                            0%, 100% { opacity: 1; }
                            50% { opacity: 0.5; }
                        }
                        @keyframes spin {
                            0% { transform: rotate(0deg); }
                            100% { transform: rotate(360deg); }
                        }
                    `;
                    document.head.appendChild(style);
                }

                try {
                    const savedSize = localStorage.getItem('alioth_ai_font_size');
                    if (savedSize) {
                        app.applyAIFontSize(savedSize);
                    }
                } catch (_) {}

                console.log('✅ AI Agent Functions Ready!');
            }
            // Initialize after app:ready (app.init() ya corrió y emitió el evento)
            if (window._aiFunctionsInitialized) return;
            
            const runInit = () => {
                if (window._aiFunctionsInitialized) return;
                window._aiFunctionsInitialized = true;
                initAIFunctions();
            };

            if (window.__appReady) {
                runInit();
            } else {
                window.addEventListener('app:ready', runInit, { once: true });
            }
        })();
