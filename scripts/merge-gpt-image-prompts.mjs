import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const BASE_JSON = path.join(ROOT, 'external/awesome-gpt-image-2-prompts/gpt_image2_prompts.json');
const EVO_README_EN = path.join(ROOT, 'external/awesome-gpt-image-2-prompts/README.md');
const EVO_README_ZH = path.join(ROOT, 'external/awesome-gpt-image-2-prompts/README_zh-CN.md');
const ZERO_README = path.join(ROOT, 'external/awesome-gpt-image/README.md');
const ZERO_README_ZH = path.join(ROOT, 'external/awesome-gpt-image/README.zh-CN.md');
const OUTPUT_JSON = path.join(ROOT, 'server/assets/gpt-image2-prompts.json');
const ZERO_RAW_BASE = 'https://raw.githubusercontent.com/ZeroLu/awesome-gpt-image/main/';

function normalizePromptText(text = '') {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function dedupeKey(text = '') {
  return normalizePromptText(text)
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function slugify(text = '') {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'prompt';
}

function detectLang(text = '') {
  return /[\u4e00-\u9fff]/.test(text) ? 'zh' : 'en';
}

function resolveMediaUrl(url = '') {
  const clean = url.trim();
  if (!clean) return '';
  if (/^https?:\/\//i.test(clean)) return clean;
  return ZERO_RAW_BASE + clean.replace(/^\.?\//, '');
}

function extractMedia(markdown = '') {
  const urls = [];
  for (const match of markdown.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
    urls.push(resolveMediaUrl(match[1]));
  }
  for (const match of markdown.matchAll(/!\[[^\]]*]\(([^)]+)\)/g)) {
    urls.push(resolveMediaUrl(match[1]));
  }
  return Array.from(new Set(urls.filter(Boolean))).slice(0, 4).map((url) => ({ type: 'photo', url }));
}

function extractSource(block = '') {
  const sourceLine = block.split('\n').find((line) => /(?:source|来源):/i.test(line)) || '';
  const linkMatches = Array.from(sourceLine.matchAll(/\[([^\]]+)]\(([^)]+)\)/g));
  const firstProfile = linkMatches.find(([, label]) => label.trim().startsWith('@'));
  const firstLink = firstProfile || linkMatches[0];
  if (!firstLink) return { author: 'ZeroLu', url: 'https://github.com/ZeroLu/awesome-gpt-image' };
  const [, label, url] = firstLink;
  return {
    author: label.replace(/^@/, '').trim() || 'ZeroLu',
    url: url.trim(),
  };
}

function extractSourceUrls(block = '') {
  const sourceLine = block.split('\n').find((line) => /(?:source|来源):/i.test(line)) || '';
  return Array.from(sourceLine.matchAll(/\[([^\]]+)]\(([^)]+)\)/g)).map((match) => match[2].trim());
}

function parseReadmePrompts(readmePath, sourceRepo, rawBase = '') {
  const markdown = fs.readFileSync(readmePath, 'utf8');
  const headingRegex = /^###\s+(.+)$/gm;
  const headings = Array.from(markdown.matchAll(headingRegex)).map((match) => ({
    title: match[1].trim(),
    start: match.index,
  }));
  const items = [];

  for (let i = 0; i < headings.length; i += 1) {
    const { title, start } = headings[i];
    const end = headings[i + 1]?.start ?? markdown.length;
    const block = markdown.slice(start, end);
    const promptMatch = block.match(/\*\*(?:Prompt|提示词):\*\*\s*```(?:text)?\s*([\s\S]*?)```/i);
    if (!promptMatch) continue;

    const text = normalizePromptText(promptMatch[1]);
    if (!text) continue;

    const beforePrompt = block.slice(0, promptMatch.index);
    const { author, url } = extractSource(block);
    const sourceUrls = extractSourceUrls(block);
    items.push({
      id: `${sourceRepo === 'ZeroLu/awesome-gpt-image' ? 'zerolu' : 'evo'}-${slugify(title)}-${items.length + 1}`,
      url,
      author,
      followers: 0,
      createdAt: '',
      lang: detectLang(text),
      text,
      likeCount: 0,
      retweetCount: 0,
      viewCount: 0,
      media: extractMedia(beforePrompt),
      sourceRepo,
      title,
      sourceUrls,
    });
  }

  return items;
}

function createTranslationMap(items) {
  const map = new Map();
  for (const item of items) {
    for (const sourceUrl of item.sourceUrls || []) {
      if (!map.has(sourceUrl)) map.set(sourceUrl, item.text);
    }
    if (item.url && !map.has(item.url)) map.set(item.url, item.text);
  }
  return map;
}

function withBaseTranslations(items) {
  const evoEnMap = createTranslationMap(parseReadmePrompts(EVO_README_EN, 'EvoLinkAI/awesome-gpt-image-2-prompts'));
  const evoZhMap = createTranslationMap(parseReadmePrompts(EVO_README_ZH, 'EvoLinkAI/awesome-gpt-image-2-prompts'));
  return items.map((item) => ({
    ...item,
    originalLang: item.lang || detectLang(item.text),
    textEn: evoEnMap.get(item.url) || (item.lang === 'en' ? item.text : '') || item.text,
    textZh: evoZhMap.get(item.url) || (item.lang === 'zh' ? item.text : '') || item.text,
  }));
}

function withZeroLuTranslations() {
  const zeroEnItems = parseReadmePrompts(ZERO_README, 'ZeroLu/awesome-gpt-image', ZERO_RAW_BASE);
  const zeroZhMap = createTranslationMap(parseReadmePrompts(ZERO_README_ZH, 'ZeroLu/awesome-gpt-image', ZERO_RAW_BASE));
  return zeroEnItems.map((item) => ({
    ...item,
    originalLang: 'en',
    textEn: item.text,
    textZh: zeroZhMap.get(item.url) || item.text,
  }));
}

const baseItems = withBaseTranslations(JSON.parse(fs.readFileSync(BASE_JSON, 'utf8')));
const zeroItems = withZeroLuTranslations();
const seen = new Set();
const merged = [];
let duplicateCount = 0;

for (const item of [...baseItems, ...zeroItems]) {
  const key = dedupeKey(item.text);
  if (!key) continue;
  if (seen.has(key)) {
    duplicateCount += 1;
    continue;
  }
  seen.add(key);
  merged.push(item);
}

fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(merged, null, 2)}\n`);
console.log(JSON.stringify({
  base: baseItems.length,
  zeroluParsed: zeroItems.length,
  duplicatesRemoved: duplicateCount,
  merged: merged.length,
  textZh: merged.filter((item) => item.textZh).length,
  textEn: merged.filter((item) => item.textEn).length,
  output: path.relative(ROOT, OUTPUT_JSON),
}, null, 2));
