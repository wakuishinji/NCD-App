/**
 * Lightweight auth utilities for NCD static pages.
 * Handles token storage, automatic refresh, and authorized fetch calls.
 */
(function attachAuthHelpers(global) {
  const STORAGE_KEY = 'ncdAuth';
  const DEFAULT_API_BASE = 'https://ncd-app.altry.workers.dev';
  const EXPIRY_SKEW_MS = 30 * 1000;
  const ROLE_CANONICAL = {
    systemroot: 'systemRoot',
    sysroot: 'systemRoot',
    root: 'systemRoot',
    systemadmin: 'systemAdmin',
    admin: 'clinicAdmin',
    clinicadmin: 'clinicAdmin',
    clinicstaff: 'clinicStaff',
    staff: 'clinicStaff',
  };
  const ROLE_INHERITANCE = {
    systemRoot: ['systemRoot', 'systemAdmin', 'clinicAdmin', 'clinicStaff'],
    systemAdmin: ['systemAdmin', 'clinicAdmin', 'clinicStaff'],
    clinicAdmin: ['clinicAdmin', 'clinicStaff'],
    clinicStaff: ['clinicStaff'],
  };

  let cachedAuth = null;
  let refreshPromise = null;

  function normalizeBase(value) {
    return (value || '').trim().replace(/\/+$/, '');
  }

  function resolveApiBase() {
    const candidates = [];
    if (typeof global.API_BASE_OVERRIDE === 'string') {
      candidates.push(global.API_BASE_OVERRIDE);
    }
    if (typeof global.NCD_API_BASE === 'string') {
      candidates.push(global.NCD_API_BASE);
    }
    try {
      const stored =
        global.localStorage?.getItem('ncdApiBase') ||
        global.localStorage?.getItem('ncdApiBaseUrl');
      if (stored) {
        candidates.push(stored);
      }
    } catch (_) {
      // ignore storage errors (e.g. private mode)
    }
    for (const candidate of candidates) {
      const normalized = normalizeBase(candidate);
      if (normalized) {
        global.NCD_API_BASE = normalized;
        return normalized;
      }
    }
    global.NCD_API_BASE = DEFAULT_API_BASE;
    return DEFAULT_API_BASE;
  }

  function cloneAuth(auth) {
    try {
      return auth ? JSON.parse(JSON.stringify(auth)) : null;
    } catch (_) {
      return auth || null;
    }
  }

  function emitAuthChanged(auth, reason = 'update') {
    if (typeof document === 'undefined' || typeof CustomEvent === 'undefined') {
      return;
    }
    try {
      document.dispatchEvent(
        new CustomEvent('ncd:auth-changed', {
          detail: {
            auth: auth ? cloneAuth(auth) : null,
            reason,
          },
        }),
      );
    } catch (_) {
      // ignore dispatch failures (e.g. during unload)
    }
    try {
      if (global.NcdUserMenu && typeof global.NcdUserMenu.refresh === 'function') {
        global.NcdUserMenu.refresh();
      }
    } catch (_) {
      // ignore refresh failures
    }
  }

  function getStoredAuth() {
    if (cachedAuth) {
      return cachedAuth;
    }
    try {
      const raw = global.localStorage?.getItem(STORAGE_KEY);
      if (!raw) {
        cachedAuth = null;
        return null;
      }
      cachedAuth = JSON.parse(raw);
      return cachedAuth;
    } catch (err) {
      console.warn('[auth] failed to read stored credentials', err);
      try {
        global.localStorage?.removeItem(STORAGE_KEY);
      } catch (_) {}
      cachedAuth = null;
      return null;
    }
  }

  function saveAuth(auth, reason = 'save') {
    if (!auth) {
      clearAuth();
      return;
    }
    cachedAuth = cloneAuth(auth);
    try {
      global.localStorage?.setItem(STORAGE_KEY, JSON.stringify(auth));
    } catch (err) {
      console.warn('[auth] failed to persist credentials', err);
    }
    emitAuthChanged(cachedAuth, reason);
  }

  function clearAuth(reason = 'clear') {
    cachedAuth = null;
    try {
      global.localStorage?.removeItem(STORAGE_KEY);
    } catch (_) {}
    emitAuthChanged(null, reason);
  }

  function normalizeRole(role, fallback = '') {
    const raw = (role ?? '').toString().trim();
    if (!raw) return fallback;
    const canonical = ROLE_CANONICAL[raw.toLowerCase()];
    return canonical || raw;
  }

  function roleIncludes(role, targetRole) {
    const canonical = normalizeRole(role);
    const required = normalizeRole(targetRole);
    if (!canonical || !required) return false;
    const inherited = ROLE_INHERITANCE[canonical] || [canonical];
    return inherited.includes(required);
  }

  function getCurrentRole(auth = getStoredAuth()) {
    if (!auth) return '';
    if (auth.account && auth.account.role) {
      return normalizeRole(auth.account.role);
    }
    if (auth.role) {
      return normalizeRole(auth.role);
    }
    if (auth.tokens && auth.tokens.role) {
      return normalizeRole(auth.tokens.role);
    }
    return '';
  }

  const ROLE_LABELS = {
    systemRoot: 'システムルート管理者',
    systemAdmin: 'システム管理者',
    clinicAdmin: '施設管理者',
    clinicStaff: '施設スタッフ',
  };

  function getRoleLabel(role) {
    if (!role) return '未設定';
    const normalized = normalizeRole(role);
    return ROLE_LABELS[normalized] || normalized;
  }

  const MEMBERSHIP_OVERRIDES = [
    { test: /nakano.*medical.*association/i, label: '中野区医師会' },
  ];

  function humanizeMembership(value) {
    const id = String(value ?? '');
    let core = id.replace(/^membership:/i, '');
    const normalized = core.toLowerCase();

    for (const { test, label } of MEMBERSHIP_OVERRIDES) {
      if (test.test(normalized)) {
        return { id, label };
      }
    }

    const uuidLike = /^[0-9a-f-]{10,}$/i.test(core.replace(/-/g, ''));
    if (uuidLike) {
      return { id, label: `所属コード: ${core}` };
    }

    core = core
      .split(/[-_]/g)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
    return { id, label: core || id };
  }

  function getMembershipLabels(memberships) {
    if (!Array.isArray(memberships) || !memberships.length) {
      return [];
    }
    return memberships.map((value) => humanizeMembership(value));
  }

  function buildAuthError(cause) {
    const error = new Error('AUTH_REQUIRED');
    error.code = 'AUTH_REQUIRED';
    if (cause) error.cause = cause;
    return error;
  }

  function needsRefresh(auth) {
    if (!auth || !auth.tokens || !auth.tokens.accessToken) {
      return true;
    }
    const expiresAt = Date.parse(auth.tokens.accessTokenExpiresAt || '');
    if (!Number.isFinite(expiresAt)) {
      return true;
    }
    return expiresAt - EXPIRY_SKEW_MS <= Date.now();
  }

  async function refreshAuth(existingAuth) {
    const auth = existingAuth || getStoredAuth();
    if (!auth || !auth.tokens || !auth.tokens.refreshToken) {
      throw buildAuthError();
    }
    if (refreshPromise) {
      return refreshPromise;
    }
    const apiBase = resolveApiBase();
    refreshPromise = (async () => {
      try {
        const res = await fetch(`${apiBase}/api/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: auth.tokens.refreshToken }),
        });
        if (!res.ok) {
          throw buildAuthError();
        }
        const data = await res.json();
        if (!data || !data.tokens || !data.tokens.accessToken) {
          throw buildAuthError();
        }
        const updated = cloneAuth({
          ...auth,
          ...('account' in data ? { account: data.account } : {}),
          ...('membership' in data ? { membership: data.membership } : {}),
          tokens: data.tokens,
        });
        saveAuth(updated, 'refresh');
        return updated;
      } catch (err) {
        clearAuth();
        if (err && err.code === 'AUTH_REQUIRED') {
          throw err;
        }
        throw buildAuthError(err);
      } finally {
        refreshPromise = null;
      }
    })();
    return refreshPromise;
  }

  async function ensureAuth(options = {}) {
    const optional = Boolean(options.optional);
    let auth = getStoredAuth();
    if (!auth) {
      if (optional) return null;
      throw buildAuthError();
    }
    if (needsRefresh(auth)) {
      auth = await refreshAuth(auth);
    }
    return auth;
  }

  async function getAuthHeader(options = {}) {
    const optional = Boolean(options.optional);
    try {
      const auth = await ensureAuth({ optional });
      if (!auth || !auth.tokens || !auth.tokens.accessToken) {
        if (optional) return undefined;
        throw buildAuthError();
      }
      return `Bearer ${auth.tokens.accessToken}`;
    } catch (err) {
      if (optional && err.code === 'AUTH_REQUIRED') {
        return undefined;
      }
      throw err;
    }
  }

  function applyHeaders(initHeaders, token) {
    const headers = new Headers(initHeaders || {});
    if (token) {
      headers.set('Authorization', token);
    }
    return headers;
  }

  async function authorizedFetch(url, init = {}, options = {}) {
    const optional = Boolean(options.optional);
    const retry = options.retry !== false;
    let auth = null;
    try {
      auth = await ensureAuth({ optional });
    } catch (err) {
      if (optional && err.code === 'AUTH_REQUIRED') {
        auth = null;
      } else {
        throw err;
      }
    }

    const token = auth?.tokens?.accessToken
      ? `Bearer ${auth.tokens.accessToken}`
      : undefined;

    const makeRequest = (overrideToken) => {
      const headers = applyHeaders(init.headers, overrideToken || token);
      return fetch(url, { ...init, headers });
    };

    let response = await makeRequest();
    if (
      response.status === 401 &&
      retry &&
      auth &&
      auth.tokens &&
      auth.tokens.refreshToken
    ) {
      const refreshed = await refreshAuth(auth);
      const refreshedToken = refreshed?.tokens?.accessToken
        ? `Bearer ${refreshed.tokens.accessToken}`
        : undefined;
      response = await makeRequest(refreshedToken);
    }
    return response;
  }

  async function requireRole(requiredRoles, options = {}) {
    const roles = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];
    const normalizedRoles = roles.map((role) => normalizeRole(role)).filter(Boolean);
    const auth = await ensureAuth({ optional: Boolean(options.optional) });
    if (!normalizedRoles.length) {
      return auth;
    }
    const currentRole = getCurrentRole(auth);
    const authorized = normalizedRoles.some((role) => roleIncludes(currentRole, role));
    if (!authorized) {
      const error = new Error('INSUFFICIENT_ROLE');
      error.code = 'INSUFFICIENT_ROLE';
      throw error;
    }
    return auth;
  }

  async function logout(options = {}) {
    const auth = getStoredAuth();
    const apiBase = resolveApiBase();
    const refreshToken = auth?.tokens?.refreshToken;
    const sessionId = auth?.tokens?.sessionId;
    const payload = {};
    if (refreshToken) {
      payload.refreshToken = refreshToken;
    }
    if (sessionId) {
      payload.sessionId = sessionId;
    }
    if (refreshToken || sessionId) {
      try {
        await fetch(`${apiBase}/api/auth/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch (err) {
        console.warn('[auth] logout request failed', err);
      }
    }
    clearAuth('logout');
    return { ok: true };
  }

  global.NcdAuth = {
    STORAGE_KEY,
    resolveApiBase,
    getStoredAuth,
    saveAuth,
    clearAuth,
    logout,
    ensureAuth,
    refreshAuth,
    getAuthHeader,
    authorizedFetch,
    normalizeRole,
    roleIncludes,
    getCurrentRole,
    getRoleLabel,
    getMembershipLabels,
    requireRole,
    roleHierarchy: ROLE_INHERITANCE,
  };
})(window);
