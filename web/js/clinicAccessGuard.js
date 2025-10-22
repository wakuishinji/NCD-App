(function attachClinicAccessGuard(global) {
  if (global.NcdClinicAccessGuard) {
    return;
  }

  function primeRequireClinic() {
    if (!global.document) return;
    const doc = global.document;
    const html = doc.documentElement;
    if (!html) return;
    try {
      const stored = global.localStorage?.getItem('selectedClinic');
      if (!stored) return;
      const parsed = JSON.parse(stored);
      if (!parsed || typeof parsed !== 'object') return;
      const clinicId = parsed.id || parsed.clinicId;
      if (!clinicId) return;
      if (!html.dataset.requireClinic) {
        html.dataset.requireClinic = clinicId;
      }
      if (doc.body && !doc.body.dataset.requireClinic) {
        doc.body.dataset.requireClinic = clinicId;
      }
    } catch (err) {
      console.warn('[clinicAccessGuard] failed to prime dataset', err);
    }
  }

  async function verifyClinicAccess(clinicId, options = {}) {
    if (!clinicId) {
      return true;
    }
    if (!global.NcdAuth || typeof global.NcdAuth.ensureAuth !== 'function') {
      return true;
    }
    const redirectTo = options.redirectTo || 'clinicHome.html';
    const deniedMessage = options.message || 'この施設の編集権限がありません。施設ホームへ戻ります。';
    try {
      const auth = await global.NcdAuth.ensureAuth();
      if (typeof global.NcdAuth.hasClinicRole === 'function') {
        const allowed = global.NcdAuth.hasClinicRole(clinicId, 'clinicStaff', { auth, fallbackToGlobal: false });
        if (allowed) {
          return true;
        }
      } else {
        const role = global.NcdAuth.getCurrentRole ? global.NcdAuth.getCurrentRole(auth) : auth?.account?.role;
        if (global.NcdAuth.roleIncludes && global.NcdAuth.roleIncludes(role, 'clinicStaff')) {
          return true;
        }
      }
      const error = new Error('CLINIC_ACCESS_DENIED');
      error.code = 'CLINIC_ACCESS_DENIED';
      throw error;
    } catch (err) {
      const code = err?.code || '';
      if (code === 'AUTH_REQUIRED') {
        alert('ログインが必要です。ログインページへ移動します。');
        global.location.replace('/auth/login.html');
      } else {
        if (deniedMessage) {
          alert(deniedMessage);
        }
        global.location.replace(redirectTo);
      }
      throw err;
    }
  }

  const api = {
    prime: primeRequireClinic,
    verify: verifyClinicAccess,
  };

  try {
    primeRequireClinic();
  } catch (err) {
    console.warn('[clinicAccessGuard] prime failed', err);
  }

  global.NcdClinicAccessGuard = api;
})(window);
