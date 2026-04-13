import { useState, useEffect, useRef } from 'react';
import {
  getAccountPool,
  createManualAccount,
  updateManualAccount,
  inspectAccount,
  refreshAccountSession,
  deleteAccount,
  deleteAccountsBatch,
  registerBatch,
  getRegistrationJob,
  syncAllAccounts,
  syncAccountsBatch,
  getSyncJobStatus,
  refreshAccountsBatch,
  getRefreshJobStatus,
} from '../services/authService';
import { getSettings, updateSettings } from '../services/settingsService';
import type { Account, AccountPoolSummary, RegistrationJob, AccountBackgroundJob } from '../types';
import {
  UsersIcon,
  PlusIcon,
  TrashIcon,
  RefreshIcon,
  SpinnerIcon,
  CheckIcon,
  CloseIcon,
  MailIcon,
  ShieldIcon,
  CopyIcon,
  EditIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from '../components/Icons';

export default function AccountPoolPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [summary, setSummary] = useState<AccountPoolSummary>({
    total: 0,
    totalCredits: 0,
    allCredits: 0,
    eligibleCount: 0,
    activeCount: 0,
    zeroCreditsCount: 0,
    zeroBalanceCount: 0,
    noBenefitCount: 0,
    invalidCount: 0,
    unknownCount: 0,
    errorCount: 0,
    lastSyncedAt: null,
  });
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [inspectingIds, setInspectingIds] = useState<Set<number>>(new Set());
  const [refreshingIds, setRefreshingIds] = useState<Set<number>>(new Set());
  
  // 分页状态
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  // 选择状态
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  
  // 批量注册弹窗
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [regCount, setRegCount] = useState(1);
  const [regProvider, setRegProvider] = useState('tempmail.lol');
  const [reg2925Email, setReg2925Email] = useState('');
  const [reg2925Password, setReg2925Password] = useState('');
  const [showManualAddModal, setShowManualAddModal] = useState(false);
  const [manualEmail, setManualEmail] = useState('');
  const [manualPassword, setManualPassword] = useState('');
  const [manualSessionId, setManualSessionId] = useState('');
  const [manualWebId, setManualWebId] = useState('');
  const [manualInspectAfterCreate, setManualInspectAfterCreate] = useState(true);
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [editEmail, setEditEmail] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editSessionId, setEditSessionId] = useState('');
  const [editWebId, setEditWebId] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);
  
  // 复制状态
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<RegistrationJob | null>(null);
  
  // 同步任务状态
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [activeSyncJobId, setActiveSyncJobId] = useState<string | null>(null);
  const [activeSyncJob, setActiveSyncJob] = useState<AccountBackgroundJob | null>(null);
  const [showRefreshModal, setShowRefreshModal] = useState(false);
  const [activeRefreshJobId, setActiveRefreshJobId] = useState<string | null>(null);
  const [activeRefreshJob, setActiveRefreshJob] = useState<AccountBackgroundJob | null>(null);
  
  const logEndRef = useRef<HTMLDivElement>(null);

  const loadAccounts = async (currentPage = page) => {
    try {
      setLoading(true);
      setError('');
      const { accounts: data, pagination, summary: poolSummary } = await getAccountPool(currentPage, pageSize);
      
      // 过滤掉可能的测试账号 (如果有的话)
      const filtered = data.filter((a: Account) => a.email !== 'test@example.com');
      setAccounts(filtered);
      setSummary(poolSummary);
      setTotal(pagination.total);
      setTotalPages(pagination.totalPages);
      
      // 换页时清空选择
      setSelectedIds(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载账号池失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAccounts();
  }, [page]);

  // 获取并预填 2925 邮箱设置
  useEffect(() => {
    if (showRegisterModal && regProvider === '2925') {
      getSettings().then(settings => {
        if (settings.gpt_2925_master_email) setReg2925Email(settings.gpt_2925_master_email);
        if (settings.gpt_2925_password) setReg2925Password(settings.gpt_2925_password);
      }).catch(err => console.error('获取 2925 设置失败:', err));
    }
  }, [showRegisterModal, regProvider]);

  // 轮询注册任务状态
  useEffect(() => {
    let timer: number;
    if (activeJobId) {
      const poll = async () => {
        try {
          const job = await getRegistrationJob(activeJobId);
          setActiveJob(job);
          if (job.status === 'completed' || job.status === 'failed') {
            setActiveJobId(null);
            loadAccounts(); 
          }
        } catch (err) {
          console.error('轮询注册任务失败:', err);
          setActiveJobId(null);
        }
      };
      timer = window.setInterval(poll, 2000);
    }
    return () => clearInterval(timer);
  }, [activeJobId]);

  // 轮询同步任务状态
  useEffect(() => {
    let timer: number;
    if (activeSyncJobId) {
      const poll = async () => {
        try {
          const job = await getSyncJobStatus(activeSyncJobId);
          setActiveSyncJob(job);
          if (job.status === 'completed' || job.status === 'failed') {
            setActiveSyncJobId(null);
            loadAccounts(); 
          }
        } catch (err) {
          console.error('轮询同步任务失败:', err);
          setActiveSyncJobId(null);
        }
      };
      timer = window.setInterval(poll, 2000);
    }
    return () => clearInterval(timer);
  }, [activeSyncJobId]);

  // 轮询 Session 刷新任务状态
  useEffect(() => {
    let timer: number;
    if (activeRefreshJobId) {
      const poll = async () => {
        try {
          const job = await getRefreshJobStatus(activeRefreshJobId);
          setActiveRefreshJob(job);
          if (job.status === 'completed' || job.status === 'failed') {
            setActiveRefreshJobId(null);
            loadAccounts();
          }
        } catch (err) {
          console.error('轮询刷新任务失败:', err);
          setActiveRefreshJobId(null);
        }
      };
      timer = window.setInterval(poll, 2000);
    }
    return () => clearInterval(timer);
  }, [activeRefreshJobId]);

  // 自动滚动日志
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeJob?.logs, activeSyncJob?.logs]);

  const handleCopySessionId = (id: number, sessionId: string) => {
    navigator.clipboard.writeText(sessionId);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除该账号吗？')) return;
    try {
      await deleteAccount(id);
      loadAccounts();
    } catch (err) {
      alert(err instanceof Error ? err.message : '删除失败');
    }
  };

  const handleInspectAccount = async (id: number) => {
    setInspectingIds((prev) => new Set(prev).add(id));
    try {
      const inspected = await inspectAccount(id);
      setAccounts((prev) => prev.map((account) => (account.id === id ? inspected : account)));
      const { summary: poolSummary } = await getAccountPool(page, pageSize);
      setSummary(poolSummary);
    } catch (err) {
      alert(err instanceof Error ? err.message : '检测失败');
    } finally {
      setInspectingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleRefreshAccount = async (id: number) => {
    setRefreshingIds((prev) => new Set(prev).add(id));
    try {
      const refreshed = await refreshAccountSession(id);
      setAccounts((prev) => prev.map((account) => (account.id === id ? refreshed : account)));
      const { summary: poolSummary } = await getAccountPool(page, pageSize);
      setSummary(poolSummary);
      alert('SessionID 已刷新并完成校验');
    } catch (err) {
      alert(err instanceof Error ? err.message : '刷新 SessionID 失败');
    } finally {
      setRefreshingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleBatchDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!confirm(`确定要删除选中的 ${ids.length} 个账号吗？`)) return;
    
    try {
      setLoading(true);
      await deleteAccountsBatch(ids);
      loadAccounts();
    } catch (err) {
      alert(err instanceof Error ? err.message : '批量删除失败');
    } finally {
      setLoading(false);
    }
  };

  const handleBatchSync = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    
    try {
      setSyncing(true);
      const { jobId } = await syncAccountsBatch(ids);
      setActiveSyncJobId(jobId);
      setShowSyncModal(true);
      setActiveSyncJob({
        id: jobId,
        total: ids.length,
        processed: 0,
        successCount: 0,
        failCount: 0,
        status: 'running',
        logs: [`正在启动选中 ${ids.length} 个账号的同步任务...`],
        startTime: new Date().toISOString()
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : '启动批量同步失败');
    } finally {
      setSyncing(false);
    }
  };

  const handleBatchRefresh = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    try {
      setRefreshing(true);
      const { jobId } = await refreshAccountsBatch(ids);
      setActiveRefreshJobId(jobId);
      setShowRefreshModal(true);
      setActiveRefreshJob({
        id: jobId,
        total: ids.length,
        processed: 0,
        successCount: 0,
        failCount: 0,
        status: 'running',
        logs: [`正在启动选中 ${ids.length} 个账号的 SessionID 刷新任务...`],
        startTime: new Date().toISOString(),
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : '启动批量刷新失败');
    } finally {
      setRefreshing(false);
    }
  };

  const handleStartBatch = async () => {
    try {
      // 如果是 2925 模式，先更新全局配置，确保后台能读到最新的主账号信息
      if (regProvider === '2925') {
        if (!reg2925Email || !reg2925Password) {
           alert('使用 2925 模式必须填写主账号邮箱和密码');
           return;
        }
        await updateSettings({
          gpt_2925_master_email: reg2925Email,
          gpt_2925_password: reg2925Password,
        });
      }

      const { jobId } = await registerBatch(regCount, regProvider);
      setActiveJobId(jobId);
      setActiveJob({
        id: jobId,
        count: regCount,
        provider: regProvider,
        status: 'running',
        successCount: 0,
        failCount: 0,
        logs: ['正在启动注册任务...'],
        startTime: new Date().toISOString()
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : '启动失败');
    }
  };

  const resetManualForm = () => {
    setManualEmail('');
    setManualPassword('');
    setManualSessionId('');
    setManualWebId('');
    setManualInspectAfterCreate(true);
  };

  const openEditModal = (account: Account) => {
    setEditingAccount(account);
    setEditEmail(account.email || '');
    setEditPassword(account.password || '');
    setEditSessionId(account.session_id || '');
    setEditWebId(account.web_id || '');
  };

  const closeEditModal = (force = false) => {
    if (editSubmitting && !force) return;
    setEditingAccount(null);
    setEditEmail('');
    setEditPassword('');
    setEditSessionId('');
    setEditWebId('');
  };

  const handleCreateManualAccount = async () => {
    try {
      setManualSubmitting(true);
      await createManualAccount({
        email: manualEmail,
        password: manualPassword || undefined,
        sessionId: manualSessionId || undefined,
        webId: manualWebId || undefined,
        provider: 'dreamina',
        inspectAfterCreate: manualInspectAfterCreate,
      });

      resetManualForm();
      setShowManualAddModal(false);
      if (page !== 1) {
        setPage(1);
      } else {
        await loadAccounts(1);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : '添加账号失败');
    } finally {
      setManualSubmitting(false);
    }
  };

  const handleUpdateManualAccount = async () => {
    if (!editingAccount) return;

    try {
      setEditSubmitting(true);
      const updated = await updateManualAccount(editingAccount.id, {
        email: editEmail,
        password: editPassword || undefined,
        sessionId: editSessionId || undefined,
        webId: editWebId || undefined,
        provider: editingAccount.provider || 'dreamina',
      });
      setAccounts((prev) => prev.map((account) => (account.id === updated.id ? updated : account)));
      closeEditModal(true);
    } catch (err) {
      alert(err instanceof Error ? err.message : '编辑账号失败');
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleSyncAll = async () => {
    try {
      setSyncing(true);
      const { jobId } = await syncAllAccounts();
      setActiveSyncJobId(jobId);
      setShowSyncModal(true);
      setActiveSyncJob({
        id: jobId,
        total: total,
        processed: 0,
        successCount: 0,
        failCount: 0,
        status: 'running',
        logs: ['正在启动全量同步任务...'],
        startTime: new Date().toISOString()
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : '启动同步失败');
    } finally {
      setSyncing(false);
    }
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === accounts.length && accounts.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(accounts.map(a => a.id)));
    }
  };

  const toggleSelectOne = (id: number) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  const getBenefitBadgeClass = (benefitEligibility?: Account['benefitEligibility']) => {
    if (benefitEligibility === 'eligible') return 'bg-green-500/10 text-green-400 border-green-500/30';
    if (benefitEligibility === 'ineligible') return 'bg-red-500/10 text-red-400 border-red-500/30';
    return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
  };

  const getUsageStatusClass = (usageStatus?: Account['usageStatus']) => {
    if (usageStatus === 'active') return 'bg-green-500/10 text-green-400';
    if (usageStatus === 'zero_credits') return 'bg-amber-500/10 text-amber-400';
    if (usageStatus === 'no_benefit') return 'bg-red-500/10 text-red-400';
    return 'bg-gray-700/60 text-gray-300';
  };

  const getFastProbeBadge = (account: Account) => {
    if (account.fastZeroCreditProbeStatus === 'success') {
      return {
        className: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
        label: 'Fast 首免：已实测可用',
      };
    }
    if (account.fastZeroCreditProbeStatus === 'failed') {
      return {
        className: 'bg-rose-500/10 text-rose-300 border-rose-500/30',
        label: 'Fast 首免：已实测无资格',
      };
    }
    if (account.fastZeroCreditUiStatus === 'free') {
      return {
        className: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30',
        label: 'Fast 首免：疑似可用',
      };
    }
    if (account.fastZeroCreditUiStatus === 'paid') {
      return {
        className: 'bg-gray-700/60 text-gray-300 border-gray-600/40',
        label: `Fast 需 ${account.fastZeroCreditUiCredits ?? '?'} 积分`,
      };
    }
    if (account.fastZeroCreditUiStatus === 'error') {
      return {
        className: 'bg-yellow-500/10 text-yellow-300 border-yellow-500/30',
        label: 'Fast 探测失败',
      };
    }
    return null;
  };

  const formatDateTime = (value?: string | null) => {
    if (!value) return '-';
    const normalized = value.includes('T') ? value : value.replace(' ', 'T');
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  };

  return (
    <div className="min-h-screen bg-[#0f111a] p-6 pb-24">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2 flex items-center gap-3">
              <UsersIcon className="w-8 h-8 text-purple-500" />
              账号池管理
            </h1>
            <p className="text-gray-400">管理自动化生成的 Dreamina 账号池，支持批量同步与分页展示。</p>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={handleSyncAll}
              disabled={syncing}
              className="px-4 py-2.5 bg-gray-800 text-gray-300 hover:text-white hover:bg-gray-700 rounded-xl transition-all flex items-center gap-2 border border-gray-700"
            >
              {syncing ? <SpinnerIcon className="w-4 h-4 animate-spin" /> : <RefreshIcon className="w-4 h-4" />}
              {syncing ? '同步中...' : '同步全量账号'}
            </button>
            <button
              onClick={() => setShowManualAddModal(true)}
              className="px-6 py-2.5 bg-gray-800 text-white rounded-xl font-medium hover:bg-gray-700 transition-all flex items-center gap-2 border border-gray-700"
            >
              <PlusIcon className="w-5 h-5" />
              手动添加账号
            </button>
            <button
              onClick={() => setShowRegisterModal(true)}
              className="px-6 py-2.5 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-xl font-medium hover:shadow-lg hover:shadow-purple-500/25 transition-all flex items-center gap-2"
            >
              <PlusIcon className="w-5 h-5" />
              批量注册账号
            </button>
          </div>
        </div>

        {/* Stats Summary - Simplified to 4 cols for better width */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-[#1c1f2e] border border-gray-800 rounded-2xl p-6">
            <p className="text-gray-400 text-sm mb-1">总账号数</p>
            <p className="text-3xl font-bold text-white">{total}</p>
          </div>
          <div className="bg-[#1c1f2e] border border-gray-800 rounded-2xl p-6">
            <p className="text-gray-400 text-sm mb-1">当前页 / 总页数</p>
            <p className="text-3xl font-bold text-purple-400">{page} / {totalPages}</p>
          </div>
          <div className="bg-[#1c1f2e] border border-gray-800 rounded-2xl p-6">
            <p className="text-gray-400 text-sm mb-1">有权益资格 (全量)</p>
            <p className="text-3xl font-bold text-green-400">{summary.eligibleCount}</p>
            <p className="text-xs text-gray-500 mt-2">可用 {summary.activeCount} / 失效 {summary.invalidCount}</p>
          </div>
          <div className="bg-[#1c1f2e] border border-gray-800 rounded-2xl p-6">
            <p className="text-gray-400 text-sm mb-1">总真实积分 (可用)</p>
            <p className="text-3xl font-bold text-purple-400">{summary.totalCredits}</p>
            <p className="text-xs text-gray-500 mt-2">
              可用账号积分汇总 · 已确认 0 分 {summary.zeroBalanceCount ?? summary.zeroCreditsCount} / 无权益 {summary.noBenefitCount}
            </p>
            <p className="text-[11px] text-gray-600 mt-1">
              账面累计 {summary.allCredits ?? 0}
            </p>
          </div>
        </div>

        {/* Accounts Table */}
        <div className="bg-[#1c1f2e] border border-gray-800 rounded-2xl overflow-hidden shadow-xl">
          {loading ? (
            <div className="p-12 text-center">
              <SpinnerIcon className="w-8 h-8 text-purple-500 inline-block" />
              <p className="text-gray-400 mt-4">正在加载账号池...</p>
            </div>
          ) : accounts.length === 0 ? (
            <div className="p-12 text-center">
              <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
                <UsersIcon className="w-8 h-8 text-gray-500" />
              </div>
              <p className="text-gray-400">暂无账号，请尝试点击“批量注册”</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full table-fixed min-w-[1000px]">
                <thead className="bg-[#0f111a]">
                  <tr>
                    <th className="w-12 px-6 py-4 text-left">
                      <input 
                        type="checkbox" 
                        className="w-4 h-4 rounded border-gray-700 bg-gray-900 text-purple-600 focus:ring-purple-500"
                        checked={selectedIds.size === accounts.length && accounts.length > 0}
                        onChange={toggleSelectAll}
                      />
                    </th>
                    <th className="w-1/4 px-6 py-4 text-left text-xs font-bold text-gray-400 uppercase tracking-wider">邮箱</th>
                    <th className="w-16 px-6 py-4 text-left text-xs font-bold text-gray-400 uppercase tracking-wider">积分</th>
                    <th className="w-1/5 px-6 py-4 text-left text-xs font-bold text-gray-400 uppercase tracking-wider">权益情况</th>
                    <th className="w-24 px-6 py-4 text-left text-xs font-bold text-gray-400 uppercase tracking-wider">状态</th>
                    <th className="w-1/5 px-6 py-4 text-left text-xs font-bold text-gray-400 uppercase tracking-wider">SessionID</th>
                    <th className="w-1/6 px-6 py-4 text-left text-xs font-bold text-gray-400 uppercase tracking-wider">最后同步</th>
                    <th className="w-36 px-6 py-4 text-right text-xs font-bold text-gray-400 uppercase tracking-wider">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {accounts.map(account => (
                    <tr key={account.id} className="hover:bg-gray-800/30 transition-colors">
                      <td className="px-6 py-4">
                        <input 
                          type="checkbox" 
                          className="w-4 h-4 rounded border-gray-700 bg-gray-900 text-purple-600 focus:ring-purple-500"
                          checked={selectedIds.has(account.id)}
                          onChange={() => toggleSelectOne(account.id)}
                        />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap overflow-hidden text-ellipsis">
                        <div className="flex items-center gap-3">
                          <MailIcon className="w-4 h-4 text-gray-500 hidden sm:block" />
                          <span className="text-sm text-white font-medium truncate" title={account.email}>{account.email}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-sm font-bold ${(account.credits || 0) > 20 ? 'text-green-400' : (account.credits || 0) > 0 ? 'text-amber-400' : 'text-gray-500'}`}
                            title={account.creditSource === 'error' ? account.syncError || '检测失败' : `来源: ${account.creditSource || 'cached'}`}
                          >
                            {account.credits || 0}
                          </span>
                          {(account.credits || 0) === 0 ? (
                            account.usageStatus === 'unknown' ? (
                              <span className="inline-flex px-2 py-0.5 rounded-lg text-[10px] font-medium bg-gray-700/60 text-gray-300 border border-gray-600/40">
                                0 分待核验
                              </span>
                            ) : (
                              <span className="inline-flex px-2 py-0.5 rounded-lg text-[10px] font-medium bg-red-500/10 text-red-400 border border-red-500/20">
                                0 积分
                              </span>
                            )
                          ) : null}
                        </div>
                      </td>
                      <td className="px-6 py-4 overflow-hidden">
                        <div className="max-w-full">
                          <span className={`inline-flex px-2 py-0.5 rounded-lg text-[10px] font-medium border ${getBenefitBadgeClass(account.benefitEligibility)}`}>
                            {account.benefitLabel || '待检测'}
                          </span>
                          {getFastProbeBadge(account) ? (
                            <div className="mt-1">
                              <span
                                className={`inline-flex px-2 py-0.5 rounded-lg text-[10px] font-medium border ${getFastProbeBadge(account)?.className}`}
                                title={account.fastZeroCreditUiReason || ''}
                              >
                                {getFastProbeBadge(account)?.label}
                              </span>
                            </div>
                          ) : null}
                          <div className="text-[10px] text-gray-500 mt-1 truncate" title={account.benefitEvidence || account.benefitReason}>
                            {account.benefitEvidence || account.benefitReason || '-'}
                          </div>
                          {account.fastZeroCreditUiReason ? (
                            <div className="text-[10px] text-gray-500 mt-1 truncate" title={account.fastZeroCreditUiReason}>
                              {account.fastZeroCreditUiReason}
                            </div>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="max-w-full">
                          <span
                            className={`px-2 py-0.5 rounded-lg text-[10px] font-medium ${getUsageStatusClass(account.usageStatus)}`}
                            title={account.syncError || account.benefitReason || ''}
                          >
                            {account.usageStatusLabel || '待确认'}
                          </span>
                          {account.syncError ? (
                            <div className="text-[10px] text-gray-500 mt-1 truncate" title={account.syncError}>
                              {account.syncError}
                            </div>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-1 group">
                          <code className="text-xs text-gray-500 bg-gray-900 px-1 py-0.5 rounded">
                            {account.session_id ? `${account.session_id.substring(0, 6)}...` : 'N/A'}
                          </code>
                          {account.session_id && (
                            <button 
                              onClick={() => handleCopySessionId(account.id, account.session_id)}
                              className="p-1 text-gray-500 hover:text-purple-400 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              {copiedId === account.id ? <CheckIcon className="w-3 h-3 text-green-400" /> : <CopyIcon className="w-3 h-3" />}
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-[10px] text-gray-500">
                        {formatDateTime(account.creditSyncedAt)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleInspectAccount(account.id)}
                            disabled={inspectingIds.has(account.id)}
                            className="p-2 text-gray-500 hover:text-purple-400 hover:bg-purple-500/10 rounded-lg transition-all disabled:opacity-50"
                            title="立即检测状态和积分"
                          >
                            {inspectingIds.has(account.id) ? (
                              <SpinnerIcon className="w-4 h-4 animate-spin" />
                            ) : (
                              <RefreshIcon className="w-4 h-4" />
                            )}
                          </button>
                          <button
                            onClick={() => handleRefreshAccount(account.id)}
                            disabled={refreshingIds.has(account.id)}
                            className="p-2 text-gray-500 hover:text-cyan-400 hover:bg-cyan-500/10 rounded-lg transition-all disabled:opacity-50"
                            title="重新登录并刷新 SessionID"
                          >
                            {refreshingIds.has(account.id) ? (
                              <SpinnerIcon className="w-4 h-4 animate-spin" />
                            ) : (
                              <ShieldIcon className="w-4 h-4" />
                            )}
                          </button>
                          <button
                            onClick={() => openEditModal(account)}
                            className="p-2 text-gray-500 hover:text-amber-400 hover:bg-amber-500/10 rounded-lg transition-all"
                            title="编辑账号"
                          >
                            <EditIcon className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(account.id)}
                            className="p-2 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
                            title="删除账号"
                          >
                            <TrashIcon className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          
          {/* Pagination Controls */}
          {!loading && total > 0 && (
            <div className="px-6 py-4 bg-[#0f111a]/50 border-t border-gray-800 flex items-center justify-between">
              <p className="text-sm text-gray-400">
                共 <span className="text-white font-medium">{total}</span> 条记录，
                当前显示 <span className="text-white font-medium">{(page - 1) * pageSize + 1}</span> - <span className="text-white font-medium">{Math.min(page * pageSize, total)}</span>
              </p>
              <div className="flex items-center gap-2">
                <button
                  disabled={page === 1}
                  onClick={() => setPage(p => p - 1)}
                  className="p-2 bg-gray-800 text-gray-400 rounded-lg hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                >
                  <ChevronLeftIcon className="w-5 h-5" />
                </button>
                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum = page;
                    if (totalPages <= 5) pageNum = i + 1;
                    else if (page <= 3) pageNum = i + 1;
                    else if (page >= totalPages - 2) pageNum = totalPages - 4 + i;
                    else pageNum = page - 2 + i;
                    
                    return (
                      <button
                        key={pageNum}
                        onClick={() => setPage(pageNum)}
                        className={`w-10 h-10 rounded-lg font-medium transition-all ${
                          page === pageNum 
                            ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/20' 
                            : 'bg-gray-800 text-gray-400 hover:text-white'
                        }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>
                <button
                  disabled={page === totalPages}
                  onClick={() => setPage(p => p + 1)}
                  className="p-2 bg-gray-800 text-gray-400 rounded-lg hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                >
                  <ChevronRightIcon className="w-5 h-5" />
                </button>
              </div>
            </div>
          )}
        </div>
        
        {error && <div className="mt-8 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 text-sm">{error}</div>}
        <div className="mt-4 text-xs text-gray-500">
          最近全量检测时间：{formatDateTime(summary.lastSyncedAt)} · 异常账号：{summary.errorCount} · 待确认：{summary.unknownCount}
        </div>
      </div>

      {/* Experimental Batch Action Float Bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-40 animate-in slide-in-from-bottom-8 duration-300">
          <div className="bg-[#1c1f2e] border border-purple-500/30 rounded-2xl px-6 py-4 shadow-2xl flex items-center gap-6 backdrop-blur-md">
            <p className="text-sm text-white">
              已选中 <span className="text-purple-400 font-bold">{selectedIds.size}</span> 个账号
            </p>
            <div className="w-px h-8 bg-gray-800" />
            <div className="flex items-center gap-3">
              <button
                onClick={handleBatchSync}
                disabled={syncing}
                className="px-4 py-2 bg-purple-500 text-white rounded-xl font-medium hover:bg-purple-600 transition-all flex items-center gap-2"
              >
                <RefreshIcon className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
                同步选中
              </button>
              <button
                onClick={handleBatchRefresh}
                disabled={refreshing}
                className="px-4 py-2 bg-cyan-500 text-white rounded-xl font-medium hover:bg-cyan-600 transition-all flex items-center gap-2"
              >
                {refreshing ? <SpinnerIcon className="w-4 h-4 animate-spin" /> : <ShieldIcon className="w-4 h-4" />}
                刷新 Session
              </button>
              <button
                onClick={handleBatchDelete}
                className="px-4 py-2 bg-red-500/10 text-red-400 border border-red-500/20 rounded-xl font-medium hover:bg-red-500 hover:text-white transition-all flex items-center gap-2"
              >
                <TrashIcon className="w-4 h-4" />
                批量删除
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="p-2 text-gray-400 hover:text-white rounded-lg transition-all"
              >
                <CloseIcon className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {showManualAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-[#1c1f2e] border border-gray-800 rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-gray-800 flex items-center justify-between bg-gradient-to-r from-cyan-500/10 to-purple-500/10">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <PlusIcon className="w-6 h-6 text-cyan-400" />
                手动添加账号
              </h3>
              <button
                onClick={() => !manualSubmitting && setShowManualAddModal(false)}
                className="p-2 text-gray-400 hover:text-white rounded-xl hover:bg-gray-800 transition-all"
              >
                <CloseIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="p-8 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">邮箱 *</label>
                  <input
                    value={manualEmail}
                    onChange={(e) => setManualEmail(e.target.value)}
                    placeholder="name@example.com"
                    className="w-full px-4 py-3 bg-[#0f111a] border border-gray-700 rounded-2xl text-white focus:outline-none focus:ring-2 focus:ring-cyan-500 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">Web ID</label>
                  <input
                    value={manualWebId}
                    onChange={(e) => setManualWebId(e.target.value)}
                    placeholder="可留空"
                    className="w-full px-4 py-3 bg-[#0f111a] border border-gray-700 rounded-2xl text-white focus:outline-none focus:ring-2 focus:ring-cyan-500 transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">SessionID</label>
                <textarea
                  value={manualSessionId}
                  onChange={(e) => setManualSessionId(e.target.value)}
                  placeholder="支持直接填 sessionid，或 hk-xxxx 这种带区域前缀的值"
                  rows={4}
                  className="w-full px-4 py-3 bg-[#0f111a] border border-gray-700 rounded-2xl text-white focus:outline-none focus:ring-2 focus:ring-cyan-500 transition-all resize-y"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">密码</label>
                <input
                  type="text"
                  value={manualPassword}
                  onChange={(e) => setManualPassword(e.target.value)}
                  placeholder="可留空；填了后支持后续自动刷新 Session"
                  className="w-full px-4 py-3 bg-[#0f111a] border border-gray-700 rounded-2xl text-white focus:outline-none focus:ring-2 focus:ring-cyan-500 transition-all"
                />
              </div>

              <label className="flex items-center gap-3 p-4 bg-[#0f111a] border border-gray-800 rounded-2xl cursor-pointer">
                <input
                  type="checkbox"
                  checked={manualInspectAfterCreate}
                  onChange={(e) => setManualInspectAfterCreate(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-700 bg-gray-900 text-cyan-600 focus:ring-cyan-500"
                />
                <div>
                  <div className="text-sm text-white">添加后立即检测积分和权益</div>
                  <div className="text-xs text-gray-500">仅当填写了 SessionID 时生效</div>
                </div>
              </label>

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 text-sm text-amber-400">
                邮箱必填；`SessionID` 和 `密码` 至少填一个。
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  onClick={() => !manualSubmitting && setShowManualAddModal(false)}
                  className="px-5 py-2.5 bg-gray-800 text-white rounded-xl hover:bg-gray-700 transition-all"
                >
                  取消
                </button>
                <button
                  onClick={handleCreateManualAccount}
                  disabled={manualSubmitting}
                  className="px-6 py-2.5 bg-gradient-to-r from-cyan-500 to-purple-500 text-white rounded-xl font-medium hover:shadow-lg hover:shadow-cyan-500/20 transition-all disabled:opacity-60 flex items-center gap-2"
                >
                  {manualSubmitting ? <SpinnerIcon className="w-4 h-4 animate-spin" /> : <PlusIcon className="w-4 h-4" />}
                  {manualSubmitting ? '添加中...' : '确认添加'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editingAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-[#1c1f2e] border border-gray-800 rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-gray-800 flex items-center justify-between bg-gradient-to-r from-amber-500/10 to-cyan-500/10">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <EditIcon className="w-6 h-6 text-amber-400" />
                编辑账号
              </h3>
              <button
                onClick={() => closeEditModal()}
                className="p-2 text-gray-400 hover:text-white rounded-xl hover:bg-gray-800 transition-all"
              >
                <CloseIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="p-8 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">邮箱 *</label>
                  <input
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    placeholder="name@example.com"
                    className="w-full px-4 py-3 bg-[#0f111a] border border-gray-700 rounded-2xl text-white focus:outline-none focus:ring-2 focus:ring-amber-500 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">Web ID</label>
                  <input
                    value={editWebId}
                    onChange={(e) => setEditWebId(e.target.value)}
                    placeholder="可留空"
                    className="w-full px-4 py-3 bg-[#0f111a] border border-gray-700 rounded-2xl text-white focus:outline-none focus:ring-2 focus:ring-amber-500 transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">SessionID</label>
                <textarea
                  value={editSessionId}
                  onChange={(e) => setEditSessionId(e.target.value)}
                  placeholder="支持直接填 sessionid，或 hk-xxxx 这种带区域前缀的值"
                  rows={4}
                  className="w-full px-4 py-3 bg-[#0f111a] border border-gray-700 rounded-2xl text-white focus:outline-none focus:ring-2 focus:ring-amber-500 transition-all resize-y"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">密码</label>
                <input
                  type="text"
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                  placeholder="编辑时显示已保存密码，可直接修改"
                  className="w-full px-4 py-3 bg-[#0f111a] border border-gray-700 rounded-2xl text-white focus:outline-none focus:ring-2 focus:ring-amber-500 transition-all"
                />
              </div>

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 text-sm text-amber-400">
                编辑时会显示当前已保存密码；`SessionID` 和 `密码` 仍然至少保留一个。
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  onClick={() => closeEditModal()}
                  className="px-5 py-2.5 bg-gray-800 text-white rounded-xl hover:bg-gray-700 transition-all"
                >
                  取消
                </button>
                <button
                  onClick={handleUpdateManualAccount}
                  disabled={editSubmitting}
                  className="px-6 py-2.5 bg-gradient-to-r from-amber-500 to-cyan-500 text-white rounded-xl font-medium hover:shadow-lg hover:shadow-amber-500/20 transition-all disabled:opacity-60 flex items-center gap-2"
                >
                  {editSubmitting ? <SpinnerIcon className="w-4 h-4 animate-spin" /> : <EditIcon className="w-4 h-4" />}
                  {editSubmitting ? '保存中...' : '保存修改'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Batch Register Modal (remain same as original) */}
      {showRegisterModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-[#1c1f2e] border border-gray-800 rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-gray-800 flex items-center justify-between bg-gradient-to-r from-purple-500/10 to-pink-500/10">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <PlusIcon className="w-6 h-6 text-purple-500" />
                批量注册账号
              </h3>
              <button
                onClick={() => !activeJobId && setShowRegisterModal(false)}
                className="p-2 text-gray-400 hover:text-white rounded-xl hover:bg-gray-800 transition-all"
              >
                <CloseIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="p-8">
              {!activeJobId && !activeJob ? (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-2">注册数量</label>
                      <input
                        type="number"
                        min="1"
                        max="10"
                        value={regCount}
                        onChange={(e) => setRegCount(parseInt(e.target.value))}
                        className="w-full px-4 py-3 bg-[#0f111a] border border-gray-700 rounded-2xl text-white focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-2">邮箱服务商</label>
                      <select
                        value={regProvider}
                        onChange={(e) => setRegProvider(e.target.value)}
                        className="w-full px-4 py-3 bg-[#0f111a] border border-gray-700 rounded-2xl text-white focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all appearance-none"
                      >
                        <option value="tempmail.lol">tempmail.lol (v2)</option>
                        <option value="2925">2925 邮箱</option>
                        <option value="duckmail">duckmail (即将支持)</option>
                      </select>
                    </div>
                  </div>

                  {regProvider === '2925' && (
                    <div className="grid grid-cols-2 gap-6 animate-in fade-in slide-in-from-top-2 duration-200">
                      <div>
                        <label className="block text-sm font-medium text-gray-400 mb-2">2925 主账号 *</label>
                        <input
                          type="text"
                          value={reg2925Email}
                          onChange={(e) => setReg2925Email(e.target.value)}
                          placeholder="hackjown5@2925.com"
                          className="w-full px-4 py-3 bg-[#0f111a] border border-gray-700 rounded-2xl text-white focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-400 mb-2">2925 密码 *</label>
                        <input
                          type="password"
                          value={reg2925Password}
                          onChange={(e) => setReg2925Password(e.target.value)}
                          placeholder="2925 登录密码"
                          className="w-full px-4 py-3 bg-[#0f111a] border border-gray-700 rounded-2xl text-white focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all"
                        />
                      </div>
                      <div className="col-span-2 text-[11px] text-gray-500 px-1">
                        * 注册任务将自动在主账号下生成随机后缀的别名邮箱，并自动登录 2925 提取验证码。
                      </div>
                    </div>
                  )}

                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4">
                    <p className="text-sm text-amber-500 flex items-start gap-2">
                      <ShieldIcon className="w-5 h-5 flex-shrink-0 mt-0.5" />
                      注册过程将使用全自动浏览器环境，内置防检测脚本及自动年龄验证。每个账号预计耗时 1-2 分钟。
                    </p>
                  </div>

                  <button
                    onClick={handleStartBatch}
                    className="w-full py-4 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-2xl font-bold text-lg hover:shadow-lg hover:shadow-purple-500/25 transition-all shadow-none mt-4"
                  >
                    开始自动化注册任务
                  </button>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Progress Stats */}
                  <div className="grid grid-cols-3 gap-4">
                    <div className="bg-gray-800/50 rounded-2xl p-4 text-center">
                      <p className="text-xs text-gray-500 mb-1">总计</p>
                      <p className="text-xl font-bold text-white">{activeJob?.count}</p>
                    </div>
                    <div className="bg-green-500/10 rounded-2xl p-4 text-center">
                      <p className="text-xs text-green-500/60 mb-1">成功</p>
                      <p className="text-xl font-bold text-green-500">{activeJob?.successCount}</p>
                    </div>
                    <div className="bg-red-500/10 rounded-2xl p-4 text-center">
                      <p className="text-xs text-red-500/60 mb-1">失败</p>
                      <p className="text-xl font-bold text-red-500">{activeJob?.failCount}</p>
                    </div>
                  </div>

                  {/* Log Window */}
                  <div className="bg-black rounded-2xl p-4 font-mono text-xs overflow-hidden border border-gray-800">
                    <div className="h-64 overflow-y-auto space-y-1 custom-scrollbar">
                      {activeJob?.logs.map((log, i) => (
                        <div key={i} className="text-gray-400">
                          <span className="text-purple-500/50 mr-2">»</span>
                          {log}
                        </div>
                      ))}
                      <div ref={logEndRef} />
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <p className="text-sm text-gray-500 flex items-center gap-2">
                      {activeJob?.status === 'running' ? (
                        <>
                          <SpinnerIcon className="w-4 h-4 text-purple-500" />
                          正在运行中，请勿关闭弹窗...
                        </>
                      ) : (
                        <>
                          <CheckIcon className="w-4 h-4 text-green-500" />
                          任务已结束
                        </>
                      )}
                    </p>
                    {activeJob?.status !== 'running' && (
                      <button
                        onClick={() => {
                          setShowRegisterModal(false);
                          setActiveJob(null);
                        }}
                        className="px-6 py-2 bg-gray-800 text-white rounded-xl hover:bg-gray-700 transition-all"
                      >
                        完成
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Sync Credits Modal */}
      {showSyncModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-[#1c1f2e] border border-gray-800 rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-gray-800 flex items-center justify-between bg-gradient-to-r from-blue-500/10 to-purple-500/10">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <RefreshIcon className={`w-6 h-6 text-blue-500 ${activeSyncJob?.status === 'running' ? 'animate-spin' : ''}`} />
                同期账号积分
              </h3>
              <button
                onClick={() => !activeSyncJobId && setShowSyncModal(false)}
                className="p-2 text-gray-400 hover:text-white rounded-xl hover:bg-gray-800 transition-all"
              >
                <CloseIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="p-8">
              <div className="space-y-6">
                {/* Progress Stats */}
                <div className="grid grid-cols-4 gap-4">
                  <div className="bg-gray-800/50 rounded-2xl p-4 text-center">
                    <p className="text-xs text-gray-500 mb-1">总计</p>
                    <p className="text-xl font-bold text-white">{activeSyncJob?.total || 0}</p>
                  </div>
                  <div className="bg-blue-500/10 rounded-2xl p-4 text-center">
                    <p className="text-xs text-blue-500/60 mb-1">已处理</p>
                    <p className="text-xl font-bold text-blue-500">{activeSyncJob?.processed || 0}</p>
                  </div>
                  <div className="bg-green-500/10 rounded-2xl p-4 text-center">
                    <p className="text-xs text-green-500/60 mb-1">成功</p>
                    <p className="text-xl font-bold text-green-500">{activeSyncJob?.successCount || 0}</p>
                  </div>
                  <div className="bg-red-500/10 rounded-2xl p-4 text-center">
                    <p className="text-xs text-red-500/60 mb-1">失败</p>
                    <p className="text-xl font-bold text-red-500">{activeSyncJob?.failCount || 0}</p>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
                  <div 
                    className="bg-gradient-to-r from-blue-500 to-purple-500 h-full transition-all duration-500"
                    style={{ width: `${Math.round(((activeSyncJob?.processed || 0) / (activeSyncJob?.total || 1)) * 100)}%` }}
                  />
                </div>

                {/* Log Window */}
                <div className="bg-black rounded-2xl p-4 font-mono text-xs overflow-hidden border border-gray-800">
                  <div className="h-64 overflow-y-auto space-y-1 custom-scrollbar">
                    {activeSyncJob?.logs?.map((log: string, i: number) => (
                      <div key={i} className="text-gray-400">
                        <span className="text-blue-500/50 mr-2">»</span>
                        {log}
                      </div>
                    ))}
                    <div ref={logEndRef} />
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-500 flex items-center gap-2">
                    {activeSyncJob?.status === 'running' ? (
                      <>
                        <SpinnerIcon className="w-4 h-4 text-blue-500" />
                        并发同步中，您可以关闭此弹窗，同步将在后台继续...
                      </>
                    ) : (
                      <>
                        <CheckIcon className="w-4 h-4 text-green-500" />
                        任务已结束
                      </>
                    )}
                  </p>
                  <button
                    onClick={() => setShowSyncModal(false)}
                    className="px-6 py-2 bg-gray-800 text-white rounded-xl hover:bg-gray-700 transition-all"
                  >
                    {activeSyncJob?.status === 'running' ? '后台运行' : '完成'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Refresh Session Modal */}
      {showRefreshModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-[#1c1f2e] border border-gray-800 rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-gray-800 flex items-center justify-between bg-gradient-to-r from-cyan-500/10 to-blue-500/10">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <ShieldIcon className={`w-6 h-6 text-cyan-400 ${activeRefreshJob?.status === 'running' ? 'animate-pulse' : ''}`} />
                刷新 SessionID
              </h3>
              <button
                onClick={() => !activeRefreshJobId && setShowRefreshModal(false)}
                className="p-2 text-gray-400 hover:text-white rounded-xl hover:bg-gray-800 transition-all"
              >
                <CloseIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="p-8">
              <div className="space-y-6">
                <div className="grid grid-cols-4 gap-4">
                  <div className="bg-gray-800/50 rounded-2xl p-4 text-center">
                    <p className="text-xs text-gray-500 mb-1">总计</p>
                    <p className="text-xl font-bold text-white">{activeRefreshJob?.total || 0}</p>
                  </div>
                  <div className="bg-cyan-500/10 rounded-2xl p-4 text-center">
                    <p className="text-xs text-cyan-500/60 mb-1">已处理</p>
                    <p className="text-xl font-bold text-cyan-400">{activeRefreshJob?.processed || 0}</p>
                  </div>
                  <div className="bg-green-500/10 rounded-2xl p-4 text-center">
                    <p className="text-xs text-green-500/60 mb-1">成功</p>
                    <p className="text-xl font-bold text-green-500">{activeRefreshJob?.successCount || 0}</p>
                  </div>
                  <div className="bg-red-500/10 rounded-2xl p-4 text-center">
                    <p className="text-xs text-red-500/60 mb-1">失败</p>
                    <p className="text-xl font-bold text-red-500">{activeRefreshJob?.failCount || 0}</p>
                  </div>
                </div>

                <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-cyan-500 to-blue-500 h-full transition-all duration-500"
                    style={{ width: `${Math.round(((activeRefreshJob?.processed || 0) / (activeRefreshJob?.total || 1)) * 100)}%` }}
                  />
                </div>

                <div className="bg-black rounded-2xl p-4 font-mono text-xs overflow-hidden border border-gray-800">
                  <div className="h-64 overflow-y-auto space-y-1 custom-scrollbar">
                    {activeRefreshJob?.logs?.map((log: string, i: number) => (
                      <div key={i} className="text-gray-400">
                        <span className="text-cyan-500/50 mr-2">»</span>
                        {log}
                      </div>
                    ))}
                    <div ref={logEndRef} />
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-500 flex items-center gap-2">
                    {activeRefreshJob?.status === 'running' ? (
                      <>
                        <SpinnerIcon className="w-4 h-4 text-cyan-400 animate-spin" />
                        正在批量重新登录并刷新 SessionID，可后台继续运行...
                      </>
                    ) : (
                      <>
                        <CheckIcon className="w-4 h-4 text-green-500" />
                        刷新任务已结束
                      </>
                    )}
                  </p>
                  <button
                    onClick={() => setShowRefreshModal(false)}
                    className="px-6 py-2 bg-gray-800 text-white rounded-xl hover:bg-gray-700 transition-all"
                  >
                    {activeRefreshJob?.status === 'running' ? '后台运行' : '完成'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
