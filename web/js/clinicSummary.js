(function () {
  const DEFAULT_API_BASE = 'https://ncd-app.altry.workers.dev';
  const API_BASE = (() => {
    try {
      return localStorage.getItem('ncdApiBase') || localStorage.getItem('ncdApiBaseUrl') || DEFAULT_API_BASE;
    } catch (_) {
      return DEFAULT_API_BASE;
    }
  })();

  const DEFAULT_CENTER = { lat: 35.7095, lng: 139.6654 };
  const FALLBACK_COORDS = {
    '4766366a-e9ec-4e40-b330-355f179babfc': { lat: 35.709782, lng: 139.654846 },
    'のがたクリニック': { lat: 35.709782, lng: 139.654846 },
    '0bc93f6c-4453-4bdb-9812-4afb4e09dc91': { lat: 35.710651, lng: 139.652756 },
    '板橋クリニック': { lat: 35.710651, lng: 139.652756 }
  };

  const els = {};
  const mapState = {
    map: null,
    marker: null,
    maps: null,
    mapsPromise: null
  };

  function nk(value) {
    if (typeof value === 'string') {
      return value.trim();
    }
    if (typeof value === 'number') {
      return String(value);
    }
    if (Array.isArray(value)) {
      const first = value.find((item) => typeof item === 'string' && item.trim());
      return first ? first.trim() : '';
    }
    return '';
  }

  function fetchJson(path) {
    return fetch(`${API_BASE}${path}`).then(async (res) => {
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status} ${text}`);
      }
      return res.json();
    });
  }

  function formatTimestamp(seconds) {
    if (!seconds) return '';
    const date = new Date(seconds * 1000);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('ja-JP', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    }).format(date);
  }

  function renderTags(clinic) {
    if (!els.tags) return;
    const tags = new Set();
    const departments = clinic.departments;
    if (departments) {
      (Array.isArray(departments.master) ? departments.master : []).forEach((dept) => { if (dept) tags.add(dept); });
      (Array.isArray(departments.others) ? departments.others : []).forEach((dept) => { if (dept) tags.add(dept); });
    }
    (Array.isArray(clinic.services) ? clinic.services : []).forEach((service) => {
      if (service.category) tags.add(service.category);
    });
    (Array.isArray(clinic.personalQualifications) ? clinic.personalQualifications : []).forEach((qual) => {
      if (qual.category) tags.add(qual.category);
    });

    els.tags.replaceChildren();
    Array.from(tags).slice(0, 12).forEach((text) => {
      const badge = document.createElement('span');
      badge.className = 'inline-flex items-center rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700';
      badge.textContent = text;
      els.tags.appendChild(badge);
    });
  }

  function resolveCoordinates(clinic) {
    const candidates = [];
    const push = (lat, lng) => {
      const latNum = Number(lat);
      const lngNum = Number(lng);
      if (Number.isFinite(latNum) && Number.isFinite(lngNum)) {
        candidates.push({ lat: latNum, lng: lngNum });
      }
    };

    if (clinic.latitude !== undefined && clinic.longitude !== undefined) {
      push(clinic.latitude, clinic.longitude);
    }
    if (clinic.lat !== undefined && clinic.lon !== undefined) {
      push(clinic.lat, clinic.lon);
    }
    if (clinic.location && typeof clinic.location === 'object') {
      push(clinic.location.lat ?? clinic.location.latitude, clinic.location.lng ?? clinic.location.lon ?? clinic.location.longitude);
    }
    if (clinic.geo && typeof clinic.geo === 'object') {
      push(clinic.geo.lat, clinic.geo.lng ?? clinic.geo.lon);
    }
    if (clinic.coordinates && typeof clinic.coordinates === 'object') {
      push(clinic.coordinates.lat ?? clinic.coordinates.latitude, clinic.coordinates.lng ?? clinic.coordinates.lon ?? clinic.coordinates.longitude);
    }

    if (candidates.length) return candidates[0];

    const fallback = FALLBACK_COORDS[clinic.id] || FALLBACK_COORDS[clinic.name];
    if (fallback) return fallback;
    return null;
  }

  function getMaps() {
    if (mapState.maps) return Promise.resolve(mapState.maps);
    if (mapState.mapsPromise) return mapState.mapsPromise;
    const loader = window.NCD && typeof window.NCD.loadGoogleMaps === 'function'
      ? window.NCD.loadGoogleMaps
      : null;
    if (!loader) {
      return Promise.reject(new Error('Google Maps loader is not available. Make sure googleMapsLoader.js is loaded.'));
    }
    mapState.mapsPromise = loader({ libraries: [] })
      .then((maps) => {
        mapState.maps = maps;
        return maps;
      })
      .catch((err) => {
        mapState.mapsPromise = null;
        throw err;
      });
    return mapState.mapsPromise;
  }

  async function ensureMap() {
    if (!els.map) return null;
    if (mapState.map) return mapState.map;

    const maps = await getMaps();
    els.map.innerHTML = '';
    mapState.map = new maps.Map(els.map, {
      center: DEFAULT_CENTER,
      zoom: 13,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
    });
    return mapState.map;
  }

  async function renderMap(clinic) {
    if (!els.map) return;
    const coords = resolveCoordinates(clinic);

    if (!coords) {
      if (mapState.marker) {
        mapState.marker.setMap(null);
        mapState.marker = null;
      }
      mapState.map = null;
      els.map.innerHTML = '<div class="flex h-full items-center justify-center text-sm text-slate-500">位置情報は未登録です。</div>';
      return;
    }

    try {
      const map = await ensureMap();
      if (!map) return;
      const maps = await getMaps();

      map.setCenter({ lat: coords.lat, lng: coords.lng });
      map.setZoom(16);

      if (!mapState.marker) {
        mapState.marker = new maps.Marker({ map });
      }
      mapState.marker.setPosition({ lat: coords.lat, lng: coords.lng });
      mapState.marker.setTitle(clinic.name || '');
    } catch (err) {
      console.error('Failed to render Google Map', err);
      els.map.innerHTML = '<div class="flex h-full items-center justify-center text-sm text-red-600">地図の読み込みに失敗しました。</div>';
      if (mapState.marker) {
        mapState.marker.setMap(null);
      }
      mapState.map = null;
      mapState.marker = null;
    }
  }

  function mediaUrl(record, params = {}) {
    if (!record || !record.key) return '';
    const base = `/assets/${encodeURIComponent(record.key)}`;
    const query = new URLSearchParams();
    if (params.width) query.set('w', String(params.width));
    if (params.height) query.set('h', String(params.height));
    if (params.fit) query.set('fit', params.fit);
    if (params.format) query.set('format', params.format);
    if (query.toString()) {
      return `${base}?${query.toString()}`;
    }
    return base;
  }

  function renderLogo(clinic) {
    if (!els.logo) return;
    const media = clinic.media && typeof clinic.media === 'object' ? clinic.media : {};
    const record = media.logoSmall || media.logoLarge;
    if (record && record.key) {
      const img = document.createElement('img');
      img.src = mediaUrl(record, { width: 256, height: 256, fit: 'cover' });
      img.alt = record.alt || clinic.name || 'クリニックロゴ';
      img.className = 'h-full w-full object-cover';
      els.logo.replaceChildren(img);
    } else {
      els.logo.innerHTML = '<span class="text-xs text-slate-400">ロゴ未登録</span>';
    }
  }

  function renderHero(clinic) {
    if (!els.hero) return;
    const media = clinic.media && typeof clinic.media === 'object' ? clinic.media : {};
    const record = media.facade || media.logoLarge || media.logoSmall;
    if (record && record.key) {
      const img = document.createElement('img');
      img.src = mediaUrl(record, { width: 1600, height: 900, fit: 'cover' });
      img.alt = record.alt || `${clinic.name || ''} の外観`;
      img.className = 'h-full w-full object-cover';
      els.hero.replaceChildren(img);
    } else {
      els.hero.innerHTML = '<div class="flex h-full items-center justify-center text-sm text-slate-400">外観画像は準備中です</div>';
    }
  }

  function renderModes(clinic) {
    if (!els.modes) return;
    els.modes.replaceChildren();
    const modes = clinic.modes && typeof clinic.modes === 'object' ? clinic.modes : {};
    const labels = {
      online: 'オンライン診療',
      night: '夜間診療',
      holiday: '休日診療',
      homeVisit: '在宅・訪問診療',
      emergency: '救急対応',
    };
    const active = Object.entries(labels).filter(([key]) => modes[key]);
    if (!active.length) {
      const span = document.createElement('span');
      span.className = 'text-xs text-slate-400';
      span.textContent = '診療形態の登録はまだありません';
      els.modes.appendChild(span);
      return;
    }
    active.forEach(([key, label]) => {
      const badge = document.createElement('span');
      badge.className = 'inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 shadow-sm';
      badge.textContent = label;
      els.modes.appendChild(badge);
    });
  }

  function appendContact(label, value, options = {}) {
    if (!els.contact || !value) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'flex items-center gap-2';

    const labelEl = document.createElement('span');
    labelEl.className = 'text-xs text-slate-500';
    labelEl.textContent = label;
    wrapper.appendChild(labelEl);

    if (options.href) {
      const link = document.createElement('a');
      link.href = options.href;
      link.textContent = value;
      link.className = 'text-sm text-blue-700 hover:underline';
      wrapper.appendChild(link);
    } else {
      const textEl = document.createElement('span');
      textEl.className = 'text-sm text-slate-600';
      textEl.textContent = value;
      wrapper.appendChild(textEl);
    }

    els.contact.appendChild(wrapper);
  }

  function renderContact(clinic) {
    els.contact.replaceChildren();
    const postalLine = clinic.postalCode ? `〒${clinic.postalCode}` : '';
    const addressLine = nk(`${postalLine} ${clinic.address || ''}`.trim());
    if (addressLine) appendContact('住所', addressLine);
    if (clinic.phone) appendContact('TEL', clinic.phone, { href: `tel:${clinic.phone.replace(/[^0-9+]/g, '')}` });
    if (clinic.fax) appendContact('FAX', clinic.fax);
  }

  function addLinkButton(container, { href, text, variant }) {
    if (!container || !href) return;
    const a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener';
    const base = 'inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded transition';
    if (variant === 'outline') {
      a.className = `${base} border border-blue-500 text-blue-600 hover:bg-blue-50`;
    } else {
      a.className = `${base} bg-emerald-500 text-white hover:bg-emerald-600`;
    }
    a.textContent = text;
    container.appendChild(a);
  }

  function renderLinks(clinic) {
    els.links.replaceChildren();
    const reservationUrl = clinic.reservation?.url;
    if (reservationUrl) {
      addLinkButton(els.links, { href: reservationUrl, text: '予約サイトへ' });
    }
    const homepage = nk(clinic.website || clinic.homepage);
    if (homepage) {
      addLinkButton(els.links, { href: homepage, text: '公式サイトへ', variant: 'outline' });
    }
  }

  function renderList(ulEl, items, emptyText) {
    ulEl.replaceChildren();
    if (!items || !items.length) {
      const li = document.createElement('li');
      li.className = 'text-xs text-slate-400';
      li.textContent = emptyText;
      ulEl.appendChild(li);
      return;
    }
    items.forEach((item) => {
      const li = document.createElement('li');
      li.textContent = item;
      li.className = 'text-sm text-slate-600';
      ulEl.appendChild(li);
    });
  }

  function toPatternKey(label) {
    if (!label) return null;
    const value = label.replace(/\s+/g, '').trim();
    if (!value) return null;
    if (/休診/.test(value)) return null;
    const map = [
      { prefix: '午前', key: 'am' },
      { prefix: '午後', key: 'pm' },
      { prefix: '夜間', key: 'night' },
      { prefix: '終日', key: 'full' }
    ];
    for (const entry of map) {
      if (value.startsWith(entry.prefix)) {
        const suffix = value.substring(entry.prefix.length).trim();
        return `${entry.key}${suffix}`;
      }
    }
    return value;
  }

  function resolveSlot(label, patterns) {
    if (!label) return '休診';
    const trimmed = label.trim();
    if (/休診/.test(trimmed)) return trimmed;
    const key = toPatternKey(trimmed);
    const range = key && patterns ? patterns[key] : null;
    if (Array.isArray(range) && range[0]) {
      const start = range[0];
      const end = range[1] || '';
      return end ? `${start}〜${end}` : start;
    }
    return trimmed;
  }

  function resolveColumnLabel(key) {
    switch (key) {
      case 'am': return '午前';
      case 'pm': return '午後';
      case 'night': return '夜間';
      case 'full': return '終日';
      case 'eve': return '夕方';
      default: return key;
    }
  }

  function renderSchedule(schedule) {
    const table = els.schedule;
    const noteEl = els.scheduleNote;
    table.replaceChildren();
    if (noteEl) {
      noteEl.textContent = schedule?.note || schedule?.notes || '';
    }
    if (!schedule || !schedule.days) {
      table.innerHTML = '<tbody><tr><td class="px-3 py-3 text-sm text-slate-500">診療時間は未登録です。</td></tr></tbody>';
      return;
    }

    const days = schedule.days;
    const defaultOrder = ['月曜', '火曜', '水曜', '木曜', '金曜', '土曜', '日曜', '祝日'];
    const orderedDays = [];
    defaultOrder.forEach((day) => { if (days[day]) orderedDays.push(day); });
    Object.keys(days).forEach((day) => { if (!orderedDays.includes(day)) orderedDays.push(day); });

    const columnKeys = new Set();
    orderedDays.forEach((day) => {
      const slots = days[day];
      if (!slots || typeof slots !== 'object') return;
      Object.keys(slots).forEach((key) => { if (key) columnKeys.add(key); });
    });

    if (!columnKeys.size) {
      table.innerHTML = '<tbody><tr><td class="px-3 py-3 text-sm text-slate-500">診療時間は未登録です。</td></tr></tbody>';
      return;
    }

    const columns = Array.from(columnKeys);
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    headRow.className = 'bg-slate-100 text-left text-xs uppercase tracking-wider text-slate-600';
    const dayTh = document.createElement('th');
    dayTh.className = 'px-3 py-2';
    dayTh.textContent = '曜日';
    headRow.appendChild(dayTh);
    columns.forEach((key) => {
      const th = document.createElement('th');
      th.className = 'px-3 py-2';
      th.textContent = resolveColumnLabel(key);
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);

    const tbody = document.createElement('tbody');
    orderedDays.forEach((day) => {
      const slots = days[day] || {};
      const tr = document.createElement('tr');
      tr.className = 'border-b border-slate-100';
      const dayCell = document.createElement('td');
      dayCell.className = 'px-3 py-2 text-sm font-medium text-slate-700';
      dayCell.textContent = day;
      tr.appendChild(dayCell);
      columns.forEach((key) => {
        const cell = document.createElement('td');
        cell.className = 'px-3 py-2 text-sm text-slate-600';
        const slotLabel = slots[key];
        cell.textContent = slotLabel ? resolveSlot(slotLabel, schedule.patterns) : '';
        tr.appendChild(cell);
      });
      tbody.appendChild(tr);
    });

    table.appendChild(thead);
    table.appendChild(tbody);
  }

  function renderFeatures(clinic) {
    els.features.replaceChildren();
    const tests = Array.isArray(clinic.tests) ? clinic.tests : [];
    const quals = Array.isArray(clinic.personalQualifications) ? clinic.personalQualifications : [];

    const cards = [];
    if (tests.length) {
      const grouped = new Map();
      tests.forEach((test) => {
        const category = test.category || '検査';
        if (!grouped.has(category)) grouped.set(category, []);
        grouped.get(category).push(test.name || '名称未登録');
      });
      Array.from(grouped.entries()).sort((a, b) => b[1].length - a[1].length).slice(0, 4).forEach(([category, names]) => {
        const card = document.createElement('div');
        card.className = 'rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600';
        const title = document.createElement('div');
        title.className = 'text-xs font-semibold text-slate-500';
        title.textContent = category;
        const list = document.createElement('ul');
        list.className = 'mt-2 space-y-1';
        names.slice(0, 5).forEach((name) => {
          const li = document.createElement('li');
          li.textContent = name;
          list.appendChild(li);
        });
        if (names.length > 5) {
          const more = document.createElement('li');
          more.className = 'text-xs text-slate-400';
          more.textContent = `他 ${names.length - 5}件`;
          list.appendChild(more);
        }
        card.append(title, list);
        cards.push(card);
      });
    }

    if (quals.length) {
      const card = document.createElement('div');
      card.className = 'rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600';
      const title = document.createElement('div');
      title.className = 'text-xs font-semibold text-slate-500';
      title.textContent = '資格・専門分野';
      const list = document.createElement('ul');
      list.className = 'mt-2 space-y-1';
      quals.slice(0, 6).forEach((qual) => {
        const li = document.createElement('li');
        const field = qual.category || qual.medicalField;
        li.textContent = field ? `${field} / ${qual.name}` : qual.name;
        list.appendChild(li);
      });
      if (quals.length > 6) {
        const more = document.createElement('li');
        more.className = 'text-xs text-slate-400';
        more.textContent = `他 ${quals.length - 6}件登録あり`;
        list.appendChild(more);
      }
      card.append(title, list);
      cards.push(card);
    }

    if (!cards.length) {
      const empty = document.createElement('div');
      empty.className = 'text-sm text-slate-500 px-5 py-4';
      empty.textContent = '設備や特徴は準備中です。';
      els.features.appendChild(empty);
      return;
    }

    cards.forEach((card) => els.features.appendChild(card));
  }

  function renderAccess(clinic) {
    const access = clinic.access && typeof clinic.access === 'object' ? clinic.access : {};
    const list = els.accessList;
    const summaryEl = els.accessSummary;
    const textEl = els.accessText;

    const summaryParts = [];
    if (access.nearestStation) summaryParts.push(access.nearestStation);
    if (access.bus) summaryParts.push(access.bus);
    if (summaryEl) {
      summaryEl.textContent = summaryParts.join(' / ') || 'アクセス情報は準備中です。';
    }

    if (list) {
      list.replaceChildren();
      const entries = [];
      if (access.nearestStation) entries.push(['最寄駅', access.nearestStation]);
      if (access.bus) entries.push(['バス・ルート', access.bus]);
      if (access.parking && typeof access.parking === 'object') {
        const parking = access.parking;
        const details = [];
        if (parking.available) {
          if (Number.isFinite(parking.capacity)) details.push(`収容 ${parking.capacity}台`);
          if (parking.notes) details.push(parking.notes);
          entries.push(['駐車場', details.join(' / ') || 'あり']);
        } else if (parking.notes) {
          entries.push(['駐車場', parking.notes]);
        }
      }
      if (Array.isArray(access.barrierFree) && access.barrierFree.length) {
        entries.push(['バリアフリー', access.barrierFree.join(' / ')]);
      }
      if (access.notes) {
        entries.push(['補足', access.notes]);
      }

      if (!entries.length) {
        const dt = document.createElement('dt');
        dt.className = 'font-semibold text-slate-500';
        dt.textContent = '情報';
        const dd = document.createElement('dd');
        dd.textContent = 'アクセス情報は準備中です。';
        dd.className = 'text-slate-500';
        list.append(dt, dd);
      } else {
        entries.forEach(([label, value]) => {
          const dt = document.createElement('dt');
          dt.className = 'font-semibold text-slate-500';
          dt.textContent = label;
          const dd = document.createElement('dd');
          dd.className = 'text-slate-600';
          dd.textContent = value;
          list.append(dt, dd);
        });
      }
    }

    if (textEl) {
      const lines = [];
      if (clinic.postalCode) lines.push(`〒${clinic.postalCode}`);
      if (clinic.address) lines.push(clinic.address);
      textEl.textContent = lines.join(' ') || '住所情報は準備中です。';
    }
  }

  function renderClinic(clinic) {
    if (els.status) {
      const updatedText = formatTimestamp(clinic.updated_at) || '登録済み';
      els.status.textContent = `最終更新: ${updatedText}`;
    }
    if (els.title) {
      els.title.textContent = clinic.name || '名称未設定のクリニック';
    }
    if (els.subtitle) {
      const parts = [];
      if (clinic.postalCode) parts.push(`〒${clinic.postalCode}`);
      if (clinic.address) parts.push(clinic.address);
      els.subtitle.textContent = parts.join(' / ') || '住所情報は未登録です。';
    }

    renderTags(clinic);
    renderLogo(clinic);
    renderContact(clinic);
    renderLinks(clinic);

    const departmentList = [];
    if (clinic.departments) {
      (Array.isArray(clinic.departments.master) ? clinic.departments.master : []).forEach((dept) => { if (dept) departmentList.push(dept); });
      (Array.isArray(clinic.departments.others) ? clinic.departments.others : []).forEach((dept) => { if (dept) departmentList.push(dept); });
    }
    renderList(els.departments, departmentList, '診療科は準備中です');

    const serviceList = (Array.isArray(clinic.services) ? clinic.services : []).map((service) => {
      const category = service.category || '分類未設定';
      const name = service.name || '';
      return `${category} / ${name}`;
    });
    renderList(els.services, serviceList, '診療メニューは準備中です');

    renderSchedule(clinic.schedule);
    renderFeatures(clinic);
    renderHero(clinic);
    renderModes(clinic);
    renderAccess(clinic);
    renderMap(clinic);
  }

  function renderMissingId() {
    if (els.status) {
      els.status.textContent = 'クリニックIDが指定されていません';
    }
    if (els.title) {
      els.title.textContent = 'クリニックを選択してください';
    }
    if (els.subtitle) {
      els.subtitle.textContent = '検索ページからクリニックを選択すると、このページに情報が表示されます。';
    }
  }

  function renderNotFound() {
    if (els.status) {
      els.status.textContent = 'データ未登録';
    }
    if (els.title) {
      els.title.textContent = 'このクリニックの情報はまだ登録されていません';
    }
    if (els.subtitle) {
      els.subtitle.textContent = '管理画面から登録を行ってください。';
    }
  }

  async function loadClinic(id) {
    try {
      const runner = () => fetchJson(`/api/clinicDetail?id=${encodeURIComponent(id)}`);
      const useWrap = typeof window.wrapWithLoading === 'function';
      const data = useWrap ? await window.wrapWithLoading(runner, 'クリニック情報を読み込み中...') : await runner();
      if (!data || !data.ok || !data.clinic) {
        renderNotFound();
        return;
      }
      renderClinic(data.clinic);
    } catch (err) {
      console.error(err);
      if (els.status) {
        els.status.textContent = `取得に失敗しました: ${err.message}`;
      }
    }
  }

  function bindElements() {
    els.status = document.getElementById('clinicStatus');
    els.title = document.getElementById('clinicTitle');
    els.subtitle = document.getElementById('clinicSubtitle');
    els.tags = document.getElementById('clinicTags');
    els.logo = document.getElementById('clinicLogo');
    els.contact = document.getElementById('clinicContact');
    els.links = document.getElementById('clinicLinks');
    els.departments = document.getElementById('clinicDepartments');
    els.services = document.getElementById('clinicServices');
    els.schedule = document.getElementById('clinicSchedule');
    els.scheduleNote = document.getElementById('clinicScheduleNote');
    els.features = document.getElementById('clinicFeatures');
    els.hero = document.getElementById('clinicHero');
    els.modes = document.getElementById('clinicModes');
    els.accessSummary = document.getElementById('clinicAccessSummary');
    els.accessList = document.getElementById('clinicAccessList');
    els.accessText = document.getElementById('clinicAccessText');
    els.map = document.getElementById('clinicMap');
  }

  function init() {
    bindElements();
    const params = new URLSearchParams(window.location.search);
    const clinicId = params.get('id');
    if (!clinicId) {
      renderMissingId();
      return;
    }
    loadClinic(clinicId);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
