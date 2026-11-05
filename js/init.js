        (function () {
            var _isProxy = (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost' || window.location.hostname === 'alioth.localhost');
            if (!_isProxy) return;
            var _orig = window.fetch;
            window.fetch = function (url, opts) {
                var u = String(url);
                var isAiRequest = /generativelanguage\.googleapis\.com|api\.groq\.com|api\.mistral\.ai|api-inference\.huggingface\.co|openrouter\.ai|integrate\.api\.nvidia\.com|api\.openai\.com|api\.elevenlabs\.io|\/groq\/|\/api\/tts|\/data-extract|convert-pdf-to-.*-ai/.test(u);
                if (isAiRequest && !window.aliothLegal?.isAiEnabled(window.localStorage)) {
                    return Promise.reject(new Error('AI notice has not been accepted; choose an AI data mode first.'));
                }
                // Gemini → proxy local (MANTIENE la API key del usuario para que el proxy la use)
                if (u.startsWith('https://generativelanguage.googleapis.com/v1beta/')) {
                    var path = u.replace('https://generativelanguage.googleapis.com', '');
                    return _orig(window.location.origin + path, opts);
                }
                // Groq → proxy local (MANTIENE Authorization para que el proxy la use)
                if (u.startsWith('https://api.groq.com/')) {
                    var groqPath = '/groq' + u.replace('https://api.groq.com', '');
                    return _orig(window.location.origin + groqPath, opts);
                }
                // Google Fonts CSS y gstatic → proxy local (evita CORS en localhost)
                if (u.startsWith('https://fonts.googleapis.com/') || u.startsWith('https://fonts.gstatic.com/')) {
                    return _orig(window.location.origin + '/gfonts?url=' + encodeURIComponent(u), opts);
                }
                return _orig(url, opts);
            };
            console.log('🔀 [Proxy] Interceptor activo — Gemini y Groq redirigidos a localhost');
        })();
        window.AliothSecureKeys = {};
        fetch('/api/secure-credentials/status').then(r => r.ok ? r.json() : null).then(data => {
            window.AliothSecureKeys = data?.providers || {};
        }).catch(() => {});
        window.addEventListener('DOMContentLoaded', async function () {
            const providers = ['gemini', 'groq', 'mistral', 'huggingface', 'openrouter', 'nvidia', 'fishaudio'];
            for (const provider of providers) {
                const key = localStorage.getItem(provider + '_api_key') || (provider === 'fishaudio' ? localStorage.getItem('alioth_tts_key_fishaudio') : '');
                if (!key) continue;
                try {
                    const r = await fetch('/api/secure-credentials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, key }) });
                    if (r.ok) { localStorage.removeItem(provider + '_api_key'); if (provider === 'fishaudio') localStorage.removeItem('alioth_tts_key_fishaudio'); }
                } catch (_) {}
            }
            const azureKey = localStorage.getItem('azure_api_key');
            if (azureKey) {
                try {
                    const r = await fetch('/api/secure-credentials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'azure', key: azureKey, endpoint: localStorage.getItem('azure_endpoint') || '' }) });
                    if (r.ok) { localStorage.removeItem('azure_api_key'); localStorage.removeItem('azure_endpoint'); }
                } catch (_) {}
            }
        });

        // HTML escaping utility to prevent XSS in UI rendering
        window.escapeHTML = function(str) {
            if (str === null || str === undefined) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        };

        // Web Crypto API helper for PBKDF2 key derivation and AES-GCM 256 encryption/decryption
        window.CryptoHelper = {
            // Generate a random 16-byte salt and return it as a Base64 string
            generateSalt: function() {
                var salt = window.crypto.getRandomValues(new Uint8Array(16));
                var binary = '';
                for (var i = 0; i < salt.length; i++) {
                    binary += String.fromCharCode(salt[i]);
                }
                return btoa(binary);
            },

            // Derive a 256-bit AES-GCM key from password and Base64 salt using PBKDF2 (100,000 iterations)
            deriveKey: async function(password, saltBase64) {
                var encoder = new TextEncoder();
                var pwBytes = encoder.encode(password);
                
                var binarySalt = atob(saltBase64);
                var saltBytes = new Uint8Array(binarySalt.length);
                for (var i = 0; i < binarySalt.length; i++) {
                    saltBytes[i] = binarySalt.charCodeAt(i);
                }

                var baseKey = await window.crypto.subtle.importKey(
                    'raw',
                    pwBytes,
                    { name: 'PBKDF2' },
                    false,
                    ['deriveKey']
                );

                return await window.crypto.subtle.deriveKey(
                    {
                        name: 'PBKDF2',
                        salt: saltBytes,
                        iterations: 100000,
                        hash: 'SHA-256'
                    },
                    baseKey,
                    { name: 'AES-GCM', length: 256 },
                    false,
                    ['encrypt', 'decrypt']
                );
            },

            // Encrypt string, object, or binary data using AES-GCM with derived key and a random 12-byte IV
            encrypt: async function(key, data) {
                var encoder = new TextEncoder();
                var bytesToEncrypt;
                if (typeof data === 'string') {
                    bytesToEncrypt = encoder.encode(data);
                } else if (data instanceof Uint8Array) {
                    bytesToEncrypt = data;
                } else if (data instanceof ArrayBuffer) {
                    bytesToEncrypt = new Uint8Array(data);
                } else {
                    bytesToEncrypt = encoder.encode(JSON.stringify(data));
                }

                var iv = window.crypto.getRandomValues(new Uint8Array(12));
                var encryptedBuffer = await window.crypto.subtle.encrypt(
                    {
                        name: 'AES-GCM',
                        iv: iv
                    },
                    key,
                    bytesToEncrypt
                );

                var encryptedBytes = new Uint8Array(encryptedBuffer);
                var combined = new Uint8Array(iv.length + encryptedBytes.length);
                combined.set(iv, 0);
                combined.set(encryptedBytes, iv.length);

                var binary = '';
                for (var i = 0; i < combined.length; i++) {
                    binary += String.fromCharCode(combined[i]);
                }
                return btoa(binary);
            },

            // Decrypt using AES-GCM with derived key. outputType can be 'string', 'binary' (Uint8Array), or 'json'.
            decrypt: async function(key, cipherBase64, outputType) {
                var binary = atob(cipherBase64);
                var combined = new Uint8Array(binary.length);
                for (var i = 0; i < binary.length; i++) {
                    combined[i] = binary.charCodeAt(i);
                }

                var iv = combined.slice(0, 12);
                var encryptedBytes = combined.slice(12);

                var decryptedBuffer = await window.crypto.subtle.decrypt(
                    {
                        name: 'AES-GCM',
                        iv: iv
                    },
                    key,
                    encryptedBytes
                );

                if (outputType === 'binary') {
                    return new Uint8Array(decryptedBuffer);
                }

                var decoder = new TextDecoder();
                var decryptedStr = decoder.decode(decryptedBuffer);

                if (outputType === 'string' || outputType === true) {
                    return decryptedStr;
                } else {
                    return JSON.parse(decryptedStr);
                }
            },

            // Generate a 12-word recovery seed using a clean Spanish dictionary for ease of use
            generateRecoverySeed: function() {
                var words = [
                    'sol', 'luna', 'estrella', 'nube', 'lluvia', 'viento', 'mar', 'rio', 'lago', 'monte',
                    'arbol', 'flor', 'hoja', 'raiz', 'semilla', 'fruta', 'tierra', 'piedra', 'arena', 'oro',
                    'plata', 'cobre', 'hierro', 'fuego', 'agua', 'aire', 'luz', 'sombra', 'calor', 'frio',
                    'verde', 'azul', 'rojo', 'amarillo', 'blanco', 'negro', 'gris', 'cafe', 'rosa', 'trigo',
                    'ave', 'pez', 'lobo', 'oso', 'leon', 'tigre', 'zorro', 'aguila', 'buho', 'cisne',
                    'casa', 'puerta', 'ventana', 'llave', 'libro', 'lapiz', 'papel', 'mapa', 'reloj', 'campana',
                    'camino', 'puente', 'torre', 'barco', 'vela', 'timon', 'ancla', 'red', 'cofre', 'corona',
                    'pan', 'sal', 'dulce', 'miel', 'leche', 'queso', 'trigo', 'arroz', 'maiz', 'fruto',
                    'bueno', 'libre', 'puro', 'noble', 'sabio', 'fuerte', 'alegre', 'calido', 'suave', 'claro',
                    'cantar', 'sonar', 'volar', 'correr', 'crear', 'mirar', 'sentir', 'abrir', 'guiar', 'cuidar'
                ];
                // Remove duplicates
                words = Array.from(new Set(words));
                var seedWords = [];
                var randomValues = new Uint32Array(12);
                window.crypto.getRandomValues(randomValues);
                for (var i = 0; i < 12; i++) {
                    var idx = randomValues[i] % words.length;
                    seedWords.push(words[idx]);
                }
                return seedWords.join(' ');
            }
        };
