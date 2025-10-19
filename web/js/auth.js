/**
 * Lightweight auth utilities for NCD static pages.
 * Handles token storage, automatic refresh, and authorized fetch calls.
 */
(function attachAuthHelpers(global) {
  const STORAGE_KEY = 'ncdAuth';
  const DEFAULT_API_BASE = 'https://ncd-app.altry.workers.dev';
  const EXPIRY_SKEW_MS = 30 * 1000;

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

  function saveAuth(auth) {
    cachedAuth = cloneAuth(auth);
    try {
      if (!auth) {
        global.localStorage?.removeItem(STORAGE_KEY);
      } else {
        global.localStorage?.setItem(STORAGE_KEY, JSON.stringify(auth));
      }
    } catch (err) {
      console.warn('[auth] failed to persist credentials', err);
    }
  }

  function clearAuth() {
    cachedAuth = null;
    try {
      global.localStorage?.removeItem(STORAGE_KEY);
    } catch (_) {}
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
        saveAuth(updated);
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

  global.NcdAuth = {
    STORAGE_KEY,
    resolveApiBase,
    getStoredAuth,
    saveAuth,
    clearAuth,
    ensureAuth,
    refreshAuth,
    getAuthHeader,
    authorizedFetch,
  };
})(window);
