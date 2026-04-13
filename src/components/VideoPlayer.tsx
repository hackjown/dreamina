import { SpinnerIcon, FilmIcon, DownloadIcon, SparkleIcon } from './Icons';
import { resolveApiUrl } from '../services/apiBase';

interface VideoPlayerProps {
  videoUrl: string | null;
  mediaType?: 'video' | 'image';
  revisedPrompt?: string;
  isLoading: boolean;
  error?: string;
  progress?: string;
}

function proxyUrl(url: string): string {
  return resolveApiUrl(`/api/video-proxy?url=${encodeURIComponent(url)}`);
}

function isImageUrl(url: string | null): boolean {
  if (!url) return false;
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'];
  const urlWithoutQuery = url.split('?')[0].toLowerCase();
  return imageExtensions.some(ext => urlWithoutQuery.endsWith(ext)) || url.includes('/aigc_draft/generate'); // 适配后端可能是动态生成的情况
}

export default function VideoPlayer({
  videoUrl,
  mediaType,
  revisedPrompt,
  isLoading,
  error,
  progress,
}: VideoPlayerProps) {
  const isImage = mediaType ? mediaType === 'image' : isImageUrl(videoUrl);

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-4">
        <div className="relative">
          <SpinnerIcon className="w-12 h-12 text-purple-400" />
        </div>
        <div className="text-center">
          <p className="text-gray-300 text-sm">
            {progress || '正在通过AI生成内容...'}
          </p>
          <p className="text-gray-500 text-xs mt-1">
            生成过程可能需要一点时间，请耐心等待
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-4">
        <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center border border-red-500/20">
          <span className="text-2xl text-red-400">!</span>
        </div>
        <div className="text-center max-w-md">
          <p className="text-red-400 text-sm">{error}</p>
          <p className="text-gray-500 text-xs mt-1">请检查设置后重试</p>
        </div>
      </div>
    );
  }

  if (videoUrl) {
    const proxied = proxyUrl(videoUrl);

    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-4 md:p-8">
        <div className="w-full max-w-4xl bg-black rounded-2xl overflow-hidden border border-gray-800 shadow-2xl relative group">
          {isImage ? (
            <img
              src={proxied}
              alt="Generated Result"
              className="w-full max-h-[80vh] object-contain mx-auto"
            />
          ) : (
            <video
              controls
              src={proxied}
              className="w-full max-h-[80vh] mx-auto"
              autoPlay
              loop
            />
          )}
          <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
            <a
              href={proxied}
              download={isImage ? "seedance-image.png" : "seedance-video.mp4"}
              className="bg-white/20 hover:bg-white/30 backdrop-blur-md text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2"
            >
              <DownloadIcon className="w-4 h-4" />
              下载{isImage ? '图片' : '视频'}
            </a>
          </div>
        </div>
        {revisedPrompt && (
          <div className="bg-[#1c1f2e] p-4 rounded-xl border border-gray-800 max-w-lg w-full">
             <div className="flex items-center gap-2 mb-2 text-purple-400">
               <SparkleIcon className="w-3 h-3" />
               <span className="text-[10px] font-bold uppercase tracking-wider">AI 优化词</span>
             </div>
             <p className="text-gray-400 text-xs leading-relaxed">
               {revisedPrompt}
             </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 opacity-50">
      <div className="w-24 h-24 rounded-full bg-[#1c1f2e] flex items-center justify-center border border-gray-800">
        <FilmIcon className="w-8 h-8 text-gray-600" />
      </div>
      <p className="text-gray-600">AI 创意工坊已就绪</p>
      <p className="text-xs text-gray-700">支持文生视频、图生视频及高画质生图</p>
    </div>
  );
}
