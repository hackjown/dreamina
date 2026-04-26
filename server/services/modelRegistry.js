const VIDEO_MODEL_REGISTRY = {
  'seedance-2.0': {
    id: 'seedance-2.0',
    family: 'seedance',
    label: 'Seedance 2.0 Pro',
    rootModel: 'dreamina_ic_generate_video_model_vgfm_3.5_pro',
    nativeModelId: 'dreamina_ic_generate_video_model_vgfm_3.5_pro',
    benefitType: 'dreamina_video_seedance_15_pro',
    internationalBenefitType: 'dreamina_video_seedance_15_pro',
    draftVersion: '3.3.12',
    supportsInternational: true,
    zeroCreditProbeEligible: false,
    supportedInputMediaTypes: ['prompt', 'first_frame', 'end_frame'],
    aliases: ['dreamina-seedance-1.5-pro'],
  },
  'seedance-2.0-fast': {
    id: 'seedance-2.0-fast',
    family: 'seedance',
    label: 'Seedance 2.0 Fast',
    rootModel: 'dreamina_seedance_40',
    nativeModelId: 'dreamina_seedance_40',
    benefitType: 'dreamina_seedance_20_fast',
    internationalBenefitType: 'dreamina_seedance_20_fast',
    resolutionBenefitTypes: {
      '720p': 'seedance_20_fast_720p_output',
    },
    draftVersion: '3.3.12',
    supportsInternational: true,
    zeroCreditProbeEligible: true,
    supportedInputMediaTypes: ['prompt', 'first_frame', 'end_frame', 'multi_frame'],
    aliases: ['dreamina-seedance-1.0-mini'],
  },
  'dreamina-video-2.0': {
    id: 'dreamina-video-2.0',
    family: 'classic-video',
    label: 'Dreamina Video 2.0',
    rootModel: 'dreamina_ic_generate_video_model_vgfm_lite',
    nativeModelId: 'dreamina_ic_generate_video_model_vgfm_lite',
    benefitType: 'basic_video_operation_vgfm_v_three',
    draftVersion: '3.3.12',
    supportsInternational: true,
    zeroCreditProbeEligible: false,
    aliases: [],
  },
  'dreamina-video-2.0-pro': {
    id: 'dreamina-video-2.0-pro',
    family: 'classic-video',
    label: 'Dreamina Video 2.0 Pro',
    rootModel: 'dreamina_ic_generate_video_model_vgfm1.0',
    nativeModelId: 'dreamina_ic_generate_video_model_vgfm1.0',
    benefitType: 'basic_video_operation_vgfm_v_three',
    draftVersion: '3.3.12',
    supportsInternational: true,
    zeroCreditProbeEligible: false,
    aliases: [],
  },
  'dreamina-video-3.0': {
    id: 'dreamina-video-3.0',
    family: 'classic-video',
    label: 'Dreamina Video 3.0',
    rootModel: 'dreamina_ic_generate_video_model_vgfm_3.0',
    nativeModelId: 'dreamina_ic_generate_video_model_vgfm_3.0',
    benefitType: 'basic_video_operation_vgfm_v_three',
    draftVersion: '3.3.12',
    supportsInternational: true,
    zeroCreditProbeEligible: false,
    aliases: ['dreamina_seedance_2_0'],
  },
  'dreamina-video-3.0-pro': {
    id: 'dreamina-video-3.0-pro',
    family: 'classic-video',
    label: 'Dreamina Video 3.0 Pro',
    rootModel: 'dreamina_ic_generate_video_model_vgfm_3.0_pro',
    nativeModelId: 'dreamina_ic_generate_video_model_vgfm_3.0_pro',
    benefitType: 'basic_video_operation_vgfm_v_three',
    draftVersion: '3.3.12',
    supportsInternational: true,
    zeroCreditProbeEligible: false,
    aliases: [],
  },
};

const IMAGE_MODEL_REGISTRY = {
  'dreamina-image-4.1': {
    id: 'dreamina-image-4.1',
    label: 'Image 4.1',
    fallbackModel: 'dreamina-image-4.0',
    reqKeys: ['high_aes_general_v41'],
    labels: ['Image 4.1', '4.1'],
    staticMeta: {
      modelId: 'high_aes_general_v41',
      benefitType: 'image_basic_v41_2k',
      resolution: '2k',
    },
  },
  'dreamina-image-4.0': {
    id: 'dreamina-image-4.0',
    label: 'Image 4.0',
    fallbackModel: null,
    reqKeys: ['high_aes_general_v40'],
    labels: ['Image 4.0', '4.0'],
    staticMeta: {
      modelId: 'high_aes_general_v40',
      benefitType: 'image_basic_generate_piece',
      resolution: '2k',
    },
  },
};

const VIDEO_MODEL_ALIAS_MAP = new Map();
for (const definition of Object.values(VIDEO_MODEL_REGISTRY)) {
  VIDEO_MODEL_ALIAS_MAP.set(definition.id, definition.id);
  for (const alias of definition.aliases || []) {
    VIDEO_MODEL_ALIAS_MAP.set(alias, definition.id);
  }
}

export function resolveVideoModelDefinition(modelId) {
  const canonicalId = VIDEO_MODEL_ALIAS_MAP.get(modelId) || 'seedance-2.0';
  return VIDEO_MODEL_REGISTRY[canonicalId];
}

export function resolveImageModelDefinition(modelId) {
  return IMAGE_MODEL_REGISTRY[modelId] || IMAGE_MODEL_REGISTRY['dreamina-image-4.1'];
}

export function isSeedanceFamilyModel(modelId) {
  return resolveVideoModelDefinition(modelId)?.family === 'seedance';
}

export function getAllKnownModelIds() {
  return [
    ...new Set([
      ...Object.keys(VIDEO_MODEL_REGISTRY),
      ...VIDEO_MODEL_ALIAS_MAP.keys(),
      ...Object.keys(IMAGE_MODEL_REGISTRY),
    ]),
  ];
}

export { VIDEO_MODEL_REGISTRY, IMAGE_MODEL_REGISTRY };
