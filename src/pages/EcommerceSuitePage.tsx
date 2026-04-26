import React, { useState, useEffect, useRef } from "react";import { 
  PackageIcon, 
  SparkleIcon, 
  ImageIcon, 
  SpinnerIcon, 
  CheckIcon,
  PlusIcon,
  EyeIcon,
  CloseIcon,
  DownloadIcon,
  HistoryIcon,
  RefreshIcon,
  TrashIcon
} from '../components/Icons';
import { 
  EcommerceAnalysisResult as AnalysisResult, 
  EcommerceGeneratedFile as GeneratedFile,
  EcommerceVideoResult as PromoVideo
} from '../types';

const ECOMMERCE_FULL_TYPES = 'white_bg,key_features,selling_pt,material,lifestyle,model,multi_scene,ecommerce_detail';
type UploadPreviewImage = { name: string; url: string };

export default function EcommerceSuitePage() {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [historySourceImages, setHistorySourceImages] = useState<UploadPreviewImage[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<GeneratedFile[]>([]);
  const [promoVideos, setPromoVideos] = useState<PromoVideo[]>([]);
  const [generatingVideo, setGeneratingVideo] = useState(false);
  const [videoProgress, setVideoProgress] = useState('');
  const [selectedVideoDuration, setSelectedVideoDuration] = useState<5 | 10 | 15>(5);
  const [selectedVideoReference, setSelectedVideoReference] = useState<GeneratedFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<GeneratedFile | null>(null);
  const [regeneratingImageKey, setRegeneratingImageKey] = useState<string | null>(null);
  const [regeneratingImageName, setRegeneratingImageName] = useState('');
  const [history, setHistory] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const galleryRef = useRef<HTMLDivElement | null>(null);
  const videoGalleryRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetchHistory();
  }, []);

  useEffect(() => {
    if (generatedImages.length === 0) {
      setSelectedVideoReference(null);
      return;
    }
    if (!selectedVideoReference || !generatedImages.some(img => img.url === selectedVideoReference.url)) {
      setSelectedVideoReference(generatedImages[0]);
    }
  }, [generatedImages, selectedVideoReference]);

  const fetchHistory = async () => {
    try {
      const response = await fetch('/api/ecommerce/history', {
        headers: {
          'x-session-id': localStorage.getItem('seedance_session_id') || '',
        }
      });
      const data = await response.json();
      if (data.success) {
        setHistory(data.data);
      }
    } catch (err) {
      console.error('Failed to fetch history:', err);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setSelectedFiles(Array.from(e.target.files));
      setHistorySourceImages([]);
    }
  };

  const [retryInfo, setRetryInfo] = useState<{current: number, total: number} | null>(null);
  const [generationProgress, setGenerationProgress] = useState('');

  const startAnalysis = async () => {
    if (selectedFiles.length === 0) return;
    
    setAnalyzing(true);
    setError(null);
    setAnalysisResult(null);
    setGeneratedImages([]);
    setSelectedVideoReference(null);
    setPromoVideos([]);
    setHistorySourceImages([]);

    const formData = new FormData();
    selectedFiles.forEach(file => formData.append('images', file));
    formData.append('lang', 'zh');

    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 1) setRetryInfo({ current: attempt, total: maxRetries });
        
        const response = await fetch('/api/ecommerce/analyze', {
          method: 'POST',
          headers: {
            'x-session-id': localStorage.getItem('seedance_session_id') || '',
          },
          body: formData,
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || '分析失败');
        
        setAnalysisResult(data.data);
        setRetryInfo(null);
        setAnalyzing(false);
        return; // Success!
      } catch (err: any) {
        console.warn(`Analysis attempt ${attempt} failed:`, err.message);
        if (attempt === maxRetries) {
          setError(err.message);
          setRetryInfo(null);
        } else {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
    setAnalyzing(false);
  };

  const startGeneration = async () => {
    if (!analysisResult) return;

    setGenerating(true);
    setError(null);
    setRetryInfo(null);
    setGenerationProgress('正在提交高保真生成任务...');
    setGeneratedImages([]);
    window.requestAnimationFrame(() => {
      galleryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    try {
      const response = await fetch('/api/ecommerce/generate-task', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session-id': localStorage.getItem('seedance_session_id') || '',
        },
        body: JSON.stringify({
          product: analysisResult,
          types: ECOMMERCE_FULL_TYPES,
          lang: 'zh',
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '提交生成任务失败');

      const taskId = data.data?.taskId;
      if (!taskId) throw new Error('服务器未返回生成任务 ID');

      const maxPollTime = 30 * 60 * 1000;
      const pollInterval = 2000;
      const startedAt = Date.now();

      while (Date.now() - startedAt < maxPollTime) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));

        const pollResponse = await fetch(`/api/ecommerce/generate-task/${taskId}`, {
          headers: {
            'x-session-id': localStorage.getItem('seedance_session_id') || '',
          },
        });
        const pollData = await pollResponse.json().catch(() => ({}));
        if (!pollResponse.ok) throw new Error(pollData.error || '查询生成任务失败');

        const task = pollData.data;
        if (Array.isArray(task?.files)) {
          setGeneratedImages(task.files);
        }
        if (task?.progress) {
          setGenerationProgress(task.progress);
        }
        if (task?.status === 'done') {
          if (!task.files?.length) throw new Error('生成任务完成但没有返回图片');
          setGeneratedImages(task.files);
          fetchHistory();
          setRetryInfo(null);
          setGenerationProgress('');
          setGenerating(false);
          return;
        }
        if (task?.status === 'error') {
          throw new Error(task.error || '生成失败');
        }
      }

      throw new Error('生成超时，请稍后查看历史记录或重试');
    } catch (err: any) {
      console.warn('Generation failed:', err.message);
      setError(err.message || '生成失败');
      setRetryInfo(null);
      setGenerationProgress('');
      setGenerating(false);
    }
  };

  const getVideoSrc = (url: string) => {
    if (!url) return '';
    if (url.startsWith('/api/') || url.startsWith('data:') || url.startsWith('blob:')) return url;
    return `/api/video-proxy?url=${encodeURIComponent(url)}`;
  };

  const getImageTaskId = (img: GeneratedFile) => {
    if (img.taskId) return img.taskId;
    try {
      const pathname = img.url.startsWith('http')
        ? new URL(img.url).pathname
        : img.url.split('?')[0];
      const match = pathname.match(/^\/api\/ecommerce\/output\/([^/]+)\//);
      return match ? decodeURIComponent(match[1]) : '';
    } catch {
      return '';
    }
  };

  const getImageType = (img: GeneratedFile) => {
    if (img.type) return img.type;
    const name = decodeURIComponent(img.name || img.url || '');
    if (name.includes('白底') || name.includes('主图')) return 'white_bg';
    if (name.includes('核心卖点')) return 'key_features';
    if (name.includes('卖点')) return 'selling_pt';
    if (name.includes('材质')) return 'material';
    if (name.includes('多场景')) return 'multi_scene';
    if (name.includes('模特')) return 'model';
    if (name.includes('场景') || name.includes('展示')) return 'lifestyle';
    if (name.includes('详情')) return 'ecommerce_detail';
    if (name.includes('三角度')) return 'three_angle_view';
    return '';
  };

  const regenerateImage = async (img: GeneratedFile) => {
    const taskId = getImageTaskId(img);
    const type = getImageType(img);
    if (!taskId || !type) {
      setError('缺少图片任务信息，无法重新生成单张图片');
      return;
    }

    const imageKey = `${taskId}:${type}`;
    setRegeneratingImageKey(imageKey);
    setRegeneratingImageName(img.name || '单张图片');
    setError(null);
    try {
      const response = await fetch('/api/ecommerce/regenerate-image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session-id': localStorage.getItem('seedance_session_id') || '',
        },
        body: JSON.stringify({
          taskId,
          type,
          fileName: img.name,
          product: analysisResult,
          lang: 'zh',
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '重新生成失败');
      const files = data.data?.files;
      const regenerated = data.data?.file;
      if (!Array.isArray(files) || !regenerated) throw new Error('重新生成完成但没有返回图片');

      setGeneratedImages(files);
      if (selectedVideoReference?.url === img.url || selectedVideoReference?.type === type) {
        setSelectedVideoReference(regenerated);
      }
      if (previewImage?.url === img.url || previewImage?.type === type) {
        setPreviewImage(regenerated);
      }
      fetchHistory();
    } catch (err: any) {
      setError(err.message || '重新生成失败');
    } finally {
      setRegeneratingImageKey(null);
      setRegeneratingImageName('');
    }
  };

  const startPromoVideo = async (duration: 5 | 10 | 15 = selectedVideoDuration) => {
    if (!analysisResult) return;

    setSelectedVideoDuration(duration);
    setGeneratingVideo(true);
    setVideoProgress(`正在提交 ${duration} 秒商品宣传视频任务...`);
    setError(null);
    window.requestAnimationFrame(() => {
      videoGalleryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    try {
      const response = await fetch('/api/ecommerce/video-task', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session-id': localStorage.getItem('seedance_session_id') || '',
        },
        body: JSON.stringify({
          product: analysisResult,
          referenceImage: selectedVideoReference,
          duration,
          lang: 'zh',
          ratio: '16:9',
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '提交视频生成任务失败');
      const taskId = data.data?.taskId;
      if (!taskId) throw new Error('服务器未返回视频任务 ID');

      const maxPollTime = 35 * 60 * 1000;
      const pollInterval = 3000;
      const startedAt = Date.now();

      while (Date.now() - startedAt < maxPollTime) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        const pollResponse = await fetch(`/api/ecommerce/video-task/${taskId}`, {
          headers: {
            'x-session-id': localStorage.getItem('seedance_session_id') || '',
          },
        });
        const pollData = await pollResponse.json().catch(() => ({}));
        if (!pollResponse.ok) throw new Error(pollData.error || '查询视频任务失败');
        const task = pollData.data;
        if (task?.progress) setVideoProgress(task.progress);
        if (task?.status === 'done') {
          if (!task.video?.url) throw new Error('视频任务完成但没有返回视频地址');
          setPromoVideos(prev => [task.video, ...prev.filter(video => video.url !== task.video.url)]);
          setGeneratingVideo(false);
          setVideoProgress('');
          fetchHistory();
          return;
        }
        if (task?.status === 'error') {
          throw new Error(task.error || '视频生成失败');
        }
      }

      throw new Error('视频生成超时，请稍后查看历史记录或重试');
    } catch (err: any) {
      setError(err.message || '视频生成失败');
      setGeneratingVideo(false);
      setVideoProgress('');
    }
  };

  const loadFromHistory = (item: any) => {
    setAnalysisResult(item.product);
    setGeneratedImages(item.files);
    setSelectedVideoReference(item.files?.[0] || null);
    setPromoVideos(item.videos || []);
    setHistorySourceImages(Array.isArray(item.sourceImages) ? item.sourceImages : []);
    setSelectedFiles([]); // Clear upload selection
    setShowHistory(false);
    window.requestAnimationFrame(() => {
      galleryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const deleteHistoryItem = async (item: any) => {
    if (!item?.taskId) return;
    const ok = window.confirm(`删除历史记录「${item.product?.product_name || '未命名商品'}」？`);
    if (!ok) return;

    try {
      const response = await fetch(`/api/ecommerce/history/${item.taskId}`, {
        method: 'DELETE',
        headers: {
          'x-session-id': localStorage.getItem('seedance_session_id') || '',
        },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '删除失败');

      setHistory(prev => prev.filter(historyItem => historyItem.taskId !== item.taskId));
      if (generatedImages.some(img => img.url.includes(`/api/ecommerce/output/${item.taskId}/`))) {
        setGeneratedImages([]);
      }
      if ((item.videos || []).some((video: PromoVideo) => promoVideos.some(current => current.url === video.url))) {
        setPromoVideos([]);
      }
    } catch (err: any) {
      setError(err.message || '删除失败');
    }
  };

  const uploadPreviewImages: UploadPreviewImage[] = selectedFiles.length > 0
    ? selectedFiles.map((file) => ({ name: file.name, url: URL.createObjectURL(file) }))
    : historySourceImages;

  return (
    <div className="p-6 lg:p-10 space-y-8 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <PackageIcon className="w-8 h-8 text-emerald-400" />
            电商物料全自动
          </h1>
          <p className="text-gray-400 mt-2">上传商品图，AI 自动分析卖点并生成全套电商视觉物料</p>
        </div>

        <button 
          onClick={() => setShowHistory(!showHistory)}
          className="flex items-center gap-2 bg-[#1c1f2e] hover:bg-gray-800 text-gray-300 px-5 py-2.5 rounded-xl border border-gray-800 hover:border-emerald-500/50 transition-all group shadow-lg"
        >
          <HistoryIcon className="w-5 h-5 group-hover:text-emerald-400 transition-colors" />
          <span className="font-medium">历史记录</span>
          {history.length > 0 && (
            <span className="ml-1 bg-emerald-500/20 text-emerald-400 text-[10px] font-bold px-2 py-0.5 rounded-full border border-emerald-500/20">
              {history.length}
            </span>
          )}
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-4 rounded-xl flex items-center justify-between gap-3 animate-in shake duration-500">
          <div className="flex items-center gap-3">
            <span className="text-xl">⚠️</span>
            <p className="text-sm font-medium">{error}</p>
          </div>
          <button 
            onClick={() => analysisResult ? startGeneration() : startAnalysis()}
            className="flex items-center gap-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 px-4 py-1.5 rounded-lg border border-red-500/30 transition-all text-xs font-bold"
          >
            <RefreshIcon className="w-3.5 h-3.5" />
            立即重试
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Step 1: Upload & Analyze */}
        <div className="bg-[#1c1f2e] border border-gray-800 rounded-3xl p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-white flex items-center gap-2">
              <span className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-sm font-bold">1</span>
              商品上传与分析
            </h2>
            {analyzing && (
              <span className="text-xs text-emerald-400 animate-pulse font-medium">
                {retryInfo ? `正在重试 (${retryInfo.current}/${retryInfo.total})...` : 'AI 正在提取卖点...'}
              </span>
            )}
          </div>

          {analyzing && (
            <div className="w-full bg-gray-800 h-1 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 animate-progress"></div>
            </div>
          )}

          <div className="relative group">
            <input
              type="file"
              multiple
              onChange={handleFileChange}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
            />
            <div className="border-2 border-dashed border-gray-700 group-hover:border-emerald-500/50 rounded-2xl p-10 flex flex-col items-center justify-center transition-all bg-gray-800/20">
              {uploadPreviewImages.length > 0 ? (
                <div className="grid grid-cols-3 gap-2 w-full">
                  {uploadPreviewImages.map((image, i) => (
                    <div key={i} className="relative aspect-square rounded-lg bg-gray-700 flex items-center justify-center text-xs text-gray-300 overflow-hidden">
                      <img src={image.url} alt={image.name || 'preview'} className="w-full h-full object-cover" />
                      {analyzing && (
                        <div className="absolute inset-0 bg-emerald-500/20 pointer-events-none">
                          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-emerald-400/50 to-transparent h-1/2 w-full animate-scan"></div>
                        </div>
                      )}
                    </div>
                  ))}
                  <div className="aspect-square border border-dashed border-gray-600 rounded-lg flex items-center justify-center">
                    <PlusIcon className="w-6 h-6 text-gray-500" />
                  </div>
                </div>
              ) : (
                <>
                  <div className="w-16 h-16 rounded-2xl bg-gray-800 flex items-center justify-center mb-4">
                    <ImageIcon className="w-8 h-8 text-gray-500" />
                  </div>
                  <p className="text-gray-300 font-medium">点击或拖拽上传商品图</p>
                  <p className="text-gray-500 text-sm mt-1">支持多张图片（正面、细节、反面）</p>
                </>
              )}
            </div>
          </div>

          <button
            onClick={startAnalysis}
            disabled={selectedFiles.length === 0 || analyzing}
            className={`w-full py-4 rounded-2xl font-bold flex items-center justify-center gap-3 transition-all ${
              selectedFiles.length === 0 || analyzing
                ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                : 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg shadow-emerald-500/20'
            }`}
          >
            {analyzing ? (
              <>
                <SpinnerIcon className="w-5 h-5" />
                正在深度视觉分析...
              </>
            ) : (
              <>
                <SparkleIcon className="w-5 h-5" />
                开始 AI 视觉分析
              </>
            )}
          </button>
        </div>

        {/* Step 2: Analysis Results */}
        <div className="bg-[#1c1f2e] border border-gray-800 rounded-3xl p-6 space-y-6 min-h-[400px]">
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <span className="w-8 h-8 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center text-sm font-bold">2</span>
            分析结果
          </h2>

          {analysisResult ? (
            <div className="space-y-6 animate-in slide-in-from-right-4 duration-500">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-800/30 p-4 rounded-2xl border border-gray-800">
                  <p className="text-xs text-gray-500 uppercase tracking-wider">商品名称</p>
                  <p className="text-white font-medium mt-1">{analysisResult.product_name}</p>
                </div>
                <div className="bg-gray-800/30 p-4 rounded-2xl border border-gray-800">
                  <p className="text-xs text-gray-500 uppercase tracking-wider">商品风格</p>
                  <p className="text-white font-medium mt-1">{analysisResult.product_style}</p>
                </div>
              </div>

              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">核心卖点提炼</p>
                <div className="space-y-2">
                  {(analysisResult.selling_points || []).map((sp, i) => (
                    <div key={i} className="flex items-start gap-3 bg-gray-800/20 p-3 rounded-xl border border-gray-800/50">
                      <div className="mt-1">
                        <CheckIcon className="w-4 h-4 text-emerald-400" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-gray-200">{sp.zh}</p>
                        <p className="text-xs text-gray-500">{sp.zh_desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <button
                onClick={startGeneration}
                disabled={generating}
                className={`w-full py-4 rounded-2xl font-bold flex items-center justify-center gap-3 transition-all ${
                  generating
                    ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                    : 'bg-gradient-to-r from-purple-500 to-indigo-600 hover:opacity-90 text-white shadow-lg shadow-purple-500/20'
                }`}
              >
                {generating ? (
                  <>
                    <SpinnerIcon className="w-5 h-5" />
                    {generationProgress || '正在生成全套物料...'}
                  </>
                ) : (
                  <>
                    <SparkleIcon className="w-5 h-5" />
                    生成全套电商物料
                  </>
                )}
              </button>

              <div className="pt-2 border-t border-gray-800/70 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-gray-500 uppercase tracking-wider">商品宣传视频</p>
                  {generatingVideo && (
                    <span className="text-xs text-purple-300 animate-pulse">{videoProgress || '视频生成中...'}</span>
                  )}
                </div>
                {generatedImages.length > 0 && (
                  <div className="rounded-2xl border border-gray-800 bg-gray-900/30 p-3 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-medium text-gray-400">视频首帧</p>
                      <p className="text-xs text-gray-500 truncate">{selectedVideoReference?.name || '默认使用上传商品图'}</p>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      {generatedImages.slice(0, 4).map((img) => {
                        const selected = selectedVideoReference?.url === img.url;
                        return (
                          <button
                            key={img.url}
                            type="button"
                            onClick={() => setSelectedVideoReference(img)}
                            disabled={generatingVideo}
                            title={`设为视频首帧：${img.name}`}
                            className={`relative aspect-square overflow-hidden rounded-xl border transition-all ${
                              selected
                                ? 'border-cyan-400 ring-2 ring-cyan-400/30'
                                : 'border-gray-700 hover:border-gray-500'
                            } disabled:opacity-50`}
                          >
                            <img src={img.url} alt={img.name} className="w-full h-full object-cover" />
                            {selected && (
                              <span className="absolute right-1.5 top-1.5 w-6 h-6 rounded-full bg-cyan-400 text-black flex items-center justify-center shadow-lg">
                                <CheckIcon className="w-4 h-4" />
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-3 gap-2">
                  {[5, 10, 15].map((duration) => (
                    <button
                      key={duration}
                      type="button"
                      onClick={() => setSelectedVideoDuration(duration as 5 | 10 | 15)}
                      disabled={generatingVideo}
                      className={`py-2 rounded-xl border text-sm font-medium transition-all ${
                        selectedVideoDuration === duration
                          ? 'border-purple-500 bg-purple-500/15 text-purple-200'
                          : 'border-gray-700 bg-gray-800/30 text-gray-400 hover:border-gray-600'
                      } disabled:opacity-50`}
                    >
                      {duration} 秒
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => startPromoVideo()}
                  disabled={generatingVideo}
                  className={`w-full py-3 rounded-2xl font-bold flex items-center justify-center gap-3 transition-all ${
                    generatingVideo
                      ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                      : 'bg-gradient-to-r from-cyan-500 to-blue-600 hover:opacity-90 text-white shadow-lg shadow-cyan-500/20'
                  }`}
                >
                  {generatingVideo ? (
                    <>
                      <SpinnerIcon className="w-5 h-5" />
                      正在生成宣传视频...
                    </>
                  ) : (
                    <>
                      <SparkleIcon className="w-5 h-5" />
                      生成 {selectedVideoDuration} 秒商品宣传视频
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-gray-600 py-10">
              <PackageIcon className="w-16 h-16 opacity-20 mb-4" />
              <p>分析完成后，这里将显示商品详情和卖点</p>
            </div>
          )}
        </div>
      </div>

      {/* Results Gallery */}
      {(generatedImages.length > 0 || generating) && (
        <div ref={galleryRef} className="bg-[#1c1f2e] border border-gray-800 rounded-3xl p-5 sm:p-8 space-y-6 animate-in slide-up-4 duration-700 scroll-mt-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 className="text-2xl font-bold text-white">生成的物料库</h2>
            <div className="text-sm text-gray-500 bg-gray-800/50 px-4 py-2 rounded-full border border-gray-800 self-start sm:self-auto max-w-full">
              {generating 
                ? (retryInfo ? `正在重试 (${retryInfo.current}/${retryInfo.total})...` : (generationProgress || '正在高保真生成中...')) 
                : `共生成 ${generatedImages.length} 张图片`}
            </div>
          </div>

          {generating && (
            <div className="w-full bg-gray-800 h-1.5 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-purple-500 via-emerald-500 to-indigo-600 animate-progress"></div>
            </div>
          )}

          {regeneratingImageKey && (
            <div className="rounded-2xl border border-purple-500/30 bg-purple-500/10 px-4 py-3 space-y-2">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-purple-100 font-medium">正在重新生成：{regeneratingImageName}</span>
                <span className="text-purple-300">单张重抽中...</span>
              </div>
              <div className="w-full bg-gray-900/70 h-1.5 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-purple-500 via-cyan-400 to-emerald-400 animate-progress"></div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
            {generatedImages.map((img, i) => {
              const selectedAsVideoReference = selectedVideoReference?.url === img.url;
              const taskId = getImageTaskId(img);
              const imageType = getImageType(img);
              const imageKey = `${taskId}:${imageType || img.name}`;
              const isRegeneratingThis = regeneratingImageKey === imageKey;
              return (
              <div 
                key={i} 
                className={`group relative aspect-square bg-gray-800 rounded-2xl overflow-hidden border transition-all cursor-pointer ${
                  selectedAsVideoReference ? 'border-cyan-400 ring-2 ring-cyan-400/20' : 'border-gray-700 hover:border-emerald-500/50'
                }`}
                onClick={() => setPreviewImage(img)}
              >
                <img src={img.url} alt={img.name} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />
                {selectedAsVideoReference && (
                  <div className="absolute left-3 top-3 bg-cyan-400 text-black text-xs font-bold px-2 py-1 rounded-lg shadow-lg">
                    视频首帧
                  </div>
                )}
                {isRegeneratingThis && (
                  <div className="absolute inset-x-0 bottom-0 bg-black/75 p-3 space-y-2">
                    <div className="flex items-center gap-2 text-white text-xs font-medium">
                      <SpinnerIcon className="w-4 h-4" />
                      正在重新生成
                    </div>
                    <div className="w-full bg-gray-800 h-1 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-purple-500 via-cyan-400 to-emerald-400 animate-progress"></div>
                    </div>
                  </div>
                )}
                <div className="hidden md:flex absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex-col items-center justify-center p-4">
                  <div className="flex flex-wrap justify-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPreviewImage(img);
                      }}
                      className="bg-emerald-500 text-white p-2 rounded-lg hover:bg-emerald-600 transition-colors"
                    >
                      <EyeIcon className="w-5 h-5" />
                    </button>
                    <button
                      type="button"
                      disabled={isRegeneratingThis || generating}
                      onClick={(e) => {
                        e.stopPropagation();
                        regenerateImage(img);
                      }}
                      className="bg-purple-500 text-white px-3 py-2 rounded-lg hover:bg-purple-600 transition-colors text-xs font-bold disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-1.5"
                    >
                      {isRegeneratingThis ? <SpinnerIcon className="w-4 h-4" /> : <RefreshIcon className="w-4 h-4" />}
                      重新生成
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedVideoReference(img);
                      }}
                      className="bg-cyan-500 text-white px-3 py-2 rounded-lg hover:bg-cyan-600 transition-colors text-xs font-bold"
                    >
                      设为首帧
                    </button>
                    <a 
                      href={img.url} 
                      download={img.name}
                      onClick={(e) => e.stopPropagation()}
                      className="bg-white text-black p-2 rounded-lg hover:bg-gray-200 transition-colors"
                    >
                      <DownloadIcon className="w-5 h-5" />
                    </a>
                  </div>
                  <p className="text-white text-xs mt-3 text-center line-clamp-1">{img.name}</p>
                </div>
                <div className="md:hidden absolute inset-x-2 bottom-2 flex items-center justify-center gap-2 pointer-events-none">
                  <button
                    type="button"
                    aria-label="查看图片"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPreviewImage(img);
                    }}
                    className="pointer-events-auto bg-emerald-500 text-white p-2 rounded-lg shadow-lg"
                  >
                    <EyeIcon className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    disabled={isRegeneratingThis || generating}
                    onClick={(e) => {
                      e.stopPropagation();
                      regenerateImage(img);
                    }}
                    className="pointer-events-auto bg-purple-500 text-white p-2 rounded-lg shadow-lg disabled:opacity-60"
                    aria-label="重新生成"
                  >
                    {isRegeneratingThis ? <SpinnerIcon className="w-4 h-4" /> : <RefreshIcon className="w-4 h-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedVideoReference(img);
                    }}
                    className="pointer-events-auto bg-cyan-500 text-white px-2.5 py-2 rounded-lg text-[11px] font-bold shadow-lg"
                  >
                    首帧
                  </button>
                </div>
              </div>
              );
            })}
            {generating && Array.from({ length: Math.max(0, 4 - generatedImages.length) }).map((_, i) => (
              <div key={`pending-${i}`} className="aspect-square bg-gray-800/50 rounded-2xl animate-pulse flex items-center justify-center">
                <SpinnerIcon className="w-8 h-8 text-gray-700" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Promo Videos */}
      {(promoVideos.length > 0 || generatingVideo) && (
        <div ref={videoGalleryRef} className="bg-[#1c1f2e] border border-gray-800 rounded-3xl p-8 space-y-6 animate-in slide-up-4 duration-700 scroll-mt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold text-white">商品宣传视频</h2>
            <div className="text-sm text-gray-500 bg-gray-800/50 px-4 py-2 rounded-full border border-gray-800">
              {generatingVideo ? (videoProgress || '正在生成视频...') : `共生成 ${promoVideos.length} 条视频`}
            </div>
          </div>

          {generatingVideo && (
            <div className="w-full bg-gray-800 h-1.5 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-cyan-500 via-purple-500 to-blue-600 animate-progress"></div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {promoVideos.map((video, index) => (
              <div key={`${video.url}-${index}`} className="bg-gray-900/40 border border-gray-800 rounded-2xl overflow-hidden">
                <video
                  src={getVideoSrc(video.url)}
                  controls
                  className="w-full aspect-video bg-black"
                />
                <div className="p-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-200">{video.name || '商品宣传视频'}</p>
                    <p className="text-xs text-gray-500 mt-1">{video.duration || selectedVideoDuration} 秒 · {video.model || video.provider || 'video'}</p>
                  </div>
                  <a
                    href={getVideoSrc(video.url)}
                    download={video.name || '商品宣传视频.mp4'}
                    className="bg-white text-black p-2 rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    <DownloadIcon className="w-5 h-5" />
                  </a>
                </div>
              </div>
            ))}
            {generatingVideo && promoVideos.length === 0 && (
              <div className="aspect-video bg-gray-800/50 rounded-2xl animate-pulse flex items-center justify-center border border-gray-800">
                <SpinnerIcon className="w-8 h-8 text-gray-700" />
              </div>
            )}
          </div>
        </div>
      )}

      {/* History Slide-over */}
      {showHistory && (
        <div className="fixed inset-0 z-50 flex justify-end animate-in fade-in duration-300">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowHistory(false)} />
          <div className="relative w-full max-w-md bg-[#1c1f2e] h-full shadow-2xl border-l border-gray-800 flex flex-col animate-in slide-in-from-right duration-500">
            <div className="p-6 border-b border-gray-800 flex items-center justify-between">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <HistoryIcon className="w-5 h-5 text-emerald-400" />
                历史记录
              </h3>
              <button onClick={() => setShowHistory(false)} className="p-2 hover:bg-gray-800 rounded-lg text-gray-400">
                <CloseIcon className="w-6 h-6" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
              {history.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-gray-500 py-20">
                  <PackageIcon className="w-12 h-12 opacity-20 mb-4" />
                  <p>暂无历史记录</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {history.map((item, idx) => (
                    <div 
                      key={idx} 
                      className="bg-gray-900/50 border border-gray-800 rounded-2xl p-4 hover:border-emerald-500/30 hover:bg-gray-800/50 transition-all cursor-pointer group"
                      onClick={() => loadFromHistory(item)}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-[10px] text-gray-500 font-mono">
                          {new Date(item.timestamp).toLocaleString()}
                        </span>
                        <div className="flex items-center gap-2">
                          <div className="bg-emerald-500/10 text-emerald-400 text-[10px] px-2 py-0.5 rounded-full border border-emerald-500/20">
                            {item.files?.length || 0} 张图片
                          </div>
                          <button
                            type="button"
                            title="删除历史记录"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteHistoryItem(item);
                            }}
                            className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                          >
                            <TrashIcon className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      <p className="text-white font-medium line-clamp-1 group-hover:text-emerald-400 transition-colors">
                        {item.product?.product_name || '未命名商品'}
                      </p>
                      <div className="mt-3 flex gap-2 overflow-hidden h-12">
                        {item.files?.slice(0, 4).map((f: any, i: number) => (
                          <img key={i} src={f.url} className="w-12 h-12 object-cover rounded-lg border border-gray-800" alt="" />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Image Preview Modal */}
      {previewImage && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-10 animate-in fade-in duration-300"
          style={{ backgroundColor: 'rgba(0,0,0,0.9)' }}
          onClick={() => setPreviewImage(null)}
        >
          <button 
            className="absolute top-6 right-6 w-12 h-12 bg-white/10 hover:bg-white/20 text-white rounded-full flex items-center justify-center transition-colors z-50"
            onClick={() => setPreviewImage(null)}
          >
            <CloseIcon className="w-6 h-6" />
          </button>

          <div 
            className="relative max-w-5xl w-full h-full flex flex-col items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            <img 
              src={previewImage.url} 
              alt={previewImage.name} 
              className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl animate-in zoom-in-95 duration-300"
            />
            
            <div className="mt-6 flex flex-col items-center gap-2">
              <p className="text-white text-lg font-medium">{previewImage.name}</p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  disabled={regeneratingImageKey === `${getImageTaskId(previewImage)}:${getImageType(previewImage) || previewImage.name}`}
                  onClick={() => regenerateImage(previewImage)}
                  className="flex items-center gap-2 bg-purple-500 hover:bg-purple-600 text-white px-6 py-3 rounded-xl font-bold transition-all shadow-lg shadow-purple-500/20 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {regeneratingImageKey === `${getImageTaskId(previewImage)}:${getImageType(previewImage) || previewImage.name}`
                    ? <SpinnerIcon className="w-5 h-5" />
                    : <RefreshIcon className="w-5 h-5" />}
                  重新生成
                </button>
                <a 
                  href={previewImage.url} 
                  download={previewImage.name}
                  className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-8 py-3 rounded-xl font-bold transition-all shadow-lg shadow-emerald-500/20"
                >
                  <DownloadIcon className="w-5 h-5" />
                  下载原图
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
