(function setupMhlwCsvUtils(global) {
  const FACILITY_COLUMNS = [
    'prefCode', 'prefName', 'cityCode', 'cityName',
    'facilityId', 'facilityName', 'facilityNameKana',
    'postalCode', 'address', 'phone', 'fax',
    'longitude', 'latitude', 'foundingType', 'careType', 'bedCount',
  ];

  const SCHEDULE_DAY_DEFS = [
    { label: '月曜', start: ['月_診療開始時間'], end: ['月_診療終了時間'], receptionStart: ['月_外来受付開始時間'], receptionEnd: ['月_外来受付終了時間'] },
    { label: '火曜', start: ['火_診療開始時間'], end: ['火_診療終了時間'], receptionStart: ['火_外来受付開始時間'], receptionEnd: ['火_外来受付終了時間'] },
    { label: '水曜', start: ['水_診療開始時間'], end: ['水_診療終了時間'], receptionStart: ['水_外来受付開始時間'], receptionEnd: ['水_外来受付終了時間'] },
    { label: '木曜', start: ['木_診療開始時間'], end: ['木_診療終了時間'], receptionStart: ['木_外来受付開始時間'], receptionEnd: ['木_外来受付終了時間'] },
    { label: '金曜', start: ['金_診療開始時間'], end: ['金_診療終了時間'], receptionStart: ['金_外来受付開始時間'], receptionEnd: ['金_外来受付終了時間'] },
    { label: '土曜', start: ['土_診療開始時間'], end: ['土_診療終了時間'], receptionStart: ['土_外来受付開始時間'], receptionEnd: ['土_外来受付終了時間'] },
    { label: '日曜', start: ['日_診療開始時間'], end: ['日_診療終了時間'], receptionStart: ['日_外来受付開始時間'], receptionEnd: ['日_外来受付終了時間'] },
    { label: '祝日', start: ['祝_診療開始時間'], end: ['祝_診療終了時間'], receptionStart: ['祝_外来受付開始時間'], receptionEnd: ['祝_外来受付終了時間'] },
  ];

  function normalizeFacilityId(value) {
    return (value || '').toString().trim().replace(/\s+/g, '').toUpperCase();
  }

  function normalizeFacilityType(value) {
    const normalized = (value || '').toString().trim().toLowerCase();
    if (!normalized) return 'clinic';
    if (normalized.includes('hospital')) return 'hospital';
    if (normalized.includes('clinic')) return 'clinic';
    return normalized;
  }

  function normalizeKana(value) {
    return (value || '').toString().replace(/\s+/g, '');
  }

  function normalizePostalCode(value) {
    return (value || '').toString().replace(/[^0-9]/g, '').slice(0, 7);
  }

  function normalizeAddress(value) {
    return (value || '').toString().trim();
  }

  function normalizeTime(value) {
    const raw = (value || '').toString().trim();
    if (!raw) return '';
    const digits = raw.replace(/[^0-9]/g, '');
    if (digits.length === 4) {
      return `${digits.slice(0, 2)}:${digits.slice(2)}`;
    }
    if (digits.length === 3) {
      return `${digits.slice(0, 1)}:${digits.slice(1).padStart(2, '0')}`;
    }
    if (raw.includes(':')) return raw;
    return raw;
  }

  function normalizeHeaderName(header) {
    return (header ?? '').toString().replace(/^\ufeff/, '').trim();
  }

  function detectColumnIndex(headers, keywords) {
    const normalizedHeaders = headers.map((col) => normalizeHeaderName(col).toLowerCase().replace(/\s+/g, ''));
    for (const keyword of keywords) {
      const normalizedKeyword = keyword.toLowerCase().replace(/\s+/g, '');
      const index = normalizedHeaders.findIndex((header) => header.includes(normalizedKeyword));
      if (index !== -1) return index;
    }
    return -1;
  }

  function parseCsvLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '"') {
        const next = line[i + 1];
        if (inQuotes && next === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result;
  }

  function isGzipFile(file) {
    const name = (file?.name || '').toLowerCase();
    const type = (file?.type || '').toLowerCase();
    return name.endsWith('.gz') || type.includes('gzip');
  }

  function createCsvDecoder(file) {
    const type = (file?.type || '').toLowerCase();
    if (type.includes('shift_jis') || type.includes('shift-jis') || type.includes('cp932')) {
      try {
        return new TextDecoder('shift_jis');
      } catch (_) {
        // ignore
      }
    }
    return new TextDecoder('utf-8');
  }

  async function* readCsvLines(file) {
    if (!file || typeof file.stream !== 'function') {
      throw new Error('Invalid File object');
    }
    let stream = file.stream();
    if (isGzipFile(file) && globalThis.DecompressionStream) {
      stream = stream.pipeThrough(new DecompressionStream('gzip'));
    }
    const reader = stream.getReader();
    const decoder = createCsvDecoder(file);
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (value) {
        buffer += decoder.decode(value, { stream: !done });
      }
      if (done) {
        buffer += decoder.decode(new Uint8Array(), { stream: false });
      }
      const lines = buffer.split(/\r?\n/);
      if (!done) {
        buffer = lines.pop() ?? '';
      } else {
        buffer = '';
      }
      for (const line of lines) {
        if (line) yield line;
      }
      if (done) break;
    }
    if (buffer) yield buffer;
  }

  async function importFacilityFile(file, facilityType, { onProgress } = {}) {
    const facilities = [];
    let headerParsed = false;
    let processed = 0;
    const normalizedType = normalizeFacilityType(facilityType);
    for await (const line of readCsvLines(file)) {
      if (!headerParsed) {
        headerParsed = true;
        continue;
      }
      const columns = parseCsvLine(line);
      const record = {};
      for (let i = 0; i < FACILITY_COLUMNS.length; i += 1) {
        record[FACILITY_COLUMNS[i]] = columns[i] ?? '';
      }
      const facilityId = normalizeFacilityId(record.facilityId);
      if (!facilityId) continue;
      const longitude = record.longitude ? Number(record.longitude) : undefined;
      const latitude = record.latitude ? Number(record.latitude) : undefined;
      facilities.push({
        facilityId,
        facilityType: normalizedType,
        name: (record.facilityName || '').trim(),
        nameKana: normalizeKana(record.facilityNameKana),
        postalCode: normalizePostalCode(record.postalCode),
        address: normalizeAddress(record.address),
        prefecture: (record.prefName || '').trim(),
        city: (record.cityName || '').trim(),
        phone: (record.phone || '').trim(),
        fax: (record.fax || '').trim(),
        longitude: Number.isFinite(longitude) ? longitude : undefined,
        latitude: Number.isFinite(latitude) ? latitude : undefined,
        foundingType: record.foundingType || '',
        careType: record.careType || '',
        bedCount: record.bedCount ? Number(record.bedCount) : undefined,
        scheduleEntries: [],
        mhlwDepartments: [],
      });
      processed += 1;
      if (onProgress && processed % 200 === 0) {
        onProgress({ kind: 'facility', facilityType: normalizedType, processed, done: false });
        await new Promise((resolve) => setTimeout(resolve));
      }
    }
    if (onProgress) {
      onProgress({ kind: 'facility', facilityType: normalizedType, processed, done: true });
    }
    return facilities;
  }

  function toNormalizedValue(value) {
    return (value ?? '').toString().trim();
  }

  async function importScheduleFile(file, facilityType, { onProgress } = {}) {
    const schedules = [];
    const facilityTypeNormalized = normalizeFacilityType(facilityType);
    let headers = [];
    let facilityIdIndex = -1;
    let headerParsed = false;
    let processed = 0;
    for await (const line of readCsvLines(file)) {
      const record = parseCsvLine(line);
      if (!headerParsed) {
        headers = record.map((header) => normalizeHeaderName(header));
        facilityIdIndex = detectColumnIndex(headers, ['facilityid', '医療機関コード', 'medicalinstitutioncode', 'id']);
        headerParsed = true;
        continue;
      }
      const row = {};
      headers.forEach((header, idx) => {
        row[header] = record[idx] ?? '';
      });
      const facilityIdRaw = facilityIdIndex !== -1
        ? record[facilityIdIndex]
        : row.ID || row.facilityId || row['医療機関コード'] || row['medicalInstitutionCode'];
      const facilityId = normalizeFacilityId(facilityIdRaw);
      if (!facilityId) continue;

      const departmentCode = toNormalizedValue(row['診療科目コード'] || row['診療科コード'] || row.departmentCode || row['departmentcode']);
      const departmentName = toNormalizedValue(row['診療科目名'] || row['診療科名'] || row.department || row['department']);
      const slotType = toNormalizedValue(row['診療時間帯'] || row['区分'] || row['slot'] || row['pattern']);

      for (const def of SCHEDULE_DAY_DEFS) {
        const startTime = normalizeTime(row[def.start?.[0]]);
        const endTime = normalizeTime(row[def.end?.[0]]);
        const receptionStart = normalizeTime(row[def.receptionStart?.[0]]);
        const receptionEnd = normalizeTime(row[def.receptionEnd?.[0]]);
        if (!startTime && !endTime && !receptionStart && !receptionEnd) continue;
        schedules.push({
          facilityId,
          facilityType: facilityTypeNormalized,
          departmentCode,
          department: departmentName,
          slotType,
          day: def.label,
          startTime,
          endTime,
          receptionStart,
          receptionEnd,
        });
      }
      processed += 1;
      if (onProgress && processed % 200 === 0) {
        onProgress({ kind: 'schedule', facilityType: facilityTypeNormalized, processed, done: false });
        await new Promise((resolve) => setTimeout(resolve));
      }
    }
    if (onProgress) {
      onProgress({ kind: 'schedule', facilityType: facilityTypeNormalized, processed, done: true });
    }
    return schedules;
  }

  function mergeFacilitiesAndSchedules(facilities, schedules) {
    const map = new Map();
    facilities.forEach((facility) => {
      map.set(facility.facilityId, {
        ...facility,
        scheduleEntries: facility.scheduleEntries || [],
        mhlwDepartments: facility.mhlwDepartments || [],
      });
    });
    schedules.forEach((schedule) => {
      const existing = map.get(schedule.facilityId) || {
        facilityId: schedule.facilityId,
        facilityType: schedule.facilityType,
        scheduleEntries: [],
        mhlwDepartments: [],
      };
      const entries = existing.scheduleEntries || [];
      entries.push(schedule);
      const departments = new Set(existing.mhlwDepartments || []);
      if (schedule.department) departments.add(schedule.department);
      map.set(schedule.facilityId, {
        ...existing,
        scheduleEntries: entries,
        mhlwDepartments: Array.from(departments),
      });
    });
    return Array.from(map.values());
  }

  async function buildMhlwDatasetFromCsv({
    clinicFacilityFile,
    clinicScheduleFile,
    hospitalFacilityFile,
    hospitalScheduleFile,
  }, { onProgress } = {}) {
    const [clinicFacilities, hospitalFacilities, clinicSchedules, hospitalSchedules] = await Promise.all([
      importFacilityFile(clinicFacilityFile, 'clinic', { onProgress }),
      importFacilityFile(hospitalFacilityFile, 'hospital', { onProgress }),
      importScheduleFile(clinicScheduleFile, 'clinic', { onProgress }),
      importScheduleFile(hospitalScheduleFile, 'hospital', { onProgress }),
    ]);

    const facilities = mergeFacilitiesAndSchedules(
      [...clinicFacilities, ...hospitalFacilities],
      [...clinicSchedules, ...hospitalSchedules],
    );

    return {
      facilities,
      stats: {
        facilityCount: clinicFacilities.length + hospitalFacilities.length,
        scheduleCount: clinicSchedules.length + hospitalSchedules.length,
      },
    };
  }

  global.MhlwCsvUtils = {
    buildMhlwDatasetFromCsv,
  };
})(typeof window !== 'undefined' ? window : globalThis);
