(function () {
  'use strict';

  const DEFAULT_DATA_ATTRIBUTE = 'analyticsId';
  const DEFAULT_STORAGE_KEY = 'ryduzz.analytics.visitor';
  const SESSION_KEY_PREFIX = 'ryduzz.analytics.session.';
  const MAX_LABEL_LENGTH = 160;

  const DEFAULT_DATA = () => ({
    totals: { visits: 0, clicks: 0 },
    visitors: {},
    pages: {},
    visits: [],
    clicks: {},
    clickEvents: [],
    lastUpdated: null,
    version: 2,
  });

  const DEFAULT_CONFIG = {
    baseUrl: '',
    dataAttribute: DEFAULT_DATA_ATTRIBUTE,
    storageKey: DEFAULT_STORAGE_KEY,
    keepalive: true,
    trackVisitOnInit: true,
    trackClicks: true,
    endpoints: {
      summary: '/api/analytics',
      visit: '/api/analytics/visit',
      click: '/api/analytics/click',
      clear: '/api/analytics/clear',
    },
  };

  let config = mergeConfig(DEFAULT_CONFIG, window.SITE_ANALYTICS_CONFIG || {});
  let visitLogged = false;
  let clickListenerBound = false;
  let memoryVisitorId = null;
  let lastVisitPromise = null;

  function mergeConfig(base, override) {
    const result = { ...base, endpoints: { ...base.endpoints } };
    if (!override || typeof override !== 'object') {
      return result;
    }

    if (Object.prototype.hasOwnProperty.call(override, 'baseUrl')) {
      result.baseUrl = override.baseUrl || '';
    }
    if (Object.prototype.hasOwnProperty.call(override, 'dataAttribute')) {
      result.dataAttribute = override.dataAttribute || DEFAULT_DATA_ATTRIBUTE;
    }
    if (Object.prototype.hasOwnProperty.call(override, 'storageKey')) {
      result.storageKey = override.storageKey || DEFAULT_STORAGE_KEY;
    }
    if (Object.prototype.hasOwnProperty.call(override, 'keepalive')) {
      result.keepalive = Boolean(override.keepalive);
    }
    if (Object.prototype.hasOwnProperty.call(override, 'trackVisitOnInit')) {
      result.trackVisitOnInit = Boolean(override.trackVisitOnInit);
    }
    if (Object.prototype.hasOwnProperty.call(override, 'trackClicks')) {
      result.trackClicks = Boolean(override.trackClicks);
    }

    const overrideEndpoints =
      override.endpoints && typeof override.endpoints === 'object'
        ? override.endpoints
        : {};
    result.endpoints = { ...result.endpoints, ...overrideEndpoints };

    if (Object.prototype.hasOwnProperty.call(override, 'summaryEndpoint')) {
      result.endpoints.summary = override.summaryEndpoint;
    }
    if (Object.prototype.hasOwnProperty.call(override, 'visitEndpoint')) {
      result.endpoints.visit = override.visitEndpoint;
    }
    if (Object.prototype.hasOwnProperty.call(override, 'clickEndpoint')) {
      result.endpoints.click = override.clickEndpoint;
    }
    if (Object.prototype.hasOwnProperty.call(override, 'clearEndpoint')) {
      result.endpoints.clear = override.clearEndpoint;
    }

    return result;
  }

  function configure(overrides) {
    config = mergeConfig(config, overrides || {});
    return getConfig();
  }

  function getConfig() {
    return {
      ...config,
      endpoints: { ...config.endpoints },
    };
  }

  function defaultData() {
    return DEFAULT_DATA();
  }

  function toDataAttributeName(name) {
    return String(name || '')
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .replace(/[^a-z0-9-]+/gi, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
  }

  function sanitizeLabel(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL_LENGTH);
  }

  function sanitizeHref(value) {
    if (!value) return null;
    return String(value).trim().slice(0, 400);
  }

  function getCurrentPath() {
    if (typeof window === 'undefined') return '/';
    const { pathname, search } = window.location || { pathname: '/', search: '' };
    const path = `${pathname || ''}${search || ''}`;
    return path || '/';
  }

  function getDatasetValue(element) {
    if (!element) return '';
    const key = config.dataAttribute || DEFAULT_DATA_ATTRIBUTE;
    if (element.dataset && Object.prototype.hasOwnProperty.call(element.dataset, key)) {
      return element.dataset[key];
    }
    const attrName = toDataAttributeName(key);
    return element.getAttribute ? element.getAttribute(`data-${attrName}`) : '';
  }

  function isFetchSupported() {
    return typeof window !== 'undefined' && typeof window.fetch === 'function';
  }

  function resolveUrl(path) {
    if (!path) {
      throw new Error('Missing endpoint path.');
    }
    const trimmed = String(path);
    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }
    const base = config.baseUrl || (typeof window !== 'undefined' ? window.location.origin : '');
    if (!base) {
      return trimmed;
    }
    if (trimmed.startsWith('/')) {
      return `${base.replace(/\/$/, '')}${trimmed}`;
    }
    return `${base.replace(/\/$/, '')}/${trimmed}`;
  }

  async function sendRequest(endpoint, body, options) {
    if (!isFetchSupported()) {
      throw new Error('Fetch API is not available in this environment.');
    }
    const requestOptions = options && typeof options === 'object' ? { ...options } : {};
    const method = (requestOptions.method || (body ? 'POST' : 'GET')).toUpperCase();
    const url = resolveUrl(endpoint);

    const headers = requestOptions.headers
      ? { ...requestOptions.headers }
      : {};
    if (method !== 'GET' && method !== 'HEAD') {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    }

    const fetchOptions = {
      method,
      headers,
      cache: 'no-store',
      credentials: requestOptions.credentials || 'omit',
    };

    if (method !== 'GET' && method !== 'HEAD') {
      fetchOptions.body = JSON.stringify(body || {});
      if (config.keepalive && method === 'POST') {
        fetchOptions.keepalive = true;
      }
    }

    const response = await window.fetch(url, fetchOptions);
    if (!response.ok) {
      const error = new Error(`Request failed with status ${response.status}`);
      error.status = response.status;
      throw error;
    }
    if (response.status === 204) {
      return null;
    }
    const text = await response.text();
    if (!text) {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch (err) {
      return null;
    }
  }

  function generateVisitorId() {
    return `v-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  }

  function getVisitorId() {
    const storageKey = config.storageKey || DEFAULT_STORAGE_KEY;
    const sessionKey = `${SESSION_KEY_PREFIX}${storageKey}`;
    if (typeof window === 'undefined') {
      if (!memoryVisitorId) {
        memoryVisitorId = generateVisitorId();
      }
      return memoryVisitorId;
    }

    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored) {
        return stored;
      }
      const id = generateVisitorId();
      window.localStorage.setItem(storageKey, id);
      return id;
    } catch (err) {
      // ignore localStorage errors
    }

    try {
      const stored = window.sessionStorage.getItem(sessionKey);
      if (stored) {
        return stored;
      }
      const id = generateVisitorId();
      window.sessionStorage.setItem(sessionKey, id);
      return id;
    } catch (err) {
      // ignore sessionStorage errors
    }

    if (!memoryVisitorId) {
      memoryVisitorId = generateVisitorId();
    }
    return memoryVisitorId;
  }

  function buildVisitPayload(overrides = {}) {
    const now = new Date().toISOString();
    const payload = {
      visitorId: overrides.visitorId || getVisitorId(),
      path: overrides.path || getCurrentPath(),
      title:
        overrides.title ||
        (typeof document !== 'undefined' && document.title ? document.title : getCurrentPath()),
      referrer:
        overrides.referrer !== undefined
          ? overrides.referrer
          : typeof document !== 'undefined' && document.referrer
            ? document.referrer
            : '',
      language:
        overrides.language ||
        (typeof navigator !== 'undefined'
          ? navigator.language || navigator.userLanguage || null
          : null),
      userAgent:
        overrides.userAgent ||
        (typeof navigator !== 'undefined' ? navigator.userAgent || null : null),
      timestamp: overrides.timestamp || now,
    };

    if (overrides.additional && typeof overrides.additional === 'object') {
      payload.additional = overrides.additional;
    }

    return payload;
  }

  function buildClickPayload(label, meta) {
    const details = meta && typeof meta === 'object' ? meta : {};
    const payload = {
      label: sanitizeLabel(details.label || label),
      visitorId: details.visitorId || getVisitorId(),
      path: details.path || getCurrentPath(),
      href: sanitizeHref(details.href || null),
      timestamp: details.timestamp || new Date().toISOString(),
      pageTitle:
        details.title ||
        (typeof document !== 'undefined' && document.title ? document.title : null),
    };

    if (!payload.href && details.element && details.element.getAttribute) {
      const attr = details.element.getAttribute('href');
      if (attr) {
        payload.href = sanitizeHref(details.element.href || attr);
      }
    }

    return payload;
  }

  function bindClickTracking() {
    if (clickListenerBound || typeof document === 'undefined') {
      return;
    }
    const selector = `[data-${toDataAttributeName(config.dataAttribute || DEFAULT_DATA_ATTRIBUTE)}]`;
    const listener = (event) => {
      let target = event.target;
      if (!target) return;
      if (typeof target.closest === 'function') {
        target = target.closest(selector);
      } else {
        while (target && target !== document && target.matches && !target.matches(selector)) {
          target = target.parentElement;
        }
        if (!target || target === document || !target.matches || !target.matches(selector)) {
          return;
        }
      }
      if (!target) return;
      const labelSource =
        getDatasetValue(target) ||
        target.getAttribute?.('aria-label') ||
        target.getAttribute?.('title') ||
        (target.textContent ? sanitizeLabel(target.textContent) : '');
      const label = sanitizeLabel(labelSource);
      if (!label) {
        return;
      }
      const hrefValue = target.getAttribute ? target.getAttribute('href') : null;
      recordClick(label, { href: hrefValue, element: target });
    };

    document.addEventListener('click', listener, true);
    clickListenerBound = true;
  }

  function init(options) {
    const currentConfig = configure(options || {});
    if (currentConfig.trackVisitOnInit !== false) {
      recordVisit({ once: true }).catch(() => {
        /* swallow */
      });
    }
    if (currentConfig.trackClicks) {
      bindClickTracking();
    }
    return getConfig();
  }

  function recordVisit(options) {
    const overrides = options && typeof options === 'object' ? { ...options } : {};
    const once = overrides.once !== false;
    if (once && visitLogged && lastVisitPromise) {
      return lastVisitPromise;
    }
    if (once) {
      visitLogged = true;
    }

    const payload = buildVisitPayload(overrides);
    lastVisitPromise = sendRequest(config.endpoints.visit, payload).catch((err) => {
      console.warn('[Analytics] Failed to record visit.', err);
      return null;
    });
    return lastVisitPromise;
  }

  function recordClick(label, meta) {
    const payload = buildClickPayload(label, meta);
    if (!payload.label) {
      return Promise.resolve(null);
    }
    return sendRequest(config.endpoints.click, payload).catch((err) => {
      console.warn('[Analytics] Failed to record click.', err);
      return null;
    });
  }

  async function getData() {
    try {
      const response = await sendRequest(config.endpoints.summary, null, {
        method: 'GET',
      });
      if (response && typeof response === 'object') {
        if (response.data && typeof response.data === 'object') {
          return response.data;
        }
        return response;
      }
    } catch (err) {
      console.warn('[Analytics] Failed to fetch analytics snapshot.', err);
    }
    return defaultData();
  }

  function exportData() {
    return getData();
  }

  async function clearData(secret) {
    const payload =
      secret && typeof secret === 'object'
        ? secret
        : { password: secret || null };
    try {
      const response = await sendRequest(config.endpoints.clear, payload, {
        method: 'POST',
      });
      if (response && typeof response === 'object') {
        return response.data || response;
      }
      return response;
    } catch (err) {
      console.warn('[Analytics] Failed to clear analytics data.', err);
      throw err;
    }
  }

  window.SiteAnalytics = {
    init,
    configure,
    getConfig,
    defaultData,
    recordVisit,
    recordEvent: recordClick,
    recordClick,
    getData,
    exportData,
    clearData,
    version: '2.0.0',
  };
})();
