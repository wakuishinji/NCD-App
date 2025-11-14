/**
 * Lightweight auth utilities for NCD static pages.
 * Handles token storage, automatic refresh, and authorized fetch calls.
 */
(function attachAuthHelpers(global) {
  const STORAGE_KEY = 'ncdAuth';
  const WORKERS_API_BASE = 'https://ncd-app.altry.workers.dev';
  const DEFAULT_API_BASE = WORKERS_API_BASE;
  const EXPIRY_SKEW_MS = 30 * 1000;
  const ROLE_CANONICAL = {
    systemroot: 'systemRoot',
    sysroot: 'systemRoot',
    root: 'systemRoot',
    systemadmin: 'systemAdmin',
    adminreviewer: 'adminReviewer',
    reviewer: 'adminReviewer',
    organizationadmin: 'organizationAdmin',
    municipaladmin: 'organizationAdmin',
    admin: 'clinicAdmin',
    clinicadmin: 'clinicAdmin',
    clinicstaff: 'clinicStaff',
    staff: 'clinicStaff',
  };
  const ROLE_INHERITANCE = {
    systemRoot: ['systemRoot', 'systemAdmin', 'organizationAdmin', 'adminReviewer', 'clinicAdmin', 'clinicStaff'],
    systemAdmin: ['systemAdmin', 'organizationAdmin', 'adminReviewer', 'clinicAdmin', 'clinicStaff'],
    organizationAdmin: ['organizationAdmin', 'clinicAdmin', 'clinicStaff'],
    adminReviewer: ['adminReviewer', 'clinicStaff'],
    clinicAdmin: ['clinicAdmin', 'clinicStaff'],
    clinicStaff: ['clinicStaff'],
  };

  let cachedAuth = null;
  let refreshPromise = null;

  function normalizeBase(value) {
    return (value || '').trim().replace(/\/+$/, '');
  }

  function resolveApiBase() {
    const forcedHosts = new Set(['ncd.altry.net', 'www.ncd.altry.net']);
    try {
      const currentHost = (global.location?.hostname || '').toLowerCase();
      if (forcedHosts.has(currentHost)) {
        global.NCD_API_BASE = WORKERS_API_BASE;
        try {
          global.localStorage?.removeItem('ncdApiBase');
          global.localStorage?.removeItem('ncdApiBaseUrl');
        } catch (_) {}
        return WORKERS_API_BASE;
      }
    } catch (_) {
      // ignore location access errors
    }

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
    const isBlocked = (value) => {
      try {
        const url = new URL(value);
        return forcedHosts.has(url.hostname.toLowerCase());
      } catch (_) {
        return false;
      }
    };

    for (const candidate of candidates) {
      const normalized = normalizeBase(candidate);
      if (normalized && !isBlocked(normalized)) {
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
    organizationAdmin: '自治体管理者',
    adminReviewer: '申請レビュアー',
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

  function normalizeMembershipList(value) {
    if (!Array.isArray(value)) return [];
    const result = [];
    const seen = new Set();
    value.forEach((entry) => {
      const text = (entry ?? '').toString().trim();
      if (!text || seen.has(text)) return;
      seen.add(text);
      result.push(text);
    });
    return result;
  }

  function normalizeMembershipRecord(entry) {
    if (!entry) return null;
    if (typeof entry === 'string') {
      const id = entry.trim();
      if (!id) return null;
      return {
        id,
        clinicId: null,
        roles: [],
        primaryRole: '',
        status: 'active',
        label: '',
      };
    }
    if (typeof entry !== 'object') {
      return null;
    }
    const id = (entry.id || entry.membershipId || '').toString().trim();
    if (!id) return null;
    const clinicId = entry.clinicId ? String(entry.clinicId).trim() : null;
    const clinicName = typeof entry.clinicName === 'string' ? entry.clinicName.trim() : '';
    const status = (entry.status || 'active').toString().trim() || 'active';
    const rawRoles = Array.isArray(entry.roles) ? entry.roles : [];
    const normalizedRoles = rawRoles
      .map((role) => normalizeRole(role))
      .filter(Boolean);
    const primaryRole = normalizeRole(entry.primaryRole || normalizedRoles[0] || '');
    const dedupedRoles = Array.from(new Set(primaryRole ? [primaryRole, ...normalizedRoles] : normalizedRoles));
    const label = typeof entry.label === 'string' ? entry.label.trim() : '';
    const organizationId = entry.organizationId ? String(entry.organizationId).trim() : null;
    const organizationName = typeof entry.organizationName === 'string' ? entry.organizationName.trim() : '';
    const departments = normalizeMembershipList(entry.departments);
    const committees = normalizeMembershipList(entry.committees);
    const groups = normalizeMembershipList(entry.groups);
    const meta = entry.meta && typeof entry.meta === 'object' ? entry.meta : null;
    return {
      id,
      clinicId,
      clinicName: clinicName || '',
      roles: dedupedRoles,
      primaryRole: primaryRole || (dedupedRoles.length ? dedupedRoles[0] : ''),
      status,
      invitedBy: entry.invitedBy || null,
      organizationId,
      organizationName,
      departments,
      committees,
      groups,
      createdAt: entry.createdAt || null,
      updatedAt: entry.updatedAt || null,
      meta,
      label,
      raw: entry,
    };
  }

  function collectMembershipSources(auth) {
    const sources = [];
    if (!auth || typeof auth !== 'object') {
      return sources;
    }
    if (Array.isArray(auth.account?.memberships)) {
      sources.push(auth.account.memberships);
    }
    if (Array.isArray(auth.memberships)) {
      sources.push(auth.memberships);
    }
    if (auth.membership) {
      sources.push([auth.membership]);
    }
    if (Array.isArray(auth.account?.membershipIds)) {
      sources.push(auth.account.membershipIds);
    }
    return sources;
  }

  function getMemberships(auth = getStoredAuth()) {
    const sources = collectMembershipSources(auth);
    if (!sources.length) return [];
    const seen = new Set();
    const result = [];
    for (const list of sources) {
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        const normalized = normalizeMembershipRecord(item);
        if (!normalized || !normalized.id || seen.has(normalized.id)) continue;
        seen.add(normalized.id);
        result.push(normalized);
      }
    }
    return result;
  }

  function getMembershipForClinic(clinicId, auth = getStoredAuth()) {
    if (!clinicId) return null;
    const target = String(clinicId).trim();
    if (!target) return null;
    const memberships = getMemberships(auth);
    return memberships.find((entry) => (entry.clinicId || '').trim() === target) || null;
  }

  function hasClinicRole(clinicId, targetRole, options = {}) {
    const auth = options.auth || getStoredAuth();
    const normalizedRole = normalizeRole(targetRole);
    if (!normalizedRole) return false;
    const currentRole = getCurrentRole(auth);
    if (roleIncludes(currentRole, 'systemAdmin') || roleIncludes(currentRole, 'systemRoot')) {
      return true;
    }
    if (!clinicId) {
      return roleIncludes(currentRole, normalizedRole);
    }
    const membership = getMembershipForClinic(clinicId, auth);
    if (!membership) {
      if (options.fallbackToGlobal === false) {
        return false;
      }
      return roleIncludes(currentRole, normalizedRole);
    }
    if (membership.status && membership.status !== 'active') {
      return false;
    }
    const candidateRoles = membership.roles && membership.roles.length
      ? membership.roles
      : membership.primaryRole
        ? [membership.primaryRole]
        : [];
    return candidateRoles.some((role) => roleIncludes(role, normalizedRole));
  }

  function humanizeMembership(value) {
    const entry = typeof value === 'object' && value && value.id
      ? value
      : normalizeMembershipRecord(value);
    if (!entry) {
      return { id: '', label: '' };
    }
    const id = entry.id || '';
    const candidates = [
      entry.label,
      entry.clinicName,
      entry.organizationName,
      entry.raw?.label,
      entry.raw?.clinicName,
      entry.raw?.organizationName,
      entry.clinicId,
    ].map((candidate) => (candidate || '').toString().trim()).filter(Boolean);

    if (!candidates.length) {
      let core = id.replace(/^membership:/i, '');
      const normalized = core.toLowerCase();
      for (const { test, label } of MEMBERSHIP_OVERRIDES) {
        if (test.test(normalized)) {
          return { id, label };
        }
      }
      const uuidLike = /^[0-9a-f-]{10,}$/i.test(core.replace(/-/g, ''));
      if (uuidLike) {
        candidates.push(`所属コード: ${core}`);
      } else {
        core = core
          .split(/[-_]/g)
          .filter(Boolean)
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(' ');
        candidates.push(core || id);
      }
    }

    return { id, label: candidates[0] || id };
  }

  function getMembershipLabels(memberships) {
    const entries = Array.isArray(memberships) && memberships.length
      ? memberships
      : getMemberships();
    if (!entries || !entries.length) {
      return [];
    }
    return entries
      .map((value) => humanizeMembership(value))
      .filter((item) => item && item.id);
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
          ...('memberships' in data ? { memberships: data.memberships } : {}),
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
    const clinicId = options.clinicId || null;
    if (clinicId) {
      const clinicAuthorized = normalizedRoles.some((role) => hasClinicRole(clinicId, role, { auth }));
      if (clinicAuthorized) {
        return auth;
      }
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
    getMemberships,
    getMembershipForClinic,
    hasClinicRole,
    getMembershipLabels,
    requireRole,
    roleHierarchy: ROLE_INHERITANCE,
  };
})(window);
