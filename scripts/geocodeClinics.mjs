#!/usr/bin/env node
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

const argv = process.argv.slice(2);
const options = {
  apiBase: process.env.NCD_API_BASE || 'https://ncd-app.altry.workers.dev',
  dryRun: true,
  delayMs: Number(process.env.NCD_MIGRATE_DELAY_MS || 0),
  includeExisting: false,
};

function showHelp() {
  console.log(`Usage: geocodeClinics [options]

` +
    `Options:
` +
    `  --api-base <url>       API base URL (default: ${options.apiBase})
` +
    `  --commit               Apply updates (default: dry-run)
` +
    `  --include-existing     上書き対象に既に座標を持つクリニックも含める
` +
    `  --delay <ms>           各更新間の待機時間
` +
    `  --help                 Show this help text`);
}

for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === '--api-base' && argv[i + 1]) {
    options.apiBase = argv[++i];
  } else if (arg === '--commit') {
    options.dryRun = false;
  } else if (arg === '--delay' && argv[i + 1]) {
    options.delayMs = Number(argv[++i]) || 0;
  } else if (arg === '--include-existing') {
    options.includeExisting = true;
  } else if (arg === '--help' || arg === '-h') {
    showHelp();
    process.exit(0);
  }
}

function nk(value) {
  return (value ?? '').toString().trim();
}

async function requestJson(path, init = {}) {
  const headers = { 'Content-Type': 'application/json', ...(init.headers || {}) };
  const res = await fetch(`${options.apiBase.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`, {
    ...init,
    headers,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return res.json();
  }
  return res.text();
}

async function fetchClientConfig() {
  try {
    const data = await requestJson('/api/client-config', { method: 'GET', headers: {} });
    const key = nk(data?.googleMapsApiKey);
    if (!key) {
      throw new Error('googleMapsApiKey is empty');
    }
    return key;
  } catch (err) {
    throw new Error(`failed to fetch Google Maps API key: ${err.message}`);
  }
}

async function geocodeAddress(address, apiKey) {
  if (!address) return null;
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', address);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('language', 'ja');
  url.searchParams.set('region', 'JP');
  const res = await fetch(url.toString());
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`geocode HTTP ${res.status}: ${text}`);
  }
  const data = await res.json();
  if (data.status === 'ZERO_RESULTS') return null;
  if (data.status !== 'OK') {
    throw new Error(`geocode status ${data.status}`);
  }
  const first = Array.isArray(data.results) ? data.results[0] : null;
  if (!first || !first.geometry?.location) return null;
  return {
    lat: first.geometry.location.lat,
    lng: first.geometry.location.lng,
    formattedAddress: first.formatted_address || address,
  };
}

function hasCoordinates(clinic) {
  const lat = clinic?.latitude ?? clinic?.location?.lat ?? clinic?.location?.latitude;
  const lng = clinic?.longitude ?? clinic?.location?.lng ?? clinic?.location?.lon ?? clinic?.location?.longitude;
  return Number.isFinite(lat) && Number.isFinite(lng);
}

async function main() {
  console.log(`[info] API base: ${options.apiBase}`);
  console.log(`[info] mode: ${options.dryRun ? 'dry-run' : 'commit'}`);
  const apiKey = await fetchClientConfig();
  console.log('[info] fetched Google Maps API key.');
  const list = await requestJson('/api/listClinics');
  const clinics = Array.isArray(list?.clinics) ? list.clinics : [];
  let updated = 0;
  for (const clinic of clinics) {
    const id = clinic?.id || clinic?.name;
    if (!id) continue;
    const addressParts = [clinic.postalCode, clinic.address].map(nk).filter(Boolean);
    if (!addressParts.length) continue;
    const address = addressParts.join(' ');
    if (!options.includeExisting && hasCoordinates(clinic)) {
      continue;
    }
    console.log(`[info] geocoding ${clinic.name} (${id}) -> ${address}`);
    try {
      const coords = await geocodeAddress(address, apiKey);
      if (!coords) {
        console.log('[warn] geocode returned no result');
        continue;
      }
      if (options.dryRun) {
        console.log(`[dry-run] would update ${clinic.name} with lat=${coords.lat}, lng=${coords.lng}`);
        continue;
      }
      const payload = {
        ...clinic,
        latitude: coords.lat,
        longitude: coords.lng,
        location: {
          ...(clinic.location || {}),
          lat: coords.lat,
          lng: coords.lng,
          formattedAddress: coords.formattedAddress,
          source: 'bulk-geocode',
          geocodedAt: new Date().toISOString(),
        },
      };
      await requestJson('/api/updateClinic', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      updated += 1;
      console.log(`[updated] ${clinic.name}`);
      if (options.delayMs > 0) {
        await delay(options.delayMs);
      }
    } catch (err) {
      console.warn(`[warn] failed to geocode ${clinic.name}: ${err.message}`);
    }
  }
  console.log(`[info] processed ${clinics.length} clinics, updated ${updated}.`);
}

main().catch(err => {
  console.error('[error]', err);
  process.exitCode = 1;
});
