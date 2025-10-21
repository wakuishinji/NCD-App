/**
 * Lightweight user menu controller.
 * Renders login / account dropdowns into elements marked with [data-user-menu].
 */
(function attachUserMenu(global) {
  if (global.NcdUserMenu) {
    return;
  }

  const states = new Map();
  const STORAGE_KEY = (global.NcdAuth && global.NcdAuth.STORAGE_KEY) || 'ncdAuth';

  let noticeHideTimer = null;
  let noticeRemoveTimer = null;

  const NOTICE_TYPE_CLASS_MAP = {
    info: ['bg-slate-900/90', 'text-white'],
    success: ['bg-emerald-600', 'text-white'],
    error: ['bg-red-600', 'text-white'],
  };

  const VARIANT_CLASSES = {
    dark: {
      button: 'inline-flex items-center gap-2 rounded bg-white/10 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 transition',
      avatar: 'inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-xs font-bold uppercase',
      menu: 'absolute right-0 z-30 mt-2 w-60 min-w-[12rem] origin-top-right rounded-md border border-slate-200 bg-white text-slate-700 shadow-lg ring-1 ring-black/5 hidden',
      login: 'inline-flex items-center gap-2 rounded bg-white/10 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 transition',
    },
    light: {
      button: 'inline-flex items-center gap-2 rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 transition',
      avatar: 'inline-flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-xs font-bold uppercase text-blue-700',
      menu: 'absolute right-0 z-30 mt-2 w-60 min-w-[12rem] origin-top-right rounded-md border border-slate-200 bg-white text-slate-700 shadow-lg ring-1 ring-black/5 hidden',
      login: 'inline-flex items-center gap-2 rounded border border-blue-500 bg-blue-500 px-3 py-1.5 text-sm font-semibold text-white shadow hover:bg-blue-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 transition',
    },
  };

  function ensureNoticeElement() {
    if (typeof document === 'undefined') {
      return null;
    }
    let el = document.querySelector('[data-user-menu-notice]');
    if (!el) {
      el = document.createElement('div');
      el.dataset.userMenuNotice = 'true';
      el.classList.add(
        'fixed',
        'top-4',
        'right-4',
        'z-50',
        'rounded-md',
        'px-3',
        'py-2',
        'text-sm',
        'font-semibold',
        'shadow-lg',
        'transition-opacity',
        'duration-200',
        'pointer-events-none',
        'hidden',
      );
      el.style.opacity = '0';
      if (document.body) {
        document.body.appendChild(el);
      }
    }
    return el;
  }

  function showNotice(text, type = 'info') {
    if (!text) return;
    const el = ensureNoticeElement();
    if (!el) return;
    if (noticeHideTimer) {
      clearTimeout(noticeHideTimer);
      noticeHideTimer = null;
    }
    if (noticeRemoveTimer) {
      clearTimeout(noticeRemoveTimer);
      noticeRemoveTimer = null;
    }
    const prevType = el.dataset.noticeType;
    if (prevType && NOTICE_TYPE_CLASS_MAP[prevType]) {
      el.classList.remove(...NOTICE_TYPE_CLASS_MAP[prevType]);
    }
    const nextType = NOTICE_TYPE_CLASS_MAP[type] ? type : 'info';
    el.classList.add(...NOTICE_TYPE_CLASS_MAP[nextType]);
    el.dataset.noticeType = nextType;
    el.textContent = text;
    el.classList.remove('hidden');
    el.style.opacity = '1';
    noticeHideTimer = setTimeout(() => {
      el.style.opacity = '0';
      noticeRemoveTimer = setTimeout(() => {
        el.classList.add('hidden');
        el.style.opacity = '1';
      }, 250);
    }, 2200);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function resolveAuth() {
    if (!global.NcdAuth || typeof global.NcdAuth.getStoredAuth !== 'function') {
      return null;
    }
    try {
      return global.NcdAuth.getStoredAuth();
    } catch (_) {
      return null;
    }
  }

  function resolveDisplayInfo(auth) {
    if (!auth || typeof auth !== 'object') {
      return {
        displayName: '',
        email: '',
        role: '',
        accountId: '',
        initials: '?',
      };
    }
    const profile = auth.account && typeof auth.account === 'object' ? auth.account.profile || {} : {};
    const displayName =
      (profile && (profile.displayName || profile.name)) ||
      auth.account?.primaryEmail ||
      auth.account?.loginId ||
      auth.account?.id ||
      '';
    const email = auth.account?.primaryEmail || auth.account?.loginId || '';
    const role =
      (global.NcdAuth && typeof global.NcdAuth.getCurrentRole === 'function'
        ? global.NcdAuth.getCurrentRole(auth)
        : auth.account?.role) || '';
    const accountId = auth.account?.id || '';
    const initialsSource = displayName || email || accountId || '？';
    const initials = (Array.from(initialsSource.trim())[0] || '？').toUpperCase();
    return { displayName, email, role, accountId, initials };
  }
  function resolveVariant(node) {
    if (!node) return 'dark';
    const attr = node.getAttribute('data-user-menu-variant');
    if (attr && VARIANT_CLASSES[attr]) {
      return attr;
    }
    return 'dark';
  }


  function renderLoggedOut(state) {
    const { node } = state;
    const variant = resolveVariant(node);
    const classes = VARIANT_CLASSES[variant] || VARIANT_CLASSES.dark;
    node.innerHTML = `
      <div class="flex items-center gap-2">
        <span class="inline-flex items-center rounded-full bg-slate-200 px-2 py-1 text-xs font-semibold text-slate-600">未ログイン</span>
        <button
        type="button"
        class="${classes.login}"
        data-user-menu-action="login"
      >
        ログイン
      </button>
      </div>
    `;
    state.button = node.querySelector('[data-user-menu-action="login"]');
    state.panel = null;
    state.open = false;
    node.setAttribute('data-user-menu-ready', 'true');
  }

  function renderLoggedIn(state, auth) {
    const { node } = state;
    const info = resolveDisplayInfo(auth);
    const variant = resolveVariant(node);
    const classes = VARIANT_CLASSES[variant] || VARIANT_CLASSES.dark;
    node.innerHTML = `
      <button
        type="button"
        class="${classes.button}"
        data-user-menu-action="toggle"
        aria-haspopup="true"
        aria-expanded="false"
      >
        <span class="hidden sm:inline" data-user-menu-label>${escapeHtml(info.displayName || info.email || 'ログイン済み')}</span>
        <span class="${classes.avatar}">
          ${escapeHtml(info.initials)}
        </span>
      </button>
      <div
        class="${classes.menu}"
        data-user-menu-panel
        role="menu"
        aria-hidden="true"
      >
        <div class="border-b border-slate-200 px-4 py-3">
          <p class="text-sm font-semibold text-slate-800">${escapeHtml(info.displayName || info.email || 'ログイン済み')}</p>
          ${info.email ? `<p class="mt-1 text-xs text-slate-500">${escapeHtml(info.email)}</p>` : ''}
          ${info.role ? `<p class="mt-1 text-xs text-slate-500">ロール: ${escapeHtml(info.role)}</p>` : ''}
        </div>
        <nav class="flex flex-col gap-1 px-2 py-2">
          <a
            href="/auth/account.html"
            class="inline-flex items-center gap-2 rounded px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900"
            data-user-menu-action="profile"
          >
            アカウント詳細
          </a>
          <button
            type="button"
            class="inline-flex items-center gap-2 rounded px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900"
            data-user-menu-action="logout"
          >
            ログアウト
          </button>
        </nav>
      </div>
    `;
    state.button = node.querySelector('[data-user-menu-action="toggle"]');
    state.panel = node.querySelector('[data-user-menu-panel]');
    state.open = false;
    node.setAttribute('data-user-menu-ready', 'true');
  }

  function renderState(state, auth) {
    if (!auth || !auth.tokens || !auth.tokens.accessToken) {
      renderLoggedOut(state);
    } else {
      renderLoggedIn(state, auth);
    }
  }

  function closeState(state) {
    if (!state.open) return;
    state.open = false;
    if (state.panel) state.panel.classList.add('hidden');
    if (state.button) state.button.setAttribute('aria-expanded', 'false');
  }

  function openState(state) {
    if (!state.panel || !state.button) return;
    state.open = true;
    state.panel.classList.remove('hidden');
    state.button.setAttribute('aria-expanded', 'true');
  }

  function closeAll(except) {
    states.forEach((state) => {
      if (state === except) return;
      closeState(state);
    });
  }

  function handleContainerClick(event, state) {
    const target = event.target.closest('[data-user-menu-action]');
    if (!target || !state.node.contains(target)) {
      return;
    }
    const action = target.dataset.userMenuAction;
    if (!action) {
      return;
    }

    if (action === 'toggle') {
      event.preventDefault();
      const next = !state.open;
      closeAll(state);
      if (next) {
        openState(state);
      }
      return;
    }

    if (action === 'login') {
      event.preventDefault();
      closeAll();
      const loginHref = state.node?.getAttribute('data-user-menu-login') || '/auth/login.html';
      try {
        global.location.href = loginHref;
      } catch (_) {
        window.location.href = loginHref;
      }
      return;
    }

    if (action === 'logout') {
      event.preventDefault();
      closeAll();
      if (global.NcdAuth && typeof global.NcdAuth.logout === 'function') {
        global.NcdAuth.logout().catch((err) => {
          console.warn('[userMenu] logout failed', err);
        });
      } else {
        try {
          global.localStorage?.removeItem(STORAGE_KEY);
        } catch (_) {
          // ignore storage errors
        }
      }
      return;
    }

    if (action === 'profile') {
      closeAll();
    }
  }

  function handleDocumentClick(event) {
    const target = event.target;
    for (const state of states.values()) {
      if (state.node.contains(target)) {
        return;
      }
    }
    closeAll();
  }

  function handleKeydown(event) {
    if (event.key === 'Escape') {
      closeAll();
    }
  }

  function updateAll() {
    const auth = resolveAuth();
    states.forEach((state) => {
      const wasOpen = state.open;
      renderState(state, auth);
      if (wasOpen) {
        openState(state);
      }
    });
  }

  function handleAuthChanged(event) {
    updateAll();
    const reason = event && event.detail ? event.detail.reason : undefined;
    if (reason === 'save') {
      showNotice('ログインしました', 'success');
    } else if (reason === 'logout') {
      showNotice('ログアウトしました', 'info');
    }
  }

  function initNodes() {
    const nodes = document.querySelectorAll('[data-user-menu]');
    nodes.forEach((node) => {
      if (states.has(node)) {
        return;
      }
      const state = {
        node,
        button: null,
        panel: null,
        open: false,
      };
      states.set(node, state);
      node.classList.add('relative');
      node.addEventListener('click', (event) => handleContainerClick(event, state));
    });
    updateAll();
  }

  function handleStorageEvent(event) {
    if (event.key && event.key !== STORAGE_KEY) {
      return;
    }
    updateAll();
  }

  function bootstrap() {
    initNodes();
    document.addEventListener('click', handleDocumentClick);
    document.addEventListener('keydown', handleKeydown);
    document.addEventListener('ncd:auth-changed', handleAuthChanged);
    window.addEventListener('storage', handleStorageEvent);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  } else {
    bootstrap();
  }

  global.NcdUserMenu = {
    refresh: updateAll,
  };
})(window);
