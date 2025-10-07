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

  const MODE_LABELS = {
    online: 'オンライン',
    night: '夜間',
    holiday: '休日',
    homeVisit: '在宅',
    emergency: '救急'
  };
  const MODE_ORDER = ['online', 'night', 'holiday', 'homeVisit', 'emergency'];

  const els = {};
  const state = {
    rawClinics: [],
    clinics: [],
    filtered: [],
    serviceOptions: [],
    bodySiteOptions: [],
    map: null,
    markers: [],
    infoWindow: null,
    maps: null,
    mapsPromise: null
  };

  function nk(value) {
    return (value || '').trim();
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

  function collectBodySites(clinic) {
    const sites = new Set();
    const direct = Array.isArray(clinic.bodySites) ? clinic.bodySites : [];
    direct.forEach((site) => { if (site) sites.add(site); });
    const services = Array.isArray(clinic.services) ? clinic.services : [];
    services.forEach((service) => {
      const refs = Array.isArray(service.bodySites) ? service.bodySites : Array.isArray(service.bodySiteRefs) ? service.bodySiteRefs : [];
      refs.forEach((ref) => { if (ref) sites.add(ref); });
    });
    const tests = Array.isArray(clinic.tests) ? clinic.tests : [];
    tests.forEach((test) => {
      const refs = Array.isArray(test.bodySites) ? test.bodySites : Array.isArray(test.bodySiteRefs) ? test.bodySiteRefs : [];
      refs.forEach((ref) => { if (ref) sites.add(ref); });
    });
    return Array.from(sites);
  }

  function collectServiceCategories(clinic) {
    const set = new Set();
    const services = Array.isArray(clinic.services) ? clinic.services : [];
    services.forEach((service) => {
      const label = service.category || service.name;
      if (label) set.add(label);
    });
    return Array.from(set);
  }

  function buildTags(clinic) {
    const tags = new Set();
    const departments = clinic.departments;
    if (departments) {
      const masters = Array.isArray(departments.master) ? departments.master : [];
      masters.forEach((dept) => { if (dept) tags.add(dept); });
      const others = Array.isArray(departments.others) ? departments.others : [];
      others.forEach((dept) => { if (dept) tags.add(dept); });
    }
    const services = Array.isArray(clinic.services) ? clinic.services : [];
    services.forEach((service) => {
      if (service.category) tags.add(service.category);
    });
    const tests = Array.isArray(clinic.tests) ? clinic.tests : [];
    tests.slice(0, 5).forEach((test) => {
      if (test.category) tags.add(`${test.category}`);
    });
    if (clinic.reservation && clinic.reservation.available) {
      tags.add('予約対応');
    }
    return Array.from(tags).slice(0, 12);
  }

  function buildSearchText(clinic) {
    const fields = [clinic.name, clinic.address, clinic.phone, clinic.postalCode, clinic.homepage, clinic.website];
    const services = Array.isArray(clinic.services) ? clinic.services : [];
    services.forEach((service) => {
      fields.push(service.category, service.name, service.desc);
    });
    const tests = Array.isArray(clinic.tests) ? clinic.tests : [];
    tests.forEach((test) => {
      fields.push(test.category, test.name, test.desc);
    });
    const quals = Array.isArray(clinic.personalQualifications) ? clinic.personalQualifications : [];
    quals.forEach((item) => {
      fields.push(item.name, item.category, item.medicalField);
    });
    return fields.filter(Boolean).map((value) => String(value).toLowerCase()).join(' ');
  }

  function mediaUrl(record, params = {}) {
    if (!record || !record.key) return '';
    const base = `/assets/${encodeURIComponent(record.key)}`;
    const query = new URLSearchParams();
    if (params.width) query.set('w', String(params.width));
    if (params.height) query.set('h', String(params.height));
    if (params.fit) query.set('fit', params.fit);
    if (params.format) query.set('format', params.format);
    const qs = query.toString();
    return qs ? `${base}?${qs}` : base;
  }

  function buildModesBadges(modes) {
    if (!modes || typeof modes !== 'object') return '';
    const active = MODE_ORDER.filter((key) => modes[key]);
    if (!active.length) return '';
    return active.map((key) => `<span class="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-600">${MODE_LABELS[key]}</span>`).join('');
  }

  function resolveCoordinates(raw) {
    const candidates = [];
    const push = (lat, lng) => {
      const latNum = Number(lat);
      const lngNum = Number(lng);
      if (Number.isFinite(latNum) && Number.isFinite(lngNum)) {
        candidates.push({ lat: latNum, lng: lngNum });
      }
    };

    if (raw.latitude !== undefined && raw.longitude !== undefined) {
      push(raw.latitude, raw.longitude);
    }
    if (raw.lat !== undefined && raw.lon !== undefined) {
      push(raw.lat, raw.lon);
    }
    if (raw.location && typeof raw.location === 'object') {
      const loc = raw.location;
      push(loc.lat ?? loc.latitude, loc.lng ?? loc.lon ?? loc.longitude);
    }
    if (raw.geo && typeof raw.geo === 'object') {
      push(raw.geo.lat, raw.geo.lng ?? raw.geo.lon);
    }
    if (raw.coordinates && typeof raw.coordinates === 'object') {
      push(raw.coordinates.lat ?? raw.coordinates.latitude, raw.coordinates.lng ?? raw.coordinates.lon ?? raw.coordinates.longitude);
    }

    if (candidates.length) return candidates[0];

    const fallback = FALLBACK_COORDS[raw.id] || FALLBACK_COORDS[raw.name];
    if (fallback) return fallback;
    return null;
  }

  function normalizeClinic(raw) {
    const id = raw.id || raw.clinicId || '';
    const name = raw.name || raw.clinicName || '名称未設定';
    const address = raw.address || '';
    const serviceCategories = collectServiceCategories(raw);
    const bodySites = collectBodySites(raw);
    const tags = buildTags(raw);
    const searchText = buildSearchText(raw);
    const coordinates = resolveCoordinates(raw);
    const media = raw.media && typeof raw.media === 'object' ? raw.media : {};
    const modes = raw.modes && typeof raw.modes === 'object' ? raw.modes : {};
    const access = raw.access && typeof raw.access === 'object' ? raw.access : {};
    const accessSummaryParts = [];
    if (access.nearestStation) accessSummaryParts.push(access.nearestStation);
    if (access.bus) accessSummaryParts.push(access.bus);
    return {
      id,
      name,
      address,
      tags,
      serviceCategories,
      bodySites,
      searchText,
      raw,
      lat: coordinates?.lat ?? null,
      lng: coordinates?.lng ?? null,
      media,
      modes,
      access,
      accessSummary: accessSummaryParts.join(' / ')
    };
  }

  function populateOptions(selectEl, values, placeholder) {
    if (!selectEl) return;
    selectEl.innerHTML = '';
    const option = document.createElement('option');
    option.value = '';
    option.textContent = placeholder;
    selectEl.appendChild(option);
    values.forEach((value) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = value;
      selectEl.appendChild(opt);
    });
  }

  function updateStatus() {
    if (!els.status) return;
    if (!state.rawClinics.length) {
      els.status.innerHTML = '<p class="text-sm text-slate-500">登録済みのクリニックがまだありません。管理画面から登録してください。</p>';
      return;
    }
    const total = state.rawClinics.length;
    const filtered = state.filtered.length;
    els.status.innerHTML = `
      <p class="text-sm text-slate-600">${total}件中 ${filtered}件を表示しています。</p>
      <p class="text-xs text-slate-500">キーワード・診療メニューで絞り込み、クリニックを選択すると詳細ページへ遷移します。</p>
    `;
  }

  function renderClinics(clinics) {
    if (!els.clinicList || !els.resultCount) return;
    if (!clinics.length) {
      els.clinicList.innerHTML = `
        <div class="px-4 py-5 text-sm text-slate-500">
          条件に合致するクリニックはありませんでした。検索条件を調整してください。
        </div>
      `;
      els.resultCount.textContent = '0 件';
      updateMarkers([]);
      return;
    }

    clinics.forEach((clinic, idx) => {
      clinic._listIndex = idx + 1;
    });

    els.clinicList.innerHTML = clinics.map((clinic) => {
      const safeAddress = clinic.address || '住所未登録';
      const tagsMarkup = clinic.tags.map((tag) => `<span class="inline-flex items-center rounded bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-700">${tag}</span>`).join('');
      const modesMarkup = buildModesBadges(clinic.modes);
      const mediaRecord = clinic.media.logoSmall || clinic.media.logoLarge || clinic.media.facade;
      const logoUrl = mediaUrl(mediaRecord, { width: 120, height: 120, fit: 'cover' });
      const logoMarkup = logoUrl
        ? `<img src="${logoUrl}" alt="" class="h-full w-full object-cover" />`
        : '<span class="text-[11px] text-slate-400">Logo</span>';
      const accessSummary = clinic.accessSummary ? `<div class="mt-1 text-xs text-slate-500">${clinic.accessSummary}</div>` : '';
      return `
        <button class="w-full px-4 py-4 text-left hover:bg-slate-50 transition" data-clinic-id="${clinic.id}">
          <div class="flex items-start gap-3">
            <span class="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-emerald-500 px-2 text-xs font-semibold text-white">${clinic._listIndex}</span>
            <div class="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-white shadow-sm">${logoMarkup}</div>
            <div class="flex-1">
              <div class="text-sm font-semibold text-blue-900">${clinic.name}</div>
              <div class="mt-1 text-xs text-slate-500">${safeAddress}</div>
              ${accessSummary}
              <div class="mt-2 flex flex-wrap gap-1">${modesMarkup}${tagsMarkup}</div>
            </div>
          </div>
        </button>
      `;
    }).join('');
    els.resultCount.textContent = `${clinics.length} 件`;
    updateMarkers(clinics);
  }

  function applyFilters() {
    const keyword = nk(els.keyword?.value).toLowerCase();
    const service = nk(els.service?.value);
    const bodySite = nk(els.bodySite?.value);

    state.filtered = state.clinics.filter((clinic) => {
      if (service && !clinic.serviceCategories.includes(service)) return false;
      if (bodySite && !clinic.bodySites.includes(bodySite)) return false;
      if (!keyword) return true;
      return clinic.searchText.includes(keyword);
    });

    renderClinics(state.filtered);
    updateStatus();
  }

  function ensureInfoWindow(maps) {
    if (!state.infoWindow) {
      state.infoWindow = new maps.InfoWindow();
    }
    return state.infoWindow;
  }

  function clearMarkers() {
    if (!state.markers || !state.markers.length) return;
    state.markers.forEach((marker) => marker.setMap(null));
    state.markers = [];
  }

  async function getMaps() {
    if (state.maps) return state.maps;
    if (state.mapsPromise) return state.mapsPromise;
    const loader = window.NCD && typeof window.NCD.loadGoogleMaps === 'function'
      ? window.NCD.loadGoogleMaps
      : null;
    if (!loader) {
      return Promise.reject(new Error('Google Maps loader is not available. Make sure googleMapsLoader.js is loaded.'));
    }
    state.mapsPromise = loader({ libraries: ['places'] })
      .then((maps) => {
        state.maps = maps;
        return maps;
      })
      .catch((err) => {
        state.mapsPromise = null;
        throw err;
      });
    return state.mapsPromise;
  }

  async function ensureMap() {
    if (state.map) return state.map;
    if (!els.mapView) return null;
    const maps = await getMaps();
    const map = new maps.Map(els.mapView, {
      center: DEFAULT_CENTER,
      zoom: 13,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
    });
    state.map = map;
    ensureInfoWindow(maps);
    return map;
  }

  async function updateMarkers(clinics) {
    try {
      const map = await ensureMap();
      if (!map) return;

      const maps = await getMaps();
      const infoWindow = ensureInfoWindow(maps);

      clearMarkers();

      if (!clinics || !clinics.length) {
        map.setCenter(DEFAULT_CENTER);
        map.setZoom(13);
        return;
      }

      const bounds = new maps.LatLngBounds();
      let hasBounds = false;
      let createdMarkers = 0;
      let lastPosition = null;

      clinics.forEach((clinic) => {
        if (!Number.isFinite(clinic.lat) || !Number.isFinite(clinic.lng)) return;
        const markerLabel = typeof clinic._listIndex === 'number'
          ? {
              text: String(clinic._listIndex),
              color: '#ffffff',
              fontSize: '12px',
              fontWeight: '600'
            }
          : undefined;

        const marker = new maps.Marker({
          position: { lat: clinic.lat, lng: clinic.lng },
          map,
          title: clinic.name,
          label: markerLabel,
        });

        marker.addListener('click', () => {
          const summary = clinic.accessSummary ? `<div class="text-xs text-slate-500">${clinic.accessSummary}</div>` : '';
          const content = `
            <div class="space-y-1 max-w-[230px]">
              <div class="font-semibold text-sm text-blue-900">${clinic.name}</div>
              <div class="text-xs text-slate-600">${clinic.address || '住所未登録'}</div>
              ${summary}
              <a class="text-xs text-emerald-600 hover:underline" href="clinicSummary.html?id=${encodeURIComponent(clinic.id)}">詳細を表示</a>
            </div>
          `;
          infoWindow.setContent(content);
          infoWindow.open({ map, anchor: marker });
        });

        state.markers.push(marker);
        bounds.extend(marker.getPosition());
        hasBounds = true;
        createdMarkers += 1;
        lastPosition = marker.getPosition();
      });

      if (!createdMarkers) {
        map.setCenter(DEFAULT_CENTER);
        map.setZoom(13);
      } else if (createdMarkers === 1 && lastPosition) {
        map.setCenter(lastPosition);
        map.setZoom(14);
      } else if (hasBounds) {
        map.fitBounds(bounds, { top: 32, right: 32, bottom: 32, left: 32 });
      }
    } catch (err) {
      console.error('Failed to update map markers', err);
      if (!state.map && els.mapView) {
        els.mapView.innerHTML = '<div class="flex h-full items-center justify-center text-sm text-red-600">地図の読み込みに失敗しました。Google Maps APIキーを設定してください。</div>';
      }
    }
  }

  async function loadClinics() {
    try {
      if (els.status) {
        els.status.innerHTML = '<p class="text-sm text-slate-500">クリニック情報を読み込み中です...</p>';
      }
      const runner = () => fetchJson('/api/listClinics');
      const useWrap = typeof window.wrapWithLoading === 'function';
      const data = useWrap
        ? await window.wrapWithLoading(runner, 'クリニックを読み込み中...', els.clinicList)
        : await runner();
      const clinics = Array.isArray(data.clinics) ? data.clinics : [];
      state.rawClinics = clinics;
      state.clinics = clinics.map(normalizeClinic);
      state.filtered = [...state.clinics];

      const serviceSet = new Set();
      state.clinics.forEach((clinic) => {
        clinic.serviceCategories.forEach((category) => serviceSet.add(category));
      });
      state.serviceOptions = Array.from(serviceSet).sort((a, b) => a.localeCompare(b, 'ja'));

      const bodySiteSet = new Set();
      state.clinics.forEach((clinic) => {
        clinic.bodySites.forEach((site) => bodySiteSet.add(site));
      });
      state.bodySiteOptions = Array.from(bodySiteSet).sort((a, b) => a.localeCompare(b, 'ja'));

      populateOptions(els.service, state.serviceOptions, '診療メニューで絞り込み');
      populateOptions(els.bodySite, state.bodySiteOptions, '関連部位で絞り込み');

      renderClinics(state.filtered);
      updateStatus();
    } catch (err) {
      console.error(err);
      if (els.status) {
        els.status.innerHTML = `<p class="text-sm text-red-600">クリニック情報の取得に失敗しました: ${err.message}</p>`;
      }
    }
  }

  function bindElements() {
    els.keyword = document.getElementById('mapKeyword');
    els.bodySite = document.getElementById('mapBodySite');
    els.service = document.getElementById('mapService');
    els.status = document.getElementById('mapStatus');
    els.clinicList = document.getElementById('mapClinicList');
    els.resultCount = document.getElementById('mapResultCount');
    els.mapView = document.getElementById('mapView');

    if (els.keyword) els.keyword.addEventListener('input', applyFilters);
    if (els.bodySite) els.bodySite.addEventListener('change', applyFilters);
    if (els.service) els.service.addEventListener('change', applyFilters);

    if (els.clinicList) {
      els.clinicList.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-clinic-id]');
        if (!button) return;
        const clinicId = button.getAttribute('data-clinic-id');
        if (!clinicId) return;
        window.location.href = `clinicSummary.html?id=${encodeURIComponent(clinicId)}`;
      });
    }
  }

  async function init() {
    bindElements();
    if (els.clinicList) {
      els.clinicList.innerHTML = '<div class="px-4 py-5 text-sm text-slate-500">クリニック情報を読み込み中です...</div>';
    }
    if (els.resultCount) {
      els.resultCount.textContent = '--';
    }
    try {
      await ensureMap();
    } catch (err) {
      console.error('Failed to initialize map', err);
    }
    await loadClinics();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
