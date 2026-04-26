import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { generateSeedanceImage, generateSeedanceVideo } from './videoGenerator.js';
import * as jimengSessionService from './jimengSessionService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTERNAL_PATH = process.env.ECOMMERCE_SUITE_PATH
  || path.resolve(__dirname, '../ecommerce-image-suite');
const LOCAL_VENV_PYTHON = path.resolve(__dirname, '../../external/ecommerce-image-suite/venv/bin/python3');
const VENV_PYTHON = process.env.ECOMMERCE_PYTHON
  || (fs.existsSync(LOCAL_VENV_PYTHON) ? LOCAL_VENV_PYTHON : 'python3');
const ANALYZE_SCRIPT = path.join(EXTERNAL_PATH, 'scripts/analyze.py');
const GENERATE_SCRIPT = path.join(EXTERNAL_PATH, 'scripts/generate.py');

const DATA_DIR = path.resolve(__dirname, '../data/ecommerce');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const OUTPUTS_DIR = path.join(DATA_DIR, 'outputs');
const ANALYSIS_INPUTS_DIR = path.join(DATA_DIR, 'analysis-inputs');
const VIDEO_INPUTS_DIR = path.join(DATA_DIR, 'video-inputs');
const ANALYSIS_MAX_SIDE = 2048;
const VIDEO_REFERENCE_MAX_BYTES = 900 * 1024;
const VIDEO_REFERENCE_MAX_SIDES = [1280, 1024, 768, 640, 512];
const DREAMINA_ECOMMERCE_MODELS = new Set(['dreamina-image-4.1', 'dreamina-image-4.0']);
const DREAMINA_ECOMMERCE_VIDEO_MODELS = new Set([
  'seedance-2.0-fast',
  'seedance-2.0',
  'dreamina-video-2.0',
  'dreamina-video-2.0-pro',
  'dreamina-video-3.0',
  'dreamina-video-3.0-pro',
]);
let sharpModulePromise = null;
const DEFAULT_ECOMMERCE_TYPES = 'white_bg,key_features,selling_pt,material,lifestyle,model,multi_scene,ecommerce_detail';
const DEFAULT_ECOMMERCE_TYPE_LIST = [
  'white_bg',
  'key_features',
  'selling_pt',
  'material',
  'lifestyle',
  'model',
  'multi_scene',
  'ecommerce_detail',
  'three_angle_view',
];
export const TYPE_NAMES_ZH = {
  white_bg: '白底图',
  lifestyle: '场景图',
  material: '材质图',
  key_features: '核心卖点图',
  selling_pt: '卖点图',
  model: '模特展示图',
  multi_scene: '多场景拼图',
  ecommerce_detail: '电商详情图',
  three_angle_view: '三角度拼图',
};
const TYPE_FILE_KEYWORDS = {
  white_bg: ['白底', '主图'],
  lifestyle: ['场景', '展示'],
  material: ['材质', '细节'],
  key_features: ['核心卖点', '卖点'],
  selling_pt: ['卖点'],
  model: ['模特'],
  multi_scene: ['多场景'],
  ecommerce_detail: ['详情'],
  three_angle_view: ['三角度', '角度'],
};

// Ensure directories exist
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(OUTPUTS_DIR)) fs.mkdirSync(OUTPUTS_DIR, { recursive: true });
if (!fs.existsSync(ANALYSIS_INPUTS_DIR)) fs.mkdirSync(ANALYSIS_INPUTS_DIR, { recursive: true });
if (!fs.existsSync(VIDEO_INPUTS_DIR)) fs.mkdirSync(VIDEO_INPUTS_DIR, { recursive: true });

/**
 * Runs a python script and returns its output
 */
function maskArg(arg) {
  const value = String(arg || '');
  if (value.length <= 10) return '***';
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function safeLogArgs(args) {
  return args.map((arg, index) => {
    const previous = args[index - 1];
    if (previous === '--api-key') return maskArg(arg);
    return arg;
  });
}

async function runPythonScript(scriptPath, args, env = {}, options = {}) {
  const timeoutMs = options.timeoutMs || 180000;
  return new Promise((resolve, reject) => {
    console.log(`[ecommerceService] Running script: ${scriptPath} with args: ${safeLogArgs(args).join(' ')}`);
    const pythonProcess = spawn(VENV_PYTHON, [scriptPath, ...args], {
      env: { ...process.env, ...env },
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      pythonProcess.kill('SIGTERM');
      reject(new Error(`Script timed out after ${Math.round(timeoutMs / 1000)}s\nStderr: ${stderr}`));
    }, timeoutMs);

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
      console.log(`[ecommerceService] ${scriptPath} stderr: ${data.toString()}`);
    });

    pythonProcess.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`Script exited with code ${code}\nStderr: ${stderr}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

async function resizeImageForAnalysis(imagePath) {
  const ext = path.extname(imagePath).toLowerCase() || '.jpg';
  const baseName = path.basename(imagePath, ext);
  const outputPath = path.join(ANALYSIS_INPUTS_DIR, `${baseName}_max${ANALYSIS_MAX_SIDE}${ext}`);

  const sharp = await loadSharpModule();
  if (sharp) {
    try {
      const image = sharp(imagePath, { failOn: 'none' });
      const metadata = await image.metadata();
      const width = metadata.width || 0;
      const height = metadata.height || 0;
      if (!width || !height || Math.max(width, height) <= ANALYSIS_MAX_SIDE) {
        return imagePath;
      }

      await image
        .resize({
          width: width >= height ? ANALYSIS_MAX_SIDE : undefined,
          height: height > width ? ANALYSIS_MAX_SIDE : undefined,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .toFile(outputPath);
      console.log(`[ecommerceService] Analysis image resized: ${path.basename(imagePath)} -> ${path.basename(outputPath)}`);
      return outputPath;
    } catch (error) {
      console.warn(`[ecommerceService] Sharp image resize failed, trying sips: ${imagePath}. ${error.message}`);
    }
  }

  return new Promise((resolve) => {
    const process = spawn('sips', ['-Z', String(ANALYSIS_MAX_SIDE), imagePath, '--out', outputPath]);
    let stderr = '';

    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    process.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        console.log(`[ecommerceService] Analysis image resized: ${path.basename(imagePath)} -> ${path.basename(outputPath)}`);
        resolve(outputPath);
        return;
      }

      console.warn(`[ecommerceService] Image resize failed, using original: ${imagePath}. ${stderr.trim()}`);
      resolve(imagePath);
    });

    process.on('error', (error) => {
      console.warn(`[ecommerceService] Image resize unavailable, using original: ${imagePath}. ${error.message}`);
      resolve(imagePath);
    });
  });
}

async function prepareImagesForAnalysis(imagePaths) {
  const prepared = [];
  for (const imagePath of imagePaths) {
    prepared.push(await resizeImageForAnalysis(imagePath));
  }
  return prepared;
}

async function compressImageForVideoForm(imagePath) {
  const ext = path.extname(imagePath).toLowerCase() || '.jpg';
  const baseName = path.basename(imagePath, ext);
  let smallestCandidate = null;
  const sharp = await loadSharpModule();

  for (const maxSide of VIDEO_REFERENCE_MAX_SIDES) {
    const outputPath = path.join(VIDEO_INPUTS_DIR, `${baseName}_video_${maxSide}.jpg`);
    let result = { ok: false, error: 'sharp unavailable' };

    if (sharp) {
      try {
        await sharp(imagePath, { failOn: 'none' })
          .rotate()
          .resize({
            width: maxSide,
            height: maxSide,
            fit: 'inside',
            withoutEnlargement: true,
          })
          .jpeg({ quality: 70, mozjpeg: true })
          .toFile(outputPath);
        result = { ok: true, outputPath };
      } catch (error) {
        result = { ok: false, error: error.message };
      }
    }

    if (!result.ok) {
      result = await new Promise((resolve) => {
        const process = spawn('sips', [
          '-s', 'format', 'jpeg',
          '-s', 'formatOptions', '70',
          '-Z', String(maxSide),
          imagePath,
          '--out',
          outputPath,
        ]);
        let stderr = '';

        process.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        process.on('close', (code) => {
          if (code === 0 && fs.existsSync(outputPath)) {
            resolve({ ok: true, outputPath });
            return;
          }
          resolve({ ok: false, error: stderr.trim() });
        });

        process.on('error', (error) => {
          resolve({ ok: false, error: error.message });
        });
      });
    }

    if (!result.ok) {
      console.warn(`[ecommerceService] Video reference image compression failed: ${imagePath}. ${result.error || ''}`);
      break;
    }

    const size = fs.statSync(result.outputPath).size;
    if (!smallestCandidate || size < smallestCandidate.size) {
      smallestCandidate = { path: result.outputPath, size };
    }
    if (size <= VIDEO_REFERENCE_MAX_BYTES) {
      console.log(`[ecommerceService] Video reference image prepared: ${path.basename(imagePath)} -> ${path.basename(result.outputPath)} (${size} bytes)`);
      return result.outputPath;
    }
  }

  if (smallestCandidate) {
    console.warn(`[ecommerceService] Video reference image is still above ${VIDEO_REFERENCE_MAX_BYTES} bytes after compression: ${smallestCandidate.path} (${smallestCandidate.size} bytes)`);
    return smallestCandidate.path;
  }

  const originalSize = fs.statSync(imagePath).size;
  console.warn(`[ecommerceService] Using original video reference image (${originalSize} bytes): ${imagePath}`);
  return imagePath;
}

async function prepareVideoReferenceImagesForForm(productJson) {
  const imagePaths = extractProductReferenceImages(productJson).slice(0, 3);
  const prepared = [];
  for (const imagePath of imagePaths) {
    prepared.push(await compressImageForVideoForm(imagePath));
  }
  return prepared;
}

function extractProductReferenceImages(productJson) {
  const candidates = [
    productJson?.__source_images,
    productJson?.source_image_paths,
    productJson?.sourceImages,
  ];

  for (const value of candidates) {
    if (Array.isArray(value)) {
      return value.filter(imagePath => typeof imagePath === 'string' && fs.existsSync(imagePath));
    }
  }

  return [];
}

function stripPrivateProductMetadata(productJson) {
  if (!productJson || typeof productJson !== 'object') return productJson;
  const {
    __source_images,
    source_image_paths,
    sourceImages,
    ...productForPrompt
  } = productJson;
  return productForPrompt;
}

function withReferenceImages(productJson, imagePaths) {
  return {
    ...productJson,
    __source_images: imagePaths,
  };
}

function preferGeneratedWhiteBgReference(productJson, taskOutputDir, typeId) {
  if (typeId === 'white_bg') return productJson;
  const whiteBgFile = findGeneratedFileByType(taskOutputDir, 'white_bg');
  if (!whiteBgFile) return productJson;
  return withReferenceImages(productJson, [path.join(taskOutputDir, whiteBgFile)]);
}

function isInsideDirectory(filePath, directory) {
  const resolvedFile = path.resolve(filePath);
  const resolvedDirectory = path.resolve(directory);
  return resolvedFile === resolvedDirectory || resolvedFile.startsWith(`${resolvedDirectory}${path.sep}`);
}

function buildUploadSourceImageRecords(productJson) {
  return extractProductReferenceImages(productJson)
    .filter((imagePath) => isInsideDirectory(imagePath, UPLOADS_DIR))
    .map((imagePath) => {
      const fileName = path.basename(imagePath);
      return {
        name: fileName,
        url: `/api/ecommerce/upload/${encodeURIComponent(fileName)}`,
      };
    });
}

function saveUploadSourceImagesMetadata(taskOutputDir, productJson) {
  const sourceImages = buildUploadSourceImageRecords(productJson);
  if (!sourceImages.length) return;
  fs.writeFileSync(
    path.join(taskOutputDir, 'source_images.json'),
    JSON.stringify(sourceImages, null, 2)
  );
}

function readUploadSourceImagesMetadata(taskOutputDir) {
  const sourceImagesPath = path.join(taskOutputDir, 'source_images.json');
  if (!fs.existsSync(sourceImagesPath)) return [];
  try {
    const sourceImages = JSON.parse(fs.readFileSync(sourceImagesPath, 'utf8'));
    return Array.isArray(sourceImages)
      ? sourceImages.filter((item) => item?.name && item?.url)
      : [];
  } catch {
    return [];
  }
}

function readGenerateSummary(taskOutputDir) {
  const summaryPath = path.join(taskOutputDir, 'generate_result.json');
  if (!fs.existsSync(summaryPath)) return null;

  try {
    return JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  } catch (error) {
    console.warn(`[ecommerceService] Failed to parse generate summary: ${error.message}`);
    return null;
  }
}

function getRequestedTypeList(types = DEFAULT_ECOMMERCE_TYPES) {
  const typeList = String(types || DEFAULT_ECOMMERCE_TYPES)
    .split(',')
    .map((type) => type.trim())
    .filter(Boolean);
  return typeList.length ? typeList : DEFAULT_ECOMMERCE_TYPE_LIST.slice();
}

function getImageFileTypeRank(fileName, typeList = DEFAULT_ECOMMERCE_TYPE_LIST) {
  const name = path.basename(fileName, path.extname(fileName));
  const exactRank = typeList.findIndex((typeId) => {
    const zhName = TYPE_NAMES_ZH[typeId];
    return Boolean((zhName && name === zhName) || name === typeId);
  });
  if (exactRank !== -1) return exactRank;

  const rank = typeList.findIndex((typeId) => {
    const keywords = TYPE_FILE_KEYWORDS[typeId] || [];
    return keywords.filter(Boolean).some((keyword) => name.includes(keyword));
  });
  return rank === -1 ? Number.MAX_SAFE_INTEGER : rank;
}

function inferGeneratedImageType(fileName, typeList = DEFAULT_ECOMMERCE_TYPE_LIST) {
  const name = path.basename(fileName, path.extname(fileName));
  const exactType = typeList.find((typeId) => {
    const zhName = TYPE_NAMES_ZH[typeId];
    return Boolean((zhName && name === zhName) || name === typeId);
  });
  if (exactType) return exactType;

  return typeList.find((typeId) => {
    const keywords = TYPE_FILE_KEYWORDS[typeId] || [];
    return keywords.filter(Boolean).some((keyword) => name.includes(keyword));
  }) || '';
}

function orderGeneratedImageFiles(files, types = DEFAULT_ECOMMERCE_TYPES) {
  const typeList = getRequestedTypeList(types);
  return files.slice().sort((a, b) => {
    const rankA = getImageFileTypeRank(a, typeList);
    const rankB = getImageFileTypeRank(b, typeList);
    if (rankA !== rankB) return rankA - rankB;
    return a.localeCompare(b, 'zh-CN');
  });
}

function listGeneratedImageFiles(taskOutputDir, types = DEFAULT_ECOMMERCE_TYPES) {
  const files = fs.readdirSync(taskOutputDir).filter(f => {
    const stats = fs.statSync(path.join(taskOutputDir, f));
    if (stats.isDirectory()) return false;
    const ext = path.extname(f).toLowerCase();
    return ['.jpg', '.jpeg', '.png', '.webp'].includes(ext);
  });
  return orderGeneratedImageFiles(files, types);
}

function filesToResponse(taskId, files) {
  return files.map(f => {
    const filePath = path.join(OUTPUTS_DIR, String(taskId), f);
    const updatedAt = fs.existsSync(filePath) ? Math.round(fs.statSync(filePath).mtimeMs) : Date.now();
    return {
      name: f,
      type: inferGeneratedImageType(f),
      updatedAt,
      url: `/api/ecommerce/output/${taskId}/${encodeURIComponent(f)}?v=${updatedAt}`
    };
  });
}

async function loadSharpModule() {
  if (!sharpModulePromise) {
    sharpModulePromise = (async () => {
      try {
        return (await import('sharp')).default;
      } catch {
        return null;
      }
    })();
  }
  return sharpModulePromise;
}

function escapeSvgText(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getSellingPointTitle(productJson, index) {
  const point = Array.isArray(productJson?.selling_points) ? productJson.selling_points[index] : null;
  if (typeof point === 'string') return point;
  return point?.zh || point?.title || point?.name || '';
}

function buildMultiSceneOverlayText(productJson) {
  const scenes = Array.isArray(productJson?.target_scenes)
    ? productJson.target_scenes.map((item) => asString(item)).filter(Boolean)
    : [];
  const title =
    getSellingPointTitle(productJson, 2) ||
    getSellingPointTitle(productJson, 0) ||
    asString(productJson?.product_style) ||
    '多场景百搭';
  const labels = [
    scenes[0] || '日常通勤',
    scenes[1] || '周末出游',
    scenes[2] || asString(productJson?.product_style) || '休闲穿搭',
  ].map((label) => label.slice(0, 8));
  return { title: title.slice(0, 10), labels };
}

async function postProcessMultiSceneText(imagePath, productJson) {
  const sharp = await loadSharpModule();
  if (!sharp) {
    console.warn('[ecommerceService] sharp 不可用，跳过多场景拼图文字后处理');
    return false;
  }
  if (!imagePath || !fs.existsSync(imagePath)) return false;

  const image = sharp(imagePath);
  const metadata = await image.metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  if (!width || !height) return false;

  const { title, labels } = buildMultiSceneOverlayText(productJson);
  const titleSize = Math.max(42, Math.round(width * 0.066));
  const labelSize = Math.max(30, Math.round(width * 0.047));
  const titleY = Math.round(height * 0.125);
  const labelY = Math.round(height * 0.91);
  const bottomBandTop = Math.round(height * 0.78);
  const topBandHeight = Math.round(height * 0.25);
  const labelXs = [Math.round(width / 6), Math.round(width / 2), Math.round(width * 5 / 6)];

  const svg = `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${width}" height="${topBandHeight}" fill="#f7f7f4"/>
  <rect x="0" y="${bottomBandTop}" width="${width}" height="${height - bottomBandTop}" fill="#f7f7f4"/>
  <text x="${Math.round(width / 2)}" y="${titleY}" text-anchor="middle"
    font-family="PingFang SC, Hiragino Sans GB, STHeiti, Noto Sans CJK SC, sans-serif"
    font-size="${titleSize}" font-weight="700" fill="#1f2329">${escapeSvgText(title)}</text>
  ${labels.map((label, index) => `
  <text x="${labelXs[index]}" y="${labelY}" text-anchor="middle"
    font-family="PingFang SC, Hiragino Sans GB, STHeiti, Noto Sans CJK SC, sans-serif"
    font-size="${labelSize}" font-weight="600" fill="#1f2329">${escapeSvgText(label)}</text>`).join('')}
</svg>`;

  const outputBuffer = await image
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 94 })
    .toBuffer();
  fs.writeFileSync(imagePath, outputBuffer);
  return true;
}

function asString(value, fallback = '') {
  if (typeof value === 'string') return value.trim();
  if (value == null) return fallback;
  return String(value).trim();
}

function asStringArray(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => asString(item))
      .filter(Boolean);
  }
  const text = asString(value);
  return text ? [text] : [];
}

function normalizeAnalysisSellingPoints(sellingPoints) {
  if (!Array.isArray(sellingPoints)) return [];
  return sellingPoints
    .map((point) => {
      if (typeof point === 'string') {
        const [title, ...descParts] = point.split(/[：:]/);
        return {
          icon: 'check',
          zh: asString(title || point),
          en: '',
          zh_desc: asString(descParts.join('：')),
          en_desc: '',
          visual_keywords: [],
        };
      }

      if (!point || typeof point !== 'object') return null;
      return {
        icon: asString(point.icon, 'check'),
        zh: asString(point.zh || point.title || point.name),
        en: asString(point.en),
        zh_desc: asString(point.zh_desc || point.description || point.desc),
        en_desc: asString(point.en_desc),
        visual_keywords: asStringArray(point.visual_keywords || point.keywords),
      };
    })
    .filter((point) => point && (point.zh || point.zh_desc));
}

function normalizeAnalysisResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  const productName = asString(result.product_name || result.product_name_zh, '未命名商品');
  const productNameZh = asString(result.product_name_zh || result.product_name, productName);
  const productStyle = asString(result.product_style || result.style, '电商商品');
  const printDesign = asString(result.print_design);
  const description = asString(
    result.product_description_for_prompt || result.product_description || result.description || printDesign,
    productName
  );

  return {
    ...result,
    product_name: productName,
    product_name_zh: productNameZh,
    product_description_for_prompt: description,
    product_type: asString(result.product_type, '商品'),
    visual_features: asStringArray(result.visual_features),
    selling_points: normalizeAnalysisSellingPoints(result.selling_points),
    product_style: productStyle,
    color: asString(result.color),
    material: asString(result.material),
    style: asString(result.style || productStyle),
    print_design: printDesign,
  };
}

function isDreaminaEcommerceProvider(provider, baseUrl, model) {
  const providerText = String(provider || '').toLowerCase();
  const baseUrlText = String(baseUrl || '').toLowerCase();
  const modelText = String(model || '').toLowerCase();
  return (
    providerText === 'dreamina' ||
    providerText === 'jimeng' ||
    providerText === 'internal-dreamina' ||
    baseUrlText === 'dreamina' ||
    modelText.startsWith('dreamina-image')
  );
}

function isDreaminaEcommerceVideoProvider(provider, baseUrl, model) {
  const providerText = String(provider || '').toLowerCase();
  const baseUrlText = String(baseUrl || '').toLowerCase();
  const modelText = String(model || '').toLowerCase();
  return (
    providerText === 'dreamina' ||
    providerText === 'jimeng' ||
    providerText === 'internal-dreamina' ||
    baseUrlText === 'dreamina' ||
    modelText.startsWith('seedance') ||
    modelText.startsWith('dreamina-video')
  );
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg';
}

function buildReferenceFiles(imagePaths, typeId) {
  const slot = typeId === 'material' && imagePaths.length > 1 ? 1 : 0;
  const orderedPaths = [
    imagePaths[slot],
    ...imagePaths.filter((_, index) => index !== slot),
  ].filter(Boolean).slice(0, 5);

  return orderedPaths.map((imagePath) => {
    const buffer = fs.readFileSync(imagePath);
    return {
      buffer,
      originalname: path.basename(imagePath),
      mimetype: getMimeType(imagePath),
      size: buffer.length,
    };
  });
}

function normalizeSellingPoints(sellingPoints) {
  if (!Array.isArray(sellingPoints)) return [];
  return sellingPoints
    .map((point) => {
      if (typeof point === 'string') return point;
      return [point?.zh, point?.zh_desc].filter(Boolean).join('：');
    })
    .filter(Boolean);
}

function buildEcommerceDesignGuide(lang) {
  if (lang === 'en') {
    return [
      'Typography and color: use premium brand-catalog typography, refined medium-weight title text and clean regular/medium body text.',
      'Never render font names or typography labels as visible text.',
      'Use adaptive premium colors: charcoal instead of pure black on light backgrounds, ivory/soft white on dark or photo backgrounds, plus one restrained accent sampled from the product or brand mood.',
      'Avoid neon colors, over-saturated red/yellow sale badges, cheap promotional styling, oversized poster-like type, and heavy shadows.',
      'Place text only in clear negative space; do not cover product details; visible text should occupy no more than 25% of the image.',
    ].join('\n');
  }
  return [
    '字体与颜色：使用高级品牌画册感排版，标题为精致中等字重，正文为清晰常规/中等字重，不使用粗黑大字报风格。',
    '禁止把字体名称或排版标签画成可见文字。',
    '颜色按商品和背景自适应：浅底用深炭黑而非纯黑，暗色/照片背景用象牙白或柔和白，只使用一个克制的商品同色系或品牌感点缀色。',
    '避免霓虹色、高饱和红黄促销徽章、廉价促销风、过大的海报字和厚重阴影。',
    '文字只能放在留白区域，不遮挡商品关键细节；可见文字面积不超过画面的 25%。',
  ].join('\n');
}

function buildDreaminaPrompt(typeId, productJson, lang) {
  const productName = productJson?.product_name || productJson?.product_name_zh || '商品';
  const description = productJson?.product_description_for_prompt || productJson?.print_design || '';
  const sellingPoints = normalizeSellingPoints(productJson?.selling_points);
  const base = [
    `商品：${productName}`,
    description ? `外观：${description}` : '',
    productJson?.print_design ? `印花/文字/包装细节：${productJson.print_design}` : '',
    sellingPoints.length ? `卖点：${sellingPoints.join('；')}` : '',
    '必须严格参考上传商品图，保持商品外形、颜色、图案、文字位置、材质质感一致，不重新设计商品。',
  ].filter(Boolean).join('\n');

  const typePrompts = {
    white_bg: '生成电商白底主图，纯白或接近纯白背景，商品单独居中展示，柔和棚拍光，轻微自然阴影。画面中只允许商品本体，禁止出现抹布、餐巾、桌面、木板、植物、杯垫、书本、包装盒、手、装饰物或任何其他道具，不添加额外文字。',
    lifestyle: '生成高端电商场景图，场景应匹配商品品类和目标人群，背景可以变化，但商品本体必须和参考图一致。',
    material: '生成材质细节图，突出商品真实材质、纹理、工艺、结构和表面质感，近景商业摄影。',
    key_features: `生成核心卖点图，保留商品真实外观，可加入简洁中文卖点排版：${sellingPoints.slice(0, 3).join('、') || '品质包装、典雅设计、送礼体面'}。`,
  };

  const textLanguage = lang === 'en' ? 'Use English only for any visible text.' : '如需画面文字，仅使用简体中文。';
  return `${base}\n\n任务：${typePrompts[typeId] || typePrompts.white_bg}\n${textLanguage}\n${buildEcommerceDesignGuide(lang)}\n真实商业摄影，高级电商质感，清晰锐利，避免夸张变形。`;
}

function buildDreaminaSetPrompt(typeList, productJson, lang) {
  const productName = productJson?.product_name || productJson?.product_name_zh || '商品';
  const description = productJson?.product_description_for_prompt || productJson?.print_design || '';
  const sellingPoints = normalizeSellingPoints(productJson?.selling_points);
  const requestedNames = typeList.map((typeId) => TYPE_NAMES_ZH[typeId] || typeId);
  const typeGuide = typeList.map((typeId, index) => {
    const name = TYPE_NAMES_ZH[typeId] || typeId;
    if (typeId === 'white_bg') return `${index + 1}. ${name}：纯白或接近纯白背景主图，商品单独居中展示，柔和棚拍光，轻微自然阴影。只允许商品本体，禁止抹布、餐巾、桌面、木板、植物、杯垫、书本、包装盒、手、装饰物或任何其他道具，不添加文字。忽略原始描述中的木桌、布料、自然光等场景信息。`;
    if (typeId === 'lifestyle') return `${index + 1}. ${name}：高端电商场景图，场景匹配商品品类和目标人群，背景可变化，商品本体必须和参考图一致。`;
    if (typeId === 'material') return `${index + 1}. ${name}：近景突出商品真实材质、纹理、工艺、结构和表面质感。`;
    if (typeId === 'key_features') return `${index + 1}. ${name}：核心卖点图，可加入简洁中文卖点：${sellingPoints.slice(0, 3).join('、') || '品质包装、典雅设计、送礼体面'}。`;
    return `${index + 1}. ${name}：专业电商物料图。`;
  }).join('\n');
  const textLanguage = lang === 'en' ? 'Use English only for any visible text.' : '如需画面文字，仅使用简体中文。';

  return [
    `商品：${productName}`,
    description ? `外观：${description}` : '',
    productJson?.print_design ? `印花/文字/包装细节：${productJson.print_design}` : '',
    sellingPoints.length ? `卖点：${sellingPoints.join('；')}` : '',
    '必须严格参考上传商品图，保持商品外形、颜色、图案、文字位置、材质质感一致，不重新设计商品。',
    `请一次生成 ${typeList.length} 张不同用途的电商物料图，依次覆盖：${requestedNames.join('、')}。`,
    typeGuide,
    textLanguage,
    buildEcommerceDesignGuide(lang),
    '真实商业摄影，高级电商质感，清晰锐利，避免夸张变形。每张图都要像同一款真实商品的不同电商物料。',
  ].filter(Boolean).join('\n');
}

function clampPromoVideoDuration(duration) {
  const numeric = Number.parseInt(String(duration || 5), 10);
  if ([5, 10, 15].includes(numeric)) return numeric;
  return 5;
}

function normalizeOpenAiCompatibleVideoSeconds(duration) {
  const durationValue = clampPromoVideoDuration(duration);
  if (durationValue === 5) return 6;
  if (durationValue === 15) return 16;
  return durationValue;
}

function buildPromoVideoPrompt(productJson, duration = 5, lang = 'zh') {
  const productName = productJson?.product_name || productJson?.product_name_zh || '商品';
  const description = productJson?.product_description_for_prompt || productJson?.print_design || '';
  const sellingPoints = normalizeSellingPoints(productJson?.selling_points);
  const voiceoverScript = buildPromoVideoVoiceover(productJson, duration, lang);
  const durationValue = clampPromoVideoDuration(duration);
  const shotCount = durationValue === 5 ? 3 : durationValue === 10 ? 5 : 7;
  const textLanguage = lang === 'en'
    ? 'Use concise English for any visible text.'
    : '如需画面文字，仅使用简体中文，文字简洁清晰。';

  const storyboard = [
    '开场：商品从干净电商棚拍光中出现，镜头缓慢推进，突出整体外观。',
    '中段：切到高端生活/送礼场景，展示商品摆放在雅致环境中，背景有轻微运动和景深。',
    '细节：近景扫过材质、颜色、包装纹理、印花或文字位置，保持商品与参考图一致。',
    '卖点：以克制的电商信息图方式呈现 1-3 个核心卖点，不遮挡商品。',
    '收尾：商品回到画面中心，形成适合作为商品宣传片结尾的定格构图。',
  ];

  return [
    `为电商商品生成 ${durationValue} 秒宣传短视频。`,
    `商品：${productName}`,
    description ? `外观与包装：${description}` : '',
    productJson?.print_design ? `必须保留印花/文字/包装细节：${productJson.print_design}` : '',
    sellingPoints.length ? `核心卖点：${sellingPoints.slice(0, 4).join('；')}` : '',
    '上传图片就是视频的真实第一帧和唯一主体参考。请从这张图片自然延展成连续视频，而不是重新生成另一只杯子或另一个画面。',
    '整段视频必须始终使用上传图片中的同一个杯子、同一个杯身比例、同一个杯口形状、同一个杯底宽度、同一个琥珀色把手大小和弧度、同一种透明锤纹玻璃肌理。',
    '不要重新设计商品，不要替换成其他杯型，不要改变杯身比例，不要把把手放大或改成不同形状。不要在后续镜头切换成与首帧无关的新场景或新商品；只能让首帧里的商品做轻微镜头推进、平移、光影流动、景深变化。',
    'If an input image is provided, treat it as the exact first frame. Continue that exact image into motion. Preserve the same object identity, shape, handle, texture, color, camera angle and composition throughout the whole video.',
    `镜头设计：${storyboard.slice(0, Math.min(storyboard.length, shotCount)).join(' ')}`,
    lang === 'en'
      ? `Generate native voiceover audio matching the on-screen text. Voiceover script: ${voiceoverScript}`
      : `请直接生成带中文语音旁白的视频，旁白要与画面文字/卖点对应，不要只生成背景音乐。旁白脚本：${voiceoverScript}`,
    textLanguage,
    '真实商业摄影质感，柔和棚拍光，高级电商视觉，运动自然稳定，避免夸张变形、不要改变商品结构、不要生成无关品牌标识。主体商品在每个镜头中都必须与首帧参考图保持同款同形同角度。',
  ].filter(Boolean).join('\n');
}

function buildPromoVideoVoiceover(productJson, duration = 5, lang = 'zh') {
  const productName = productJson?.product_name_zh || productJson?.product_name || '这款商品';
  const points = normalizeSellingPoints(productJson?.selling_points)
    .map((point) => point.replace(/[：:]/g, '，'))
    .slice(0, duration >= 10 ? 3 : 2);

  if (lang === 'en') {
    const englishPoints = (productJson?.selling_points || [])
      .map((point) => point?.en_desc || point?.en || '')
      .filter(Boolean)
      .slice(0, duration >= 10 ? 3 : 2);
    return [
      `Meet ${productJson?.product_name || 'this product'}.`,
      ...englishPoints,
      'A refined choice for everyday use.',
    ].filter(Boolean).join(' ');
  }

  return [
    `这款${productName}，简约耐看，质感清透。`,
    ...points,
    '居家办公都适合，让日常饮用更有仪式感。',
  ].filter(Boolean).join(' ');
}

async function downloadImageToFile(imageUrl, outputPath, timeoutMs = 60000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(imageUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`下载即梦生成图片失败: HTTP ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(outputPath, buffer);
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`下载即梦生成图片超时（${Math.round(timeoutMs / 1000)} 秒）`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function buildSavedSessionFallbackCandidates(userId) {
  if (!userId) return [];
  return jimengSessionService
    .listUserAccounts(userId)
    .filter((account) => !account?.isVirtual && String(account?.sessionId || '').trim())
    .map((account) => account.sessionId);
}

function resolveVideoEndpointCandidates(baseUrl) {
  const clean = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!clean) return [];
  if (/\/videos\/generations$|\/video\/generations$|\/videos$/.test(clean)) return [clean];
  return [
    `${clean}/videos`,
    `${clean}/videos/generations`,
    `${clean}/video/generations`,
  ];
}

function findFirstStringByKeys(value, keys) {
  if (!value || typeof value !== 'object') return '';
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstStringByKeys(item, keys);
      if (found) return found;
    }
    return '';
  }

  for (const key of keys) {
    const item = value[key];
    if (typeof item === 'string' && item.trim()) return item.trim();
  }

  for (const item of Object.values(value)) {
    const found = findFirstStringByKeys(item, keys);
    if (found) return found;
  }

  return '';
}

function extractOpenAiCompatibleVideoUrl(payload) {
  return findFirstStringByKeys(payload, [
    'video_url',
    'videoUrl',
    'download_url',
    'downloadUrl',
    'output_url',
    'outputUrl',
    'url',
  ]);
}

function extractOpenAiCompatibleTaskId(payload) {
  return findFirstStringByKeys(payload, ['task_id', 'taskId', 'id', 'generation_id']);
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 120000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }
    return { response, json, text };
  } finally {
    clearTimeout(timer);
  }
}

async function downloadBinaryWithHeaders(url, outputPath, headers = {}, timeoutMs = 300000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`下载视频内容失败: HTTP ${response.status}${text ? ` ${text.slice(0, 300)}` : ''}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(outputPath, buffer);
    return buffer.length;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`下载视频内容超时（${Math.round(timeoutMs / 1000)} 秒）`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function generateOpenAiCompatiblePromoVideo({
  productJson,
  prompt,
  provider = 'openai',
  apiKey = '',
  baseUrl = '',
  model = '',
  duration = 5,
  ratio = '16:9',
  taskId = Date.now().toString(),
  taskOutputDir = '',
  onProgress,
}) {
  const endpointCandidates = resolveVideoEndpointCandidates(baseUrl);
  if (endpointCandidates.length === 0) {
    throw new Error('OpenAI 兼容视频接口缺少 API 地址');
  }

  const referenceImages = await prepareVideoReferenceImagesForForm(productJson);
  const headers = {
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const durationValue = clampPromoVideoDuration(duration);
  const requestSeconds = normalizeOpenAiCompatibleVideoSeconds(duration);
  const requestSize = ratio === '9:16' ? '1024x1792' : '1792x1024';
  const voiceoverScript = buildPromoVideoVoiceover(productJson, durationValue);
  const buildFormDataBody = () => {
    const formData = new FormData();
    formData.set('model', model || 'video');
    formData.set('prompt', prompt);
    formData.set('seconds', String(requestSeconds));
    formData.set('duration', String(requestSeconds));
    formData.set('duration_seconds', String(requestSeconds));
    formData.set('size', requestSize);
    formData.set('resolution_name', '720p');
    formData.set('preset', 'normal');
    formData.set('ratio', ratio);
    formData.set('n', '1');
    formData.set('response_format', 'url');
    formData.set('generate_audio', 'true');
    formData.set('audio', 'true');
    formData.set('with_audio', 'true');
    formData.set('audio_prompt', voiceoverScript);
    formData.set('narration_prompt', voiceoverScript);
    formData.set('voiceover', voiceoverScript);
    formData.set('speech_text', voiceoverScript);
    for (const imagePath of referenceImages) {
      const buffer = fs.readFileSync(imagePath);
      const blob = new Blob([buffer], { type: getMimeType(imagePath) });
      const filename = path.basename(imagePath);
      formData.append('images', blob, filename);
    }
    return formData;
  };

  let lastError = null;
  const attempts = [];
  for (const endpoint of endpointCandidates) {
    try {
      onProgress?.(`正在提交 OpenAI 兼容视频任务：${endpoint}`);
      const { response, json, text } = await fetchJsonWithTimeout(endpoint, {
        method: 'POST',
        headers,
        body: buildFormDataBody(),
      }, 300000);

      if (!response.ok) {
        attempts.push({ endpoint, status: response.status, response: text.slice(0, 1000) });
        lastError = new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
        continue;
      }

      const directUrl = extractOpenAiCompatibleVideoUrl(json);
      if (directUrl) {
        return {
          videoUrl: directUrl,
          prompt,
          provider,
          model,
          duration: clampPromoVideoDuration(duration),
          raw: json,
        };
      }

      const remoteTaskId = extractOpenAiCompatibleTaskId(json);
      if (!remoteTaskId) {
        throw new Error(`接口已响应但没有返回视频 URL 或任务 ID：${JSON.stringify(json).slice(0, 500)}`);
      }
      console.log(`[ecommerceService] OpenAI compatible video submitted: ${remoteTaskId}`);
      onProgress?.(`OpenAI 兼容视频任务已提交：${remoteTaskId}`);

      const pollBase = endpoint.replace(/\/videos\/generations$|\/video\/generations$|\/videos$/, '');
      const pollUrls = [
        `${pollBase}/videos/${remoteTaskId}`,
        `${pollBase}/video/${remoteTaskId}`,
        `${pollBase}/tasks/${remoteTaskId}`,
        `${pollBase}/generations/${remoteTaskId}`,
      ];
      const deadline = Date.now() + 25 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        for (const pollUrl of pollUrls) {
          const { response: pollResponse, json: pollJson } = await fetchJsonWithTimeout(pollUrl, { headers }, 60000);
          if (!pollResponse.ok) continue;
          const videoUrl = extractOpenAiCompatibleVideoUrl(pollJson);
          if (videoUrl) {
            return {
              videoUrl,
              prompt,
              provider,
              model,
              duration: clampPromoVideoDuration(duration),
              taskId: remoteTaskId,
              raw: pollJson,
            };
          }
          const status = String(pollJson?.status || pollJson?.state || '').toLowerCase();
          const progressValue = pollJson?.progress ?? pollJson?.percent ?? pollJson?.percentage;
          const progressText = progressValue !== undefined ? ` progress=${progressValue}` : '';
          console.log(`[ecommerceService] OpenAI compatible video poll ${remoteTaskId}: status=${status || 'unknown'}${progressText}`);
          onProgress?.(`OpenAI 兼容视频任务生成中：${remoteTaskId}${status ? ` ${status}` : ''}${progressText}`);
          if (['failed', 'error', 'cancelled', 'canceled'].includes(status)) {
            throw new Error(pollJson?.error?.message || pollJson?.error || 'OpenAI 兼容视频任务失败');
          }
          if (['completed', 'succeeded', 'success', 'done'].includes(status)) {
            const contentUrl = `${pollBase}/videos/${remoteTaskId}/content`;
            if (!taskOutputDir) {
              return {
                videoUrl: contentUrl,
                prompt,
                provider,
                model,
                duration: clampPromoVideoDuration(duration),
                taskId: remoteTaskId,
                raw: pollJson,
              };
            }

            const fileName = 'promo_video.mp4';
            const outputPath = path.join(taskOutputDir, fileName);
            onProgress?.(`正在下载 OpenAI 兼容视频结果：${remoteTaskId}`);
            const size = await downloadBinaryWithHeaders(contentUrl, outputPath, headers);
            console.log(`[ecommerceService] OpenAI compatible video downloaded: ${remoteTaskId} -> ${outputPath} (${size} bytes)`);
            return {
              videoUrl: `/api/ecommerce/output/${taskId}/${fileName}`,
              prompt,
              provider,
              model,
              duration: clampPromoVideoDuration(duration),
              taskId: remoteTaskId,
              raw: { ...pollJson, contentUrl, localFile: outputPath, size, voiceoverScript, generateAudio: true },
            };
          }
        }
        onProgress?.(`OpenAI 兼容视频任务生成中：${remoteTaskId}`);
      }

      throw new Error('OpenAI 兼容视频任务轮询超时');
    } catch (error) {
      attempts.push({ endpoint, error: error.message });
      lastError = error;
    }
  }

  const methodNotSupported = attempts.length > 0 && attempts.every((item) => [404, 405].includes(Number(item.status)));
  const error = methodNotSupported
    ? new Error(`当前 OpenAI 兼容服务不支持视频生成端点（已尝试 ${endpointCandidates.join('、')}，均返回 404/405）。请换用支持视频生成的 Base URL，或在电商视频接口中选择 Dreamina / 即梦国际。`)
    : (lastError || new Error('OpenAI 兼容视频接口调用失败'));
  error.attempts = attempts;
  throw error;
}

async function generateImagesWithDreamina(productJson, options, taskOutputDir) {
  const {
    model = 'dreamina-image-4.1',
    lang = 'zh',
    types = DEFAULT_ECOMMERCE_TYPES,
    userId = null,
  } = options;

  const requestedModel = DREAMINA_ECOMMERCE_MODELS.has(model) ? model : 'dreamina-image-4.1';
  const typeList = getRequestedTypeList(types);
  const productReferenceImages = extractProductReferenceImages(productJson);
  const productForPrompt = stripPrivateProductMetadata(productJson);
  const resolvedSession = userId ? jimengSessionService.resolveEffectiveSession(userId) : null;
  const fallbackSessionCandidates = buildSavedSessionFallbackCandidates(userId);
  const results = {};

  fs.writeFileSync(path.join(taskOutputDir, 'product.json'), JSON.stringify(productForPrompt, null, 2));

  if (typeList.length > 1) {
    const prompt = buildDreaminaSetPrompt(typeList, productForPrompt, lang);
    const files = productReferenceImages.length ? buildReferenceFiles(productReferenceImages, typeList[0]) : [];
    console.log(`[ecommerceService] Dreamina generating ecommerce set (${typeList.join(',')}) with ${files.length} reference image(s)`);
    try {
      const result = await generateSeedanceImage({
        prompt,
        ratio: '1:1',
        count: Math.min(typeList.length, 4),
        files,
        sessionId: resolvedSession?.sessionId || '',
        fallbackSessionCandidates,
        model: requestedModel,
        providerId: 'dreamina',
        onProgress: (progress) => console.log(`[ecommerceService] Dreamina set: ${progress}`),
      });
      const imageUrls = Array.isArray(result?.imageUrls) && result.imageUrls.length
        ? result.imageUrls
        : [result?.imageUrl].filter(Boolean);

      for (let index = 0; index < typeList.length; index++) {
        const typeId = typeList[index];
        const zhName = TYPE_NAMES_ZH[typeId] || typeId;
        const imageUrl = imageUrls[index];
        if (!imageUrl) {
          results[typeId] = { status: 'error', error: '即梦返回图片数量不足', name: zhName };
          continue;
        }

        const outPath = path.join(taskOutputDir, `${zhName}.jpg`);
        await downloadImageToFile(imageUrl, outPath);
        results[typeId] = { status: 'ok', path: outPath, name: zhName, sourceUrl: imageUrl };
      }
    } catch (error) {
      for (const typeId of typeList) {
        const zhName = TYPE_NAMES_ZH[typeId] || typeId;
        results[typeId] = { status: 'error', error: error.message, name: zhName };
      }
      console.error('[ecommerceService] Dreamina ecommerce set failed:', error);
    }

    fs.writeFileSync(path.join(taskOutputDir, 'generate_result.json'), JSON.stringify(results, null, 2));
    return;
  }

  for (const typeId of typeList) {
    const zhName = TYPE_NAMES_ZH[typeId] || typeId;
    const outPath = path.join(taskOutputDir, `${zhName}.jpg`);
    try {
      const prompt = buildDreaminaPrompt(typeId, productForPrompt, lang);
      const files = productReferenceImages.length ? buildReferenceFiles(productReferenceImages, typeId) : [];
      console.log(`[ecommerceService] Dreamina generating ${typeId} with ${files.length} reference image(s)`);
      const result = await generateSeedanceImage({
        prompt,
        ratio: '1:1',
        count: 1,
        files,
        sessionId: resolvedSession?.sessionId || '',
        fallbackSessionCandidates,
        model: requestedModel,
        providerId: 'dreamina',
        onProgress: (progress) => console.log(`[ecommerceService] Dreamina ${typeId}: ${progress}`),
      });

      const imageUrl = result?.imageUrls?.[0] || result?.imageUrl;
      if (!imageUrl) throw new Error('即梦生成完成但没有返回图片 URL');
      await downloadImageToFile(imageUrl, outPath);
      results[typeId] = { status: 'ok', path: outPath, name: zhName, sourceUrl: imageUrl };
    } catch (error) {
      results[typeId] = { status: 'error', error: error.message, name: zhName };
      console.error(`[ecommerceService] Dreamina ${typeId} failed:`, error);
    }
  }

  fs.writeFileSync(path.join(taskOutputDir, 'generate_result.json'), JSON.stringify(results, null, 2));
}

function buildOpenAiCompatibleGenerateArgs(productJson, options, taskOutputDir, typeId) {
  const {
    provider = 'openai',
    apiKey = '',
    baseUrl = '',
    model = '',
    lang = 'zh',
  } = options;
  const productReferenceImages = extractProductReferenceImages(productJson);
  const productForPrompt = stripPrivateProductMetadata(productJson);
  const args = [
    '--product', JSON.stringify(productForPrompt),
    '--provider', provider,
    '--lang', lang,
    '--types', typeId,
    '--output-dir', taskOutputDir
  ];

  if (apiKey) args.push('--api-key', apiKey);
  if (baseUrl) args.push('--base-url', baseUrl);
  if (model) args.push('--model', model);
  if (productReferenceImages.length) args.push('--product-images', productReferenceImages.join(','));
  return args;
}

function readTypeFailures(summary, typeId) {
  if (!summary) return [];
  return Object.entries(summary)
    .filter(([summaryType, value]) => (!typeId || summaryType === typeId) && value?.status === 'error')
    .map(([type, value]) => ({ type, error: formatEcommerceGenerationError(value.error), rawError: value.error, log: value.log }));
}

function formatEcommerceGenerationError(error) {
  const message = String(error || '').trim();
  if (!message) return '生成失败';
  const lower = message.toLowerCase();

  if (
    lower.includes('connection timed out') ||
    lower.includes('curl: (28)') ||
    lower.includes('upstream_error') ||
    lower.includes('bad gateway') ||
    lower.includes('502 server error') ||
    lower.includes('econnrefused') ||
    lower.includes('etimedout') ||
    lower.includes('enotfound') ||
    lower.includes('failed to establish a new connection') ||
    lower.includes('network is unreachable') ||
    lower.includes('operation not permitted')
  ) {
    return `代理节点或上游图像接口不可用/超时，请切换可用代理节点后重试。原始错误：${message}`;
  }

  if (lower.includes('model') && lower.includes('not an image model')) {
    return `当前模型不支持文生图接口，请切换到图像生成模型，或配置单独的文生图模型。原始错误：${message}`;
  }

  if (lower.includes('not an image-edit model')) {
    return `当前模型不支持以图生图接口，请切换到 image-edit 模型。原始错误：${message}`;
  }

  return message;
}

export async function generateImagesHighFidelity(productJson, options = {}, callbacks = {}) {
  const {
    provider = 'openai',
    baseUrl = '',
    model = '',
    types = DEFAULT_ECOMMERCE_TYPES,
    taskId = Date.now().toString(),
  } = options;
  const taskOutputDir = path.join(OUTPUTS_DIR, taskId);
  const typeList = getRequestedTypeList(types);
  const productForPrompt = stripPrivateProductMetadata(productJson);
  const isDreamina = isDreaminaEcommerceProvider(provider, baseUrl, model);
  const allFailures = [];
  const aggregateSummary = {};

  if (!fs.existsSync(taskOutputDir)) fs.mkdirSync(taskOutputDir, { recursive: true });
  saveUploadSourceImagesMetadata(taskOutputDir, productJson);
  fs.writeFileSync(path.join(taskOutputDir, 'product.json'), JSON.stringify(productForPrompt, null, 2));

  for (let index = 0; index < typeList.length; index++) {
    const typeId = typeList[index];
    const zhName = TYPE_NAMES_ZH[typeId] || typeId;
    callbacks.onProgress?.({
      current: index + 1,
      total: typeList.length,
      type: typeId,
      name: zhName,
      message: `正在生成第 ${index + 1}/${typeList.length} 张：${zhName}`,
    });

    try {
      const generationProduct = preferGeneratedWhiteBgReference(productJson, taskOutputDir, typeId);
      if (isDreamina) {
        await generateImagesWithDreamina(generationProduct, { ...options, types: typeId }, taskOutputDir);
      } else {
        const args = buildOpenAiCompatibleGenerateArgs(generationProduct, options, taskOutputDir, typeId);
        await runPythonScript(GENERATE_SCRIPT, args, {}, { timeoutMs: 900000 });
      }

      const summary = readGenerateSummary(taskOutputDir);
      if (summary?.[typeId]) aggregateSummary[typeId] = summary[typeId];
      if (typeId === 'multi_scene' && summary?.[typeId]?.status === 'ok') {
        await postProcessMultiSceneText(summary[typeId].path, productForPrompt);
      }
      const failures = readTypeFailures(summary, typeId);
      allFailures.push(...failures);
    } catch (error) {
      const friendlyError = formatEcommerceGenerationError(error.message);
      aggregateSummary[typeId] = { status: 'error', error: friendlyError, rawError: error.message, name: zhName };
      allFailures.push({ type: typeId, error: friendlyError, rawError: error.message });
      console.error(`[ecommerceService] High fidelity ${typeId} failed:`, error);
    }

    fs.writeFileSync(path.join(taskOutputDir, 'generate_result.json'), JSON.stringify(aggregateSummary, null, 2));
    const files = listGeneratedImageFiles(taskOutputDir, types);
    callbacks.onFile?.({
      current: index + 1,
      total: typeList.length,
      type: typeId,
      name: zhName,
      files: filesToResponse(taskId, files),
      failures: allFailures,
    });
  }

  const files = listGeneratedImageFiles(taskOutputDir, types);
  if (files.length === 0) {
    const firstFailure = allFailures[0];
    const suffix = firstFailure?.error ? `: ${firstFailure.error}` : '';
    throw new Error(`高保真模式未返回任何电商物料图片${suffix}`);
  }

  return {
    taskId,
    files: filesToResponse(taskId, files),
    failures: allFailures,
  };
}

function resolveExistingTaskOutputDir(taskId) {
  const safeTaskId = String(taskId || '').trim();
  if (!/^\d+$/.test(safeTaskId)) {
    throw new Error('无效的电商物料任务 ID');
  }

  const taskOutputDir = path.resolve(OUTPUTS_DIR, safeTaskId);
  const outputsDir = path.resolve(OUTPUTS_DIR);
  if (!taskOutputDir.startsWith(`${outputsDir}${path.sep}`)) {
    throw new Error('无效的电商物料任务路径');
  }
  if (!fs.existsSync(taskOutputDir)) {
    throw new Error('电商物料任务不存在或已被删除');
  }
  return { safeTaskId, taskOutputDir };
}

function findGeneratedFileByType(taskOutputDir, typeId) {
  return listGeneratedImageFiles(taskOutputDir, DEFAULT_ECOMMERCE_TYPE_LIST.join(','))
    .find((fileName) => inferGeneratedImageType(fileName) === typeId) || '';
}

function readTaskProductJson(taskOutputDir) {
  const productPath = path.join(taskOutputDir, 'product.json');
  if (!fs.existsSync(productPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(productPath, 'utf8'));
  } catch {
    return null;
  }
}

function addFallbackReferenceImageForRegeneration(productJson, taskOutputDir, typeId) {
  const preferredProduct = preferGeneratedWhiteBgReference(productJson, taskOutputDir, typeId);
  if (preferredProduct !== productJson) return preferredProduct;

  if (extractProductReferenceImages(productJson).length) return productJson;

  const preferredType = typeId === 'white_bg' ? 'key_features' : 'white_bg';
  const referenceFile =
    findGeneratedFileByType(taskOutputDir, preferredType) ||
    findGeneratedFileByType(taskOutputDir, 'key_features') ||
    listGeneratedImageFiles(taskOutputDir, DEFAULT_ECOMMERCE_TYPE_LIST.join(',')).find((fileName) => inferGeneratedImageType(fileName) !== typeId);

  if (!referenceFile) return productJson;
  return withReferenceImages(productJson, [path.join(taskOutputDir, referenceFile)]);
}

export async function regenerateImageForTask(taskId, typeId, productJson, options = {}) {
  const normalizedType = String(typeId || '').trim();
  if (!DEFAULT_ECOMMERCE_TYPE_LIST.includes(normalizedType)) {
    throw new Error('不支持重新生成该类型的电商物料');
  }

  const { safeTaskId, taskOutputDir } = resolveExistingTaskOutputDir(taskId);
  const existingProduct = productJson || readTaskProductJson(taskOutputDir);
  if (!existingProduct) {
    throw new Error('未找到商品分析数据，无法重新生成单张图片');
  }

  const productForPrompt = stripPrivateProductMetadata(existingProduct);
  fs.writeFileSync(path.join(taskOutputDir, 'product.json'), JSON.stringify(productForPrompt, null, 2));

  const previousSummary = readGenerateSummary(taskOutputDir) || {};
  const generationProduct = addFallbackReferenceImageForRegeneration(existingProduct, taskOutputDir, normalizedType);
  const isDreamina = isDreaminaEcommerceProvider(options.provider, options.baseUrl, options.model);

  if (isDreamina) {
    await generateImagesWithDreamina(generationProduct, { ...options, types: normalizedType }, taskOutputDir);
  } else {
    const args = buildOpenAiCompatibleGenerateArgs(generationProduct, options, taskOutputDir, normalizedType);
    await runPythonScript(GENERATE_SCRIPT, args, {}, { timeoutMs: 900000 });
  }

  const currentSummary = readGenerateSummary(taskOutputDir) || {};
  const currentResult = currentSummary[normalizedType];
  const mergedSummary = {
    ...previousSummary,
    [normalizedType]: currentResult || {
      status: 'error',
      error: '重新生成后未返回该类型结果',
      name: TYPE_NAMES_ZH[normalizedType] || normalizedType,
    },
  };
  fs.writeFileSync(path.join(taskOutputDir, 'generate_result.json'), JSON.stringify(mergedSummary, null, 2));

  if (!currentResult || currentResult.status !== 'ok') {
    throw new Error(formatEcommerceGenerationError(currentResult?.error || '重新生成失败'));
  }

  const resultPath = currentResult?.path && fs.existsSync(currentResult.path)
    ? currentResult.path
    : '';
  if (normalizedType === 'multi_scene' && resultPath) {
    await postProcessMultiSceneText(resultPath, productForPrompt);
  }
  const fileName = resultPath
    ? path.basename(resultPath)
    : findGeneratedFileByType(taskOutputDir, normalizedType);
  if (!fileName) {
    throw new Error('重新生成成功但没有找到输出图片文件');
  }

  const files = listGeneratedImageFiles(taskOutputDir, DEFAULT_ECOMMERCE_TYPE_LIST.join(','));
  return {
    taskId: safeTaskId,
    file: filesToResponse(safeTaskId, [fileName])[0],
    files: filesToResponse(safeTaskId, files),
    summary: mergedSummary,
  };
}

export async function generatePromoVideo(productJson, options = {}, callbacks = {}) {
  const {
    provider = 'dreamina',
    apiKey = '',
    baseUrl = '',
    model = 'seedance-2.0-fast',
    lang = 'zh',
    duration = 5,
    ratio = '16:9',
    userId = null,
    taskId = Date.now().toString(),
  } = options;
  const taskOutputDir = path.join(OUTPUTS_DIR, taskId);
  const durationValue = clampPromoVideoDuration(duration);
  const productForPrompt = stripPrivateProductMetadata(productJson);
  const prompt = buildPromoVideoPrompt(productForPrompt, durationValue, lang);
  const isDreamina = isDreaminaEcommerceVideoProvider(provider, baseUrl, model);

  if (!fs.existsSync(taskOutputDir)) fs.mkdirSync(taskOutputDir, { recursive: true });
  fs.writeFileSync(path.join(taskOutputDir, 'product.json'), JSON.stringify(productForPrompt, null, 2));
  fs.writeFileSync(path.join(taskOutputDir, 'promo_video_prompt.txt'), prompt);

  callbacks.onProgress?.('正在准备商品宣传视频...');

  try {
    let result;
    if (isDreamina) {
      const requestedModel = DREAMINA_ECOMMERCE_VIDEO_MODELS.has(model) ? model : 'seedance-2.0-fast';
      const productReferenceImages = extractProductReferenceImages(productJson);
      const files = productReferenceImages.length ? buildReferenceFiles(productReferenceImages, 'white_bg') : [];
      const resolvedSession = userId ? jimengSessionService.resolveEffectiveSession(userId) : null;
      const fallbackSessionCandidates = buildSavedSessionFallbackCandidates(userId);
      console.log(`[ecommerceService] Dreamina generating promo video (${durationValue}s) with ${files.length} reference image(s)`);

      const dreaminaResult = await generateSeedanceVideo({
        prompt,
        ratio,
        duration: durationValue,
        files,
        sessionId: resolvedSession?.sessionId || '',
        fallbackSessionCandidates,
        model: requestedModel,
        providerId: 'dreamina',
        referenceMode: '首帧参考',
        onProgress: (progress) => {
          console.log(`[ecommerceService] Dreamina promo video: ${progress}`);
          callbacks.onProgress?.(progress);
        },
      });

      const videoUrl = dreaminaResult?.videoUrl || dreaminaResult?.data?.[0]?.url;
      if (!videoUrl) throw new Error('即梦视频生成完成但没有返回视频 URL');
      result = {
        videoUrl,
        prompt,
        provider: 'dreamina',
        model: requestedModel,
        duration: durationValue,
        historyId: dreaminaResult.historyId || null,
        submitId: dreaminaResult.submitId || null,
        itemId: dreaminaResult.itemId || null,
        raw: dreaminaResult,
      };
    } else {
      result = await generateOpenAiCompatiblePromoVideo({
        productJson,
        prompt,
        provider,
        apiKey,
        baseUrl,
        model,
        duration: durationValue,
        ratio,
        taskId,
        taskOutputDir,
        onProgress: callbacks.onProgress,
      });
    }

    const savedResult = {
      ...result,
      taskId,
      name: `商品宣传视频_${durationValue}秒.mp4`,
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(taskOutputDir, 'promo_video_result.json'), JSON.stringify(savedResult, null, 2));

    return {
      taskId,
      historyId: savedResult.historyId || null,
      submitId: savedResult.submitId || null,
      itemId: savedResult.itemId || null,
      prompt,
      provider: savedResult.provider,
      model: savedResult.model,
      videoUrl: savedResult.videoUrl,
      video: {
        name: savedResult.name,
        url: savedResult.videoUrl,
        duration: durationValue,
        prompt,
        provider: savedResult.provider,
        model: savedResult.model,
      },
    };
  } catch (error) {
    fs.writeFileSync(path.join(taskOutputDir, 'promo_video_error.json'), JSON.stringify({
      timestamp: new Date().toISOString(),
      provider,
      baseUrl,
      model,
      duration: durationValue,
      error: error.message,
      attempts: error.attempts || [],
    }, null, 2));
    throw error;
  }
}

/**
 * Analyze product images
 */
export async function analyzeProduct(imagePaths, options = {}) {
  const { lang = 'zh', provider = 'openai', apiKey = '', baseUrl = '', model = '' } = options;
  const analysisImagePaths = await prepareImagesForAnalysis(imagePaths);
  
  const args = [...analysisImagePaths, '--lang', lang];
  if (provider) args.push('--provider', provider);
  if (apiKey) args.push('--api-key', apiKey);
  if (baseUrl) args.push('--base-url', baseUrl);
  if (model) args.push('--model', model);

  const env = {};
  // You can pass more env vars here if needed

  try {
    const output = await runPythonScript(ANALYZE_SCRIPT, args, env, { timeoutMs: 90000 });
    return normalizeAnalysisResult(JSON.parse(output));
  } catch (error) {
    console.error('[ecommerceService] Analyze failed:', error);
    throw error;
  }
}

/**
 * Generate image sets
 */
export async function generateImages(productJson, options = {}) {
  if (options.mode !== 'fast') {
    return generateImagesHighFidelity(productJson, options);
  }

  const { 
    provider = 'openai', 
    apiKey = '', 
    baseUrl = '',
    model = '', 
    lang = 'zh', 
    types = DEFAULT_ECOMMERCE_TYPES,
    outputDir = ''
  } = options;

  const taskId = Date.now().toString();
  const taskOutputDir = path.join(OUTPUTS_DIR, taskId);
  if (!fs.existsSync(taskOutputDir)) fs.mkdirSync(taskOutputDir, { recursive: true });
  saveUploadSourceImagesMetadata(taskOutputDir, productJson);
  if (isDreaminaEcommerceProvider(provider, baseUrl, model)) {
    await generateImagesWithDreamina(productJson, options, taskOutputDir);
    const files = listGeneratedImageFiles(taskOutputDir, types);
    const summary = readGenerateSummary(taskOutputDir);
    const failures = summary
      ? Object.entries(summary)
        .filter(([, value]) => value?.status === 'error')
        .map(([type, value]) => ({ type, error: value.error, log: value.log }))
      : [];

    if (files.length === 0) {
      const firstFailure = failures[0];
      const suffix = firstFailure?.error ? `: ${firstFailure.error}` : '';
      throw new Error(`即梦国际未返回任何电商物料图片${suffix}`);
    }

    return {
      taskId,
      files: filesToResponse(taskId, files),
      failures
    };
  }

  const productReferenceImages = extractProductReferenceImages(productJson);
  const productForPrompt = stripPrivateProductMetadata(productJson);

  const args = [
    '--product', JSON.stringify(productForPrompt),
    '--provider', provider,
    '--lang', lang,
    '--types', types,
    '--output-dir', taskOutputDir
  ];

  if (apiKey) args.push('--api-key', apiKey);
  if (baseUrl) args.push('--base-url', baseUrl);
  if (model) args.push('--model', model);
  if (productReferenceImages.length) args.push('--product-images', productReferenceImages.join(','));

  try {
    // This might take a while, so we return the taskId and run it in background
    // But for simplicity in the first version, we'll wait for it or use a separate task management
    // For now, let's just run it.
    await runPythonScript(GENERATE_SCRIPT, args, {}, { timeoutMs: 900000 });
    
    // Save product metadata for history
    fs.writeFileSync(path.join(taskOutputDir, 'product.json'), JSON.stringify(productForPrompt, null, 2));
    
    // Get list of generated files
    const files = listGeneratedImageFiles(taskOutputDir, types);
    const summary = readGenerateSummary(taskOutputDir);
    const failures = summary
      ? Object.entries(summary)
        .filter(([, value]) => value?.status === 'error')
        .map(([type, value]) => ({ type, error: value.error, log: value.log }))
      : [];

    if (files.length === 0) {
      const firstFailure = failures[0];
      const suffix = firstFailure?.error ? `: ${firstFailure.error}` : '';
      throw new Error(`生成接口未返回任何图片${suffix}`);
    }

    return {
      taskId,
      files: filesToResponse(taskId, files),
      failures
    };
  } catch (error) {
    console.error('[ecommerceService] Generate failed:', error);
    throw error;
  }
}

/**
 * Get history of generated ecommerce sets
 */
export async function getHistory() {
  if (!fs.existsSync(OUTPUTS_DIR)) return [];
  
  const dirs = fs.readdirSync(OUTPUTS_DIR).filter(d => {
    return fs.statSync(path.join(OUTPUTS_DIR, d)).isDirectory();
  });
  
  const history = dirs.map(taskId => {
    const taskDir = path.join(OUTPUTS_DIR, taskId);
    const productPath = path.join(taskDir, 'product.json');
    let product = null;
    
    if (fs.existsSync(productPath)) {
      try {
        product = JSON.parse(fs.readFileSync(productPath, 'utf8'));
      } catch (e) {}
    }
    
    const files = fs.readdirSync(taskDir).filter(f => {
      const ext = path.extname(f).toLowerCase();
      return ['.jpg', '.jpeg', '.png', '.webp'].includes(ext);
    });
    const videoResultPath = path.join(taskDir, 'promo_video_result.json');
    let videos = [];
    if (fs.existsSync(videoResultPath)) {
      try {
        const video = JSON.parse(fs.readFileSync(videoResultPath, 'utf8'));
        if (video?.videoUrl) {
          videos = [{
            name: video.name || '商品宣传视频.mp4',
            url: video.videoUrl,
            duration: video.duration,
            prompt: video.prompt,
            provider: video.provider,
            model: video.model,
          }];
        }
      } catch (e) {}
    }
    
    return {
      taskId,
      timestamp: parseInt(taskId),
      product,
      sourceImages: readUploadSourceImagesMetadata(taskDir),
      files: orderGeneratedImageFiles(files, DEFAULT_ECOMMERCE_TYPE_LIST.join(',')).map(f => ({
        name: f,
        url: `/api/ecommerce/output/${taskId}/${f}`
      })),
      videos
    };
  }).filter(h => h.product); // Only return tasks with product metadata
  
  return history.sort((a, b) => b.timestamp - a.timestamp);
}

export function deleteHistoryItem(taskId) {
  const safeTaskId = String(taskId || '').trim();
  if (!/^\d+$/.test(safeTaskId)) {
    throw new Error('无效的历史记录 ID');
  }

  const taskDir = path.join(OUTPUTS_DIR, safeTaskId);
  const resolvedTaskDir = path.resolve(taskDir);
  const resolvedOutputsDir = path.resolve(OUTPUTS_DIR);
  if (!resolvedTaskDir.startsWith(`${resolvedOutputsDir}${path.sep}`)) {
    throw new Error('无效的历史记录路径');
  }

  if (!fs.existsSync(resolvedTaskDir)) {
    return false;
  }

  fs.rmSync(resolvedTaskDir, { recursive: true, force: true });
  return true;
}

export { UPLOADS_DIR, OUTPUTS_DIR };
