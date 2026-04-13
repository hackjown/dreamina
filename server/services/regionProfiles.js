const INTERNATIONAL_REGION_MAP = {
  hk: { regionCode: 'HK', lan: 'en', loc: 'hk', storeCountryCode: 'hk', idc: 'alisg' },
  jp: { regionCode: 'JP', lan: 'ja', loc: 'jp', storeCountryCode: 'jp', idc: 'alisg' },
  sg: { regionCode: 'SG', lan: 'en', loc: 'sg', storeCountryCode: 'sg', idc: 'alisg' },
  al: { regionCode: 'AL', lan: 'en', loc: 'al', storeCountryCode: 'al', idc: 'alisg' },
  az: { regionCode: 'AZ', lan: 'en', loc: 'az', storeCountryCode: 'az', idc: 'alisg' },
  bh: { regionCode: 'BH', lan: 'en', loc: 'bh', storeCountryCode: 'bh', idc: 'alisg' },
  ca: { regionCode: 'CA', lan: 'en', loc: 'ca', storeCountryCode: 'ca', idc: 'alisg' },
  cl: { regionCode: 'CL', lan: 'en', loc: 'cl', storeCountryCode: 'cl', idc: 'alisg' },
  de: { regionCode: 'DE', lan: 'en', loc: 'de', storeCountryCode: 'de', idc: 'alisg' },
  gb: { regionCode: 'GB', lan: 'en', loc: 'gb', storeCountryCode: 'gb', idc: 'alisg' },
  gy: { regionCode: 'GY', lan: 'en', loc: 'gy', storeCountryCode: 'gy', idc: 'alisg' },
  il: { regionCode: 'IL', lan: 'en', loc: 'il', storeCountryCode: 'il', idc: 'alisg' },
  iq: { regionCode: 'IQ', lan: 'en', loc: 'iq', storeCountryCode: 'iq', idc: 'alisg' },
  it: { regionCode: 'IT', lan: 'en', loc: 'it', storeCountryCode: 'it', idc: 'alisg' },
  jo: { regionCode: 'JO', lan: 'en', loc: 'jo', storeCountryCode: 'jo', idc: 'alisg' },
  kg: { regionCode: 'KG', lan: 'en', loc: 'kg', storeCountryCode: 'kg', idc: 'alisg' },
  my: { regionCode: 'MY', lan: 'en', loc: 'my', storeCountryCode: 'my', idc: 'alisg' },
  id: { regionCode: 'ID', lan: 'en', loc: 'id', storeCountryCode: 'id', idc: 'alisg' },
  th: { regionCode: 'TH', lan: 'en', loc: 'th', storeCountryCode: 'th', idc: 'alisg' },
  om: { regionCode: 'OM', lan: 'en', loc: 'om', storeCountryCode: 'om', idc: 'alisg' },
  pk: { regionCode: 'PK', lan: 'en', loc: 'pk', storeCountryCode: 'pk', idc: 'alisg' },
  pt: { regionCode: 'PT', lan: 'en', loc: 'pt', storeCountryCode: 'pt', idc: 'alisg' },
  sa: { regionCode: 'SA', lan: 'en', loc: 'sa', storeCountryCode: 'sa', idc: 'alisg' },
  se: { regionCode: 'SE', lan: 'en', loc: 'se', storeCountryCode: 'se', idc: 'alisg' },
  tr: { regionCode: 'TR', lan: 'en', loc: 'tr', storeCountryCode: 'tr', idc: 'alisg' },
  tz: { regionCode: 'TZ', lan: 'en', loc: 'tz', storeCountryCode: 'tz', idc: 'alisg' },
  uz: { regionCode: 'UZ', lan: 'en', loc: 'uz', storeCountryCode: 'uz', idc: 'alisg' },
  ve: { regionCode: 'VE', lan: 'en', loc: 've', storeCountryCode: 've', idc: 'alisg' },
  xk: { regionCode: 'XK', lan: 'en', loc: 'xk', storeCountryCode: 'xk', idc: 'alisg' },
};

export const REGION_PROFILE_MAP = {
  cn: {
    key: 'cn',
    isCn: true,
    isUs: false,
    isInternational: false,
    regionCode: 'CN',
    requestRegion: 'cn',
    lan: 'zh-Hans',
    loc: 'cn',
    storeCountryCode: 'cn',
    idc: 'cn-gd',
    cookieDomain: '.jianying.com',
    homeUrl: 'https://jimeng.jianying.com/ai-tool/home',
    baseUrl: 'https://jimeng.jianying.com',
    commerceBaseUrls: ['https://commerce.jianying.com'],
    apiBaseUrls: ['https://jimeng.jianying.com'],
    imageXHost: 'https://imagex.bytedanceapi.com',
    imageXRegion: 'cn-north-1',
    uploadOrigin: 'https://jimeng.jianying.com',
    uploadReferer: 'https://jimeng.jianying.com/ai-tool/image/generate',
    defaultAppId: 513641,
    appVersion: '8.4.0',
    daVersion: '3.3.12',
    webVersion: '8.4.0',
    siteType: 'jimeng',
  },
  us: {
    key: 'us',
    isCn: false,
    isUs: true,
    isInternational: true,
    regionCode: 'US',
    requestRegion: 'US',
    lan: 'en',
    loc: 'us',
    storeCountryCode: 'us',
    idc: 'useast5',
    cookieDomain: '.capcut.com',
    homeUrl: 'https://dreamina.capcut.com/ai-tool/home',
    baseUrl: 'https://dreamina-api.us.capcut.com',
    commerceBaseUrls: ['https://commerce.us.capcut.com'],
    apiBaseUrls: ['https://dreamina-api.us.capcut.com'],
    imageXHost: 'https://imagex16-normal-us-ttp.capcutapi.us',
    imageXRegion: 'us-east-1',
    uploadOrigin: 'https://dreamina-api.us.capcut.com',
    uploadReferer: 'https://dreamina-api.us.capcut.com/ai-tool/video/generate',
    defaultAppId: 513641,
    appVersion: '8.4.0',
    daVersion: '3.3.12',
    webVersion: '8.4.0',
    siteType: 'dreamina',
  },
};

for (const [key, value] of Object.entries(INTERNATIONAL_REGION_MAP)) {
  REGION_PROFILE_MAP[key] = {
    key,
    isCn: false,
    isUs: false,
    isInternational: true,
    regionCode: value.regionCode,
    requestRegion: value.regionCode,
    lan: value.lan,
    loc: value.loc,
    storeCountryCode: value.storeCountryCode,
    idc: value.idc,
    cookieDomain: '.capcut.com',
    homeUrl: 'https://dreamina.capcut.com/ai-tool/home',
    baseUrl: 'https://mweb-api-sg.capcut.com',
    commerceBaseUrls: ['https://commerce-api.capcut.com', 'https://commerce-api-sg.capcut.com'],
    apiBaseUrls: ['https://mweb-api-sg.capcut.com', 'https://dreamina-api.capcut.com'],
    imageXHost: 'https://imagex-normal-sg.capcutapi.com',
    imageXRegion: 'ap-southeast-1',
    uploadOrigin: 'https://mweb-api-sg.capcut.com',
    uploadReferer: 'https://dreamina.capcut.com/ai-tool/video/generate',
    defaultAppId: 513641,
    appVersion: '8.4.0',
    daVersion: '3.3.12',
    webVersion: '8.4.0',
    siteType: 'dreamina',
  };
}

export function getRegionProfile(region = 'us') {
  const normalized = String(region || 'us').toLowerCase();
  return REGION_PROFILE_MAP[normalized] || REGION_PROFILE_MAP.us;
}

export function listKnownRegionPrefixes() {
  return Object.keys(REGION_PROFILE_MAP).filter((key) => key !== 'cn');
}

export function buildRegionAwareBaseUrls(region) {
  const profile = getRegionProfile(region);
  return {
    baseUrl: profile.baseUrl,
    commerceBaseUrl: profile.commerceBaseUrls[0],
    fallbackCommerceBaseUrls: profile.commerceBaseUrls.slice(1),
    fallbackApiBaseUrls: profile.apiBaseUrls.slice(1),
  };
}
