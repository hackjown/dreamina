/**
 * 原有类型定义（从 types.ts 迁移过来）
 */
export type AspectRatio = '21:9' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16';

export type Duration = 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15;

export type ProviderId = 'dreamina' | 'manual-dreamina' | 'legacy-jimeng';

export type ModelId =
  | 'seedance-2.0'
  | 'seedance-2.0-fast'
  | 'dreamina-image-4.1'
  | 'dreamina-image-4.0'
  | 'dreamina-video-2.0'
  | 'dreamina-video-2.0-pro'
  | 'dreamina-video-3.0'
  | 'dreamina-video-3.0-pro'
  | 'dreamina-seedance-1.0-mini'
  | 'dreamina-seedance-1.5-pro';

// ============================================================
// 用户认证类型
// ============================================================

export interface User {
  id: number;
  username?: string;
  email: string;
  role: 'user' | 'admin';
  status: 'active' | 'disabled';
  credits: number;
  createdAt?: string;
  updatedAt?: string;
  lastCheckInAt?: string;
}

export interface ApiKeyItem {
  id: number;
  userId: number;
  name: string;
  keyPrefix: string;
  status: 'active' | 'revoked';
  lastUsedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface CreatedApiKey extends ApiKeyItem {
  apiKey: string;
}

export interface LoginCredentials {
  account: string;
  password: string;
}

export interface RegisterCredentials {
  account: string;
  password: string;
}

export interface AuthResponse {
  sessionId: string;
  user: User;
}

export interface ModelOption {
  value: ModelId;
  label: string;
  description: string;
  provider: ProviderId;
  category: 'video' | 'image';
}

export interface ProviderOption {
  value: ProviderId;
  label: string;
  description: string;
}

export interface AppViewOption {
  id: AppView;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  accent?: string;
}

export enum AppView {
  LOGIN = 'LOGIN',
  REGISTER = 'REGISTER',
  SINGLE_TASK = 'SINGLE_TASK',
  BATCH_MANAGEMENT = 'BATCH_MANAGEMENT',
  DOWNLOAD_MANAGEMENT = 'DOWNLOAD_MANAGEMENT',
  SETTINGS = 'SETTINGS',
  ADMIN = 'ADMIN',
  PROFILE = 'PROFILE',
}

export type ReferenceMode = '全能参考' | '首帧参考' | '尾帧参考';

export interface UploadedImage {
  id: string;
  file: File;
  previewUrl: string;
  index: number;
}

export interface GenerateVideoRequest {
  prompt: string;
  model: ModelId;
  ratio: AspectRatio;
  duration: Duration;
  referenceMode?: ReferenceMode;
  files: File[];
}

export interface VideoGenerationResponse {
  created: number;
  data: Array<{
    url: string;
    revised_prompt: string;
    type?: 'video' | 'image';
  }>;
}

export type GenerationStatus = 'idle' | 'generating' | 'success' | 'error';

export interface GenerationState {
  status: GenerationStatus;
  progress?: string;
  result?: VideoGenerationResponse;
  error?: string;
}

export interface RatioOption {
  value: AspectRatio;
  label: string;
  widthRatio: number;
  heightRatio: number;
}

export const RATIO_OPTIONS: RatioOption[] = [
  { value: '21:9', label: '21:9', widthRatio: 21, heightRatio: 9 },
  { value: '16:9', label: '16:9', widthRatio: 16, heightRatio: 9 },
  { value: '4:3', label: '4:3', widthRatio: 4, heightRatio: 3 },
  { value: '1:1', label: '1:1', widthRatio: 1, heightRatio: 1 },
  { value: '3:4', label: '3:4', widthRatio: 3, heightRatio: 4 },
  { value: '9:16', label: '9:16', widthRatio: 9, heightRatio: 16 },
];

export const DURATION_OPTIONS: Duration[] = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

export const REFERENCE_MODES: ReferenceMode[] = ['全能参考', '首帧参考', '尾帧参考'];

export const MODEL_OPTIONS: ModelOption[] = [
  {
    value: 'seedance-2.0-fast',
    label: 'Seedance 2.0 Fast',
    description: '国际版快速主力模型，适合高并发与低积分成本场景。',
    provider: 'dreamina',
    category: 'video'
  },
  {
    value: 'seedance-2.0',
    label: 'Seedance 2.0 Pro',
    description: '国际版高质量主力模型，优先使用官方 Seedance 2.0 链路。',
    provider: 'dreamina',
    category: 'video'
  },
  {
    value: 'dreamina-image-4.1',
    label: 'Image 4.1',
    description: '强大的生图模型。支持高画质、多风格的图像生成。',
    provider: 'dreamina',
    category: 'image'
  },
  {
    value: 'dreamina-image-4.0',
    label: 'Image 4.0',
    description: '稳定的生图模型，适合作为 4.1 之外的显式备选。',
    provider: 'dreamina',
    category: 'image'
  },
  {
    value: 'dreamina-video-3.0',
    label: 'Dreamina Video 3.0',
    description: '标准视频模型，支持文生视频与图生视频',
    provider: 'dreamina',
    category: 'video'
  },
  {
    value: 'dreamina-video-3.0-pro',
    label: 'Dreamina Video 3.0 Pro',
    description: '高规格视频模型，支持更复杂的场景生成',
    provider: 'dreamina',
    category: 'video'
  },
  {
    value: 'dreamina-video-2.0',
    label: 'Dreamina Video 2.0',
    description: '基础视频模型',
    provider: 'dreamina',
    category: 'video'
  },
  {
    value: 'dreamina-video-2.0-pro',
    label: 'Dreamina Video 2.0 Pro',
    description: '平衡性能与质量的进阶模型',
    provider: 'dreamina',
    category: 'video'
  },
];

const MODEL_ALIAS_MAP: Record<string, ModelId> = {
  'dreamina-seedance-1.0-mini': 'seedance-2.0-fast',
  'dreamina-seedance-1.5-pro': 'seedance-2.0',
};

export function normalizeModelId(model?: string | null): ModelId {
  const normalized = String(model || '').trim();
  if (!normalized) return 'seedance-2.0-fast';
  return MODEL_ALIAS_MAP[normalized] || (normalized as ModelId);
}

export const PROVIDER_OPTIONS: ProviderOption[] = [
  {
    value: 'dreamina',
    label: 'Dreamina',
    description: '默认 provider。使用 dreamina.capcut.com 网页 SessionID 接入',
  },
  {
    value: 'legacy-jimeng',
    label: 'Legacy Jimeng',
    description: '保留原有即梦网页会话接入链路，使用 SessionID',
  },
];

export interface JimengSessionAccount {
  id: number;
  userId: number;
  name: string;
  sessionId: string;
  email?: string;
  hasPassword?: boolean;
  isDefault: boolean;
  isVirtual?: boolean;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface JimengSessionAccountInput {
  name?: string;
  sessionId: string;
  email?: string;
  password?: string;
}

export type EffectiveSessionSource = 'user_default' | 'legacy_global' | 'env_default' | 'none';

export interface EffectiveSessionResolution {
  source: EffectiveSessionSource;
  sessionId: string;
  account: JimengSessionAccount | null;
}

/**
 * 项目管理相关类型定义（新增）
 */

/**
 * 项目
 */
export interface Project {
  id: number;
  name: string;
  description?: string;
  settings_json?: string;
  video_save_path?: string;
  default_concurrent?: number;
  default_min_interval?: number;
  default_max_interval?: number;
  task_count?: number;
  completed_count?: number;
  created_at: string;
  updated_at: string;
}

/**
 * 项目设置
 */
export interface ProjectSettings {
  model?: string;
  ratio?: string;
  duration?: number;
  referenceMode?: string;
}

/**
 * 任务
 */
export interface Task {
  id: number;
  project_id: number;
  batch_id?: number;
  prompt: string;
  task_kind: TaskKind;
  source_task_id?: number | null;
  row_group_id?: string | null;
  row_index?: number | null;
  video_count: number;
  output_index?: number | null;
  status: TaskStatus;
  submit_id?: string | null;
  history_id?: string | null;
  item_id?: string | null;
  video_url?: string | null;
  video_path?: string | null;
  download_status?: DownloadStatus | null;
  download_path?: string | null;
  downloaded_at?: string | null;
  submitted_at?: string | null;
  account_info?: string | null;
  progress?: string | null;
  audio_path?: string;
  audio_uri?: string;
  send_count?: number;
  last_sent_at?: string;
  created_at: string;
  updated_at: string;
  started_at?: string;
  completed_at?: string;
  error_message?: string | null;
  retry_count?: number;
  project_name?: string;
  assets?: TaskAsset[];
}

export type TaskKind = 'draft' | 'output';

/**
 * 任务状态
 */
export type TaskStatus =
  | 'pending'     // 等待中
  | 'generating'  // 生成中
  | 'done'        // 已完成
  | 'error'       // 出错
  | 'cancelled';  // 已取消

/**
 * 任务素材
 */
export interface TaskAsset {
  id: number;
  task_id: number;
  asset_type: 'image' | 'audio';
  file_path: string;
  image_uri?: string;
  sort_order: number;
}

/**
 * 批量任务
 */
export interface Batch {
  id: number;
  name?: string;
  project_id: number;
  task_ids: string; // JSON 数组
  status: BatchStatus;
  total_count: number;
  completed_count: number;
  failed_count: number;
  cancelled_count: number;
  concurrent_count: number;
  min_interval: number;
  max_interval: number;
  created_at: string;
  started_at?: string;
  completed_at?: string;
}

/**
 * 批量任务状态
 */
export type BatchStatus =
  | 'pending'    // 等待中
  | 'running'    // 运行中
  | 'paused'     // 已暂停
  | 'done'       // 已完成
  | 'error'      // 出错
  | 'cancelled'; // 已取消

export interface BatchTaskSnapshot {
  taskId: number;
  prompt: string;
  status: TaskStatus;
  progress?: string;
  errorMessage?: string;
  submitId?: string;
  historyId?: string;
  itemId?: string;
  videoUrl?: string;
  sourceTaskId?: number;
  rowGroupId?: string;
  outputIndex?: number;
  assetCount?: number;
}

export interface BatchStatusDetail {
  batchId: number;
  projectId: number;
  name?: string;
  status: BatchStatus;
  totalCount: number;
  completedCount: number;
  failedCount: number;
  cancelledCount: number;
  currentRunning: number;
  queueLength: number;
  concurrentCount: number;
  createdAt?: string;
  startedAt?: string;
  completedAt?: string;
  tasks: BatchTaskSnapshot[];
}

export interface InvalidBatchTask {
  taskId: number;
  prompt: string;
  reason: string;
}

export interface BatchStartResult {
  batchId: number;
  totalTasks: number;
}

/**
 * 全局设置
 */
export interface Settings {
  provider?: ProviderId;
  model?: string;
  ratio?: string;
  duration?: string;
  reference_mode?: string;
  download_path?: string;
  max_concurrent?: string;
  min_interval?: string;
  max_interval?: string;
  manual_video_url?: string;
  gpt_2925_master_email?: string;
  gpt_2925_password?: string;
}

/**
 * 定时任务
 */
export interface Schedule {
  id: number;
  name: string;
  project_id?: number;
  task_ids?: string; // JSON 数组
  cron_expression: string;
  enabled: number;
  last_run_at?: string;
  next_run_at?: string;
  created_at: string;
}

/**
 * API 响应
 */
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

/**
 * 生成历史
 */
export interface GenerationHistory {
  id: number;
  task_id: number;
  batch_id?: string;
  request_data?: string;
  response_data?: string;
  created_at: string;
}

/**
 * 下载管理相关类型定义（新增）
 */

/**
 * 下载状态
 */
export type DownloadStatus =
  | 'pending'     // 待下载
  | 'downloading' // 下载中
  | 'done'        // 已下载
  | 'failed'      // 下载失败
  | 'generating'; // 生成中

export interface TaskAccountInfo {
  providerId?: string;
  source?: 'pool' | 'manual_session' | string;
  accountId?: number | null;
  email?: string | null;
  sessionMask?: string | null;
  creditsBefore?: number | null;
  creditsAfter?: number | null;
  creditCost?: number | null;
  phase?: 'selected' | 'completed' | string;
  updatedAt?: string | null;
}

/**
 * 下载任务
 */
export interface DownloadTask {
  id: number;
  prompt: string;
  status: TaskStatus;
  download_status: DownloadStatus;
  video_url?: string;
  video_path?: string;
  download_path?: string;
  downloaded_at?: string;
  account_info?: string | null;
  submit_id?: string;
  history_id?: string;
  created_at: string;
  completed_at?: string;
  project_name?: string;
  hasHistory: boolean;
  model_type: 'image' | 'video';
  effective_download_status: DownloadStatus;
}

/**
 * 账号池中的账号
 */
export interface Account {
  id: number;
  email: string;
  password?: string;
  session_id: string;
  web_id?: string | null;
  provider?: string;
  credits: number;
  status: string;
  last_used_at?: string;
  created_at: string;
  updated_at: string;
  creditSource?: 'live' | 'cached' | 'error';
  creditSyncedAt?: string | null;
  benefitEligibility?: 'eligible' | 'ineligible' | 'unknown';
  benefitLabel?: string;
  benefitReason?: string;
  benefitEvidence?: string;
  benefitTradeSource?: string;
  hasBenefitGrant?: boolean;
  usageStatus?: 'active' | 'zero_credits' | 'no_benefit' | 'invalid' | 'unknown';
  usageStatusLabel?: string;
  syncError?: string;
  fastZeroCreditUiStatus?: 'free' | 'paid' | 'unknown' | 'error';
  fastZeroCreditUiCredits?: number | null;
  fastZeroCreditUiReason?: string;
  fastZeroCreditUiCheckedAt?: string | null;
  fastZeroCreditProbeStatus?: 'success' | 'failed' | 'unknown';
  fastZeroCreditProbeReason?: string;
  fastZeroCreditProbeCheckedAt?: string | null;
}

export interface ManualAccountPayload {
  email: string;
  password?: string;
  sessionId?: string;
  webId?: string;
  provider?: string;
  inspectAfterCreate?: boolean;
}

export interface UpdateManualAccountPayload {
  email: string;
  password?: string;
  sessionId?: string;
  webId?: string;
  provider?: string;
}

export interface ImportAccountsPayload {
  text: string;
  overwriteExisting?: boolean;
}

export interface ImportAccountsResult {
  total: number;
  imported: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  importedIds?: number[];
  errorLines?: string[];
}

export interface AccountPoolSummary {
  total: number;
  totalCredits: number;
  allCredits?: number;
  eligibleCount: number;
  activeCount: number;
  zeroCreditsCount: number;
  zeroBalanceCount?: number;
  noBenefitCount: number;
  invalidCount: number;
  unknownCount: number;
  errorCount: number;
  lastSyncedAt?: string | null;
}

/**
 * 注册任务
 */
export interface RegistrationJob {
  id: string;
  count: number;
  provider: string;
  status: 'running' | 'completed' | 'failed';
  successCount: number;
  failCount: number;
  logs: string[];
  startTime: string;
  endTime?: string;
}

export interface AccountBackgroundJob {
  id: string;
  total: number;
  processed: number;
  successCount: number;
  failCount: number;
  status: 'running' | 'completed' | 'failed';
  logs: string[];
  startTime: string;
  endTime?: string | null;
}

/**
 * 下载任务列表（分页）
 */
export interface DownloadTaskList {
  tasks: DownloadTask[];
  total: number;
  page: number;
  pageSize: number;
}
