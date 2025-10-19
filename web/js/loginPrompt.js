(function setupAdminLoginPrompt(global) {
  if (global.NcdAdminLoginPrompt) {
    return;
  }

  const DEFAULT_TARGET = '/admin/admin.html';
  const overlay = document.getElementById('adminLoginOverlay');
  const form = document.getElementById('adminLoginForm');
  const emailInput = document.getElementById('adminLoginEmail');
  const passwordInput = document.getElementById('adminLoginPassword');
  const rememberInput = document.getElementById('adminLoginRemember');
  const messageArea = document.getElementById('adminLoginMessage');
  const submitButton = document.getElementById('adminLoginSubmit');
  const cancelButton = document.getElementById('adminLoginCancel');
  const submitLabel = submitButton ? submitButton.querySelector('span') : null;
  const originalSubmitText = submitLabel ? submitLabel.textContent : '';
  let pendingRedirect = DEFAULT_TARGET;
  let loading = false;
  let previousBodyOverflow = '';

  if (!overlay || !form || !emailInput || !passwordInput || !submitButton) {
    console.warn('[adminLogin] 必要な要素が見つかりません。');
    return;
  }

  function isVisible() {
    return !overlay.classList.contains('hidden');
  }

  function clearMessage() {
    if (messageArea) {
      messageArea.textContent = '';
      messageArea.classList.add('hidden');
    }
  }

  function showMessage(text) {
    if (!messageArea) return;
    messageArea.textContent = text || '';
    messageArea.classList.remove('hidden');
  }

  function setLoading(state) {
    loading = state;
    submitButton.disabled = state;
    if (submitLabel) {
      submitLabel.textContent = state ? '認証中…' : originalSubmitText;
    }
  }

  function openModal(targetUrl) {
    pendingRedirect = targetUrl || DEFAULT_TARGET;
    clearMessage();
    setLoading(false);
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (passwordInput) {
      passwordInput.value = '';
    }
    setTimeout(() => {
      if (emailInput.value) {
        passwordInput.focus();
      } else {
        emailInput.focus();
      }
    }, 50);
  }

  function closeModal() {
    if (!isVisible()) return;
    clearMessage();
    setLoading(false);
    overlay.classList.add('hidden');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = previousBodyOverflow || '';
  }

  async function hasSystemRootAccess() {
    if (!global.NcdAuth) return false;
    try {
      const auth = await global.NcdAuth.ensureAuth({ optional: true });
      if (!auth) return false;
      const role = global.NcdAuth.getCurrentRole(auth);
      return global.NcdAuth.roleIncludes(role, 'systemRoot');
    } catch (_) {
      return false;
    }
  }

  async function handleAdminNavigation(event) {
    if (!event || !event.currentTarget) return;
    const anchor = event.currentTarget;
    const href = anchor.getAttribute('href') || DEFAULT_TARGET;
    event.preventDefault();
    const authorized = await hasSystemRootAccess();
    if (authorized) {
      window.location.href = href;
      return;
    }
    openModal(href);
  }

  async function submitLogin(event) {
    event.preventDefault();
    if (loading) return;
    clearMessage();

    const identifier = (emailInput.value || '').trim();
    const password = passwordInput.value || '';
    const remember = rememberInput ? rememberInput.checked : true;

    if (!identifier || !password) {
      showMessage('メールアドレスとパスワードを入力してください。');
      return;
    }

    const apiBase =
      (global.NcdAuth && global.NcdAuth.resolveApiBase()) ||
      'https://ncd-app.altry.workers.dev';

    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password, remember }),
      });
      let payload = null;
      try {
        payload = await res.json();
      } catch (_) {
        payload = null;
      }
      if (!res.ok || !payload || payload.error || payload.ok !== true) {
        const errorMessage =
          (payload && payload.message) ||
          'ログインに失敗しました。ID またはパスワードをご確認ください。';
        showMessage(errorMessage);
        setLoading(false);
        return;
      }
      if (global.NcdAuth && typeof global.NcdAuth.saveAuth === 'function') {
        global.NcdAuth.saveAuth(payload);
      }
      closeModal();
      window.location.href = pendingRedirect || DEFAULT_TARGET;
    } catch (err) {
      console.error('[adminLogin] login request failed', err);
      showMessage('ネットワークエラーが発生しました。時間をおいて再試行してください。');
      setLoading(false);
    }
  }

  function handleOverlayClick(event) {
    if (event.target === overlay) {
      closeModal();
    }
  }

  function handleKeydown(event) {
    if (event.key === 'Escape' && isVisible()) {
      closeModal();
    }
  }

  function init() {
    const adminLinks = document.querySelectorAll('[data-admin-link]');
    adminLinks.forEach((link) => {
      link.addEventListener('click', handleAdminNavigation);
    });
    form.addEventListener('submit', submitLogin);
    overlay.addEventListener('click', handleOverlayClick);
    document.addEventListener('keydown', handleKeydown);
    if (cancelButton) {
      cancelButton.addEventListener('click', closeModal);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.NcdAdminLoginPrompt = {
    open: openModal,
    close: closeModal,
  };
})(window);
