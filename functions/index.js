import { ensureUniqueId, normalizeSlug, randomSlug } from './idUtils.js';
import { createToken, verifyToken, invalidateSession } from './lib/auth/jwt.js';
import { hashPassword, verifyPassword } from './lib/auth/password.js';
import { generateInviteToken, generateTokenString } from './lib/auth/token.js';
import { createMailClient } from './lib/mail/index.js';
import {
  listMasterItemsD1,
  listMasterCategoriesD1,
  upsertMasterItemD1,
  replaceMasterCategoriesD1,
  deleteMasterItemD1,
  getMasterItemByIdD1,
  getMasterItemByLegacyKeyD1,
  getMasterItemByAliasD1,
  getMasterItemByComparableD1,
} from './lib/masterStore.js';

const MASTER_TYPE_LIST = [
  'test',
  'service',
  'qual',
  'department',
  'committee',
  'group',
  'position',
  'facility',
  'symptom',
  'bodySite',
  'society',
  'vaccination',
  'vaccinationType',
  'checkup',
  'checkupType',
];
const MASTER_ALLOWED_TYPES = new Set(MASTER_TYPE_LIST);
const MASTER_TYPE_HELP_TEXT = MASTER_TYPE_LIST.join(' / ');
const CATEGORY_ALLOWED_TYPES = [
  'test',
  'service',
  'qual',
  'department',
  'committee',
  'group',
  'position',
  'facility',
  'symptom',
  'bodySite',
  'vaccinationType',
  'checkupType',
];
const CATEGORY_TYPE_HELP_TEXT = CATEGORY_ALLOWED_TYPES.join(' / ');

const ACCESS_TOKEN_TTL_SECONDS = 60 * 15; // 15 min
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const REFRESH_TOKEN_TTL_REMEMBER_SECONDS = 60 * 60 * 24 * 30; // 30 days
const SESSION_META_PREFIX = 'session:meta:';
const INVITE_TTL_SECONDS = 60 * 60 * 24; // 24 hours
const INVITE_RESEND_COOLDOWN_SECONDS = 60 * 5; // 5 minutes
const PASSWORD_RESET_TTL_SECONDS = 60 * 30; // 30 minutes
const PASSWORD_RESET_LOOKUP_PREFIX = 'resetToken:';
const MIN_PASSWORD_LENGTH = 8;

const ADMIN_REQUEST_PREFIX = 'adminRequest:';
const ADMIN_REQUEST_PENDING_EMAIL_PREFIX = 'adminRequest:pendingEmail:';
const ADMIN_REQUEST_DEFAULT_LIMIT = 20;

const ORGANIZATION_ID_PREFIX = 'organization:';
const ORGANIZATION_ID_KEY_PREFIX = 'organization:id:';
const ORGANIZATION_SLUG_INDEX_PREFIX = 'organization:slug:';
const DEFAULT_ORGANIZATION_SLUG = 'default';
const DEFAULT_ORGANIZATION_ID = `${ORGANIZATION_ID_PREFIX}${DEFAULT_ORGANIZATION_SLUG}`;

const MHLW_FACILITIES_R2_KEY = 'mhlw/facilities.json';
const MHLW_FACILITIES_META_KEY = 'mhlw:facilities:meta';
const MHLW_FACILITIES_CACHE_CONTROL = 'public, max-age=600, stale-while-revalidate=3600';
const MHLW_UPLOAD_META_PREFIX = 'mhlw:upload:';
const MHLW_UPLOAD_SESSION_TTL_SECONDS = 60 * 60; // 1 hour
const MHLW_DEFAULT_PART_SIZE = 8 * 1024 * 1024; // 8 MB
const PREFECTURES = [
  { code: '01', name: '北海道' },
  { code: '02', name: '青森県' },
  { code: '03', name: '岩手県' },
  { code: '04', name: '宮城県' },
  { code: '05', name: '秋田県' },
  { code: '06', name: '山形県' },
  { code: '07', name: '福島県' },
  { code: '08', name: '茨城県' },
  { code: '09', name: '栃木県' },
  { code: '10', name: '群馬県' },
  { code: '11', name: '埼玉県' },
  { code: '12', name: '千葉県' },
  { code: '13', name: '東京都' },
  { code: '14', name: '神奈川県' },
  { code: '15', name: '新潟県' },
  { code: '16', name: '富山県' },
  { code: '17', name: '石川県' },
  { code: '18', name: '福井県' },
  { code: '19', name: '山梨県' },
  { code: '20', name: '長野県' },
  { code: '21', name: '岐阜県' },
  { code: '22', name: '静岡県' },
  { code: '23', name: '愛知県' },
  { code: '24', name: '三重県' },
  { code: '25', name: '滋賀県' },
  { code: '26', name: '京都府' },
  { code: '27', name: '大阪府' },
  { code: '28', name: '兵庫県' },
  { code: '29', name: '奈良県' },
  { code: '30', name: '和歌山県' },
  { code: '31', name: '鳥取県' },
  { code: '32', name: '島根県' },
  { code: '33', name: '岡山県' },
  { code: '34', name: '広島県' },
  { code: '35', name: '山口県' },
  { code: '36', name: '徳島県' },
  { code: '37', name: '香川県' },
  { code: '38', name: '愛媛県' },
  { code: '39', name: '高知県' },
  { code: '40', name: '福岡県' },
  { code: '41', name: '佐賀県' },
  { code: '42', name: '長崎県' },
  { code: '43', name: '熊本県' },
  { code: '44', name: '大分県' },
  { code: '45', name: '宮崎県' },
  { code: '46', name: '鹿児島県' },
  { code: '47', name: '沖縄県' },
];

const MHLW_FACILITY_FIELD_ALIASES = {
  facilityId: ['ID', '"ID"', '医療機関コード', 'medicalinstitutioncode'],
  officialName: ['正式名称'],
  officialNameKana: ['正式名称（フリガナ）', '正式名称(フリガナ)'],
  shortName: ['略称'],
  shortNameKana: ['略称（フリガナ）', '略称(フリガナ)'],
  englishName: ['英語表記（ローマ字表記）', '英語表記', '英語表記(ローマ字表記)'],
  facilityCategory: ['機関区分'],
  prefectureCode: ['都道府県コード'],
  cityCode: ['市区町村コード'],
  address: ['所在地'],
  latitude: ['所在地座標（緯度）', '緯度'],
  longitude: ['所在地座標（経度）', '経度'],
  homepageUrl: ['案内用ホームページアドレス', '案内用ホームページ', 'ホームページアドレス'],
  weeklyClosedMon: ['毎週決まった曜日に休診（月）'],
  weeklyClosedTue: ['毎週決まった曜日に休診（火）'],
  weeklyClosedWed: ['毎週決まった曜日に休診（水）'],
  weeklyClosedThu: ['毎週決まった曜日に休診（木）'],
  weeklyClosedFri: ['毎週決まった曜日に休診（金）'],
  weeklyClosedSat: ['毎週決まった曜日に休診（土）'],
  weeklyClosedSun: ['毎週決まった曜日に休診（日）'],
  periodicClosedWeek1Mon: ['決まった週に休診（定期週）第1週（月）'],
  periodicClosedWeek1Tue: ['決まった週に休診（定期週）第1週（火）'],
  periodicClosedWeek1Wed: ['決まった週に休診（定期週）第1週（水）'],
  periodicClosedWeek1Thu: ['決まった週に休診（定期週）第1週（木）'],
  periodicClosedWeek1Fri: ['決まった週に休診（定期週）第1週（金）'],
  periodicClosedWeek1Sat: ['決まった週に休診（定期週）第1週（土）'],
  periodicClosedWeek1Sun: ['決まった週に休診（定期週）第1週（日）'],
  periodicClosedWeek2Mon: ['決まった週に休診（定期週）第2週（月）'],
  periodicClosedWeek2Tue: ['決まった週に休診（定期週）第2週（火）'],
  periodicClosedWeek2Wed: ['決まった週に休診（定期週）第2週（水）'],
  periodicClosedWeek2Thu: ['決まった週に休診（定期週）第2週（木）'],
  periodicClosedWeek2Fri: ['決まった週に休診（定期週）第2週（金）'],
  periodicClosedWeek2Sat: ['決まった週に休診（定期週）第2週（土）'],
  periodicClosedWeek2Sun: ['決まった週に休診（定期週）第2週（日）'],
  periodicClosedWeek3Mon: ['決まった週に休診（定期週）第3週（月）'],
  periodicClosedWeek3Tue: ['決まった週に休診（定期週）第3週（火）'],
  periodicClosedWeek3Wed: ['決まった週に休診（定期週）第3週（水）'],
  periodicClosedWeek3Thu: ['決まった週に休診（定期週）第3週（木）'],
  periodicClosedWeek3Fri: ['決まった週に休診（定期週）第3週（金）'],
  periodicClosedWeek3Sat: ['決まった週に休診（定期週）第3週（土）'],
  periodicClosedWeek3Sun: ['決まった週に休診（定期週）第3週（日）'],
  periodicClosedWeek4Mon: ['決まった週に休診（定期週）第4週（月）'],
  periodicClosedWeek4Tue: ['決まった週に休診（定期週）第4週（火）'],
  periodicClosedWeek4Wed: ['決まった週に休診（定期週）第4週（水）'],
  periodicClosedWeek4Thu: ['決まった週に休診（定期週）第4週（木）'],
  periodicClosedWeek4Fri: ['決まった週に休診（定期週）第4週（金）'],
  periodicClosedWeek4Sat: ['決まった週に休診（定期週）第4週（土）'],
  periodicClosedWeek4Sun: ['決まった週に休診（定期週）第4週（日）'],
  periodicClosedWeek5Mon: ['決まった週に休診（定期週）第5週（月）'],
  periodicClosedWeek5Tue: ['決まった週に休診（定期週）第5週（火）'],
  periodicClosedWeek5Wed: ['決まった週に休診（定期週）第5週（水）'],
  periodicClosedWeek5Thu: ['決まった週に休診（定期週）第5週（木）'],
  periodicClosedWeek5Fri: ['決まった週に休診（定期週）第5週（金）'],
  periodicClosedWeek5Sat: ['決まった週に休診（定期週）第5週（土）'],
  periodicClosedWeek5Sun: ['決まった週に休診（定期週）第5週（日）'],
  holidayClosed: ['祝日に休診'],
  otherClosedNote: ['その他の休診日（gw、お盆等）', 'その他の休診日'],
  bedsGeneral: ['一般病床'],
  bedsLongTerm: ['療養病床'],
  bedsLongTermMedical: ['療養病床のうち医療保険適用'],
  bedsLongTermCare: ['療養病床のうち介護保険適用'],
  bedsPsychiatric: ['精神病床'],
  bedsTuberculosis: ['結核病床'],
  bedsInfectious: ['感染症病床'],
  bedsTotal: ['合計病床数'],
};

const MHLW_WEEKDAY_DEFS = [
  { key: 'mon', alias: 'Mon' },
  { key: 'tue', alias: 'Tue' },
  { key: 'wed', alias: 'Wed' },
  { key: 'thu', alias: 'Thu' },
  { key: 'fri', alias: 'Fri' },
  { key: 'sat', alias: 'Sat' },
  { key: 'sun', alias: 'Sun' },
];

const MHLW_PERIODIC_WEEK_DEFS = [
  { key: 'week1', alias: 'Week1' },
  { key: 'week2', alias: 'Week2' },
  { key: 'week3', alias: 'Week3' },
  { key: 'week4', alias: 'Week4' },
  { key: 'week5', alias: 'Week5' },
];

const MHLW_SCHEDULE_DAY_DEFS = [
  { label: '月曜', start: ['月_診療開始時間'], end: ['月_診療終了時間'], receptionStart: ['月_外来受付開始時間'], receptionEnd: ['月_外来受付終了時間'] },
  { label: '火曜', start: ['火_診療開始時間'], end: ['火_診療終了時間'], receptionStart: ['火_外来受付開始時間'], receptionEnd: ['火_外来受付終了時間'] },
  { label: '水曜', start: ['水_診療開始時間'], end: ['水_診療終了時間'], receptionStart: ['水_外来受付開始時間'], receptionEnd: ['水_外来受付終了時間'] },
  { label: '木曜', start: ['木_診療開始時間'], end: ['木_診療終了時間'], receptionStart: ['木_外来受付開始時間'], receptionEnd: ['木_外来受付終了時間'] },
  { label: '金曜', start: ['金_診療開始時間'], end: ['金_診療終了時間'], receptionStart: ['金_外来受付開始時間'], receptionEnd: ['金_外来受付終了時間'] },
  { label: '土曜', start: ['土_診療開始時間'], end: ['土_診療終了時間'], receptionStart: ['土_外来受付開始時間'], receptionEnd: ['土_外来受付終了時間'] },
  { label: '日曜', start: ['日_診療開始時間'], end: ['日_診療終了時間'], receptionStart: ['日_外来受付開始時間'], receptionEnd: ['日_外来受付終了時間'] },
  { label: '祝日', start: ['祝_診療開始時間'], end: ['祝_診療終了時間'], receptionStart: ['祝_外来受付開始時間'], receptionEnd: ['祝_外来受付終了時間'] },
];

const SECURITY_QUESTIONS = [
  { id: 'first_trip', label: '初めて旅行した場所は？' },
  { id: 'childhood_nickname', label: '子どもの頃のあだ名は？' },
  { id: 'favorite_teacher', label: '好きだった先生の名前は？' },
  { id: 'favorite_subject', label: '好きだった学校の科目は？' },
  { id: 'sports_club', label: '小・中学校で入っていたクラブは？' },
  { id: 'favorite_food', label: '好きだった給食（または家庭料理）は？' },
  { id: 'memorable_place', label: 'よく遊んでいた場所は？' },
  { id: 'memorable_song', label: 'よく聴いていた歌のタイトルは？' },
];
const SECURITY_ANSWER_FORMATS = new Set(['hiragana', 'katakana']);
const MHLW_SYNC_STATUSES = new Set(['pending', 'linked', 'manual', 'not_found']);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 共通CORSヘッダー
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, Cache-Control, Content-Encoding",
    };

    // ===== OPTIONS (CORSプリフライト)
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (url.pathname.startsWith('/assets/')) {
      if (!env.MEDIA) {
        return new Response('R2 bucket is not configured.', { status: 500 });
      }
      const key = decodeURIComponent(url.pathname.replace(/^\/assets\//, ''));
      if (!key) {
        return new Response('Bad Request', { status: 400 });
      }
      const object = await env.MEDIA.get(key);
      if (!object) {
        return new Response('Not Found', { status: 404 });
      }
      const headers = new Headers({
        'Cache-Control': 'public, max-age=86400',
      });
      if (object.httpMetadata?.contentType) {
        headers.set('Content-Type', object.httpMetadata.contentType);
      }
      if (object.httpMetadata?.contentDisposition) {
        headers.set('Content-Disposition', object.httpMetadata.contentDisposition);
      }
      return new Response(object.body, { headers });
    }

    // ============================================================
    // <<< START: UTILS >>>
    // ============================================================
    const CLINIC_SCHEMA_VERSION = 3; // 施設スキーマのバージョン

    function nk(s) {
      if (typeof s === 'string') return s.trim();
      if (s === null || s === undefined) return '';
      if (typeof s === 'number' || typeof s === 'boolean') return String(s).trim();
      if (typeof s === 'object') return '';
      return '';
    }

    function optionalString(value) {
      const trimmed = nk(value);
      return trimmed ? trimmed : null;
    }

    function sanitizeUrl(value) {
      const trimmed = nk(value);
      if (!trimmed) return null;
      if (/^https?:\/\//i.test(trimmed)) {
        return trimmed;
      }
      if (/^www\./i.test(trimmed)) {
        return `https://${trimmed}`;
      }
      if (/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:\/.*)?$/.test(trimmed)) {
        return `https://${trimmed}`;
      }
      return trimmed;
    }

    function normalizeStringArray(value) {
      if (Array.isArray(value)) {
        return Array.from(new Set(value.map(v => nk(v)).filter(Boolean)));
      }
      if (typeof value === "string") {
        const single = nk(value);
        return single ? [single] : [];
      }
      return [];
    }

    function normalizeIdentifier(value) {
      const trimmed = nk(value);
      return trimmed ? trimmed.toLowerCase() : "";
    }

    function normalizeEmail(value) {
      const trimmed = nk(value);
      if (!trimmed) return "";
      return trimmed.toLowerCase();
    }

    function normalizeMhlwFacilityId(value) {
      const trimmed = nk(value);
      if (!trimmed) return '';
      return trimmed.replace(/\s+/g, '').toUpperCase();
    }

    function normalizeFacilityType(value) {
      const normalized = nk(value).toLowerCase();
      if (!normalized) return 'clinic';
      if (normalized.includes('hospital')) return 'hospital';
      if (normalized.includes('clinic')) return 'clinic';
      return normalized;
    }

    function hasFacilitiesD1(env) {
      return !!env.MASTERS_D1 && typeof env.MASTERS_D1.prepare === 'function';
    }

    function clonePlain(value) {
      if (value === undefined || value === null) return {};
      try {
        return JSON.parse(JSON.stringify(value));
      } catch (err) {
        console.warn('[clinic] failed to clone record', err);
        return { ...value };
      }
    }

    function toNumberOrNull(value) {
      const num = Number(value);
      return Number.isFinite(num) ? num : null;
    }

    function normalizeStringArray(input) {
      const result = [];
      const seen = new Set();
      const append = (value) => {
        if (value === undefined || value === null) return;
        const text = nk(typeof value === 'string' ? value : String(value));
        if (!text) return;
        if (seen.has(text)) return;
        seen.add(text);
        result.push(text);
      };
      if (Array.isArray(input)) {
        input.forEach(append);
      } else if (typeof input === 'string' || typeof input === 'number' || typeof input === 'boolean') {
        append(input);
      }
      return result;
    }

    function normalizeClinicDepartmentsValue(value) {
      const normalized = { master: [], others: [] };
      if (!value) return normalized;
      if (Array.isArray(value)) {
        normalized.master = normalizeStringArray(value);
        return normalized;
      }
      if (typeof value === 'object') {
        normalized.master = normalizeStringArray(value.master || value.standard || []);
        const others = normalizeStringArray(value.others || value.freeform || []);
        normalized.others = others.filter((name) => !normalized.master.includes(name));
        return normalized;
      }
      return normalized;
    }

    function normalizeAccessInfoValue(value) {
      if (!value || typeof value !== 'object') return null;
      const nearestStation = normalizeStringArray(value.nearestStation || value.station);
      const bus = normalizeStringArray(value.bus);
      const barrierFree = normalizeStringArray(value.barrierFree || value.barrier_free);
      const parkingRaw = value.parking && typeof value.parking === 'object' ? value.parking : {};
      const parking = {};
      if (Object.prototype.hasOwnProperty.call(parkingRaw, 'available')) {
        parking.available = !!parkingRaw.available;
      }
      if (Object.prototype.hasOwnProperty.call(parkingRaw, 'capacity')) {
        const capacity = Number(parkingRaw.capacity);
        parking.capacity = Number.isFinite(capacity) ? capacity : null;
      }
      const parkingNotes = nk(parkingRaw.notes);
      if (parkingNotes) parking.notes = parkingNotes;
      if (!Object.keys(parking).length) delete parking.available;
      const notes = nk(value.notes);
      const summary = nk(value.summary);
      const source = nk(value.source);
      const access = {};
      if (nearestStation.length) access.nearestStation = nearestStation;
      if (bus.length) access.bus = bus;
      if (barrierFree.length) access.barrierFree = barrierFree;
      if (Object.keys(parking).length) access.parking = parking;
      if (notes) access.notes = notes;
      if (summary) access.summary = summary;
      if (source) access.source = source;
      return Object.keys(access).length ? access : null;
    }

    function normalizeModesPayloadValue(value) {
      if (!value) return null;
      const selectedSource = Array.isArray(value.selected)
        ? value.selected
        : Array.isArray(value)
          ? value
          : [];
      const selected = normalizeStringArray(selectedSource);
      const metaSource = value.meta && typeof value.meta === 'object' && !Array.isArray(value.meta)
        ? value.meta
        : {};
      const meta = {};
      selected.forEach((slug) => {
        const entry = metaSource[slug] && typeof metaSource[slug] === 'object' ? metaSource[slug] : {};
        const label = nk(entry.label || entry.name || slug);
        const icon = nk(entry.icon);
        const color = nk(entry.color);
        const orderValue = Number(entry.order);
        const notes = nk(entry.notes || entry.desc);
        const metaEntry = {};
        metaEntry.label = label || slug;
        if (icon) metaEntry.icon = icon;
        if (color) metaEntry.color = color;
        if (Number.isFinite(orderValue)) metaEntry.order = orderValue;
        if (notes) metaEntry.notes = notes;
        if (Object.keys(metaEntry).length) {
          meta[slug] = metaEntry;
        } else {
          meta[slug] = { label: metaEntry.label };
        }
      });
      if (!selected.length && !Object.keys(meta).length) return null;
      const result = {};
      if (selected.length) result.selected = selected;
      if (Object.keys(meta).length) result.meta = meta;
      const source = nk(value.source);
      if (source) result.source = source;
      return result;
    }

    function normalizeSelectionPayloadValue(value) {
      if (!value || typeof value !== 'object') return null;
      const selectedSource = Array.isArray(value.selected)
        ? value.selected
        : Array.isArray(value)
          ? value
          : [];
      const selected = normalizeStringArray(selectedSource);
      const metaSource = value.meta && typeof value.meta === 'object' && !Array.isArray(value.meta)
        ? value.meta
        : {};
      const meta = {};
      selected.forEach((slug) => {
        const entry = metaSource[slug] && typeof metaSource[slug] === 'object' ? metaSource[slug] : {};
        const category = nk(entry.category);
        const name = nk(entry.name || entry.label || slug);
        const desc = nk(entry.desc || entry.description);
        const referenceUrl = nk(entry.referenceUrl || entry.reference_url);
        const notes = nk(entry.notes);
        const metaEntry = {};
        if (category) metaEntry.category = category;
        if (name && name !== slug) metaEntry.name = name;
        else if (name) metaEntry.name = name;
        if (desc) metaEntry.desc = desc;
        if (referenceUrl) metaEntry.referenceUrl = referenceUrl;
        if (notes) metaEntry.notes = notes;
        if (Object.keys(metaEntry).length) {
          meta[slug] = metaEntry;
        } else if (name) {
          meta[slug] = { name };
        }
      });
      if (!selected.length && !Object.keys(meta).length) return null;
      const result = {};
      if (selected.length) result.selected = selected;
      if (Object.keys(meta).length) result.meta = meta;
      const source = nk(value.source);
      if (source) result.source = source;
      return result;
    }

    function normalizeExtraPayload(value) {
      if (!value || typeof value !== 'object') return null;
      try {
        return JSON.parse(JSON.stringify(value));
      } catch (err) {
        console.warn('[clinic] failed to clone extra payload', err);
        return { ...value };
      }
    }

    function computeAccessSummary(access) {
      if (!access || typeof access !== 'object') return '';
      if (access.summary && nk(access.summary)) return nk(access.summary);
      const parts = [];
      const station = Array.isArray(access.nearestStation) ? access.nearestStation[0] : access.nearestStation;
      const bus = Array.isArray(access.bus) ? access.bus[0] : access.bus;
      if (station) parts.push(nk(station));
      if (bus) parts.push(nk(bus));
      if (access.notes) parts.push(nk(access.notes));
      return parts.filter(Boolean).join(' / ');
    }

    function normalizeClinicRecord(input) {
      if (!input || typeof input !== 'object') return null;
      const clinic = clonePlain(input);
      clinic.schemaVersion = CLINIC_SCHEMA_VERSION;
      clinic.schema_version = CLINIC_SCHEMA_VERSION;
      clinic.organizationId = clinic.organizationId || clinic.organization_id || null;

      const basic = clonePlain(clinic.basic);
      const assignFromBasic = (field, basicKey) => {
        if (!basic[basicKey] && clinic[field]) {
          basic[basicKey] = nk(clinic[field]);
        }
        if (!clinic[field] && basic[basicKey]) {
          clinic[field] = nk(basic[basicKey]);
        }
      };
      assignFromBasic('name', 'name');
      assignFromBasic('displayName', 'displayName');
      assignFromBasic('officialName', 'officialName');
      assignFromBasic('shortName', 'shortName');
      assignFromBasic('nameKana', 'nameKana');
      assignFromBasic('shortNameKana', 'shortNameKana');
      assignFromBasic('officialNameKana', 'officialNameKana');
      assignFromBasic('postalCode', 'postalCode');
      assignFromBasic('address', 'address');
      assignFromBasic('phone', 'phone');
      assignFromBasic('fax', 'fax');
      assignFromBasic('email', 'email');
      assignFromBasic('website', 'website');
      assignFromBasic('prefecture', 'prefecture');
      assignFromBasic('city', 'city');

      const pickPreferred = (...values) => {
        for (const value of values) {
          const trimmed = nk(value);
          if (trimmed) return trimmed;
        }
        return '';
      };
      const setOptional = (obj, key, value) => {
        if (!obj) return;
        const trimmed = nk(value);
        if (trimmed) obj[key] = trimmed;
        else delete obj[key];
      };

      const resolvedOfficialName = pickPreferred(
        clinic.officialName,
        basic.officialName,
        clinic.mhlwFacilityName,
        clinic.name,
      );
      const resolvedDisplayName = pickPreferred(
        clinic.displayName,
        clinic.name,
        clinic.shortName,
        basic.displayName,
        basic.name,
        basic.shortName,
        resolvedOfficialName,
      );
      const resolvedShortName = pickPreferred(
        clinic.shortName,
        basic.shortName,
        resolvedDisplayName,
        resolvedOfficialName,
      );
      const resolvedName = pickPreferred(
        clinic.name,
        resolvedDisplayName,
        resolvedShortName,
        resolvedOfficialName,
      );
      const resolvedOfficialNameKana = pickPreferred(
        clinic.officialNameKana,
        basic.officialNameKana,
        clinic.mhlwFacilityNameKana,
      );
      const resolvedNameKana = pickPreferred(
        clinic.nameKana,
        basic.nameKana,
      );
      const resolvedShortNameKana = pickPreferred(
        clinic.shortNameKana,
        basic.shortNameKana,
        resolvedNameKana,
      );

      clinic.name = resolvedName;
      basic.name = resolvedName;

      setOptional(clinic, 'displayName', resolvedDisplayName || resolvedName);
      setOptional(basic, 'displayName', resolvedDisplayName || resolvedName);

      setOptional(clinic, 'officialName', resolvedOfficialName || resolvedName);
      setOptional(basic, 'officialName', resolvedOfficialName || resolvedName);

      setOptional(clinic, 'shortName', resolvedShortName || resolvedDisplayName || resolvedName);
      setOptional(basic, 'shortName', resolvedShortName || resolvedDisplayName || resolvedName);

      setOptional(clinic, 'officialNameKana', resolvedOfficialNameKana);
      setOptional(basic, 'officialNameKana', resolvedOfficialNameKana);

      setOptional(clinic, 'nameKana', resolvedNameKana);
      setOptional(basic, 'nameKana', resolvedNameKana);

      setOptional(clinic, 'shortNameKana', resolvedShortNameKana || resolvedNameKana);
      setOptional(basic, 'shortNameKana', resolvedShortNameKana || resolvedNameKana);

      clinic.basic = basic;

      const location = clinic.location && typeof clinic.location === 'object'
        ? { ...clinic.location }
        : {};
      const lat = toNumberOrNull(location.lat ?? location.latitude);
      const lng = toNumberOrNull(location.lng ?? location.longitude);
      clinic.location = {};
      if (lat !== null) clinic.location.lat = lat;
      if (lng !== null) clinic.location.lng = lng;
      if (location.formattedAddress) clinic.location.formattedAddress = nk(location.formattedAddress);
      if (location.source) clinic.location.source = nk(location.source);
      if (location.geocodedAt) clinic.location.geocodedAt = location.geocodedAt;
      if (location.geocodeStatus) clinic.location.geocodeStatus = location.geocodeStatus;
      if (!Object.keys(clinic.location).length) clinic.location = null;

      const resolvedMhlw = clinic.mhlwFacilityId
        ? normalizeMhlwFacilityId(clinic.mhlwFacilityId)
        : normalizeMhlwFacilityId(clinic.mhlwId || clinic.facilityId || '');
      clinic.mhlwFacilityId = resolvedMhlw || null;
      const hasMhlwId = Boolean(clinic.mhlwFacilityId);
      const syncStatusRaw = nk(clinic.mhlwSyncStatus || clinic.mhlw_sync_status);
      let syncStatus = syncStatusRaw ? syncStatusRaw.toLowerCase() : '';
      if (!MHLW_SYNC_STATUSES.has(syncStatus)) {
        syncStatus = '';
      }
      if (hasMhlwId) {
        if (!syncStatus || syncStatus === 'not_found') {
          syncStatus = 'linked';
        }
      } else if (syncStatus === 'linked') {
        syncStatus = '';
      }
      clinic.mhlwSyncStatus = syncStatus || 'pending';
      clinic.mhlwManualNote = nk(clinic.mhlwManualNote || clinic.mhlw_manual_note) || null;

      clinic.clinicType = normalizeFacilityType(clinic.clinicType || clinic.facilityType || '');
      clinic.facilityType = clinic.clinicType;

      const ensureArrayUnique = (value) => {
        if (!Array.isArray(value)) return [];
        return Array.from(new Set(value.map((item) => (typeof item === 'string' ? item.trim() : item)).filter(Boolean)));
      };
      clinic.managerAccounts = ensureArrayUnique(clinic.managerAccounts);
      clinic.staffMemberships = ensureArrayUnique(clinic.staffMemberships);
      clinic.services = Array.isArray(clinic.services) ? clinic.services : [];
      clinic.tests = Array.isArray(clinic.tests) ? clinic.tests : [];
      clinic.qualifications = Array.isArray(clinic.qualifications) ? clinic.qualifications : [];
      clinic.pendingInvites = Array.isArray(clinic.pendingInvites) ? clinic.pendingInvites : [];
      clinic.searchFacets = ensureArrayUnique(clinic.searchFacets);

      const normalizedDepartments = normalizeClinicDepartmentsValue(clinic.departments);
      if (normalizedDepartments.master.length || normalizedDepartments.others.length) {
        clinic.departments = normalizedDepartments;
      } else {
        delete clinic.departments;
      }
      if (Array.isArray(clinic.mhlwDepartments)) {
        clinic.mhlwDepartments = normalizeStringArray(clinic.mhlwDepartments);
        if (!clinic.mhlwDepartments.length) delete clinic.mhlwDepartments;
      }

      const normalizedAccess = normalizeAccessInfoValue(clinic.access);
      if (normalizedAccess) {
        normalizedAccess.summary = normalizedAccess.summary || computeAccessSummary(normalizedAccess);
        clinic.access = normalizedAccess;
        clinic.accessSummary = normalizedAccess.summary || null;
      } else {
        delete clinic.access;
        delete clinic.accessSummary;
      }

      const normalizedModes = normalizeModesPayloadValue(clinic.modes);
      if (normalizedModes) {
        clinic.modes = normalizedModes;
      } else {
        delete clinic.modes;
      }

      const normalizedVaccinations = normalizeSelectionPayloadValue(clinic.vaccinations);
      if (normalizedVaccinations) {
        clinic.vaccinations = normalizedVaccinations;
      } else {
        delete clinic.vaccinations;
      }

      const normalizedCheckups = normalizeSelectionPayloadValue(clinic.checkups);
      if (normalizedCheckups) {
        clinic.checkups = normalizedCheckups;
      } else {
        delete clinic.checkups;
      }

      const normalizedExtra = normalizeExtraPayload(clinic.extra || clinic.extraPayload);
      if (normalizedExtra && Object.keys(normalizedExtra).length) {
        clinic.extra = normalizedExtra;
      } else {
        delete clinic.extra;
      }
      delete clinic.extraPayload;

      if (!clinic.status) clinic.status = 'active';
      return clinic;
    }

    function clinicToD1Row(clinic) {
      const normalized = normalizeClinicRecord(clinic);
      if (!normalized) return null;
      const basic = normalized.basic || {};
      const location = normalized.location || {};
      const displayName = nk(basic.displayName || normalized.displayName || basic.name || normalized.name);
      const name = nk(basic.name || normalized.name || displayName);
      const shortName = nk(basic.shortName || normalized.shortName || displayName || name);
      const officialName = nk(basic.officialName || normalized.officialName || name);
      return {
        id: normalized.id,
        externalId: normalized.mhlwFacilityId || null,
        name,
        shortName,
        officialName,
        prefecture: nk(basic.prefecture || normalized.prefecture),
        city: nk(basic.city || normalized.city),
        address: nk(basic.address || normalized.address),
        postalCode: nk(basic.postalCode || normalized.postalCode),
        latitude: toNumberOrNull(location.lat),
        longitude: toNumberOrNull(location.lng),
        facilityType: normalized.clinicType || 'clinic',
        mhlwSyncStatus: normalized.mhlwSyncStatus || 'pending',
        phone: nk(basic.phone),
        fax: nk(basic.fax),
        email: nk(basic.email),
        website: nk(basic.website),
        organizationId: normalized.organizationId || null,
        metadata: JSON.stringify(normalized),
      };
    }

    function generateCollectionId(facilityId, type, entry) {
      const candidate = nk(entry?.id || entry?.masterId || entry?.masterKey);
      if (candidate) return candidate;
      if (typeof crypto?.randomUUID === 'function') {
        return `${facilityId}:${type}:${crypto.randomUUID()}`;
      }
      return `${facilityId}:${type}:${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    async function replaceFacilityCollectionsD1(env, clinic) {
      if (!hasFacilitiesD1(env) || !clinic?.id) return;
      const facilityId = clinic.id;
      const organizationId = clinic.organizationId || null;
      try {
        await env.MASTERS_D1.prepare('DELETE FROM facility_services WHERE facility_id = ?').bind(facilityId).run();
        await env.MASTERS_D1.prepare('DELETE FROM facility_tests WHERE facility_id = ?').bind(facilityId).run();
        await env.MASTERS_D1.prepare('DELETE FROM facility_qualifications WHERE facility_id = ?').bind(facilityId).run();
        await env.MASTERS_D1.prepare('DELETE FROM facility_departments WHERE facility_id = ?').bind(facilityId).run();
        await env.MASTERS_D1.prepare('DELETE FROM facility_beds WHERE facility_id = ?').bind(facilityId).run();
        await env.MASTERS_D1.prepare('DELETE FROM facility_modes WHERE facility_id = ?').bind(facilityId).run();
        await env.MASTERS_D1.prepare('DELETE FROM facility_vaccinations WHERE facility_id = ?').bind(facilityId).run();
        await env.MASTERS_D1.prepare('DELETE FROM facility_checkups WHERE facility_id = ?').bind(facilityId).run();
        await env.MASTERS_D1.prepare('DELETE FROM facility_access_info WHERE facility_id = ?').bind(facilityId).run();
        await env.MASTERS_D1.prepare('DELETE FROM facility_extra WHERE facility_id = ?').bind(facilityId).run();
      } catch (err) {
        console.error('[clinic] failed to clear facility collections', err);
        return;
      }

      const insertService = env.MASTERS_D1.prepare(`
        INSERT INTO facility_services (id, facility_id, master_id, name, category, source, notes, organization_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          facility_id = excluded.facility_id,
          master_id = excluded.master_id,
          name = excluded.name,
          category = excluded.category,
          source = excluded.source,
          notes = excluded.notes,
          organization_id = excluded.organization_id,
          updated_at = strftime('%s','now')
      `);
      for (const svc of clinic.services || []) {
        const masterId = nk(svc.masterId || svc.masterKey || '');
        const name = nk(svc.name || svc.masterName || '');
        if (!masterId && !name) continue;
        const recordId = generateCollectionId(facilityId, 'service', svc);
        try {
          await insertService.bind(
            recordId,
            facilityId,
            masterId || null,
            name || (masterId ? masterId : null),
            nk(svc.category || svc.type || ''),
            nk(svc.source || ''),
            nk(svc.notes || ''),
            organizationId,
          ).run();
        } catch (err) {
          console.error('[clinic] failed to insert facility_service', err);
        }
      }

      const insertTest = env.MASTERS_D1.prepare(`
        INSERT INTO facility_tests (id, facility_id, master_id, name, category, source, notes, organization_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          facility_id = excluded.facility_id,
          master_id = excluded.master_id,
          name = excluded.name,
          category = excluded.category,
          source = excluded.source,
          notes = excluded.notes,
          organization_id = excluded.organization_id,
          updated_at = strftime('%s','now')
      `);
      for (const test of clinic.tests || []) {
        const masterId = nk(test.masterId || test.masterKey || '');
        const name = nk(test.name || test.masterName || '');
        if (!masterId && !name) continue;
        const recordId = generateCollectionId(facilityId, 'test', test);
        try {
          await insertTest.bind(
            recordId,
            facilityId,
            masterId || null,
            name || (masterId ? masterId : null),
            nk(test.category || test.type || ''),
            nk(test.source || ''),
            nk(test.notes || ''),
            organizationId,
          ).run();
        } catch (err) {
          console.error('[clinic] failed to insert facility_test', err);
        }
      }

      const insertQual = env.MASTERS_D1.prepare(`
        INSERT INTO facility_qualifications (id, facility_id, master_id, name, issuer, obtained_at, notes, organization_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          facility_id = excluded.facility_id,
          master_id = excluded.master_id,
          name = excluded.name,
          issuer = excluded.issuer,
          obtained_at = excluded.obtained_at,
          notes = excluded.notes,
          organization_id = excluded.organization_id,
          updated_at = strftime('%s','now')
      `);
      for (const qual of clinic.qualifications || []) {
        const masterId = nk(qual.masterId || qual.masterKey || '');
        const name = nk(qual.name || qual.masterName || '');
        if (!masterId && !name) continue;
        const recordId = generateCollectionId(facilityId, 'qual', qual);
        try {
          await insertQual.bind(
            recordId,
            facilityId,
            masterId || null,
            name || (masterId ? masterId : null),
            nk(qual.issuer || qual.organization || ''),
            nk(qual.obtainedAt || ''),
            nk(qual.notes || ''),
            organizationId,
          ).run();
        } catch (err) {
          console.error('[clinic] failed to insert facility_qualification', err);
        }
      }

      const toDepartmentCode = (name) => {
        const normalized = sanitizeKeySegment(name || '');
        return normalized ? `department:${normalized}` : null;
      };

      const departmentRows = [];
      const manualDepartments = clinic.departments && typeof clinic.departments === 'object' ? clinic.departments : null;
      const manualMaster = Array.isArray(manualDepartments?.master) ? manualDepartments.master : [];
      const manualOthers = Array.isArray(manualDepartments?.others) ? manualDepartments.others : [];
      const mhlwDepartments = Array.isArray(clinic.mhlwDepartments) ? clinic.mhlwDepartments : [];
      const seenDept = new Set();

      manualMaster.forEach((name, index) => {
        const trimmed = nk(name);
        if (!trimmed) return;
        const code = toDepartmentCode(trimmed);
        const key = `manual:${code || trimmed}`;
        if (seenDept.has(key)) return;
        seenDept.add(key);
        departmentRows.push({
          name: trimmed,
          code,
          source: nk(manualDepartments?.source) || 'manual',
          isPrimary: index === 0 ? 1 : 0,
        });
      });

      manualOthers.forEach((name) => {
        const trimmed = nk(name);
        if (!trimmed) return;
        if (manualMaster.some((item) => nk(item) === trimmed)) return;
        const key = `manual-other:${trimmed}`;
        if (seenDept.has(key)) return;
        seenDept.add(key);
        departmentRows.push({
          name: trimmed,
          code: null,
          source: 'manual-other',
          isPrimary: 0,
        });
      });

      mhlwDepartments.forEach((name) => {
        const trimmed = nk(name);
        if (!trimmed) return;
        const code = toDepartmentCode(trimmed);
        const key = `mhlw:${code || trimmed}`;
        if (seenDept.has(key)) return;
        seenDept.add(key);
        departmentRows.push({
          name: trimmed,
          code,
          source: 'mhlw',
          isPrimary: 0,
        });
      });

      if (departmentRows.length) {
        const insertDepartment = env.MASTERS_D1.prepare(`
          INSERT INTO facility_departments (
            id, facility_id, organization_id, department_code, name, category, is_primary, source, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            facility_id = excluded.facility_id,
            organization_id = excluded.organization_id,
            department_code = excluded.department_code,
            name = excluded.name,
            category = excluded.category,
            is_primary = excluded.is_primary,
            source = excluded.source,
            notes = excluded.notes,
            updated_at = strftime('%s','now')
        `);
        for (const row of departmentRows) {
          try {
            await insertDepartment.bind(
              generateCollectionId(facilityId, 'department', row),
              facilityId,
              organizationId,
              row.code || null,
              row.name || null,
              null,
              row.isPrimary ? 1 : 0,
              row.source || null,
              null,
            ).run();
          } catch (err) {
            console.error('[clinic] failed to insert facility_department', err);
          }
        }
      }

      const bedRows = [];
      const bedSeen = new Set();
      const appendBedRow = (type, count, source, notes) => {
        const normalizedType = nk(type) || 'general';
        const numericCount = Number(count);
        if (!Number.isFinite(numericCount)) return;
        const key = `${normalizedType}:${source || ''}`;
        if (bedSeen.has(key)) return;
        bedSeen.add(key);
        bedRows.push({
          type: normalizedType,
          count: Math.max(0, Math.trunc(numericCount)),
          source: source || null,
          notes: nk(notes) || null,
        });
      };
      if (Array.isArray(clinic.beds)) {
        clinic.beds.forEach((entry) => {
          if (!entry || typeof entry !== 'object') return;
          appendBedRow(entry.type || entry.bedType, entry.count, entry.source || 'manual', entry.notes);
        });
      }
      if (clinic.facilityAttributes && typeof clinic.facilityAttributes === 'object') {
        const bedCount = Number(clinic.facilityAttributes.bedCount);
        if (Number.isFinite(bedCount)) {
          appendBedRow('total', bedCount, 'manual', clinic.facilityAttributes.bedNotes);
        }
      }
      if (clinic.mhlwBedCounts && typeof clinic.mhlwBedCounts === 'object') {
        Object.entries(clinic.mhlwBedCounts).forEach(([type, count]) => {
          appendBedRow(type, count, 'mhlw');
        });
      }
      if (bedRows.length) {
        const insertBed = env.MASTERS_D1.prepare(`
          INSERT INTO facility_beds (id, facility_id, organization_id, bed_type, count, source, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            facility_id = excluded.facility_id,
            organization_id = excluded.organization_id,
            bed_type = excluded.bed_type,
            count = excluded.count,
            source = excluded.source,
            notes = excluded.notes,
            updated_at = strftime('%s','now')
        `);
        for (const row of bedRows) {
          try {
            await insertBed.bind(
              generateCollectionId(facilityId, 'bed', row),
              facilityId,
              organizationId,
              row.type || null,
              row.count ?? 0,
              row.source || null,
              row.notes || null,
            ).run();
          } catch (err) {
            console.error('[clinic] failed to insert facility_bed', err);
          }
        }
      }

      const joinValues = (value) => {
        if (Array.isArray(value)) {
          return value.map((item) => nk(item)).filter(Boolean).join('\n') || null;
        }
        const text = nk(value);
        return text || null;
      };
      if (clinic.access && typeof clinic.access === 'object') {
        const parking = clinic.access.parking && typeof clinic.access.parking === 'object' ? clinic.access.parking : {};
        const parkingAvailable = Object.prototype.hasOwnProperty.call(parking, 'available')
          ? (parking.available ? 1 : 0)
          : null;
        const parkingCapacity = Number(parking.capacity);
        const accessSummary = computeAccessSummary(clinic.access);
        const insertAccess = env.MASTERS_D1.prepare(`
          INSERT INTO facility_access_info (
            facility_id, organization_id, nearest_station, bus, parking_available,
            parking_capacity, parking_notes, barrier_free, notes, summary, source
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(facility_id) DO UPDATE SET
            organization_id = excluded.organization_id,
            nearest_station = excluded.nearest_station,
            bus = excluded.bus,
            parking_available = excluded.parking_available,
            parking_capacity = excluded.parking_capacity,
            parking_notes = excluded.parking_notes,
            barrier_free = excluded.barrier_free,
            notes = excluded.notes,
            summary = excluded.summary,
            source = excluded.source,
            updated_at = strftime('%s','now')
        `);
        try {
          await insertAccess.bind(
            facilityId,
            organizationId,
            joinValues(clinic.access.nearestStation),
            joinValues(clinic.access.bus),
            parkingAvailable,
            Number.isFinite(parkingCapacity) ? Math.trunc(parkingCapacity) : null,
            nk(parking.notes) || null,
            joinValues(clinic.access.barrierFree),
            nk(clinic.access.notes) || null,
            accessSummary || null,
            nk(clinic.access.source) || 'manual',
          ).run();
        } catch (err) {
          console.error('[clinic] failed to upsert facility_access_info', err);
        }
      }

      if (clinic.modes && Array.isArray(clinic.modes.selected)) {
        const insertMode = env.MASTERS_D1.prepare(`
          INSERT INTO facility_modes (id, facility_id, organization_id, code, label, icon, color, display_order, notes, source)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            facility_id = excluded.facility_id,
            organization_id = excluded.organization_id,
            code = excluded.code,
            label = excluded.label,
            icon = excluded.icon,
            color = excluded.color,
            display_order = excluded.display_order,
            notes = excluded.notes,
            source = excluded.source,
            updated_at = strftime('%s','now')
        `);
        const metaSource = clinic.modes.meta && typeof clinic.modes.meta === 'object' ? clinic.modes.meta : {};
        for (const code of clinic.modes.selected) {
          const slug = nk(code);
          if (!slug) continue;
          const metaEntry = metaSource[slug] && typeof metaSource[slug] === 'object' ? metaSource[slug] : {};
          const orderValue = Number(metaEntry.order);
          try {
            await insertMode.bind(
              generateCollectionId(facilityId, 'mode', { id: slug }),
              facilityId,
              organizationId,
              slug,
              nk(metaEntry.label) || slug,
              nk(metaEntry.icon) || null,
              nk(metaEntry.color) || null,
              Number.isFinite(orderValue) ? orderValue : null,
              nk(metaEntry.notes) || null,
              nk(clinic.modes.source) || 'manual',
            ).run();
          } catch (err) {
            console.error('[clinic] failed to insert facility_mode', err);
          }
        }
      }

      if (clinic.vaccinations && Array.isArray(clinic.vaccinations.selected)) {
        const insertVaccination = env.MASTERS_D1.prepare(`
          INSERT INTO facility_vaccinations (
            id, facility_id, organization_id, vaccine_code, name, category, description, reference_url, notes, source
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            facility_id = excluded.facility_id,
            organization_id = excluded.organization_id,
            vaccine_code = excluded.vaccine_code,
            name = excluded.name,
            category = excluded.category,
            description = excluded.description,
            reference_url = excluded.reference_url,
            notes = excluded.notes,
            source = excluded.source,
            updated_at = strftime('%s','now')
        `);
        const metaSource = clinic.vaccinations.meta && typeof clinic.vaccinations.meta === 'object'
          ? clinic.vaccinations.meta
          : {};
        for (const code of clinic.vaccinations.selected) {
          const slug = nk(code);
          if (!slug) continue;
          const metaEntry = metaSource[slug] && typeof metaSource[slug] === 'object' ? metaSource[slug] : {};
          try {
            await insertVaccination.bind(
              generateCollectionId(facilityId, 'vaccination', { id: slug }),
              facilityId,
              organizationId,
              slug,
              nk(metaEntry.name) || slug,
              nk(metaEntry.category) || null,
              nk(metaEntry.desc) || null,
              nk(metaEntry.referenceUrl) || null,
              nk(metaEntry.notes) || null,
              nk(clinic.vaccinations.source) || 'manual',
            ).run();
          } catch (err) {
            console.error('[clinic] failed to insert facility_vaccination', err);
          }
        }
      }

      if (clinic.checkups && Array.isArray(clinic.checkups.selected)) {
        const insertCheckup = env.MASTERS_D1.prepare(`
          INSERT INTO facility_checkups (
            id, facility_id, organization_id, checkup_code, name, category, description, reference_url, notes, source
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            facility_id = excluded.facility_id,
            organization_id = excluded.organization_id,
            checkup_code = excluded.checkup_code,
            name = excluded.name,
            category = excluded.category,
            description = excluded.description,
            reference_url = excluded.reference_url,
            notes = excluded.notes,
            source = excluded.source,
            updated_at = strftime('%s','now')
        `);
        const metaSource = clinic.checkups.meta && typeof clinic.checkups.meta === 'object'
          ? clinic.checkups.meta
          : {};
        for (const code of clinic.checkups.selected) {
          const slug = nk(code);
          if (!slug) continue;
          const metaEntry = metaSource[slug] && typeof metaSource[slug] === 'object' ? metaSource[slug] : {};
          try {
            await insertCheckup.bind(
              generateCollectionId(facilityId, 'checkup', { id: slug }),
              facilityId,
              organizationId,
              slug,
              nk(metaEntry.name) || slug,
              nk(metaEntry.category) || null,
              nk(metaEntry.desc) || null,
              nk(metaEntry.referenceUrl) || null,
              nk(metaEntry.notes) || null,
              nk(clinic.checkups.source) || 'manual',
            ).run();
          } catch (err) {
            console.error('[clinic] failed to insert facility_checkup', err);
          }
        }
      }

      const extraPayload = clinic.extra && typeof clinic.extra === 'object' && Object.keys(clinic.extra).length
        ? clinic.extra
        : null;
      if (extraPayload) {
        try {
          const insertExtra = env.MASTERS_D1.prepare(`
            INSERT INTO facility_extra (facility_id, organization_id, payload, source)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(facility_id) DO UPDATE SET
              organization_id = excluded.organization_id,
              payload = excluded.payload,
              source = excluded.source,
              updated_at = strftime('%s','now')
          `);
          await insertExtra.bind(
            facilityId,
            organizationId,
            JSON.stringify(extraPayload),
            nk(extraPayload.source) || 'manual',
          ).run();
        } catch (err) {
          console.error('[clinic] failed to upsert facility_extra', err);
        }
      }
    }

    async function hydrateClinicCollectionsD1(env, clinic) {
      if (!hasFacilitiesD1(env) || !clinic?.id) return clinic;
      const facilityId = clinic.id;
      const snapshot = {
        services: Array.isArray(clinic.services) ? clinic.services.map(clonePlain) : [],
        tests: Array.isArray(clinic.tests) ? clinic.tests.map(clonePlain) : [],
        qualifications: Array.isArray(clinic.qualifications) ? clinic.qualifications.map(clonePlain) : [],
      };
      const fetchRows = async (table, columns) => {
        try {
          const stmt = env.MASTERS_D1.prepare(
            `SELECT ${columns.join(', ')} FROM ${table} WHERE facility_id = ? ORDER BY name`
          );
          const result = await stmt.bind(facilityId).all();
          return result?.results || [];
        } catch (err) {
          console.error(`[clinic] failed to load ${table}`, err);
          return [];
        }
      };
      const deriveCollectionKey = (entry) => {
        if (!entry || typeof entry !== 'object') return null;
        if (entry.id) return `id:${entry.id}`;
        const master = entry.masterId || entry.master_id;
        if (master) return `master:${master}`;
        const category = nk(entry.category || entry.type || '');
        const name = nk(entry.name || entry.masterName || '');
        if (category || name) return `name:${category}|${name}`;
        return null;
      };
      const mergeCollections = (rows, originals, mapper) => {
        const fallbackMap = new Map();
        originals.forEach((item) => {
          const key = deriveCollectionKey(item);
          if (key && !fallbackMap.has(key)) {
            fallbackMap.set(key, clonePlain(item));
          }
        });
        if (rows.length) {
          return {
            items: rows.map((row) => {
              const base = mapper(row);
              const key = deriveCollectionKey(base);
              const fallback = key ? fallbackMap.get(key) : null;
              return fallback ? { ...fallback, ...base } : base;
            }),
            needsBackfill: false,
          };
        }
        if (originals.length) {
          return {
            items: originals.map((item) => clonePlain(item)),
            needsBackfill: true,
          };
        }
        return { items: [], needsBackfill: false };
      };

      const serviceRows = await fetchRows('facility_services', [
        'id', 'master_id', 'name', 'category', 'source', 'notes', 'organization_id',
      ]);
      const mergedServices = mergeCollections(serviceRows, snapshot.services, (row) => ({
        id: row.id,
        masterId: row.master_id || undefined,
        name: row.name || '',
        category: row.category || undefined,
        source: row.source || undefined,
        notes: row.notes || undefined,
      }));
      clinic.services = mergedServices.items;

      const testRows = await fetchRows('facility_tests', [
        'id', 'master_id', 'name', 'category', 'source', 'notes', 'organization_id',
      ]);
      const mergedTests = mergeCollections(testRows, snapshot.tests, (row) => ({
        id: row.id,
        masterId: row.master_id || undefined,
        name: row.name || '',
        category: row.category || undefined,
        source: row.source || undefined,
        notes: row.notes || undefined,
      }));
      clinic.tests = mergedTests.items;

      const qualRows = await fetchRows('facility_qualifications', [
        'id', 'master_id', 'name', 'issuer', 'obtained_at', 'notes', 'organization_id',
      ]);
      const mergedQuals = mergeCollections(qualRows, snapshot.qualifications, (row) => ({
        id: row.id,
        masterId: row.master_id || undefined,
        name: row.name || '',
        issuer: row.issuer || undefined,
        obtainedAt: row.obtained_at || undefined,
        notes: row.notes || undefined,
      }));
      clinic.qualifications = mergedQuals.items;

      const needsBackfill = mergedServices.needsBackfill || mergedTests.needsBackfill || mergedQuals.needsBackfill;
      if (needsBackfill) {
        const promise = replaceFacilityCollectionsD1(env, clinic).catch(err => {
          console.error('[clinic] failed to backfill facility collections', err);
        });
        if (ctx?.waitUntil) {
          ctx.waitUntil(promise);
        } else {
          await promise;
        }
      }

      let organizationCandidate = clinic.organizationId
        || serviceRows[0]?.organization_id
        || testRows[0]?.organization_id
        || qualRows[0]?.organization_id
        || null;

      try {
        const result = await env.MASTERS_D1.prepare(`
          SELECT department_code, name, category, is_primary, source, organization_id
          FROM facility_departments
          WHERE facility_id = ?
          ORDER BY is_primary DESC, name
        `).bind(facilityId).all();
        const rows = result?.results || [];
        if (rows.length) {
          const master = [];
          const others = [];
          const mhlw = [];
          const masterSet = new Set();
          const otherSet = new Set();
          const mhlwSet = new Set();
          rows.forEach((row) => {
            if (!organizationCandidate && row.organization_id) {
              organizationCandidate = row.organization_id;
            }
            const name = nk(row.name);
            if (!name) return;
            const source = nk(row.source);
            if (source === 'mhlw') {
              if (mhlwSet.has(name)) return;
              mhlwSet.add(name);
              mhlw.push(name);
              return;
            }
            if (source === 'manual-other') {
              if (otherSet.has(name) || masterSet.has(name)) return;
              otherSet.add(name);
              others.push(name);
              return;
            }
            if (masterSet.has(name)) return;
            masterSet.add(name);
            master.push(name);
          });
          clinic.departments = { master, others };
          if (mhlw.length) {
            clinic.mhlwDepartments = mhlw;
          }
        }
      } catch (err) {
        console.error('[clinic] failed to hydrate facility_departments', err);
      }

      try {
        const result = await env.MASTERS_D1.prepare(`
          SELECT bed_type, count, source, notes, organization_id
          FROM facility_beds
          WHERE facility_id = ?
          ORDER BY bed_type
        `).bind(facilityId).all();
        const rows = result?.results || [];
        if (rows.length) {
          if (!organizationCandidate && rows[0]?.organization_id) {
            organizationCandidate = rows[0].organization_id;
          }
          clinic.beds = rows.map((row) => ({
            type: row.bed_type || '',
            count: Number.isFinite(row.count) ? Number(row.count) : null,
            source: row.source || null,
            notes: row.notes || null,
          }));
          const totalRow = rows.find((row) => (row.bed_type || '').toLowerCase() === 'total');
          if (totalRow && Number.isFinite(totalRow.count)) {
            const attrs = clinic.facilityAttributes && typeof clinic.facilityAttributes === 'object'
              ? { ...clinic.facilityAttributes }
              : {};
            attrs.bedCount = Number(totalRow.count);
            clinic.facilityAttributes = attrs;
          }
        }
      } catch (err) {
        console.error('[clinic] failed to hydrate facility_beds', err);
      }

      try {
        const row = await env.MASTERS_D1.prepare(`
          SELECT nearest_station, bus, parking_available, parking_capacity, parking_notes,
                 barrier_free, notes, summary, source, organization_id
          FROM facility_access_info
          WHERE facility_id = ?
        `).bind(facilityId).first();
        if (row) {
          if (!organizationCandidate && row.organization_id) {
            organizationCandidate = row.organization_id;
          }
          const splitValues = (value) => {
            if (!value) return [];
            return String(value).split(/\r?\n/).map((item) => nk(item)).filter(Boolean);
          };
          const access = {};
          const stations = splitValues(row.nearest_station);
          if (stations.length) access.nearestStation = stations;
          const buses = splitValues(row.bus);
          if (buses.length) access.bus = buses;
          const barrier = splitValues(row.barrier_free);
          if (barrier.length) access.barrierFree = barrier;
          const parking = {};
          if (row.parking_available !== null && row.parking_available !== undefined) {
            parking.available = !!row.parking_available;
          }
          if (row.parking_capacity !== null && row.parking_capacity !== undefined) {
            const capacity = Number(row.parking_capacity);
            if (Number.isFinite(capacity)) parking.capacity = capacity;
          }
          if (row.parking_notes && nk(row.parking_notes)) {
            parking.notes = nk(row.parking_notes);
          }
          if (Object.keys(parking).length) {
            access.parking = parking;
          }
          if (row.notes && nk(row.notes)) {
            access.notes = nk(row.notes);
          }
          const summaryText = nk(row.summary);
          if (summaryText) {
            access.summary = summaryText;
          }
          const accessSource = nk(row.source);
          if (accessSource) {
            access.source = accessSource;
          }
          if (Object.keys(access).length) {
            clinic.access = access;
            clinic.accessSummary = summaryText || computeAccessSummary(access);
          }
        }
      } catch (err) {
        console.error('[clinic] failed to hydrate facility_access_info', err);
      }

      try {
        const result = await env.MASTERS_D1.prepare(`
          SELECT code, label, icon, color, display_order, notes, source, organization_id
          FROM facility_modes
          WHERE facility_id = ?
          ORDER BY COALESCE(display_order, 2147483647), code
        `).bind(facilityId).all();
        const rows = result?.results || [];
        if (rows.length) {
          if (!organizationCandidate && rows[0]?.organization_id) {
            organizationCandidate = rows[0].organization_id;
          }
          const selected = [];
          const meta = {};
          rows.forEach((row) => {
            const code = nk(row.code);
            if (!code) return;
            selected.push(code);
            const entry = {};
            const label = nk(row.label);
            if (label) entry.label = label;
            const icon = nk(row.icon);
            if (icon) entry.icon = icon;
            const color = nk(row.color);
            if (color) entry.color = color;
            const orderValue = Number(row.display_order);
            if (Number.isFinite(orderValue)) entry.order = orderValue;
            const notes = nk(row.notes);
            if (notes) entry.notes = notes;
            if (Object.keys(entry).length) {
              meta[code] = entry;
            }
          });
          if (selected.length) {
            clinic.modes = { selected };
            if (Object.keys(meta).length) clinic.modes.meta = meta;
            clinic.modes.source = nk(rows[0]?.source) || clinic.modes.source;
          }
        }
      } catch (err) {
        console.error('[clinic] failed to hydrate facility_modes', err);
      }

      try {
        const result = await env.MASTERS_D1.prepare(`
          SELECT vaccine_code, name, category, description, reference_url, notes, source, organization_id
          FROM facility_vaccinations
          WHERE facility_id = ?
          ORDER BY name
        `).bind(facilityId).all();
        const rows = result?.results || [];
        if (rows.length) {
          if (!organizationCandidate && rows[0]?.organization_id) {
            organizationCandidate = rows[0].organization_id;
          }
          const selected = [];
          const meta = {};
          rows.forEach((row) => {
            const code = nk(row.vaccine_code);
            if (!code) return;
            selected.push(code);
            const entry = {};
            const name = nk(row.name);
            if (name) entry.name = name;
            const category = nk(row.category);
            if (category) entry.category = category;
            const desc = nk(row.description);
            if (desc) entry.desc = desc;
            const url = nk(row.reference_url);
            if (url) entry.referenceUrl = url;
            const notes = nk(row.notes);
            if (notes) entry.notes = notes;
            if (Object.keys(entry).length) {
              meta[code] = entry;
            }
          });
          if (selected.length) {
            clinic.vaccinations = { selected };
            if (Object.keys(meta).length) clinic.vaccinations.meta = meta;
            clinic.vaccinations.source = nk(rows[0]?.source) || clinic.vaccinations.source;
          }
        }
      } catch (err) {
        console.error('[clinic] failed to hydrate facility_vaccinations', err);
      }

      try {
        const result = await env.MASTERS_D1.prepare(`
          SELECT checkup_code, name, category, description, reference_url, notes, source, organization_id
          FROM facility_checkups
          WHERE facility_id = ?
          ORDER BY name
        `).bind(facilityId).all();
        const rows = result?.results || [];
        if (rows.length) {
          if (!organizationCandidate && rows[0]?.organization_id) {
            organizationCandidate = rows[0].organization_id;
          }
          const selected = [];
          const meta = {};
          rows.forEach((row) => {
            const code = nk(row.checkup_code);
            if (!code) return;
            selected.push(code);
            const entry = {};
            const name = nk(row.name);
            if (name) entry.name = name;
            const category = nk(row.category);
            if (category) entry.category = category;
            const desc = nk(row.description);
            if (desc) entry.desc = desc;
            const url = nk(row.reference_url);
            if (url) entry.referenceUrl = url;
            const notes = nk(row.notes);
            if (notes) entry.notes = notes;
            if (Object.keys(entry).length) {
              meta[code] = entry;
            }
          });
          if (selected.length) {
            clinic.checkups = { selected };
            if (Object.keys(meta).length) clinic.checkups.meta = meta;
            clinic.checkups.source = nk(rows[0]?.source) || clinic.checkups.source;
          }
        }
      } catch (err) {
        console.error('[clinic] failed to hydrate facility_checkups', err);
      }

      try {
        const row = await env.MASTERS_D1.prepare(`
          SELECT payload, source, organization_id
          FROM facility_extra
          WHERE facility_id = ?
        `).bind(facilityId).first();
        if (row && row.payload) {
          if (!organizationCandidate && row.organization_id) {
            organizationCandidate = row.organization_id;
          }
          try {
            const payload = JSON.parse(row.payload);
            if (payload && typeof payload === 'object') {
              clinic.extra = payload;
              clinic.extra.source = clinic.extra.source || nk(row.source) || 'manual';
            }
          } catch (err) {
            console.warn('[clinic] failed to parse facility_extra payload', err);
          }
        }
      } catch (err) {
        console.error('[clinic] failed to hydrate facility_extra', err);
      }

      if (!clinic.organizationId) {
        clinic.organizationId = organizationCandidate
          || clinic.organizationId
          || null;
      }

      return normalizeClinicRecord(clinic);
    }

    async function upsertClinicD1(env, clinic) {
      if (!hasFacilitiesD1(env)) return clinic;
      const normalizedClinic = normalizeClinicRecord(clinic);
      const row = clinicToD1Row(normalizedClinic);
      if (!row?.id) return clinic;
      const stmt = env.MASTERS_D1.prepare(`
        INSERT INTO facilities (
          id, external_id, name, short_name, official_name, prefecture, city,
          address, postal_code, latitude, longitude, facility_type, mhlw_sync_status, phone, fax,
          email, website, organization_id, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          external_id = excluded.external_id,
          name = excluded.name,
          short_name = excluded.short_name,
          official_name = excluded.official_name,
          prefecture = excluded.prefecture,
          city = excluded.city,
          address = excluded.address,
          postal_code = excluded.postal_code,
          latitude = excluded.latitude,
          longitude = excluded.longitude,
          facility_type = excluded.facility_type,
          mhlw_sync_status = excluded.mhlw_sync_status,
          phone = excluded.phone,
          fax = excluded.fax,
          email = excluded.email,
          website = excluded.website,
          organization_id = excluded.organization_id,
          metadata = excluded.metadata
        RETURNING
          id, external_id, name, short_name, official_name, prefecture, city,
          address, postal_code, latitude, longitude, facility_type, mhlw_sync_status, phone, fax,
          email, website, organization_id, metadata
      `);
      let d1Upserted = true;
      const result = await stmt
        .bind(
          row.id,
          row.externalId || null,
          row.name || null,
          row.shortName || null,
          row.officialName || null,
          row.prefecture || null,
          row.city || null,
          row.address || null,
          row.postalCode || null,
          row.latitude,
          row.longitude,
          row.facilityType || null,
          row.mhlwSyncStatus || null,
          row.phone || null,
          row.fax || null,
          row.email || null,
          row.website || null,
          row.organizationId || null,
          row.metadata,
        )
        .first()
        .catch((err) => {
          console.error('[clinic] failed to upsert D1', err);
          d1Upserted = false;
          return null;
        });
      if (!d1Upserted) {
        console.warn('[clinic] falling back to KV-only store for clinic', { id: normalizedClinic.id });
        return hydrateClinicCollectionsD1(env, normalizedClinic);
      }
      const syncCollections = replaceFacilityCollectionsD1(env, normalizedClinic);
      if (ctx?.waitUntil) {
        ctx.waitUntil(syncCollections.catch(err => {
          console.error('[clinic] async facility collection sync failed', err);
        }));
      } else {
        await syncCollections;
      }
      if (result && result.metadata) {
        try {
          const parsed = normalizeClinicRecord(JSON.parse(result.metadata));
          return hydrateClinicCollectionsD1(env, parsed);
        } catch (err) {
          console.warn('[clinic] failed to parse D1 metadata', err);
        }
      }
      if (row.id) {
        const fallback = await getClinicFromD1(env, 'id', row.id);
        if (fallback) return fallback;
      }
      return hydrateClinicCollectionsD1(env, normalizedClinic);
    }

    function clinicFromD1Row(row) {
      if (!row) return null;
      let payload = null;
      if (row.metadata) {
        try {
          payload = JSON.parse(row.metadata);
        } catch (err) {
          console.warn('[clinic] failed to parse metadata JSON', err);
        }
      }
      if (!payload || typeof payload !== 'object') {
        payload = {
          id: row.id,
          basic: {
            name: row.name || '',
            shortName: row.short_name || '',
            address: row.address || '',
            postalCode: row.postal_code || '',
            phone: row.phone || '',
            fax: row.fax || '',
            email: row.email || '',
            website: row.website || '',
            prefecture: row.prefecture || '',
            city: row.city || '',
          },
          clinicType: row.facility_type || 'clinic',
          location: {
            lat: row.latitude,
            lng: row.longitude,
          },
          services: [],
          tests: [],
          qualifications: [],
          managerAccounts: [],
          staffMemberships: [],
          status: 'active',
        };
      }
      if (!payload.id) payload.id = row.id;
      if (!payload.basic) payload.basic = {};
      payload.basic.name = payload.basic.name || row.name || '';
      payload.basic.address = payload.basic.address || row.address || '';
      payload.basic.postalCode = payload.basic.postalCode || row.postal_code || '';
      payload.basic.phone = payload.basic.phone || row.phone || '';
      payload.basic.fax = payload.basic.fax || row.fax || '';
      payload.basic.email = payload.basic.email || row.email || '';
      payload.basic.website = payload.basic.website || row.website || '';
      payload.basic.prefecture = payload.basic.prefecture || row.prefecture || '';
      payload.basic.city = payload.basic.city || row.city || '';
      payload.mhlwFacilityId = payload.mhlwFacilityId || row.external_id || null;
      if (!payload.mhlwSyncStatus) {
        payload.mhlwSyncStatus = row.mhlw_sync_status || 'pending';
      }
      payload.organizationId = payload.organizationId || row.organization_id || null;
      if (!payload.location || typeof payload.location !== 'object') {
        payload.location = {};
      }
      if (row.latitude !== undefined && row.latitude !== null && payload.location.lat === undefined) {
        payload.location.lat = row.latitude;
      }
      if (row.longitude !== undefined && row.longitude !== null && payload.location.lng === undefined) {
        payload.location.lng = row.longitude;
      }
      payload.clinicType = payload.clinicType || row.facility_type || 'clinic';
      return normalizeClinicRecord(payload);
    }

    async function getClinicFromD1(env, column, value) {
      if (!hasFacilitiesD1(env) || !value) return null;
      let sqlColumn = null;
      switch (column) {
        case 'id':
          sqlColumn = 'id';
          break;
        case 'name':
          sqlColumn = 'name';
          break;
        case 'external_id':
          sqlColumn = 'external_id';
          break;
        default:
          return null;
      }
      const stmt = env.MASTERS_D1.prepare(`
        SELECT id, external_id, name, short_name, official_name, prefecture, city,
               address, postal_code, latitude, longitude, facility_type,
               phone, fax, email, website, organization_id, metadata
        FROM facilities
        WHERE ${sqlColumn} = ?
        LIMIT 1
      `);
      const row = await stmt.bind(value).first().catch((err) => {
        console.error('[clinic] D1 lookup failed', err);
        return null;
      });
      if (!row) return null;
      const clinicRecord = clinicFromD1Row(row);
      return hydrateClinicCollectionsD1(env, clinicRecord);
    }

    async function listClinicsD1(env, { limit = 2000, offset = 0 } = {}) {
      if (!hasFacilitiesD1(env)) return { items: [], total: 0 };
      const listQuery = env.MASTERS_D1.prepare(`
        SELECT id, external_id, name, short_name, official_name, prefecture, city,
               address, postal_code, latitude, longitude, facility_type,
               phone, fax, email, website, organization_id, metadata
        FROM facilities
        ORDER BY name
        LIMIT ? OFFSET ?
      `);
      const result = await listQuery.bind(limit, offset).all().catch((err) => {
        console.error('[clinic] failed to list D1 facilities', err);
        return { results: [] };
      });
      const rows = result?.results || [];
      const items = await Promise.all(rows.map(async (row) => {
        const clinic = clinicFromD1Row(row);
        if (!clinic) return null;
        const hydrated = await hydrateClinicCollectionsD1(env, clinic);
        const kvClinicRaw = await kvGetJSON(env, `clinic:id:${hydrated.id}`);
        const kvClinic = normalizeClinicRecord(kvClinicRaw);
        return pickFresherClinic(hydrated, kvClinic);
      }));
      const filteredItems = items.filter(Boolean);
      const totalRow = await env.MASTERS_D1.prepare('SELECT COUNT(*) AS cnt FROM facilities;').first().catch(() => ({ cnt: 0 }));
      return { items: filteredItems, total: totalRow?.cnt || 0 };
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
          // Fallback below
        }
      }
      return new TextDecoder('utf-8');
    }

    async function* readCsvLinesFromFile(file) {
      if (!file || typeof file.stream !== 'function') {
        throw new Error('Invalid file supplied');
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
        } else if (!done) {
          buffer += decoder.decode(new Uint8Array(), { stream: true });
        }
        const parts = buffer.split(/\r?\n/);
        if (!done) {
          buffer = parts.pop() ?? '';
        } else {
          buffer = '';
        }
        for (const line of parts) {
          const trimmed = line.replace(/\r$/, '');
          if (trimmed) {
            yield trimmed;
          }
        }
        if (done) break;
      }
      if (buffer) {
        yield buffer;
      }
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

    async function* iterateCsvRecords(file) {
      for await (const line of readCsvLinesFromFile(file)) {
        if (!line) continue;
        yield parseCsvLine(line);
      }
    }

    function normalizeKana(value) {
      return (value || '').toString().replace(/\s+/g, '');
    }

    function normalizePostalCode(value) {
      return (value || '').toString().replace(/[^0-9]/g, '').slice(0, 7);
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

    function normalizeAddress(value) {
      return (value || '').toString().trim();
    }

    function normalizeHeaderName(header) {
      return (header ?? '')
        .toString()
        .replace(/^\ufeff/, '')
        .replace(/^"+|"+$/g, '')
        .trim();
    }

    function canonicalizeHeaderName(header) {
      return normalizeHeaderName(header)
        .replace(/[\"'“”]/g, '')
        .replace(/（/g, '(')
        .replace(/）/g, ')')
        .replace(/[＿]/g, '_')
        .replace(/[\s　]/g, '')
        .toLowerCase();
    }

    function buildCanonicalRow(headers, columns) {
      const row = {};
      headers.forEach((header, index) => {
        const key = canonicalizeHeaderName(header);
        if (key) {
          row[key] = columns[index] ?? '';
        }
      });
      return row;
    }

    function extractValue(canonicalRow, aliases, { trim = true } = {}) {
      if (!aliases || aliases.length === 0) return '';
      for (const alias of aliases) {
        const key = canonicalizeHeaderName(alias);
        if (Object.prototype.hasOwnProperty.call(canonicalRow, key)) {
          const raw = canonicalRow[key];
          if (raw == null) continue;
          const value = trim ? toNormalizedValue(raw) : raw;
          if (value !== '') return value;
        }
      }
      return '';
    }

    function parseBooleanFlag(value) {
      const normalized = toNormalizedValue(value).toLowerCase();
      if (!normalized) return false;
      return normalized === '1' || normalized === 'true' || normalized === '○' || normalized === '◯';
    }

    function parseNumber(value) {
      const normalized = toNormalizedValue(value);
      if (!normalized) return null;
      const numeric = Number(normalized.replace(/,/g, ''));
      return Number.isFinite(numeric) ? numeric : null;
    }

    function derivePrefectureName(prefCode, address) {
      const normalizedCode = (prefCode || '').toString().padStart(2, '0');
      const prefecture = PREFECTURES.find((item) => item.code === normalizedCode);
      if (prefecture) return prefecture.name;
      if (address) {
        const match = PREFECTURES.find((item) => address.startsWith(item.name));
        if (match) return match.name;
      }
      return '';
    }

    function deriveCityName(prefectureName, address) {
      if (!address) return '';
      let rest = address.trim();
      if (prefectureName && rest.startsWith(prefectureName)) {
        rest = rest.slice(prefectureName.length);
      }
      rest = rest.trim();
      if (!rest) return '';

      let result = '';
      for (let i = 0; i < rest.length; i += 1) {
        const char = rest[i];
        if ('市区町村'.includes(char)) {
          result = rest.slice(0, i + 1);
        } else if (char === '郡') {
          const match = rest.match(/^(.+郡.+?[町村])/);
          if (match) {
            result = match[1];
          } else {
            result = rest.slice(0, i + 1);
          }
        }
      }
      return toNormalizedValue(result);
    }

    function buildWeeklyClosedDays(row) {
      const out = {};
      for (const def of MHLW_WEEKDAY_DEFS) {
        const aliases = MHLW_FACILITY_FIELD_ALIASES[`weeklyClosed${def.alias}`] || [];
        out[def.key] = parseBooleanFlag(extractValue(row, aliases));
      }
      return out;
    }

    function buildPeriodicClosedMap(row) {
      const result = {};
      for (const week of MHLW_PERIODIC_WEEK_DEFS) {
        const dayMap = {};
        for (const day of MHLW_WEEKDAY_DEFS) {
          const aliasKey = `periodicClosed${week.alias}${day.alias}`;
          const aliases = MHLW_FACILITY_FIELD_ALIASES[aliasKey] || [];
          dayMap[day.key] = parseBooleanFlag(extractValue(row, aliases));
        }
        result[week.key] = dayMap;
      }
      return result;
    }

    function buildBedCounts(row) {
      const mapping = {
        general: 'bedsGeneral',
        longTerm: 'bedsLongTerm',
        longTermMedical: 'bedsLongTermMedical',
        longTermCare: 'bedsLongTermCare',
        psychiatric: 'bedsPsychiatric',
        tuberculosis: 'bedsTuberculosis',
        infectious: 'bedsInfectious',
        total: 'bedsTotal',
      };
      const out = {};
      for (const [key, aliasKey] of Object.entries(mapping)) {
        const aliases = MHLW_FACILITY_FIELD_ALIASES[aliasKey] || [];
        const value = parseNumber(extractValue(row, aliases));
        if (value !== null) {
          out[key] = value;
        }
      }
      return out;
    }

    function buildFacilityFromRow(canonicalRow, facilityType) {
      const facilityIdRaw = extractValue(canonicalRow, MHLW_FACILITY_FIELD_ALIASES.facilityId);
      const facilityId = normalizeMhlwFacilityId(facilityIdRaw);
      if (!facilityId) return null;

      const officialName = extractValue(canonicalRow, MHLW_FACILITY_FIELD_ALIASES.officialName);
      const officialNameKana = normalizeKana(extractValue(canonicalRow, MHLW_FACILITY_FIELD_ALIASES.officialNameKana));
      const shortName = extractValue(canonicalRow, MHLW_FACILITY_FIELD_ALIASES.shortName);
      const shortNameKana = normalizeKana(extractValue(canonicalRow, MHLW_FACILITY_FIELD_ALIASES.shortNameKana));
      const englishName = extractValue(canonicalRow, MHLW_FACILITY_FIELD_ALIASES.englishName);
      const facilityCategoryValue = extractValue(canonicalRow, MHLW_FACILITY_FIELD_ALIASES.facilityCategory);
      const facilityCategory = facilityCategoryValue ? Number(facilityCategoryValue) : undefined;

      const prefectureCodeRaw = extractValue(canonicalRow, MHLW_FACILITY_FIELD_ALIASES.prefectureCode);
      const prefectureCode = prefectureCodeRaw ? prefectureCodeRaw.toString().padStart(2, '0') : '';
      const cityCodeRaw = extractValue(canonicalRow, MHLW_FACILITY_FIELD_ALIASES.cityCode);
      const cityCode = cityCodeRaw ? cityCodeRaw.toString().padStart(5, '0') : '';

      const address = normalizeAddress(extractValue(canonicalRow, MHLW_FACILITY_FIELD_ALIASES.address));
      const latitudeValue = parseNumber(extractValue(canonicalRow, MHLW_FACILITY_FIELD_ALIASES.latitude));
      const longitudeValue = parseNumber(extractValue(canonicalRow, MHLW_FACILITY_FIELD_ALIASES.longitude));
      const homepageUrl = extractValue(canonicalRow, MHLW_FACILITY_FIELD_ALIASES.homepageUrl);

      const prefectureName = derivePrefectureName(prefectureCode, address);
      const cityName = deriveCityName(prefectureName, address);

      const weeklyClosedDays = buildWeeklyClosedDays(canonicalRow);
      const periodicClosedDays = buildPeriodicClosedMap(canonicalRow);
      const holidayClosed = parseBooleanFlag(extractValue(canonicalRow, MHLW_FACILITY_FIELD_ALIASES.holidayClosed));
      const otherClosedNote = extractValue(canonicalRow, MHLW_FACILITY_FIELD_ALIASES.otherClosedNote);

      const bedCounts = buildBedCounts(canonicalRow);
      const totalBedCount = bedCounts.total ?? bedCounts.general ?? null;

      const latitude = latitudeValue !== null ? latitudeValue : undefined;
      const longitude = longitudeValue !== null ? longitudeValue : undefined;

      return {
        facilityId,
        facilityType,
        name: officialName,
        nameKana: officialNameKana,
        officialName,
        officialNameKana,
        shortName,
        shortNameKana,
        englishName,
        facilityCategory: Number.isFinite(facilityCategory) ? facilityCategory : undefined,
        prefectureCode,
        prefecture: prefectureName,
        prefectureName,
        cityCode,
        city: cityName,
        cityName,
        address,
        postalCode: '',
        phone: '',
        fax: '',
        homepageUrl,
        latitude,
        longitude,
        weeklyClosedDays,
        periodicClosedDays,
        holidayClosed,
        otherClosedNote,
        bedCounts,
        bedCount: totalBedCount !== null ? totalBedCount : undefined,
        scheduleEntries: [],
        mhlwDepartments: [],
      };
    }
    function detectColumnIndex(headers, keywords) {
      const normalizedHeaders = headers.map((col) => normalizeHeaderName(col).toLowerCase().replace(/\s+/g, ''));
      for (const keyword of keywords) {
        const normalizedKeyword = keyword.toLowerCase().replace(/\s+/g, '');
        const idx = normalizedHeaders.findIndex((header) => header.includes(normalizedKeyword));
        if (idx !== -1) return idx;
      }
      return -1;
    }

    async function getMhlwFacilityStats(env) {
      if (!env?.MASTERS_D1 || typeof env.MASTERS_D1.prepare !== 'function') {
        return null;
      }
      try {
        const facilityRow = await env.MASTERS_D1.prepare(
          'SELECT COUNT(*) AS cnt, MAX(updated_at) AS max_updated FROM mhlw_facilities;'
        )
          .first()
          .catch(() => null);
        const scheduleRow = await env.MASTERS_D1.prepare(
          'SELECT COUNT(*) AS cnt FROM mhlw_facility_schedules;'
        )
          .first()
          .catch(() => null);
        const facilityCount = Number(facilityRow?.cnt ?? 0);
        const scheduleCount = Number(scheduleRow?.cnt ?? 0);
        const updatedAtSeconds = Number(facilityRow?.max_updated ?? 0);
        const updatedAt =
          Number.isFinite(updatedAtSeconds) && updatedAtSeconds > 0
            ? new Date(updatedAtSeconds * 1000).toISOString()
            : new Date().toISOString();
        return {
          sourceType: 'd1',
          facilityCount,
          scheduleCount,
          updatedAt,
        };
      } catch (err) {
        console.warn('[mhlw] failed to read D1 stats', err);
        return null;
      }
    }

    async function readMhlwFacilitiesMeta(env) {
      let meta = null;
      if (env?.SETTINGS?.get) {
        try {
          const raw = await env.SETTINGS.get(MHLW_FACILITIES_META_KEY);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
              meta = parsed;
            }
          }
        } catch (err) {
          console.warn('[mhlw] failed to read metadata', err);
        }
      }

      const stats = await getMhlwFacilityStats(env);
      if (stats) {
        meta = {
          ...(meta || {}),
          ...stats,
        };
        if (!meta.cacheControl) {
          meta.cacheControl = MHLW_FACILITIES_CACHE_CONTROL;
        }
      }

      return meta;
    }

    async function writeMhlwFacilitiesMeta(env, meta) {
      if (!env?.SETTINGS?.put) return;
      const payload = {
        ...meta,
        updatedAt: meta?.updatedAt || new Date().toISOString(),
      };
      await env.SETTINGS.put(MHLW_FACILITIES_META_KEY, JSON.stringify(payload));
      return payload;
    }

    async function fetchMhlwFacilitiesFromD1(env, { format = 'json', method = 'GET', meta } = {}) {
      if (!env?.MASTERS_D1 || typeof env.MASTERS_D1.prepare !== 'function') {
        return null;
      }

      let stats = meta && meta.sourceType === 'd1' ? meta : null;
      if (!stats) {
        stats = await getMhlwFacilityStats(env);
      }
      if (!stats || Number(stats.facilityCount || 0) <= 0) {
        return null;
      }

      const formatLower = (format || '').toLowerCase();
      const useJsonl = formatLower === 'jsonl' || formatLower === 'ndjson';

      const headers = new Headers({ ...corsHeaders });
      headers.set('Cache-Control', stats.cacheControl || MHLW_FACILITIES_CACHE_CONTROL);
      if (stats.updatedAt) {
        headers.set('Last-Modified', new Date(stats.updatedAt).toUTCString());
        headers.set('ETag', `"mhlw-d1-${stats.updatedAt}"`);
      }
      headers.set('Content-Type', useJsonl ? 'application/x-ndjson' : 'application/json');

      if (method === 'HEAD') {
        return new Response(null, { status: 200, headers });
      }

      const rowsResult = await env.MASTERS_D1.prepare(
        'SELECT raw_json FROM mhlw_facilities ORDER BY facility_id;'
      )
        .all()
        .catch((err) => {
          console.error('[mhlw] failed to read facilities from D1', err);
          return null;
        });
      const rows = Array.isArray(rowsResult?.results) ? rowsResult.results : [];
      if (!rows.length) {
        const emptyBody = useJsonl ? '' : JSON.stringify({ count: 0, facilities: [] });
        const bodyBytes = new TextEncoder().encode(emptyBody);
        headers.set('Content-Length', String(bodyBytes.length));
        return new Response(bodyBytes, { status: 200, headers });
      }

      const jsonEntries = [];
      for (const row of rows) {
        if (row && typeof row.raw_json === 'string' && row.raw_json) {
          jsonEntries.push(row.raw_json);
        }
      }

      let bodyString;
      if (useJsonl) {
        bodyString = `${jsonEntries.join('\n')}\n`;
      } else {
        bodyString = `{"count":${jsonEntries.length},"facilities":[${jsonEntries.join(',')}]}`;
      }

      const encoder = new TextEncoder();
      const bodyBytes = encoder.encode(bodyString);
      headers.set('Content-Length', String(bodyBytes.length));

      return new Response(bodyBytes, { status: 200, headers });
    }

    function tokenizeSearchQuery(query) {
      return Array.from(
        new Set(
          (query || '')
            .toString()
            .split(/[\s、,，・　]+/)
            .map((part) => part.trim())
            .filter(Boolean),
        ),
      );
    }

    function normalizeSearchString(value) {
      return (value || '').toString().trim();
    }

    async function searchMhlwFacilities(env, {
      keyword,
      facilityId,
      facilityType,
      prefecture,
      city,
      limit = 20,
    } = {}) {
      if (!env?.MASTERS_D1 || typeof env.MASTERS_D1.prepare !== 'function') {
        return null;
      }

      const normalizedId = facilityId ? normalizeMhlwFacilityId(facilityId) : '';
      const normalizedKeyword = normalizeSearchString(keyword);
      const tokens = tokenizeSearchQuery(normalizedKeyword);
      const params = [];
      const whereClauses = [];

      if (normalizedId) {
        whereClauses.push('facility_id = ?');
        params.push(normalizedId);
      }

      if (facilityType) {
        whereClauses.push('LOWER(facility_type) = LOWER(?)');
        params.push(facilityType);
      }
      if (prefecture) {
        whereClauses.push('prefecture = ?');
        params.push(prefecture);
      }
      if (city) {
        whereClauses.push('city LIKE ?');
        params.push(`${city}%`);
      }

      if (!normalizedId && tokens.length) {
        for (const token of tokens) {
          whereClauses.push('search_tokens LIKE ?');
          params.push(`%${token}%`);
        }
      }

      const orderClauses = [];
      const orderParams = [];

      if (normalizedId) {
        orderClauses.push('CASE WHEN facility_id = ? THEN 0 ELSE 1 END');
        orderParams.push(normalizedId);
      }
      if (normalizedKeyword) {
        orderClauses.push('CASE WHEN search_name LIKE ? THEN 0 ELSE 1 END');
        orderParams.push(`%${normalizedKeyword}%`);
        orderClauses.push('CASE WHEN name LIKE ? THEN 0 ELSE 1 END');
        orderParams.push(`%${normalizedKeyword}%`);
        orderClauses.push('CASE WHEN short_name LIKE ? THEN 0 ELSE 1 END');
        orderParams.push(`%${normalizedKeyword}%`);
      }
      orderClauses.push('facility_id');

      const sql = [
        'SELECT facility_id, facility_type, name, official_name, short_name, prefecture, city, address, postal_code, latitude, longitude, raw_json',
        'FROM mhlw_facilities',
        whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '',
        `ORDER BY ${orderClauses.join(', ')}`,
        'LIMIT ?',
      ].filter(Boolean).join(' ');

      const finalParams = [...params, ...orderParams, Math.max(1, Math.min(Number(limit) || 20, 100))];
      let stmt = env.MASTERS_D1.prepare(sql);
      if (finalParams.length) {
        stmt = stmt.bind(...finalParams);
      }
      const result = await stmt.all().catch((err) => {
        console.error('[mhlw] failed to execute search query', err);
        return null;
      });
      if (!result || !Array.isArray(result.results)) {
        return [];
      }

      const matches = [];
      for (const row of result.results) {
        if (!row) continue;
        let facility = null;
        if (row.raw_json) {
          try {
            facility = JSON.parse(row.raw_json);
          } catch (err) {
            console.warn('[mhlw] failed to parse raw_json', err);
          }
        }
        facility = facility && typeof facility === 'object' ? facility : {};
        if (!facility.facilityId) facility.facilityId = row.facility_id;
        if (!facility.facilityType && row.facility_type) facility.facilityType = row.facility_type;
        if (!facility.name && row.name) facility.name = row.name;
        if (!facility.officialName && row.official_name) facility.officialName = row.official_name;
        if (!facility.shortName && row.short_name) facility.shortName = row.short_name;
        if (!facility.prefecture && row.prefecture) facility.prefecture = row.prefecture;
        if (!facility.city && row.city) facility.city = row.city;
        if (!facility.address && row.address) facility.address = row.address;
        if (!facility.postalCode && row.postal_code) facility.postalCode = row.postal_code;
        if (facility.latitude == null && row.latitude != null) facility.latitude = row.latitude;
        if (facility.longitude == null && row.longitude != null) facility.longitude = row.longitude;
        matches.push(facility);
      }
      return matches;
    }

    const uploadSessionKey = (uploadId) => `${MHLW_UPLOAD_META_PREFIX}${uploadId}`;

    async function saveUploadSession(env, uploadId, data, { ttlSeconds = MHLW_UPLOAD_SESSION_TTL_SECONDS } = {}) {
      if (!uploadId) throw new Error('uploadId is required');
      const payload = {
        uploadId,
        ...data,
        updatedAt: new Date().toISOString(),
      };
      await env.SETTINGS.put(uploadSessionKey(uploadId), JSON.stringify(payload), ttlSeconds ? { expirationTtl: ttlSeconds } : undefined);
      return payload;
    }

    async function getUploadSession(env, uploadId) {
      if (!uploadId) return null;
      return kvGetJSON(env, uploadSessionKey(uploadId));
    }

    async function deleteUploadSession(env, uploadId) {
      if (!uploadId) return;
      await env.SETTINGS.delete(uploadSessionKey(uploadId)).catch(() => {});
    }

    async function importFacilityCsvFile(file, facilityType) {
      const facilities = [];
      let headers = [];
      let headerParsed = false;
      const normalizedType = normalizeFacilityType(facilityType);
      for await (const record of iterateCsvRecords(file)) {
        if (!headerParsed) {
          headers = record.map((header) => normalizeHeaderName(header));
          headerParsed = true;
          continue;
        }
        if (!record || record.length === 0) continue;
        const canonicalRow = buildCanonicalRow(headers, record);
        const facility = buildFacilityFromRow(canonicalRow, normalizedType);
        if (!facility) continue;
        facilities.push(facility);
      }
      return facilities;
    }

    function toNormalizedValue(value) {
      return (value ?? '').toString().trim();
    }

    async function importScheduleCsvFile(file, facilityType) {
      const facilityTypeNormalized = normalizeFacilityType(facilityType);
      const schedules = [];
      let headers = [];
      let facilityIdIndex = -1;
      let headerParsed = false;
      for await (const record of iterateCsvRecords(file)) {
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
        const facilityId = normalizeMhlwFacilityId(facilityIdRaw);
        if (!facilityId) continue;

        const departmentCode = toNormalizedValue(row['診療科目コード'] || row['診療科コード'] || row.departmentCode || row['departmentcode']);
        const departmentName = toNormalizedValue(row['診療科目名'] || row['診療科名'] || row.department || row['department']);
        const slotType = toNormalizedValue(row['診療時間帯'] || row['区分'] || row['slot'] || row['pattern']);

        for (const def of MHLW_SCHEDULE_DAY_DEFS) {
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
      }
      return schedules;
    }

    function mergeFacilityAndScheduleEntries(facilities, schedules) {
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
    }) {
      const clinicFacilities = await importFacilityCsvFile(clinicFacilityFile, 'clinic');
      const hospitalFacilities = await importFacilityCsvFile(hospitalFacilityFile, 'hospital');
      const allFacilities = [...clinicFacilities, ...hospitalFacilities];

      const clinicSchedules = await importScheduleCsvFile(clinicScheduleFile, 'clinic');
      const hospitalSchedules = await importScheduleCsvFile(hospitalScheduleFile, 'hospital');
      const allSchedules = [...clinicSchedules, ...hospitalSchedules];

      const merged = mergeFacilityAndScheduleEntries(allFacilities, allSchedules);
      return {
        facilities: merged,
        stats: {
          facilityCount: allFacilities.length,
          scheduleCount: allSchedules.length,
        },
      };
    }

    function normalizeSecurityAnswerFormat(format) {
      const normalized = nk(format).toLowerCase();
      if (SECURITY_ANSWER_FORMATS.has(normalized)) {
        return normalized;
      }
      return 'hiragana';
    }

    function toHiragana(value) {
      return value.replace(/[ァ-ヶ]/g, (char) => {
        const code = char.charCodeAt(0);
        if (char === 'ヵ') return 'か';
        if (char === 'ヶ') return 'け';
        if (code >= 0x30a1 && code <= 0x30f6) {
          return String.fromCharCode(code - 0x60);
        }
        return char;
      });
    }

    function toKatakana(value) {
      return value.replace(/[ぁ-ゖ]/g, (char) => {
        const code = char.charCodeAt(0);
        if (char === 'ゕ') return 'ヵ';
        if (char === 'ゖ') return 'ヶ';
        if (code >= 0x3041 && code <= 0x3096) {
          return String.fromCharCode(code + 0x60);
        }
        return char;
      });
    }

    function normalizeSecurityAnswer(rawAnswer, format) {
      const trimmed = nk(rawAnswer);
      if (!trimmed) return '';
      const normalizedFormat = normalizeSecurityAnswerFormat(format);
      let result = trimmed.normalize('NFKC');
      result = result.replace(/\s+/g, '');
      if (!result) return '';
      if (normalizedFormat === 'hiragana') {
        result = toHiragana(result);
        if (/[^ぁ-ゖー・゛゜]/.test(result)) {
          return '';
        }
      } else {
        result = toKatakana(result);
        if (/[^ァ-ヶー・゙゚]/.test(result)) {
          return '';
        }
      }
      return result;
    }

    function getSessionStore(env) {
      return env.AUTH_SESSIONS || env.SETTINGS;
    }

    const sessionMetaKey = (sessionId) => `${SESSION_META_PREFIX}${sessionId}`;
    const accountLoginKey = (loginIdLower) => `account:login:${loginIdLower}`;
    const accountEmailKey = (emailLower) => `account:email:${emailLower}`;
    const inviteKey = (inviteId) => `invite:${inviteId}`;
    const inviteLookupKey = (token) => `inviteToken:${token}`;
    const resetLookupKey = (tokenHash) => `${PASSWORD_RESET_LOOKUP_PREFIX}${tokenHash}`;
    const passwordResetKey = (id) => `passwordReset:${id}`;

    function envFlag(value) {
      return value === true || value === 'true' || value === '1';
    }

    function toBase64Url(bytes) {
      const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      if (typeof Buffer !== 'undefined') {
        return Buffer.from(array).toString('base64url');
      }
      let binary = '';
      for (let i = 0; i < array.length; i += 1) {
        binary += String.fromCharCode(array[i]);
      }
      return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    }

    function resolveAccountStorageKey(idOrPointer) {
      const raw = nk(idOrPointer);
      if (!raw) return null;
      if (raw.startsWith('account:id:')) return raw;
      if (raw.startsWith('account:')) {
        return `account:id:${raw.substring('account:'.length)}`;
      }
      return `account:id:${raw}`;
    }

    function storageKeyToAccountId(value) {
      const raw = nk(value);
      if (!raw) return null;
      if (raw.startsWith('account:id:')) {
        return raw.substring('account:id:'.length);
      }
      if (raw.startsWith('account:')) {
        return raw.substring('account:'.length);
      }
      return raw;
    }

    function ensureAccountId(account, pointer) {
      if (!account || typeof account !== 'object') return null;
      const existing = nk(account.id);
      if (existing) return existing;
      const core = storageKeyToAccountId(pointer || account.accountId || account.uuid);
      if (!core) return null;
      const value = core.startsWith('account:') ? core : `account:${core}`;
      account.id = value;
      return value;
    }

    function generateSessionId() {
      if (globalThis.crypto?.randomUUID) {
        return globalThis.crypto.randomUUID();
      }
      return `session-${generateTokenString(16)}`;
    }

    async function hashToken(token) {
      const trimmed = nk(token);
      if (!trimmed) return null;
      const data = new TextEncoder().encode(trimmed);
      const digest = await crypto.subtle.digest('SHA-256', data);
      return toBase64Url(new Uint8Array(digest));
    }

    const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    function jsonResponse(body, status = 200) {
      return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    async function authenticateRequest(request, env) {
      const authHeader = request.headers.get('Authorization') || '';
      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      if (!match) return null;
      const token = match[1].trim();
      if (!token) return null;
      try {
        const { payload } = await verifyToken(token, {
          env,
          sessionStore: getSessionStore(env),
        });
        const account = await getAccountById(env, payload.sub);
        if (!account) return null;
        if ((nk(account.status) || 'active') !== 'active') return null;
        ensureAccountId(account, payload.sub);
        return { account, payload, token };
      } catch (err) {
        console.warn('authenticateRequest failed', err);
        return null;
      }
    }

    const ROLE_CANONICAL = {
    systemroot: 'systemRoot',
    sysroot: 'systemRoot',
    root: 'systemRoot',
    systemadmin: 'systemAdmin',
    adminreviewer: 'adminReviewer',
    reviewer: 'adminReviewer',
    admin: 'clinicAdmin',
    clinicadmin: 'clinicAdmin',
    clinicstaff: 'clinicStaff',
    staff: 'clinicStaff',
  };

  const ROLE_INHERITANCE = {
    systemRoot: ['systemRoot', 'systemAdmin', 'clinicAdmin', 'clinicStaff'],
    systemAdmin: ['systemAdmin', 'clinicAdmin', 'clinicStaff'],
    adminReviewer: ['adminReviewer', 'clinicStaff'],
    clinicAdmin: ['clinicAdmin', 'clinicStaff'],
    clinicStaff: ['clinicStaff'],
  };

  const SYSTEM_ROOT_ONLY = ['systemRoot'];

    function hasRole(payload, roles) {
      if (!payload) return false;
      const role = normalizeRole(payload.role);
      if (!role) return false;
      const allowed = Array.isArray(roles) ? roles : [roles];
      const inherited = ROLE_INHERITANCE[role] || [role];
      return allowed.some((required) => inherited.includes(normalizeRole(required)));
    }

    function normalizeRole(input, fallback = 'clinicStaff') {
      const raw = nk(input);
      if (!raw) return fallback;
      const canonical = ROLE_CANONICAL[raw.toLowerCase()];
      if (canonical) return canonical;
      return raw;
    }

    function validatePasswordStrength(password) {
      if (typeof password !== 'string') return false;
      return password.length >= MIN_PASSWORD_LENGTH;
    }

    function isoTimestamp(secondsFromNow = 0) {
      const date = new Date(Date.now() + secondsFromNow * 1000);
      return date.toISOString();
    }

    async function createInviteRecord(env, {
      clinicId,
      email,
      role,
      invitedBy,
      metadata = {},
      ttlSeconds = INVITE_TTL_SECONDS,
    }) {
      const inviteId = crypto.randomUUID();
      const token = generateInviteToken();
      const tokenHash = await hashToken(token);
      const nowIso = new Date().toISOString();
      const expiresAt = isoTimestamp(ttlSeconds);
      const invite = {
        id: inviteId,
        clinicId,
        email,
        role,
        invitedBy,
        invitedAt: nowIso,
        expiresAt,
        status: 'pending',
        metadata,
      };
      await kvPutJSONWithOptions(env, inviteKey(inviteId), invite, { expirationTtl: ttlSeconds });
      if (tokenHash) {
        await env.SETTINGS.put(inviteLookupKey(tokenHash), inviteId, { expirationTtl: ttlSeconds });
      }
      return { invite, token, tokenHash };
    }

    async function getInviteById(env, inviteId) {
      return kvGetJSON(env, inviteKey(inviteId));
    }

    async function getInviteByToken(env, token) {
      const tokenHash = await hashToken(token);
      if (!tokenHash) return null;
      const inviteId = await env.SETTINGS.get(inviteLookupKey(tokenHash));
      if (!inviteId) return null;
      const invite = await getInviteById(env, inviteId);
      if (!invite) return null;
      return { invite, tokenHash };
    }

    async function updateInviteStatus(env, inviteId, status, extra = {}) {
      const invite = await getInviteById(env, inviteId);
      if (!invite) return null;
      invite.status = status;
      Object.assign(invite, extra);
      await kvPutJSON(env, inviteKey(inviteId), invite);
      return invite;
    }

    function cleanClinicPendingInvites(clinic, now = Date.now()) {
      if (!clinic || typeof clinic !== 'object') return [];
      const pending = Array.isArray(clinic.pendingInvites) ? clinic.pendingInvites : [];
      return pending.filter((entry) => {
        if (!entry || typeof entry !== 'object') return false;
        if (entry.status && entry.status !== 'pending') return false;
        if (!entry.expiresAt) return true;
        const expiresAtMs = Date.parse(entry.expiresAt);
        if (Number.isNaN(expiresAtMs)) return true;
        return expiresAtMs > now;
      });
    }

    async function removeInviteLookup(env, tokenHash) {
      if (!tokenHash) return;
      await env.SETTINGS.delete(inviteLookupKey(tokenHash)).catch(() => {});
    }

    async function storeResetToken(env, { token, accountId, requestedBy }) {
      const tokenHash = await hashToken(token);
      if (!tokenHash) throw new Error('failed to hash reset token');
      const recordId = crypto.randomUUID();
      const nowIso = new Date().toISOString();
      const expiresAt = isoTimestamp(PASSWORD_RESET_TTL_SECONDS);
      const record = {
        id: recordId,
        tokenHash,
        accountId,
        requestedAt: nowIso,
        expiresAt,
        status: 'pending',
        requestedBy: requestedBy || null,
      };
      await kvPutJSONWithOptions(env, passwordResetKey(recordId), record, { expirationTtl: PASSWORD_RESET_TTL_SECONDS });
      await env.SETTINGS.put(resetLookupKey(tokenHash), recordId, { expirationTtl: PASSWORD_RESET_TTL_SECONDS });
      return { record, tokenHash, expiresAt };
    }

    async function getResetRecordByToken(env, token) {
      const tokenHash = await hashToken(token);
      if (!tokenHash) return null;
      const recordId = await env.SETTINGS.get(resetLookupKey(tokenHash));
      if (!recordId) return null;
      const record = await kvGetJSON(env, passwordResetKey(recordId));
      if (!record) return null;
      return { record, tokenHash };
    }

    async function updateResetRecord(env, id, updates) {
      const key = passwordResetKey(id);
      const record = await kvGetJSON(env, key);
      if (!record) return null;
      Object.assign(record, updates, { updatedAt: new Date().toISOString() });
      await kvPutJSON(env, key, record);
      if (updates.status && updates.status !== 'pending') {
        await env.SETTINGS.delete(resetLookupKey(record.tokenHash)).catch(() => {});
      }
      return record;
    }

    function getAppBaseUrl(env) {
      const raw = nk(env?.APP_BASE_URL);
      if (!raw) return 'https://ncd-app.altry.workers.dev';
      return raw.replace(/\/+$/, '');
    }

    function getAcceptInviteUrl(env, token) {
      const base = getAppBaseUrl(env);
      return `${base}/auth/accept-invite?token=${encodeURIComponent(token)}`;
    }

    function getPasswordResetUrl(env, token) {
      const base = getAppBaseUrl(env);
      return `${base}/auth/reset-password?token=${encodeURIComponent(token)}`;
    }

    async function sendInviteEmail(env, {
      clinic,
      invite,
      token,
    }) {
      try {
        const mail = createMailClient(env);
        const acceptUrl = getAcceptInviteUrl(env, token);
        const roleLabel = invite.role === 'clinicAdmin' ? '施設管理者' : 'スタッフ';
        const clinicName = clinic?.name || '施設';
        const subject = `[NCD] ${clinicName}の${roleLabel}アカウント招待`;
        const text = [
          `${clinicName}の${roleLabel}アカウントに招待されています。`,
          '',
          '以下のリンクからパスワードを設定し、ログインを完了してください。',
          acceptUrl,
          '',
          'リンクの有効期限は24時間です。期限切れの場合は、システム管理者に再招待を依頼してください。',
        ].join('\n');
        const html = [
          `<p>${clinicName}の${roleLabel}アカウントに招待されています。</p>`,
          `<p><a href="${acceptUrl}">こちらのリンク</a>からパスワードを設定し、ログインを完了してください。</p>`,
          '<p>リンクの有効期限は24時間です。期限切れの場合は、システム管理者に再招待を依頼してください。</p>',
        ].join('');
        return await mail.send({
          to: invite.email,
          subject,
          text,
          html,
        });
      } catch (err) {
        console.error('[mail] failed to send invite email', err);
        return { ok: false, error: err.message };
      }
    }

    async function sendPasswordResetEmail(env, { account, token }) {
      try {
        const mail = createMailClient(env);
        const resetUrl = getPasswordResetUrl(env, token);
        const subject = '[NCD] パスワード再設定のご案内';
        const text = [
          'パスワードの再設定がリクエストされました。',
          '',
          '以下のリンクから新しいパスワードを設定してください。',
          resetUrl,
          '',
          'リンクの有効期限は30分です。心当たりがない場合は、このメールを破棄してください。',
        ].join('\n');
        const html = [
          '<p>パスワードの再設定がリクエストされました。</p>',
          `<p><a href="${resetUrl}">こちらのリンク</a>から新しいパスワードを設定してください。</p>`,
          '<p>リンクの有効期限は30分です。心当たりがない場合は、このメールを破棄してください。</p>',
        ].join('');
        return await mail.send({
          to: account.primaryEmail,
          subject,
          text,
          html,
        });
      } catch (err) {
        console.error('[mail] failed to send password reset email', err);
        return { ok: false, error: err.message };
      }
    }

    function adminRequestKey(id) {
      return `${ADMIN_REQUEST_PREFIX}${id}`;
    }

    function adminRequestEmailKey(emailLower) {
      return `${ADMIN_REQUEST_PENDING_EMAIL_PREFIX}${emailLower}`;
    }

    function sanitizeAdminRequest(record) {
      if (!record || typeof record !== 'object') return null;
      return {
        id: record.id || null,
        status: record.status || 'pending',
        email: record.email || null,
        displayName: record.displayName || null,
        clinicId: record.clinicId || null,
        clinicName: record.clinicName || null,
        notes: record.notes || '',
        accountId: record.accountId || null,
        requestedAt: record.requestedAt || null,
        updatedAt: record.updatedAt || null,
        processedBy: record.processedBy || null,
        processedAt: record.processedAt || null,
        decisionReason: record.decisionReason || null,
        metadata: record.metadata || {},
        inviteId: record.inviteId || null,
        approvedMembershipId: record.approvedMembershipId || null,
      };
    }

    async function getAdminRequestById(env, id) {
      if (!id) return null;
      return kvGetJSON(env, adminRequestKey(id));
    }

    async function saveAdminRequestRecord(env, record) {
      if (!record || !record.id) {
        throw new Error('Invalid admin request record');
      }
      record.updatedAt = new Date().toISOString();
      await kvPutJSON(env, adminRequestKey(record.id), record);
      return record;
    }

    async function createAdminRequestRecord(env, record) {
      if (!record || !record.id) {
        throw new Error('Invalid admin request record');
      }
      await kvPutJSON(env, adminRequestKey(record.id), record);
      return record;
    }

    async function setPendingAdminRequestEmail(env, emailLower, requestId) {
      const key = adminRequestEmailKey(emailLower);
      if (!requestId) {
        await env.SETTINGS.delete(key).catch(() => {});
        return;
      }
      await env.SETTINGS.put(key, requestId);
    }

    async function clearPendingAdminRequestEmail(env, emailLower, requestId) {
      if (!emailLower) return;
      const key = adminRequestEmailKey(emailLower);
      try {
        const stored = await env.SETTINGS.get(key);
        if (!stored) return;
        if (!requestId || stored === requestId) {
          await env.SETTINGS.delete(key);
        }
      } catch (err) {
        console.warn('[adminRequest] failed to clear pending email index', err);
      }
    }

    async function listAdminRequests(env, {
      status,
      limit = ADMIN_REQUEST_DEFAULT_LIMIT,
      cursor,
    } = {}) {
      const normalizedStatus = status ? status.toString().trim().toLowerCase() : '';
      const collected = [];
      let nextCursor = cursor;
      let listComplete = false;
      const maxIterations = 10;
      let iterations = 0;

      while (collected.length < limit && !listComplete && iterations < maxIterations) {
        const listResponse = await env.SETTINGS.list({
          prefix: ADMIN_REQUEST_PREFIX,
          cursor: nextCursor,
          limit: 100,
        });
        nextCursor = listResponse.cursor;
        listComplete = listResponse.list_complete;
        iterations += 1;

        for (const entry of listResponse.keys) {
          const record = await kvGetJSON(env, entry.name);
          if (!record) continue;
          if (normalizedStatus && (record.status || '').toLowerCase() !== normalizedStatus) {
            continue;
          }
          collected.push(sanitizeAdminRequest(record));
          if (collected.length >= limit) break;
        }
      }

      return {
        requests: collected,
        cursor: listComplete || !nextCursor ? undefined : nextCursor,
      };
    }

    function getAdminNotifyRecipients(env) {
      const raw = nk(env?.ADMIN_NOTIFY_EMAILS);
      if (!raw) return [];
      return raw
        .split(/[,\s]+/)
        .map((item) => normalizeEmail(item))
        .filter(Boolean);
    }

    async function sendAdminRequestReceivedEmail(env, { request, clinicName }) {
      try {
        const recipient = normalizeEmail(request?.email);
        if (!recipient) return { ok: false, skipped: true, reason: 'missingEmail' };
        const mail = createMailClient(env);
        const namePart = request.displayName ? `${request.displayName} 様` : '申請者様';
        const lines = [
          namePart,
          '',
          'NCD（中野区診療所データベース）の管理者権限申請を受け付けました。',
          clinicName ? `対象施設: ${clinicName}` : '',
          '',
          '審査完了まで数日かかる場合があります。承認が完了すると、別途メールでお知らせいたします。',
        ].filter(Boolean);
        const text = lines.join('\n');
        const html = lines.map((line) => `<p>${line || '&nbsp;'}</p>`).join('');
        return await mail.send({
          to: recipient,
          subject: '[NCD] 管理者権限申請を受け付けました',
          text,
          html,
        });
      } catch (err) {
        console.error('[mail] failed to send admin request received email', err);
        return { ok: false, error: err.message };
      }
    }

    async function sendAdminRequestNotifyEmail(env, { request, clinicName }) {
      try {
        const recipients = getAdminNotifyRecipients(env);
        if (!recipients.length) {
          return { ok: false, skipped: true, reason: 'noRecipients' };
        }
        const mail = createMailClient(env);
        const text = [
          '新しい管理者権限の申請が届きました。',
          '',
          `申請ID: ${request.id}`,
          `申請者: ${request.displayName || '未入力'} (${request.email})`,
          clinicName ? `施設: ${clinicName}` : '',
          request.notes ? `備考: ${request.notes}` : '',
          '',
          '管理画面から承認または却下の対応を行ってください。',
        ].filter(Boolean).join('\n');
        const html = text.split('\n').map((line) => `<p>${line || '&nbsp;'}</p>`).join('');
        return await mail.send({
          to: recipients,
          subject: '[NCD] 管理者権限の新しい申請が届きました',
          text,
          html,
        });
      } catch (err) {
        console.error('[mail] failed to send admin request notify email', err);
        return { ok: false, error: err.message };
      }
    }

    async function sendAdminRequestApprovedEmail(env, { request, clinicName, loginUrl }) {
      try {
        const recipient = normalizeEmail(request?.email);
        if (!recipient) return { ok: false, skipped: true, reason: 'missingEmail' };
        const mail = createMailClient(env);
        const lines = [
          request.displayName ? `${request.displayName} 様` : '申請者様',
          '',
          'NCD（中野区診療所データベース）の管理者権限が有効になりました。',
          clinicName ? `施設: ${clinicName}` : '',
          '',
          loginUrl ? `以下のリンクからログインし、施設管理を開始してください。\n${loginUrl}` : '通常のログインページからアクセスしてください。',
        ];
        const text = lines.join('\n');
        const html = lines.map((line) => {
          if (!line) return '<p>&nbsp;</p>';
          if (loginUrl && line.includes(loginUrl)) {
            return `<p><a href="${loginUrl}">${loginUrl}</a></p>`;
          }
          return `<p>${line}</p>`;
        }).join('');
        return await mail.send({
          to: recipient,
          subject: '[NCD] 管理者権限が有効になりました',
          text,
          html,
        });
      } catch (err) {
        console.error('[mail] failed to send admin request approved email', err);
        return { ok: false, error: err.message };
      }
    }

    async function sendAdminRequestDeniedEmail(env, { request, clinicName, reason }) {
      try {
        const recipient = normalizeEmail(request?.email);
        if (!recipient) return { ok: false, skipped: true, reason: 'missingEmail' };
        const mail = createMailClient(env);
        const lines = [
          request.displayName ? `${request.displayName} 様` : '申請者様',
          '',
          '管理者権限の申請について、今回は見送らせていただきました。',
          clinicName ? `対象施設: ${clinicName}` : '',
          reason ? `理由: ${reason}` : '',
          '',
          'ご不明な点があれば、医師会事務局までお問い合わせください。',
        ];
        const text = lines.join('\n');
        const html = lines.map((line) => `<p>${line || '&nbsp;'}</p>`).join('');
        return await mail.send({
          to: recipient,
          subject: '[NCD] 管理者権限申請の結果について',
          text,
          html,
        });
      } catch (err) {
        console.error('[mail] failed to send admin request denied email', err);
        return { ok: false, error: err.message };
      }
    }

    function normalizeProfileInput(profile = {}, fallbackDisplayName) {
      const result = {};
      const displayName = nk(profile.displayName || profile.name || fallbackDisplayName);
      if (displayName) result.displayName = displayName;
      const displayNameKana = nk(profile.displayNameKana || profile.nameKana);
      if (displayNameKana) result.displayNameKana = displayNameKana;
      const phone = nk(profile.phone || profile.tel);
      if (phone) result.phone = phone;
      const title = nk(profile.title || profile.position);
      if (title) result.title = title;
      return result;
    }

    async function createAccountRecord(env, {
      email,
      password,
      role = 'clinicStaff',
      status = 'active',
      loginId,
      profile = {},
      invitedBy,
    }) {
      const normalizedEmail = normalizeEmail(email);
      if (!normalizedEmail) {
        throw new Error('Email is required to create an account');
      }
      const emailLocal = normalizedEmail.split('@')[0] || 'user';
      const loginCandidate = loginId ? normalizeSlug(loginId) : normalizeSlug(emailLocal);
      const uniqueLoginId = await ensureUniqueId({
        kv: env.SETTINGS,
        prefix: 'account:login:',
        candidate: loginCandidate,
        normalize: (value) => value.toLowerCase(),
        randomLength: 10,
      });
      const passwordHash = await hashPassword(password);
      const accountUuid = crypto.randomUUID();
      const accountId = `account:${accountUuid}`;
      const nowIso = new Date().toISOString();
      const accountRecord = {
        id: accountId,
        loginId: uniqueLoginId,
        primaryEmail: normalizedEmail,
        role,
        status,
        passwordHash,
        profile,
        securityQuestion: null,
        membershipIds: [],
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      if (invitedBy) {
        accountRecord.invitedBy = invitedBy;
      }
      const accountKey = resolveAccountStorageKey(accountId);
      await kvPutJSON(env, accountKey, accountRecord);
      await env.SETTINGS.put(accountLoginKey(uniqueLoginId), accountUuid);
      await env.SETTINGS.put(accountEmailKey(normalizedEmail), accountUuid);
      return { account: accountRecord, accountKey, accountId };
    }

    async function saveAccountRecord(env, account) {
      const key = resolveAccountStorageKey(account?.id);
      if (!key) throw new Error('Invalid account identifier');
      account.updatedAt = new Date().toISOString();
      await kvPutJSON(env, key, account);
    }

    function getSecurityQuestionById(questionId) {
      const normalized = nk(questionId);
      if (!normalized) return null;
      return SECURITY_QUESTIONS.find((q) => q.id === normalized) || null;
    }

    function publicSecurityQuestionView(securityQuestion) {
      if (!securityQuestion || typeof securityQuestion !== 'object') {
        return null;
      }
      const { questionId, answerFormat, updatedAt } = securityQuestion;
      if (!questionId || !SECURITY_ANSWER_FORMATS.has(answerFormat)) {
        return null;
      }
      return {
        questionId,
        answerFormat,
        updatedAt: updatedAt || null,
      };
    }

    async function setAccountSecurityQuestion(env, account, { questionId, answer, answerFormat }) {
      if (!account || !account.id) {
        throw new Error('Account is required to set security question');
      }
      const question = getSecurityQuestionById(questionId);
      if (!question) {
        const error = new Error('INVALID_SECURITY_QUESTION');
        error.code = 'INVALID_SECURITY_QUESTION';
        throw error;
      }
      const format = normalizeSecurityAnswerFormat(answerFormat);
      const normalizedAnswer = normalizeSecurityAnswer(answer, format);
      if (!normalizedAnswer) {
        const error = new Error('INVALID_SECURITY_ANSWER');
        error.code = 'INVALID_SECURITY_ANSWER';
        throw error;
      }
      const answerHash = await hashPassword(normalizedAnswer);
      account.securityQuestion = {
        questionId: question.id,
        answerFormat: format,
        answerHash,
        answerNormalized: normalizedAnswer,
        updatedAt: new Date().toISOString(),
      };
      await saveAccountRecord(env, account);
      return publicSecurityQuestionView(account.securityQuestion);
    }

    async function verifyAccountSecurityAnswer(account, answer) {
      if (!account || !account.securityQuestion) {
        return false;
      }
      const { securityQuestion } = account;
      const format = normalizeSecurityAnswerFormat(securityQuestion.answerFormat);
      const normalizedAnswer = normalizeSecurityAnswer(answer, format);
      if (!normalizedAnswer) {
        return false;
      }
      if (securityQuestion.answerHash) {
        try {
          const isMatch = await verifyPassword(normalizedAnswer, securityQuestion.answerHash);
          if (isMatch) {
            return true;
          }
        } catch (err) {
          console.warn('verifyAccountSecurityAnswer failed', err);
        }
      }
      if (securityQuestion.answerNormalized) {
        return securityQuestion.answerNormalized === normalizedAnswer;
      }
      return false;
    }

    async function createMembershipRecord(env, {
      clinicId,
      clinicName = '',
      accountId,
      roles = ['clinicStaff'],
      status = 'active',
      invitedBy,
      organizationId = null,
      organizationName = null,
      departments = [],
      committees = [],
      groups = [],
      label,
      meta,
    }) {
      const membershipUuid = crypto.randomUUID();
      const membershipId = `membership:${membershipUuid}`;
      const nowIso = new Date().toISOString();
      const normalizedRoles = Array.isArray(roles) && roles.length ? roles : ['clinicStaff'];
      const membershipRecord = {
        id: membershipId,
        clinicId,
        clinicName: clinicName || null,
        accountId,
        roles: normalizedRoles,
        primaryRole: normalizedRoles[0] || null,
        status,
        invitedBy: invitedBy || null,
        organizationId: organizationId || null,
        organizationName: organizationName || null,
        departments: normalizeStringArray(departments),
        committees: normalizeStringArray(committees),
        groups: normalizeStringArray(groups),
        label: label ? nk(label) : (clinicName || ''),
        meta: meta && typeof meta === 'object' ? meta : null,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      await kvPutJSON(env, membershipId, membershipRecord);
      return membershipRecord;
    }

    async function getMembershipById(env, membershipId) {
      if (!membershipId) return null;
      return kvGetJSON(env, membershipId);
    }

    function applyClinicContextToMembership(record, clinic) {
      if (!record || !clinic) return record;
      if (clinic.name && !record.clinicName) {
        record.clinicName = clinic.name;
      }
      if (!record.label && clinic.name) {
        record.label = clinic.name;
      }
      const clinicOrgId = clinic.organizationId || null;
      if (clinicOrgId && !record.organizationId) {
        record.organizationId = clinicOrgId;
      }
      const clinicOrgName = clinic.organizationName || clinic.organization?.name || null;
      if (clinicOrgName && !record.organizationName) {
        record.organizationName = clinicOrgName;
      }
      return record;
    }

    function sanitizeMembershipRecord(record) {
      if (!record || typeof record !== 'object') return null;
      const roles = Array.isArray(record.roles) ? record.roles.filter(Boolean) : [];
      const primaryRole = record.primaryRole || (roles.length ? roles[0] : null);
      const normalizeList = (value) => {
        if (!Array.isArray(value)) return [];
        const seen = new Set();
        const result = [];
        for (const entry of value) {
          const text = nk(entry);
          if (!text || seen.has(text)) continue;
          seen.add(text);
          result.push(text);
        }
        return result;
      };
      return {
        id: record.id || null,
        clinicId: record.clinicId || null,
        clinicName: record.clinicName || '',
        accountId: record.accountId || null,
        roles,
        primaryRole,
        status: record.status || 'active',
        invitedBy: record.invitedBy || null,
        organizationId: record.organizationId || null,
        organizationName: record.organizationName || null,
        departments: normalizeList(record.departments),
        committees: normalizeList(record.committees),
        groups: normalizeList(record.groups),
        label: record.label || record.clinicName || '',
        meta: record.meta && typeof record.meta === 'object' ? record.meta : null,
        createdAt: record.createdAt || null,
        updatedAt: record.updatedAt || null,
      };
    }

    async function resolveAccountMemberships(env, account) {
      const rawIds = normalizeMembershipIds(account);
      if (!rawIds.length) {
        return { membershipIds: [], memberships: [] };
      }
      const dedupedIds = [];
      const seenIds = new Set();
      for (const id of rawIds) {
        if (typeof id !== 'string' || !id) continue;
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        dedupedIds.push(id);
      }

      const membershipMap = new Map();
      if (Array.isArray(account?.memberships)) {
        for (const entry of account.memberships) {
          const sanitized = sanitizeMembershipRecord(entry);
          if (sanitized && sanitized.id && seenIds.has(sanitized.id) && !membershipMap.has(sanitized.id)) {
            membershipMap.set(sanitized.id, sanitized);
          }
        }
      }

      for (const membershipId of dedupedIds) {
        if (membershipMap.has(membershipId)) continue;
        try {
          const record = await getMembershipById(env, membershipId);
          const sanitized = sanitizeMembershipRecord(record);
          if (sanitized && sanitized.id) {
            membershipMap.set(sanitized.id, sanitized);
          }
        } catch (err) {
          console.warn('resolveAccountMemberships failed to fetch', membershipId, err);
        }
      }

      return {
        membershipIds: dedupedIds,
        memberships: Array.from(membershipMap.values()),
      };
    }

    const EXPLANATION_STATUS_SET = new Set(["draft", "published", "archived"]);

    function sanitizeExplanationStatus(value) {
      const raw = (value || "").toString().trim().toLowerCase();
      if (EXPLANATION_STATUS_SET.has(raw)) {
        return raw;
      }
      return "draft";
    }

    function ensureExplanationArray(item) {
      if (!item || typeof item !== "object") return [];
      if (!Array.isArray(item.explanations)) {
        item.explanations = [];
      }
      return item.explanations;
    }

    function sanitizeExistingExplanation(raw, fallbackStatus = "draft") {
      if (!raw || typeof raw !== "object") return null;
      const text = nk(raw.text || raw.baseText || raw.desc);
      if (!text) return null;
      const id = nk(raw.id);
      const now = Math.floor(Date.now() / 1000);
      const createdAtNum = Number(raw.createdAt);
      const updatedAtNum = Number(raw.updatedAt);
      const audience = nk(raw.audience);
      const context = nk(raw.context);
      const source = nk(raw.source);
      return {
        id: id || crypto.randomUUID(),
        text,
        status: sanitizeExplanationStatus(raw.status || fallbackStatus),
        audience: audience || null,
        context: context || null,
        source: source || null,
        createdAt: Number.isFinite(createdAtNum) ? createdAtNum : now,
        updatedAt: Number.isFinite(updatedAtNum) ? updatedAtNum : now,
      };
    }

    function normalizeItemExplanations(item, { fallbackStatus = "draft" } = {}) {
      if (!item || typeof item !== "object") return [];
      const explanations = ensureExplanationArray(item);
      const sanitized = [];
      const seenTexts = new Set();
      const now = Math.floor(Date.now() / 1000);

      for (const entry of explanations) {
        const sanitizedEntry = sanitizeExistingExplanation(entry, fallbackStatus);
        if (!sanitizedEntry) continue;
        const key = sanitizedEntry.text;
        if (seenTexts.has(key)) {
          const existing = sanitized.find(e => e.text === key);
          if (existing) {
            existing.updatedAt = Math.max(existing.updatedAt, sanitizedEntry.updatedAt || now);
            if (!existing.audience && sanitizedEntry.audience) existing.audience = sanitizedEntry.audience;
            if (!existing.context && sanitizedEntry.context) existing.context = sanitizedEntry.context;
            if (!existing.source && sanitizedEntry.source) existing.source = sanitizedEntry.source;
            if (sanitizedEntry.status === "published" && existing.status !== "published") {
              existing.status = "published";
            }
          }
          continue;
        }
        seenTexts.add(key);
        sanitized.push(sanitizedEntry);
      }

      // 旧データへのフォールバック: desc や desc_samples から生成
      if (!sanitized.length) {
        const candidates = [];
        if (typeof item.desc === "string" && item.desc.trim()) {
          candidates.push(item.desc.trim());
        }
        if (Array.isArray(item.desc_samples)) {
          for (const sample of item.desc_samples) {
            if (typeof sample === "string" && sample.trim()) {
              candidates.push(sample.trim());
            }
          }
        }
        for (const candidate of candidates) {
          if (seenTexts.has(candidate)) continue;
          seenTexts.add(candidate);
          sanitized.push({
            id: crypto.randomUUID(),
            text: candidate,
            status: fallbackStatus,
            audience: null,
            context: null,
            source: null,
            createdAt: now,
            updatedAt: now,
          });
        }
      }

      item.explanations = sanitized;
      if (!Array.isArray(item.desc_samples)) {
        item.desc_samples = [];
      }

      const sampleSet = new Set(item.desc_samples.filter(s => typeof s === "string" && s));
      for (const entry of sanitized) {
        if (!sampleSet.has(entry.text)) {
          item.desc_samples.push(entry.text);
          sampleSet.add(entry.text);
        }
      }

      if (!nk(item.desc) && sanitized.length) {
        const published = sanitized.find(s => s.status === "published");
        item.desc = (published || sanitized[0]).text;
      }

      return item.explanations;
    }

    function addExplanationToItem(item, payload = {}, options = {}) {
      if (!item || typeof item !== "object") return null;
      const text = nk(payload.text || payload.baseText || payload.desc);
      if (!text) return null;
      const status = sanitizeExplanationStatus(payload.status || options.defaultStatus || "draft");
      const audience = nk(payload.audience);
      const context = nk(payload.context);
      const source = nk(payload.source);
      const explanations = ensureExplanationArray(item);
      const now = Math.floor(Date.now() / 1000);

      const existing = explanations.find(entry => nk(entry.text) === text);
      if (existing) {
        existing.updatedAt = now;
        existing.status = sanitizeExplanationStatus(payload.status || existing.status);
        if (audience) existing.audience = audience;
        if (context) existing.context = context;
        if (source && !existing.source) existing.source = source;
        return existing;
      }

      const entry = {
        id: crypto.randomUUID(),
        text,
        status,
        audience: audience || null,
        context: context || null,
        source: source || null,
        createdAt: now,
        updatedAt: now,
      };
      explanations.push(entry);
      if (!Array.isArray(item.desc_samples)) {
        item.desc_samples = [];
      }
      if (!item.desc_samples.includes(text)) {
        item.desc_samples.push(text);
      }
      if (!nk(item.desc)) {
        item.desc = text;
      }
      return entry;
    }

    function syncExplanationDerivedFields(item) {
      if (!item || typeof item !== "object") return;
      const explanations = normalizeItemExplanations(item);
      if (!Array.isArray(explanations) || !explanations.length) {
        return;
      }
      const published = explanations.find(entry => entry.status === "published");
      if (!nk(item.desc)) {
        item.desc = (published || explanations[0]).text;
      }
      if (!Array.isArray(item.desc_samples)) {
        item.desc_samples = [];
      }
      const sampleSet = new Set(item.desc_samples.filter(s => typeof s === 'string' && s));
      explanations.forEach(entry => {
        if (!sampleSet.has(entry.text)) {
          item.desc_samples.push(entry.text);
          sampleSet.add(entry.text);
        }
      });
    }

    // 正規化キー（マスター用）
    function normalizeKey(type, category, name) {
      const zenkakuToHankaku = (s) => s.normalize("NFKC");
      const clean = (s) =>
        zenkakuToHankaku((s || "").trim().toLowerCase().replace(/\s+/g, ""));
      return `master:${type}:${clean(category)}|${clean(name)}`;
    }

    function normalizeForSimilarity(s) {
      return (s || "")
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[\s\u3000・･\-ー（）()]/g, "");
    }

    function normalizeThesaurusTerm(s) {
      return (s || "")
        .normalize("NFKC")
        .trim()
        .toLowerCase();
    }

    function sanitizeKeySegment(value) {
      if (!value) return '';
      return value
        .normalize('NFKC')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '');
    }

    function comparableMasterKey(type, category, name) {
      const t = sanitizeKeySegment(type);
      const c = sanitizeKeySegment(category);
      const n = sanitizeKeySegment(name);
      if (!t || !c || !n) return null;
      return `${t}:${c}|${n}`;
    }

    function parseMasterKeyLoose(key) {
      if (!key) return null;
      let raw = key.trim();
      if (raw.startsWith('master:')) {
        raw = raw.substring(7);
      }
      const typeSep = raw.indexOf(':');
      if (typeSep === -1) return null;
      const type = raw.substring(0, typeSep);
      const rest = raw.substring(typeSep + 1);
      const nameSep = rest.indexOf('|');
      if (nameSep === -1) return null;
      const category = rest.substring(0, nameSep);
      const name = rest.substring(nameSep + 1);
      const comparable = comparableMasterKey(type, category, name);
      return comparable ? { type, category, name, comparable } : null;
    }

    async function loadMasterItemsRaw(env, type) {
      const d1Items = await listMasterItemsD1(env, { type });
      return d1Items.map(item => ({ ...item }));
    }

    function masterKeyFromParts(type, category, name) {
      if (!type || !category || !name) return null;
      return `master:${type}:${category}|${name}`;
    }

    function collectMasterKeyCandidates(entry, fallbackType) {
      if (!entry || typeof entry !== 'object') return [];
      const keys = [];
      const possibleProps = ['masterKey', 'masterkey', 'master_key'];
      for (const prop of possibleProps) {
        const value = entry[prop];
        if (typeof value === 'string' && value.trim()) {
          keys.push(value.trim());
        }
      }
      const type = typeof entry.type === 'string' && entry.type ? entry.type : fallbackType;
      const category = entry.category;
      const name = entry.name;
      if (type && category && name) {
        keys.push(`master:${type}:${category}|${name}`);
      }
      return keys;
    }

    function extractComparableKeys(entry, fallbackType) {
      const keys = new Set();
      for (const candidate of collectMasterKeyCandidates(entry, fallbackType)) {
        const parsed = parseMasterKeyLoose(candidate);
        if (!parsed) continue;
        const expectedType = fallbackType || parsed.type;
        if (expectedType && parsed.type !== expectedType) continue;
        if (parsed.comparable) {
          keys.add(parsed.comparable);
        }
      }
      return Array.from(keys);
    }

    function normalizeBodySiteRef(ref) {
      if (!ref) return null;
      let raw = ref.trim();
      if (!raw) return null;
      const lower = raw.toLowerCase();
      if (lower.startsWith('bodysite:')) {
        raw = raw.substring('bodysite:'.length);
      }
      const normalized = sanitizeKeySegment(raw);
      if (!normalized) return null;
      return `bodysite:${normalized}`;
    }

    function bodySiteRefCandidates(item) {
      const refs = new Set();
      if (!item || typeof item !== 'object') return Array.from(refs);
      const values = [item.canonical_name, item.name, item.category];
      for (const value of values) {
        const normalized = normalizeBodySiteRef(value);
        if (normalized) refs.add(normalized);
      }
      return Array.from(refs);
    }

    function extractNameAndNote(name) {
      const value = nk(name);
      if (!value) {
        return { base: "", note: "" };
      }
      const match = value.match(/^(.*?)[(（]([^()（）]+)[)）]\s*$/);
      if (!match) {
        return { base: value, note: "" };
      }
      const base = nk(match[1]);
      const note = nk(match[2]);
      return { base: base || value, note };
    }

    function mergeNotes(...inputs) {
      const collected = [];
      for (const input of inputs) {
        if (!input) continue;
        if (Array.isArray(input)) {
          for (const value of input) {
            const trimmed = nk(value);
            if (trimmed) collected.push(trimmed);
          }
        } else {
          const trimmed = nk(input);
          if (trimmed) collected.push(trimmed);
        }
      }
      const unique = Array.from(new Set(collected));
      return unique.join(' / ');
    }

    function inferQualClassification(category, current) {
      const existing = nk(current);
      if (existing) return existing;
      const cat = nk(category);
      if (/看護/.test(cat)) return '看護';
      if (/療法|リハビリ|技師|技術/.test(cat)) return 'コメディカル';
      if (/事務|管理/.test(cat)) return '事務';
      return '医師';
    }

    function jaroWinkler(a, b) {
      if (!a || !b) return 0;
      if (a === b) return 1;
      const matchDistance = Math.floor(Math.max(a.length, b.length) / 2) - 1;
      const aMatches = new Array(a.length).fill(false);
      const bMatches = new Array(b.length).fill(false);
      let matches = 0;
      let transpositions = 0;

      for (let i = 0; i < a.length; i++) {
        const start = Math.max(0, i - matchDistance);
        const end = Math.min(i + matchDistance + 1, b.length);
        for (let j = start; j < end; j++) {
          if (bMatches[j]) continue;
          if (a[i] !== b[j]) continue;
          aMatches[i] = true;
          bMatches[j] = true;
          matches++;
          break;
        }
      }

      if (matches === 0) return 0;

      let k = 0;
      for (let i = 0; i < a.length; i++) {
        if (!aMatches[i]) continue;
        while (!bMatches[k]) k++;
        if (a[i] !== b[k]) transpositions++;
        k++;
      }

      const m = matches;
      const jaro = (m / a.length + m / b.length + (m - transpositions / 2) / m) / 3;

      let prefix = 0;
      for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
        if (a[i] === b[i]) prefix++;
        else break;
      }
      return jaro + prefix * 0.1 * (1 - jaro);
    }

    // KV JSONユーティリティ
    async function kvGetJSON(env, key) {
      const raw = await env.SETTINGS.get(key);
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    }
    async function kvPutJSON(env, key, obj) {
      return env.SETTINGS.put(key, JSON.stringify(obj));
    }
    async function kvPutJSONWithOptions(env, key, obj, options = {}) {
      return env.SETTINGS.put(key, JSON.stringify(obj), options);
    }

    // 施設: 取得/保存
    function pickFresherClinic(candidateA, candidateB) {
      if (candidateA && candidateB) {
        const updatedA = candidateA.updated_at || 0;
        const updatedB = candidateB.updated_at || 0;
        return updatedA >= updatedB ? candidateA : candidateB;
      }
      return candidateA || candidateB || null;
    }

    async function getClinicById(env, id) {
      if (!id) return null;
      let d1Clinic = null;
      if (hasFacilitiesD1(env)) {
        d1Clinic = await getClinicFromD1(env, 'id', id);
      }
      const kvClinicRaw = await kvGetJSON(env, `clinic:id:${id}`);
      const kvClinic = normalizeClinicRecord(kvClinicRaw);
      if (!d1Clinic && !kvClinic) return null;
      return pickFresherClinic(d1Clinic, kvClinic);
    }
    async function getClinicByName(env, name) {
      if (!name) return null;
      let d1Clinic = null;
      if (hasFacilitiesD1(env)) {
        d1Clinic = await getClinicFromD1(env, 'name', name);
      }
      let kvClinic = null;
      const idx = await env.SETTINGS.get(`clinic:name:${name}`);
      if (idx) {
        kvClinic = await getClinicById(env, idx);
      } else {
        const fallback = await kvGetJSON(env, `clinic:${name}`);
        kvClinic = normalizeClinicRecord(fallback);
      }
      if (!d1Clinic && !kvClinic) return null;
      return pickFresherClinic(d1Clinic, kvClinic);
    }
    async function getClinicByMhlwFacilityId(env, facilityId) {
      const normalized = normalizeMhlwFacilityId(facilityId);
      if (!normalized) return null;
      let d1Clinic = null;
      if (hasFacilitiesD1(env)) {
        d1Clinic = await getClinicFromD1(env, 'external_id', normalized);
      }
      let kvClinic = null;
      const pointer = await env.SETTINGS.get(`clinic:mhlw:${normalized}`);
      if (pointer) {
        kvClinic = await getClinicById(env, pointer);
      }
      if (!d1Clinic && !kvClinic) return null;
      return pickFresherClinic(d1Clinic, kvClinic);
    }
    async function saveClinic(env, clinic) {
      const now = Math.floor(Date.now()/1000);
      clinic = clonePlain(clinic);
      clinic.updated_at = now;
      let existing = null;
      if (clinic.id) {
        existing = await getClinicById(env, clinic.id);
      }
      if (!clinic.id && clinic.name) {
        existing = await getClinicByName(env, clinic.name);
        if (existing?.id) {
          clinic.id = existing.id;
        }
      }
      if (!clinic.id) {
        clinic.id = crypto.randomUUID();
        clinic.created_at = now;
      } else if (!clinic.created_at && existing?.created_at) {
        clinic.created_at = existing.created_at;
      }

      if (!clinic.facilityType) {
        clinic.facilityType = existing?.facilityType || 'clinic';
      }

      const previousMhlwId = existing?.mhlwFacilityId ? normalizeMhlwFacilityId(existing.mhlwFacilityId) : '';
      const newMhlwId = clinic.mhlwFacilityId ? normalizeMhlwFacilityId(clinic.mhlwFacilityId) : '';
      if (newMhlwId) {
        const existingByMhlw = await getClinicByMhlwFacilityId(env, newMhlwId);
        if (existingByMhlw && existingByMhlw.id !== clinic.id) {
          const conflictError = new Error('MHLW_FACILITY_ID_CONFLICT');
          conflictError.code = 'MHLW_FACILITY_ID_CONFLICT';
          conflictError.existingClinicId = existingByMhlw.id;
          throw conflictError;
        }
        clinic.mhlwFacilityId = newMhlwId;
      } else {
        clinic.mhlwFacilityId = null;
      }
      const requestedSyncStatusRaw = nk(clinic.mhlwSyncStatus || clinic.mhlw_sync_status);
      let requestedSyncStatus = requestedSyncStatusRaw ? requestedSyncStatusRaw.toLowerCase() : '';
      if (!MHLW_SYNC_STATUSES.has(requestedSyncStatus)) {
        requestedSyncStatus = '';
      }
      if (newMhlwId) {
        if (!requestedSyncStatus || requestedSyncStatus === 'not_found') {
          if (existing?.mhlwSyncStatus === 'manual') {
            requestedSyncStatus = 'manual';
          } else {
            requestedSyncStatus = 'linked';
          }
        }
      } else {
        if (!requestedSyncStatus && existing?.mhlwSyncStatus) {
          requestedSyncStatus = existing.mhlwSyncStatus;
        }
        if (!requestedSyncStatus) {
          requestedSyncStatus = 'pending';
        }
      }
      clinic.mhlwSyncStatus = requestedSyncStatus;
      const manualNoteInput = clinic.mhlwManualNote ?? clinic.mhlw_manual_note;
      if (manualNoteInput !== undefined) {
        clinic.mhlwManualNote = nk(manualNoteInput) || null;
      } else if (existing?.mhlwManualNote) {
        clinic.mhlwManualNote = existing.mhlwManualNote;
      } else {
        clinic.mhlwManualNote = null;
      }
      if (existing?.name && existing.name !== clinic.name) {
        await env.SETTINGS.delete(`clinic:name:${existing.name}`).catch(() => {});
        await env.SETTINGS.delete(`clinic:${existing.name}`).catch(() => {});
      }
      if (previousMhlwId && previousMhlwId !== newMhlwId) {
        await env.SETTINGS.delete(`clinic:mhlw:${previousMhlwId}`).catch(() => {});
      }
      clinic = normalizeClinicRecord({
        ...existing,
        ...clinic,
      });
      clinic.mhlwFacilityId = newMhlwId || null;
      clinic.updated_at = now;
      if (!clinic.created_at && existing?.created_at) {
        clinic.created_at = existing.created_at;
      } else if (!clinic.created_at) {
        clinic.created_at = now;
      }

      clinic = await upsertClinicD1(env, clinic);

      if (clinic.name) {
        await env.SETTINGS.put(`clinic:name:${clinic.name}`, clinic.id);
        await kvPutJSON(env, `clinic:${clinic.name}`, clinic); // 互換
      }
      if (clinic.mhlwFacilityId) {
        await env.SETTINGS.put(`clinic:mhlw:${clinic.mhlwFacilityId}`, clinic.id);
      }
      await kvPutJSON(env, `clinic:id:${clinic.id}`, clinic);
      return clinic;
    }

    function applyMhlwDataToClinic(clinic, facilityData) {
      if (!clinic) return null;
      if (!facilityData || !facilityData.facilityId) return clinic;
      const normalizedFacilityId = normalizeMhlwFacilityId(facilityData.facilityId);
      const syncedAtIso = new Date().toISOString();
      const updated = { ...clinic };
      updated.mhlwFacilityId = normalizedFacilityId;
      if (facilityData.facilityType) {
        updated.facilityType = facilityData.facilityType.toLowerCase();
      } else if (!updated.facilityType) {
        updated.facilityType = 'clinic';
      }
      const facilityName = nk(facilityData.officialName || facilityData.name);
      const facilityShortName = nk(facilityData.shortName);
      const facilityNameKana = nk(facilityData.nameKana);
      const facilityOfficialKana = nk(facilityData.officialNameKana || facilityNameKana);
      const facilityShortKana = nk(facilityData.shortNameKana || facilityNameKana);
      const currentName = nk(updated.name);
      const currentDisplayName = nk(updated.displayName);
      const currentShortName = nk(updated.shortName);

      if (facilityName) {
        updated.mhlwFacilityName = facilityName;
        updated.officialName = facilityName;
      }

      if (facilityOfficialKana) {
        updated.mhlwFacilityNameKana = facilityOfficialKana;
        updated.officialNameKana = facilityOfficialKana;
      }
      if (facilityShortKana) {
        updated.mhlwFacilityShortNameKana = facilityShortKana;
        updated.shortNameKana = facilityShortKana;
      } else if (!nk(updated.shortNameKana) && facilityOfficialKana) {
        updated.shortNameKana = facilityOfficialKana;
      }
      if (facilityNameKana) {
        updated.nameKana = facilityNameKana;
      } else if (!nk(updated.nameKana) && facilityShortKana) {
        updated.nameKana = facilityShortKana;
      }

      if (facilityShortName) {
        updated.mhlwFacilityShortName = facilityShortName;
        updated.shortName = facilityShortName;
        updated.displayName = facilityShortName;
        updated.name = facilityShortName;
      } else {
        if (!currentShortName && facilityName) {
          updated.shortName = facilityName;
        }
        if (!currentDisplayName && (updated.shortName || facilityName)) {
          updated.displayName = nk(updated.shortName || facilityName);
        }
        if (!currentName && (updated.displayName || facilityName)) {
          updated.name = nk(updated.displayName || facilityName);
        }
      }
      if (!nk(updated.displayName) && nk(updated.name)) {
        updated.displayName = nk(updated.name);
      }
      if (!nk(updated.shortName) && nk(updated.displayName)) {
        updated.shortName = nk(updated.displayName);
      }
      if (facilityData.address) {
        updated.address = facilityData.address;
      }
      if (facilityData.postalCode) {
        updated.postalCode = facilityData.postalCode;
      }
      if (facilityData.phone) {
        updated.phone = facilityData.phone;
      }
      if (facilityData.prefectureCode) {
        updated.prefectureCode = facilityData.prefectureCode;
      }
      if (facilityData.prefecture) {
        updated.prefecture = facilityData.prefecture;
      }
      if (facilityData.cityCode) {
        updated.cityCode = facilityData.cityCode;
      }
      if (facilityData.city) {
        updated.city = facilityData.city;
      }
      if (facilityData.homepageUrl) {
        const homepageUrl = facilityData.homepageUrl;
        updated.mhlwFacilityHomepageUrl = homepageUrl;
        const homepagePayload =
          updated.homepage && typeof updated.homepage === 'object' && !Array.isArray(updated.homepage)
            ? { ...updated.homepage }
            : {};
        homepagePayload.available = true;
        homepagePayload.url = homepageUrl;
        updated.homepage = homepagePayload;
        if (updated.basic && typeof updated.basic === 'object') {
          updated.basic = { ...updated.basic, website: homepageUrl };
        } else {
          updated.basic = { website: homepageUrl };
        }
        updated.website = homepageUrl;
      }
      if (typeof facilityData.latitude === 'number' && !Number.isNaN(facilityData.latitude) &&
          typeof facilityData.longitude === 'number' && !Number.isNaN(facilityData.longitude)) {
        updated.latitude = facilityData.latitude;
        updated.longitude = facilityData.longitude;
        updated.location = {
          ...(updated.location || {}),
          lat: facilityData.latitude,
          lng: facilityData.longitude,
          formattedAddress: facilityData.address || updated.location?.formattedAddress || '',
          source: 'mhlw',
          geocodedAt: syncedAtIso,
        };
      }
      if (facilityData.bedCounts && Object.keys(facilityData.bedCounts).length) {
        updated.mhlwBedCounts = facilityData.bedCounts;
      }
      if (facilityData.weeklyClosedDays) {
        updated.mhlwWeeklyClosedDays = facilityData.weeklyClosedDays;
      }
      if (facilityData.periodicClosedDays) {
        updated.mhlwPeriodicClosedDays = facilityData.periodicClosedDays;
      }
      updated.mhlwSnapshot = {
        ...facilityData,
        syncedAt: syncedAtIso,
      };
      return updated;
    }
    async function listClinicsKV(env, {limit=2000, offset=0} = {}) {
      if (hasFacilitiesD1(env)) {
        return listClinicsD1(env, { limit, offset });
      }
      const prefix = "clinic:id:";
      const ids = [];
      let cursor;
      do {
        const page = await env.SETTINGS.list({ prefix, cursor });
        const batchIds = page.keys.map(k => k.name.replace(prefix, ""));
        ids.push(...batchIds);
        cursor = page.cursor || null;
      } while (cursor);
      const total = ids.length;
      const start = Math.max(0, offset);
      const end = Math.max(start, start + limit);
      const pageIds = ids.slice(start, end);
      const values = await Promise.all(pageIds.map(id => getClinicById(env, id)));
      const out = values.filter(Boolean);
      return { items: out, total };
    }
    // <<< END: UTILS >>>

    const TODO_KEY = "todo:list";
    const MASTER_CACHE_PREFIX = 'mastercache:';
    const MASTER_CACHE_TTL_SECONDS = 300;
    const PERSONAL_QUAL_CLASSIFICATIONS = ["医師", "看護", "コメディカル", "事務", "その他"];
    const FACILITY_ACCREDITATION_TYPES = ["学会認定", "行政・公費", "地域・在宅"];

    function masterCacheKey(type, status) {
      const normalizedType = type || '__all__';
      const normalizedStatus = status || '__all__';
      return `${MASTER_CACHE_PREFIX}${normalizedType}:${normalizedStatus}`;
    }

    async function getMasterCache(env, type, status) {
      try {
        const key = masterCacheKey(type, status);
        const cachedStr = await env.SETTINGS.get(key);
        if (!cachedStr) return null;
        const cached = JSON.parse(cachedStr);
        if (!cached || typeof cached !== 'object') return null;
        const age = Date.now() - (cached.ts || 0);
        if (age > MASTER_CACHE_TTL_SECONDS * 1000) {
          return null;
        }
        if (!Array.isArray(cached.items)) {
          return null;
        }
        return cached.items;
      } catch (err) {
        console.warn('failed to read master cache', err);
        return null;
      }
    }

    async function setMasterCache(env, type, status, items) {
      try {
        const key = masterCacheKey(type, status);
        await env.SETTINGS.put(key, JSON.stringify({ ts: Date.now(), items }), {
          expirationTtl: MASTER_CACHE_TTL_SECONDS,
        });
      } catch (err) {
        console.warn('failed to write master cache', err);
      }
    }

    async function invalidateMasterCache(env, type) {
      const prefix = type ? `${MASTER_CACHE_PREFIX}${type}:` : MASTER_CACHE_PREFIX;
      const list = await env.SETTINGS.list({ prefix });
      await Promise.all(list.keys.map(k => env.SETTINGS.delete(k.name).catch(() => {})));
    }

    async function getAccountById(env, accountId) {
      const key = resolveAccountStorageKey(accountId);
      if (!key) return null;
      const account = await kvGetJSON(env, key);
      if (account) {
        ensureAccountId(account, accountId);
      }
      return account;
    }

    async function findAccountByIdentifier(env, identifier) {
      const normalized = normalizeIdentifier(identifier);
      if (!normalized) return null;
      const candidates = [];
      if (normalized.includes('@')) {
        candidates.push(accountEmailKey(normalized));
      }
      candidates.push(accountLoginKey(normalized));
      for (const key of candidates) {
        const pointer = await env.SETTINGS.get(key);
        if (!pointer) continue;
        const account = await getAccountById(env, pointer);
        if (account) {
          ensureAccountId(account, pointer);
          return { account, pointer };
        }
      }
      return null;
    }

    function normalizeMembershipIds(account) {
      if (!account) return [];
      if (Array.isArray(account.membershipIds)) {
        return account.membershipIds.filter(id => typeof id === 'string' && id);
      }
      if (Array.isArray(account.memberships)) {
        return account.memberships
          .map(entry => (typeof entry === 'string' ? entry : entry?.id))
          .filter(id => typeof id === 'string' && id);
      }
      return [];
    }

    async function verifyAccountPasswordValue(account, password) {
      if (!account || typeof password !== 'string' || !password) return false;
      const stored = account.passwordHash || account.password;
      if (!stored) return false;
      if (typeof stored === 'object') {
        try {
          return await verifyPassword(password, stored);
        } catch (err) {
          console.warn('password verification failed', err);
          return false;
        }
      }
      // Legacy string hashes are not supported; always fail closed.
      return false;
    }

    function publicAccountView(account, options = {}) {
      if (!account) return null;
      ensureAccountId(account);
      const membershipIds = normalizeMembershipIds(account);
      let membershipDetails = [];
      if (Array.isArray(options.memberships)) {
        membershipDetails = options.memberships
          .map((entry) => sanitizeMembershipRecord(entry))
          .filter(Boolean);
      } else if (Array.isArray(account.memberships)) {
        membershipDetails = account.memberships
          .map((entry) => sanitizeMembershipRecord(entry))
          .filter(Boolean);
      }
      if (membershipDetails.length) {
        const deduped = [];
        const seen = new Set();
        for (const item of membershipDetails) {
          if (!item || !item.id || seen.has(item.id)) continue;
          seen.add(item.id);
          deduped.push(item);
        }
        membershipDetails = deduped;
      }
      const result = {
        id: account.id || null,
        role: nk(account.role) || 'clinicStaff',
        status: nk(account.status) || 'active',
        primaryEmail: account.primaryEmail ? nk(account.primaryEmail) : null,
        profile: account.profile && typeof account.profile === 'object' ? account.profile : {},
        membershipIds,
      };
      const securityQuestion = publicSecurityQuestionView(account.securityQuestion);
      result.hasSecurityQuestion = Boolean(securityQuestion);
      if (securityQuestion) {
        result.securityQuestion = securityQuestion;
      }
      if (membershipDetails.length) {
        result.memberships = membershipDetails;
      }
      return result;
    }

    async function writeSessionMeta(env, sessionId, data, ttlSeconds) {
      if (!sessionId) return;
      const key = sessionMetaKey(sessionId);
      const options = ttlSeconds ? { expirationTtl: ttlSeconds } : undefined;
      await kvPutJSONWithOptions(env, key, data, options);
    }

    async function deleteSessionMeta(env, sessionId) {
      if (!sessionId) return;
      await env.SETTINGS.delete(sessionMetaKey(sessionId)).catch(() => {});
    }

    const DEFAULT_TODOS = [
      {
        category: "フロントエンド",
        title: "フォームバリデーション実装",
        status: "open",
        priority: "P1",
        createdAt: "2025-01-01T09:00:00+09:00",
      },
      {
        category: "サーバー",
        title: "Let’s Encrypt 自動更新",
        status: "done",
        priority: "P2",
        createdAt: "2025-01-05T09:00:00+09:00",
      },
    ];

    // ============================================================
    // <<< START: ROUTE_MATCH >>>
    // ============================================================
    // /api/... と /api/v1/... を同一処理へマッピング
    function routeMatch(url, method, pathNoVer) {
      if (request.method !== method) return false;
      return (
        url.pathname === `/api/${pathNoVer}` ||
        url.pathname === `/api/v1/${pathNoVer}`
      );
    }
    // <<< END: ROUTE_MATCH >>>

    if (routeMatch(url, 'POST', 'auth/registerFacilityAdmin')) {
      const authContext = await authenticateRequest(request, env);
      if (!authContext) {
        return jsonResponse({ error: 'UNAUTHORIZED', message: '認証が必要です。' }, 401);
      }
      if (!hasRole(authContext.payload, ['systemAdmin'])) {
        return jsonResponse({ error: 'FORBIDDEN', message: 'システム管理者のみが操作できます。' }, 403);
      }
      let body;
      try {
        body = await request.json();
      } catch (err) {
        return jsonResponse({ error: 'INVALID_JSON', message: 'リクエスト形式が不正です。' }, 400);
      }
      const clinicId = nk(body?.clinicId);
      const emailRaw = body?.email;
      const displayName = nk(body?.displayName || body?.name);
      if (!clinicId) {
        return jsonResponse({ error: 'INVALID_REQUEST', message: 'clinicId が必要です。' }, 400);
      }
      const clinic = await getClinicById(env, clinicId);
      if (!clinic) {
        return jsonResponse({ error: 'NOT_FOUND', message: '該当する施設が見つかりません。' }, 404);
      }
      const email = normalizeEmail(emailRaw);
      if (!email || !EMAIL_REGEX.test(email)) {
        return jsonResponse({ error: 'INVALID_EMAIL', message: 'メールアドレスの形式が正しくありません。' }, 400);
      }

      const existingAccount = await findAccountByIdentifier(env, email);
      if (existingAccount && (nk(existingAccount.account.role) || 'clinicStaff') === 'clinicAdmin') {
        return jsonResponse({ error: 'ALREADY_REGISTERED', message: 'このメールアドレスは既に管理者として登録されています。' }, 409);
      }

      const now = Date.now();
      const activePending = cleanClinicPendingInvites(clinic, now);
      const duplicateInvite = activePending.find((item) => normalizeEmail(item.email) === email);
      if (duplicateInvite) {
        const invitedAtMs = Date.parse(duplicateInvite.invitedAt || '') || now;
        if (now - invitedAtMs < INVITE_RESEND_COOLDOWN_SECONDS * 1000) {
          return jsonResponse({
            error: 'INVITE_PENDING',
            message: '同じメールアドレス宛の招待が進行中です。しばらく時間をおいて再度お試しください。',
          }, 409);
        }
      }

      const metadata = { kind: 'clinicAdmin' };
      if (displayName) metadata.displayName = displayName;
      const invitedBy = ensureAccountId(authContext.account);
      const { invite, token } = await createInviteRecord(env, {
        clinicId,
        email,
        role: 'clinicAdmin',
        invitedBy,
        metadata,
      });

      const pendingInvites = cleanClinicPendingInvites(clinic, now).filter((item) => item.id !== invite.id);
      pendingInvites.push({
        id: invite.id,
        email: invite.email,
        role: invite.role,
        status: invite.status,
        invitedAt: invite.invitedAt,
        expiresAt: invite.expiresAt,
        invitedBy,
        metadata,
      });
      clinic.pendingInvites = pendingInvites;
      await saveClinic(env, clinic);

      const mailResult = await sendInviteEmail(env, { clinic, invite, token });

      return jsonResponse({
        ok: true,
        invite: {
          id: invite.id,
          clinicId: invite.clinicId,
          email: invite.email,
          role: invite.role,
          invitedAt: invite.invitedAt,
          expiresAt: invite.expiresAt,
          invitedBy,
          metadata,
        },
        token,
        mailStatus: mailResult?.ok ? 'sent' : 'failed',
        mailProvider: mailResult?.provider || 'log',
        ...(mailResult?.error ? { mailError: mailResult.error } : {}),
      });
    }

    if (routeMatch(url, 'POST', 'auth/inviteStaff')) {
      const authContext = await authenticateRequest(request, env);
      if (!authContext) {
        return jsonResponse({ error: 'UNAUTHORIZED', message: '認証が必要です。' }, 401);
      }
      const isSystemAdmin = hasRole(authContext.payload, ['systemAdmin']);
      const isClinicAdmin = hasRole(authContext.payload, ['clinicAdmin']);
      if (!isSystemAdmin && !isClinicAdmin) {
        return jsonResponse({ error: 'FORBIDDEN', message: '権限が不足しています。' }, 403);
      }
      let body;
      try {
        body = await request.json();
      } catch (err) {
        return jsonResponse({ error: 'INVALID_JSON', message: 'リクエスト形式が不正です。' }, 400);
      }
      const clinicId = nk(body?.clinicId);
      const emailRaw = body?.email;
      const displayName = nk(body?.displayName || body?.name);
      if (!clinicId) {
        return jsonResponse({ error: 'INVALID_REQUEST', message: 'clinicId が必要です。' }, 400);
      }
      const clinic = await getClinicById(env, clinicId);
      if (!clinic) {
        return jsonResponse({ error: 'NOT_FOUND', message: '該当する施設が見つかりません。' }, 404);
      }
      if (isClinicAdmin && !isSystemAdmin) {
        const managers = new Set(Array.isArray(clinic.managerAccounts) ? clinic.managerAccounts : []);
        if (!managers.has(ensureAccountId(authContext.account))) {
          return jsonResponse({ error: 'FORBIDDEN', message: '指定した施設の管理権限がありません。' }, 403);
        }
      }
      const email = normalizeEmail(emailRaw);
      if (!email || !EMAIL_REGEX.test(email)) {
        return jsonResponse({ error: 'INVALID_EMAIL', message: 'メールアドレスの形式が正しくありません。' }, 400);
      }

      const inviteRole = (() => {
        const candidate = normalizeRole(body?.role, 'clinicStaff');
        if (candidate === 'systemAdmin') return 'clinicStaff';
        if (candidate === 'clinicAdmin' && !isSystemAdmin) {
          // clinicAdmin から別の管理者を招待する場合は registerFacilityAdmin を利用
          return 'clinicStaff';
        }
        return candidate || 'clinicStaff';
      })();

      const existingAccount = await findAccountByIdentifier(env, email);
      if (existingAccount) {
        return jsonResponse({ error: 'ALREADY_REGISTERED', message: 'このメールアドレスは既に登録済みです。' }, 409);
      }

      const now = Date.now();
      const activePending = cleanClinicPendingInvites(clinic, now);
      const duplicateInvite = activePending.find((item) => normalizeEmail(item.email) === email);
      if (duplicateInvite) {
        const invitedAtMs = Date.parse(duplicateInvite.invitedAt || '') || now;
        if (now - invitedAtMs < INVITE_RESEND_COOLDOWN_SECONDS * 1000) {
          return jsonResponse({
            error: 'INVITE_PENDING',
            message: '同じメールアドレス宛の招待が進行中です。しばらく時間をおいて再度お試しください。',
          }, 409);
        }
      }

      const metadata = { kind: 'clinicStaff' };
      if (displayName) metadata.displayName = displayName;
      const invitedBy = ensureAccountId(authContext.account);
      const { invite, token } = await createInviteRecord(env, {
        clinicId,
        email,
        role: inviteRole,
        invitedBy,
        metadata,
      });

      const pendingInvites = cleanClinicPendingInvites(clinic, now).filter((item) => item.id !== invite.id);
      pendingInvites.push({
        id: invite.id,
        email: invite.email,
        role: invite.role,
        status: invite.status,
        invitedAt: invite.invitedAt,
        expiresAt: invite.expiresAt,
        invitedBy,
        metadata,
      });
      clinic.pendingInvites = pendingInvites;
      await saveClinic(env, clinic);

      const mailResult = await sendInviteEmail(env, { clinic, invite, token });

      return jsonResponse({
        ok: true,
        invite: {
          id: invite.id,
          clinicId: invite.clinicId,
          email: invite.email,
          role: invite.role,
          invitedAt: invite.invitedAt,
          expiresAt: invite.expiresAt,
          invitedBy,
          metadata,
        },
        token,
        mailStatus: mailResult?.ok ? 'sent' : 'failed',
        mailProvider: mailResult?.provider || 'log',
        ...(mailResult?.error ? { mailError: mailResult.error } : {}),
      });
    }

    if (routeMatch(url, 'POST', 'auth/acceptInvite')) {
      let body;
      try {
        body = await request.json();
      } catch (err) {
        return jsonResponse({ error: 'INVALID_JSON', message: 'リクエスト形式が不正です。' }, 400);
      }
      const token = nk(body?.token);
      const password = body?.password;
      const passwordConfirm = body?.passwordConfirm ?? body?.confirmPassword;
      const displayName = nk(body?.displayName || body?.name);
      const profileInput = normalizeProfileInput(body?.profile || {}, displayName);

      if (!token) {
        return jsonResponse({ error: 'INVALID_REQUEST', message: '招待トークンが必要です。' }, 400);
      }
      if (typeof password !== 'string' || password.length < 8) {
        return jsonResponse({ error: 'INVALID_PASSWORD', message: 'パスワードは8文字以上で入力してください。' }, 400);
      }
      if (passwordConfirm !== undefined && passwordConfirm !== password) {
        return jsonResponse({ error: 'PASSWORD_MISMATCH', message: 'パスワード（確認）が一致しません。' }, 400);
      }

      const inviteLookup = await getInviteByToken(env, token);
      if (!inviteLookup) {
        return jsonResponse({ error: 'INVITE_INVALID', message: '招待が見つかりません。' }, 400);
      }
      const { invite, tokenHash } = inviteLookup;
      if (!invite || invite.status !== 'pending') {
        return jsonResponse({ error: 'INVITE_INVALID', message: '有効な招待ではありません。' }, 400);
      }
      const now = Date.now();
      const expiresAtMs = invite.expiresAt ? Date.parse(invite.expiresAt) : NaN;
      if (Number.isFinite(expiresAtMs) && expiresAtMs <= now) {
        await updateInviteStatus(env, invite.id, 'expired', { expiredAt: new Date().toISOString() });
        await removeInviteLookup(env, tokenHash);
        return jsonResponse({ error: 'INVITE_EXPIRED', message: '招待の有効期限が切れています。' }, 400);
      }

      const clinicId = nk(invite.clinicId);
      const email = normalizeEmail(invite.email);
      if (!clinicId || !email) {
        return jsonResponse({ error: 'INVITE_INVALID', message: '招待情報が不完全です。' }, 400);
      }
      const clinic = await getClinicById(env, clinicId);
      if (!clinic) {
        return jsonResponse({ error: 'NOT_FOUND', message: '該当する施設が見つかりません。' }, 404);
      }

      const existingAccount = await findAccountByIdentifier(env, email);
      if (existingAccount) {
        return jsonResponse({ error: 'ALREADY_REGISTERED', message: 'このメールアドレスは既に登録済みです。' }, 409);
      }

      const role = normalizeRole(invite.role || 'clinicStaff', 'clinicStaff');
      const profile = {
        ...profileInput,
        displayName: profileInput.displayName || invite.metadata?.displayName || '',
      };

      const { account, accountKey } = await createAccountRecord(env, {
        email,
        password,
        role,
        profile,
        invitedBy: invite.invitedBy || null,
      });

      const membershipRoles = [role];
      const membership = await createMembershipRecord(env, {
        clinicId,
        clinicName: clinic.name || clinic.displayName || '',
        accountId: account.id,
        roles: membershipRoles,
        invitedBy: invite.invitedBy || null,
        organizationId: clinic.organizationId || null,
        organizationName: clinic.organizationName || clinic.organization?.name || null,
      });

      const membershipSet = new Set(Array.isArray(account.membershipIds) ? account.membershipIds : []);
      membershipSet.add(membership.id);
      account.membershipIds = Array.from(membershipSet);
      await saveAccountRecord(env, account);

      const staffMemberships = new Set(Array.isArray(clinic.staffMemberships) ? clinic.staffMemberships : []);
      staffMemberships.add(membership.id);
      clinic.staffMemberships = Array.from(staffMemberships);

      if (role === 'clinicAdmin') {
        const managers = new Set(Array.isArray(clinic.managerAccounts) ? clinic.managerAccounts : []);
        managers.add(account.id);
        clinic.managerAccounts = Array.from(managers);
      }

      clinic.pendingInvites = cleanClinicPendingInvites(clinic, now).filter((item) => item.id !== invite.id);
      await saveClinic(env, clinic);

      await updateInviteStatus(env, invite.id, 'accepted', {
        acceptedAt: new Date().toISOString(),
        accountId: account.id,
        membershipId: membership.id,
      });
      await removeInviteLookup(env, tokenHash);

      const { membershipIds, memberships } = await resolveAccountMemberships(env, account);
      account.memberships = memberships;

      const sessionId = generateSessionId();
      const accessTokenData = await createToken(
        { sub: account.id, role, membershipIds, memberships, tokenType: 'access' },
        { env, sessionId, ttlSeconds: ACCESS_TOKEN_TTL_SECONDS },
      );
      const refreshTokenData = await createToken(
        { sub: account.id, role, membershipIds, memberships, tokenType: 'refresh', remember: false },
        { env, sessionId, ttlSeconds: REFRESH_TOKEN_TTL_SECONDS },
      );
      await writeSessionMeta(env, sessionId, {
        accountId: account.id,
        role,
        membershipIds,
        memberships,
        remember: false,
        createdAt: new Date(accessTokenData.issuedAt * 1000).toISOString(),
        refreshExpiresAt: new Date(refreshTokenData.expiresAt * 1000).toISOString(),
      }, REFRESH_TOKEN_TTL_SECONDS + 3600);

      const membershipSanitized = sanitizeMembershipRecord(membership) || membership;

      return jsonResponse({
        ok: true,
        account: publicAccountView(account, { memberships }),
        membership: membershipSanitized,
        memberships,
        tokens: {
          accessToken: accessTokenData.token,
          accessTokenExpiresAt: new Date(accessTokenData.expiresAt * 1000).toISOString(),
          refreshToken: refreshTokenData.token,
          refreshTokenExpiresAt: new Date(refreshTokenData.expiresAt * 1000).toISOString(),
          sessionId,
        },
      });
    }

    if (routeMatch(url, 'POST', 'auth/requestPasswordReset')) {
      let body;
      try {
        body = await request.json();
      } catch (err) {
        return jsonResponse({ error: 'INVALID_JSON', message: 'リクエスト形式が不正です。' }, 400);
      }
      const email = normalizeEmail(body?.email);
      if (!email || !EMAIL_REGEX.test(email)) {
        // 無効な形式でも成功レスポンスを返し、情報漏えいを防ぐ
        return jsonResponse({ ok: true });
      }

      const lookup = await findAccountByIdentifier(env, email);
      if (!lookup || !lookup.account) {
        return jsonResponse({ ok: true });
      }
      const account = lookup.account;
      const accountId = ensureAccountId(account, lookup.pointer);
      if ((nk(account.status) || 'active') !== 'active') {
        return jsonResponse({ ok: true });
      }

      const token = generateInviteToken();
      const { record } = await storeResetToken(env, {
        token,
        accountId,
        requestedBy: accountId,
      });
      const mailResult = await sendPasswordResetEmail(env, { account, token });
      const returnToken = envFlag(env?.RETURN_RESET_TOKEN);

      return jsonResponse({
        ok: true,
        resetId: record.id,
        mailStatus: mailResult?.ok ? 'sent' : 'failed',
        mailProvider: mailResult?.provider || 'log',
        ...(mailResult?.error ? { mailError: mailResult.error } : {}),
        ...(returnToken ? { token } : {}),
      });
    }

    if (routeMatch(url, 'POST', 'auth/resetPassword')) {
      let body;
      try {
        body = await request.json();
      } catch (err) {
        return jsonResponse({ error: 'INVALID_JSON', message: 'リクエスト形式が不正です。' }, 400);
      }
      const token = nk(body?.token);
      const password = body?.password;
      const passwordConfirm = body?.passwordConfirm ?? body?.confirmPassword;
      if (!token) {
        return jsonResponse({ error: 'INVALID_REQUEST', message: 'トークンが必要です。' }, 400);
      }
      if (!validatePasswordStrength(password)) {
        return jsonResponse({ error: 'INVALID_PASSWORD', message: `パスワードは${MIN_PASSWORD_LENGTH}文字以上で入力してください。` }, 400);
      }
      if (passwordConfirm !== undefined && password !== passwordConfirm) {
        return jsonResponse({ error: 'PASSWORD_MISMATCH', message: 'パスワード（確認）が一致しません。' }, 400);
      }

      const lookup = await getResetRecordByToken(env, token);
      if (!lookup || !lookup.record) {
        return jsonResponse({ error: 'RESET_INVALID', message: '有効なトークンではありません。' }, 400);
      }
      const { record, tokenHash } = lookup;
      if (record.status !== 'pending') {
        return jsonResponse({ error: 'RESET_INVALID', message: 'このトークンは使用済みです。' }, 400);
      }
      const now = Date.now();
      const expiresAtMs = record.expiresAt ? Date.parse(record.expiresAt) : NaN;
      if (Number.isFinite(expiresAtMs) && expiresAtMs <= now) {
        await updateResetRecord(env, record.id, { status: 'expired', expiredAt: new Date().toISOString() });
        await env.SETTINGS.delete(resetLookupKey(tokenHash)).catch(() => {});
        return jsonResponse({ error: 'RESET_EXPIRED', message: 'トークンの有効期限が切れています。' }, 400);
      }

      const account = await getAccountById(env, record.accountId);
      if (!account) {
        await updateResetRecord(env, record.id, { status: 'invalid', invalidatedAt: new Date().toISOString() });
        await env.SETTINGS.delete(resetLookupKey(tokenHash)).catch(() => {});
        return jsonResponse({ error: 'RESET_INVALID', message: 'アカウントが見つかりません。' }, 404);
      }

      account.passwordHash = await hashPassword(password);
      await saveAccountRecord(env, account);
      await updateResetRecord(env, record.id, { status: 'completed', completedAt: new Date().toISOString() });
      await env.SETTINGS.delete(resetLookupKey(tokenHash)).catch(() => {});

      return jsonResponse({ ok: true });
    }

    if (routeMatch(url, 'POST', 'auth/requestAdminAccess')) {
      let body;
      try {
        body = await request.json();
      } catch (err) {
        return jsonResponse({ error: 'INVALID_JSON', message: 'リクエスト形式が不正です。' }, 400);
      }

      const email = normalizeEmail(body?.email);
      if (!email || !EMAIL_REGEX.test(email)) {
        return jsonResponse({ error: 'INVALID_EMAIL', message: 'メールアドレスの形式が正しくありません。' }, 400);
      }
      const displayName = nk(body?.displayName || body?.name);
      const clinicIdInput = nk(body?.clinicId);
      const clinicNameInput = nk(body?.clinicName);
      const notes = nk(body?.notes);
      if (!clinicIdInput && !clinicNameInput) {
        return jsonResponse({ error: 'INVALID_REQUEST', message: '対象施設を指定してください。' }, 400);
      }

      const emailLower = email;
      const pendingEmailKey = adminRequestEmailKey(emailLower);
      let existingPendingId = await env.SETTINGS.get(pendingEmailKey);
      if (existingPendingId) {
        const existingPending = await getAdminRequestById(env, existingPendingId);
        if (existingPending && (existingPending.status || '').toLowerCase() === 'pending') {
          return jsonResponse({ error: 'REQUEST_PENDING', message: '同じメールアドレスによる申請が処理中です。結果をお待ちください。' }, 409);
        }
        await env.SETTINGS.delete(pendingEmailKey).catch(() => {});
        existingPendingId = null;
      }

      let clinic = null;
      let clinicId = null;
      let clinicName = clinicNameInput;
      if (clinicIdInput) {
        clinic = await getClinicById(env, clinicIdInput);
        if (!clinic) {
          return jsonResponse({ error: 'NOT_FOUND', message: '指定された施設が見つかりません。' }, 404);
        }
        clinicId = clinic.id;
        clinicName = clinic.name || clinicName;
      } else if (clinicNameInput) {
        const clinicByName = await getClinicByName(env, clinicNameInput);
        if (clinicByName?.id) {
          clinic = clinicByName;
          clinicId = clinicByName.id;
          clinicName = clinicByName.name || clinicNameInput;
        }
      }

      const accountLookup = await findAccountByIdentifier(env, email);
      let accountId = null;
      if (accountLookup?.account) {
        accountId = ensureAccountId(accountLookup.account, accountLookup.pointer);
      }

      const id = crypto.randomUUID();
      const nowIso = new Date().toISOString();
      const requestRecord = {
        id,
        status: 'pending',
        email,
        emailLower,
        displayName: displayName || '',
        clinicId: clinicId || null,
        clinicName: clinicName || '',
        notes,
        accountId,
        requestedAt: nowIso,
        updatedAt: nowIso,
        metadata: {
          submittedFrom: nk(request.headers.get('cf-connecting-ip')) || null,
          userAgent: nk(request.headers.get('user-agent')) || null,
        },
      };

      await createAdminRequestRecord(env, requestRecord);
      await setPendingAdminRequestEmail(env, emailLower, id);

      await sendAdminRequestReceivedEmail(env, { request: requestRecord, clinicName: requestRecord.clinicName });
      await sendAdminRequestNotifyEmail(env, { request: requestRecord, clinicName: requestRecord.clinicName });

      return jsonResponse({ ok: true, request: sanitizeAdminRequest(requestRecord) });
    }

    if (routeMatch(url, 'GET', 'auth/securityQuestions')) {
      return jsonResponse({
        ok: true,
        questions: SECURITY_QUESTIONS,
      });
    }

    if (routeMatch(url, 'POST', 'auth/securityQuestion')) {
      const authContext = await authenticateRequest(request, env);
      if (!authContext) {
        return jsonResponse({ error: 'UNAUTHORIZED', message: '認証が必要です。' }, 401);
      }
      let body;
      try {
        body = await request.json();
      } catch (err) {
        return jsonResponse({ error: 'INVALID_JSON', message: 'リクエスト形式が不正です。' }, 400);
      }
      const questionId = nk(body?.questionId || body?.id);
      const answerFormat = nk(body?.answerFormat);
      const answer = body?.answer;
      try {
        const summary = await setAccountSecurityQuestion(env, authContext.account, {
          questionId,
          answer,
          answerFormat,
        });
        return jsonResponse({ ok: true, securityQuestion: summary, account: publicAccountView(authContext.account) });
      } catch (err) {
        if (err?.code === 'INVALID_SECURITY_QUESTION') {
          return jsonResponse({ error: 'INVALID_SECURITY_QUESTION', message: '選択した質問が無効です。' }, 400);
        }
        if (err?.code === 'INVALID_SECURITY_ANSWER') {
          return jsonResponse({ error: 'INVALID_SECURITY_ANSWER', message: '回答は指定の文字種で入力してください。' }, 400);
        }
        console.error('failed to set security question', err);
        return jsonResponse({ error: 'SERVER_ERROR', message: '秘密の質問を登録できませんでした。' }, 500);
      }
    }

    if (routeMatch(url, 'POST', 'auth/securityQuestion/verify')) {
      let body;
      try {
        body = await request.json();
      } catch (err) {
        return jsonResponse({ error: 'INVALID_JSON', message: 'リクエスト形式が不正です。' }, 400);
      }
      let account = null;
      const authContext = await authenticateRequest(request, env);
      if (authContext) {
        account = authContext.account;
      }
      const identifier = nk(body?.identifier || body?.email || body?.loginId);
      if (!account && identifier) {
        const lookup = await findAccountByIdentifier(env, identifier);
        if (lookup?.account) {
          account = lookup.account;
        }
      }
      if (!account) {
        return jsonResponse({ error: 'ACCOUNT_NOT_FOUND', message: '対象アカウントが見つかりません。' }, 404);
      }
      if (!account.securityQuestion) {
        return jsonResponse({ error: 'SECURITY_QUESTION_NOT_SET', message: '秘密の質問が未登録です。' }, 400);
      }
      const questionId = nk(body?.questionId || body?.id);
      if (questionId && account.securityQuestion.questionId !== questionId) {
        return jsonResponse({ error: 'SECURITY_QUESTION_MISMATCH', message: '秘密の質問が一致しません。' }, 400);
      }
      const answer = body?.answer;
      const verified = await verifyAccountSecurityAnswer(account, answer);
      if (!verified) {
        return jsonResponse({ error: 'INVALID_SECURITY_ANSWER', message: '回答が一致しません。' }, 403);
      }
      return jsonResponse({ ok: true, securityQuestion: publicSecurityQuestionView(account.securityQuestion) });
    }

    if (routeMatch(url, 'POST', 'auth/login')) {
      let body;
      try {
        body = await request.json();
      } catch (err) {
        return new Response(JSON.stringify({ error: 'INVALID_JSON', message: 'リクエスト形式が不正です。' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const identifierRaw = body?.identifier ?? body?.loginId ?? body?.email;
      const password = typeof body?.password === 'string' ? body.password : '';
      if (!identifierRaw || !password) {
        return new Response(JSON.stringify({ error: 'INVALID_CREDENTIALS', message: 'ID またはパスワードが不足しています。' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const lookup = await findAccountByIdentifier(env, identifierRaw);
      if (!lookup || !(await verifyAccountPasswordValue(lookup.account, password))) {
        await new Promise((resolve) => setTimeout(resolve, 100)); // mitigate timing attacks
        return new Response(JSON.stringify({ error: 'AUTH_FAILED', message: 'ID またはパスワードが正しくありません。' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const account = lookup.account;
      const accountId = ensureAccountId(account, lookup.pointer);
      const status = nk(account.status) || 'active';
      if (status !== 'active') {
        return new Response(JSON.stringify({ error: 'ACCOUNT_INACTIVE', message: 'アカウントが無効化されています。' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const role = nk(account.role) || 'clinicStaff';
      const { membershipIds, memberships } = await resolveAccountMemberships(env, account);
      account.memberships = memberships;
      const remember = Boolean(body?.remember);
      const sessionId = generateSessionId();
      const sessionStore = getSessionStore(env);
      let accessTokenData;
      let refreshTokenData;
      try {
        accessTokenData = await createToken(
          { sub: accountId, role, membershipIds, memberships, tokenType: 'access' },
          { env, sessionId, ttlSeconds: ACCESS_TOKEN_TTL_SECONDS },
        );
        const refreshTtl = remember ? REFRESH_TOKEN_TTL_REMEMBER_SECONDS : REFRESH_TOKEN_TTL_SECONDS;
        refreshTokenData = await createToken(
          { sub: accountId, role, membershipIds, memberships, tokenType: 'refresh', remember },
          { env, sessionId, ttlSeconds: refreshTtl },
        );
      } catch (err) {
        console.error('failed to create JWT', err);
        return new Response(JSON.stringify({ error: 'SERVER_ERROR', message: 'トークンを発行できませんでした。' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const refreshTtlSeconds = Math.max(
        (refreshTokenData.expiresAt || 0) - (refreshTokenData.issuedAt || 0),
        remember ? REFRESH_TOKEN_TTL_REMEMBER_SECONDS : REFRESH_TOKEN_TTL_SECONDS,
      );
      await writeSessionMeta(env, sessionId, {
        accountId,
        role,
        membershipIds,
        memberships,
        remember,
        createdAt: new Date(accessTokenData.issuedAt * 1000).toISOString(),
        refreshExpiresAt: new Date(refreshTokenData.expiresAt * 1000).toISOString(),
      }, refreshTtlSeconds + 3600);

      const responsePayload = {
        ok: true,
        account: publicAccountView(account, { memberships }),
        tokens: {
          accessToken: accessTokenData.token,
          accessTokenExpiresAt: new Date(accessTokenData.expiresAt * 1000).toISOString(),
          refreshToken: refreshTokenData.token,
          refreshTokenExpiresAt: new Date(refreshTokenData.expiresAt * 1000).toISOString(),
          sessionId,
        },
      };
      return new Response(JSON.stringify(responsePayload), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (routeMatch(url, 'POST', 'auth/logout')) {
      let body = {};
      try {
        body = await request.json();
      } catch (err) {
        body = {};
      }
      const refreshToken = typeof body.refreshToken === 'string' ? body.refreshToken.trim() : '';
      let sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
      let decodedPayload = null;
      if (refreshToken) {
        try {
          ({ payload: decodedPayload } = await verifyToken(refreshToken, {
            env,
            allowExpired: true,
            sessionStore: getSessionStore(env),
          }));
          sessionId = sessionId || decodedPayload?.sessionId || '';
        } catch (err) {
          // ignore verification errors to keep logout idempotent
        }
      }
      if (sessionId) {
        await invalidateSession(sessionId, { env, sessionStore: getSessionStore(env) }).catch(() => {});
        await deleteSessionMeta(env, sessionId);
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (routeMatch(url, 'POST', 'auth/refresh')) {
      let body;
      try {
        body = await request.json();
      } catch (err) {
        return new Response(JSON.stringify({ error: 'INVALID_JSON', message: 'リクエスト形式が不正です。' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const refreshToken = typeof body?.refreshToken === 'string' ? body.refreshToken.trim() : '';
      if (!refreshToken) {
        return new Response(JSON.stringify({ error: 'INVALID_REQUEST', message: 'refreshToken が必要です。' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      let payload;
      try {
        ({ payload } = await verifyToken(refreshToken, {
          env,
          sessionStore: getSessionStore(env),
        }));
      } catch (err) {
        return new Response(JSON.stringify({ error: 'AUTH_FAILED', message: 'トークンを再発行できません。' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (payload.tokenType !== 'refresh') {
        return new Response(JSON.stringify({ error: 'INVALID_TOKEN', message: 'refreshToken が不正です。' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const account = await getAccountById(env, payload.sub);
      if (!account || (nk(account.status) || 'active') !== 'active') {
        await invalidateSession(payload.sessionId, { env, sessionStore: getSessionStore(env) }).catch(() => {});
        await deleteSessionMeta(env, payload.sessionId);
        return new Response(JSON.stringify({ error: 'ACCOUNT_INACTIVE', message: 'アカウントが無効化されています。' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const accountId = ensureAccountId(account, payload.sub);
      const role = nk(account.role) || payload.role || 'clinicStaff';
      const { membershipIds, memberships } = await resolveAccountMemberships(env, account);
      account.memberships = memberships;
      const remember = Boolean(payload.remember);
      const newSessionId = generateSessionId();
      let accessTokenData;
      let refreshTokenData;
      try {
        accessTokenData = await createToken(
          { sub: accountId, role, membershipIds, memberships, tokenType: 'access' },
          { env, sessionId: newSessionId, ttlSeconds: ACCESS_TOKEN_TTL_SECONDS },
        );
        const refreshTtl = remember ? REFRESH_TOKEN_TTL_REMEMBER_SECONDS : REFRESH_TOKEN_TTL_SECONDS;
        refreshTokenData = await createToken(
          { sub: accountId, role, membershipIds, memberships, tokenType: 'refresh', remember },
          { env, sessionId: newSessionId, ttlSeconds: refreshTtl },
        );
      } catch (err) {
        console.error('failed to create JWT', err);
        return new Response(JSON.stringify({ error: 'SERVER_ERROR', message: 'トークンを発行できませんでした。' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const refreshTtlSeconds = Math.max(
        (refreshTokenData.expiresAt || 0) - (refreshTokenData.issuedAt || 0),
        remember ? REFRESH_TOKEN_TTL_REMEMBER_SECONDS : REFRESH_TOKEN_TTL_SECONDS,
      );
      await writeSessionMeta(env, newSessionId, {
        accountId,
        role,
        membershipIds,
        memberships,
        remember,
        createdAt: new Date(accessTokenData.issuedAt * 1000).toISOString(),
        refreshExpiresAt: new Date(refreshTokenData.expiresAt * 1000).toISOString(),
      }, refreshTtlSeconds + 3600);
      await invalidateSession(payload.sessionId, { env, sessionStore: getSessionStore(env) }).catch(() => {});
      await deleteSessionMeta(env, payload.sessionId);

      return new Response(JSON.stringify({
        ok: true,
        account: publicAccountView(account, { memberships }),
        tokens: {
          accessToken: accessTokenData.token,
          accessTokenExpiresAt: new Date(accessTokenData.expiresAt * 1000).toISOString(),
          refreshToken: refreshTokenData.token,
          refreshTokenExpiresAt: new Date(refreshTokenData.expiresAt * 1000).toISOString(),
          sessionId: newSessionId,
        },
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (routeMatch(url, 'GET', 'admin/accessRequests')) {
      const authContext = await authenticateRequest(request, env);
      if (!authContext) {
        return jsonResponse({ error: 'UNAUTHORIZED', message: '認証が必要です。' }, 401);
      }
      if (!hasRole(authContext.payload, SYSTEM_ROOT_ONLY)) {
        return jsonResponse({ error: 'FORBIDDEN', message: '権限が不足しています。' }, 403);
      }
      const statusParam = nk(url.searchParams.get('status'));
      const limitParam = nk(url.searchParams.get('limit'));
      const cursorParam = nk(url.searchParams.get('cursor')) || undefined;
      const limit = limitParam ? Math.max(1, Math.min(100, Number(limitParam) || ADMIN_REQUEST_DEFAULT_LIMIT)) : ADMIN_REQUEST_DEFAULT_LIMIT;

      const { requests, cursor: nextCursor } = await listAdminRequests(env, {
        status: statusParam,
        limit,
        cursor: cursorParam,
      });
      return jsonResponse({ ok: true, requests, cursor: nextCursor });
    }

    if (routeMatch(url, 'GET', 'admin/accessRequest')) {
      const authContext = await authenticateRequest(request, env);
      if (!authContext) {
        return jsonResponse({ error: 'UNAUTHORIZED', message: '認証が必要です。' }, 401);
      }
      if (!hasRole(authContext.payload, SYSTEM_ROOT_ONLY)) {
        return jsonResponse({ error: 'FORBIDDEN', message: '権限が不足しています。' }, 403);
      }
      const requestId = nk(url.searchParams.get('id'));
      if (!requestId) {
        return jsonResponse({ error: 'INVALID_REQUEST', message: 'id が必要です。' }, 400);
      }
      const adminRequest = await getAdminRequestById(env, requestId);
      if (!adminRequest) {
        return jsonResponse({ error: 'NOT_FOUND', message: '申請が見つかりません。' }, 404);
      }
      return jsonResponse({ ok: true, request: sanitizeAdminRequest(adminRequest) });
    }

    if (routeMatch(url, 'POST', 'admin/accessRequest/approve')) {
      const authContext = await authenticateRequest(request, env);
      if (!authContext) {
        return jsonResponse({ error: 'UNAUTHORIZED', message: '認証が必要です。' }, 401);
      }
      if (!hasRole(authContext.payload, SYSTEM_ROOT_ONLY)) {
        return jsonResponse({ error: 'FORBIDDEN', message: '権限が不足しています。' }, 403);
      }
      let body;
      try {
        body = await request.json();
      } catch (err) {
        return jsonResponse({ error: 'INVALID_JSON', message: 'リクエスト形式が不正です。' }, 400);
      }
      const requestId = nk(body?.requestId || body?.id);
      if (!requestId) {
        return jsonResponse({ error: 'INVALID_REQUEST', message: 'requestId が必要です。' }, 400);
      }
      let adminRequest = await getAdminRequestById(env, requestId);
      if (!adminRequest) {
        return jsonResponse({ error: 'NOT_FOUND', message: '申請が見つかりません。' }, 404);
      }
      if ((adminRequest.status || '').toLowerCase() !== 'pending') {
        return jsonResponse({ error: 'REQUEST_ALREADY_PROCESSED', message: 'この申請は処理済みです。' }, 409);
      }

      const clinicIdInput = nk(body?.clinicId) || adminRequest.clinicId || '';
      if (!clinicIdInput) {
        return jsonResponse({ error: 'INVALID_REQUEST', message: 'clinicId が必要です。' }, 400);
      }
      const clinic = await getClinicById(env, clinicIdInput);
      if (!clinic) {
        return jsonResponse({ error: 'NOT_FOUND', message: '指定された施設が見つかりません。' }, 404);
      }
      adminRequest.clinicId = clinic.id;
      adminRequest.clinicName = clinic.name || adminRequest.clinicName || '';

      const role = 'clinicAdmin';

      const email = adminRequest.email;
      const emailLower = adminRequest.emailLower || normalizeEmail(email);
      let account = null;
      if (adminRequest.accountId) {
        account = await getAccountById(env, adminRequest.accountId);
      }
      if (!account) {
        const lookup = await findAccountByIdentifier(env, email);
        if (lookup?.account) {
          account = lookup.account;
          adminRequest.accountId = ensureAccountId(account, lookup.pointer);
        }
      }

      const processedBy = ensureAccountId(authContext.account);
      const processedAtIso = new Date().toISOString();
      const clinicName = clinic.name || adminRequest.clinicName || '';
      const loginUrl = `${getAppBaseUrl(env)}/auth/login.html`;

      let membership = null;
      let invite = null;

      if (account) {
        const accountId = ensureAccountId(account, adminRequest.accountId);
        const membershipIds = normalizeMembershipIds(account);
        let existingMembership = null;
        for (const membershipId of membershipIds) {
          const record = await getMembershipById(env, membershipId);
          if (record?.clinicId === clinic.id) {
            existingMembership = record;
            break;
          }
        }
        if (existingMembership) {
          applyClinicContextToMembership(existingMembership, clinic);
          const roles = new Set(Array.isArray(existingMembership.roles) ? existingMembership.roles : []);
          if (!roles.has(role)) {
            roles.add(role);
            existingMembership.roles = Array.from(roles);
            if (!existingMembership.primaryRole) {
              existingMembership.primaryRole = role;
            }
            await kvPutJSON(env, existingMembership.id, existingMembership);
          }
          membership = existingMembership;
        } else {
          membership = await createMembershipRecord(env, {
            clinicId: clinic.id,
            clinicName: clinic.name || clinic.displayName || '',
            accountId,
            roles: [role],
            invitedBy: processedBy,
            organizationId: clinic.organizationId || null,
            organizationName: clinic.organizationName || clinic.organization?.name || null,
          });
        }

        const membershipSet = new Set(normalizeMembershipIds(account));
        membershipSet.add(membership.id);
        account.membershipIds = Array.from(membershipSet);
        await saveAccountRecord(env, account);

        const staffMemberships = new Set(Array.isArray(clinic.staffMemberships) ? clinic.staffMemberships : []);
        staffMemberships.add(membership.id);
        clinic.staffMemberships = Array.from(staffMemberships);
        if (role === 'clinicAdmin') {
          const managers = new Set(Array.isArray(clinic.managerAccounts) ? clinic.managerAccounts : []);
          managers.add(accountId);
          clinic.managerAccounts = Array.from(managers);
        }
        await saveClinic(env, clinic);

        await sendAdminRequestApprovedEmail(env, {
          request: adminRequest,
          clinicName,
          loginUrl,
        });
        adminRequest.approvedMembershipId = membership.id;
      } else {
        const now = Date.now();
        const invitedBy = processedBy;
        const metadata = {
          kind: role === 'clinicAdmin' ? 'clinicAdmin' : 'clinicStaff',
          source: 'adminRequest',
          requestId: adminRequest.id,
        };
        if (adminRequest.displayName) metadata.displayName = adminRequest.displayName;
        const { invite: newInvite, token } = await createInviteRecord(env, {
          clinicId: clinic.id,
          email,
          role,
          invitedBy,
          metadata,
        });
        invite = newInvite;
        const pendingInvites = cleanClinicPendingInvites(clinic, now).filter((item) => item.id !== invite.id);
        pendingInvites.push({
          id: invite.id,
          email: invite.email,
          role: invite.role,
          status: invite.status,
          invitedAt: invite.invitedAt,
          expiresAt: invite.expiresAt,
          invitedBy,
          metadata,
        });
        clinic.pendingInvites = pendingInvites;
        await saveClinic(env, clinic);
        await sendInviteEmail(env, { clinic, invite, token });
        adminRequest.inviteId = invite.id;
        adminRequest.inviteSentAt = new Date().toISOString();
      }

      adminRequest.status = 'approved';
      adminRequest.processedBy = processedBy;
      adminRequest.processedAt = processedAtIso;
      adminRequest.decisionReason = nk(body?.decisionReason);

      await saveAdminRequestRecord(env, adminRequest);
      await clearPendingAdminRequestEmail(env, emailLower, adminRequest.id);

      const responsePayload = {
        ok: true,
        request: sanitizeAdminRequest(adminRequest),
      };
      if (membership) {
        responsePayload.membership = membership;
      }
      if (invite) {
        responsePayload.invite = {
          id: invite.id,
          email: invite.email,
          role: invite.role,
          invitedAt: invite.invitedAt,
          expiresAt: invite.expiresAt,
          status: invite.status,
        };
      }
      return jsonResponse(responsePayload);
    }

    if (routeMatch(url, 'POST', 'admin/accessRequest/deny')) {
      const authContext = await authenticateRequest(request, env);
      if (!authContext) {
        return jsonResponse({ error: 'UNAUTHORIZED', message: '認証が必要です。' }, 401);
      }
      if (!hasRole(authContext.payload, SYSTEM_ROOT_ONLY)) {
        return jsonResponse({ error: 'FORBIDDEN', message: '権限が不足しています。' }, 403);
      }
      let body;
      try {
        body = await request.json();
      } catch (err) {
        return jsonResponse({ error: 'INVALID_JSON', message: 'リクエスト形式が不正です。' }, 400);
      }
      const requestId = nk(body?.requestId || body?.id);
      if (!requestId) {
        return jsonResponse({ error: 'INVALID_REQUEST', message: 'requestId が必要です。' }, 400);
      }
      const adminRequest = await getAdminRequestById(env, requestId);
      if (!adminRequest) {
        return jsonResponse({ error: 'NOT_FOUND', message: '申請が見つかりません。' }, 404);
      }
      if ((adminRequest.status || '').toLowerCase() !== 'pending') {
        return jsonResponse({ error: 'REQUEST_ALREADY_PROCESSED', message: 'この申請は処理済みです。' }, 409);
      }
      const reason = nk(body?.reason || body?.decisionReason);
      const processedBy = ensureAccountId(authContext.account);
      const processedAtIso = new Date().toISOString();

      adminRequest.status = 'denied';
      adminRequest.processedBy = processedBy;
      adminRequest.processedAt = processedAtIso;
      adminRequest.decisionReason = reason;

      await saveAdminRequestRecord(env, adminRequest);
      await clearPendingAdminRequestEmail(env, adminRequest.emailLower || normalizeEmail(adminRequest.email), adminRequest.id);
      await sendAdminRequestDeniedEmail(env, {
        request: adminRequest,
        clinicName: adminRequest.clinicName,
        reason,
      });

      return jsonResponse({ ok: true, request: sanitizeAdminRequest(adminRequest) });
    }

    if (routeMatch(url, 'GET', 'memberships')) {
      const authContext = await authenticateRequest(request, env);
      if (!authContext) {
        return jsonResponse({ error: 'UNAUTHORIZED', message: '認証が必要です。' }, 401);
      }
      const { memberships } = await resolveAccountMemberships(env, authContext.account);
      authContext.account.memberships = memberships;
      return jsonResponse({ ok: true, memberships });
    }

    const MEDIA_SLOTS = new Set(["logoSmall", "logoLarge", "facade"]);
    const MODE_MASTER_PREFIX = 'master:mode:';
    const MODE_ID_MAX_LENGTH = 64;
    const MASTER_ID_MAX_LENGTH = 80;
    const LEGACY_POINTER_PREFIX = 'legacyPointer:';

    const normalizeModeId = (value) => normalizeSlug(value, { maxLength: MODE_ID_MAX_LENGTH });
    const SERVICE_EXPLANATION_PREFIX = 'master:serviceExplanation:';
    const TEST_EXPLANATION_PREFIX = 'master:testExplanation:';

    const legacyPointerKey = (alias) => `${LEGACY_POINTER_PREFIX}${alias}`;

    async function listModes(env) {
      const prefix = MODE_MASTER_PREFIX;
      const list = await env.SETTINGS.list({ prefix });
      const out = [];
      for (const key of list.keys) {
        try {
          const raw = await env.SETTINGS.get(key.name);
          if (!raw) continue;
          const obj = JSON.parse(raw);
          if (!obj || typeof obj !== 'object') continue;
          obj.id = key.name.replace(prefix, '');
          out.push(obj);
        } catch (err) {
          console.warn('failed to parse mode master', key.name, err);
        }
      }
      out.sort((a, b) => {
        const oa = Number.isFinite(a.order) ? a.order : 999;
        const ob = Number.isFinite(b.order) ? b.order : 999;
        if (oa !== ob) return oa - ob;
        return (a.label || '').localeCompare(b.label || '', 'ja');
      });
      return out;
    }

    async function sanitizeModePayload(env, payload = {}) {
      if (!payload || typeof payload !== 'object') {
        throw new Error('payload is required');
      }
      const label = nk(payload.label);
      if (!label) {
        throw new Error('label is required');
      }
      const description = nk(payload.description);
      const icon = nk(payload.icon);
      const orderValue = Number(payload.order);
      const active = payload.active !== false;
      const color = nk(payload.color);
      const tags = Array.isArray(payload.tags)
        ? Array.from(new Set(payload.tags.map((item) => nk(item)).filter(Boolean)))
        : [];

      const providedIdRaw = nk(payload.id || payload.slug);
      const normalizedProvidedId = normalizeModeId(providedIdRaw);
      const isUpdate = Boolean(payload.id);
      let slug = normalizedProvidedId;

      if (isUpdate) {
        if (!slug) {
          throw new Error('id is required');
        }
      } else {
        const baseCandidate = slug || normalizeModeId(label) || normalizeModeId(payload.slug);
        slug = await ensureUniqueId({
          kv: env.SETTINGS,
          prefix: MODE_MASTER_PREFIX,
          candidate: baseCandidate,
          normalize: normalizeModeId,
          fallback: () => normalizeModeId(randomSlug(MODE_ID_MAX_LENGTH)),
          randomLength: MODE_ID_MAX_LENGTH,
        });
      }

      if (!slug) {
        slug = await ensureUniqueId({
          kv: env.SETTINGS,
          prefix: MODE_MASTER_PREFIX,
          candidate: normalizeModeId(randomSlug(MODE_ID_MAX_LENGTH)),
          normalize: normalizeModeId,
          randomLength: MODE_ID_MAX_LENGTH,
        });
      }

      return {
        slug,
        label,
        description,
        icon,
        order: Number.isFinite(orderValue) ? orderValue : null,
        active,
        color,
        tags,
      };
    }

    const masterPrefix = (type) => `master:${type}:`;

    const masterIdKey = (type, id) => `${masterPrefix(type)}${id}`;

    async function migrateLegacyPointer(env, alias, pointerRaw) {
      if (!alias) return;
      await env.SETTINGS.put(legacyPointerKey(alias), pointerRaw);
      await env.SETTINGS.delete(alias).catch(() => {});
    }

    async function getLegacyPointer(env, alias) {
      if (!alias) return null;
      const raw = await env.SETTINGS.get(legacyPointerKey(alias));
      if (!raw) return null;
      try {
        const obj = JSON.parse(raw);
        return isLegacyPointer(obj) ? obj : null;
      } catch (_) {
        return null;
      }
    }

    function ensureLegacyAlias(record, alias) {
      if (!alias) return;
      if (!Array.isArray(record.legacyAliases)) {
        record.legacyAliases = [];
      }
      if (!record.legacyAliases.includes(alias)) {
        record.legacyAliases.push(alias);
      }
    }

    async function writeLegacyPointer(env, type, alias, record) {
      if (!alias) return;
      const pointer = {
        legacy: true,
        type,
        id: record.id,
        name: record.name,
        category: record.category,
        updatedAt: record.updated_at || Math.floor(Date.now() / 1000),
      };
      await migrateLegacyPointer(env, alias, JSON.stringify(pointer));
    }

    async function writeMasterRecord(env, type, record, { skipLegacyPointers = false, ctx } = {}) {
      if (!record || typeof record !== 'object' || !record.id) {
        throw new Error('record id is required');
      }
      const key = masterIdKey(type, record.id);
      const aliasSet = new Set();
      if (record.legacyKey) aliasSet.add(record.legacyKey);
      if (Array.isArray(record.legacyAliases)) {
        for (const alias of record.legacyAliases) {
          if (alias) aliasSet.add(alias);
        }
      }
      const aliases = Array.from(aliasSet);
      const payload = { ...record, type, legacyAliases: aliases };
      record.legacyAliases = aliases;
      try {
        await upsertMasterItemD1(env, payload);
      } catch (err) {
        console.warn('[masterStore] failed to upsert into D1', err);
      }
      await env.SETTINGS.put(key, JSON.stringify(payload));
      if (!skipLegacyPointers) {
        const pointerWrites = aliases.map((alias) => writeLegacyPointer(env, type, alias, payload));
        if (pointerWrites.length) {
          if (ctx?.waitUntil) {
            ctx.waitUntil((async () => {
              try {
                await Promise.all(pointerWrites);
              } catch (err) {
                console.warn('[masterStore] legacy pointer update failed', err);
              }
            })());
          } else {
            await Promise.all(pointerWrites);
          }
        }
      }
    }

    async function loadMasterById(env, type, id) {
      if (!id) return null;
      const d1Record = await getMasterItemByIdD1(env, id);
      if (d1Record) return d1Record;
      const raw = await env.SETTINGS.get(masterIdKey(type, id));
      if (!raw) return null;
      try {
        const obj = JSON.parse(raw);
        if (obj && !obj.id) {
          obj.id = id;
        }
        return obj;
      } catch (_) {
        return null;
      }
    }

    function isLegacyPointer(obj) {
      return obj && typeof obj === 'object' && obj.legacy === true && typeof obj.id === 'string';
    }

    function masterIdCandidate(category, name) {
      const parts = [
        normalizeSlug(category, { maxLength: 32 }),
        normalizeSlug(name, { maxLength: 48 }),
      ].filter(Boolean);
      return parts.join('-');
    }

    async function promoteLegacyMasterRecord(env, type, legacyKey, legacyRecord) {
      if (!legacyRecord || typeof legacyRecord !== 'object') {
        return null;
      }
      const candidate = masterIdCandidate(legacyRecord.category, legacyRecord.name);
      const stableId = await ensureUniqueId({
        kv: env.SETTINGS,
        prefix: masterPrefix(type),
        candidate,
        normalize: (value) => normalizeSlug(value, { maxLength: MASTER_ID_MAX_LENGTH }),
        fallback: () => normalizeSlug(randomSlug(16), { maxLength: MASTER_ID_MAX_LENGTH }),
        randomLength: MASTER_ID_MAX_LENGTH,
      });
      const now = Math.floor(Date.now() / 1000);
      const record = {
        ...legacyRecord,
        id: stableId,
        type: legacyRecord.type || type,
        legacyKey,
        legacyAliases: Array.isArray(legacyRecord.legacyAliases)
          ? Array.from(new Set([...legacyRecord.legacyAliases, legacyKey]))
          : (legacyKey ? [legacyKey] : []),
      };
      if (!record.created_at) {
        record.created_at = now;
      }
      record.updated_at = now;
      await writeMasterRecord(env, type, record);
      return record;
    }

    async function getMasterRecordByLegacy(env, type, legacyKey, context = {}) {
      if (!legacyKey) return null;
      let record = await getMasterItemByLegacyKeyD1(env, legacyKey);
      if (!record) {
        record = await getMasterItemByAliasD1(env, legacyKey);
      }
      if (!record) {
        const { category, name } = context;
        if (category && name) {
          record = await getMasterItemByComparableD1(env, { type, category, name });
        }
      }
      if (record) return record;
      const pointerNew = await getLegacyPointer(env, legacyKey);
      if (pointerNew) {
        return loadMasterById(env, type, pointerNew.id);
      }
      const raw = await env.SETTINGS.get(legacyKey);
      if (!raw) return null;
      let parsed = null;
      try {
        parsed = JSON.parse(raw);
      } catch (_) {
        return null;
      }
      if (isLegacyPointer(parsed)) {
        await migrateLegacyPointer(env, legacyKey, raw);
        return loadMasterById(env, type, parsed.id);
      }
      return promoteLegacyMasterRecord(env, type, legacyKey, parsed);
    }

    async function getOrCreateMasterRecord(env, { type, category, name }, options = {}) {
      const legacyKeyCurrent = normalizeKey(type, category, name);
      let record = await getMasterRecordByLegacy(env, type, legacyKeyCurrent, { category, name });
      let created = false;
      if (!record) {
        const candidate = masterIdCandidate(category, name);
        const id = await ensureUniqueId({
          kv: env.SETTINGS,
          prefix: masterPrefix(type),
          candidate,
          normalize: (value) => normalizeSlug(value, { maxLength: MASTER_ID_MAX_LENGTH }),
          fallback: () => normalizeSlug(randomSlug(16), { maxLength: MASTER_ID_MAX_LENGTH }),
          randomLength: MASTER_ID_MAX_LENGTH,
        });
        const now = Math.floor(Date.now() / 1000);
        record = {
          id,
          type,
          category,
          name,
          legacyKey: legacyKeyCurrent,
          legacyAliases: legacyKeyCurrent ? [legacyKeyCurrent] : [],
          desc_samples: [],
          sources: [],
          count: 0,
          status: 'candidate',
          canonical_name: null,
          created_at: now,
          updated_at: now,
        };
        await writeMasterRecord(env, type, record, options);
        created = true;
      }
      ensureLegacyAlias(record, legacyKeyCurrent);
      return { record, legacyKey: legacyKeyCurrent, created };
    }

    async function loadMastersByType(env, type) {
      if (!type) return [];
      const d1Items = await listMasterItemsD1(env, { type });
      return Array.isArray(d1Items) ? d1Items : [];
    }

    async function cleanupLegacyMasterKeys(env, types, {
      dryRun = false,
      batchSize = 1000,
      includeKeys = false,
      maxKeysPerType = 200,
    } = {}) {
      const captureKeys = includeKeys && Number.isFinite(maxKeysPerType) && maxKeysPerType > 0;
      const summary = {
        types: [],
        totalLegacyKeys: 0,
        migratedRecords: 0,
        migratedPointers: 0,
        deletedLegacyKeys: 0,
        errors: [],
        dryRun,
        includeKeys: captureKeys,
        maxKeysPerType: captureKeys ? maxKeysPerType : 0,
      };

      for (const type of types) {
        if (!MASTER_ALLOWED_TYPES.has(type)) continue;
        const typeSummary = {
          type,
          legacyKeys: 0,
          migratedRecords: 0,
          migratedPointers: 0,
          deleted: 0,
        };
        if (captureKeys) {
          typeSummary.sampleKeys = [];
          typeSummary.sampleKeysTruncated = false;
        }
        let cursor;
        do {
          const list = await env.SETTINGS.list({ prefix: masterPrefix(type), cursor, limit: batchSize });
          cursor = list.cursor;
          const keyEntries = list.keys || [];
          const legacyEntries = keyEntries.filter(entry => entry.name && entry.name.includes('|'));
          if (!legacyEntries.length) continue;

          const valuePromises = legacyEntries.map(entry => env.SETTINGS.get(entry.name));
          const values = await Promise.all(valuePromises);

          for (let i = 0; i < legacyEntries.length; i++) {
            const keyName = legacyEntries[i].name;
            const raw = values[i];
            typeSummary.legacyKeys += 1;
            summary.totalLegacyKeys += 1;

            if (!raw) {
              if (!dryRun) {
                await env.SETTINGS.delete(keyName).catch(() => {});
              }
              typeSummary.deleted += 1;
              summary.deletedLegacyKeys += 1;
              continue;
            }

            try {
              const parsed = JSON.parse(raw);
              if (isLegacyPointer(parsed)) {
                if (!dryRun) {
                  await migrateLegacyPointer(env, keyName, raw);
                }
                typeSummary.migratedPointers += 1;
                summary.migratedPointers += 1;
                continue;
              }

              if (captureKeys && typeSummary.sampleKeys.length < maxKeysPerType) {
                typeSummary.sampleKeys.push({
                  key: keyName,
                  category: parsed?.category || null,
                  name: parsed?.name || null,
                  status: parsed?.status || null,
                });
              } else if (captureKeys && typeSummary.sampleKeys.length === maxKeysPerType) {
                typeSummary.sampleKeysTruncated = true;
              }

              if (!dryRun) {
                const promoted = await promoteLegacyMasterRecord(env, type, keyName, parsed);
                if (promoted && promoted.id) {
                  await env.SETTINGS.delete(keyName).catch(() => {});
                }
              }
              typeSummary.migratedRecords += 1;
              summary.migratedRecords += 1;
            } catch (err) {
              summary.errors.push({ key: keyName, error: err.message || String(err) });
            }
          }
        } while (cursor);
        summary.types.push(typeSummary);
      }
      return summary;
    }

    async function saveMode(env, mode) {
      const key = `${MODE_MASTER_PREFIX}${mode.slug}`;
      const payload = { ...mode };
      delete payload.slug;
      await env.SETTINGS.put(key, JSON.stringify(payload));
      return { id: mode.slug, ...payload };
    }

    async function deleteMode(env, slug) {
      const key = `${MODE_MASTER_PREFIX}${slug}`;
      const existing = await env.SETTINGS.get(key);
      if (!existing) {
        throw new Error('mode not found');
      }
      await env.SETTINGS.delete(key);
    }

    function normalizeExplanationType(type) {
      const value = (type || '').toLowerCase();
      if (value === 'service' || value === 'test') return value;
      throw new Error('invalid explanation type');
    }

    function resolveExplanationPrefix(type) {
      return type === 'service' ? SERVICE_EXPLANATION_PREFIX : TEST_EXPLANATION_PREFIX;
    }

    function buildExplanationKey(type, id) {
      return `${resolveExplanationPrefix(type)}${id}`;
    }

    function sanitizeExplanationPayload(payload, { requireId = false } = {}) {
      if (!payload || typeof payload !== 'object') {
        throw new Error('payload is required');
      }
      const type = normalizeExplanationType(payload.type || payload.explanationType);
      const targetSlug = nk(payload.targetSlug || payload.slug || payload.serviceSlug || payload.testSlug);
      if (!targetSlug) {
        throw new Error('targetSlug is required');
      }
      const baseText = nk(payload.baseText || payload.text);
      if (!baseText) {
        throw new Error('baseText is required');
      }
      const idRaw = nk(payload.id);
      if (requireId && !idRaw) {
        throw new Error('id is required');
      }
      const id = idRaw || `${type}-${Date.now()}-${crypto.randomUUID()}`;
      const audience = nk(payload.audience);
      const context = nk(payload.context);
      const inheritFrom = nk(payload.inheritFrom);
      const status = (payload.status || 'draft').toLowerCase();
      const allowedStatus = new Set(['draft', 'review', 'published']);
      if (!allowedStatus.has(status)) {
        throw new Error('invalid status');
      }
      const tags = Array.isArray(payload.tags)
        ? Array.from(new Set(payload.tags.map((tag) => nk(tag)).filter(Boolean)))
        : [];
      return {
        id,
        type,
        targetSlug,
        baseText,
        audience,
        context,
        inheritFrom: inheritFrom || null,
        status,
        tags,
        sourceFacilityIds: Array.isArray(payload.sourceFacilityIds)
          ? Array.from(new Set(payload.sourceFacilityIds.map((id) => nk(id)).filter(Boolean)))
          : [],
      };
    }

    async function listExplanations(env, { type, targetSlug, status }) {
      const normalizedType = normalizeExplanationType(type);
      const prefix = resolveExplanationPrefix(normalizedType);
      const list = await env.SETTINGS.list({ prefix });
      const out = [];
      for (const key of list.keys) {
        try {
          const raw = await env.SETTINGS.get(key.name);
          if (!raw) continue;
          const obj = JSON.parse(raw);
          if (!obj || typeof obj !== 'object') continue;
          const item = {
            id: key.name.replace(prefix, ''),
            type: normalizedType,
            targetSlug: obj.targetSlug || obj.slug || '',
            baseText: obj.baseText || '',
            audience: obj.audience || '',
            context: obj.context || '',
            inheritFrom: obj.inheritFrom || null,
            status: obj.status || 'draft',
            tags: Array.isArray(obj.tags) ? obj.tags : [],
            sourceFacilityIds: Array.isArray(obj.sourceFacilityIds) ? obj.sourceFacilityIds : [],
            versions: Array.isArray(obj.versions) ? obj.versions : [],
            createdAt: obj.createdAt || null,
            updatedAt: obj.updatedAt || null,
          };
          if (targetSlug && item.targetSlug !== targetSlug) continue;
          if (status && item.status !== status) continue;
          out.push(item);
        } catch (err) {
          console.warn('failed to parse explanation', key.name, err);
        }
      }
      out.sort((a, b) => {
        const au = Number.isFinite(a.updatedAt) ? a.updatedAt : 0;
        const bu = Number.isFinite(b.updatedAt) ? b.updatedAt : 0;
        if (bu !== au) return bu - au;
        return (a.targetSlug || '').localeCompare(b.targetSlug || '', 'ja');
      });
      return out;
    }

    async function saveExplanation(env, payload, { requireId = false } = {}) {
      const sanitized = sanitizeExplanationPayload(payload, { requireId });
      const now = Date.now();
      const key = buildExplanationKey(sanitized.type, sanitized.id);
      const existingRaw = await env.SETTINGS.get(key);
      let existing = null;
      if (existingRaw) {
        try {
          existing = JSON.parse(existingRaw);
        } catch (err) {
          existing = null;
        }
      }
      const record = {
        targetSlug: sanitized.targetSlug,
        baseText: sanitized.baseText,
        audience: sanitized.audience,
        context: sanitized.context,
        inheritFrom: sanitized.inheritFrom,
        status: sanitized.status,
        tags: sanitized.tags,
        sourceFacilityIds: sanitized.sourceFacilityIds,
        versions: Array.isArray(existing?.versions) ? existing.versions : [],
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };
      // append history entry
      const versionEntry = {
        text: sanitized.baseText,
        status: sanitized.status,
        audience: sanitized.audience,
        context: sanitized.context,
        inheritFrom: sanitized.inheritFrom,
        tags: sanitized.tags,
        updatedAt: now,
      };
      record.versions = [...record.versions, versionEntry].slice(-20); // keep last 20 entries
      await env.SETTINGS.put(key, JSON.stringify(record));
      return {
        id: sanitized.id,
        type: sanitized.type,
        targetSlug: sanitized.targetSlug,
        baseText: sanitized.baseText,
        audience: sanitized.audience,
        context: sanitized.context,
        inheritFrom: sanitized.inheritFrom,
        status: sanitized.status,
        tags: sanitized.tags,
        sourceFacilityIds: sanitized.sourceFacilityIds,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      };
    }

    async function deleteExplanation(env, { type, id }) {
      const normalizedType = normalizeExplanationType(type);
      const slug = nk(id);
      if (!slug) {
        throw new Error('id is required');
      }
      const key = buildExplanationKey(normalizedType, slug);
      const existing = await env.SETTINGS.get(key);
      if (!existing) {
        throw new Error('explanation not found');
      }
      await env.SETTINGS.delete(key);
    }

    function inferExtension(contentType) {
      switch (contentType) {
        case "image/png": return "png";
        case "image/jpeg":
        case "image/jpg": return "jpg";
        case "image/webp": return "webp";
        case "image/gif": return "gif";
        default: return "";
      }
    }

    function sanitizeAlt(value) {
      return typeof value === "string" ? value.trim().slice(0, 200) : "";
    }

    async function createClinicMediaUpload(env, payload) {
      if (!env.MEDIA) {
        throw new Error("R2 bucket is not configured");
      }
      if (typeof env.MEDIA.createPresignedUrl !== "function") {
        throw new Error("presigned upload is not supported");
      }
      const { clinicId, slot, contentType } = payload;
      if (typeof clinicId !== "string" || !clinicId.trim()) {
        throw new Error("clinicId is required");
      }
      if (!MEDIA_SLOTS.has(slot)) {
        throw new Error("Invalid slot");
      }
      if (typeof contentType !== "string" || !contentType.trim()) {
        throw new Error("contentType is required");
      }
      const extension = inferExtension(contentType.trim().toLowerCase());
      if (!extension) {
        throw new Error("Unsupported content type");
      }
      const unique = crypto.randomUUID();
      const key = `clinic/${clinicId}/${slot}/${Date.now()}-${unique}.${extension}`;
      const presigned = await env.MEDIA.createPresignedUrl({
        key,
        method: "PUT",
        expiration: 300,
        conditions: [["content-length-range", 0, 5 * 1024 * 1024]],
      });
      return {
        key,
        uploadUrl: presigned.url,
        headers: presigned.headers || {},
      };
    }

    async function saveClinicMediaRecord(env, clinicId, slot, mediaRecord) {
      const clinic = await getClinicById(env, clinicId);
      if (!clinic) {
        throw new Error("clinic not found");
      }
      const media = clinic.media && typeof clinic.media === "object" ? clinic.media : {};
      media[slot] = {
        key: mediaRecord.key,
        contentType: mediaRecord.contentType || "",
        width: mediaRecord.width ?? null,
        height: mediaRecord.height ?? null,
        fileSize: mediaRecord.fileSize ?? null,
        alt: sanitizeAlt(mediaRecord.alt),
        uploadedAt: Math.floor(Date.now() / 1000),
      };
      clinic.media = media;
      await saveClinic(env, clinic);
      return media[slot];
    }

    async function deleteClinicMedia(env, clinicId, slot) {
      const clinic = await getClinicById(env, clinicId);
      if (!clinic) {
        throw new Error("clinic not found");
      }
      const media = clinic.media && typeof clinic.media === "object" ? clinic.media : {};
      const current = media[slot];
      if (!current) {
        return { deleted: false };
      }
      if (current.key && env.MEDIA) {
        try {
          await env.MEDIA.delete(current.key);
        } catch (err) {
          console.warn("failed to delete R2 object", current.key, err);
        }
      }
      delete media[slot];
      clinic.media = media;
      await saveClinic(env, clinic);
      return { deleted: true };
    }

    if (routeMatch(url, "POST", "media/upload-url")) {
      try {
        const payload = await request.json();
        const result = await createClinicMediaUpload(env, payload || {});
        return new Response(JSON.stringify({ ok: true, ...result }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: err.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (routeMatch(url, "POST", "media/upload")) {
      try {
        if (!env.MEDIA) {
          throw new Error("R2 bucket is not configured");
        }
        const form = await request.formData();
        const clinicId = form.get("clinicId");
        const slot = form.get("slot");
        const alt = form.get("alt");
        const widthRaw = form.get("width");
        const heightRaw = form.get("height");
        const file = form.get("file");

        if (typeof clinicId !== "string" || !clinicId.trim()) {
          throw new Error("clinicId is required");
        }
        if (typeof slot !== "string" || !MEDIA_SLOTS.has(slot)) {
          throw new Error("Invalid slot");
        }
        if (!(file instanceof File)) {
          throw new Error("file is required");
        }
        if (file.size > 5 * 1024 * 1024) {
          throw new Error("file size exceeds 5MB limit");
        }
        const contentType = file.type || "application/octet-stream";
        let extension = inferExtension(contentType.toLowerCase());
        if (!extension) {
          const name = typeof file.name === "string" ? file.name : "";
          const guessed = name.includes('.') ? name.split('.').pop() : "";
          if (guessed) {
            extension = guessed.toLowerCase();
          } else {
            throw new Error("Unsupported content type");
          }
        }

        const unique = crypto.randomUUID();
        const key = `clinic/${clinicId}/${slot}/${Date.now()}-${unique}.${extension}`;
        await env.MEDIA.put(key, file.stream(), {
          httpMetadata: {
            contentType,
          },
        });

        const width = widthRaw ? Number(widthRaw) : null;
        const height = heightRaw ? Number(heightRaw) : null;

        const record = await saveClinicMediaRecord(env, clinicId.trim(), slot, {
          key,
          contentType,
          width: Number.isFinite(width) ? width : null,
          height: Number.isFinite(height) ? height : null,
          fileSize: file.size,
          alt,
        });

        return new Response(JSON.stringify({ ok: true, media: record }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        const status = err.message === "clinic not found" ? 404 : 400;
        return new Response(JSON.stringify({ ok: false, error: err.message }), {
          status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (routeMatch(url, "POST", "media/commit")) {
      try {
        const payload = await request.json();
        const { clinicId, slot, objectKey, contentType, width, height, fileSize, alt } = payload || {};
        if (typeof clinicId !== "string" || !clinicId.trim()) {
          throw new Error("clinicId is required");
        }
        if (!MEDIA_SLOTS.has(slot)) {
          throw new Error("Invalid slot");
        }
        if (typeof objectKey !== "string" || !objectKey.trim()) {
          throw new Error("objectKey is required");
        }
        const record = await saveClinicMediaRecord(env, clinicId.trim(), slot, {
          key: objectKey.trim(),
          contentType,
          width,
          height,
          fileSize,
          alt,
        });
        return new Response(JSON.stringify({ ok: true, media: record }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        const status = err.message === "clinic not found" ? 404 : 400;
        return new Response(JSON.stringify({ ok: false, error: err.message }), {
          status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (routeMatch(url, "POST", "media/delete")) {
      try {
        const payload = await request.json();
        const { clinicId, slot } = payload || {};
        if (typeof clinicId !== "string" || !clinicId.trim()) {
          throw new Error("clinicId is required");
        }
        if (!MEDIA_SLOTS.has(slot)) {
          throw new Error("Invalid slot");
        }
        const result = await deleteClinicMedia(env, clinicId.trim(), slot);
        return new Response(JSON.stringify({ ok: true, ...result }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        const status = err.message === "clinic not found" ? 404 : 400;
        return new Response(JSON.stringify({ ok: false, error: err.message }), {
          status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (routeMatch(url, "GET", "client-config")) {
      const googleMapsApiKey =
        typeof env.GOOGLE_MAPS_API_KEY === "string"
          ? env.GOOGLE_MAPS_API_KEY.trim()
          : "";
      return new Response(JSON.stringify({ googleMapsApiKey }), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      });
    }

    if (routeMatch(url, 'GET', 'modes')) {
      try {
        const modes = await listModes(env);
        return new Response(JSON.stringify({ ok: true, modes }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    if (routeMatch(url, 'POST', 'modes/add')) {
      try {
        const payload = await request.json();
        const sanitized = await sanitizeModePayload(env, payload || {});
        const saved = await saveMode(env, sanitized);
        return new Response(JSON.stringify({ ok: true, mode: saved }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        const status = /required|Unsupported/.test(err.message) ? 400 : 500;
        return new Response(JSON.stringify({ ok: false, error: err.message }), {
          status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    if (routeMatch(url, 'POST', 'modes/update')) {
      try {
        const payload = await request.json();
        const sanitized = await sanitizeModePayload(env, payload || {});
        const originalSlug = normalizeModeId(nk(payload?.id || payload?.slug));
        if (!originalSlug) {
          throw new Error('id is required');
        }
        if (originalSlug !== sanitized.slug) {
          throw new Error('changing id is not supported');
        }
        const existing = await env.SETTINGS.get(`${MODE_MASTER_PREFIX}${sanitized.slug}`);
        if (!existing) {
          throw new Error('mode not found');
        }
        const mode = await saveMode(env, sanitized);
        return new Response(JSON.stringify({ ok: true, mode }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        const status = /required|Unsupported|not found/.test(err.message) ? (/not found/.test(err.message) ? 404 : 400) : 500;
        return new Response(JSON.stringify({ ok: false, error: err.message }), {
          status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    if (routeMatch(url, 'POST', 'modes/delete')) {
      try {
        const payload = await request.json();
        const slug = nk(payload?.id || payload?.slug);
        if (!slug) {
          throw new Error('id is required');
        }
        await deleteMode(env, slug);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        const status = err.message === 'mode not found' ? 404 : /required/.test(err.message) ? 400 : 500;
        return new Response(JSON.stringify({ ok: false, error: err.message }), {
          status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    if (routeMatch(url, 'GET', 'explanations')) {
      try {
        const type = url.searchParams.get('type');
        const targetSlug = url.searchParams.get('targetSlug') || url.searchParams.get('slug');
        const status = url.searchParams.get('status');
        const items = await listExplanations(env, { type, targetSlug, status });
        return new Response(JSON.stringify({ ok: true, explanations: items }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        const status = /invalid/.test(err.message) ? 400 : 500;
        return new Response(JSON.stringify({ ok: false, error: err.message }), {
          status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    if (routeMatch(url, 'POST', 'explanations/add')) {
      try {
        const payload = await request.json();
        const saved = await saveExplanation(env, payload || {});
        return new Response(JSON.stringify({ ok: true, explanation: saved }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        const status = /required|invalid/.test(err.message) ? 400 : 500;
        return new Response(JSON.stringify({ ok: false, error: err.message }), {
          status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    if (routeMatch(url, 'POST', 'explanations/update')) {
      try {
        const payload = await request.json();
        const saved = await saveExplanation(env, payload || {}, { requireId: true });
        return new Response(JSON.stringify({ ok: true, explanation: saved }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        const status = /required|invalid/.test(err.message) ? 400 : 500;
        return new Response(JSON.stringify({ ok: false, error: err.message }), {
          status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    if (routeMatch(url, 'POST', 'explanations/delete')) {
      try {
        const payload = await request.json();
        const type = payload?.type;
        const id = payload?.id;
        await deleteExplanation(env, { type, id });
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        const status = err.message === 'explanation not found' ? 404 : /required|invalid/.test(err.message) ? 400 : 500;
        return new Response(JSON.stringify({ ok: false, error: err.message }), {
          status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    function normalizeTodoEntry(raw) {
      if (!raw || typeof raw !== "object") return null;
      const category = nk(raw.category);
      const title = nk(raw.title);
      if (!category || !title) return null;
      const status = raw.status === "done" ? "done" : "open";
      const priority = ["P1", "P2", "P3"].includes(raw.priority) ? raw.priority : "P3";
      const createdAt = typeof raw.createdAt === "string" && raw.createdAt
        ? raw.createdAt
        : new Date().toISOString();
      return { category, title, status, priority, createdAt };
    }

    // ============================================================
    // <<< START: AI_GENERATE >>>
    // ============================================================
    if (routeMatch(url, "POST", "generate")) {
      try {
        const body = await request.json();
        const model = (await env.SETTINGS.get("model")) || "gpt-4o-mini";
        const prompt =
          (await env.SETTINGS.get("prompt")) ||
          "医療説明用のサンプルを作ってください";

        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "system", content: prompt }, ...(body.messages || [])],
          }),
        });

        const data = await response.json();
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        return new Response("Error: " + err.message, {
          status: 500,
          headers: corsHeaders,
        });
      }
    }
    // <<< END: AI_GENERATE >>>

    // ============================================================
    // <<< START: SETTINGS >>>
    // ============================================================
    if (routeMatch(url, "GET", "settings")) {
      const prompt_exam = await env.SETTINGS.get("prompt_exam");
      const prompt_diagnosis = await env.SETTINGS.get("prompt_diagnosis");
      const model = await env.SETTINGS.get("model");
      const prompt = await env.SETTINGS.get("prompt");
      return new Response(
        JSON.stringify({ model, prompt, prompt_exam, prompt_diagnosis }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (routeMatch(url, "POST", "settings")) {
      const body = await request.json();
      if (typeof body.model === "string") {
        await env.SETTINGS.put("model", body.model.trim());
      }
      if (typeof body.prompt === "string") {
        await env.SETTINGS.put("prompt", body.prompt);
      }
      if (typeof body.prompt_exam === "string") {
        await env.SETTINGS.put("prompt_exam", body.prompt_exam);
      }
      if (typeof body.prompt_diagnosis === "string") {
        await env.SETTINGS.put("prompt_diagnosis", body.prompt_diagnosis);
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // <<< END: SETTINGS >>>

    // ============================================================
    // 厚労省施設データ：参照・登録
    // ============================================================

    if (routeMatch(url, 'GET', 'mhlw/facilities/meta')) {
      const meta = await readMhlwFacilitiesMeta(env);
      if (!meta) {
        return jsonResponse({ ok: false, error: 'NOT_FOUND', message: '厚労省施設データがまだアップロードされていません。' }, 404);
      }
      return jsonResponse({ ok: true, meta });
    }

    if (routeMatch(url, 'GET', 'mhlw/search')) {
      if (!env?.MASTERS_D1 || typeof env.MASTERS_D1.prepare !== 'function') {
        return jsonResponse({ ok: false, error: 'MHLW_D1_UNCONFIGURED', message: '厚労省データベース (D1) が構成されていません。' }, 503);
      }
      const keyword = url.searchParams.get('q') || url.searchParams.get('keyword') || '';
      const facilityId = url.searchParams.get('facilityId') || url.searchParams.get('id') || '';
      const facilityType = url.searchParams.get('facilityType') || url.searchParams.get('type') || '';
      const prefecture = url.searchParams.get('prefecture') || '';
      const city = url.searchParams.get('city') || '';
      const limitParam = url.searchParams.get('limit');
      const limit = limitParam ? Number(limitParam) : 20;

      if (!facilityId && !keyword) {
        return jsonResponse({ ok: false, error: 'MISSING_QUERY', message: '施設ID または 検索キーワードを指定してください。' }, 400);
      }
      if (!facilityId && !prefecture) {
        return jsonResponse({ ok: false, error: 'PREFECTURE_REQUIRED', message: '都道府県を選択してから検索してください。' }, 400);
      }

      try {
        const matches = await searchMhlwFacilities(env, {
          keyword,
          facilityId,
          facilityType,
          prefecture,
          city,
          limit,
        });
        return jsonResponse({ ok: true, results: matches || [] });
      } catch (err) {
        console.error('[mhlw] search failed', err);
        return jsonResponse({ ok: false, error: 'MHLW_SEARCH_FAILED', message: '厚労省データの検索に失敗しました。' }, 500);
      }
    }

    if (routeMatch(url, 'GET', 'mhlw/facilities') || routeMatch(url, 'HEAD', 'mhlw/facilities')) {
      const formatParam = (url.searchParams.get('format') || '').toLowerCase();
      const sourceParam = (url.searchParams.get('source') || '').toLowerCase();

      if (sourceParam !== 'r2') {
        const meta = await readMhlwFacilitiesMeta(env);
        const d1Response = await fetchMhlwFacilitiesFromD1(env, {
          format: formatParam,
          method: request.method,
          meta,
        });
        if (d1Response) {
          return d1Response;
        }
      }

      if (!env.MEDIA || typeof env.MEDIA.get !== 'function') {
        return jsonResponse({ error: 'MHLW_STORAGE_UNCONFIGURED', message: 'MEDIA バケットが構成されていません。' }, 500);
      }
      const object = await env.MEDIA.get(MHLW_FACILITIES_R2_KEY);
      if (!object) {
        return jsonResponse({ error: 'NOT_FOUND', message: '厚労省施設データがまだアップロードされていません。' }, 404);
      }
      const headers = new Headers({ ...corsHeaders });
      const contentType = object.httpMetadata?.contentType || 'application/json';
      headers.set('Content-Type', contentType);
      headers.set('Cache-Control', object.httpMetadata?.cacheControl || MHLW_FACILITIES_CACHE_CONTROL);
      if (object.httpMetadata?.contentEncoding) {
        headers.set('Content-Encoding', object.httpMetadata.contentEncoding);
      }
      if (object.etag) headers.set('ETag', object.etag);
      if (object.uploaded) headers.set('Last-Modified', new Date(object.uploaded).toUTCString());
      if (typeof object.size === 'number') headers.set('Content-Length', String(object.size));
      if (request.method === 'HEAD') {
        return new Response(null, { status: 200, headers });
      }
      return new Response(object.body, { status: 200, headers });
    }

    if (routeMatch(url, 'PUT', 'admin/mhlw/facilities')) {
      const authContext = await authenticateRequest(request, env);
      if (!authContext) {
        return jsonResponse({ error: 'UNAUTHORIZED', message: '認証が必要です。' }, 401);
      }
      if (!hasRole(authContext.payload, SYSTEM_ROOT_ONLY)) {
        return jsonResponse({ error: 'FORBIDDEN', message: 'systemRoot 権限が必要です。' }, 403);
      }
      if (!env.MEDIA || typeof env.MEDIA.put !== 'function') {
        return jsonResponse({ error: 'MHLW_STORAGE_UNCONFIGURED', message: 'MEDIA バケットが構成されていません。' }, 500);
      }
      if (!request.body) {
        return jsonResponse({ error: 'INVALID_REQUEST', message: 'アップロードするデータが空です。' }, 400);
      }
      const contentType = request.headers.get('Content-Type') || 'application/json';
      const cacheControl = request.headers.get('Cache-Control') || MHLW_FACILITIES_CACHE_CONTROL;
      const contentEncoding = request.headers.get('Content-Encoding') || undefined;
      let putResult;
      try {
        putResult = await env.MEDIA.put(MHLW_FACILITIES_R2_KEY, request.body, {
          httpMetadata: {
            contentType,
            cacheControl,
            contentEncoding,
          },
        });
      } catch (err) {
        console.error('[mhlw] failed to store facilities dataset', err);
        return jsonResponse({ error: 'UPLOAD_FAILED', message: '厚労省施設データの保存に失敗しました。' }, 500);
      }
      const sourceType = contentEncoding === 'gzip' ? 'json-gzip' : 'json';
      const meta = await writeMhlwFacilitiesMeta(env, {
        updatedAt: new Date().toISOString(),
        size: putResult?.size ?? null,
        etag: putResult?.etag ?? null,
        cacheControl,
        contentType,
        contentEncoding: contentEncoding || null,
        uploadedBy: authContext.account?.id || authContext.payload?.sub || null,
        facilityCount: undefined,
        scheduleCount: undefined,
        sourceType,
      });
      return jsonResponse({ ok: true, meta });
    }

    if (routeMatch(url, 'POST', 'admin/mhlw/initUpload')) {
      const authContext = await authenticateRequest(request, env);
      if (!authContext) {
        return jsonResponse({ error: 'UNAUTHORIZED', message: '認証が必要です。' }, 401);
      }
      if (!hasRole(authContext.payload, SYSTEM_ROOT_ONLY)) {
        return jsonResponse({ error: 'FORBIDDEN', message: 'systemRoot 権限が必要です。' }, 403);
      }
      if (!env.MEDIA?.createMultipartUpload) {
        return jsonResponse({ error: 'UNSUPPORTED', message: 'R2 バケットの multipart upload が利用できません。' }, 500);
      }
      let body = {};
      try {
        body = await request.json();
      } catch (_) {}

      const facilityCount = Number.isFinite(body?.facilityCount) ? Number(body.facilityCount) : null;
      const scheduleCount = Number.isFinite(body?.scheduleCount) ? Number(body.scheduleCount) : null;
      const preferredPartSize = Number.isFinite(body?.partSize) ? Math.max(5 * 1024 * 1024, Math.min(body.partSize, 50 * 1024 * 1024)) : null;
      const partSize = preferredPartSize || MHLW_DEFAULT_PART_SIZE;
      const contentType = typeof body?.contentType === 'string' && body.contentType.trim() ? body.contentType.trim() : 'application/json';
      const cacheControl = typeof body?.cacheControl === 'string' && body.cacheControl.trim() ? body.cacheControl.trim() : MHLW_FACILITIES_CACHE_CONTROL;
      const gzip = body?.gzip === true;

      let multipart;
      try {
        multipart = await env.MEDIA.createMultipartUpload(MHLW_FACILITIES_R2_KEY, {
          httpMetadata: {
            contentType,
            cacheControl,
            contentEncoding: gzip ? 'gzip' : undefined,
          },
        });
      } catch (err) {
        console.error('[mhlw] failed to create multipart upload', err);
        return jsonResponse({ error: 'UPLOAD_INIT_FAILED', message: 'R2 multipart upload の初期化に失敗しました。' }, 500);
      }

      const session = await saveUploadSession(env, multipart.uploadId, {
        key: MHLW_FACILITIES_R2_KEY,
        partSize,
        contentType,
        cacheControl,
        gzip,
        facilityCount,
        scheduleCount,
        uploadedBy: authContext.account?.id || authContext.payload?.sub || null,
      });

      return jsonResponse({ ok: true, uploadId: session.uploadId, key: session.key, partSize: session.partSize });
    }

    if (routeMatch(url, 'PUT', 'admin/mhlw/uploadPart')) {
      const authContext = await authenticateRequest(request, env);
      if (!authContext) {
        return jsonResponse({ error: 'UNAUTHORIZED', message: '認証が必要です。' }, 401);
      }
      if (!hasRole(authContext.payload, SYSTEM_ROOT_ONLY)) {
        return jsonResponse({ error: 'FORBIDDEN', message: 'systemRoot 権限が必要です。' }, 403);
      }
      if (!env.MEDIA?.uploadPart) {
        return jsonResponse({ error: 'UNSUPPORTED', message: 'R2 バケットの multipart upload が利用できません。' }, 500);
      }
      const uploadId = nk(url.searchParams.get('uploadId'));
      const partNumberRaw = nk(url.searchParams.get('partNumber'));
      const partNumber = Number(partNumberRaw);
      if (!uploadId || !Number.isInteger(partNumber) || partNumber < 1) {
        return jsonResponse({ error: 'INVALID_REQUEST', message: 'uploadId と partNumber は必須です。' }, 400);
      }
      const session = await getUploadSession(env, uploadId);
      if (!session) {
        return jsonResponse({ error: 'UPLOAD_NOT_FOUND', message: '対象のアップロードセッションが見つかりません。' }, 404);
      }
      const chunkBuffer = await request.arrayBuffer();
      if (!chunkBuffer || chunkBuffer.byteLength === 0) {
        return jsonResponse({ error: 'INVALID_REQUEST', message: '空のチャンクはアップロードできません。' }, 400);
      }
      if (session.partSize && chunkBuffer.byteLength > session.partSize + (1 * 1024 * 1024)) {
        return jsonResponse({ error: 'CHUNK_TOO_LARGE', message: `チャンクサイズが上限を超えています (${formatBytes(session.partSize)})。` }, 400);
      }
      let partResult;
      try {
        partResult = await env.MEDIA.uploadPart(session.key, uploadId, partNumber, chunkBuffer);
      } catch (err) {
        console.error('[mhlw] uploadPart failed', err);
        return jsonResponse({ error: 'UPLOAD_PART_FAILED', message: 'チャンクのアップロードに失敗しました。' }, 500);
      }
      if (!partResult?.etag) {
        return jsonResponse({ error: 'UPLOAD_PART_FAILED', message: 'ETag の取得に失敗しました。' }, 500);
      }
      await saveUploadSession(env, uploadId, { ...session, lastPartNumber: partNumber });
      return jsonResponse({ ok: true, etag: partResult.etag });
    }

    if (routeMatch(url, 'POST', 'admin/mhlw/completeUpload')) {
      const authContext = await authenticateRequest(request, env);
      if (!authContext) {
        return jsonResponse({ error: 'UNAUTHORIZED', message: '認証が必要です。' }, 401);
      }
      if (!hasRole(authContext.payload, SYSTEM_ROOT_ONLY)) {
        return jsonResponse({ error: 'FORBIDDEN', message: 'systemRoot 権限が必要です。' }, 403);
      }
      if (!env.MEDIA?.completeMultipartUpload) {
        return jsonResponse({ error: 'UNSUPPORTED', message: 'R2 バケットの multipart upload が利用できません。' }, 500);
      }
      let body;
      try {
        body = await request.json();
      } catch (err) {
        return jsonResponse({ error: 'INVALID_JSON', message: 'リクエスト形式が不正です。' }, 400);
      }
      const uploadId = nk(body?.uploadId);
      if (!uploadId) {
        return jsonResponse({ error: 'INVALID_REQUEST', message: 'uploadId は必須です。' }, 400);
      }
      const session = await getUploadSession(env, uploadId);
      if (!session) {
        return jsonResponse({ error: 'UPLOAD_NOT_FOUND', message: '対象のアップロードセッションが見つかりません。' }, 404);
      }
      const partsPayload = Array.isArray(body?.parts) ? body.parts : [];
      if (!partsPayload.length) {
        return jsonResponse({ error: 'INVALID_REQUEST', message: 'parts が指定されていません。' }, 400);
      }
      const parts = partsPayload.map((part) => ({
        partNumber: Number(part?.partNumber),
        etag: nk(part?.etag),
      })).filter((part) => Number.isInteger(part.partNumber) && part.partNumber >= 1 && part.etag);
      if (!parts.length) {
        return jsonResponse({ error: 'INVALID_REQUEST', message: '有効なパーツ情報がありません。' }, 400);
      }
      parts.sort((a, b) => a.partNumber - b.partNumber);
      try {
        await env.MEDIA.completeMultipartUpload(session.key, uploadId, parts);
      } catch (err) {
        console.error('[mhlw] completeMultipartUpload failed', err);
        return jsonResponse({ error: 'UPLOAD_COMPLETE_FAILED', message: 'アップロードの確定に失敗しました。' }, 500);
      }

      await deleteUploadSession(env, uploadId);

      let head = null;
      try {
        head = await env.MEDIA.head(session.key);
      } catch (err) {
        console.warn('[mhlw] failed to head object after upload', err);
      }

      const meta = await writeMhlwFacilitiesMeta(env, {
        updatedAt: new Date().toISOString(),
        size: head?.size ?? null,
        etag: head?.httpEtag || head?.etag || null,
        cacheControl: head?.httpMetadata?.cacheControl || session.cacheControl || null,
        contentType: head?.httpMetadata?.contentType || session.contentType || 'application/json',
        contentEncoding: head?.httpMetadata?.contentEncoding || (session.gzip ? 'gzip' : null),
        uploadedAt: head?.uploaded ? new Date(head.uploaded).toISOString() : null,
        uploadedBy: session.uploadedBy,
        facilityCount: session.facilityCount,
        scheduleCount: session.scheduleCount,
        sourceType: 'browser-multipart',
      });

      return jsonResponse({ ok: true, meta });
    }

    if (routeMatch(url, 'DELETE', 'admin/mhlw/upload')) {
      const authContext = await authenticateRequest(request, env);
      if (!authContext) {
        return jsonResponse({ error: 'UNAUTHORIZED', message: '認証が必要です。' }, 401);
      }
      if (!hasRole(authContext.payload, SYSTEM_ROOT_ONLY)) {
        return jsonResponse({ error: 'FORBIDDEN', message: 'systemRoot 権限が必要です。' }, 403);
      }
      const uploadId = nk(url.searchParams.get('uploadId'));
      if (!uploadId) {
        return jsonResponse({ error: 'INVALID_REQUEST', message: 'uploadId は必須です。' }, 400);
      }
      const session = await getUploadSession(env, uploadId);
      if (session) {
        try {
          await env.MEDIA.abortMultipartUpload(session.key, uploadId);
        } catch (err) {
          console.warn('[mhlw] failed to abort multipart upload', err);
        }
        await deleteUploadSession(env, uploadId);
      }
      return jsonResponse({ ok: true });
    }

    if (routeMatch(url, 'POST', 'admin/mhlw/refreshMeta')) {
      const authContext = await authenticateRequest(request, env);
      if (!authContext) {
        return jsonResponse({ error: 'UNAUTHORIZED', message: '認証が必要です。' }, 401);
      }
      if (!hasRole(authContext.payload, SYSTEM_ROOT_ONLY)) {
        return jsonResponse({ error: 'FORBIDDEN', message: 'systemRoot 権限が必要です。' }, 403);
      }
      if (!env.MEDIA || typeof env.MEDIA.head !== 'function') {
        return jsonResponse({ error: 'MHLW_STORAGE_UNCONFIGURED', message: 'MEDIA バケットが構成されていません。' }, 500);
      }

      let body = {};
      try {
        body = await request.json();
      } catch (_) {}

      const head = await env.MEDIA.head(MHLW_FACILITIES_R2_KEY);
      if (!head) {
        return jsonResponse({ error: 'NOT_FOUND', message: 'R2 に厚労省施設データが存在しません。' }, 404);
      }

      const meta = await writeMhlwFacilitiesMeta(env, {
        updatedAt: new Date().toISOString(),
        size: head.size ?? null,
        etag: head.httpEtag || head.etag || null,
        cacheControl: head.httpMetadata?.cacheControl || null,
        contentType: head.httpMetadata?.contentType || null,
        uploadedAt: head.uploaded ? new Date(head.uploaded).toISOString() : null,
        uploadedBy: authContext.account?.id || authContext.payload?.sub || null,
        facilityCount: typeof body?.facilityCount === 'number' ? body.facilityCount : null,
        scheduleCount: typeof body?.scheduleCount === 'number' ? body.scheduleCount : null,
        sourceType: 'r2',
        note: body?.note || null,
      });

      return jsonResponse({ ok: true, meta });
    }

    if (routeMatch(url, 'POST', 'admin/mhlw/uploadCsv')) {
      const authContext = await authenticateRequest(request, env);
      if (!authContext) {
        return jsonResponse({ error: 'UNAUTHORIZED', message: '認証が必要です。' }, 401);
      }
      if (!hasRole(authContext.payload, SYSTEM_ROOT_ONLY)) {
        return jsonResponse({ error: 'FORBIDDEN', message: 'systemRoot 権限が必要です。' }, 403);
      }
      if (!env.MEDIA || typeof env.MEDIA.put !== 'function') {
        return jsonResponse({ error: 'MHLW_STORAGE_UNCONFIGURED', message: 'MEDIA バケットが構成されていません。' }, 500);
      }
      let formData;
      try {
        formData = await request.formData();
      } catch (err) {
        return jsonResponse({ error: 'INVALID_FORM_DATA', message: 'フォームデータを解析できませんでした。' }, 400);
      }

      const clinicFacilityFile = formData.get('clinicFacility');
      const clinicScheduleFile = formData.get('clinicSchedule');
      const hospitalFacilityFile = formData.get('hospitalFacility');
      const hospitalScheduleFile = formData.get('hospitalSchedule');

      const missing = [];
      if (!(clinicFacilityFile instanceof File) || clinicFacilityFile.size === 0) missing.push('clinicFacility');
      if (!(clinicScheduleFile instanceof File) || clinicScheduleFile.size === 0) missing.push('clinicSchedule');
      if (!(hospitalFacilityFile instanceof File) || hospitalFacilityFile.size === 0) missing.push('hospitalFacility');
      if (!(hospitalScheduleFile instanceof File) || hospitalScheduleFile.size === 0) missing.push('hospitalSchedule');
      if (missing.length) {
        return jsonResponse({ error: 'INVALID_REQUEST', message: `以下のファイルが不足しています: ${missing.join(', ')}` }, 400);
      }

      let dataset;
      try {
        dataset = await buildMhlwDatasetFromCsv({
          clinicFacilityFile,
          clinicScheduleFile,
          hospitalFacilityFile,
          hospitalScheduleFile,
        });
      } catch (err) {
        console.error('[mhlw] failed to parse CSV', err);
        return jsonResponse({ error: 'CSV_PARSE_FAILED', message: err?.message || 'CSVの解析に失敗しました。' }, 400);
      }

      const payload = JSON.stringify({ count: dataset.facilities.length, facilities: dataset.facilities });
      const payloadBytes = new TextEncoder().encode(payload);

      let putResult;
      try {
        putResult = await env.MEDIA.put(MHLW_FACILITIES_R2_KEY, payloadBytes, {
          httpMetadata: {
            contentType: 'application/json',
            cacheControl: MHLW_FACILITIES_CACHE_CONTROL,
          },
        });
      } catch (err) {
        console.error('[mhlw] failed to store facilities dataset', err);
        return jsonResponse({ error: 'UPLOAD_FAILED', message: '厚労省施設データの保存に失敗しました。' }, 500);
      }

      const meta = await writeMhlwFacilitiesMeta(env, {
        updatedAt: new Date().toISOString(),
        size: payloadBytes.length,
        etag: putResult?.etag ?? null,
        cacheControl: MHLW_FACILITIES_CACHE_CONTROL,
        contentType: 'application/json',
        uploadedBy: authContext.account?.id || authContext.payload?.sub || null,
        facilityCount: dataset.stats.facilityCount,
        scheduleCount: dataset.stats.scheduleCount,
        sourceType: 'csv',
      });

      return jsonResponse({ ok: true, meta, summary: dataset.stats });
    }

    // ============================================================
    // 施設：登録・一覧・更新・削除・出力
    // ============================================================

    // <<< START: CLINIC_REGISTER >>>
if (routeMatch(url, "POST", "registerClinic")) {
  try {
    const body = await request.json();
    const name = nk(body?.name);
    if (!name) {
      return new Response(JSON.stringify({ error: "診療所名が必要です" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const mhlwFacilityId = normalizeMhlwFacilityId(body?.mhlwFacilityId || body?.facilityId || body?.mhlwId);
    if (!mhlwFacilityId) {
      return new Response(JSON.stringify({ error: 'MHLW_FACILITY_ID_REQUIRED', message: '厚生労働省の施設IDを指定してください。' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const existingNew = await env.SETTINGS.get(`clinic:name:${name}`);
    if (existingNew) {
      const clinic = await kvGetJSON(env, `clinic:id:${existingNew}`);
      return new Response(JSON.stringify({ ok: true, clinic }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const legacy = await env.SETTINGS.get(`clinic:${name}`);
    if (legacy) {
      let obj = {};
      try { obj = JSON.parse(legacy) || {}; } catch(_) {}
      if (!obj.name) obj.name = name;
      obj.mhlwFacilityId = obj.mhlwFacilityId || mhlwFacilityId;
      const migrated = await saveClinic(env, obj);
      return new Response(JSON.stringify({ ok: true, clinic: migrated, migrated: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let clinic;
    try {
      clinic = await saveClinic(env, { name, mhlwFacilityId });
    } catch (err) {
      if (err?.code === 'MHLW_FACILITY_ID_CONFLICT') {
        return new Response(JSON.stringify({ error: 'MHLW_FACILITY_ID_CONFLICT', message: 'この厚生労働省施設IDは既に登録済みです。' }), {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      throw err;
    }

    return new Response(JSON.stringify({ ok: true, clinic }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    if (err?.code === 'MHLW_FACILITY_ID_CONFLICT') {
      return new Response(JSON.stringify({ error: 'MHLW_FACILITY_ID_CONFLICT', message: 'この厚生労働省施設IDは既に登録済みです。' }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    return new Response("Error: " + err.message, { status: 500, headers: corsHeaders });
  }
}
// <<< END: CLINIC_REGISTER >>>

    // <<< START: CLINIC_LIST >>>
if (routeMatch(url, "GET", "listClinics")) {
  // まず新形式の件数を確認
  const idKeys = await env.SETTINGS.list({ prefix: "clinic:id:" });
  // 新形式がゼロなら、旧形式をスキャンして自動移行
  if ((idKeys.keys || []).length === 0) {
    const legacyKeys = await env.SETTINGS.list({ prefix: "clinic:" });
    for (const k of legacyKeys.keys) {
      const key = k.name;
      // 旧形式の本体のみ対象（インデックスは除外）
      if (key.startsWith("clinic:id:")) continue;
      if (key.startsWith("clinic:name:")) continue;

      const val = await env.SETTINGS.get(key);
      if (!val) continue;
      let obj = null;
      try { obj = JSON.parse(val); } catch(_) { obj = null; }
      if (!obj || typeof obj !== "object") continue;

      // name が無ければキーから復元
      if (!obj.name && key.startsWith("clinic:")) {
        obj.name = key.substring("clinic:".length);
      }
      if (!obj.name) continue;

      // idが無い旧データを新形式へ保存（id付与＋索引作成）
      await saveClinic(env, obj);
      // 旧キーは互換のため残す（すぐに消さない）
      // ※完全に整理したい場合はここで env.SETTINGS.delete(key) しても良い
    }
  }

  // 最終的に新形式から一覧を取得
  const { items } = await listClinicsKV(env, { limit: 2000, offset: 0 });
  return new Response(JSON.stringify({ ok: true, clinics: items }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
// <<< END: CLINIC_LIST >>>

    // ============================================================
    // <<< START: CLINIC_DETAIL >>>
    // ============================================================
    if (routeMatch(url, "GET", "clinicDetail")) {
      const idParam = (url.searchParams.get("id") || "").trim();
      const nameParam = nk(url.searchParams.get("name"));
      if (!idParam && !nameParam) {
        return new Response(JSON.stringify({ error: "id または name が必要です" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let clinic = null;
      if (idParam) {
        clinic = await getClinicById(env, idParam);
      }
      if (!clinic && nameParam) {
        clinic = await getClinicByName(env, nameParam);
      }
      if (clinic && !clinic.id && clinic.name) {
        clinic = await saveClinic(env, { ...clinic, name: clinic.name });
      }

      if (!clinic) {
        return new Response(JSON.stringify({ ok: false, error: "clinic not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: true, clinic }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // <<< END: CLINIC_DETAIL >>>

    // <<< START: CLINIC_UPDATE >>>
    if (routeMatch(url, "POST", "updateClinic")) {
      try {
        const body = await request.json();
        const clinicIdParam = nk(body?.id || body?.clinicId);
        const name = nk(body?.name);
        if (!clinicIdParam && !name) {
          return new Response(JSON.stringify({ error: "診療所名が必要です" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        let clinicData = null;
        if (clinicIdParam) {
          clinicData = await getClinicById(env, clinicIdParam);
        }
        if (!clinicData && name) {
          clinicData = await getClinicByName(env, name) || {};
        }
        const baseClinicData = (clinicData && typeof clinicData === 'object') ? clinicData : {};
        clinicData = { ...baseClinicData, ...body };
        if (name) clinicData.name = name;
        if (clinicIdParam) clinicData.id = clinicIdParam;
        if (body?.mhlwFacilityId || body?.facilityId || body?.mhlwId) {
          clinicData.mhlwFacilityId = normalizeMhlwFacilityId(body.mhlwFacilityId || body.facilityId || body.mhlwId);
        }
        if (Object.prototype.hasOwnProperty.call(body, 'mhlwManualNote')) {
          if (body.mhlwManualNote === null) {
            clinicData.mhlwManualNote = null;
          } else if (typeof body.mhlwManualNote === 'string') {
            clinicData.mhlwManualNote = body.mhlwManualNote;
          }
        }
        const requestedStatus = nk(body?.mhlwSyncStatus);
        if (requestedStatus) {
          const normalizedStatus = requestedStatus.toLowerCase();
          if (MHLW_SYNC_STATUSES.has(normalizedStatus)) {
            clinicData.mhlwSyncStatus = normalizedStatus;
          }
        }
        let saved;
        try {
          saved = await saveClinic(env, clinicData);
        } catch (err) {
          if (err?.code === 'MHLW_FACILITY_ID_CONFLICT') {
            return new Response(JSON.stringify({ error: 'MHLW_FACILITY_ID_CONFLICT', message: 'この厚生労働省施設IDは既に登録済みです。' }), {
              status: 409,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
          console.error('[updateClinic] saveClinic failed', { clinicIdParam, name, body }, err);
          throw err;
        }
        return new Response(JSON.stringify({ ok: true, clinic: saved }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        if (err?.code === 'MHLW_FACILITY_ID_CONFLICT') {
          return new Response(JSON.stringify({ error: 'MHLW_FACILITY_ID_CONFLICT', message: 'この厚生労働省施設IDは既に登録済みです。' }), {
            status: 409,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        console.error('[updateClinic] unexpected error', err);
        return new Response("Error: " + err.message, { status: 500, headers: corsHeaders });
      }
    }

    if (routeMatch(url, 'POST', 'admin/clinic/syncFromMhlw')) {
      const authContext = await authenticateRequest(request, env);
      if (!authContext) {
        return jsonResponse({ error: 'UNAUTHORIZED', message: '認証が必要です。' }, 401);
      }
      if (!hasRole(authContext.payload, SYSTEM_ROOT_ONLY)) {
        return jsonResponse({ error: 'FORBIDDEN', message: '権限が不足しています。' }, 403);
      }
      let body;
      try {
        body = await request.json();
      } catch (err) {
        return jsonResponse({ error: 'INVALID_JSON', message: 'リクエスト形式が不正です。' }, 400);
      }
      const facilityId = normalizeMhlwFacilityId(body?.facilityId);
      if (!facilityId) {
        return jsonResponse({ error: 'INVALID_REQUEST', message: '厚労省施設IDを指定してください。' }, 400);
      }
      let clinic = null;
      if (body?.clinicId) {
        clinic = await getClinicById(env, body.clinicId);
      }
      if (!clinic) {
        clinic = await getClinicByMhlwFacilityId(env, facilityId);
      }
      if (!clinic) {
        return jsonResponse({ error: 'CLINIC_NOT_FOUND', message: '対象診療所が見つかりません。先に厚労省IDを登録してください。' }, 404);
      }
      const facilityData = body?.facilityData;
      if (!facilityData || normalizeMhlwFacilityId(facilityData.facilityId) !== facilityId) {
        return jsonResponse({ error: 'INVALID_REQUEST', message: 'facilityData が不足しているか、施設IDが一致しません。' }, 400);
      }
      let updatedClinic;
      try {
        updatedClinic = applyMhlwDataToClinic(clinic, facilityData);
        updatedClinic = await saveClinic(env, updatedClinic);
      } catch (err) {
        if (err?.code === 'MHLW_FACILITY_ID_CONFLICT') {
          return jsonResponse({ error: 'MHLW_FACILITY_ID_CONFLICT', message: 'この厚生労働省施設IDは既に別の診療所に割り当てられています。' }, 409);
        }
        console.error('[mhlwSync] failed to save clinic', err);
        return jsonResponse({ error: 'SERVER_ERROR', message: '厚労省データの同期に失敗しました。' }, 500);
      }
      return jsonResponse({ ok: true, clinic: updatedClinic });
    }
    // <<< END: CLINIC_UPDATE >>>

    // <<< START: CLINIC_EXPORT >>>
    if (routeMatch(url, "GET", "exportClinics")) {
      const format = (url.searchParams.get("format") || "json").toLowerCase();
      const limit = parseInt(url.searchParams.get("limit") || "500", 10);
      const offset = parseInt(url.searchParams.get("offset") || "0", 10);
      const { items, total } = await listClinicsKV(env, { limit, offset });

      if (format === "csv") {
        const header = [
          "id","name","address",
          "doctors.fulltime","doctors.parttime","doctors.qualifications",
          "schema_version","created_at","updated_at"
        ].join(",");
        const rows = items.map(o => [
          o.id||"", o.name||"", o.address||"",
          o.doctors?.fulltime ?? "", o.doctors?.parttime ?? "", (o.doctors?.qualifications||""),
          o.schema_version ?? "", o.created_at ?? "", o.updated_at ?? ""
        ].map(x => `"${String(x).replace(/"/g,'""')}"`).join(","));
        return new Response([header, ...rows].join("\n"), {
          headers: { ...corsHeaders, "Content-Type":"text/csv; charset=utf-8" }
        });
      }
      return new Response(JSON.stringify({ ok:true, total, items }), {
        headers: { ...corsHeaders, "Content-Type":"application/json" }
      });
    }
    // <<< END: CLINIC_EXPORT >>>

    // <<< START: CLINIC_DELETE >>>
    if (routeMatch(url, "POST", "deleteClinic")) {
      try {
        const body = await request.json();
        const id = nk(body?.id);
        const name = nk(body?.name);

        let target = null;
        if (id) {
          target = await env.SETTINGS.get(`clinic:id:${id}`);
        } else if (name) {
          const idx = await env.SETTINGS.get(`clinic:name:${name}`);
          if (idx) target = await env.SETTINGS.get(`clinic:id:${idx}`);
          if (!target) target = await env.SETTINGS.get(`clinic:${name}`); // 互換
        }
        if (!target) {
          return new Response(JSON.stringify({ error: "対象が見つかりません" }), {
            status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const obj = JSON.parse(target);
        const _id = obj.id;
        const _name = obj.name;

        if (hasFacilitiesD1(env) && _id) {
          await env.MASTERS_D1.prepare('DELETE FROM facilities WHERE id = ?').bind(_id).run().catch((err) => {
            console.error('[clinic] failed to delete facility from D1', err);
          });
        }
        if (_id) await env.SETTINGS.delete(`clinic:id:${_id}`);
        if (_name) {
          await env.SETTINGS.delete(`clinic:name:${_name}`);
          await env.SETTINGS.delete(`clinic:${_name}`); // 旧互換キー
        }
        if (obj?.mhlwFacilityId) {
          const normalizedId = normalizeMhlwFacilityId(obj.mhlwFacilityId);
          if (normalizedId) {
            await env.SETTINGS.delete(`clinic:mhlw:${normalizedId}`).catch(() => {});
          }
        }

        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        return new Response("Error: " + err.message, { status: 500, headers: corsHeaders });
      }
    }
    // <<< END: CLINIC_DELETE >>>

    // ============================================================
    // マスター収集・管理API（検査/診療）
    // ============================================================

    // <<< START: MASTER_ADD >>>
    if (routeMatch(url, "POST", "addMasterItem")) {
      try {
        const body = await request.json();
        const { type, category, name, desc, source, status, referenceUrl } = body || {};
        if (!type || !category || !name) {
          return new Response(JSON.stringify({ error: "type, category, name は必須です" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (!MASTER_ALLOWED_TYPES.has(type)) {
          return new Response(JSON.stringify({ error: `type は ${MASTER_TYPE_HELP_TEXT}` }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const normalizedCategory = nk(category);
        const normalizedName = nk(name);
        const { record } = await getOrCreateMasterRecord(env, { type, category: normalizedCategory, name: normalizedName }, { ctx });
        const now = Math.floor(Date.now() / 1000);

        record.category = normalizedCategory;
        record.name = normalizedName;
        record.legacyKey = normalizeKey(type, normalizedCategory, normalizedName);
        ensureLegacyAlias(record, record.legacyKey);

        record.count = Number(record.count || 0) + 1;
        record.updated_at = now;
        if (!record.created_at) {
          record.created_at = now;
        }

        const classification = nk(body?.classification);
        const notes = nk(body?.notes);
        const medicalField = nk(body?.medicalField);
        const sanitizedReferenceUrl = sanitizeUrl(referenceUrl ?? body?.reference_url);

        if (type === 'qual') {
          const fallback = record.classification || classification || PERSONAL_QUAL_CLASSIFICATIONS[0];
          record.classification = classification || fallback;
        } else if (classification) {
          record.classification = classification;
        }

        if (type === 'society') {
          if (medicalField) {
            record.medicalField = medicalField;
          } else if (!record.medicalField) {
            record.medicalField = null;
          }
        }

        if (status && ["candidate", "approved", "archived"].includes(status)) {
          record.status = status;
        }

        normalizeItemExplanations(record, { fallbackStatus: record.status === 'approved' ? 'published' : 'draft' });

        if (desc) {
          record.desc_samples = Array.from(new Set([desc, ...(record.desc_samples || [])])).slice(0, 5);
          record.desc = desc;
          addExplanationToItem(record, {
            text: desc,
            status: record.status === 'approved' ? 'published' : 'draft',
            source,
          });
        }
        if (source) {
          record.sources = Array.from(new Set([...(record.sources || []), source]));
        }

        if (notes) {
          record.notes = notes;
          record.desc = notes;
        } else if (record.desc && !record.notes) {
          record.notes = record.desc;
        }

        if (referenceUrl !== undefined || body?.reference_url !== undefined || sanitizedReferenceUrl) {
          record.referenceUrl = sanitizedReferenceUrl;
        }

        if (typeof body?.canonical_name === 'string') {
          record.canonical_name = optionalString(body.canonical_name);
        }
        if (Object.prototype.hasOwnProperty.call(body || {}, 'sortGroup')) {
          const trimmed = optionalString(body.sortGroup);
          record.sortGroup = trimmed;
        }
        if (Object.prototype.hasOwnProperty.call(body || {}, 'sortOrder')) {
          const num = Number(body.sortOrder);
          record.sortOrder = Number.isFinite(num) ? num : null;
        }

        if (type === 'symptom') {
          if (Object.prototype.hasOwnProperty.call(body, 'patientLabel')) {
            record.patientLabel = optionalString(body.patientLabel);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'bodySiteRefs')) {
            record.bodySiteRefs = normalizeStringArray(body.bodySiteRefs);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'severityTags')) {
            record.severityTags = normalizeStringArray(body.severityTags);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'icd10')) {
            record.icd10 = normalizeStringArray(body.icd10).map(code => code.toUpperCase());
          }
          if (Object.prototype.hasOwnProperty.call(body, 'synonyms')) {
            record.synonyms = normalizeStringArray(body.synonyms);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'defaultServices')) {
            record.defaultServices = normalizeStringArray(body.defaultServices);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'defaultTests')) {
            record.defaultTests = normalizeStringArray(body.defaultTests);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'thesaurusRefs')) {
            record.thesaurusRefs = normalizeStringArray(body.thesaurusRefs);
          }
        }

        if (type === 'bodySite') {
          if (Object.prototype.hasOwnProperty.call(body, 'anatomicalSystem')) {
            record.anatomicalSystem = optionalString(body.anatomicalSystem);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'patientLabel')) {
            record.patientLabel = optionalString(body.patientLabel);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'canonical_name')) {
            record.canonical_name = optionalString(body.canonical_name);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'parentKey')) {
            record.parentKey = optionalString(body.parentKey);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'laterality')) {
            record.laterality = optionalString(body.laterality);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'aliases')) {
            record.aliases = normalizeStringArray(body.aliases);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'thesaurusRefs')) {
            record.thesaurusRefs = normalizeStringArray(body.thesaurusRefs);
          }
        }

        syncExplanationDerivedFields(record);

        await writeMasterRecord(env, type, record, { ctx });
        if (ctx?.waitUntil) ctx.waitUntil(invalidateMasterCache(env, type));
        else await invalidateMasterCache(env, type);
        return new Response(JSON.stringify({ ok: true, item: record }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        return new Response("Error: " + err.message, { status: 500, headers: corsHeaders });
      }
    }
    // <<< END: MASTER_ADD >>>

    // <<< START: MASTER_LIST >>>
    if (routeMatch(url, "GET", "listMaster")) {
      try {
        const type = url.searchParams.get("type");
        const status = url.searchParams.get("status");
        const includeSimilar = url.searchParams.get("includeSimilar") === "true";
        let items = await getMasterCache(env, type, status);
        if (!items) {
          const typesToLoad = type ? [type] : Array.from(MASTER_ALLOWED_TYPES);
          const aggregated = [];
          for (const t of typesToLoad) {
            const subset = await listMasterItemsD1(env, { type: t, status });
            aggregated.push(...subset);
          }
          items = aggregated;
          await setMasterCache(env, type, status, aggregated);
        }
        items = items.map(item => ({ ...item }));

        const collator = new Intl.Collator('ja');
        items.sort((a, b) => {
          const ao = typeof a.sortOrder === 'number' ? a.sortOrder : Number.MAX_SAFE_INTEGER;
          const bo = typeof b.sortOrder === 'number' ? b.sortOrder : Number.MAX_SAFE_INTEGER;
          if (ao !== bo) return ao - bo;
          const ag = a.sortGroup || '';
          const bg = b.sortGroup || '';
          const gcmp = collator.compare(ag, bg);
          if (gcmp !== 0) return gcmp;
          return collator.compare(a.name || '', b.name || '');
        });

        if (includeSimilar && items.length > 1) {
          const collected = items.map(obj => ({ obj, norm: normalizeForSimilarity(obj.canonical_name || obj.name) }));
          for (const entry of collected) {
            if (!entry.norm) continue;
            const matches = [];
            for (const other of collected) {
              if (entry === other) continue;
              if (!other.norm) continue;
              const score = jaroWinkler(entry.norm, other.norm);
              if (score >= 0.92) {
                matches.push({
                  name: other.obj.name,
                  canonical_name: other.obj.canonical_name || null,
                  status: other.obj.status || null,
                  similarity: Number(score.toFixed(3)),
                });
              }
            }
            if (matches.length) {
              entry.obj.similarMatches = matches;
            } else {
              delete entry.obj.similarMatches;
            }
          }
        }

        items.sort((a, b) => (b.count || 0) - (a.count || 0));
        return new Response(JSON.stringify({ ok: true, items }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message || "failed to load master data" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    // <<< END: MASTER_LIST >>>

    // <<< START: MASTER_UPDATE >>>
    if (routeMatch(url, "POST", "updateMasterItem")) {
      try {
        const body = await request.json();
        const {
          id,
          type: bodyType,
          category,
          name,
          status,
          canonical_name,
          sortGroup,
          sortOrder,
          newCategory,
          newName,
          desc,
          notes,
          classification,
          medicalField,
          referenceUrl,
        } = body || {};

        if (!id && (!bodyType || !category || !name)) {
          return new Response(JSON.stringify({ error: "id または type/category/name を指定してください" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (bodyType && !MASTER_ALLOWED_TYPES.has(bodyType)) {
          return new Response(JSON.stringify({ error: `type は ${MASTER_TYPE_HELP_TEXT}` }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        let record = null;
        let type = bodyType || null;
        if (id) {
          record = await getMasterItemByIdD1(env, id);
          if (!record && bodyType && category && name) {
            const legacyKeyFallback = normalizeKey(bodyType, category, name);
            record = await getMasterRecordByLegacy(env, bodyType, legacyKeyFallback, { category, name });
          }
        } else if (bodyType && category && name) {
          const legacyKeyCurrent = normalizeKey(bodyType, category, name);
          record = await getMasterRecordByLegacy(env, bodyType, legacyKeyCurrent, { category, name });
        }

        if (!record) {
          return new Response(JSON.stringify({ error: "対象が見つかりません" }), {
            status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        type = record.type || type || bodyType;
        if (!type || !MASTER_ALLOWED_TYPES.has(type)) {
          return new Response(JSON.stringify({ error: `type は ${MASTER_TYPE_HELP_TEXT}` }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const legacyKeyCurrent = record.legacyKey || normalizeKey(type, category || record.category, name || record.name);

        const now = Math.floor(Date.now() / 1000);
        const targetCategory = nk(newCategory) || nk(category);
        const targetName = nk(newName) || nk(name);
        record.category = targetCategory;
        record.name = targetName;
        record.legacyKey = normalizeKey(type, targetCategory, targetName);
        ensureLegacyAlias(record, record.legacyKey);

        if (status) {
          record.status = status;
        }
        if (typeof canonical_name === 'string') {
          record.canonical_name = canonical_name || null;
        }
        if (typeof sortGroup === 'string') {
          const trimmed = sortGroup.trim();
          record.sortGroup = trimmed || null;
        }
        if (Object.prototype.hasOwnProperty.call(body, 'sortOrder')) {
          const num = Number(sortOrder);
          record.sortOrder = Number.isFinite(num) ? num : null;
        }
        if (typeof desc === 'string') {
          record.desc = desc;
          if (desc) {
            record.desc_samples = Array.from(new Set([desc, ...(record.desc_samples || [])])).slice(0, 5);
            addExplanationToItem(record, {
              text: desc,
              status: record.status === 'approved' ? 'published' : 'draft',
            });
          } else if (Array.isArray(record.desc_samples) && record.desc_samples.length && !record.desc) {
            record.desc = record.desc_samples[0];
          }
        }
        if (typeof notes === 'string') {
          const trimmedNotes = notes.trim();
          record.notes = trimmedNotes || null;
          if (!desc && trimmedNotes) {
            record.desc = trimmedNotes;
          }
        }
        if (Object.prototype.hasOwnProperty.call(body || {}, 'referenceUrl') || Object.prototype.hasOwnProperty.call(body || {}, 'reference_url')) {
          const sanitizedReferenceUrl = sanitizeUrl(referenceUrl ?? body?.reference_url);
          record.referenceUrl = sanitizedReferenceUrl;
        }
        if (typeof classification === 'string') {
          const trimmedClass = classification.trim();
          if (trimmedClass) {
            record.classification = trimmedClass;
          } else if (record.type === 'qual') {
            record.classification = PERSONAL_QUAL_CLASSIFICATIONS[0];
          } else {
            record.classification = null;
          }
        }
        if (Object.prototype.hasOwnProperty.call(body, 'medicalField')) {
          const trimmedField = typeof medicalField === 'string' ? medicalField.trim() : '';
          record.medicalField = trimmedField || null;
        }

        if (Array.isArray(body?.explanations)) {
          const fallbackStatus = record.status === 'approved' ? 'published' : 'draft';
          const next = [];
          const seenText = new Set();
          const existingMap = new Map();
          if (Array.isArray(record.explanations)) {
            for (const entry of record.explanations) {
              const sanitized = sanitizeExistingExplanation(entry, fallbackStatus);
              if (sanitized) {
                existingMap.set(sanitized.id, sanitized);
              }
            }
          }

          for (const entry of body.explanations) {
            if (!entry || typeof entry !== 'object') continue;
            const base = entry.id && existingMap.get(entry.id) ? existingMap.get(entry.id) : null;
            const merged = sanitizeExistingExplanation({
              ...(base || {}),
              id: entry.id || base?.id,
              text: entry.text || entry.baseText || entry.desc || base?.text,
              status: entry.status || base?.status || fallbackStatus,
              audience: entry.audience ?? base?.audience ?? null,
              context: entry.context ?? base?.context ?? null,
              source: entry.source ?? base?.source ?? null,
              createdAt: entry.createdAt ?? base?.createdAt,
              updatedAt: entry.updatedAt ?? base?.updatedAt,
            }, fallbackStatus);
            if (!merged) continue;
            if (base && base.createdAt && !Number.isFinite(Number(entry.createdAt))) {
              merged.createdAt = base.createdAt;
            }
            if (!Number.isFinite(Number(merged.createdAt))) {
              merged.createdAt = Math.floor(Date.now() / 1000);
            }
            if (!Number.isFinite(Number(merged.updatedAt))) {
              merged.updatedAt = Math.floor(Date.now() / 1000);
            }
            if (seenText.has(merged.text)) {
              continue;
            }
            seenText.add(merged.text);
            next.push(merged);
          }

          record.explanations = next;
        }

        if (type === 'symptom') {
          if (Object.prototype.hasOwnProperty.call(body, 'patientLabel')) {
            record.patientLabel = optionalString(body.patientLabel);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'bodySiteRefs')) {
            record.bodySiteRefs = normalizeStringArray(body.bodySiteRefs);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'severityTags')) {
            record.severityTags = normalizeStringArray(body.severityTags);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'icd10')) {
            record.icd10 = normalizeStringArray(body.icd10).map(code => code.toUpperCase());
          }
          if (Object.prototype.hasOwnProperty.call(body, 'synonyms')) {
            record.synonyms = normalizeStringArray(body.synonyms);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'defaultServices')) {
            record.defaultServices = normalizeStringArray(body.defaultServices);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'defaultTests')) {
            record.defaultTests = normalizeStringArray(body.defaultTests);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'thesaurusRefs')) {
            record.thesaurusRefs = normalizeStringArray(body.thesaurusRefs);
          }
        }

        if (type === 'bodySite') {
          if (Object.prototype.hasOwnProperty.call(body, 'anatomicalSystem')) {
            record.anatomicalSystem = optionalString(body.anatomicalSystem);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'patientLabel')) {
            record.patientLabel = optionalString(body.patientLabel);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'canonical_name')) {
            record.canonical_name = optionalString(body.canonical_name);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'parentKey')) {
            record.parentKey = optionalString(body.parentKey);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'laterality')) {
            record.laterality = optionalString(body.laterality);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'aliases')) {
            record.aliases = normalizeStringArray(body.aliases);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'thesaurusRefs')) {
            record.thesaurusRefs = normalizeStringArray(body.thesaurusRefs);
          }
        }

        syncExplanationDerivedFields(record);
        record.updated_at = now;
        if (!record.created_at) {
          record.created_at = now;
        }

        const skipLegacyPointers = record.legacyKey === legacyKeyCurrent;
        await writeMasterRecord(env, type, record, { skipLegacyPointers, ctx });
        if (ctx?.waitUntil) {
          ctx.waitUntil(invalidateMasterCache(env, type));
        } else {
          await invalidateMasterCache(env, type);
        }
        return new Response(JSON.stringify({ ok: true, item: record }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        return new Response("Error: " + err.message, { status: 500, headers: corsHeaders });
      }
    }
    // <<< END: MASTER_UPDATE >>>

    if (routeMatch(url, "POST", "master/addExplanation")) {
      try {
        const payload = await request.json();
        const { type, category, name, text, status, audience, context, source } = payload || {};
        if (!type || !category || !name) {
          return new Response(JSON.stringify({ ok: false, error: "type, category, name は必須です" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (!MASTER_ALLOWED_TYPES.has(type)) {
          return new Response(JSON.stringify({ ok: false, error: `type は ${MASTER_TYPE_HELP_TEXT}` }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const record = await getMasterRecordByLegacy(env, type, normalizeKey(type, category, name), { category, name });
        if (!record) {
          return new Response(JSON.stringify({ ok: false, error: "対象が見つかりません" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const defaultStatus = record.status === 'approved' ? 'published' : 'draft';
        const entry = addExplanationToItem(record, {
          text,
          status: status || defaultStatus,
          audience,
          context,
          source,
        }, { defaultStatus });
        if (!entry) {
          return new Response(JSON.stringify({ ok: false, error: "説明本文が必要です" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        record.updated_at = Math.floor(Date.now() / 1000);
        syncExplanationDerivedFields(record);

        await writeMasterRecord(env, type, record, { ctx });
        if (ctx?.waitUntil) ctx.waitUntil(invalidateMasterCache(env, type));
        else await invalidateMasterCache(env, type);

        const sanitizedEntry = sanitizeExistingExplanation(entry, defaultStatus);
        return new Response(JSON.stringify({ ok: true, explanation: sanitizedEntry, item: record }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: err.message || "unexpected error" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // <<< START: MASTER_DELETE >>>
    if (routeMatch(url, "POST", "deleteMasterItem")) {
      try {
        const body = await request.json();
        const { id, type: bodyType, category, name } = body || {};
        if (!id && (!bodyType || !category || !name)) {
          return new Response(JSON.stringify({ error: "id または type/category/name を指定してください" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (bodyType && !MASTER_ALLOWED_TYPES.has(bodyType)) {
          return new Response(JSON.stringify({ error: `type は ${MASTER_TYPE_HELP_TEXT}` }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        let record = null;
        let type = bodyType || null;
        if (id) {
          record = await getMasterItemByIdD1(env, id);
          if (!record && bodyType && category && name) {
            const legacyKeyFallback = normalizeKey(bodyType, category, name);
            record = await getMasterRecordByLegacy(env, bodyType, legacyKeyFallback, { category, name });
          }
        } else if (bodyType && category && name) {
          const legacyKeyCurrent = normalizeKey(bodyType, category, name);
          record = await getMasterRecordByLegacy(env, bodyType, legacyKeyCurrent, { category, name });
        }
        if (!record) {
          return new Response(JSON.stringify({ error: "対象が見つかりません" }), {
            status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        type = record.type || type || bodyType;
        if (!type || !MASTER_ALLOWED_TYPES.has(type)) {
          return new Response(JSON.stringify({ error: `type は ${MASTER_TYPE_HELP_TEXT}` }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        try {
          await deleteMasterItemD1(env, { id: record.id });
        } catch (err) {
          console.warn('[masterStore] failed to delete master item in D1', err);
        }
        await env.SETTINGS.delete(masterIdKey(type, record.id));
        if (Array.isArray(record.legacyAliases)) {
          await Promise.all(record.legacyAliases.map(alias => env.SETTINGS.delete(alias).catch(() => {})));
        } else {
          const legacyKeyCurrent = record.legacyKey || (type && category && name ? normalizeKey(type, category, name) : null);
          if (legacyKeyCurrent) {
            await env.SETTINGS.delete(legacyKeyCurrent).catch(() => {});
          }
        }
        if (ctx?.waitUntil) ctx.waitUntil(invalidateMasterCache(env, type));
        else await invalidateMasterCache(env, type);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        return new Response("Error: " + err.message, { status: 500, headers: corsHeaders });
      }
    }
    // <<< END: MASTER_DELETE >>>

    // <<< START: MASTER_EXPORT >>>
    if (routeMatch(url, "GET", "exportMaster")) {
      try {
        const type = url.searchParams.get("type"); // 任意
        const format = (url.searchParams.get("format") || "json").toLowerCase();
        if (type && !MASTER_ALLOWED_TYPES.has(type)) {
          return new Response(JSON.stringify({ ok: false, error: "unknown master type" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const typesToLoad = type ? [type] : Array.from(MASTER_ALLOWED_TYPES);
        let items = [];
        for (const t of typesToLoad) {
          const subset = await loadMastersByType(env, t);
          items = items.concat(subset);
        }

        if (format === "csv") {
          const header = ["分類","名称","説明"].join(",");
          const rows = items.map(o =>
            [o.category, o.name, o.desc || ""]
              .map(x => `"${String(x ?? '').replace(/"/g,'""')}"`).join(",")
          );
          return new Response([header, ...rows].join("\n"), {
            headers: { ...corsHeaders, "Content-Type":"text/csv; charset=utf-8" }
          });
        }

        return new Response(JSON.stringify({ ok: true, items }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: err.message || "failed to export master data" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    // <<< END: MASTER_EXPORT >>>

    if (routeMatch(url, 'POST', 'maintenance/masterCleanup')) {
      try {
        let body = {};
        try {
          body = await request.json();
        } catch (_) {}
        let types = Array.isArray(body?.types) ? body.types.filter(t => MASTER_ALLOWED_TYPES.has(t)) : [];
        if (!types.length) {
          types = MASTER_TYPE_LIST.slice();
        }
        const dryRun = body?.dryRun !== false && body?.dryRun !== 'false';
        const batchSizeRaw = Number(body?.batchSize);
        const batchSize = Number.isFinite(batchSizeRaw) && batchSizeRaw > 0 ? Math.min(batchSizeRaw, 1000) : 1000;
        const includeKeys = body?.includeKeys === true;
        const maxKeysPerTypeRaw = Number(body?.maxKeysPerType);
        const maxKeysPerType = Number.isFinite(maxKeysPerTypeRaw) && maxKeysPerTypeRaw > 0
          ? Math.min(Math.floor(maxKeysPerTypeRaw), 5000)
          : 200;
        const summary = await cleanupLegacyMasterKeys(env, types, {
          dryRun,
          batchSize,
          includeKeys,
          maxKeysPerType,
        });
        return new Response(JSON.stringify({ ok: true, summary }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: err.message || 'unexpected error' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // ============================================================
    // 分類マスター（検査/診療 別管理）
    // ============================================================

    const DEFAULT_CATEGORIES_TEST = [
      "内科一般検査","循環器検査","呼吸器検査","消化器検査","内分泌・代謝検査",
      "腎臓・泌尿器検査","神経内科系検査","整形外科系検査","皮膚科検査","アレルギー検査",
      "小児科検査","耳鼻咽喉科検査","眼科検査","産婦人科検査","精神科・心理検査",
      "在宅医療関連検査","健診・予防関連検査"
    ];
    const DEFAULT_CATEGORIES_SERVICE = [
      "内科一般","循環器","呼吸器","消化器","内分泌・代謝（糖尿病等）",
      "腎臓","神経内科","整形外科","皮膚科","アレルギー科",
      "小児科","耳鼻咽喉科","眼科","泌尿器科","精神科・心療内科",
      "在宅医療・訪問診療","リハビリテーション","健診・予防接種","禁煙外来","睡眠医療"
    ];
    const DEFAULT_CATEGORIES_QUAL = [
      "内科基盤","総合診療領域","循環器領域","呼吸器領域","消化器領域","内分泌・代謝領域",
      "腎臓領域","血液領域","神経領域","感染症領域","アレルギー・膠原病領域",
      "小児科領域","産婦人科領域","皮膚科領域","眼科領域","耳鼻咽喉科領域","精神科領域",
      "外科領域","心臓血管外科領域","整形外科領域","脳神経外科領域","泌尿器領域",
      "放射線科領域","麻酔科領域","病理領域","臨床検査領域","リハビリテーション領域"
    ];
    const DEFAULT_CATEGORIES_DEPARTMENT = ["標榜診療科"];
    const DEFAULT_CATEGORIES_FACILITY = ["学会認定","行政・公費","地域・在宅"];
    const DEFAULT_CATEGORIES_SYMPTOM = [
      "消化器症状","呼吸器症状","循環器症状","内分泌・代謝症状","神経症状","整形外科症状","皮膚症状","耳鼻咽喉症状","眼科症状","泌尿器症状","産婦人科症状","小児科症状","精神・心理症状"
    ];
    const DEFAULT_CATEGORIES_BODYSITE = [
      "頭頸部","胸部","腹部","骨盤","背部","上肢","下肢","皮膚","体幹","全身"
    ];

    async function getCategories(env, type) {
      if (!type) return [];
      const d1Cats = await listMasterCategoriesD1(env, { type });
      if (Array.isArray(d1Cats)) {
        return d1Cats;
      }
      return [];
    }
    async function putCategories(env, type, arr) {
      const list = Array.isArray(arr) ? arr : [];
      await replaceMasterCategoriesD1(env, { type, categories: list });
      const key = `categories:${type}`;
      await env.SETTINGS.put(key, JSON.stringify(list));
      return list;
    }
    function defaultsFor(type){
      switch(type){
        case "test": return [...DEFAULT_CATEGORIES_TEST];
        case "service": return [...DEFAULT_CATEGORIES_SERVICE];
        case "qual": return [...DEFAULT_CATEGORIES_QUAL];
        case "department": return [...DEFAULT_CATEGORIES_DEPARTMENT];
        case "facility": return [...DEFAULT_CATEGORIES_FACILITY];
        case "symptom": return [...DEFAULT_CATEGORIES_SYMPTOM];
        case "bodySite": return [...DEFAULT_CATEGORIES_BODYSITE];
        case "vaccinationType":
        case "checkupType":
          return [];
        default: return [];
      }
    }

    // <<< START: CATEGORIES_LIST >>>
    if (routeMatch(url, "GET", "listCategories")) {
      try {
        const type = url.searchParams.get("type");
        if (!type || !CATEGORY_ALLOWED_TYPES.includes(type)) {
          return new Response(JSON.stringify({ error: `type は ${CATEGORY_TYPE_HELP_TEXT}` }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        let cats = await getCategories(env, type);
        if (!Array.isArray(cats) || !cats.length) {
          cats = defaultsFor(type);
          if (cats.length) {
            await putCategories(env, type, cats);
          }
        }

        return new Response(JSON.stringify({ ok: true, categories: cats }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message || 'カテゴリー取得に失敗しました' }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    // <<< END: CATEGORIES_LIST >>>

    // <<< START: CATEGORIES_ADD >>>
    if (routeMatch(url, "POST", "addCategory")) {
      try {
        const body = await request.json();
        const type = body?.type;
        const name = (body?.name || "").trim();
        if (!type || !MASTER_ALLOWED_TYPES.has(type) && !CATEGORY_ALLOWED_TYPES.includes(type) || !name) {
          return new Response(JSON.stringify({ error: `type/name 不正（type は ${CATEGORY_TYPE_HELP_TEXT}）` }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        const cats = (await getCategories(env, type)) || [];
        if (!cats.includes(name)) cats.push(name);
        await putCategories(env, type, cats);
        return new Response(JSON.stringify({ ok:true, categories: cats }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message || 'カテゴリー追加に失敗しました' }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    // <<< END: CATEGORIES_ADD >>>

    // <<< START: CATEGORIES_RENAME >>>
    if (routeMatch(url, "POST", "renameCategory")) {
      try {
        const body = await request.json();
        const type = body?.type;
        const oldName = (body?.oldName || "").trim();
        const newName = (body?.newName || "").trim();
        if (!type || !MASTER_ALLOWED_TYPES.has(type) && !CATEGORY_ALLOWED_TYPES.includes(type) || !oldName || !newName) {
          return new Response(JSON.stringify({ error: `パラメータ不正（type は ${CATEGORY_TYPE_HELP_TEXT}）` }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        let cats = (await getCategories(env, type)) || [];
        cats = cats.map(c => c === oldName ? newName : c);
        await putCategories(env, type, cats);
        return new Response(JSON.stringify({ ok:true, categories: cats }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message || 'カテゴリー更新に失敗しました' }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    // <<< END: CATEGORIES_RENAME >>>

    // <<< START: CATEGORIES_DELETE >>>
    if (routeMatch(url, "POST", "deleteCategory")) {
      try {
        const body = await request.json();
        const type = body?.type;
        const name = (body?.name || "").trim();
        if (!type || !MASTER_ALLOWED_TYPES.has(type) && !CATEGORY_ALLOWED_TYPES.includes(type) || !name) {
          return new Response(JSON.stringify({ error: `パラメータ不正（type は ${CATEGORY_TYPE_HELP_TEXT}）` }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        let cats = (await getCategories(env, type)) || [];
        cats = cats.filter(c => c !== name);
        await putCategories(env, type, cats);
        return new Response(JSON.stringify({ ok:true, categories: cats }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message || 'カテゴリー削除に失敗しました' }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    // <<< END: CATEGORIES_DELETE >>>

    // ============================================================
    // Thesaurus API
    // ============================================================

    if (routeMatch(url, "GET", "thesaurus")) {
      const normalizedParam = optionalString(url.searchParams.get("normalized"));
      const termParam = optionalString(url.searchParams.get("term"));
      const contextParam = optionalString(url.searchParams.get("context"));
      const prefix = "thesaurus:";
      let items = [];

      if (normalizedParam) {
        const key = `${prefix}${normalizeThesaurusTerm(normalizedParam)}`;
        const raw = await env.SETTINGS.get(key);
        if (raw) {
          try { items.push(JSON.parse(raw)); } catch (_) {}
        }
      } else {
        const list = await env.SETTINGS.list({ prefix });
        const values = await Promise.all(list.keys.map(k => env.SETTINGS.get(k.name)));
        for (const raw of values) {
          if (!raw) continue;
          try { items.push(JSON.parse(raw)); } catch (_) {}
        }
      }

      if (termParam) {
        const normalizedTerm = normalizeThesaurusTerm(termParam);
        items = items.filter(entry => {
          if (!entry) return false;
          const base = normalizeThesaurusTerm(entry.term || "");
          if (base.includes(normalizedTerm)) return true;
          const variants = Array.isArray(entry.variants) ? entry.variants : [];
          return variants.some(v => normalizeThesaurusTerm(v).includes(normalizedTerm));
        });
      }

      if (contextParam) {
        const target = contextParam;
        items = items.filter(entry => {
          if (!entry) return false;
          const ctx = Array.isArray(entry.context) ? entry.context : entry.context ? [entry.context] : [];
          return ctx.includes(target);
        });
      }

      return new Response(JSON.stringify({ ok: true, items }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (routeMatch(url, "GET", "searchClinicsBySymptom")) {
      try {
        const keyParam = nk(url.searchParams.get("key"));
        const queryParam = nk(url.searchParams.get("symptom") || url.searchParams.get("q"));
        const includeServices = url.searchParams.get("includeServices") !== "false";
        const includeTests = url.searchParams.get("includeTests") !== "false";
        if (!keyParam && !queryParam) {
          return new Response(JSON.stringify({ ok: false, error: "symptom または key を指定してください" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const allSymptomsRaw = await loadMasterItemsRaw(env, 'symptom');
        const symptoms = allSymptomsRaw.filter(item => item && item.status !== 'archived');
        if (!symptoms.length) {
          return new Response(JSON.stringify({ ok: false, error: "症状マスターが見つかりません" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const bodySiteItems = await loadMasterItemsRaw(env, 'bodySite');
        const bodySiteMap = new Map();
        for (const site of bodySiteItems) {
          for (const ref of bodySiteRefCandidates(site)) {
            if (ref && !bodySiteMap.has(ref)) {
              bodySiteMap.set(ref, site);
            }
          }
        }

        let target = null;
        if (keyParam) {
          const parsedKey = parseMasterKeyLoose(keyParam);
          const comparableKeyValue = parsedKey && parsedKey.type === 'symptom' ? parsedKey.comparable : null;
          const directKey = keyParam.startsWith('master:') ? keyParam : `master:symptom:${keyParam}`;
          target = symptoms.find(sym => sym._key === directKey);
          if (!target && comparableKeyValue) {
            target = symptoms.find(sym => comparableMasterKey('symptom', sym.category, sym.name) === comparableKeyValue);
          }
        }

        if (!target && queryParam) {
          const normalizedQuery = normalizeForSimilarity(queryParam);
          let best = null;
          let bestScore = 0;
          for (const sym of symptoms) {
            const candidates = [sym.name, sym.patientLabel];
            if (Array.isArray(sym.synonyms)) {
              candidates.push(...sym.synonyms);
            }
            let localBest = 0;
            for (const candidate of candidates) {
              if (!candidate) continue;
              const score = jaroWinkler(normalizedQuery, normalizeForSimilarity(candidate));
              if (score > localBest) {
                localBest = score;
              }
            }
            if (localBest > bestScore) {
              bestScore = localBest;
              best = sym;
            }
          }
          if (best && bestScore >= 0.72) {
            target = best;
          }
        }

        if (!target) {
          return new Response(JSON.stringify({ ok: false, error: "該当する症状が見つかりません" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const symptomKey = target._key || masterKeyFromParts('symptom', target.category || '', target.name || '');
        const targetComparable = comparableMasterKey('symptom', target.category || '', target.name || '');

        const recommendedServicesRaw = Array.isArray(target.defaultServices) ? target.defaultServices : [];
        const recommendedTestsRaw = Array.isArray(target.defaultTests) ? target.defaultTests : [];

        const serviceInfos = [];
        const serviceKeyMap = new Map();
        for (const raw of recommendedServicesRaw) {
          const parsed = parseMasterKeyLoose(raw);
          if (!parsed || parsed.type !== 'service' || !parsed.comparable) continue;
          if (serviceKeyMap.has(parsed.comparable)) continue;
          const info = { key: raw, type: parsed.type, category: parsed.category, name: parsed.name, comparable: parsed.comparable };
          serviceInfos.push(info);
          serviceKeyMap.set(parsed.comparable, info);
        }

        const testInfos = [];
        const testKeyMap = new Map();
        for (const raw of recommendedTestsRaw) {
          const parsed = parseMasterKeyLoose(raw);
          if (!parsed || parsed.type !== 'test' || !parsed.comparable) continue;
          if (testKeyMap.has(parsed.comparable)) continue;
          const info = { key: raw, type: parsed.type, category: parsed.category, name: parsed.name, comparable: parsed.comparable };
          testInfos.push(info);
          testKeyMap.set(parsed.comparable, info);
        }

        const clinicsResult = await listClinicsKV(env, { limit: 5000, offset: 0 });
        const clinics = Array.isArray(clinicsResult.items) ? clinicsResult.items : [];

        const matches = [];
        const matchedServiceKeys = new Set();
        const matchedTestKeys = new Set();

        for (const clinic of clinics) {
          const matchedServices = [];
          const matchedTests = [];

          if (includeServices && serviceKeyMap.size) {
            const services = Array.isArray(clinic.services) ? clinic.services : [];
            for (const svc of services) {
              const comparables = extractComparableKeys(svc, 'service');
              let matchedInfo = null;
              for (const comp of comparables) {
                const info = serviceKeyMap.get(comp);
                if (info) {
                  matchedInfo = info;
                  matchedServiceKeys.add(info.comparable);
                  break;
                }
              }
              if (matchedInfo) {
                matchedServices.push({
                  category: svc.category || matchedInfo.category,
                  name: svc.name || matchedInfo.name,
                  desc: svc.desc || null,
                  source: svc.source || null,
                  masterKey: matchedInfo.key
                });
              }
            }
          }

          if (includeTests && testKeyMap.size) {
            const tests = Array.isArray(clinic.tests) ? clinic.tests : [];
            for (const tst of tests) {
              const comparables = extractComparableKeys(tst, 'test');
              let matchedInfo = null;
              for (const comp of comparables) {
                const info = testKeyMap.get(comp);
                if (info) {
                  matchedInfo = info;
                  matchedTestKeys.add(info.comparable);
                  break;
                }
              }
              if (matchedInfo) {
                matchedTests.push({
                  category: tst.category || matchedInfo.category,
                  name: tst.name || matchedInfo.name,
                  desc: tst.desc || null,
                  source: tst.source || null,
                  masterKey: matchedInfo.key
                });
              }
            }
          }

          const score = matchedServices.length * 2 + matchedTests.length;
          if (score > 0 || (!serviceKeyMap.size && !testKeyMap.size)) {
            matches.push({
              clinicId: clinic.id || null,
              clinicName: clinic.name || '',
              address: clinic.address || '',
              phone: clinic.phone || clinic.phoneNumber || null,
              url: clinic.homepage || clinic.website || null,
              matchedServices,
              matchedTests,
              score
            });
          }
        }

        matches.sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return (a.clinicName || '').localeCompare(b.clinicName || '', 'ja');
        });

        const missingServices = serviceInfos.filter(info => !matchedServiceKeys.has(info.comparable));
        const missingTests = testInfos.filter(info => !matchedTestKeys.has(info.comparable));

        const rawBodyRefs = Array.isArray(target.bodySiteRefs) ? target.bodySiteRefs : [];
        const resolvedBodySites = rawBodyRefs.map(ref => {
          const normalized = normalizeBodySiteRef(ref);
          const site = normalized ? bodySiteMap.get(normalized) : null;
          return {
            ref,
            normalized,
            name: site?.name || null,
            patientLabel: site?.patientLabel || null,
            category: site?.category || null,
            canonical: site?.canonical_name || null,
            laterality: site?.laterality || null
          };
        });

        const responseBody = {
          ok: true,
          symptom: {
            key: symptomKey,
            comparableKey: targetComparable,
            name: target.name || '',
            patientLabel: target.patientLabel || '',
            category: target.category || '',
            severityTags: target.severityTags || [],
            icd10: target.icd10 || [],
            synonyms: target.synonyms || [],
            bodySites: resolvedBodySites,
            notes: target.notes || null
          },
          recommendedServices: serviceInfos.map(info => ({ key: info.key, category: info.category, name: info.name })),
          recommendedTests: testInfos.map(info => ({ key: info.key, category: info.category, name: info.name })),
          clinics: matches,
          missingServices: missingServices.map(info => ({ key: info.key, category: info.category, name: info.name })),
          missingTests: missingTests.map(info => ({ key: info.key, category: info.category, name: info.name }))
        };

        return new Response(JSON.stringify(responseBody), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        console.error('searchClinicsBySymptom failed', err);
        return new Response(JSON.stringify({ ok: false, error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }


    if (routeMatch(url, "POST", "thesaurus")) {
      let payload;
      try {
        payload = await request.json();
      } catch (err) {
        return new Response(JSON.stringify({ error: "Invalid JSON" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const term = optionalString(payload?.term);
      const normalizedInput = optionalString(payload?.normalized);
      const normalized = normalizeThesaurusTerm(normalizedInput || term || "");
      if (!normalized) {
        return new Response(JSON.stringify({ error: "normalized または term が必要です" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const key = `thesaurus:${normalized}`;
      const existing = await env.SETTINGS.get(key);
      const now = new Date().toISOString();

      let entry = null;
      if (existing) {
        try { entry = JSON.parse(existing); } catch (_) { entry = null; }
      }
      if (!entry || typeof entry !== "object") {
        entry = { normalized, created_at: now };
      }

      if (term) {
        entry.term = term;
      } else if (!entry.term) {
        entry.term = normalized;
      }

      if (Object.prototype.hasOwnProperty.call(payload || {}, "variants")) {
        entry.variants = normalizeStringArray(payload.variants);
      }
      if (Object.prototype.hasOwnProperty.call(payload || {}, "context")) {
        if (Array.isArray(payload.context)) {
          entry.context = normalizeStringArray(payload.context);
        } else if (typeof payload.context === "string") {
          entry.context = normalizeStringArray([payload.context]);
        } else {
          entry.context = [];
        }
      }
      if (Object.prototype.hasOwnProperty.call(payload || {}, "locale")) {
        entry.locale = optionalString(payload.locale);
      }
      if (Object.prototype.hasOwnProperty.call(payload || {}, "notes")) {
        entry.notes = optionalString(payload.notes);
      }
      if (Object.prototype.hasOwnProperty.call(payload || {}, "source")) {
        entry.source = optionalString(payload.source);
      }

      entry.updated_at = now;

      await env.SETTINGS.put(key, JSON.stringify(entry));
      return new Response(JSON.stringify({ ok: true, entry }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


// ===== /api/deleteClinic =====
if (url.pathname === "/api/deleteClinic" && request.method === "POST") {
  try {
    const body = await request.json();
    const id = (body?.id || "").trim();
    const name = (body?.name || "").trim();

    if (!id && !name) {
      return new Response(JSON.stringify({ error: "id か name を指定してください" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1) 新レイアウト優先（idベース）
    if (id) {
      const rec = await env.SETTINGS.get(`clinic:id:${id}`);
      if (rec) {
        const obj = JSON.parse(rec);
        const nm = obj?.name;
        // 連動削除（id / name-index / 互換キー）
        await env.SETTINGS.delete(`clinic:id:${id}`);
        if (nm) {
          await env.SETTINGS.delete(`clinic:name:${nm}`);
          await env.SETTINGS.delete(`clinic:${nm}`); // 互換キー（旧形式）
        }
        return new Response(JSON.stringify({ ok: true, deleted: { id, name: nm || null } }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // 2) name 指定（レガシーデータ含む）
    if (name) {
      // 新形式の name→id インデックスがあれば id レコードも削除
      const idxId = await env.SETTINGS.get(`clinic:name:${name}`);
      if (idxId) {
        await env.SETTINGS.delete(`clinic:id:${idxId}`);
      }
      // name インデックス自体を削除
      await env.SETTINGS.delete(`clinic:name:${name}`);
      // 旧形式（互換）キーを削除
      await env.SETTINGS.delete(`clinic:${name}`);

      return new Response(JSON.stringify({ ok: true, deleted: { name } }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ここに落ちることは基本無い
    return new Response(JSON.stringify({ error: "対象が見つかりません" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response("Error: " + err.message, {
      status: 500,
      headers: corsHeaders,
    });
  }
}
// ============================================================
// AI重複検出（Embeddings）ユーティリティ
// ============================================================

async function openaiEmbed(env, text) {
  // OpenAI text-embedding-3-small を使用（日本語OK、コスト安）
  const body = {
    input: text,
    model: "text-embedding-3-small"
  };
  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error("Embedding API error");
  const d = await r.json();
  return d.data[0].embedding;
}

function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na  += a[i] * a[i];
    nb  += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function normalizeJP(s) {
  if (!s) return "";
  return s.normalize("NFKC")
          .replace(/[\u3000\s]+/g, " ")
          .trim();
}

/**
 * 指定type(test/service)のマスター一覧をKVから取得
 * 既存の /api/listMaster と同じ構造を返すことを想定
 */
async function loadMasterAll(env, type) {
  if (!MASTER_ALLOWED_TYPES.has(type)) {
    return [];
  }
  const prefix = `master:${type}:`;
  const list = await env.SETTINGS.list({ prefix });
  const results = [];
  for (const entry of list.keys) {
    const keyName = entry.name;
    if (keyName.includes('|')) continue;
    const raw = await env.SETTINGS.get(keyName);
    if (!raw) continue;
    try {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object') {
        obj.id = obj.id || keyName.slice(prefix.length);
        results.push(obj);
      }
    } catch (_) {}
  }
  return results;
}

/**
 * まだ埋め込みが無いアイテムに付与して保存
 * keyは既存の masterキーを使い、item.embedding に配列として格納
 */
async function backfillEmbeddings(env, type) {
  const prefix = `master:${type}:`;
  const list = await env.SETTINGS.list({ prefix });
  for (const k of list.keys) {
    const val = await env.SETTINGS.get(k.name);
    if (!val) continue;
    let item;
    try { item = JSON.parse(val); } catch(_) { continue; }
    if (item && !item.embedding) {
      const basis = normalizeJP(`${item.category}｜${item.name}｜${item.canonical_name||""}｜${item.desc||""}`);
      try {
        const emb = await openaiEmbed(env, basis);
        item.embedding = emb;
        await env.SETTINGS.put(k.name, JSON.stringify(item));
      } catch(e) {
        // 埋め込み失敗はスキップ（後で再試行）
      }
    }
  }
}

/**
 * 類似グループ化（コサイン類似度）
 * - 同じ category 内でのみグループ化
 * - threshold 以上を1グループにして返す
 * 返り値: [{ category, members:[{name, canonical_name, status, score, ...}] }]
 */
function buildGroupsByEmbedding(items, threshold) {
  const byCat = new Map();
  items.forEach(it => {
    const arr = byCat.get(it.category) || [];
    arr.push(it);
    byCat.set(it.category, arr);
  });

  const groups = [];
  byCat.forEach(arr => {
    const used = new Array(arr.length).fill(false);

    for (let i = 0; i < arr.length; i++) {
      if (used[i]) continue;
      const base = arr[i];
      if (!base.embedding) continue;

      const g = [{...base, score: 1}];
      used[i] = true;

      for (let j = i + 1; j < arr.length; j++) {
        if (used[j]) continue;
        const cand = arr[j];
        if (!cand.embedding) continue;
        const sim = cosine(base.embedding, cand.embedding);
        if (sim >= threshold) {
          g.push({...cand, score: sim});
          used[j] = true;
        }
      }
      if (g.length >= 2) {
        // categoryは同一なので代表から借用
        groups.push({ category: base.category, members: g.sort((a,b)=>(b.score||0)-(a.score||0)) });
      }
    }
  });
  return groups;
}

    // ============================================================
    // <<< START: TODO_MANAGEMENT >>>
    // ============================================================
    if (routeMatch(url, "GET", "todo/list")) {
      const raw = await kvGetJSON(env, TODO_KEY);
      let updatedAt = null;
      let items = [];
      if (Array.isArray(raw)) {
        items = raw.map(normalizeTodoEntry).filter(Boolean);
      } else if (raw && typeof raw === "object") {
        if (Array.isArray(raw.todos)) {
          items = raw.todos.map(normalizeTodoEntry).filter(Boolean);
        }
        if (raw.updatedAt) {
          updatedAt = raw.updatedAt;
        }
      }
      if (!items.length) {
        items = DEFAULT_TODOS.map(normalizeTodoEntry).filter(Boolean);
      }
      return new Response(JSON.stringify({ ok: true, todos: items, updatedAt }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (routeMatch(url, "POST", "todo/save")) {
      let payload;
      try {
        payload = await request.json();
      } catch (err) {
        return new Response(JSON.stringify({ error: "Invalid JSON" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const source = Array.isArray(payload)
        ? payload
        : (Array.isArray(payload?.todos) ? payload.todos : null);

      if (!source) {
        return new Response(JSON.stringify({ error: "todos array is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const todos = source.map(normalizeTodoEntry).filter(Boolean);
      const updatedAt = new Date().toISOString();
      await kvPutJSON(env, TODO_KEY, { updatedAt, todos });

      return new Response(JSON.stringify({ ok: true, todos, updatedAt }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // ============================================================
    // <<< END: TODO_MANAGEMENT >>>

// ------------------------------------------------------------
// API: AI埋め込みの再計算（バックフィル）
//   POST /api/reembedMaster  { type: "test" | "service" }
// ------------------------------------------------------------
if (url.pathname === "/api/reembedMaster" && request.method === "POST") {
  try {
    const body = await request.json();
    const type = (body?.type === "service") ? "service" : "test";
    // 全件バックフィル
    await backfillEmbeddings(env, type);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response("Error: " + err.message, { status: 500, headers: corsHeaders });
  }
}

// ------------------------------------------------------------
// API: AI重複候補の取得（埋め込み＋コサイン類似）
//   GET /api/aiDuplicates?type=test&threshold=0.83
// ------------------------------------------------------------
if (url.pathname === "/api/aiDuplicates" && request.method === "GET") {
  try {
    const type = url.searchParams.get("type") === "service" ? "service" : "test";
    const threshold = Math.max(0, Math.min(0.99, Number(url.searchParams.get("threshold") || "0.83")));

    // 1) 全件取得
    const items = await loadMasterAll(env, type);

    // 2) 埋め込みの無いものに付与（必要に応じて）
    const needEmbed = items.some(it => !it.embedding);
    if (needEmbed) {
      await backfillEmbeddings(env, type);
      // 再読み込み
      const items2 = await loadMasterAll(env, type);
      // 3) グループ化
      const groups = buildGroupsByEmbedding(items2, threshold);
      return new Response(JSON.stringify({ ok: true, groups }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } else {
      // 3) グループ化
      const groups = buildGroupsByEmbedding(items, threshold);
      return new Response(JSON.stringify({ ok: true, groups }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (err) {
    return new Response("Error: " + err.message, { status: 500, headers: corsHeaders });
  }
}
// ============================================================
// SEED: Qualifications (categories:qual / master:qual)
//   POST /api/_seedQualifications        … 未投入なら投入
//   POST /api/_seedQualifications?force=1 … 強制上書き
//   ※本番投入後はこのエンドポイントを削除/コメントアウト推奨
// ============================================================
if (url.pathname === "/api/_seedQualifications" && request.method === "POST") {
  try {
    const force = url.searchParams.get("force") === "1";

    // ---- 初期カテゴリ（日本の主要領域をベースにした実用セット）----
    const qualCategories = [
      "内科基盤","総合診療領域",
      "循環器領域","呼吸器領域","消化器領域","内分泌・代謝領域","腎臓領域","血液領域","神経領域","感染症領域","アレルギー・膠原病領域",
      "小児科領域","産婦人科領域","皮膚科領域","眼科領域","耳鼻咽喉科領域","精神科領域",
      "外科領域","心臓血管外科領域","整形外科領域","脳神経外科領域","泌尿器領域","放射線科領域","麻酔科領域","病理領域","臨床検査領域","リハビリテーション領域"
    ];

    // 既に categories:qual があればスキップ（force以外）
    const existingCategories = await getCategories(env, "qual");
    if (!force && Array.isArray(existingCategories) && existingCategories.length > 0) {
      return new Response(JSON.stringify({ ok:true, skipped:true, reason:"categories:qual exists" }), {
        headers: { ...corsHeaders, "Content-Type":"application/json" }
      });
    }

    // ---- 資格マスター（主要資格のseed：name / issuer / status=approved など）----
    // ※実運用で随時追加/修正できるよう、canonical_name や code は空でも可。
    const masterItems = [
      // 内科基盤・総合診療
      { category:"内科基盤", name:"内科専門医", issuer:"日本内科学会/日本専門医機構", status:"approved" },
      { category:"内科基盤", name:"総合内科専門医", issuer:"日本内科学会", status:"approved" },
      { category:"総合診療領域", name:"総合診療専門医", issuer:"日本専門医機構", status:"approved" },

      // 循環器
      { category:"循環器領域", name:"循環器内科専門医", issuer:"日本循環器学会/日本専門医機構", status:"approved" },
      { category:"循環器領域", name:"循環器専門医（旧制度）", issuer:"日本循環器学会", status:"candidate" },
      { category:"循環器領域", name:"不整脈専門医", issuer:"日本不整脈心電学会", status:"approved" },

      // 呼吸器
      { category:"呼吸器領域", name:"呼吸器専門医", issuer:"日本呼吸器学会", status:"approved" },
      { category:"呼吸器領域", name:"呼吸器内視鏡専門医", issuer:"日本呼吸器内視鏡学会", status:"approved" },

      // 消化器
      { category:"消化器領域", name:"消化器病専門医", issuer:"日本消化器病学会", status:"approved" },
      { category:"消化器領域", name:"消化器内視鏡専門医", issuer:"日本消化器内視鏡学会", status:"approved" },
      { category:"消化器領域", name:"肝臓専門医", issuer:"日本肝臓学会", status:"approved" },

      // 代謝・内分泌
      { category:"内分泌・代謝領域", name:"内分泌代謝科専門医", issuer:"日本内分泌学会/日本糖尿病学会 等", status:"approved" },
      { category:"内分泌・代謝領域", name:"糖尿病専門医", issuer:"日本糖尿病学会", status:"approved" },

      // 腎臓・血液・神経・感染症・膠原病
      { category:"腎臓領域", name:"腎臓専門医", issuer:"日本腎臓学会", status:"approved" },
      { category:"血液領域", name:"血液専門医", issuer:"日本血液学会", status:"approved" },
      { category:"神経領域", name:"神経内科専門医", issuer:"日本神経学会", status:"approved" },
      { category:"感染症領域", name:"感染症専門医", issuer:"日本感染症学会", status:"approved" },
      { category:"アレルギー・膠原病領域", name:"リウマチ専門医", issuer:"日本リウマチ学会", status:"approved" },
      { category:"アレルギー・膠原病領域", name:"アレルギー専門医", issuer:"日本アレルギー学会", status:"approved" },

      // 小児・産婦人科・皮膚・眼・耳鼻・精神
      { category:"小児科領域", name:"小児科専門医", issuer:"日本小児科学会/日本専門医機構", status:"approved" },
      { category:"産婦人科領域", name:"産婦人科専門医", issuer:"日本産科婦人科学会/日本専門医機構", status:"approved" },
      { category:"皮膚科領域", name:"皮膚科専門医", issuer:"日本皮膚科学会/日本専門医機構", status:"approved" },
      { category:"眼科領域", name:"眼科専門医", issuer:"日本眼科学会/日本専門医機構", status:"approved" },
      { category:"耳鼻咽喉科領域", name:"耳鼻咽喉科専門医", issuer:"日本耳鼻咽喉科頭頸部外科学会/日本専門医機構", status:"approved" },
      { category:"精神科領域", name:"精神科専門医", issuer:"日本精神神経学会/日本専門医機構", status:"approved" },

      // 外科・心外・整形・脳外・泌尿
      { category:"外科領域", name:"外科専門医", issuer:"日本外科学会/日本専門医機構", status:"approved" },
      { category:"心臓血管外科領域", name:"心臓血管外科専門医", issuer:"心臓血管外科専門医認定機構", status:"approved" },
      { category:"整形外科領域", name:"整形外科専門医", issuer:"日本整形外科学会/日本専門医機構", status:"approved" },
      { category:"脳神経外科領域", name:"脳神経外科専門医", issuer:"日本脳神経外科学会/日本専門医機構", status:"approved" },
      { category:"泌尿器領域", name:"泌尿器科専門医", issuer:"日本泌尿器科学会/日本専門医機構", status:"approved" },

      // 画像・麻酔・病理・検査・リハ
      { category:"放射線科領域", name:"放射線科専門医", issuer:"日本医学放射線学会/日本専門医機構", status:"approved" },
      { category:"麻酔科領域", name:"麻酔科専門医", issuer:"日本麻酔科学会/日本専門医機構", status:"approved" },
      { category:"病理領域", name:"病理専門医", issuer:"日本病理学会/日本専門医機構", status:"approved" },
      { category:"臨床検査領域", name:"臨床検査専門医", issuer:"日本臨床検査医学会", status:"approved" },
      { category:"リハビリテーション領域", name:"リハビリテーション科専門医", issuer:"日本リハビリテーション医学会/日本専門医機構", status:"approved" }
    ];

    // カテゴリ保存（D1/KV 双方を更新）
    await putCategories(env, "qual", qualCategories);

    // マスター保存（既存があれば上書き、無ければ新規作成）
    let createdCount = 0;
    const now = Math.floor(Date.now() / 1000);
    for (const it of masterItems) {
      const { record, created } = await getOrCreateMasterRecord(env, { type: "qual", category: it.category, name: it.name }, { ctx });
      record.status = it.status || record.status || "candidate";
      record.issuer = it.issuer || record.issuer || "";
      if (typeof it.canonical_name === "string") {
        record.canonical_name = it.canonical_name || null;
      }
      if (Array.isArray(it.sources)) {
        record.sources = it.sources;
      }
      record.updated_at = now;
      await writeMasterRecord(env, "qual", record, { ctx });
      if (created) {
        createdCount += 1;
      }
    }

    if (ctx?.waitUntil) ctx.waitUntil(invalidateMasterCache(env, "qual"));
    else await invalidateMasterCache(env, "qual");

    return new Response(JSON.stringify({
      ok: true,
      categories: qualCategories.length,
      items: masterItems.length,
      created: createdCount,
    }), {
      headers: { ...corsHeaders, "Content-Type":"application/json" }
    });

  } catch (e) {
    return new Response("Error: " + e.message, { status: 500, headers: corsHeaders });
  }
}

    // ============================================================
    // <<< START: NOT_FOUND >>>
    // ============================================================
    return new Response("Not Found", {
      status: 404,
      headers: corsHeaders,
    });
    // <<< END: NOT_FOUND >>>
  },
};
