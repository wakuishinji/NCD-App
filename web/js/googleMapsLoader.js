(function () {
  const DEFAULT_LANGUAGE = 'ja';
  const DEFAULT_REGION = 'JP';

  const globalNamespace = window.NCD || (window.NCD = {});
  const DEFAULT_CONFIG_ENDPOINT = '/api/client-config';
  const STORAGE_KEY = 'ncdGoogleMapsApiKey';
  let cachedApiKey = '';
  let configFetchPromise = null;

  async function fetchApiKeyFromServer() {
    const endpointRaw = typeof window.NCD_CLIENT_CONFIG_ENDPOINT === 'string'
      ? window.NCD_CLIENT_CONFIG_ENDPOINT.trim()
      : '';
    const endpoint = endpointRaw || DEFAULT_CONFIG_ENDPOINT;

    if (!configFetchPromise) {
      configFetchPromise = fetch(endpoint, { method: 'GET' })
        .then(async (res) => {
          if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
          }
          return res.json();
        })
        .then((data) => {
          const key = typeof data?.googleMapsApiKey === 'string' ? data.googleMapsApiKey.trim() : '';
          return key;
        })
        .catch((err) => {
          console.warn('Failed to fetch Google Maps API key from server', err);
          return '';
        })
        .finally(() => {
          configFetchPromise = null;
        });
    }

    try {
      return await configFetchPromise;
    } catch (err) {
      console.warn('Google Maps key fetch promise rejected', err);
      return '';
    }
  }

  async function resolveApiKey(explicitKey) {
    if (explicitKey && explicitKey.trim()) {
      cachedApiKey = explicitKey.trim();
      return cachedApiKey;
    }

    if (cachedApiKey) {
      return cachedApiKey;
    }

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && stored.trim()) {
        cachedApiKey = stored.trim();
        return cachedApiKey;
      }
    } catch (err) {
      console.warn('Failed to read Google Maps API key from localStorage', err);
    }

    if (typeof window.NCD_GOOGLE_MAPS_API_KEY === 'string' && window.NCD_GOOGLE_MAPS_API_KEY.trim()) {
      cachedApiKey = window.NCD_GOOGLE_MAPS_API_KEY.trim();
      return cachedApiKey;
    }

    const meta = document.querySelector('meta[name="ncd-google-maps-key"]');
    if (meta && meta.content && meta.content.trim()) {
      cachedApiKey = meta.content.trim();
      return cachedApiKey;
    }

    const serverKey = await fetchApiKeyFromServer();
    if (serverKey) {
      cachedApiKey = serverKey;
      try {
        localStorage.setItem(STORAGE_KEY, serverKey);
      } catch (err) {
        console.warn('Failed to cache Google Maps API key into localStorage', err);
      }
      return cachedApiKey;
    }

    return '';
  }

  function buildScriptUrl({ apiKey, libraries, language, region, mapIds }) {
    const params = new URLSearchParams();
    params.set('key', apiKey);

    if (Array.isArray(libraries) && libraries.length) {
      params.set('libraries', libraries.join(','));
    }

    params.set('language', language || DEFAULT_LANGUAGE);
    params.set('region', region || DEFAULT_REGION);

    if (Array.isArray(mapIds) && mapIds.length) {
      params.set('map_ids', mapIds.join(','));
    }

    const callbackName = '__ncdGoogleMapsInit';
    params.set('callback', callbackName);

    return { url: `https://maps.googleapis.com/maps/api/js?${params.toString()}`, callbackName };
  }

  let loadingPromise = null;

  async function loadGoogleMaps(options = {}) {
    if (window.google && window.google.maps) {
      return window.google.maps;
    }

    if (loadingPromise) {
      return loadingPromise;
    }

    const apiKey = await resolveApiKey(options.apiKey);
    if (!apiKey) {
      return Promise.reject(new Error('Google Maps API key is not configured. Set window.NCD_GOOGLE_MAPS_API_KEY or localStorage "ncdGoogleMapsApiKey".'));
    }

    const { url, callbackName } = buildScriptUrl({
      apiKey,
      libraries: options.libraries || ['places'],
      language: options.language,
      region: options.region,
      mapIds: options.mapIds
    });

    loadingPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src^="https://maps.googleapis.com/maps/api/js"]`);
      if (existing) {
        existing.addEventListener('load', () => resolve(window.google.maps));
        existing.addEventListener('error', () => reject(new Error('Failed to load Google Maps script.')));
        return;
      }

      window[callbackName] = () => {
        delete window[callbackName];
        resolve(window.google.maps);
      };

      const script = document.createElement('script');
      script.src = url;
      script.async = true;
      script.defer = true;
      script.onerror = () => {
        delete window[callbackName];
        reject(new Error('Failed to load Google Maps script.'));
      };

      document.head.appendChild(script);
    }).finally(() => {
      loadingPromise = null;
    });

    return loadingPromise;
  }

  globalNamespace.loadGoogleMaps = loadGoogleMaps;
})();
