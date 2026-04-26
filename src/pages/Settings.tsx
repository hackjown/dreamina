import { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import * as settingsService from '../services/settingsService';
import * as authService from '../services/authService';
import {
  RATIO_OPTIONS,
  DURATION_OPTIONS,
  MODEL_OPTIONS,
  PROVIDER_OPTIONS,
  normalizeModelId,
  type ApiKeyItem,
  type CreatedApiKey,
  type JimengSessionAccount,
  type ProviderId,
} from '../types/index';
import { PlusIcon, SparkleIcon, CheckIcon, CloseIcon, RefreshIcon } from '../components/Icons';

type EcommerceApiRole = 'analysis' | 'generation' | 'video';

export default function SettingsPage() {
  const { state, updateSettingsAction, currentUser } = useApp();
  const { settings } = state;
  const normalizedProvider = settings.provider === 'manual-dreamina' ? 'dreamina' : (settings.provider || 'dreamina');

  const [localSettings, setLocalSettings] = useState({
    provider: normalizedProvider as ProviderId,
    model: normalizeModelId(settings.model),
    ratio: settings.ratio || '16:9',
    duration: settings.duration || '5',
    reference_mode: settings.reference_mode || '全能参考',
    download_path: settings.download_path || '',
    max_concurrent: settings.max_concurrent || '5',
    min_interval: settings.min_interval || '30000',
    max_interval: settings.max_interval || '50000',
    manual_video_url: settings.manual_video_url || '',
    gpt_2925_master_email: settings.gpt_2925_master_email || '',
    gpt_2925_password: settings.gpt_2925_password || '',
    ecommerce_api_name: settings.ecommerce_api_name || '',
    ecommerce_api_url: settings.ecommerce_api_url || '',
    ecommerce_api_key: settings.ecommerce_api_key || '',
    ecommerce_model: settings.ecommerce_model || '',
    ecommerce_analysis_api_name: settings.ecommerce_analysis_api_name || settings.ecommerce_api_name || '',
    ecommerce_analysis_api_url: settings.ecommerce_analysis_api_url || settings.ecommerce_api_url || '',
    ecommerce_analysis_api_key: settings.ecommerce_analysis_api_key || settings.ecommerce_api_key || '',
    ecommerce_analysis_model: settings.ecommerce_analysis_model || settings.ecommerce_model || '',
    ecommerce_generation_api_name: settings.ecommerce_generation_api_name || settings.ecommerce_api_name || '',
    ecommerce_generation_provider: settings.ecommerce_generation_provider || 'openai',
    ecommerce_generation_api_url: settings.ecommerce_generation_api_url || settings.ecommerce_api_url || '',
    ecommerce_generation_api_key: settings.ecommerce_generation_api_key || settings.ecommerce_api_key || '',
    ecommerce_generation_model: settings.ecommerce_generation_model || settings.ecommerce_model || 'dreamina-image-4.1',
    ecommerce_video_api_name: settings.ecommerce_video_api_name || '',
    ecommerce_video_provider: settings.ecommerce_video_provider || 'dreamina',
    ecommerce_video_api_url: settings.ecommerce_video_api_url || '',
    ecommerce_video_api_key: settings.ecommerce_video_api_key || '',
    ecommerce_video_model: settings.ecommerce_video_model || 'seedance-2.0-fast',
  });
  const [profileForm, setProfileForm] = useState({
    username: currentUser?.username || '',
  });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [passwordForm, setPasswordForm] = useState({
    oldPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Session ID 账号管理
  const [sessionAccounts, setSessionAccounts] = useState<JimengSessionAccount[]>([]);
  const [newAccount, setNewAccount] = useState({ name: '', sessionId: '', email: '', password: '' });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingAccount, setEditingAccount] = useState({ name: '', sessionId: '', email: '', password: '' });
  const [isTesting, setIsTesting] = useState(false);
  const [refreshingAccountId, setRefreshingAccountId] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message?: string;
    error?: string;
    points?: number;
    normalizedSessionId?: string;
  } | null>(null);
  const [testTargetId, setTestTargetId] = useState<number | null>(null);
  const [testingEcommerceRole, setTestingEcommerceRole] = useState<EcommerceApiRole | null>(null);
  const [ecommerceTestStatus, setEcommerceTestStatus] = useState<{ success: boolean; message?: string; error?: string } | null>(null);
  const [detectedAnalysisModels, setDetectedAnalysisModels] = useState<string[]>([]);
  const [detectedGenerationModels, setDetectedGenerationModels] = useState<string[]>([]);
  const [detectedVideoModels, setDetectedVideoModels] = useState<string[]>([]);
  const [fetchingEcommerceRole, setFetchingEcommerceRole] = useState<EcommerceApiRole | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [ecommerceSaveStatus, setEcommerceSaveStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([]);
  const [apiKeysLoading, setApiKeysLoading] = useState(false);
  const [apiKeyName, setApiKeyName] = useState('');
  const [apiKeySubmitting, setApiKeySubmitting] = useState(false);
  const [apiKeyError, setApiKeyError] = useState('');
  const [createdApiKey, setCreatedApiKey] = useState<CreatedApiKey | null>(null);
  const [copyStatus, setCopyStatus] = useState('');
  const availableModels = MODEL_OPTIONS.filter((option) => option.provider === localSettings.provider);

  // 加载 Session ID 账号列表
  const loadSessionAccounts = async () => {
    try {
      const data = await settingsService.getSessionAccounts();
      setSessionAccounts(data.accounts || []);
    } catch (error) {
      console.error('加载 SessionID 列表失败:', error);
    }
  };

  useEffect(() => {
    loadSessionAccounts();
    loadApiKeys();
  }, []);

  useEffect(() => {
    setProfileForm({
      username: currentUser?.username || '',
    });
  }, [currentUser?.username]);

  useEffect(() => {
    // 只有当本地设置还是初始空状态时才同步，避免覆盖用户正在输入的修改
    const isEcommerceEmpty =
      !localSettings.ecommerce_analysis_api_url &&
      !localSettings.ecommerce_analysis_api_key &&
      !localSettings.ecommerce_generation_api_url &&
      !localSettings.ecommerce_generation_api_key;
    if (Object.keys(settings).length > 0 && isEcommerceEmpty) {
      setLocalSettings(prev => ({
        ...prev,
        ...settings,
        provider: (settings.provider as ProviderId) || prev.provider,
        model: normalizeModelId(settings.model) || prev.model,
      }));
    }
  }, [settings]);

  useEffect(() => {
    if (!availableModels.some((option) => option.value === localSettings.model)) {
      setLocalSettings((prev) => ({
        ...prev,
        model: availableModels[0]?.value || 'seedance-2.0-fast',
      }));
    }
  }, [availableModels, localSettings.model]);

  // 保存设置
  const handleSave = async () => {
    setSaveMessage(null);
    try {
      await updateSettingsAction(localSettings);
      setHasChanges(false);
      setSaveMessage({ type: 'success', text: '全局设置已保存' });
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (error: any) {
      setSaveMessage({ type: 'error', text: `保存失败：${error.message || error}` });
    }
  };

  const handleUpdateProfile = async () => {
    const username = profileForm.username.trim();

    if (!username) {
      setProfileMessage({ type: 'error', text: '登录账号不能为空' });
      return;
    }

    setProfileSaving(true);
    setProfileMessage(null);
    try {
      await authService.updateCurrentUserProfile({ username });
      setProfileMessage({ type: 'success', text: '登录账号已更新' });
    } catch (error) {
      setProfileMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '更新账户资料失败',
      });
    } finally {
      setProfileSaving(false);
    }
  };

  const handleChangePassword = async () => {
    setPasswordMessage(null);

    if (!passwordForm.oldPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
      setPasswordMessage({ type: 'error', text: '请完整填写密码表单' });
      return;
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordMessage({ type: 'error', text: '两次输入的新密码不一致' });
      return;
    }

    setPasswordSaving(true);
    try {
      await authService.changePassword(passwordForm.oldPassword, passwordForm.newPassword);
      setPasswordForm({ oldPassword: '', newPassword: '', confirmPassword: '' });
      setPasswordMessage({ type: 'success', text: '密码已修改，请重新登录' });
      alert('密码已修改，请重新登录');
    } catch (error) {
      setPasswordMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '修改密码失败',
      });
    } finally {
      setPasswordSaving(false);
    }
  };

  // 添加 Session ID 账号
  const handleAddAccount = async () => {
    if (!newAccount.sessionId) {
      alert('请输入 SessionID');
      return;
    }

    try {
      const account = await settingsService.createSessionAccount({
        name: newAccount.name || `账号 ${sessionAccounts.length + 1}`,
        sessionId: newAccount.sessionId,
        email: newAccount.email,
        password: newAccount.password,
      });
      setSessionAccounts([...sessionAccounts, account]);
      setNewAccount({ name: '', sessionId: '', email: '', password: '' });
      alert('添加成功');
    } catch (error) {
      alert(`添加失败：${error instanceof Error ? error.message : error}`);
    }
  };

  // 删除 Session ID 账号
  const handleDeleteAccount = async (id: number) => {
    if (!confirm('确定要删除此 SessionID 账号吗？')) return;

    try {
      await settingsService.deleteSessionAccount(id);
      setSessionAccounts(sessionAccounts.filter((a) => a.id !== id));
      alert('删除成功');
    } catch (error) {
      alert(`删除失败：${error instanceof Error ? error.message : error}`);
    }
  };

  // 设为默认账号
  const handleSetDefault = async (id: number) => {
    try {
      await settingsService.setDefaultSessionAccount(id);
      setSessionAccounts(
        sessionAccounts.map((a) => ({
          ...a,
          isDefault: a.id === id,
        }))
      );
      alert('已设为默认账号');
    } catch (error) {
      alert(`设置失败：${error instanceof Error ? error.message : error}`);
    }
  };

  // 开始编辑
  const startEditing = (account: JimengSessionAccount) => {
    setEditingId(account.id);
    setEditingAccount({
      name: account.name,
      sessionId: account.sessionId,
      email: account.email || '',
      password: '',
    });
  };

  // 保存编辑
  const handleSaveEdit = async (id: number) => {
    try {
      const updatePayload: Partial<typeof editingAccount> = {
        name: editingAccount.name,
        sessionId: editingAccount.sessionId,
        email: editingAccount.email,
      };
      if (editingAccount.password) {
        updatePayload.password = editingAccount.password;
      }

      await settingsService.updateSessionAccount(id, updatePayload);
      setSessionAccounts(
        sessionAccounts.map((a) => (
          a.id === id
            ? {
                ...a,
                name: editingAccount.name,
                sessionId: editingAccount.sessionId,
                email: editingAccount.email,
                hasPassword: editingAccount.password ? true : a.hasPassword,
              }
            : a
        ))
      );
      setEditingId(null);
      setEditingAccount({ name: '', sessionId: '', email: '', password: '' });
      alert('更新成功');
    } catch (error) {
      alert(`更新失败：${error instanceof Error ? error.message : error}`);
    }
  };

  // 取消编辑
  const cancelEdit = () => {
    setEditingId(null);
    setEditingAccount({ name: '', sessionId: '', email: '', password: '' });
  };

  const handleRefreshAccount = async (id: number) => {
    setRefreshingAccountId(id);
    try {
      const refreshed = await settingsService.refreshSessionAccount(id);
      setSessionAccounts((prev) => prev.map((account) => (account.id === id ? refreshed : account)));
      alert('SessionID 已刷新');
    } catch (error) {
      alert(`刷新失败：${error instanceof Error ? error.message : error}`);
    } finally {
      setRefreshingAccountId(null);
    }
  };

  // 测试 SessionID
  const handleTestSession = async (sessionId: string, id: number | null = null) => {
    if (!sessionId) {
      alert('请先输入 SessionID');
      return;
    }

    setIsTesting(true);
    setTestResult(null);
    setTestTargetId(id);

    try {
      const result = await settingsService.testJimengSessionId(sessionId);
      setTestResult(result);
    } catch (error) {
      setTestResult({
        success: false,
        error: error instanceof Error ? error.message : '测试失败',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const getEcommerceConfig = (role: EcommerceApiRole) => {
    if (role === 'analysis') {
      return {
        label: '识别',
        apiKey: localSettings.ecommerce_analysis_api_key,
        baseUrl: localSettings.ecommerce_analysis_api_url,
        model: localSettings.ecommerce_analysis_model,
      };
    }

    if (role === 'generation') {
      return {
      label: '生图',
      provider: localSettings.ecommerce_generation_provider || 'openai',
      apiKey: localSettings.ecommerce_generation_api_key,
      baseUrl: localSettings.ecommerce_generation_api_url,
      model: localSettings.ecommerce_generation_model,
      };
    }

    return {
      label: '视频',
      provider: localSettings.ecommerce_video_provider || 'dreamina',
      apiKey: localSettings.ecommerce_video_api_key,
      baseUrl: localSettings.ecommerce_video_api_url,
      model: localSettings.ecommerce_video_model,
    };
  };

  const handleSaveEcommerceConfig = async () => {
    setEcommerceSaveStatus(null);
    try {
      const payload = {
        ecommerce_api_name: String(localSettings.ecommerce_generation_api_name || localSettings.ecommerce_analysis_api_name || '').trim(),
        ecommerce_api_url: String(localSettings.ecommerce_generation_api_url || localSettings.ecommerce_analysis_api_url || '').trim(),
        ecommerce_api_key: String(localSettings.ecommerce_generation_api_key || localSettings.ecommerce_analysis_api_key || '').trim(),
        ecommerce_model: String(localSettings.ecommerce_generation_model || localSettings.ecommerce_analysis_model || '').trim(),
        ecommerce_analysis_api_name: String(localSettings.ecommerce_analysis_api_name || '').trim(),
        ecommerce_analysis_api_url: String(localSettings.ecommerce_analysis_api_url || '').trim(),
        ecommerce_analysis_api_key: String(localSettings.ecommerce_analysis_api_key || '').trim(),
        ecommerce_analysis_model: String(localSettings.ecommerce_analysis_model || '').trim(),
        ecommerce_generation_api_name: String(localSettings.ecommerce_generation_api_name || '').trim(),
        ecommerce_generation_provider: String(localSettings.ecommerce_generation_provider || 'openai').trim(),
        ecommerce_generation_api_url: String(localSettings.ecommerce_generation_api_url || '').trim(),
        ecommerce_generation_api_key: String(localSettings.ecommerce_generation_api_key || '').trim(),
        ecommerce_generation_model: String(localSettings.ecommerce_generation_model || '').trim(),
        ecommerce_video_api_name: String(localSettings.ecommerce_video_api_name || '').trim(),
        ecommerce_video_provider: String(localSettings.ecommerce_video_provider || 'dreamina').trim(),
        ecommerce_video_api_url: String(localSettings.ecommerce_video_api_url || '').trim(),
        ecommerce_video_api_key: String(localSettings.ecommerce_video_api_key || '').trim(),
        ecommerce_video_model: String(localSettings.ecommerce_video_model || 'seedance-2.0-fast').trim(),
      };
      await updateSettingsAction(payload);
      setLocalSettings(prev => ({ ...prev, ...payload }));
      setEcommerceSaveStatus({ type: 'success', text: '配置已成功保存到数据库' });
      setTimeout(() => setEcommerceSaveStatus(null), 3000);
    } catch (error: any) {
      setEcommerceSaveStatus({ type: 'error', text: `保存失败: ${error.message}` });
    }
  };

  const handleTestEcommerce = async (role: EcommerceApiRole) => {
    const config = getEcommerceConfig(role);
    if ((role === 'generation' || role === 'video') && config.provider === 'dreamina') {
      setEcommerceTestStatus({ success: true, message: `${config.label}接口将使用项目内 Dreamina / 即梦国际账号池能力` });
      return;
    }
    setTestingEcommerceRole(role);
    setEcommerceTestStatus(null);
    try {
      const response = await fetch('/api/ecommerce/test-connection', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session-id': localStorage.getItem('seedance_session_id') || '',
        },
        body: JSON.stringify({
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          model: config.model,
        }),
      });
      
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const result = await response.json();
        if (response.ok) {
          setEcommerceTestStatus({ success: true, message: `${config.label}接口连接成功 (模型: ${result.model})` });
        } else {
          setEcommerceTestStatus({ success: false, error: `${config.label}接口连接失败：${result.error || '连接失败'}` });
        }
      } else {
        await response.text();
        setEcommerceTestStatus({ 
          success: false, 
          error: `${config.label}接口返回非 JSON 响应。可能由于 API 地址错误导致。状态码: ${response.status}` 
        });
      }
    } catch (error: any) {
      setEcommerceTestStatus({ success: false, error: `${config.label}接口请求失败: ${error.message}` });
    } finally {
      setTestingEcommerceRole(null);
    }
  };

  const handleFetchModels = async (role: EcommerceApiRole) => {
    const config = getEcommerceConfig(role);
    if (role === 'generation' && config.provider === 'dreamina') {
      const modelNames = ['dreamina-image-4.1', 'dreamina-image-4.0'];
      setDetectedGenerationModels(modelNames);
      setLocalSettings(prev => ({
        ...prev,
        ecommerce_generation_model: prev.ecommerce_generation_model || 'dreamina-image-4.1',
      }));
      setEcommerceTestStatus({ success: true, message: '已加载项目内 Dreamina 生图模型' });
      return;
    }
    if (role === 'video' && config.provider === 'dreamina') {
      const modelNames = ['seedance-2.0-fast', 'seedance-2.0', 'dreamina-video-3.0', 'dreamina-video-3.0-pro', 'dreamina-video-2.0', 'dreamina-video-2.0-pro'];
      setDetectedVideoModels(modelNames);
      setLocalSettings(prev => ({
        ...prev,
        ecommerce_video_model: prev.ecommerce_video_model || 'seedance-2.0-fast',
      }));
      setEcommerceTestStatus({ success: true, message: '已加载项目内 Dreamina 视频模型' });
      return;
    }
    if (!config.apiKey || !config.baseUrl) {
      alert(`请先填写${config.label}接口的 API Key 和 API 地址`);
      return;
    }
    setFetchingEcommerceRole(role);
    try {
      const response = await fetch('/api/ecommerce/models', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session-id': localStorage.getItem('seedance_session_id') || '',
        },
        body: JSON.stringify({
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
        }),
      });
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const result = await response.json();
        if (response.ok && result.models) {
          const modelNames = result.models.map((m: any) => m.id);
          if (role === 'analysis') {
            setDetectedAnalysisModels(modelNames);
            if (modelNames.length > 0 && !localSettings.ecommerce_analysis_model) {
              setLocalSettings(prev => ({ ...prev, ecommerce_analysis_model: modelNames[0] }));
            }
          } else if (role === 'generation') {
            setDetectedGenerationModels(modelNames);
            if (modelNames.length > 0 && !localSettings.ecommerce_generation_model) {
              setLocalSettings(prev => ({
                ...prev,
                ecommerce_generation_model: modelNames[0],
                ecommerce_model: modelNames[0],
              }));
            }
          } else {
            setDetectedVideoModels(modelNames);
            if (modelNames.length > 0 && !localSettings.ecommerce_video_model) {
              setLocalSettings(prev => ({ ...prev, ecommerce_video_model: modelNames[0] }));
            }
          }
          setEcommerceTestStatus({ success: true, message: `${config.label}接口成功获取到 ${modelNames.length} 个模型` });
        } else {
          setEcommerceTestStatus({ success: false, error: `${config.label}接口获取模型失败：${result.error || '获取模型失败'}` });
        }
      } else {
        await response.text();
        setEcommerceTestStatus({ 
          success: false, 
          error: `${config.label}接口探测失败：后端返回非 JSON 响应。请检查 Base URL 是否正确。状态码: ${response.status}` 
        });
      }
    } catch (error: any) {
      setEcommerceTestStatus({ success: false, error: `${config.label}接口探测请求失败: ${error.message}` });
    } finally {
      setFetchingEcommerceRole(null);
    }
  };

  // 检查是否有改动
  useEffect(() => {
    const hasChanges =
      localSettings.provider !== normalizedProvider ||
      localSettings.model !== normalizeModelId(settings.model) ||
      localSettings.ratio !== settings.ratio ||
      localSettings.duration !== settings.duration ||
      localSettings.reference_mode !== settings.reference_mode ||
      localSettings.download_path !== settings.download_path ||
      localSettings.max_concurrent !== settings.max_concurrent ||
      localSettings.min_interval !== settings.min_interval ||
      localSettings.max_interval !== settings.max_interval ||
      localSettings.manual_video_url !== (settings.manual_video_url || '') ||
      localSettings.gpt_2925_master_email !== (settings.gpt_2925_master_email || '') ||
      localSettings.gpt_2925_password !== (settings.gpt_2925_password || '') ||
      localSettings.ecommerce_api_name !== (settings.ecommerce_api_name || '') ||
      localSettings.ecommerce_api_url !== (settings.ecommerce_api_url || '') ||
      localSettings.ecommerce_api_key !== (settings.ecommerce_api_key || '') ||
      localSettings.ecommerce_model !== (settings.ecommerce_model || '') ||
      localSettings.ecommerce_analysis_api_name !== (settings.ecommerce_analysis_api_name || settings.ecommerce_api_name || '') ||
      localSettings.ecommerce_analysis_api_url !== (settings.ecommerce_analysis_api_url || settings.ecommerce_api_url || '') ||
      localSettings.ecommerce_analysis_api_key !== (settings.ecommerce_analysis_api_key || settings.ecommerce_api_key || '') ||
      localSettings.ecommerce_analysis_model !== (settings.ecommerce_analysis_model || settings.ecommerce_model || '') ||
      localSettings.ecommerce_generation_api_name !== (settings.ecommerce_generation_api_name || settings.ecommerce_api_name || '') ||
      localSettings.ecommerce_generation_provider !== (settings.ecommerce_generation_provider || 'openai') ||
      localSettings.ecommerce_generation_api_url !== (settings.ecommerce_generation_api_url || settings.ecommerce_api_url || '') ||
      localSettings.ecommerce_generation_api_key !== (settings.ecommerce_generation_api_key || settings.ecommerce_api_key || '') ||
      localSettings.ecommerce_generation_model !== (settings.ecommerce_generation_model || settings.ecommerce_model || 'dreamina-image-4.1') ||
      localSettings.ecommerce_video_api_name !== (settings.ecommerce_video_api_name || '') ||
      localSettings.ecommerce_video_provider !== (settings.ecommerce_video_provider || 'dreamina') ||
      localSettings.ecommerce_video_api_url !== (settings.ecommerce_video_api_url || '') ||
      localSettings.ecommerce_video_api_key !== (settings.ecommerce_video_api_key || '') ||
      localSettings.ecommerce_video_model !== (settings.ecommerce_video_model || 'seedance-2.0-fast');
    setHasChanges(hasChanges);
  }, [localSettings, settings]);

  const loadApiKeys = async () => {
    setApiKeysLoading(true);
    setApiKeyError('');
    try {
      const list = await authService.getApiKeys();
      setApiKeys(list);
    } catch (error) {
      console.error('加载 API Key 列表失败:', error);
      setApiKeyError(error instanceof Error ? error.message : '加载 API Key 列表失败');
    } finally {
      setApiKeysLoading(false);
    }
  };

  const handleCreateApiKey = async () => {
    setApiKeySubmitting(true);
    setApiKeyError('');
    setCopyStatus('');

    try {
      const created = await authService.createApiKey(apiKeyName.trim() || '默认 OpenAPI Key');
      setCreatedApiKey(created);
      setApiKeyName('');
      await loadApiKeys();
    } catch (error) {
      setApiKeyError(error instanceof Error ? error.message : '创建 API Key 失败');
    } finally {
      setApiKeySubmitting(false);
    }
  };

  const handleDeleteApiKey = async (id: number) => {
    if (!confirm('确定删除这个 API Key 吗？删除后外部调用将立即失效。')) return;

    try {
      await authService.deleteApiKey(id);
      setApiKeys((prev) => prev.filter((item) => item.id !== id));
    } catch (error) {
      alert(`删除失败：${error instanceof Error ? error.message : error}`);
    }
  };

  const handleCopyText = async (text: string, successMessage = '已复制') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus(successMessage);
      window.setTimeout(() => setCopyStatus(''), 2000);
    } catch (error) {
      console.error('复制失败:', error);
      setCopyStatus('复制失败，请手动复制');
      window.setTimeout(() => setCopyStatus(''), 2500);
    }
  };

  const defaultAccount = sessionAccounts.find((a) => a.isDefault);
  const profileChanged =
    profileForm.username.trim() !== String(currentUser?.username || '').trim();
  const openApiBase = `${window.location.origin}/api/open`;
  const sampleImageCurl = `curl -X POST ${openApiBase}/generate/image \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -F "prompt=融合 @1 的人物轮廓和 @2 的服装风格，做成电影海报" \\
  -F "model=dreamina-image-4.1" \\
  -F "ratio=1:1" \\
  -F "files=@/path/to/subject.png" \\
  -F "files=@/path/to/style.png"`;
  const sampleVideoCurl = `curl -X POST ${openApiBase}/generate/video \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -F "prompt=@1 作为首帧，@4 作为尾帧，中间动作参考 @2 @3，人物轻微转头并微笑" \\
  -F "model=seedance-2.0-fast" \\
  -F "ratio=16:9" \\
  -F "duration=5" \\
  -F "reference_mode=全能参考" \\
  -F 'reference_map={"first":1,"middle":[2,3],"last":4}' \\
  -F "files=@/path/to/frame1.png" \\
  -F "files=@/path/to/frame2.png" \\
  -F "files=@/path/to/frame3.png" \\
  -F "files=@/path/to/frame4.png"`;

  return (
    <div className="h-full overflow-y-auto bg-[#0f111a] text-white custom-scrollbar">
      <div className="p-6 lg:p-10 space-y-8 animate-in fade-in duration-500">
        <h1 className="text-2xl font-bold mb-6">全局设置</h1>

        <div className="bg-[#1c1f2e] rounded-xl p-6 mb-6 border border-gray-800">
          <h2 className="text-lg font-bold mb-4">Provider 设置</h2>
          <div className="space-y-2">
            {PROVIDER_OPTIONS.map((option) => (
              <button
                key={option.value}
                onClick={() =>
                  setLocalSettings((prev) => ({
                    ...prev,
                    provider: option.value,
                  }))
                }
                className={`w-full text-left px-4 py-3 rounded-lg border transition-all ${
                  localSettings.provider === option.value
                    ? 'border-purple-500 bg-purple-500/10'
                    : 'border-gray-700 bg-[#161824] hover:border-gray-600'
                }`}
              >
                <div className={`text-sm font-medium ${
                  localSettings.provider === option.value ? 'text-purple-400' : 'text-gray-300'
                }`}>
                  {option.label}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {option.description}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="bg-[#1c1f2e] rounded-xl p-6 mb-6 border border-gray-800">
          <div className="flex items-center justify-between gap-3 mb-4">
              <h2 className="text-lg font-bold">电商物料 API 配置</h2>
            <button
              onClick={handleSaveEcommerceConfig}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm transition-colors font-medium"
            >
              保存电商配置
            </button>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="border border-gray-800 rounded-xl p-4 bg-[#161824]">
              <h3 className="text-sm font-bold text-emerald-300 mb-4">1. AI 识别接口</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">配置名称</label>
                  <input
                    type="text"
                    value={localSettings.ecommerce_analysis_api_name}
                    onChange={(e) => setLocalSettings(prev => ({ ...prev, ecommerce_analysis_api_name: e.target.value }))}
                    placeholder="例如：本地 Ollama"
                    className="w-full bg-[#0f111a] border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">API 地址 (Base URL)</label>
                  <input
                    type="text"
                    value={localSettings.ecommerce_analysis_api_url}
                    onChange={(e) => setLocalSettings(prev => ({ ...prev, ecommerce_analysis_api_url: e.target.value }))}
                    placeholder="http://localhost:11434/v1"
                    className="w-full bg-[#0f111a] border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">API Key</label>
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={localSettings.ecommerce_analysis_api_key}
                    onChange={(e) => setLocalSettings(prev => ({ ...prev, ecommerce_analysis_api_key: e.target.value }))}
                    placeholder="ollama"
                    className="w-full bg-[#0f111a] border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div className="relative group">
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-400">识别模型</label>
                    {detectedAnalysisModels.length > 0 && (
                      <button type="button" className="text-xs text-emerald-300 hover:underline" onClick={() => setDetectedAnalysisModels([])}>
                        重置列表
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    value={localSettings.ecommerce_analysis_model}
                    onChange={(e) => setLocalSettings(prev => ({ ...prev, ecommerce_analysis_model: e.target.value }))}
                    placeholder="qwen2.5vl:7b"
                    className="w-full bg-[#0f111a] border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                  />
                  {detectedAnalysisModels.length > 0 && (
                    <div className="absolute z-50 left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-[#1c1f2e] border border-gray-700 rounded-lg shadow-2xl hidden group-focus-within:block custom-scrollbar">
                      {detectedAnalysisModels
                        .filter(m => !localSettings.ecommerce_analysis_model || m.toLowerCase().includes(localSettings.ecommerce_analysis_model.toLowerCase()))
                        .map(m => (
                          <button
                            key={`analysis-${m}`}
                            type="button"
                            onMouseDown={() => setLocalSettings(prev => ({ ...prev, ecommerce_analysis_model: m }))}
                            className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-emerald-500/20 hover:text-white transition-colors border-b border-gray-800/50 last:border-0"
                          >
                            {m}
                          </button>
                        ))
                      }
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => handleFetchModels('analysis')}
                    disabled={fetchingEcommerceRole === 'analysis'}
                    className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-sm transition-colors disabled:opacity-50"
                  >
                    {fetchingEcommerceRole === 'analysis' ? '探测中...' : '探测识别模型'}
                  </button>
                  <button
                    onClick={() => handleTestEcommerce('analysis')}
                    disabled={testingEcommerceRole === 'analysis'}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm transition-colors disabled:opacity-50 font-medium"
                  >
                    {testingEcommerceRole === 'analysis' ? '测试中...' : '测试识别接口'}
                  </button>
                </div>
              </div>
            </div>

            <div className="border border-gray-800 rounded-xl p-4 bg-[#161824]">
              <h3 className="text-sm font-bold text-purple-300 mb-4">2. 图片生成接口</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">生图方式</label>
                  <select
                    value={localSettings.ecommerce_generation_provider}
                    onChange={(e) => setLocalSettings(prev => ({
                      ...prev,
                      ecommerce_generation_provider: e.target.value,
                      ecommerce_generation_model: e.target.value === 'dreamina' ? 'dreamina-image-4.1' : prev.ecommerce_generation_model,
                    }))}
                    className="w-full bg-[#0f111a] border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                  >
                    <option value="openai">OpenAI 兼容接口</option>
                    <option value="dreamina">项目内 Dreamina / 即梦国际</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">配置名称</label>
                  <input
                    type="text"
                    value={localSettings.ecommerce_generation_api_name}
                    onChange={(e) => setLocalSettings(prev => ({ ...prev, ecommerce_generation_api_name: e.target.value }))}
                    placeholder="例如：生图服务器"
                    className="w-full bg-[#0f111a] border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">API 地址 (Base URL)</label>
                  <input
                    type="text"
                    value={localSettings.ecommerce_generation_api_url}
                    onChange={(e) => setLocalSettings(prev => ({ ...prev, ecommerce_generation_api_url: e.target.value }))}
                    placeholder={localSettings.ecommerce_generation_provider === 'dreamina' ? '使用项目内 Dreamina，无需填写' : 'http://192.168.50.188:7860/v1'}
                    disabled={localSettings.ecommerce_generation_provider === 'dreamina'}
                    className="w-full bg-[#0f111a] border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">API Key</label>
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={localSettings.ecommerce_generation_api_key}
                    onChange={(e) => setLocalSettings(prev => ({ ...prev, ecommerce_generation_api_key: e.target.value }))}
                    placeholder={localSettings.ecommerce_generation_provider === 'dreamina' ? '使用项目内 Session/账号池，无需填写' : 'sk-...'}
                    disabled={localSettings.ecommerce_generation_provider === 'dreamina'}
                    className="w-full bg-[#0f111a] border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>
                <div className="relative group">
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-400">生图模型</label>
                    {detectedGenerationModels.length > 0 && (
                      <button type="button" className="text-xs text-purple-300 hover:underline" onClick={() => setDetectedGenerationModels([])}>
                        重置列表
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    value={localSettings.ecommerce_generation_model}
                    onChange={(e) => setLocalSettings(prev => ({ ...prev, ecommerce_generation_model: e.target.value }))}
                    placeholder={localSettings.ecommerce_generation_provider === 'dreamina' ? 'dreamina-image-4.1' : '例如: qwen-image / dall-e-3'}
                    className="w-full bg-[#0f111a] border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                  />
                  {detectedGenerationModels.length > 0 && (
                    <div className="absolute z-50 left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-[#1c1f2e] border border-gray-700 rounded-lg shadow-2xl hidden group-focus-within:block custom-scrollbar">
                      {detectedGenerationModels
                        .filter(m => !localSettings.ecommerce_generation_model || m.toLowerCase().includes(localSettings.ecommerce_generation_model.toLowerCase()))
                        .map(m => (
                          <button
                            key={`generation-${m}`}
                            type="button"
                            onMouseDown={() => setLocalSettings(prev => ({ ...prev, ecommerce_generation_model: m }))}
                            className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-purple-500/20 hover:text-white transition-colors border-b border-gray-800/50 last:border-0"
                          >
                            {m}
                          </button>
                        ))
                      }
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => handleFetchModels('generation')}
                    disabled={fetchingEcommerceRole === 'generation'}
                    className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-sm transition-colors disabled:opacity-50"
                  >
                    {fetchingEcommerceRole === 'generation' ? '探测中...' : '探测生图模型'}
                  </button>
                  <button
                    onClick={() => handleTestEcommerce('generation')}
                    disabled={testingEcommerceRole === 'generation'}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-sm transition-colors disabled:opacity-50 font-medium"
                  >
                    {testingEcommerceRole === 'generation' ? '测试中...' : '测试生图接口'}
                  </button>
                </div>
              </div>
            </div>

            <div className="border border-gray-800 rounded-xl p-4 bg-[#161824]">
              <h3 className="text-sm font-bold text-cyan-300 mb-4">3. 宣传视频接口</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">生视频方式</label>
                  <select
                    value={localSettings.ecommerce_video_provider}
                    onChange={(e) => setLocalSettings(prev => ({
                      ...prev,
                      ecommerce_video_provider: e.target.value,
                      ecommerce_video_model: e.target.value === 'dreamina' ? 'seedance-2.0-fast' : prev.ecommerce_video_model,
                    }))}
                    className="w-full bg-[#0f111a] border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan-500"
                  >
                    <option value="dreamina">项目内 Dreamina / 即梦国际</option>
                    <option value="openai">OpenAI 兼容接口</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">配置名称</label>
                  <input
                    type="text"
                    value={localSettings.ecommerce_video_api_name}
                    onChange={(e) => setLocalSettings(prev => ({ ...prev, ecommerce_video_api_name: e.target.value }))}
                    placeholder="例如：宣传视频服务器"
                    className="w-full bg-[#0f111a] border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">API 地址 (Base URL)</label>
                  <input
                    type="text"
                    value={localSettings.ecommerce_video_api_url}
                    onChange={(e) => setLocalSettings(prev => ({ ...prev, ecommerce_video_api_url: e.target.value }))}
                    placeholder={localSettings.ecommerce_video_provider === 'dreamina' ? '使用项目内 Dreamina，无需填写' : 'https://api.example.com/v1'}
                    disabled={localSettings.ecommerce_video_provider === 'dreamina'}
                    className="w-full bg-[#0f111a] border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">API Key</label>
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={localSettings.ecommerce_video_api_key}
                    onChange={(e) => setLocalSettings(prev => ({ ...prev, ecommerce_video_api_key: e.target.value }))}
                    placeholder={localSettings.ecommerce_video_provider === 'dreamina' ? '使用项目内 Session/账号池，无需填写' : 'sk-...'}
                    disabled={localSettings.ecommerce_video_provider === 'dreamina'}
                    className="w-full bg-[#0f111a] border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>
                <div className="relative group">
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-400">视频模型</label>
                    {detectedVideoModels.length > 0 && (
                      <button type="button" className="text-xs text-cyan-300 hover:underline" onClick={() => setDetectedVideoModels([])}>
                        重置列表
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    value={localSettings.ecommerce_video_model}
                    onChange={(e) => setLocalSettings(prev => ({ ...prev, ecommerce_video_model: e.target.value }))}
                    placeholder={localSettings.ecommerce_video_provider === 'dreamina' ? 'seedance-2.0-fast' : '例如: sora / kling-video / video-model'}
                    className="w-full bg-[#0f111a] border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan-500"
                  />
                  {detectedVideoModels.length > 0 && (
                    <div className="absolute z-50 left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-[#1c1f2e] border border-gray-700 rounded-lg shadow-2xl hidden group-focus-within:block custom-scrollbar">
                      {detectedVideoModels
                        .filter(m => !localSettings.ecommerce_video_model || m.toLowerCase().includes(localSettings.ecommerce_video_model.toLowerCase()))
                        .map(m => (
                          <button
                            key={`video-${m}`}
                            type="button"
                            onMouseDown={() => setLocalSettings(prev => ({ ...prev, ecommerce_video_model: m }))}
                            className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-cyan-500/20 hover:text-white transition-colors border-b border-gray-800/50 last:border-0"
                          >
                            {m}
                          </button>
                        ))
                      }
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => handleFetchModels('video')}
                    disabled={fetchingEcommerceRole === 'video'}
                    className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-sm transition-colors disabled:opacity-50"
                  >
                    {fetchingEcommerceRole === 'video' ? '探测中...' : '探测视频模型'}
                  </button>
                  <button
                    onClick={() => handleTestEcommerce('video')}
                    disabled={testingEcommerceRole === 'video'}
                    className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-sm transition-colors disabled:opacity-50 font-medium"
                  >
                    {testingEcommerceRole === 'video' ? '测试中...' : '测试视频接口'}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <label className="mt-4 inline-flex items-center gap-2 text-xs text-gray-400">
            <input
              type="checkbox"
              checked={showApiKey}
              onChange={(e) => setShowApiKey(e.target.checked)}
              className="rounded border-gray-700 bg-[#0f111a]"
            />
            显示 API Key
          </label>

          {ecommerceTestStatus && (
            <div className={`mt-4 p-3 rounded-lg text-sm border ${
              ecommerceTestStatus.success 
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' 
                : 'bg-red-500/10 border-red-500/30 text-red-400'
            }`}>
              <div className="flex items-start gap-2">
                <span className="mt-0.5">{ecommerceTestStatus.success ? '✓' : '✕'}</span>
                <div>
                  <p className="font-medium">{ecommerceTestStatus.success ? '连接成功' : '错误'}: {ecommerceTestStatus.message || ecommerceTestStatus.error}</p>
                  {!ecommerceTestStatus.success && (ecommerceTestStatus.error?.includes('404') || ecommerceTestStatus.error?.includes('非 JSON')) && (
                    <p className="mt-1 text-xs opacity-80">提示: 您的服务器可能不支持模型探测接口，请尝试手动在 Model 输入框填写模型名称。</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {ecommerceSaveStatus && (
            <div className={`mt-2 p-3 rounded-lg text-sm border ${ecommerceSaveStatus.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
              {ecommerceSaveStatus.text}
            </div>
          )}

          <p className="mt-4 text-xs text-gray-500">
            识别模型需支持图片输入；生图模型需支持图片生成。旧的 Model 配置仍作为兼容兜底。
          </p>
        </div>


        {/* SessionID 账号管理 - Legacy Jimeng & Dreamina 使用 */}
        {['legacy-jimeng', 'dreamina'].includes(localSettings.provider) ? (
        <div className="bg-[#1c1f2e] rounded-xl p-6 mb-6 border border-gray-800">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
            <SparkleIcon className="w-5 h-5 text-purple-400" />
            Dreamina / Legacy Jimeng SessionID 账号管理
          </h2>
          <p className="text-sm text-gray-400 mb-4">
            添加网页 SessionID 账号，供 Dreamina / Legacy Jimeng provider 使用。默认账号将用于视频生成。支持粘贴整串 Cookie，但系统会自动提取并只保存 `sessionid_ss`。如果同时保存 Dreamina 登录邮箱和密码，就可以在这里一键刷新 SessionID，不用再手动去页面里抄 Cookie。
          </p>

          {/* 当前默认账号提示 */}
          {defaultAccount && (
            <div className="mb-4 p-3 bg-green-500/10 border border-green-500/30 rounded-lg flex items-center gap-2">
              <CheckIcon className="w-4 h-4 text-green-400" />
              <span className="text-sm text-green-400">
                当前默认账号：<strong>{defaultAccount.name || '未命名'}</strong>
                <span className="text-gray-500 ml-2">({defaultAccount.sessionId.slice(0, 8)}...{defaultAccount.sessionId.slice(-8)})</span>
              </span>
            </div>
          )}

          {/* 添加新账号 */}
          <div className="mb-4 p-4 bg-[#0f111a] rounded-lg border border-gray-700">
            <h3 className="text-sm font-medium text-gray-300 mb-3">添加新账号</h3>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <input
                type="text"
                value={newAccount.name}
                onChange={(e) => setNewAccount({ ...newAccount, name: e.target.value })}
                placeholder="账号名称（可选）"
                className="bg-[#1c1f2e] border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
              />
              <input
                type="text"
                value={newAccount.sessionId}
                onChange={(e) => setNewAccount({ ...newAccount, sessionId: e.target.value })}
                placeholder="SessionID 或整串 Cookie"
                className="bg-[#1c1f2e] border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
              />
              <input
                type="email"
                value={newAccount.email}
                onChange={(e) => setNewAccount({ ...newAccount, email: e.target.value })}
                placeholder="Dreamina 邮箱（可选）"
                className="bg-[#1c1f2e] border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
              />
              <input
                type="password"
                value={newAccount.password}
                onChange={(e) => setNewAccount({ ...newAccount, password: e.target.value })}
                placeholder="Dreamina 密码（可选）"
                className="bg-[#1c1f2e] border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
              />
              <button
                onClick={handleAddAccount}
                disabled={!newAccount.sessionId}
                className="flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:from-gray-700 disabled:to-gray-700 disabled:text-gray-500 rounded-lg transition-all font-medium"
              >
                <PlusIcon className="w-4 h-4" />
                添加
              </button>
            </div>
          </div>

          {/* 账号列表 */}
          {sessionAccounts.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p>暂无 SessionID 账号</p>
              <p className="text-xs mt-1">访问 https://dreamina.capcut.com 或 https://jimeng.jianying.com ，从 Cookies 中获取 `sessionid_ss` 即可</p>
            </div>
          ) : (
            <div className="space-y-2">
              {sessionAccounts.map((account) => (
                <div
                  key={account.id}
                  className={`p-4 rounded-lg border transition-all ${
                    account.isDefault
                      ? 'bg-purple-500/10 border-purple-500/50'
                      : 'bg-[#0f111a] border-gray-700'
                  }`}
                >
                  {editingId === account.id ? (
                    // 编辑模式
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                        <input
                          type="text"
                          value={editingAccount.name}
                          onChange={(e) => setEditingAccount({ ...editingAccount, name: e.target.value })}
                          placeholder="账号名称"
                          className="bg-[#1c1f2e] border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                        />
                        <input
                          type="text"
                          value={editingAccount.sessionId}
                          onChange={(e) => setEditingAccount({ ...editingAccount, sessionId: e.target.value })}
                          placeholder="SessionID 或整串 Cookie"
                          className="bg-[#1c1f2e] border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                        />
                        <input
                          type="email"
                          value={editingAccount.email}
                          onChange={(e) => setEditingAccount({ ...editingAccount, email: e.target.value })}
                          placeholder="Dreamina 邮箱（可选）"
                          className="bg-[#1c1f2e] border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                        />
                        <input
                          type="password"
                          value={editingAccount.password}
                          onChange={(e) => setEditingAccount({ ...editingAccount, password: e.target.value })}
                          placeholder={account.hasPassword ? '留空则保留原密码' : 'Dreamina 密码（可选）'}
                          className="bg-[#1c1f2e] border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleSaveEdit(account.id)}
                            className="flex-1 px-3 py-2 bg-green-600 hover:bg-green-500 rounded-lg text-sm font-medium transition-colors"
                          >
                            保存
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="flex-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-medium transition-colors"
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    // 显示模式
                    <div className="flex flex-col md:flex-row md:items-center gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`font-medium ${account.id === -1 ? 'text-purple-400' : 'text-gray-200'}`}>
                            {account.name || '未命名'}
                          </span>
                          {account.isDefault && (
                            <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 text-xs rounded-full">
                              默认
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 font-mono">
                          {account.id === -1 ? '由系统自动管理，无需手动维护' : `${account.sessionId.slice(0, 16)}...${account.sessionId.slice(-8)}`}
                        </div>
                        {account.id !== -1 && (account.email || account.hasPassword) && (
                          <div className="mt-1 text-xs text-gray-500">
                            {account.email ? `登录邮箱：${account.email}` : '已保存登录邮箱'}
                            {account.hasPassword ? ' · 已保存密码，可一键刷新' : ' · 未保存密码'}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {account.id !== -1 && (
                          <button
                            onClick={() => handleRefreshAccount(account.id)}
                            disabled={refreshingAccountId === account.id || !account.email || !account.hasPassword}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-800 disabled:text-gray-600 rounded text-xs font-medium transition-colors flex items-center gap-1"
                            title={account.email && account.hasPassword ? '使用已保存的 Dreamina 凭证刷新 SessionID' : '请先保存邮箱和密码'}
                          >
                            <RefreshIcon className="w-3.5 h-3.5" />
                            {refreshingAccountId === account.id ? '刷新中...' : '刷新 Session'}
                          </button>
                        )}
                        {account.id !== -1 && (
                          <button
                            onClick={() => handleTestSession(account.sessionId, account.id)}
                            disabled={isTesting && testTargetId === account.id}
                            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-600 rounded text-xs font-medium transition-colors"
                          >
                            {isTesting && testTargetId === account.id ? '测试中...' : '测试'}
                          </button>
                        )}
                        {!account.isDefault && (
                          <button
                            onClick={() => handleSetDefault(account.id)}
                            className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 rounded text-xs font-medium transition-colors"
                          >
                            选为默认
                          </button>
                        )}
                        {account.id !== -1 && (
                          <>
                            <button
                              onClick={() => startEditing(account)}
                              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-xs font-medium transition-colors"
                            >
                              编辑
                            </button>
                            <button
                              onClick={() => handleDeleteAccount(account.id)}
                              className="px-3 py-1.5 bg-red-600 hover:bg-red-500 rounded text-xs font-medium transition-colors"
                            >
                              删除
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {/* 测试结果 */}
                  {testTargetId === account.id && testResult && (
                    <div
                      className={`mt-3 p-2 rounded text-sm ${
                        testResult.success
                          ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                          : 'bg-red-500/20 text-red-400 border border-red-500/30'
                      }`}
                    >
                      {testResult.success
                        ? `✓ ${testResult.message || 'SessionID 有效'}${testResult.normalizedSessionId ? `（使用: ${testResult.normalizedSessionId.slice(0, 8)}...${testResult.normalizedSessionId.slice(-8)}）` : ''}`
                        : `✗ ${testResult.error || 'SessionID 无效'}`}
                    </div>
                  )}
                </div>
	              ))}
	            </div>
	          )}
	        </div>
	        ) : null}

        <div className="bg-[#1c1f2e] rounded-xl p-6 mb-6 border border-gray-800">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-4">
            <div>
              <h2 className="text-lg font-bold mb-2">开放 API / API Key</h2>
              <p className="text-sm text-gray-400">
                给第三方平台调用当前站点的生图、生视频能力。API Key 明文只在创建时显示一次。
              </p>
            </div>
            <button
              onClick={loadApiKeys}
              disabled={apiKeysLoading}
              className="px-4 py-2 bg-[#161824] border border-gray-700 rounded-lg text-sm text-gray-300 hover:border-gray-600 disabled:opacity-50"
            >
              {apiKeysLoading ? '刷新中...' : '刷新列表'}
            </button>
          </div>

          <div className="mb-4 p-4 bg-[#0f111a] rounded-lg border border-gray-700">
            <h3 className="text-sm font-medium text-gray-300 mb-3">创建新的 API Key</h3>
            <div className="flex flex-col md:flex-row gap-3">
              <input
                type="text"
                value={apiKeyName}
                onChange={(e) => setApiKeyName(e.target.value)}
                placeholder="例如：n8n / Dify / 自建脚本"
                className="flex-1 bg-[#1c1f2e] border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
              />
              <button
                onClick={handleCreateApiKey}
                disabled={apiKeySubmitting}
                className="px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:from-gray-700 disabled:to-gray-700 disabled:text-gray-500 rounded-lg transition-all font-medium"
              >
                {apiKeySubmitting ? '创建中...' : '创建 API Key'}
              </button>
            </div>
            {apiKeyError && (
              <div className="mt-3 p-2 rounded text-sm bg-red-500/20 text-red-400 border border-red-500/30">
                {apiKeyError}
              </div>
            )}
            {copyStatus && (
              <div className="mt-3 text-xs text-green-400">{copyStatus}</div>
            )}
          </div>

          <div className="mb-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-gray-300">已有 API Key</h3>
              <span className="text-xs text-gray-500">共 {apiKeys.length} 个</span>
            </div>

            {apiKeysLoading ? (
              <div className="p-4 rounded-lg border border-gray-700 bg-[#0f111a] text-sm text-gray-400">
                正在加载 API Key...
              </div>
            ) : apiKeys.length === 0 ? (
              <div className="p-4 rounded-lg border border-dashed border-gray-700 bg-[#0f111a] text-sm text-gray-500">
                还没有 API Key，先创建一个即可开始对外调用。
              </div>
            ) : (
              <div className="space-y-2">
                {apiKeys.map((item) => (
                  <div key={item.id} className="p-4 rounded-lg border border-gray-700 bg-[#0f111a]">
                    <div className="flex flex-col md:flex-row md:items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-gray-200">{item.name || '未命名 API Key'}</span>
                          <span className="px-2 py-0.5 bg-green-500/10 text-green-400 text-xs rounded-full">
                            {item.status}
                          </span>
                        </div>
                        <div className="text-xs text-gray-500 font-mono break-all">{item.keyPrefix}</div>
                        <div className="mt-2 text-xs text-gray-500">
                          创建时间：{item.createdAt || '-'}　最近使用：{item.lastUsedAt || '未使用'}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleDeleteApiKey(item.id)}
                          className="px-3 py-1.5 bg-red-600 hover:bg-red-500 rounded text-xs font-medium transition-colors"
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="p-4 rounded-lg border border-gray-700 bg-[#0f111a]">
              <h3 className="text-sm font-medium text-gray-300 mb-3">可调用接口</h3>
              <div className="space-y-2 text-sm text-gray-400">
                <div className="grid grid-cols-[3rem_minmax(0,1fr)] gap-2">
                  <span className="text-purple-400 font-mono">GET</span>
                  <span className="font-mono break-all min-w-0">{openApiBase}/spec</span>
                </div>
                <div className="grid grid-cols-[3rem_minmax(0,1fr)] gap-2">
                  <span className="text-green-400 font-mono">POST</span>
                  <span className="font-mono break-all min-w-0">{openApiBase}/generate/image</span>
                </div>
                <div className="grid grid-cols-[3rem_minmax(0,1fr)] gap-2">
                  <span className="text-green-400 font-mono">POST</span>
                  <span className="font-mono break-all min-w-0">{openApiBase}/generate/video</span>
                </div>
                <div className="grid grid-cols-[3rem_minmax(0,1fr)] gap-2">
                  <span className="text-blue-400 font-mono">GET</span>
                  <span className="font-mono break-all min-w-0">{openApiBase}/tasks/:taskId</span>
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-3 break-words">
                鉴权头支持 <code>Authorization: Bearer API_KEY</code> 或 <code>X-API-Key</code>。
              </p>
            </div>

            <div className="p-4 rounded-lg border border-gray-700 bg-[#0f111a]">
              <h3 className="text-sm font-medium text-gray-300 mb-3">接入说明</h3>
              <ol className="space-y-2 text-sm text-gray-400 list-decimal list-inside">
                <li>先在这里创建 API Key 并保存明文。</li>
                <li>调用生图/生视频接口会返回 <code>taskId</code>。</li>
                <li>再用 <code>/tasks/:taskId</code> 轮询任务状态与结果。</li>
              </ol>
            </div>
          </div>

          <div className="mt-4 space-y-4">
            <div className="p-4 rounded-lg border border-gray-700 bg-[#0f111a]">
              <div className="flex items-center justify-between gap-3 mb-2">
                <h3 className="text-sm font-medium text-gray-300">文生图示例</h3>
                <button
                  onClick={() => handleCopyText(sampleImageCurl, '文生图 curl 已复制')}
                  className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs font-medium transition-colors"
                >
                  复制
                </button>
              </div>
              <pre className="text-xs text-gray-400 whitespace-pre-wrap break-all overflow-x-auto">{sampleImageCurl}</pre>
            </div>

            <div className="p-4 rounded-lg border border-gray-700 bg-[#0f111a]">
              <div className="flex items-center justify-between gap-3 mb-2">
                <h3 className="text-sm font-medium text-gray-300">图生视频示例</h3>
                <button
                  onClick={() => handleCopyText(sampleVideoCurl, '图生视频 curl 已复制')}
                  className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs font-medium transition-colors"
                >
                  复制
                </button>
              </div>
              <pre className="text-xs text-gray-400 whitespace-pre-wrap break-all overflow-x-auto">{sampleVideoCurl}</pre>
            </div>
          </div>
        </div>

        {/* 模型设置 */}
        <div className="bg-[#1c1f2e] rounded-xl p-6 mb-6 border border-gray-800">
          <h2 className="text-lg font-bold mb-4">模型设置</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                选择模型
              </label>
              <div className="space-y-2">
                {availableModels.map((option) => (
                  <button
                    key={option.value}
                    onClick={() =>
                      setLocalSettings((prev) => ({ ...prev, model: option.value }))
                    }
                    className={`w-full text-left px-4 py-3 rounded-lg border transition-all ${
                      localSettings.model === option.value
                        ? 'border-purple-500 bg-purple-500/10'
                        : 'border-gray-700 bg-[#161824] hover:border-gray-600'
                    }`}
                  >
                    <div
                      className={`text-sm font-medium ${
                        localSettings.model === option.value
                          ? 'text-purple-400'
                          : 'text-gray-300'
                      }`}
                    >
                      {option.label}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {option.description}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                参考模式
              </label>
              <div className="flex gap-2">
                {['全能参考', '首帧参考', '尾帧参考'].map((mode) => (
                  <button
                    key={mode}
                    onClick={() =>
                      setLocalSettings((prev) => ({ ...prev, reference_mode: mode }))
                    }
                    className={`flex-1 py-2.5 rounded-lg text-sm font-medium border transition-all ${
                      localSettings.reference_mode === mode
                        ? 'border-purple-500 bg-purple-500/10 text-purple-400'
                        : 'border-gray-700 bg-[#161824] text-gray-400 hover:border-gray-600'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                画面比例
              </label>
              <div className="grid grid-cols-6 gap-2">
                {RATIO_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() =>
                      setLocalSettings((prev) => ({ ...prev, ratio: opt.value }))
                    }
                    className={`flex flex-col items-center gap-1.5 py-2 rounded-lg border transition-all ${
                      localSettings.ratio === opt.value
                        ? 'border-purple-500 bg-purple-500/10'
                        : 'border-gray-700 bg-[#161824] hover:border-gray-600'
                    }`}
                  >
                    <div className="flex items-center justify-center w-8 h-8">
                      <div
                        className={`rounded-sm border ${
                          localSettings.ratio === opt.value
                            ? 'border-purple-400'
                            : 'border-gray-500'
                        }`}
                        style={{
                          width: `${(opt.widthRatio / Math.max(opt.widthRatio, opt.heightRatio)) * 24}px`,
                          height: `${(opt.heightRatio / Math.max(opt.widthRatio, opt.heightRatio)) * 24}px`,
                        }}
                      />
                    </div>
                    <span
                      className={`text-[11px] ${
                        localSettings.ratio === opt.value
                          ? 'text-purple-400'
                          : 'text-gray-400'
                      }`}
                    >
                      {opt.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                视频时长 (秒)
              </label>
              <div className="flex flex-wrap gap-2">
                {DURATION_OPTIONS.map((d) => (
                  <button
                    key={d}
                    onClick={() =>
                      setLocalSettings((prev) => ({
                        ...prev,
                        duration: String(d),
                      }))
                    }
                    className={`px-3 py-2 rounded-lg text-sm font-medium border transition-all ${
                      localSettings.duration === String(d)
                        ? 'border-purple-500 bg-purple-500/10 text-purple-400'
                        : 'border-gray-700 bg-[#161824] text-gray-400 hover:border-gray-600'
                    }`}
                  >
                    {d}秒
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 批量生成设置 */}
        <div className="bg-[#1c1f2e] rounded-xl p-6 mb-6 border border-gray-800">
          <h2 className="text-lg font-bold mb-4">批量生成设置</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                最大并发数
              </label>
              <input
                type="number"
                min="1"
                max="10"
                value={localSettings.max_concurrent}
                onChange={(e) =>
                  setLocalSettings((prev) => ({
                    ...prev,
                    max_concurrent: e.target.value,
                  }))
                }
                className="w-full bg-[#0f111a] border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                最小间隔 (毫秒)
              </label>
              <input
                type="number"
                min="10000"
                max="60000"
                step="1000"
                value={localSettings.min_interval}
                onChange={(e) =>
                  setLocalSettings((prev) => ({
                    ...prev,
                    min_interval: e.target.value,
                  }))
                }
                className="w-full bg-[#0f111a] border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                最大间隔 (毫秒)
              </label>
              <input
                type="number"
                min="30000"
                max="120000"
                step="1000"
                value={localSettings.max_interval}
                onChange={(e) =>
                  setLocalSettings((prev) => ({
                    ...prev,
                    max_interval: e.target.value,
                  }))
                }
                className="w-full bg-[#0f111a] border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
              />
            </div>
          </div>
        </div>

        {/* 2925 邮箱自动注册配置 */}
        <div className="bg-[#1c1f2e] rounded-xl p-6 mb-6 border border-gray-800">
          <h2 className="text-lg font-bold mb-4">2925 邮箱自动注册配置</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                2925 主账号 (Master Email)
              </label>
              <input
                type="text"
                value={localSettings.gpt_2925_master_email}
                onChange={(e) =>
                  setLocalSettings((prev) => ({
                    ...prev,
                    gpt_2925_master_email: e.target.value,
                  }))
                }
                placeholder="例如：hackjown5@2925.com"
                className="w-full bg-[#0f111a] border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                2925 登录密码
              </label>
              <input
                type="password"
                value={localSettings.gpt_2925_password}
                onChange={(e) =>
                  setLocalSettings((prev) => ({
                    ...prev,
                    gpt_2925_password: e.target.value,
                  }))
                }
                placeholder="2925 平台的登录密码"
                className="w-full bg-[#0f111a] border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
              />
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-3">
            用于自动化注册流程。系统将自动在该主账号下生成随机后缀别名，并自动登录该账号提取验证码。注：此配置与 GPT 注册机共享。
          </p>
        </div>

        {/* 下载路径设置 */}
        <div className="bg-[#1c1f2e] rounded-xl p-6 mb-6 border border-gray-800">
          <h2 className="text-lg font-bold mb-4">下载路径设置</h2>

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">
              视频保存路径
            </label>
            <input
              type="text"
              value={localSettings.download_path}
              onChange={(e) =>
                setLocalSettings((prev) => ({
                  ...prev,
                  download_path: e.target.value,
                }))
              }
              placeholder="留空则使用默认路径：~/Videos/Seedance"
              className="w-full bg-[#0f111a] border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
            />
            <p className="text-xs text-gray-500 mt-2">
              生成的视频将自动保存到此目录下的对应项目文件夹中
            </p>
          </div>
        </div>

        <div className="bg-[#1c1f2e] rounded-xl p-6 mb-6 border border-gray-800">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-4">
            <div>
              <h2 className="text-lg font-bold">账户资料</h2>
              <p className="text-sm text-gray-400 mt-1">
                这里维护登录账号。修改密码后当前会话会失效，需要重新登录。
              </p>
            </div>
            <div className="flex gap-2 text-xs">
              <span className="px-2.5 py-1 rounded-full bg-purple-500/10 text-purple-300">
                {currentUser?.role === 'admin' ? '管理员' : '普通用户'}
              </span>
              <span className="px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-300">
                积分 {currentUser?.credits ?? 0}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="p-4 rounded-xl border border-gray-700 bg-[#0f111a]">
              <h3 className="text-sm font-medium text-gray-300 mb-4">基础资料</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">登录账号</label>
                  <input
                    type="text"
                    value={profileForm.username}
                    onChange={(e) => {
                      setProfileForm((prev) => ({ ...prev, username: e.target.value }));
                      setProfileMessage(null);
                    }}
                    placeholder="例如：admin / studio01"
                    className="w-full bg-[#1c1f2e] border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                  />
                </div>
                {profileMessage && (
                  <div className={`rounded-lg px-3 py-2 text-sm border ${
                    profileMessage.type === 'success'
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                      : 'bg-red-500/10 border-red-500/30 text-red-300'
                  }`}>
                    {profileMessage.text}
                  </div>
                )}
                <button
                  onClick={handleUpdateProfile}
                  disabled={profileSaving || !profileChanged}
                  className="px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:from-gray-700 disabled:to-gray-700 disabled:text-gray-500 rounded-lg transition-all font-medium"
                >
                  {profileSaving ? '保存中...' : '保存资料'}
                </button>
              </div>
            </div>

            <div className="p-4 rounded-xl border border-gray-700 bg-[#0f111a]">
              <h3 className="text-sm font-medium text-gray-300 mb-4">修改密码</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">当前密码</label>
                  <input
                    type="password"
                    value={passwordForm.oldPassword}
                    onChange={(e) => {
                      setPasswordForm((prev) => ({ ...prev, oldPassword: e.target.value }));
                      setPasswordMessage(null);
                    }}
                    className="w-full bg-[#1c1f2e] border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">新密码</label>
                  <input
                    type="password"
                    value={passwordForm.newPassword}
                    onChange={(e) => {
                      setPasswordForm((prev) => ({ ...prev, newPassword: e.target.value }));
                      setPasswordMessage(null);
                    }}
                    placeholder="至少 8 位，包含数字和字母"
                    className="w-full bg-[#1c1f2e] border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">确认新密码</label>
                  <input
                    type="password"
                    value={passwordForm.confirmPassword}
                    onChange={(e) => {
                      setPasswordForm((prev) => ({ ...prev, confirmPassword: e.target.value }));
                      setPasswordMessage(null);
                    }}
                    className="w-full bg-[#1c1f2e] border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                  />
                </div>
                {passwordMessage && (
                  <div className={`rounded-lg px-3 py-2 text-sm border ${
                    passwordMessage.type === 'success'
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                      : 'bg-red-500/10 border-red-500/30 text-red-300'
                  }`}>
                    {passwordMessage.text}
                  </div>
                )}
                <button
                  onClick={handleChangePassword}
                  disabled={passwordSaving}
                  className="px-4 py-2 bg-[#161824] border border-gray-700 hover:border-gray-500 rounded-lg transition-all font-medium"
                >
                  {passwordSaving ? '提交中...' : '更新密码'}
                </button>
              </div>
            </div>
          </div>
        </div>


        {/* 保存按钮 */}
        <div className="flex items-center justify-end gap-3 sticky bottom-0 bg-[#0f111a] py-4 border-t border-gray-800 -mx-6 px-6">
          {saveMessage && (
            <div className={`mr-auto px-4 py-2 rounded-lg text-sm font-medium ${
              saveMessage.type === 'success' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
            }`}>
              {saveMessage.text}
            </div>
          )}
          <button
            onClick={() =>
              setLocalSettings({
                provider: normalizedProvider as ProviderId,
                model: normalizeModelId(settings.model),
                ratio: settings.ratio || '16:9',
                duration: settings.duration || '5',
                reference_mode: settings.reference_mode || '全能参考',
                download_path: settings.download_path || '',
                max_concurrent: settings.max_concurrent || '5',
                min_interval: settings.min_interval || '30000',
                max_interval: settings.max_interval || '50000',
                manual_video_url: settings.manual_video_url || '',
                gpt_2925_master_email: settings.gpt_2925_master_email || '',
                gpt_2925_password: settings.gpt_2925_password || '',
                ecommerce_api_name: settings.ecommerce_api_name || '',
                ecommerce_api_url: settings.ecommerce_api_url || '',
                ecommerce_api_key: settings.ecommerce_api_key || '',
                ecommerce_model: settings.ecommerce_model || '',
                ecommerce_analysis_api_name: settings.ecommerce_analysis_api_name || settings.ecommerce_api_name || '',
                ecommerce_analysis_api_url: settings.ecommerce_analysis_api_url || settings.ecommerce_api_url || '',
                ecommerce_analysis_api_key: settings.ecommerce_analysis_api_key || settings.ecommerce_api_key || '',
                ecommerce_analysis_model: settings.ecommerce_analysis_model || settings.ecommerce_model || '',
                ecommerce_generation_api_name: settings.ecommerce_generation_api_name || settings.ecommerce_api_name || '',
                ecommerce_generation_provider: settings.ecommerce_generation_provider || 'openai',
                ecommerce_generation_api_url: settings.ecommerce_generation_api_url || settings.ecommerce_api_url || '',
                ecommerce_generation_api_key: settings.ecommerce_generation_api_key || settings.ecommerce_api_key || '',
                ecommerce_generation_model: settings.ecommerce_generation_model || settings.ecommerce_model || 'dreamina-image-4.1',
                ecommerce_video_api_name: settings.ecommerce_video_api_name || '',
                ecommerce_video_provider: settings.ecommerce_video_provider || 'dreamina',
                ecommerce_video_api_url: settings.ecommerce_video_api_url || '',
                ecommerce_video_api_key: settings.ecommerce_video_api_key || '',
                ecommerce_video_model: settings.ecommerce_video_model || 'seedance-2.0-fast',
              })
            }
            className="px-6 py-2.5 text-gray-400 hover:text-white transition-colors"
          >
            重置
          </button>
          <button
            onClick={handleSave}
            disabled={!hasChanges}
            className="px-6 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:from-gray-700 disabled:to-gray-700 disabled:text-gray-500 rounded-lg transition-all font-medium shadow-lg shadow-purple-900/20"
          >
            保存设置
          </button>
        </div>
      </div>

      {createdApiKey && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-2xl bg-[#1c1f2e] border border-gray-800 rounded-2xl p-6">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h3 className="text-xl font-semibold text-white">API Key 创建成功</h3>
                <p className="text-sm text-gray-400 mt-1">
                  这串明文只显示这一次，请立即保存。关闭后将无法再次查看。
                </p>
              </div>
              <button
                onClick={() => setCreatedApiKey(null)}
                className="text-gray-400 hover:text-white transition-colors"
              >
                <CloseIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="mb-4 p-4 rounded-xl bg-[#0f111a] border border-purple-500/30">
              <div className="text-xs text-gray-500 mb-2">名称：{createdApiKey.name}</div>
              <div className="font-mono text-sm text-purple-300 break-all">{createdApiKey.apiKey}</div>
            </div>

            <div className="flex flex-col md:flex-row gap-3">
              <button
                onClick={() => handleCopyText(createdApiKey.apiKey, 'API Key 已复制')}
                className="flex-1 px-4 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 rounded-xl font-medium transition-all"
              >
                复制 API Key
              </button>
              <button
                onClick={() => setCreatedApiKey(null)}
                className="flex-1 px-4 py-3 bg-[#0f111a] border border-gray-700 hover:bg-gray-800 rounded-xl font-medium transition-all"
              >
                我已保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
