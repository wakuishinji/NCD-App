(function attachSessionGuard(global) {
  if (global.NcdSessionGuard) {
    return;
  }

  function parseRequiredRoles() {
    const attr =
      (document.body && document.body.dataset.requireRole) ||
      document.documentElement.dataset.requireRole ||
      'systemRoot';
    const trimmed = (attr || '').trim();
    if (!trimmed || trimmed.toLowerCase() === 'none') {
      return [];
    }
    return trimmed
      .split(',')
      .map((role) => role.trim())
      .filter(Boolean);
  }

  function resolveRedirectTarget() {
    const body = document.body;
    if (body && body.dataset.redirectTo) {
      return body.dataset.redirectTo;
    }
    const html = document.documentElement;
    if (html && html.dataset.redirectTo) {
      return html.dataset.redirectTo;
    }
    return '/index.html';
  }

  function resolveGuardMessage(code) {
    const defaultMessage =
      code === 'AUTH_REQUIRED'
        ? 'ログイン情報が確認できません。トップページに戻ります。'
        : 'システム管理者のみアクセスできます。トップページに戻ります。';
    const body = document.body;
    if (body && body.dataset.guardMessage) {
      return body.dataset.guardMessage;
    }
    const html = document.documentElement;
    if (html && html.dataset.guardMessage) {
      return html.dataset.guardMessage;
    }
    return defaultMessage;
  }

  async function enforceRole() {
    if (!global.NcdAuth || typeof global.NcdAuth.requireRole !== 'function') {
      console.error('[sessionGuard] NcdAuth.requireRole is not available.');
      return null;
    }
    const requiredRoles = parseRequiredRoles();
    if (!requiredRoles.length) {
      return global.NcdAuth.ensureAuth({ optional: true });
    }
    try {
      return await global.NcdAuth.requireRole(requiredRoles);
    } catch (err) {
      const code = err && err.code ? err.code : 'AUTH_REQUIRED';
      const message = resolveGuardMessage(code);
      const redirectTo = resolveRedirectTarget();
      if (message) {
        alert(message);
      }
      if (redirectTo) {
        window.location.replace(redirectTo);
      }
      throw err;
    }
  }

  const guard = {
    ready: Promise.resolve(null),
    enforceRole,
    requireRole: (roles, options) => {
      return global.NcdAuth.requireRole(roles, options);
    },
  };

  guard.ready = enforceRole()
    .then((auth) => {
      document.dispatchEvent(
        new CustomEvent('ncd:auth-ready', { detail: { auth } }),
      );
      return auth;
    })
    .catch(() => {
      // swallow; redirect handled in enforceRole
      return null;
    });

  global.NcdSessionGuard = guard;
})(window);
