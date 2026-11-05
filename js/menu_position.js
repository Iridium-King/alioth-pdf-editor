(() => {
  const margin = 8;

  window.positionFloatingMenu = function (menu, anchor, viewport) {
    if (!menu || !anchor) return null;
    const v = viewport || window.visualViewport || {
      left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight
    };
    const left = Number.isFinite(v.left) ? v.left : 0;
    const top = Number.isFinite(v.top) ? v.top : 0;
    const right = Number.isFinite(v.right) ? v.right : left + (v.width || window.innerWidth || 0);
    const bottom = Number.isFinite(v.bottom) ? v.bottom : top + (v.height || window.innerHeight || 0);
    const maxWidth = Math.max(0, right - left - margin * 2);
    const maxHeight = Math.max(0, bottom - top - margin * 2);
    const rect = menu.getBoundingClientRect();
    const width = Math.min(rect.width, maxWidth);
    const height = Math.min(rect.height, maxHeight);
    const anchorLeft = Number.isFinite(anchor.left) ? anchor.left : anchor.x;
    const anchorTop = Number.isFinite(anchor.top) ? anchor.top : anchor.y;
    const anchorBottom = Number.isFinite(anchor.bottom) ? anchor.bottom : anchorTop;
    const desiredX = anchorLeft;
    const desiredY = anchorBottom + height > bottom - margin
      ? anchorTop - height - margin
      : anchorBottom;
    const positionedLeft = Math.max(left + margin, Math.min(desiredX, right - width - margin));
    const positionedTop = Math.max(top + margin, Math.min(desiredY, bottom - height - margin));
    menu.style.maxWidth = maxWidth + 'px';
    menu.style.maxHeight = maxHeight + 'px';
    menu.style.overflowY = rect.height > maxHeight ? 'auto' : '';
    menu.style.left = positionedLeft + 'px';
    menu.style.top = positionedTop + 'px';
    return { left: positionedLeft, top: positionedTop, maxWidth, maxHeight };
  };

  window.positionFloatingSubmenu = function (submenu, anchor, viewport) {
    if (!submenu || !anchor) return null;
    const v = viewport || window.visualViewport || { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    const left = Number.isFinite(v.left) ? v.left : 0;
    const top = Number.isFinite(v.top) ? v.top : 0;
    const right = Number.isFinite(v.right) ? v.right : left + (v.width || window.innerWidth || 0);
    const bottom = Number.isFinite(v.bottom) ? v.bottom : top + (v.height || window.innerHeight || 0);
    const maxWidth = Math.max(0, right - left - margin * 2);
    const maxHeight = Math.max(0, bottom - top - margin * 2);
    const rect = submenu.getBoundingClientRect();
    const width = Math.min(rect.width, maxWidth);
    const height = Math.min(rect.height, maxHeight);
    const desiredLeft = anchor.right + width <= right - margin ? anchor.right : anchor.left - width;
    const positionedLeft = Math.max(left + margin, Math.min(desiredLeft, right - width - margin));
    const positionedTop = Math.max(top + margin, Math.min(anchor.top, bottom - height - margin));
    submenu.style.maxWidth = maxWidth + 'px';
    submenu.style.maxHeight = maxHeight + 'px';
    submenu.style.overflowY = rect.height > maxHeight ? 'auto' : '';
    submenu.style.left = positionedLeft + 'px';
    submenu.style.top = positionedTop + 'px';
    return { left: positionedLeft, top: positionedTop, maxWidth, maxHeight };
  };

  window.bindFloatingSubmenus = function (menu) {
    if (!menu || menu._floatingSubmenusBound) return;
    menu._floatingSubmenusBound = true;
    menu.querySelectorAll('.ctx-item > .ctx-submenu').forEach(submenu => {
      const owner = submenu.parentElement;
      let closeTimer = null;
      const close = () => {
        closeTimer = null;
        submenu.style.display = 'none';
        submenu.style.position = '';
        owner.appendChild(submenu);
      };
      const scheduleClose = () => { clearTimeout(closeTimer); closeTimer = setTimeout(close, 90); };
      const open = () => {
        clearTimeout(closeTimer);
        if (submenu.parentElement !== document.body) document.body.appendChild(submenu);
        submenu.style.display = 'flex';
        submenu.style.flexDirection = 'column';
        submenu.style.position = 'fixed';
        window.positionFloatingSubmenu(submenu, owner.getBoundingClientRect());
      };
      owner.addEventListener('mouseenter', open);
      owner.addEventListener('mouseleave', scheduleClose);
      submenu.addEventListener('mouseenter', () => clearTimeout(closeTimer));
      submenu.addEventListener('mouseleave', scheduleClose);
      (menu._floatingSubmenus ||= []).push(close);
    });
  };

  window.closeFloatingSubmenus = function (menu) {
    (menu?._floatingSubmenus || []).forEach(close => close());
    if (menu) { menu._floatingSubmenus = []; menu._floatingSubmenusBound = false; }
  };
})();
