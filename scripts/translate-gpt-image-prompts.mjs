import fs from 'fs';
import path from 'path';
import { getAllSettings } from '../server/services/settingsService.js';
import { translatePromptText } from '../server/services/gptImage2Service.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const PROMPTS_FILE = path.join(ROOT, 'server/assets/gpt-image2-prompts.json');

function getOriginalLang(item) {
  return item.originalLang || item.lang || '';
}

function needsTranslation(item, targetLang) {
  const originalLang = getOriginalLang(item);
  if (targetLang === 'zh') return originalLang !== 'zh' && item.textZh === item.text;
  return originalLang !== 'en' && item.textEn === item.text;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const settings = getAllSettings();
const config = {
  apiKey: settings.ecommerce_analysis_api_key || settings.ecommerce_api_key,
  baseUrl: settings.ecommerce_analysis_api_url || settings.ecommerce_api_url,
  model: settings.ecommerce_analysis_model || settings.ecommerce_model,
};

if (!config.apiKey || !config.baseUrl || !config.model) {
  throw new Error('缺少电商识别模型配置，无法翻译 GPT Image 2 词库');
}

const items = JSON.parse(fs.readFileSync(PROMPTS_FILE, 'utf8'));
let translatedZh = 0;
let translatedEn = 0;
let failed = 0;

for (const item of items) {
  if (needsTranslation(item, 'zh')) {
    try {
      item.textZh = await translatePromptText({ text: item.text, targetLang: 'zh', config });
      translatedZh += 1;
      fs.writeFileSync(PROMPTS_FILE, `${JSON.stringify(items, null, 2)}\n`);
      console.log(`[zh] ${translatedZh}: ${item.id}`);
      await sleep(250);
    } catch (error) {
      failed += 1;
      console.warn(`[zh failed] ${item.id}: ${error.message}`);
    }
  }

  if (needsTranslation(item, 'en')) {
    try {
      item.textEn = await translatePromptText({ text: item.text, targetLang: 'en', config });
      translatedEn += 1;
      fs.writeFileSync(PROMPTS_FILE, `${JSON.stringify(items, null, 2)}\n`);
      console.log(`[en] ${translatedEn}: ${item.id}`);
      await sleep(250);
    } catch (error) {
      failed += 1;
      console.warn(`[en failed] ${item.id}: ${error.message}`);
    }
  }
}

console.log(JSON.stringify({
  total: items.length,
  translatedZh,
  translatedEn,
  failed,
}, null, 2));
