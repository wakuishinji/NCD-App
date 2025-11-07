#!/usr/bin/env node
/**
 * Backfill facility_services / facility_tests / facility_qualifications tables
 * by hitting the public Worker API. Each /api/clinicDetail call hydrates the
 * KV metadata into D1 and ensures missing collections are restored.
 */
import { setTimeout as sleep } from 'node:timers/promises';

const DEFAULT_API_BASE = 'https://ncd-app.altry.workers.dev';
const CONCURRENCY = Number(process.env.CONCURRENCY || 5);

const args = process.argv.slice(2);
const apiBase = (process.env.API_BASE || args[0] || DEFAULT_API_BASE).replace(/\/$/, '');

async function fetchJson(path) {
  const res = await fetch(`${apiBase}${path}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} ${path} ${text}`);
  }
  return res.json();
}

async function listAllClinics(limit = 200) {
  let offset = 0;
  const clinics = [];
  while (true) {
    const data = await fetchJson(`/api/listClinics?limit=${limit}&offset=${offset}`);
    const chunk = Array.isArray(data?.clinics) ? data.clinics : [];
    clinics.push(...chunk);
    if (chunk.length < limit) break;
    offset += limit;
  }
  return clinics;
}

async function hydrateClinic(clinicId) {
  const res = await fetch(`${apiBase}/api/clinicDetail?id=${encodeURIComponent(clinicId)}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`clinicDetail ${clinicId} HTTP ${res.status} ${text}`);
  }
  await res.json().catch(() => ({}));
}

async function run() {
  console.log(`Backfilling facility collections via ${apiBase}`);
  const clinics = await listAllClinics();
  console.log(`Found ${clinics.length} clinics`);
  let completed = 0;
  let failed = 0;
  const queue = [...clinics];
  const workers = Array.from({ length: CONCURRENCY }).map(async (_, idx) => {
    while (queue.length) {
      const clinic = queue.shift();
      if (!clinic?.id) {
        completed += 1;
        continue;
      }
      const start = Date.now();
      try {
        await hydrateClinic(clinic.id);
        completed += 1;
        if (completed % 20 === 0) {
          console.log(`worker#${idx} hydrated ${completed}/${clinics.length}`);
        }
      } catch (err) {
        failed += 1;
        console.error(`worker#${idx} failed clinic ${clinic.id}:`, err.message);
        // retry later
        await sleep(500);
        queue.push(clinic);
      }
      const elapsed = Date.now() - start;
      if (elapsed < 50) {
        await sleep(50 - elapsed);
      }
    }
  });
  await Promise.all(workers);
  console.log(`Backfill completed. success=${completed - failed}, failed=${failed}`);
  if (failed) {
    process.exitCode = 1;
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
