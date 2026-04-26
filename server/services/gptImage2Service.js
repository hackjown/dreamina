import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.resolve(__dirname, '../assets/gpt-image2-prompts.json');
const CUSTOM_DATA_FILE = path.resolve(__dirname, '../data/gpt-image2/custom-prompts.json');
const OUTPUT_DIR = path.resolve(__dirname, '../data/gpt-image2/outputs');
const PROMPT_MEDIA_DIR = path.resolve(__dirname, '../data/gpt-image2/prompt-media');

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
if (!fs.existsSync(PROMPT_MEDIA_DIR)) fs.mkdirSync(PROMPT_MEDIA_DIR, { recursive: true });
if (!fs.existsSync(path.dirname(CUSTOM_DATA_FILE))) fs.mkdirSync(path.dirname(CUSTOM_DATA_FILE), { recursive: true });

function normalizeBaseUrl(baseUrl = '') {
  return String(baseUrl || '').trim().replace(/\/+$/, '');
}

function createOutputName(ext = 'png') {
  const safeExt = String(ext || 'png').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'png';
  return `gpt_image2_${Date.now()}_${Math.random().toString(16).slice(2)}.${safeExt}`;
}

function mimeToExt(mime = '') {
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  return 'png';
}

function inferExtFromUrl(url = '') {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname).replace('.', '').toLowerCase();
    return ext || 'png';
  } catch {
    return 'png';
  }
}

function createPromptSummary(text = '') {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > 160 ? `${clean.slice(0, 160)}...` : clean;
}

function createPromptMediaName(originalName = '', mime = 'image/png') {
  const extFromName = path.extname(originalName || '').replace('.', '').toLowerCase();
  const safeExt = extFromName || mimeToExt(mime);
  return `prompt_media_${Date.now()}_${Math.random().toString(16).slice(2)}.${safeExt}`;
}

function detectPromptLang(text = '') {
  return /[\u4e00-\u9fff]/.test(String(text || '')) ? 'zh' : 'en';
}

function normalizeTranslationOutput(text = '') {
  return String(text || '')
    .replace(/^```(?:text)?/i, '')
    .replace(/```$/i, '')
    .replace(/^(?:中文|英文|translation|translated text)\s*[:：]\s*/i, '')
    .trim();
}

function normalizePromptItem(item, index, custom = false) {
  const text = item.text || '';
  const textZh = item.textZh || text;
  const textEn = item.textEn || text;
  return {
    id: item.id || `prompt-${index + 1}`,
    index: index + 1,
    author: item.author || '',
    url: item.url || '',
    lang: item.lang || '',
    originalLang: item.originalLang || item.lang || '',
    text,
    textZh,
    textEn,
    summary: createPromptSummary(text),
    summaryZh: createPromptSummary(textZh),
    summaryEn: createPromptSummary(textEn),
    likeCount: Number(item.likeCount || 0),
    viewCount: Number(item.viewCount || 0),
    media: Array.isArray(item.media) ? item.media.slice(0, 4) : [],
    custom,
    createdAt: item.createdAt || '',
    sourceRepo: item.sourceRepo || '',
    title: item.title || '',
  };
}

function readCustomPrompts() {
  if (!fs.existsSync(CUSTOM_DATA_FILE)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(CUSTOM_DATA_FILE, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCustomPrompts(items) {
  fs.writeFileSync(CUSTOM_DATA_FILE, JSON.stringify(items, null, 2));
}

function savePromptMediaFiles(files = []) {
  return files.slice(0, 4).map((file) => {
    const fileName = createPromptMediaName(file.originalname, file.mimetype);
    const filePath = path.join(PROMPT_MEDIA_DIR, fileName);
    fs.writeFileSync(filePath, file.buffer);
    return {
      type: 'photo',
      url: `/api/gpt-image2/prompt-media/${encodeURIComponent(fileName)}`,
    };
  });
}

export function listPromptLibrary() {
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  const baseItems = JSON.parse(raw).map((item, index) => normalizePromptItem(item, index, false));
  const customItems = readCustomPrompts().map((item, index) => normalizePromptItem(item, baseItems.length + index, true));
  return [...customItems, ...baseItems];
}

export async function translatePromptText({ text, targetLang, config }) {
  const cleanText = String(text || '').trim();
  const lang = targetLang === 'zh' ? 'zh' : 'en';
  if (!cleanText) return '';

  const apiKey = String(config?.apiKey || '').trim();
  const baseUrl = normalizeBaseUrl(config?.baseUrl);
  const model = String(config?.model || '').trim();
  if (!apiKey || !baseUrl || !model) {
    throw new Error('缺少电商识别模型翻译配置');
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: [
            'You are a professional prompt translation engine.',
            'Translate image-generation prompts accurately.',
            'Keep placeholders, brand names, camera parameters, aspect ratio flags, and formatting intact.',
            'Return only the translated prompt text, no explanation.',
          ].join(' '),
        },
        {
          role: 'user',
          content: lang === 'zh'
            ? `Translate the following image-generation prompt into Simplified Chinese:\n\n${cleanText}`
            : `Translate the following image-generation prompt into English:\n\n${cleanText}`,
        },
      ],
      temperature: 0,
      max_tokens: 4096,
      stream: false,
    }),
  });

  const responseText = await response.text();
  let payload = null;
  try {
    payload = responseText ? JSON.parse(responseText) : null;
  } catch {
    payload = { raw: responseText };
  }
  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.error || responseText || `翻译请求失败：${response.status}`);
  }
  return normalizeTranslationOutput(payload?.choices?.[0]?.message?.content || payload?.raw || '');
}

export async function addCustomPrompt({ text, author = '自定义', lang = 'zh', files = [], media = [], translationConfig = null }) {
  const cleanText = String(text || '').trim();
  if (!cleanText) throw new Error('提示词不能为空');
  if (cleanText.length > 12000) throw new Error('提示词过长，请控制在 12000 字以内');

  const items = readCustomPrompts();
  const duplicate = items.find((item) => {
    return [item.text, item.textZh, item.textEn].some((value) => String(value || '').trim() === cleanText);
  });
  if (duplicate) {
    return normalizePromptItem(duplicate, 0, true);
  }

  const promptLang = lang === 'en' || lang === 'zh' ? lang : detectPromptLang(cleanText);
  let textZh = promptLang === 'zh' ? cleanText : '';
  let textEn = promptLang === 'en' ? cleanText : '';
  if (translationConfig) {
    try {
      if (!textZh) textZh = await translatePromptText({ text: cleanText, targetLang: 'zh', config: translationConfig });
      if (!textEn) textEn = await translatePromptText({ text: cleanText, targetLang: 'en', config: translationConfig });
    } catch (error) {
      console.warn('[gpt-image2] 自定义提示词翻译失败，使用原文兜底:', error.message);
    }
  }
  if (!textZh) textZh = cleanText;
  if (!textEn) textEn = cleanText;

  const savedMedia = savePromptMediaFiles(files);
  const urlMedia = Array.isArray(media)
    ? media
        .filter((item) => item?.url)
        .slice(0, 4 - savedMedia.length)
        .map((item) => ({ type: item.type || 'photo', url: item.url }))
    : [];

  const item = {
    id: `custom-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    author: String(author || '自定义').trim() || '自定义',
    lang: promptLang,
    originalLang: promptLang,
    text: cleanText,
    textZh,
    textEn,
    url: '',
    likeCount: 0,
    viewCount: 0,
    media: [...savedMedia, ...urlMedia],
    createdAt: new Date().toISOString(),
  };
  items.unshift(item);
  writeCustomPrompts(items);
  return normalizePromptItem(item, 0, true);
}

async function saveRemoteImage(url, apiKey = '') {
  const response = await fetch(url, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
  });
  if (!response.ok) {
    throw new Error(`下载生成图片失败：${response.status} ${await response.text().catch(() => '')}`);
  }
  const mime = response.headers.get('content-type') || 'image/png';
  const arrayBuffer = await response.arrayBuffer();
  const fileName = createOutputName(mimeToExt(mime) || inferExtFromUrl(url));
  const filePath = path.join(OUTPUT_DIR, fileName);
  fs.writeFileSync(filePath, Buffer.from(arrayBuffer));
  return { fileName, url: `/api/gpt-image2/output/${encodeURIComponent(fileName)}` };
}

function saveBase64Image(b64Json, mime = 'image/png') {
  const fileName = createOutputName(mimeToExt(mime));
  const filePath = path.join(OUTPUT_DIR, fileName);
  fs.writeFileSync(filePath, Buffer.from(String(b64Json || ''), 'base64'));
  return { fileName, url: `/api/gpt-image2/output/${encodeURIComponent(fileName)}` };
}

async function normalizeImageResults(payload, apiKey = '') {
  const data = Array.isArray(payload?.data) ? payload.data : [];
  const results = [];
  for (const item of data) {
    if (item?.b64_json) {
      results.push(saveBase64Image(item.b64_json));
    } else if (item?.url) {
      results.push(await saveRemoteImage(item.url, apiKey));
    }
  }
  return results;
}

function ensureConfig(config) {
  const apiKey = String(config?.apiKey || '').trim();
  const baseUrl = normalizeBaseUrl(config?.baseUrl);
  const model = String(config?.model || 'gpt-image-2').trim();

  if (!apiKey) throw new Error('请先在系统设置里配置 GPT Image 2 API Key');
  if (!baseUrl) throw new Error('请先在系统设置里配置 GPT Image 2 API 地址');
  if (!model) throw new Error('请先在系统设置里配置 GPT Image 2 模型名称');

  return { apiKey, baseUrl, model };
}

function appendCommonFields(formData, { model, prompt, size, quality, responseFormat }) {
  formData.append('model', model);
  formData.append('prompt', prompt);
  if (size && size !== 'auto') formData.append('size', size);
  if (quality && quality !== 'auto') formData.append('quality', quality);
  if (responseFormat) formData.append('response_format', responseFormat);
}

async function requestOpenAiCompatibleJson({ endpoint, apiKey, body }) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.error || text || `请求失败：${response.status}`);
  }
  return payload;
}

async function requestOpenAiCompatibleMultipart({ endpoint, apiKey, formData }) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.error || text || `请求失败：${response.status}`);
  }
  return payload;
}

export async function generateImage({ config, prompt, mode = 'text', files = [], size = '1024x1024', quality = 'auto', count = 1 }) {
  const { apiKey, baseUrl, model } = ensureConfig(config);
  const finalPrompt = String(prompt || '').trim();
  if (!finalPrompt) throw new Error('请输入提示词');
  const imageCount = Math.min(Math.max(Number.parseInt(count, 10) || 1, 1), 4);

  if (mode === 'image' || files.length > 0) {
    const endpoint = `${baseUrl}/images/edits`;
    const buildForm = (imageFieldName) => {
      const formData = new FormData();
      appendCommonFields(formData, { model, prompt: finalPrompt, size, quality });
      formData.append('n', String(imageCount));
      for (const file of files) {
        const blob = new Blob([file.buffer], { type: file.mimetype || 'image/png' });
        formData.append(imageFieldName, blob, file.originalname || 'reference.png');
      }
      return formData;
    };

    let payload;
    try {
      payload = await requestOpenAiCompatibleMultipart({
        endpoint,
        apiKey,
        formData: buildForm('image[]'),
      });
    } catch (error) {
      payload = await requestOpenAiCompatibleMultipart({
        endpoint,
        apiKey,
        formData: buildForm('image'),
      });
    }
    return normalizeImageResults(payload, apiKey);
  }

  const payload = await requestOpenAiCompatibleJson({
    endpoint: `${baseUrl}/images/generations`,
    apiKey,
    body: {
      model,
      prompt: finalPrompt,
      n: imageCount,
      ...(size && size !== 'auto' ? { size } : {}),
      ...(quality && quality !== 'auto' ? { quality } : {}),
    },
  });
  return normalizeImageResults(payload, apiKey);
}

export function resolveOutputPath(fileName) {
  const safeName = path.basename(fileName);
  const filePath = path.join(OUTPUT_DIR, safeName);
  if (!fs.existsSync(filePath)) return null;
  return filePath;
}

export function resolvePromptMediaPath(fileName) {
  const safeName = path.basename(fileName);
  const filePath = path.join(PROMPT_MEDIA_DIR, safeName);
  if (!fs.existsSync(filePath)) return null;
  return filePath;
}
