const fs = require('fs/promises');
const path = require('path');
const { randomBytes } = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'analytics.json');
const MAX_EVENT_LOG = 500;

function defaultData() {
  return {
    totals: { visits: 0, clicks: 0 },
    visitors: {},
    pages: {},
    visits: [],
    clicks: {},
    clickEvents: [],
    lastUpdated: null,
    version: 2,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sanitizeVisitors(visitors) {
  const result = {};
  if (!visitors || typeof visitors !== 'object') return result;
  for (const [id, value] of Object.entries(visitors)) {
    if (!value || typeof value !== 'object') continue;
    const languages =
      value.languages && typeof value.languages === 'object'
        ? value.languages
        : {};
    result[id] = {
      id,
      visitCount: Number(value.visitCount) || 0,
      firstVisit: value.firstVisit || null,
      lastVisit: value.lastVisit || null,
      lastPath: value.lastPath || null,
      languages,
    };
  }
  return result;
}

function sanitizePages(pages) {
  const result = {};
  if (!pages || typeof pages !== 'object') return result;
  for (const [pathKey, value] of Object.entries(pages)) {
    if (!value || typeof value !== 'object') continue;
    const visitors =
      value.visitors && typeof value.visitors === 'object' ? value.visitors : {};
    const referrers =
      value.referrers && typeof value.referrers === 'object'
        ? value.referrers
        : {};
    result[pathKey] = {
      path: pathKey,
      title: value.title || pathKey,
      visits: Number(value.visits) || 0,
      clicks: Number(value.clicks) || 0,
      uniqueVisitors:
        typeof value.uniqueVisitors === 'number'
          ? value.uniqueVisitors
          : Object.keys(visitors).length,
      visitors,
      referrers,
      lastVisit: value.lastVisit || null,
    };
  }
  return result;
}

function sanitizeVisits(visits) {
  if (!Array.isArray(visits)) return [];
  return visits
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      timestamp: entry.timestamp || null,
      path: entry.path || '/',
      referrer: entry.referrer || 'Direct',
      visitorId: entry.visitorId || null,
      title: entry.title || entry.path || '/',
      language: entry.language || null,
      userAgent: entry.userAgent || null,
    }))
    .slice(-MAX_EVENT_LOG);
}

function sanitizeClicks(clicks) {
  const result = {};
  if (!clicks || typeof clicks !== 'object') return result;
  for (const [label, value] of Object.entries(clicks)) {
    if (!value || typeof value !== 'object') continue;
    const visitors =
      value.visitors && typeof value.visitors === 'object' ? value.visitors : {};
    const pages = value.pages && typeof value.pages === 'object' ? value.pages : {};
    const hrefs = value.hrefs && typeof value.hrefs === 'object' ? value.hrefs : {};
    result[label] = {
      label,
      count: Number(value.count) || 0,
      firstTimestamp: value.firstTimestamp || null,
      lastTimestamp: value.lastTimestamp || null,
      pages,
      visitors,
      uniqueVisitors:
        typeof value.uniqueVisitors === 'number'
          ? value.uniqueVisitors
          : Object.keys(visitors).length,
      hrefs,
    };
  }
  return result;
}

function sanitizeClickEvents(events) {
  if (!Array.isArray(events)) return [];
  return events
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      timestamp: entry.timestamp || null,
      path: entry.path || '/',
      label: entry.label || 'Unknown',
      href: entry.href || null,
      visitorId: entry.visitorId || null,
    }))
    .slice(-MAX_EVENT_LOG);
}

function normalizeData(raw) {
  const base = defaultData();
  if (!raw || typeof raw !== 'object') {
    return base;
  }
  base.totals = {
    visits: Number(raw.totals?.visits) || 0,
    clicks: Number(raw.totals?.clicks) || 0,
  };
  base.visitors = sanitizeVisitors(raw.visitors);
  base.pages = sanitizePages(raw.pages);
  base.visits = sanitizeVisits(raw.visits);
  base.clicks = sanitizeClicks(raw.clicks);
  base.clickEvents = sanitizeClickEvents(raw.clickEvents);
  base.lastUpdated = raw.lastUpdated || null;
  base.version = Number(raw.version) || 2;
  return base;
}

async function ensureStorage() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readFileData() {
  await ensureStorage();
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    if (!raw) {
      const data = defaultData();
      await writeFileData(data);
      return data;
    }
    return normalizeData(JSON.parse(raw));
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      const data = defaultData();
      await writeFileData(data);
      return data;
    }
    console.error('[AnalyticsStore] Failed to read analytics data.', err);
    return defaultData();
  }
}

async function writeFileData(data) {
  await ensureStorage();
  const normalized = normalizeData(data);
  normalized.lastUpdated = normalized.lastUpdated || new Date().toISOString();
  const serialized = JSON.stringify(normalized, null, 2);
  await fs.writeFile(DATA_FILE, serialized, 'utf8');
  return normalized;
}

let queue = Promise.resolve();

function runExclusive(task) {
  const next = queue.then(() => task());
  queue = next.catch(() => {});
  return next;
}

function sanitizePath(value) {
  if (!value && value !== '') return '/';
  const trimmed = String(value).trim();
  if (!trimmed) return '/';
  return trimmed.length > 400 ? trimmed.slice(0, 400) : trimmed;
}

function sanitizeString(value, limit = 200) {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (!str) return null;
  return str.length > limit ? str.slice(0, limit) : str;
}

function sanitizeLabelValue(value) {
  const str = sanitizeString(value, 160);
  return str || '';
}

function sanitizeHref(value) {
  const str = sanitizeString(value, 500);
  return str || null;
}

function toIsoTimestamp(value) {
  if (value) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }
  return new Date().toISOString();
}

function generateVisitorId() {
  return `srv-${randomBytes(6).toString('hex')}`;
}

function coerceVisitorId(value) {
  const str = sanitizeString(value, 120);
  return str || generateVisitorId();
}

function coerceTitle(value, fallback) {
  const title = sanitizeString(value, 200);
  return title || fallback || '/';
}

function formatReferrer(referrer) {
  const str = sanitizeString(referrer, 200);
  if (!str) return 'Direct';
  try {
    const parsed = new URL(str);
    return parsed.hostname || 'Direct';
  } catch (err) {
    const cleaned = str.replace(/^https?:\/\//i, '').replace(/\/$/, '');
    return cleaned || 'Direct';
  }
}

function ensurePage(data, pathKey, title) {
  if (!data.pages[pathKey]) {
    data.pages[pathKey] = {
      path: pathKey,
      title: title || pathKey,
      visits: 0,
      clicks: 0,
      uniqueVisitors: 0,
      visitors: {},
      referrers: {},
      lastVisit: null,
    };
  }
  const page = data.pages[pathKey];
  if (!page.visitors || typeof page.visitors !== 'object') {
    page.visitors = {};
  }
  if (!page.referrers || typeof page.referrers !== 'object') {
    page.referrers = {};
  }
  if (typeof page.visits !== 'number') {
    page.visits = Number(page.visits) || 0;
  }
  if (typeof page.clicks !== 'number') {
    page.clicks = Number(page.clicks) || 0;
  }
  if (!page.title && title) {
    page.title = title;
  }
  return page;
}

async function getData() {
  return runExclusive(async () => clone(await readFileData()));
}

async function recordVisit(event = {}) {
  return runExclusive(async () => {
    const data = await readFileData();
    const timestamp = toIsoTimestamp(event.timestamp);
    const visitorId = coerceVisitorId(event.visitorId);
    const pathKey = sanitizePath(event.path || '/');
    const title = coerceTitle(event.title, pathKey);
    const referrer = formatReferrer(event.referrer);
    const language = sanitizeString(event.language, 32);
    const userAgent = sanitizeString(event.userAgent, 256);

    data.totals.visits = (data.totals.visits || 0) + 1;

    const visitor = data.visitors[visitorId] || {
      id: visitorId,
      visitCount: 0,
      firstVisit: timestamp,
      lastVisit: null,
      lastPath: null,
      languages: {},
    };
    visitor.visitCount = (visitor.visitCount || 0) + 1;
    visitor.firstVisit = visitor.firstVisit || timestamp;
    visitor.lastVisit = timestamp;
    visitor.lastPath = pathKey;
    if (language) {
      visitor.languages[language] = (visitor.languages[language] || 0) + 1;
    }
    data.visitors[visitorId] = visitor;

    const page = ensurePage(data, pathKey, title);
    page.visits = (page.visits || 0) + 1;
    if (title) {
      page.title = title;
    }
    page.lastVisit = timestamp;
    page.visitors[visitorId] = (page.visitors[visitorId] || 0) + 1;
    page.uniqueVisitors = Object.keys(page.visitors).length;
    page.referrers[referrer] = (page.referrers[referrer] || 0) + 1;

    data.visits.push({
      timestamp,
      path: pathKey,
      referrer,
      visitorId,
      title,
      language: language || null,
      userAgent: userAgent || null,
    });
    if (data.visits.length > MAX_EVENT_LOG) {
      data.visits = data.visits.slice(-MAX_EVENT_LOG);
    }

    data.lastUpdated = timestamp;
    return writeFileData(data);
  });
}

async function recordClick(event = {}) {
  const label = sanitizeLabelValue(event.label);
  if (!label) {
    return getData();
  }
  return runExclusive(async () => {
    const data = await readFileData();
    const timestamp = toIsoTimestamp(event.timestamp);
    const visitorId = event.visitorId ? coerceVisitorId(event.visitorId) : null;
    const pathKey = sanitizePath(event.path || '/');
    const href = sanitizeHref(event.href);
    const title = coerceTitle(event.pageTitle || event.title, pathKey);

    data.totals.clicks = (data.totals.clicks || 0) + 1;

    const page = ensurePage(data, pathKey, title);
    page.clicks = (page.clicks || 0) + 1;
    if (title) {
      page.title = title;
    }

    const entry = data.clicks[label] || {
      label,
      count: 0,
      firstTimestamp: null,
      lastTimestamp: null,
      pages: {},
      visitors: {},
      uniqueVisitors: 0,
      hrefs: {},
    };
    entry.count = (entry.count || 0) + 1;
    entry.firstTimestamp = entry.firstTimestamp || timestamp;
    entry.lastTimestamp = timestamp;
    entry.pages[pathKey] = (entry.pages[pathKey] || 0) + 1;
    if (href) {
      entry.hrefs[href] = (entry.hrefs[href] || 0) + 1;
    }
    if (visitorId) {
      entry.visitors[visitorId] = (entry.visitors[visitorId] || 0) + 1;
      entry.uniqueVisitors = Object.keys(entry.visitors).length;
    } else {
      entry.uniqueVisitors = entry.uniqueVisitors || Object.keys(entry.visitors).length;
    }
    data.clicks[label] = entry;

    data.clickEvents.push({
      timestamp,
      path: pathKey,
      label,
      href,
      visitorId,
    });
    if (data.clickEvents.length > MAX_EVENT_LOG) {
      data.clickEvents = data.clickEvents.slice(-MAX_EVENT_LOG);
    }

    data.lastUpdated = timestamp;
    return writeFileData(data);
  });
}

async function clear() {
  return runExclusive(async () => writeFileData(defaultData()));
}

module.exports = {
  defaultData,
  normalizeData,
  getData,
  recordVisit,
  recordClick,
  clear,
};
