import { useEffect, useMemo, useState } from 'react';
import { CloseIcon, DownloadIcon, ImageIcon, SparkleIcon } from '../components/Icons';
import { useApp } from '../context/AppContext';
import { getAuthHeaders } from '../services/authService';

interface PromptMedia {
  type: string;
  url: string;
  width?: number;
  height?: number;
}

interface PromptItem {
  id: string;
  index: number;
  author: string;
  url: string;
  lang: string;
  originalLang?: string;
  text: string;
  textZh?: string;
  textEn?: string;
  summary: string;
  summaryZh?: string;
  summaryEn?: string;
  likeCount: number;
  viewCount: number;
  media: PromptMedia[];
  custom?: boolean;
  sourceRepo?: string;
  title?: string;
}

interface GeneratedImage {
  fileName: string;
  url: string;
}

type GenerationMode = 'text' | 'image';
type PromptDisplayLanguage = 'zh' | 'en';

const ASPECT_RATIO_OPTIONS = [
  { label: '方形', value: '1:1', apiSize: '1024x1024', w: 1, h: 1 },
  { label: '横屏', value: '5:4', apiSize: '1536x1024', w: 5, h: 4 },
  { label: '故事', value: '9:16', apiSize: '1024x1536', w: 9, h: 16 },
  { label: '超宽屏', value: '21:9', apiSize: '1536x1024', w: 21, h: 9 },
  { label: '宽屏', value: '16:9', apiSize: '1536x1024', w: 16, h: 9 },
  { label: '横屏', value: '4:3', apiSize: '1536x1024', w: 4, h: 3 },
  { label: '宽幅', value: '3:2', apiSize: '1536x1024', w: 3, h: 2 },
  { label: '标准', value: '4:5', apiSize: '1024x1536', w: 4, h: 5 },
  { label: '竖版', value: '3:4', apiSize: '1024x1536', w: 3, h: 4 },
  { label: '竖版', value: '2:3', apiSize: '1024x1536', w: 2, h: 3 },
];

const OUTPUT_SIZE_OPTIONS = [
  { label: '原图', value: 'original', prompt: '' },
  { label: '2K 高清', value: '2k', prompt: 'Render in crisp 2K high resolution.' },
  { label: '4K 高清', value: '4k', prompt: 'Render in ultra sharp 4K high resolution.' },
];

const DEFAULT_ASPECT_RATIO = '3:4';
const DEFAULT_OUTPUT_SIZE = 'original';

function resolveAspectRatio(value?: string) {
  return ASPECT_RATIO_OPTIONS.some((item) => item.value === value) ? value! : DEFAULT_ASPECT_RATIO;
}

function resolveOutputSize(value?: string) {
  return OUTPUT_SIZE_OPTIONS.some((item) => item.value === value) ? value! : DEFAULT_OUTPUT_SIZE;
}

function resolveImageCount(value?: string | number) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(Math.max(parsed, 1), 4);
}

function getPromptTextForLanguage(item: PromptItem, language: PromptDisplayLanguage) {
  return language === 'zh' ? (item.textZh || item.text) : (item.textEn || item.text);
}

function getPromptSummaryForLanguage(item: PromptItem, language: PromptDisplayLanguage) {
  return language === 'zh'
    ? (item.summaryZh || item.textZh || item.summary || item.text)
    : (item.summaryEn || item.textEn || item.summary || item.text);
}

export default function GptImage2Page() {
  const { state } = useApp();
  const { settings } = state;
  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [query, setQuery] = useState('');
  const [language, setLanguage] = useState<PromptDisplayLanguage>('zh');
  const [selectedPromptId, setSelectedPromptId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<GenerationMode>('text');
  const [aspectRatio, setAspectRatio] = useState(resolveAspectRatio(settings.gpt_image2_aspect_ratio));
  const [count, setCount] = useState(resolveImageCount(settings.gpt_image2_count));
  const [outputSize, setOutputSize] = useState(resolveOutputSize(settings.gpt_image2_output_size));
  const [images, setImages] = useState<File[]>([]);
  const [promptExampleImages, setPromptExampleImages] = useState<File[]>([]);
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [previewImage, setPreviewImage] = useState<GeneratedImage | null>(null);
  const [loadingPrompts, setLoadingPrompts] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let ignore = false;
    const loadPrompts = async () => {
      setLoadingPrompts(true);
      setError('');
      try {
        const response = await fetch('/api/gpt-image2/prompts', {
          headers: getAuthHeaders(),
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.error || '加载提示词库失败');
        }
        if (!ignore) setPrompts(result.data || []);
      } catch (err) {
        if (!ignore) setError(err instanceof Error ? err.message : '加载提示词库失败');
      } finally {
        if (!ignore) setLoadingPrompts(false);
      }
    };
    void loadPrompts();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    setAspectRatio(resolveAspectRatio(settings.gpt_image2_aspect_ratio));
    setCount(resolveImageCount(settings.gpt_image2_count));
    setOutputSize(resolveOutputSize(settings.gpt_image2_output_size));
  }, [settings.gpt_image2_aspect_ratio, settings.gpt_image2_count, settings.gpt_image2_output_size]);

  const filteredPrompts = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return prompts.filter((item) => {
      const displayText = getPromptTextForLanguage(item, language);
      const displaySummary = getPromptSummaryForLanguage(item, language);
      const haystack = `${displayText} ${displaySummary} ${item.author} ${item.title || ''} ${item.sourceRepo || ''}`.toLowerCase();
      return !keyword || haystack.includes(keyword);
    });
  }, [language, prompts, query]);

  const selectedPrompt = useMemo(
    () => prompts.find((item) => item.id === selectedPromptId) || null,
    [prompts, selectedPromptId],
  );
  const selectedRatio = ASPECT_RATIO_OPTIONS.find((item) => item.value === aspectRatio) || ASPECT_RATIO_OPTIONS[0];
  const selectedOutputSize = OUTPUT_SIZE_OPTIONS.find((item) => item.value === outputSize) || OUTPUT_SIZE_OPTIONS[0];
  const aspectInstruction = `Make the aspect ratio ${selectedRatio.value},`;

  const buildPromptForGeneration = () => {
    const parts = [aspectInstruction];
    if (selectedOutputSize.prompt) parts.push(selectedOutputSize.prompt);
    parts.push(prompt.trim());
    return parts.filter(Boolean).join('\n');
  };

  const handleUsePrompt = (item: PromptItem) => {
    setSelectedPromptId(item.id);
    setPrompt(getPromptTextForLanguage(item, language));
  };

  const handleLanguageChange = (nextLanguage: PromptDisplayLanguage) => {
    setLanguage(nextLanguage);
    const activePrompt = prompts.find((item) => item.id === selectedPromptId);
    if (activePrompt) {
      setPrompt(getPromptTextForLanguage(activePrompt, nextLanguage));
    }
  };

  const handleGenerate = async () => {
    setError('');
    if (!prompt.trim()) {
      setError('请输入提示词，或从左侧词库选择一个案例');
      return;
    }
    if (mode === 'image' && images.length === 0) {
      setError('图生图模式请至少上传一张参考图');
      return;
    }

    setGenerating(true);
    try {
      const formData = new FormData();
      formData.append('prompt', buildPromptForGeneration());
      formData.append('mode', mode);
      formData.append('aspectRatio', selectedRatio.value);
      formData.append('outputSize', outputSize);
      formData.append('size', selectedRatio.apiSize);
      formData.append('quality', settings.gpt_image2_quality || 'auto');
      formData.append('count', String(count));
      images.forEach((file) => formData.append('images', file));

      const response = await fetch('/api/gpt-image2/generate', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: formData,
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || '生成失败');
      }
      const output = result.data?.images || [];
      setGeneratedImages(output);
      if (output.length === 0) setError('接口调用成功，但没有返回可用图片');
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败');
    } finally {
      setGenerating(false);
    }
  };

  const handleFilesChange = (files: FileList | null) => {
    if (!files) return;
    setImages(Array.from(files).slice(0, 5));
  };

  const handlePromptExampleImagesChange = (files: FileList | null) => {
    if (!files) return;
    setPromptExampleImages(Array.from(files).slice(0, 4));
  };

  const reloadPrompts = async () => {
    const response = await fetch('/api/gpt-image2/prompts', { headers: getAuthHeaders() });
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.error || '加载提示词库失败');
    }
    setPrompts(result.data || []);
  };

  const handleSavePrompt = async () => {
    setError('');
    if (!prompt.trim()) {
      setError('请先粘贴或输入要保存的提示词');
      return;
    }
    setSavingPrompt(true);
    try {
      const formData = new FormData();
      formData.append('text', prompt.trim());
      formData.append('author', '自定义');
      formData.append('lang', language);
      promptExampleImages.forEach((file) => formData.append('images', file));

      const response = await fetch('/api/gpt-image2/prompts', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: formData,
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || '保存提示词失败');
      }
      await reloadPrompts();
      setSelectedPromptId(result.data?.id || '');
      setPromptExampleImages([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存提示词失败');
    } finally {
      setSavingPrompt(false);
    }
  };

  const handlePasteFromClipboard = async () => {
    setError('');
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        setError('剪贴板里没有可用文本');
        return;
      }
      setPrompt(text.trim());
    } catch {
      setError('浏览器未允许读取剪贴板，请直接粘贴到提示词输入框');
    }
  };

  const handleCopyPrompt = async () => {
    setError('');
    if (!prompt.trim()) {
      setError('当前没有可复制的提示词');
      return;
    }
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      setError('浏览器未允许写入剪贴板，请手动复制提示词');
    }
  };

  const handleClearPrompt = () => {
    setError('');
    setPrompt('');
    setSelectedPromptId('');
    setPromptExampleImages([]);
  };

  const renderRatioIcon = (item: typeof ASPECT_RATIO_OPTIONS[number], active: boolean) => {
    const boxW = item.w >= item.h ? 34 : Math.max(18, Math.round((item.w / item.h) * 34));
    const boxH = item.h > item.w ? 34 : Math.max(18, Math.round((item.h / item.w) * 34));
    return (
      <div className="h-10 flex items-center justify-center">
        <div
          className={`rounded-[3px] border-2 ${active ? 'bg-fuchsia-500 border-fuchsia-500' : 'bg-white/5 border-gray-700'}`}
          style={{ width: boxW, height: boxH }}
        />
      </div>
    );
  };

  return (
    <div className="min-h-full bg-[#0f111a] text-white">
      <div className="p-4 lg:p-8 space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold">GPT Image 2 生图</h1>
            <p className="text-sm text-gray-500 mt-2">使用合并后的 GPT Image 2 双语词库，支持文生图和图生图。</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-400 bg-[#1c1f2e] border border-gray-800 rounded-lg px-3 py-2 w-fit">
            <SparkleIcon className="w-4 h-4 text-fuchsia-400" />
            <span>{prompts.length} 条提示词</span>
          </div>
        </div>

        {error && (
          <div className="border border-red-500/30 bg-red-500/10 text-red-300 rounded-lg px-4 py-3 text-sm">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-[420px_minmax(0,1fr)] gap-6">
          <section className="bg-[#1c1f2e] border border-gray-800 rounded-xl p-4 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">提示词词库</h2>
              <span className="text-xs text-gray-500">{filteredPrompts.length} / {prompts.length}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_160px] xl:grid-cols-1 gap-3">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索作者、风格、场景..."
                className="w-full bg-[#0f111a] border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-fuchsia-500"
              />
              <div className="grid grid-cols-2 rounded-lg border border-gray-700 bg-[#0f111a] p-1">
                {([
                  ['zh', '中文'],
                  ['en', 'English'],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => handleLanguageChange(value)}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      language === value ? 'bg-fuchsia-500 text-white' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="max-h-[560px] overflow-y-auto custom-scrollbar space-y-3 pr-1">
              {loadingPrompts ? (
                <div className="text-sm text-gray-500 py-8 text-center">正在加载词库...</div>
              ) : filteredPrompts.length === 0 ? (
                <div className="text-sm text-gray-500 py-8 text-center">没有匹配的提示词</div>
              ) : (
                filteredPrompts.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleUsePrompt(item)}
                    className={`w-full text-left border rounded-lg p-3 transition-all ${
                      selectedPromptId === item.id
                        ? 'border-fuchsia-500 bg-fuchsia-500/10'
                        : 'border-gray-800 bg-[#161824] hover:border-gray-600'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <span className="text-xs text-gray-500">#{item.index} · @{item.author || 'unknown'}</span>
                      <span className="text-xs text-gray-500">{language === 'zh' ? '中文' : 'English'}</span>
                    </div>
                    <p className="text-sm text-gray-200 line-clamp-3 leading-relaxed">
                      {getPromptSummaryForLanguage(item, language)}
                    </p>
                    {item.media[0]?.url && (
                      <div className="mt-3 aspect-[4/3] overflow-hidden rounded-md bg-[#0f111a]">
                        <img src={item.media[0].url} alt="" className="w-full h-full object-cover" loading="lazy" />
                      </div>
                    )}
                  </button>
                ))
              )}
            </div>
          </section>

          <section className="space-y-6">
            <div className="bg-[#1c1f2e] border border-gray-800 rounded-xl p-4 lg:p-6 space-y-5">
              <div className="flex flex-wrap gap-2">
                {(['text', 'image'] as GenerationMode[]).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setMode(item)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                      mode === item
                        ? 'bg-fuchsia-500 text-white'
                        : 'bg-[#0f111a] border border-gray-700 text-gray-400 hover:text-white'
                    }`}
                  >
                    {item === 'text' ? '文生图' : '图生图'}
                  </button>
                ))}
              </div>

              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <label className="block text-sm font-medium text-gray-400">提示词</label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleCopyPrompt}
                      className="px-3 py-1.5 rounded-lg bg-[#0f111a] border border-gray-700 text-xs text-gray-300 hover:text-white hover:border-fuchsia-500"
                    >
                      一键复制
                    </button>
                    <button
                      type="button"
                      onClick={handlePasteFromClipboard}
                      className="px-3 py-1.5 rounded-lg bg-[#0f111a] border border-gray-700 text-xs text-gray-300 hover:text-white hover:border-fuchsia-500"
                    >
                      从剪贴板粘贴
                    </button>
                    <button
                      type="button"
                      onClick={handleSavePrompt}
                      disabled={savingPrompt}
                      className="px-3 py-1.5 rounded-lg bg-fuchsia-500/10 border border-fuchsia-500/40 text-xs text-fuchsia-200 hover:bg-fuchsia-500/20 disabled:opacity-50"
                    >
                      {savingPrompt ? '保存中...' : '加入词库'}
                    </button>
                    <button
                      type="button"
                      onClick={handleClearPrompt}
                      className="px-3 py-1.5 rounded-lg bg-[#0f111a] border border-gray-700 text-xs text-gray-300 hover:text-white hover:border-red-500"
                    >
                      清空
                    </button>
                  </div>
                </div>
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="输入 GPT Image 2 提示词，或从词库选择一个案例..."
                  className="w-full min-h-[220px] bg-[#0f111a] border border-gray-700 rounded-lg px-4 py-3 text-sm leading-relaxed resize-y focus:outline-none focus:border-fuchsia-500"
                />
                <div className="mt-3 rounded-lg border border-gray-800 bg-[#0f111a] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-gray-300">词库示例图片</p>
                      <p className="text-xs text-gray-500 mt-1">保存到词库时一并展示，最多 4 张。</p>
                    </div>
                    <label className="cursor-pointer rounded-lg border border-gray-700 px-3 py-2 text-xs text-gray-300 hover:border-fuchsia-500 hover:text-white">
                      选择图片
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={(event) => handlePromptExampleImagesChange(event.target.files)}
                        className="hidden"
                      />
                    </label>
                  </div>
                  {promptExampleImages.length > 0 && (
                    <div className="mt-3 grid grid-cols-4 gap-2">
                      {promptExampleImages.map((file) => (
                        <div key={`${file.name}-${file.size}`} className="overflow-hidden rounded-md border border-gray-800 bg-black">
                          <img src={URL.createObjectURL(file)} alt={file.name} className="aspect-square w-full object-cover" />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {selectedPrompt && (
                <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
                  <a href={selectedPrompt.url} target="_blank" rel="noreferrer" className="text-fuchsia-300 hover:underline">
                    来源 @{selectedPrompt.author}
                  </a>
                  <span>喜欢 {selectedPrompt.likeCount}</span>
                  <span>浏览 {selectedPrompt.viewCount}</span>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="block text-sm font-medium text-gray-400">画面比例</label>
                  <span className="text-fuchsia-400 font-semibold">{selectedRatio.value}</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  {ASPECT_RATIO_OPTIONS.map((item) => {
                    const active = item.value === aspectRatio;
                    return (
                      <button
                        key={item.value}
                        type="button"
                        onClick={() => setAspectRatio(item.value)}
                        className={`min-h-[94px] rounded-lg border text-center transition-all ${
                          active
                            ? 'border-fuchsia-500 bg-fuchsia-500/10 text-fuchsia-300 shadow-[0_0_0_2px_rgba(236,72,153,0.25)]'
                            : 'border-gray-700 bg-[#0f111a] text-gray-400 hover:border-gray-500'
                        }`}
                      >
                        {renderRatioIcon(item, active)}
                        <div className="text-sm font-medium">{item.label}</div>
                        <div className="text-xs mt-1">{item.value}</div>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-3 text-sm text-gray-500 leading-relaxed">
                  选中后会把 <code className="px-2 py-1 rounded bg-fuchsia-500/10 text-fuchsia-300">{aspectInstruction}</code> 作为 prompt 第一行传给上游
                </p>
              </div>

              {mode === 'image' && (
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">参考图片</label>
                  <label className="flex min-h-[150px] cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-gray-700 bg-[#0f111a] px-4 py-6 text-center hover:border-fuchsia-500/70 transition-colors">
                    <ImageIcon className="w-9 h-9 text-gray-500" />
                    <span className="text-sm text-gray-300">点击上传参考图，最多 5 张</span>
                    <span className="text-xs text-gray-600">图生图会调用 OpenAI 兼容 /images/edits</span>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(event) => handleFilesChange(event.target.files)}
                      className="hidden"
                    />
                  </label>
                  {images.length > 0 && (
                    <div className="grid grid-cols-3 md:grid-cols-5 gap-3 mt-3">
                      {images.map((file) => (
                        <div key={`${file.name}-${file.size}`} className="bg-[#0f111a] border border-gray-800 rounded-lg p-2">
                          <img src={URL.createObjectURL(file)} alt={file.name} className="w-full aspect-square object-cover rounded" />
                          <p className="text-[11px] text-gray-500 mt-1 truncate">{file.name}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="block text-sm font-medium text-gray-400">张数</label>
                  <span className="text-fuchsia-400 font-semibold">{count}</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={4}
                  step={1}
                  value={count}
                  onChange={(event) => setCount(Number(event.target.value))}
                  className="w-full accent-fuchsia-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="block text-sm font-medium text-gray-400">输出尺寸</label>
                  <span className="text-xs text-gray-500">接口尺寸 {selectedRatio.apiSize}</span>
                </div>
                <div className="grid grid-cols-3 rounded-full border border-gray-700 overflow-hidden bg-[#0f111a]">
                  {OUTPUT_SIZE_OPTIONS.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setOutputSize(item.value)}
                      className={`py-2.5 text-sm font-medium transition-all ${
                        outputSize === item.value
                          ? 'bg-fuchsia-500 text-white'
                          : 'text-gray-400 hover:text-white border-l border-gray-800 first:border-l-0'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={handleGenerate}
                disabled={generating}
                className="w-full sm:w-auto px-6 py-3 bg-gradient-to-r from-fuchsia-600 to-indigo-600 hover:from-fuchsia-500 hover:to-indigo-500 disabled:from-gray-700 disabled:to-gray-700 disabled:text-gray-500 rounded-lg font-semibold transition-all"
              >
                {generating ? '生成中...' : mode === 'text' ? '生成图片' : '参考图片生成'}
              </button>
            </div>

            <div className="bg-[#1c1f2e] border border-gray-800 rounded-xl p-4 lg:p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">生成结果</h2>
                <span className="text-xs text-gray-500">{generatedImages.length} 张</span>
              </div>
              {generatedImages.length === 0 ? (
                <div className="min-h-[260px] flex flex-col items-center justify-center text-center text-gray-600 border border-dashed border-gray-800 rounded-xl">
                  <ImageIcon className="w-12 h-12 mb-3" />
                  <p>生成后的图片会显示在这里</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {generatedImages.map((item) => (
                    <div key={item.fileName} className="bg-[#0f111a] border border-gray-800 rounded-xl overflow-hidden">
                      <button type="button" onClick={() => setPreviewImage(item)} className="block w-full">
                        <img src={item.url} alt={item.fileName} className="w-full aspect-square object-contain bg-black" />
                      </button>
                      <div className="p-3 flex items-center justify-between gap-3">
                        <span className="text-xs text-gray-500 truncate">{item.fileName}</span>
                        <a href={item.url} download={item.fileName} className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-white transition-colors">
                          <DownloadIcon className="w-4 h-4" />
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      {previewImage && (
        <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4">
          <button
            type="button"
            onClick={() => setPreviewImage(null)}
            className="absolute top-4 right-4 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white"
          >
            <CloseIcon className="w-6 h-6" />
          </button>
          <img src={previewImage.url} alt={previewImage.fileName} className="max-w-full max-h-[86vh] object-contain rounded-lg" />
        </div>
      )}
    </div>
  );
}
