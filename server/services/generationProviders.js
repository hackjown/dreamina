import { generateSeedanceVideo, generateSeedanceImage } from './videoGenerator.js';

export const DREAMINA_PROVIDER_ID = 'dreamina';
export const MANUAL_DREAMINA_PROVIDER_ID = 'manual-dreamina';
export const LEGACY_JIMENG_PROVIDER_ID = 'legacy-jimeng';

export const DEFAULT_PROVIDER_ID = DREAMINA_PROVIDER_ID;

export const DREAMINA_MODEL_IDS = [
  'seedance-2.0-fast',
  'seedance-2.0',
  'dreamina-seedance-1.0-mini',
  'dreamina-seedance-1.5-pro',
  'dreamina-video-2.0',
  'dreamina-video-2.0-pro',
  'dreamina-video-3.0',
  'dreamina-video-3.0-pro',
  'dreamina-image-4.1',
  'dreamina-image-4.0',
];

export const IMAGE_MODEL_IDS = [
  'dreamina-image-4.1',
  'dreamina-image-4.0',
];

const PROVIDERS = {
  [DREAMINA_PROVIDER_ID]: {
    id: DREAMINA_PROVIDER_ID,
    label: 'Dreamina',
    requiresSession: true,
    defaultModel: 'seedance-2.0-fast',
    normalizeModel(model) {
      return DREAMINA_MODEL_IDS.includes(model) ? model : this.defaultModel;
    },
    generateVideo: generateSeedanceVideo,
    generateImage: generateSeedanceImage,
    getMissingCredentialMessage() {
      return '未配置可用的 SessionID，请在设置页添加 Dreamina 账号';
    },
  },
  [MANUAL_DREAMINA_PROVIDER_ID]: {
    id: MANUAL_DREAMINA_PROVIDER_ID,
    label: 'Dreamina (Manual Import)',
    requiresSession: false,
    defaultModel: 'seedance-2.0-fast',
    normalizeModel(model) {
      return DREAMINA_MODEL_IDS.includes(model) ? model : this.defaultModel;
    },
    async generateVideo(options) {
      await options.onProgress?.('Manual Dreamina: 使用已生成的视频 URL 作为结果...');

      const manualUrl =
        String(options?.settings?.manual_video_url || '').trim() ||
        String(process.env.MANUAL_DREAMINA_VIDEO_URL || '').trim();

      if (!manualUrl) {
        throw new Error(
          'Manual Dreamina 未配置视频 URL。请在设置页填写 manual_video_url，或设置环境变量 MANUAL_DREAMINA_VIDEO_URL。'
        );
      }

      return {
        videoUrl: manualUrl,
        revisedPrompt: options?.prompt || '',
        submitId: null,
        historyId: null,
        itemId: null,
      };
    },
    getMissingCredentialMessage() {
      return 'Manual Dreamina 不需要 SessionID，但需要一个可访问的视频 URL。';
    },
  },
  [LEGACY_JIMENG_PROVIDER_ID]: {
    id: LEGACY_JIMENG_PROVIDER_ID,
    label: 'Legacy Jimeng',
    requiresSession: true,
    defaultModel: 'seedance-2.0-fast',
    normalizeModel(model) {
      return DREAMINA_MODEL_IDS.includes(model) ? model : this.defaultModel;
    },
    generateVideo: generateSeedanceVideo,
    generateImage: generateSeedanceImage,
    getMissingCredentialMessage() {
      return '未配置可用的 SessionID，请在设置页添加 Legacy Jimeng 账号';
    },
  },
};

export function normalizeProvider(providerId) {
  return PROVIDERS[providerId] ? providerId : DEFAULT_PROVIDER_ID;
}

export function getGenerationProvider(providerId) {
  return PROVIDERS[normalizeProvider(providerId)];
}

export function getModelCategory(modelId) {
  return IMAGE_MODEL_IDS.includes(modelId) ? 'image' : 'video';
}

export function isImageModel(modelId) {
  return getModelCategory(modelId) === 'image';
}

export function getDefaultGenerationSettings() {
  return {
    provider: DEFAULT_PROVIDER_ID,
    model: PROVIDERS[DEFAULT_PROVIDER_ID].defaultModel,
    ratio: '16:9',
    duration: '5',
    reference_mode: '全能参考',
    download_path: '',
    max_concurrent: '5',
    min_interval: '30000',
    max_interval: '50000',
    manual_video_url: '',
  };
}
