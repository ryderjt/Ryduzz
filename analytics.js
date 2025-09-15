(function () {
  'use strict';

  const STORAGE_KEY = 'ryduzz.analytics.v1';
  const VISITOR_KEY = 'ryduzz.analytics.visitor';
  const MAX_EVENT_LOG = 200;

  function defaultData() {
    return {
      totals: { visits: 0, clicks: 0 },
      visitors: {},
      pages: {},
      visits: [],
      clicks: {},
      clickEvents: [],
      lastUpdated: null,
      version: 1,
    };
  }

  const storageAvailable = checkStorage();
  let useMemoryStore = !storageAvailable;
  let memoryStore = defaultData();
  let analyticsCache = normalizeData(readInitialData());
  if (useMemoryStore) {
    memoryStore = clone(analyticsCache);
  }
  let visitLogged = false;
  let clickListenerBound = false;
  let fallbackVisitorId = null;

  function checkStorage() {
    try {
      const testKey = '__analytics_test__';
      window.localStorage.setItem(testKey, '1');
      window.localStorage.removeItem(testKey);
      return true;
    } catch (err) {
      console.warn('[Analytics] Local storage is not available; using in-memory store only.');
      return false;
    }
  }

  function readInitialData() {
    if (!storageAvailable) {
      return defaultData();
    }
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return defaultData();
      }
      return JSON.parse(raw);
    } catch (err) {
      console.warn('[Analytics] Failed to read stored analytics data.', err);
      useMemoryStore = true;
      return defaultData();
    }
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function sanitizeVisitors(visitors) {
    const result = {};
    if (!visitors || typeof visitors !== 'object') return result;
    for (const [id, value] of Object.entries(visitors)) {
      if (!value || typeof value !== 'object') continue;
      result[id] = {
        id,
        visitCount: Number(value.visitCount) || 0,
        firstVisit: value.firstVisit || null,
        lastVisit: value.lastVisit || null,
        lastPath: value.lastPath || null,
        languages:
          value.languages && typeof value.languages === 'object'
            ? value.languages
            : {},
      };
    }
    return result;
  }

  function sanitizePages(pages) {
    const result = {};
    if (!pages || typeof pages !== 'object') return result;
    for (const [path, value] of Object.entries(pages)) {
      if (!value || typeof value !== 'object') continue;
      const visitors =
        value.visitors && typeof value.visitors === 'object'
          ? value.visitors
          : {};
      const uniqueVisitors =
        typeof value.uniqueVisitors === 'number'
          ? value.uniqueVisitors
          : Object.keys(visitors).length;
      const referrers =
        value.referrers && typeof value.referrers === 'object'
          ? value.referrers
          : {};
      result[path] = {
        path,
        title: value.title || '',
        visits: Number(value.visits) || 0,
        clicks: Number(value.clicks) || 0,
        uniqueVisitors,
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
      .filter((item) => item && typeof item === 'object')
      .map((visit) => ({
        timestamp: visit.timestamp || null,
        path: visit.path || window.location.pathname,
        referrer: visit.referrer || 'Direct',
        visitorId: visit.visitorId || null,
        title: visit.title || '',
        language: visit.language || null,
        userAgent: visit.userAgent || null,
      }))
      .slice(-MAX_EVENT_LOG);
  }

  function sanitizeClicks(clicks) {
    const result = {};
    if (!clicks || typeof clicks !== 'object') return result;
    for (const [label, value] of Object.entries(clicks)) {
      if (!value || typeof value !== 'object') continue;
      const visitors =
        value.visitors && typeof value.visitors === 'object'
          ? value.visitors
          : {};
      const uniqueVisitors =
        typeof value.uniqueVisitors === 'number'
          ? value.uniqueVisitors
          : Object.keys(visitors).length;
      const pages =
        value.pages && typeof value.pages === 'object' ? value.pages : {};
      const hrefs = value.hrefs && typeof value.hrefs === 'object' ? value.hrefs : {};
      result[label] = {
        label,
        count: Number(value.count) || 0,
        firstTimestamp: value.firstTimestamp || null,
        lastTimestamp: value.lastTimestamp || null,
        pages,
        visitors,
        uniqueVisitors,
        hrefs,
      };
    }
    return result;
  }

  function sanitizeClickEvents(events) {
    if (!Array.isArray(events)) return [];
    return events
      .filter((item) => item && typeof item === 'object')
      .map((event) => ({
        timestamp: event.timestamp || null,
        path: event.path || window.location.pathname,
        label: event.label || 'Unknown',
        href: event.href || null,
        visitorId: event.visitorId || null,
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
    return base;
  }

  function loadData() {
    if (!useMemoryStore && storageAvailable) {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) {
          analyticsCache = normalizeData(defaultData());
        } else {
          analyticsCache = normalizeData(JSON.parse(raw));
        }
        return analyticsCache;
      } catch (err) {
        console.warn('[Analytics] Failed to load data from storage; switching to memory store.', err);
        useMemoryStore = true;
        analyticsCache = normalizeData(memoryStore);
        return analyticsCache;
      }
    }
    analyticsCache = normalizeData(memoryStore);
    return analyticsCache;
  }

  function saveData(data) {
    const normalized = normalizeData(data);
    normalized.lastUpdated = normalized.lastUpdated || new Date().toISOString();
    analyticsCache = normalized;
    if (!useMemoryStore && storageAvailable) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
      } catch (err) {
        console.warn('[Analytics] Failed to persist data; using in-memory store.', err);
        useMemoryStore = true;
        memoryStore = clone(normalized);
      }
    } else {
      memoryStore = clone(normalized);
    }
    return analyticsCache;
  }

  function ensurePage(data, path, title) {
    data.pages = data.pages || {};
    if (!data.pages[path]) {
      data.pages[path] = {
        path,
        title: title || '',
        visits: 0,
        clicks: 0,
        uniqueVisitors: 0,
        visitors: {},
        referrers: {},
        lastVisit: null,
      };
    }
    const page = data.pages[path];
    if (!page.visitors || typeof page.visitors !== 'object') {
      page.visitors = {};
    }
    if (!page.referrers || typeof page.referrers !== 'object') {
      page.referrers = {};
    }
    if (typeof page.visits !== 'number') page.visits = Number(page.visits) || 0;
    if (typeof page.clicks !== 'number') page.clicks = Number(page.clicks) || 0;
    if (typeof page.uniqueVisitors !== 'number') {
      page.uniqueVisitors = Object.keys(page.visitors).length;
    }
    if (title && !page.title) {
      page.title = title;
    }
    return page;
  }

  function formatReferrer(referrer) {
    if (!referrer) return 'Direct';
    try {
      const url = new URL(referrer);
      return url.hostname;
    } catch (err) {
      return referrer;
    }
  }

  function getVisitorId() {
    if (!useMemoryStore && storageAvailable) {
      try {
        let id = window.localStorage.getItem(VISITOR_KEY);
        if (!id) {
          id = generateVisitorId();
          window.localStorage.setItem(VISITOR_KEY, id);
        }
        return id;
      } catch (err) {
        console.warn('[Analytics] Unable to access visitor id storage.', err);
      }
    }
    try {
      let id = window.sessionStorage.getItem(VISITOR_KEY);
      if (!id) {
        id = generateVisitorId();
        window.sessionStorage.setItem(VISITOR_KEY, id);
      }
      return id;
    } catch (err) {
      if (!fallbackVisitorId) {
        fallbackVisitorId = generateVisitorId();
      }
      return fallbackVisitorId;
    }
  }

  function generateVisitorId() {
    return `v-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  }

  function recordVisitInternal() {
    if (visitLogged) return;
    visitLogged = true;
    const now = new Date().toISOString();
    const data = loadData();
    const visitorId = getVisitorId();
    const path = `${window.location.pathname}${window.location.search}` || window.location.pathname;
    const referrer = formatReferrer(document.referrer || '');
    const language = navigator.language || navigator.userLanguage || null;
    const title = document.title || path;

    data.totals.visits = (data.totals.visits || 0) + 1;

    const visitor = data.visitors[visitorId] || {
      id: visitorId,
      visitCount: 0,
      firstVisit: now,
      languages: {},
    };
    visitor.visitCount += 1;
    visitor.firstVisit = visitor.firstVisit || now;
    visitor.lastVisit = now;
    visitor.lastPath = path;
    visitor.languages = visitor.languages || {};
    if (language) {
      const langKey = language.split(',')[0];
      visitor.languages[langKey] = (visitor.languages[langKey] || 0) + 1;
    }
    data.visitors[visitorId] = visitor;

    const page = ensurePage(data, path, title);
    page.visits += 1;
    page.lastVisit = now;
    page.referrers = page.referrers || {};
    page.referrers[referrer] = (page.referrers[referrer] || 0) + 1;
    if (!page.visitors[visitorId]) {
      page.visitors[visitorId] = 0;
      page.uniqueVisitors += 1;
    }
    page.visitors[visitorId] += 1;

    data.visits = data.visits || [];
    data.visits.push({
      timestamp: now,
      path,
      referrer,
      visitorId,
      title,
      language,
      userAgent: navigator.userAgent,
    });
    if (data.visits.length > MAX_EVENT_LOG) {
      data.visits = data.visits.slice(-MAX_EVENT_LOG);
    }

    data.lastUpdated = now;

    saveData(data);
  }

  function getClickableTarget(event) {
    if (!event || !event.target) return null;
    const clickable = event.target.closest(
      '[data-analytics-id], a, button, [role="button"], label',
    );
    if (!clickable) return null;
    const label =
      clickable.getAttribute('data-analytics-id') ||
      clickable.getAttribute('aria-label') ||
      (clickable.id ? `#${clickable.id}` : '') ||
      extractText(clickable) ||
      clickable.tagName.toLowerCase();
    if (!label) return null;
    return {
      label: sanitizeLabel(label),
      href: clickable.href || null,
      tagName: clickable.tagName.toLowerCase(),
    };
  }

  function extractText(node) {
    const text = (node.textContent || '').trim().replace(/\s+/g, ' ');
    if (text) return text.slice(0, 80);
    return null;
  }

  function sanitizeLabel(label) {
    return label.replace(/\s+/g, ' ').trim().slice(0, 80);
  }

  function recordClickMeta(meta) {
    if (!meta || !meta.label) return;
    const now = new Date().toISOString();
    const data = loadData();
    const visitorId = getVisitorId();
    const path = `${window.location.pathname}${window.location.search}` || window.location.pathname;
    const page = ensurePage(data, path, document.title || path);

    data.totals.clicks = (data.totals.clicks || 0) + 1;
    page.clicks = (page.clicks || 0) + 1;

    data.clicks = data.clicks || {};
    const existing = data.clicks[meta.label] || {
      label: meta.label,
      count: 0,
      firstTimestamp: now,
      pages: {},
      visitors: {},
      uniqueVisitors: 0,
      hrefs: {},
    };
    existing.count += 1;
    existing.lastTimestamp = now;
    existing.pages = existing.pages || {};
    existing.pages[path] = (existing.pages[path] || 0) + 1;
    existing.visitors = existing.visitors || {};
    if (!existing.visitors[visitorId]) {
      existing.visitors[visitorId] = 0;
      existing.uniqueVisitors = (existing.uniqueVisitors || 0) + 1;
    }
    existing.visitors[visitorId] += 1;
    if (meta.href) {
      existing.hrefs = existing.hrefs || {};
      existing.hrefs[meta.href] = (existing.hrefs[meta.href] || 0) + 1;
    }
    data.clicks[meta.label] = existing;

    data.clickEvents = data.clickEvents || [];
    data.clickEvents.push({
      timestamp: now,
      path,
      label: meta.label,
      href: meta.href || null,
      visitorId,
    });
    if (data.clickEvents.length > MAX_EVENT_LOG) {
      data.clickEvents = data.clickEvents.slice(-MAX_EVENT_LOG);
    }

    data.lastUpdated = now;

    saveData(data);
  }

  function handleClick(event) {
    const meta = getClickableTarget(event);
    if (!meta) return;
    recordClickMeta(meta);
  }

  function init(options) {
    const opts = Object.assign(
      {
        trackVisit: true,
        trackClicks: true,
      },
      options || {},
    );

    if (opts.trackVisit) {
      if (document.readyState === 'loading') {
        document.addEventListener(
          'DOMContentLoaded',
          () => recordVisitInternal(),
          { once: true },
        );
      } else {
        recordVisitInternal();
      }
    }

    if (opts.trackClicks && !clickListenerBound) {
      document.addEventListener('click', handleClick, true);
      clickListenerBound = true;
    }
  }

  function clearData() {
    analyticsCache = defaultData();
    memoryStore = defaultData();
    visitLogged = false;
    if (!useMemoryStore && storageAvailable) {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch (err) {
        console.warn('[Analytics] Failed to clear local storage.', err);
      }
    }
  }

  function getData() {
    return clone(loadData());
  }

  function exportData() {
    return getData();
  }

  function recordEvent(label, options) {
    if (!label) return;
    const meta = {
      label: sanitizeLabel(label),
      href: options && options.href ? options.href : null,
    };
    recordClickMeta(meta);
  }

  window.SiteAnalytics = {
    init,
    recordVisit: recordVisitInternal,
    recordEvent,
    getData,
    clearData,
    exportData,
    version: '1.0.0',
  };
})();
