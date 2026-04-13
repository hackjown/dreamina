import { listKnownRegionPrefixes } from './regionProfiles.js';

const KNOWN_REGION_PREFIXES = new Set(['us', ...listKnownRegionPrefixes()]);

function parseCookieMap(sessionValue) {
  const raw = String(sessionValue || '').trim();
  if (!raw.includes('=') || !raw.includes(';')) {
    return new Map();
  }

  const cookiePairs = raw
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);

  const cookieMap = new Map();
  for (const pair of cookiePairs) {
    const index = pair.indexOf('=');
    if (index <= 0) continue;
    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (!key || !value) continue;
    cookieMap.set(key, value);
  }

  return cookieMap;
}

export function parseRegionalSessionInput(sessionValue) {
  const raw = String(sessionValue || '').trim();
  const cookieMap = parseCookieMap(raw);

  let pureSessionId = '';
  let region = '';
  let prefixed = false;

  if (cookieMap.size > 0) {
    pureSessionId =
      cookieMap.get('sessionid_ss') ||
      cookieMap.get('sessionid') ||
      cookieMap.get('sid_tt') ||
      '';

    const cookieRegion =
      cookieMap.get('store-country-code') ||
      cookieMap.get('store-region') ||
      '';
    if (KNOWN_REGION_PREFIXES.has(String(cookieRegion).toLowerCase())) {
      region = String(cookieRegion).toLowerCase();
    }
  } else {
    const match = raw.match(/^([a-z]{2,3})-(.+)$/i);
    if (match && KNOWN_REGION_PREFIXES.has(match[1].toLowerCase())) {
      region = match[1].toLowerCase();
      pureSessionId = match[2];
      prefixed = true;
    } else {
      pureSessionId = raw;
    }
  }

  return {
    raw,
    cookieMap,
    pureSessionId: String(pureSessionId || '').trim(),
    region: region || 'us',
    prefixed,
  };
}

export function extractPureSessionId(sessionValue) {
  return parseRegionalSessionInput(sessionValue).pureSessionId;
}

export function normalizeSessionIdInput(sessionValue) {
  const info = parseRegionalSessionInput(sessionValue);
  if (!info.pureSessionId) return '';
  if (info.region !== 'us') {
    return `${info.region}-${info.pureSessionId}`;
  }
  return info.pureSessionId;
}

export function buildRegionalSessionId(sessionValue, region = 'us') {
  const pureSessionId = extractPureSessionId(sessionValue);
  const normalizedRegion = String(region || 'us').toLowerCase();
  if (!pureSessionId) return '';
  return normalizedRegion !== 'us' ? `${normalizedRegion}-${pureSessionId}` : pureSessionId;
}

export function isFullCookieString(sessionValue) {
  const raw = String(sessionValue || '').trim();
  return raw.includes('=') && raw.includes(';');
}

export function isInternationalRegion(region = 'us') {
  const normalized = String(region || 'us').toLowerCase();
  return normalized !== 'us' && normalized !== 'cn';
}

export function isUsRegion(region = 'us') {
  return String(region || 'us').toLowerCase() === 'us';
}
