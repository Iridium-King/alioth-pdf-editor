        (function () {
            var _widgetReady = false;

            function initZoomWidget() {
                if (_widgetReady) return;
                if (!window.app || typeof app.zoom !== 'function' || typeof app.zoomPanel !== 'function') return;
                _widgetReady = true;

                var slider = document.getElementById('zoomSlider');
                var input = document.getElementById('zoomInput');

                var zoomWidgetEl = document.getElementById('zoom-widget') || slider?.closest('[id*="zoom"]');
                if (zoomWidgetEl) {
                    var _zStyle = window.getComputedStyle(zoomWidgetEl);
                }                /* Slider → zoom */
                slider.addEventListener('input', function () {
                    app.zoom(parseInt(this.value) / 100 - app.currentScale);
                });

                /* Input → zoom */
                function applyInput() {
                    var n = parseInt((input.value || '').replace('%', ''));
                    if (!isNaN(n) && n > 0) app.zoom(n / 100 - app.currentScale);
                }
                input.addEventListener('change', applyInput);
                input.addEventListener('keydown', function (e) {
                    if (e.key === 'Enter') { applyInput(); this.blur(); }
                });

                /* Botones */
                document.getElementById('zoomBtnPlus').addEventListener('click', function () { app.zoom(0.1); });
                document.getElementById('zoomBtnMinus').addEventListener('click', function () { app.zoom(-0.1); });
                document.getElementById('zoomBtnReset').addEventListener('click', function () { app.zoom(1.0 - app.currentScale); });
                document.getElementById('zoomBtnFit').addEventListener('click', function () {
                    var panelId = (app.splitView && app.splitView.activePanel) || 'primary';
                    var doc = app.getDoc();
                    if (!doc || !doc.pages.length) return;
                    var suffix = panelId === 'secondary' ? 'Secondary' : 'Primary';
                    var mainView = document.getElementById('mainView' + suffix);
                    if (!mainView) return;

                    var isH = document.body.classList.contains('h-layout');
                    var containerW = mainView.clientWidth - 32;
                    var containerH = mainView.clientHeight - 48; // padding/margin
                    var pData = doc.pages[doc.currentIndex];
                    var src = doc.sources[pData.sourceId];

                    if (src && src.doc) {
                        src.doc.getPage(pData.pageIndex + 1).then(function (page) {
                            var rot = (page.rotate + pData.rotation) % 360;
                            var vp = page.getViewport({ scale: 1.0, rotation: rot });
                            var isRotated = rot === 90 || rot === 270;
                            var actualWidth = isRotated ? vp.height : vp.width;
                            var actualHeight = isRotated ? vp.width : vp.height;

                            var totalWidth = (app.isTwoUpView && !isH) ? (actualWidth * 2 + 24) : actualWidth;
                            var scaleTarget = isH
                                ? Math.max(0.2, Math.min(5.0, containerH / actualHeight))
                                : Math.max(0.2, Math.min(5.0, containerW / totalWidth));

                            var delta = scaleTarget - app.currentScale;
                            if (Math.abs(delta) > 0.001) app.zoom(delta);
                            // Centrar horizontalmente en modo vertical tras el render
                            if (!isH) {
                                setTimeout(function () {
                                    if (mainView) mainView.scrollLeft = Math.max(0, (mainView.scrollWidth - mainView.clientWidth) / 2);
                                }, 350);
                            }
                        });
                    } else {
                        var cvsSuffix = panelId === 'secondary' ? '-secondary' : '';
                        var cvs = document.getElementById('the-canvas' + cvsSuffix);
                        if (!cvs) return;

                        var isTwoUp = app.isTwoUpView && !isH;
                        var targetDim = isH ? containerH : containerW;
                        var cvsDim = isH ? (cvs.height / app.currentScale) : ((cvs.width / app.currentScale) * (isTwoUp ? 2 : 1) + (isTwoUp ? 24 : 0));
                        var delta = (targetDim / cvsDim) - app.currentScale;
                        if (Math.abs(delta) > 0.001) app.zoom(delta);
                        // Centrar horizontalmente en modo vertical tras el render
                        if (!isH) {
                            setTimeout(function () {
                                if (mainView) mainView.scrollLeft = Math.max(0, (mainView.scrollWidth - mainView.clientWidth) / 2);
                            }, 350);
                        }
                    }
                });

                /* Sincronizar widget tras cada zoom — hook via app.zoom only */
                var _origZoom = app.zoom.bind(app);
                app.zoom = function (delta) {
                    _origZoom(delta);
                    syncWidget();
                };

                function syncWidget() {
                    var pct = Math.round(app.currentScale * 100);
                    slider.value = Math.max(20, Math.min(500, pct));
                    input.value = pct + '%';
                }
                syncWidget();
            }

            /* Esperar a que app esté lista via evento app:ready */
            if (window.__appReady) {
                initZoomWidget();
            } else {
                window.addEventListener('app:ready', initZoomWidget, { once: true });
            }
        })();
