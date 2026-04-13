import type { GenerateVideoRequest, VideoGenerationResponse } from '../types';
import { getAuthHeaders } from './authService';
import { resolveApiUrl } from './apiBase';

export async function generateVideo(
  request: GenerateVideoRequest,
  onProgress?: (message: string) => void
): Promise<VideoGenerationResponse> {
  const formData = new FormData();
  formData.append('prompt', request.prompt);
  formData.append('model', request.model);
  formData.append('ratio', request.ratio);
  formData.append('duration', String(request.duration));
  formData.append('reference_mode', request.referenceMode || '全能参考');

  for (const file of request.files) {
    formData.append('files', file);
  }

  // 第1步: 提交任务
  onProgress?.('正在提交生成请求...');
  const submitRes = await fetch(resolveApiUrl('/api/generate-video'), {
    method: 'POST',
    headers: getAuthHeaders(),
    body: formData,
  });

  const submitData = await submitRes.json();
  if (!submitRes.ok) {
    throw new Error(submitData.error || `提交失败 (HTTP ${submitRes.status})`);
  }

  const { taskId } = submitData;
  if (!taskId) {
    throw new Error('服务器未返回任务ID');
  }

  // 第2步: 轮询获取结果
  onProgress?.('已提交，等待 AI 生成...');

  const maxPollTime = 25 * 60 * 1000; // 25 分钟
  const pollInterval = 3000; // 3 秒
  const startTime = Date.now();

  while (Date.now() - startTime < maxPollTime) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));

    const pollRes = await fetch(resolveApiUrl(`/api/task/${taskId}`));
    const pollData = await pollRes.json();

    if (pollData.status === 'done') {
      const result = pollData.result;
      if (result?.data?.[0]?.url) {
        return result;
      }
      throw new Error('未获取到生成结果');
    }

    if (pollData.status === 'error') {
      throw new Error(pollData.error || '生成失败');
    }

    if (pollData.progress) {
      onProgress?.(pollData.progress);
    }
  }

  throw new Error('生成超时，请稍后重试');
}
