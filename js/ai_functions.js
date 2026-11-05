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
                            const input = document.getElementById('ai-input');
                            if (input) input.focus();
                        }, 350);
                        // Load current conversation if any
                        this.loadCurrentAIConversation();
                    }
                };

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

                app.sendAIMessage = async function (overrideMessage) {
                    const input = document.getElementById('ai-input');
                    const chatArea = document.getElementById('ai-chat-area');
                    const message = overrideMessage || input.value.trim();

                    if (!message) return;

                    // Check for API key
                    if (!this.geminiApiKey && !window.AliothSecureKeys?.gemini) {
                        this.showApiKeyPrompt();
                        return;
                    }

                    // Add user message to chat
                    this.addAIChatMessage(message, 'user');

                    if (!overrideMessage) {
                        input.value = '';
                        input.style.height = 'auto';
                    }

                    // Add loading indicator
                    const loadingId = this.addAIChatMessage('⏳ Analizando TODO el documento (todas las páginas)...', 'ai-loading');

                    try {
                        const doc = this.getDoc ? this.getDoc() : null;
                        const totalPages = doc?.pages?.length || 0;

                        console.log(`🤖 Iniciando análisis de documento con ${totalPages} páginas`);
                        console.log('📋 Estructura del documento:', {
                            id: doc?.id,
                            totalPages: totalPages,
                            sources: Object.keys(doc?.sources || {})
                        });

                        // Extract text from ALL pages
                        const extractedText = await this.extractTextFromAllPages();

                        console.log('📊 TEXTO EXTRAÍDO:');
                        console.log('  - Total caracteres:', extractedText.length);
                        console.log('  - Primeros 200 chars:', extractedText.substring(0, 200));
                        console.log('  - Últimos 200 chars:', extractedText.substring(extractedText.length - 200));

                        const parts = [];
                        let contextPrefix = "";

                        if (extractedText && extractedText.length > 0) {
                            // Limit to 30,000 characters to avoid token limits
                            const limitedText = extractedText.substring(0, 30000);
                            contextPrefix = `[DOCUMENTO COMPLETO - ${totalPages} páginas - ${extractedText.length} caracteres totales]:\n\n${limitedText}\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nPREGUNTA DEL USUARIO:\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

                            if (extractedText.length > 30000) {
                                contextPrefix += `\n[NOTA: El documento completo tiene ${extractedText.length} caracteres. Mostrando primeros 30,000 para análisis]\n\n`;
                            }
                        } else {
                            console.warn('⚠️ No se pudo extraer texto del documento');
                            contextPrefix = `[DOCUMENTO SIN TEXTO EXTRAÍBLE - ${totalPages} páginas - Posiblemente imágenes escaneadas]\n\n`;
                        }

                        // Add text context + user message
                        parts.push({ text: contextPrefix + message });

                        console.log('📤 Enviando a Gemini:');
                        console.log('  - Contexto: ', contextPrefix.substring(0, 300) + '...');
                        console.log('  - Pregunta:', message);

                        // Decide if we need images based on the message or document type
                        const needsImages = totalPages <= 10 && (
                            message.toLowerCase().includes('imagen') ||
                            message.toLowerCase().includes('visual') ||
                            message.toLowerCase().includes('gráfico') ||
                            message.toLowerCase().includes('foto') ||
                            message.toLowerCase().includes('diagrama') ||
                            !extractedText || extractedText.length < 500 // If little text, probably image-based
                        );

                        if (needsImages) {
                            console.log('📸 Capturando imágenes de todas las páginas...');

                            // Update loading message
                            const loadingEl = document.getElementById(loadingId);
                            if (loadingEl) {
                                loadingEl.innerHTML = `
                                    <div style="display: flex; align-items: center; gap: 10px;">
                                        <div style="width: 20px; height: 20px; border: 3px solid rgba(139, 92, 246, 0.3); border-top-color: #8b5cf6; border-radius: 50%; animation: spin 1s linear infinite;"></div>
                                        <div>Capturando imágenes de ${totalPages} páginas...</div>
                                    </div>
                                `;
                            }

                            const images = await this.captureAllPagesAsImages(10); // Max 10 pages for performance

                            // Add all images to parts
                            for (const img of images) {
                                parts.push({
                                    inline_data: {
                                        mime_type: "image/jpeg",
                                        data: img.data
                                    }
                                });
                            }

                            console.log(`✅ ${images.length} imágenes agregadas al contexto`);
                        } else {
                            console.log('📝 Solo texto - sin captura de imágenes');
                        }

                        // Use Google Gemini API (gemini-3.6-flash - supports multiple images)
                        const response = await fetch(
                            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${this.geminiApiKey}`,
                            {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    contents: [{
                                        parts: parts
                                    }],
                                    generationConfig: {
                                        temperature: 0.7,
                                        maxOutputTokens: 4096 // Increased for more detailed responses
                                    }
                                })
                            }
                        );

                        const data = await response.json();

                        // Remove loading indicator
                        const loadingEl = document.getElementById(loadingId);
                        if (loadingEl) loadingEl.remove();

                        if (data.error) {
                            if (data.error.code === 400 || data.error.code === 403) {
                                localStorage.removeItem('gemini_api_key');
                                this.geminiApiKey = '';
                                this.addAIChatMessage(
                                    '❌ API Key inválida. Por favor ingresa una nueva.',
                                    'ai-error'
                                );
                                this.showApiKeyPrompt();
                            } else {
                                this.addAIChatMessage(
                                    `❌ Error: ${data.error.message}`,
                                    'ai-error'
                                );
                            }
                            return;
                        }

                        // Extract response text
                        const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text ||
                            'No se pudo obtener respuesta.';
                        this.addAIChatMessage(aiText, 'ai');

                    } catch (error) {
                        console.error('Gemini API Error:', error);
                        const loadingEl = document.getElementById(loadingId);
                        if (loadingEl) loadingEl.remove();

                        this.addAIChatMessage(
                            '❌ Error de conexión. Verifica tu internet.',
                            'ai-error'
                        );
                    }
                };

                // ============================================================
                // API KEY MANAGEMENT
                // ============================================================
                app.showApiKeyPrompt = function () {
                    const existingPrompt = document.getElementById('api-key-prompt');
                    if (existingPrompt) existingPrompt.remove();

                    const promptHtml = `
                        <div id="api-key-prompt" style="
                            background: linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(236, 72, 153, 0.2));
                            border: 1px solid #8b5cf6;
                            border-radius: 12px;
                            padding: 16px;
                            margin-bottom: 16px;
                        ">
                            <p style="margin: 0 0 12px 0; font-size: 14px; color: white;">
                                🔑 <strong>API Key requerida</strong><br>
                                <span style="font-size: 12px; opacity: 0.8;">
                                    Obtén tu key gratis en 
                                    <a href="https://aistudio.google.com/apikey" target="_blank" 
                                       style="color: #8b5cf6;">Google AI Studio</a>
                                </span>
                            </p>
                            <div style="display: flex; gap: 8px;">
                                <input type="password" id="gemini-key-input" 
                                    placeholder="Pega tu API key aquí..."
                                    style="
                                        flex: 1;
                                        padding: 10px 12px;
                                        border: 1px solid rgba(139, 92, 246, 0.5);
                                        border-radius: 8px;
                                        background: rgba(0,0,0,0.3);
                                        color: white;
                                        font-size: 13px;
                                    "
                                >
                                <button onclick="app.saveApiKey()" style="
                                    background: linear-gradient(135deg, #8b5cf6, #ec4899);
                                    border: none;
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

                app.saveApiKey = function () {
                    const input = document.getElementById('gemini-key-input');
                    const key = input?.value?.trim();

                    if (key && key.length > 20) {
                        this.geminiApiKey = key;
                        localStorage.setItem('gemini_api_key', key);

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
                app.extractTextFromAllPages = async function () {
                    try {
                        const doc = this.getDoc ? this.getDoc() : null;
                        if (!doc || !doc.pages || doc.pages.length === 0) return '';

                        const totalPages = doc.pages.length;
                        console.log(`📄 Extrayendo texto de ${totalPages} páginas...`);

                        // Extracción local con Poppler y respaldo PyMuPDF / PDF.js.
                        if (window.PythonManager?.extractDocumentText) {
                            try {
                                const sourceIds = [...new Set(doc.pages.map(p => p.sourceId))];
                                // Si todos los sources son el mismo PDF, extraer en una sola llamada
                                if (sourceIds.length === 1) {
                                    const src = doc.sources[sourceIds[0]];
                                    if (src && src.buffer) {
                                        const pyText = await PythonManager.extractDocumentText(src.buffer);
                                        if (pyText && pyText.length > 0) {
                                            console.log(`🐍 PyMuPDF AI context: ${pyText.length} chars extraídos`);
                                            return pyText;
                                        }
                                    }
                                } else {
                                    // Múltiples sources: extraer cada uno y concatenar
                                    let fullText = '';
                                    for (const sid of sourceIds) {
                                        const src = doc.sources[sid];
                                        if (!src || !src.buffer) continue;
                                        const pyText = await PythonManager.extractDocumentText(src.buffer);
                                        if (pyText) fullText += pyText + '\n';
                                    }
                                    if (fullText.trim().length > 0) {
                                        console.log(`🐍 PyMuPDF AI context (multi-source): ${fullText.length} chars`);
                                        return fullText.trim();
                                    }
                                }
                            } catch (pyErr) {
                                console.warn("🐍 extractDocumentText failed, using PDF.js fallback:", pyErr);
                            }
                        }

                        // ── Fallback: PDF.js getTextContent por página ──────────────────────
                        console.log("🔍 Extracción de texto AI con PDF.js (fallback)...");
                        let fullText = '';
                        for (let i = 0; i < totalPages; i++) {
                            const currentPage = doc.pages[i];
                            if (!currentPage) continue;
                            let pageText = '';
                            if (currentPage.textContent && currentPage.textContent.trim()) {
                                pageText = currentPage.textContent;
                            } else if (currentPage.sourceId && doc.sources && doc.sources[currentPage.sourceId]) {
                                try {
                                    const sourceData = doc.sources[currentPage.sourceId];
                                    let pdfDoc = sourceData.doc;
                                    if (!pdfDoc && sourceData.buffer && window.pdfjsLib) {
                                        pdfDoc = await pdfjsLib.getDocument({ data: sourceData.buffer }).promise;
                                        sourceData.doc = pdfDoc;
                                    }
                                    if (pdfDoc) {
                                        const page = await pdfDoc.getPage(currentPage.pageIndex + 1);
                                        const textContent = await page.getTextContent();
                                        pageText = textContent.items.map(item => item.str).join(' ');
                                    }
                                } catch (e) {
                                    console.warn(`⚠️ No se pudo extraer texto de página ${i + 1}:`, e);
                                }
                            }
                            const SEP = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
                            fullText += `\n${SEP}\nPÁGINA ${i + 1} DE ${totalPages}\n${SEP}\n`;
                            fullText += pageText && pageText.trim()
                                ? pageText.trim() + '\n'
                                : '[Esta página no contiene texto extraíble o está en formato imagen]\n';
                        }
                        console.log(`✅ PDF.js fallback: ${fullText.length} chars`);
                        return fullText;
                    } catch (e) {
                        console.error('❌ Error extracting text from all pages:', e);
                        return '';
                    }
                };

                // ============================================================
                // CAPTURE ALL PAGES AS IMAGES (For documents with visual content)
                // ============================================================
                app.captureAllPagesAsImages = async function (maxPages = 10) {
                    try {
                        const doc = this.getDoc();
                        if (!doc || !doc.pages.length) return [];

                        const firstPage = doc.pages[0];
                        const source = doc.sources[firstPage.sourceId];
                        if (!source) return [];

                        const pdfDoc = source.doc || await pdfjsLib.getDocument({ data: source.buffer.slice(0) }).promise;
                        source.doc = pdfDoc;

                        const totalToCapture = Math.min(pdfDoc.numPages, maxPages);
                        const capturePromises = [];

                        for (let i = 1; i <= totalToCapture; i++) {
                            capturePromises.push((async (pageNum) => {
                                const page = await pdfDoc.getPage(pageNum);
                                const viewport = page.getViewport({ scale: 1.0 });
                                const canvas = document.createElement('canvas');
                                canvas.width = viewport.width;
                                canvas.height = viewport.height;
                                const ctx = canvas.getContext('2d');
                                await page.render({ canvasContext: ctx, viewport: viewport }).promise;

                                const base64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
                                return { page: pageNum, data: base64 };
                            })(i));
                        }

                        const images = await Promise.all(capturePromises);
                        return images.sort((a, b) => a.page - b.page);
                    } catch (e) {
                        console.error('Capture Error:', e);
                        return [];
                    }
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
                app.addAIChatMessage = function (text, type) {
                    const chatArea = document.getElementById('ai-chat-area');
                    if (!chatArea) return null;

                    const id = 'ai-msg-' + Date.now();
                    const msgIndex = this.aiPanelState?.messages?.length || 0;

                    // Save to state (except loading messages)
                    if (type !== 'ai-loading' && type !== 'loading' && this.aiPanelState) {
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
                        #ai-input:focus {
                            border-color: #8b5cf6 !important;
                            box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.2) !important;
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
