(function () {
  function closeMenu(toggle, menu) {
    if (!toggle || !menu) return;
    toggle.setAttribute('aria-expanded', 'false');
    menu.classList.add('hidden');
  }

  function openMenu(toggle, menu) {
    if (!toggle || !menu) return;
    toggle.setAttribute('aria-expanded', 'true');
    menu.classList.remove('hidden');
  }

  function getPairs() {
    return Array.from(document.querySelectorAll('[data-mobile-menu]'))
      .map((toggle) => {
        const selector = toggle.getAttribute('data-mobile-menu');
        const menu = selector ? document.querySelector(selector) : null;
        if (!menu) return null;
        closeMenu(toggle, menu);
        return { toggle, menu };
      })
      .filter(Boolean);
  }

  function setup() {
    const pairs = getPairs();
    if (!pairs.length) return;

    pairs.forEach(({ toggle, menu }) => {
      toggle.addEventListener('click', (event) => {
        event.preventDefault();
        const expanded = toggle.getAttribute('aria-expanded') === 'true';
        pairs.forEach(({ toggle: t, menu: m }) => closeMenu(t, m));
        if (!expanded) {
          openMenu(toggle, menu);
        }
      });
    });

    document.addEventListener('click', (event) => {
      const target = event.target;
      const hitToggle = target.closest('[data-mobile-menu]');
      const hitMenu = target.closest('[data-mobile-menu-target]');
      if (hitToggle || hitMenu) return;
      pairs.forEach(({ toggle, menu }) => closeMenu(toggle, menu));
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      pairs.forEach(({ toggle, menu }) => closeMenu(toggle, menu));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
})();
