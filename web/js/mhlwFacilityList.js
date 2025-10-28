(function setupMhlwFacilityList(global) {
  const PREFECTURES = Array.isArray(global.MhlwPrefectures) ? global.MhlwPrefectures : [];

  function normalizeFuzzy(text) {
    if (text == null) return '';
    return String(text)
      .trim()
      .toLowerCase()
      .replace(/[ぁ-ゖ]/g, (s) => String.fromCharCode(s.charCodeAt(0) + 0x60))
      .replace(/[ァ-ヶ]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0x60))
      .replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
      .replace(/\s+/g, '');
  }

  function tokenize(text) {
    if (text == null) return [];
    return String(text)
      .split(/[^ぁ-んァ-ン一-龠a-zA-Z0-9]+/)
      .map((token) => normalizeFuzzy(token))
      .filter(Boolean);
  }

  function formatAddress(facility) {
    if (!facility) return '';
    const parts = [
      facility.prefectureName || facility.prefecture || '',
      facility.cityName || facility.city || '',
      facility.address || facility.fullAddress || '',
    ];
    return parts
      .map((part) => (typeof part === 'string' ? part.trim() : ''))
      .filter(Boolean)
      .join(' ');
  }

  function facilityTypeLabel(type) {
    if (!type) return '-';
    const normalized = String(type).toLowerCase();
    if (normalized === 'hospital') return '病院';
    if (normalized === 'clinic') return '診療所';
    return type;
  }

  function matchesFilters(facility, filters) {
    if (!facility) return false;
    const { keywordTokens, prefecture, cityToken, postalPrefix } = filters;

    if (prefecture && facility.prefectureCode !== prefecture) {
      return false;
    }
    if (cityToken) {
      const cityNormalized = normalizeFuzzy(facility.cityName || facility.city || '');
      if (!cityNormalized.includes(cityToken)) {
        return false;
      }
    }
    if (postalPrefix) {
      const postalNormalized = (facility.postalCode || '').toString().replace(/[^0-9]/g, '');
      if (!postalNormalized.startsWith(postalPrefix)) {
        return false;
      }
    }
    if (keywordTokens.length) {
      const candidates = [
        facility.shortName,
        facility.shortNameKana,
        facility.officialName,
        facility.officialNameKana,
        facility.name,
      ]
        .map((value) => (typeof value === 'string' ? normalizeFuzzy(value) : ''))
        .filter(Boolean);
      const matched = keywordTokens.every((token) => candidates.some((candidate) => candidate.includes(token)));
      if (!matched) return false;
    }
    return true;
  }

  async function loadFacilities({ bypassCache = false } = {}) {
    if (!global.MhlwCsvUtils?.loadMhlwFacilities) {
      throw new Error('厚労省データ読み込みモジュールが初期化されていません。ページを再読み込みしてください。');
    }
    return global.MhlwCsvUtils.loadMhlwFacilities({ bypassCache });
  }

  function populatePrefectureOptions(selectEl) {
    if (!selectEl) return;
    PREFECTURES.forEach(({ code, name }) => {
      const option = document.createElement('option');
      option.value = code;
      option.textContent = `${code} - ${name}`;
      selectEl.appendChild(option);
    });
  }

  function renderTable(facilities, filters, tbodyEl, statusEl) {
    if (!tbodyEl) return;
    tbodyEl.innerHTML = '';

    const filtered = facilities.filter((facility) => matchesFilters(facility, filters));

    if (statusEl) {
      statusEl.textContent = `表示件数: ${filtered.length.toLocaleString()} / 全体 ${facilities.length.toLocaleString()} 件`;
    }

    if (!filtered.length) {
      const empty = document.createElement('tr');
      empty.innerHTML = '<td colspan="6" class="px-4 py-6 text-center text-sm text-slate-500">該当する施設が見つかりませんでした。条件を調整してください。</td>';
      tbodyEl.appendChild(empty);
      return;
    }

    filtered
      .sort((a, b) => (a.shortName || a.officialName || '').localeCompare(b.shortName || b.officialName || '', 'ja'))
      .forEach((facility) => {
        const row = document.createElement('tr');
        row.className = 'hover:bg-slate-50 transition';
        const addressText = formatAddress(facility);
        row.innerHTML = `
          <td class="px-4 py-3 font-mono text-xs text-slate-500">${facility.facilityId || ''}</td>
          <td class="px-4 py-3">${facility.officialName || '-'}</td>
          <td class="px-4 py-3">${facility.shortName || '-'}</td>
          <td class="px-4 py-3 text-sm text-slate-600">${facility.postalCode || '-'}</td>
          <td class="px-4 py-3 text-sm text-slate-600">${addressText || '-'}</td>
          <td class="px-4 py-3 text-xs text-slate-500">${facilityTypeLabel(facility.facilityType)}</td>
        `;
        tbodyEl.appendChild(row);
      });
  }

  function initFacilityListPage() {
    const tbody = document.getElementById('facilityTableBody');
    const keywordInput = document.getElementById('facilityKeyword');
    const prefectureSelect = document.getElementById('facilityPrefecture');
    const cityInput = document.getElementById('facilityCity');
    const postalInput = document.getElementById('facilityPostal');
    const resetButton = document.getElementById('facilityReset');
    const statusEl = document.getElementById('facilityStatus');
    const metaEl = document.getElementById('mhlwFacilityMeta');

    populatePrefectureOptions(prefectureSelect);

    let facilities = [];

    const readFilters = () => {
      return {
        keywordTokens: tokenize(keywordInput?.value || ''),
        prefecture: prefectureSelect?.value || '',
        cityToken: normalizeFuzzy(cityInput?.value || ''),
        postalPrefix: (postalInput?.value || '').replace(/[^0-9]/g, ''),
      };
    };

    const refreshTable = () => {
      const filters = readFilters();
      renderTable(facilities, filters, tbody, statusEl);
    };

    [keywordInput, prefectureSelect, cityInput, postalInput].forEach((el) => {
      if (el) el.addEventListener('input', refreshTable);
    });

    if (resetButton) {
      resetButton.addEventListener('click', () => {
        if (keywordInput) keywordInput.value = '';
        if (prefectureSelect) prefectureSelect.value = '';
        if (cityInput) cityInput.value = '';
        if (postalInput) postalInput.value = '';
        refreshTable();
      });
    }

    loadFacilities()
      .then((dict) => {
        facilities = Object.values(dict || {});
        if (metaEl) {
          metaEl.textContent = `読み込み済み: ${facilities.length.toLocaleString()} 件`;
        }
        refreshTable();
      })
      .catch((err) => {
        console.error('[mhlwFacilityList] failed to load facilities', err);
        facilities = [];
        if (statusEl) {
          statusEl.textContent = err?.message || '厚労省施設データの読み込みに失敗しました。CSV の再読込を確認してください。';
          statusEl.classList.add('text-red-600');
        }
        if (tbody) {
          tbody.innerHTML = '<td colspan="6" class="px-4 py-6 text-center text-sm text-red-600">厚労省施設データの読み込みに失敗しました。</td>';
        }
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFacilityListPage);
  } else {
    initFacilityListPage();
  }
})(window);
