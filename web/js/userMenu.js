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

  function renderLoggedOut(state) {
    const { node } = state;
    node.innerHTML = `
      <button
        type="button"
        class="inline-flex items-center gap-2 rounded bg-white/10 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        data-user-menu-action="login"
      >
        ログイン
      </button>
    `;
    state.button = node.querySelector('[data-user-menu-action="login"]');
    state.panel = null;
    state.open = false;
    node.setAttribute('data-user-menu-ready', 'true');
  }

  function renderLoggedIn(state, auth) {
    const { node } = state;
    const info = resolveDisplayInfo(auth);
    node.innerHTML = `
      <button
        type="button"
        class="inline-flex items-center gap-2 rounded bg-white/10 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        data-user-menu-action="toggle"
        aria-haspopup="true"
        aria-expanded="false"
      >
        <span class="hidden sm:inline" data-user-menu-label>${escapeHtml(info.displayName || info.email || 'ログイン済み')}</span>
        <span class="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-xs font-bold uppercase">
          ${escapeHtml(info.initials)}
        </span>
      </button>
      <div
        class="absolute right-0 z-30 mt-2 w-60 min-w-[12rem] origin-top-right rounded-md border border-slate-200 bg-white text-slate-700 shadow-lg ring-1 ring-black/5 hidden"
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
      if (typeof document !== 'undefined') {
        const loginEvent = new CustomEvent('ncd:auth-login-request', { detail: { source: 'user-menu' } });
        document.dispatchEvent(loginEvent);
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
    document.addEventListener('ncd:auth-changed', updateAll);
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
