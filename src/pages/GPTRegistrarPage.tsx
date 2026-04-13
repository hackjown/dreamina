import React, { useState, useEffect } from 'react';
import { gptService, GPTAccount, GPTJob } from '../services/gptService';
import settingsService from '../services/settingsService';
import { 
  PlusIcon, 
  ArrowPathIcon, 
  TrashIcon, 
  DocumentDuplicateIcon,
  CheckCircleIcon,
  XCircleIcon,
  PlayIcon,
  Cog6ToothIcon,
  CloudArrowUpIcon,
  MinusIcon
} from '@heroicons/react/24/outline';

const GPTRegistrarPage: React.FC = () => {
  const [accounts, setAccounts] = useState<GPTAccount[]>([]);
  const [jobs, setJobs] = useState<GPTJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [registerCount, setRegisterCount] = useState(1);
  const [settings, setSettings] = useState<any>({});
  const [activeTab, setActiveTab] = useState<'jobs' | 'accounts' | 'settings'>('jobs');
  const [expandedJob, setExpandedJob] = useState<number | null>(null);

  const fetchData = async () => {
    try {
      const [accs, jbs, sets] = await Promise.all([
        gptService.getAccounts(),
        gptService.getJobs(),
        settingsService.getSettings()
      ]);
      setAccounts(accs);
      setJobs(jbs);
      setSettings(sets);
    } catch (error) {
      console.error('Failed to fetch GPT data:', error);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000); // 5s refresh
    return () => clearInterval(interval);
  }, []);

  const handleStartBatch = async () => {
    if (loading) return;
    setLoading(true);
    try {
      await gptService.registerBatch(registerCount);
      setActiveTab('jobs');
      fetchData();
    } catch (error: any) {
      alert(`启动失败: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateSetting = async (key: string, value: string) => {
    try {
      await settingsService.updateSettings({ [key]: value });
      setSettings((prev: any) => ({ ...prev, [key]: value }));
    } catch (error) {
      console.error(`Failed to update ${key}:`, error);
    }
  };

  const handleStopJob = async (id: number) => {
    if (!window.confirm('确定要停止该任务吗？正在运行的步骤将尝试中断。')) return;
    try {
      await gptService.stopJob(id);
      fetchData();
    } catch (error: any) {
      alert(`停止失败: ${error.message}`);
    }
  };

  const handleDeleteJob = async (id: number) => {
    if (!window.confirm('确定要删除该任务记录吗？此操作不可撤销。')) return;
    try {
      await gptService.deleteJob(id);
      fetchData();
    } catch (error: any) {
      alert(`删除失败: ${error.message}`);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    // Simple notification could be added here
  };

  return (
    <div className="flex-1 flex flex-col h-screen bg-gray-950 text-gray-100 overflow-hidden">
      {/* Header */}
      <header className="h-16 border-b border-gray-800 flex items-center justify-between px-8 bg-gray-900/50 backdrop-blur-md sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <PlusIcon className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
              GPT 注册机
            </h1>
            <p className="text-xs text-gray-500 font-medium">Codex Token 自动化获取与分发系统</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex bg-gray-800 rounded-lg p-1">
            <button 
              onClick={() => setActiveTab('jobs')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${activeTab === 'jobs' ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-400 hover:text-white'}`}
            >
              任务列表
            </button>
            <button 
              onClick={() => setActiveTab('accounts')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${activeTab === 'accounts' ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-400 hover:text-white'}`}
            >
              账号池
            </button>
            <button 
              onClick={() => setActiveTab('settings')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${activeTab === 'settings' ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-400 hover:text-white'}`}
            >
              全局配置
            </button>
          </div>
          
          <button 
            onClick={fetchData}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
          >
            <ArrowPathIcon className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto p-8 custom-scrollbar">
        {activeTab === 'settings' && (
          <div className="max-w-4xl mx-auto space-y-6 animate-in slide-in-from-bottom-2 fade-in duration-500">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Browserbase Section */}
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 bg-blue-500/10 rounded-lg">
                    <Cog6ToothIcon className="w-5 h-5 text-blue-400" />
                  </div>
                  <h2 className="text-lg font-semibold">远程浏览器配置</h2>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wider">Browserbase API Key</label>
                    <input 
                      type="password"
                      value={settings.gpt_browserbase_api_key || ''}
                      onChange={(e) => handleUpdateSetting('gpt_browserbase_api_key', e.target.value)}
                      placeholder="bb_live_..."
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 transition-all outline-none"
                    />
                    <p className="mt-1.5 text-[10px] text-gray-500 italic">注：原内置镜像已失效，请务必填写官方 API Key</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wider">Project ID</label>
                    <input 
                      type="text"
                      value={settings.gpt_browserbase_project_id || ''}
                      onChange={(e) => handleUpdateSetting('gpt_browserbase_project_id', e.target.value)}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 transition-all outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Email Provider Section */}
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 bg-orange-500/10 rounded-lg">
                    <XCircleIcon className="w-5 h-5 text-orange-400" />
                  </div>
                  <h2 className="text-lg font-semibold">临时邮箱配置</h2>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wider">邮箱服务商</label>
                    <select 
                      value={settings.gpt_email_provider || 'ddg'}
                      onChange={(e) => handleUpdateSetting('gpt_email_provider', e.target.value)}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 transition-all outline-none text-white appearance-none"
                    >
                      <option value="ddg" className="bg-gray-900">DuckDuckGo (Alias)</option>
                      <option value="2925" className="bg-gray-900">2925 (Sub-email)</option>
                    </select>
                  </div>

                  {(!settings.gpt_email_provider || settings.gpt_email_provider === 'ddg') ? (
                    <>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wider">DDG Token (Required)</label>
                        <input 
                          type="password"
                          value={settings.gpt_ddg_token || ''}
                          onChange={(e) => handleUpdateSetting('gpt_ddg_token', e.target.value)}
                          className="w-full bg-gray-950 border border-gray-800 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 transition-all outline-none border-orange-500/20"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wider">DDG Inbox URL</label>
                        <input 
                          type="text"
                          value={settings.gpt_ddg_inbox_url || ''}
                          onChange={(e) => handleUpdateSetting('gpt_ddg_inbox_url', e.target.value)}
                          placeholder="https://duck.com/..."
                          className="w-full bg-gray-950 border border-gray-800 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 transition-all outline-none"
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wider">2925 Master Email</label>
                        <input 
                          type="text"
                          value={settings.gpt_2925_master_email || ''}
                          onChange={(e) => handleUpdateSetting('gpt_2925_master_email', e.target.value)}
                          placeholder="example@2925.com"
                          className="w-full bg-gray-950 border border-gray-800 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 transition-all outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wider">2925 Password</label>
                        <input 
                          type="password"
                          value={settings.gpt_2925_password || ''}
                          onChange={(e) => handleUpdateSetting('gpt_2925_password', e.target.value)}
                          className="w-full bg-gray-950 border border-gray-800 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 transition-all outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wider">2925 Inbox URL</label>
                        <input 
                          type="text"
                          value={settings.gpt_2925_inbox_url || ''}
                          onChange={(e) => handleUpdateSetting('gpt_2925_inbox_url', e.target.value)}
                          placeholder="https://www.2925.com/#/mailList"
                          className="w-full bg-gray-950 border border-gray-800 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 transition-all outline-none"
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* CLI Proxy Section */}
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl md:col-span-2">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 bg-emerald-500/10 rounded-lg">
                    <CloudArrowUpIcon className="w-5 h-5 text-emerald-400" />
                  </div>
                  <h2 className="text-lg font-semibold">CLI Proxy (CPA) 自动分发配置</h2>
                  <span className="text-xs px-2 py-0.5 bg-emerald-500/10 text-emerald-500 rounded-full font-medium border border-emerald-500/20">新功能</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wider">API Endpoint</label>
                    <input 
                      type="text"
                      value={settings.gpt_cli_proxy_url || ''}
                      onChange={(e) => handleUpdateSetting('gpt_cli_proxy_url', e.target.value)}
                      placeholder="https://api.your-cli-proxy.com/upload"
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 transition-all outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wider">Access Token</label>
                    <input 
                      type="password"
                      value={settings.gpt_cli_proxy_token || ''}
                      onChange={(e) => handleUpdateSetting('gpt_cli_proxy_token', e.target.value)}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 transition-all outline-none"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'jobs' && (
          <div className="max-w-6xl mx-auto space-y-6">
            {/* Quick Action */}
            <div className="bg-indigo-600 rounded-2xl p-6 flex flex-col md:flex-row items-center justify-between gap-6 shadow-2xl shadow-indigo-500/20 relative overflow-hidden group">
              <div className="absolute top-0 right-0 -mt-12 -mr-12 w-64 h-64 bg-white/10 rounded-full blur-3xl group-hover:bg-white/20 transition-all duration-700"></div>
              <div className="relative z-0">
                <h2 className="text-2xl font-bold text-white mb-1">启动全新批量注册</h2>
                <p className="text-indigo-100 text-sm">系统将全自动完成邮箱生成、账户注册、OAuth 授权及 Token 分发</p>
              </div>
              <div className="flex items-center gap-3 relative z-0">
                <div className="flex items-center bg-white/10 rounded-xl border border-white/20 p-1">
                  <button 
                    onClick={() => setRegisterCount(Math.max(1, registerCount - 1))}
                    className="p-2 text-white hover:bg-white/10 rounded-lg transition-colors"
                  >
                    <MinusIcon className="w-4 h-4" />
                  </button>
                  <input 
                    type="number"
                    value={registerCount}
                    onChange={(e) => setRegisterCount(parseInt(e.target.value) || 1)}
                    className="w-16 bg-transparent text-center text-white font-bold text-lg outline-none"
                  />
                  <button 
                    onClick={() => setRegisterCount(registerCount + 1)}
                    className="p-2 text-white hover:bg-white/10 rounded-lg transition-colors"
                  >
                    <PlusIcon className="w-4 h-4" />
                  </button>
                </div>
                <button 
                  onClick={handleStartBatch}
                  disabled={loading}
                  className="bg-white text-indigo-600 px-8 py-3 rounded-xl font-bold shadow-lg hover:shadow-xl transition-all active:scale-95 disabled:opacity-50 flex items-center gap-2"
                >
                  {loading ? <ArrowPathIcon className="w-5 h-5 animate-spin" /> : <PlayIcon className="w-5 h-5 fill-current" />}
                  立即启动
                </button>
              </div>
            </div>

            {/* Jobs List */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden shadow-xl">
              <div className="px-6 py-4 border-b border-gray-800 flex justify-between items-center">
                <h3 className="font-semibold">运行状态</h3>
              </div>
              <div className="divide-y divide-gray-800">
                {jobs.length === 0 ? (
                  <div className="p-12 text-center text-gray-500">
                    暂无任务记录
                  </div>
                ) : (
                  jobs.map(job => (
                    <div key={job.id} className="p-1">
                      <div 
                        className="flex items-center justify-between p-5 hover:bg-gray-800/50 cursor-pointer rounded-xl transition-colors"
                        onClick={() => setExpandedJob(expandedJob === job.id ? null : job.id)}
                      >
                        <div className="flex items-center gap-4">
                          <div className={`p-2 rounded-lg ${
                            job.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' :
                            job.status === 'running' ? 'bg-indigo-500/10 text-indigo-400' :
                            job.status === 'failed' ? 'bg-rose-500/10 text-rose-400' : 'bg-gray-700/10 text-gray-400'
                          }`}>
                            {job.status === 'completed' ? <CheckCircleIcon className="w-6 h-6" /> : <ArrowPathIcon className={`w-6 h-6 ${job.status === 'running' ? 'animate-spin' : ''}`} />}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold uppercase tracking-wider text-sm">任务 #{job.id}</span>
                              <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                                job.status === 'completed' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' :
                                job.status === 'running' ? 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20' :
                                job.status === 'failed' && (job.logs || '').includes('停止') ? 'bg-amber-500/10 text-amber-500 border-amber-500/20' :
                                'bg-gray-800 text-gray-400 border-gray-700'
                              }`}>
                                {job.status === 'completed' ? '已完成' : 
                                 job.status === 'running' ? '运行中' : 
                                 ((job.logs || '').includes('停止') ? '已停止' : '失败')}
                              </span>
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                              创建时间: {new Date(job.created_at).toLocaleString()}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-8">
                          <div className="text-right">
                            <div className="text-sm font-medium">进度: {job.success_count}/{job.total_count}</div>
                            <div className="w-32 h-1.5 bg-gray-800 rounded-full mt-1.5 overflow-hidden">
                              <div 
                                className="h-full bg-indigo-500 transition-all duration-1000"
                                style={{ width: `${(job.success_count / job.total_count) * 100}%` }}
                              ></div>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                            {job.status === 'running' && (
                              <button 
                                onClick={() => handleStopJob(job.id)}
                                className="p-2 text-gray-500 hover:text-amber-500 hover:bg-gray-700 rounded-lg transition-all"
                                title="停止任务"
                              >
                                <XCircleIcon className="w-5 h-5" />
                              </button>
                            )}
                            <button 
                              onClick={() => handleDeleteJob(job.id)}
                              className="p-2 text-gray-500 hover:text-rose-500 hover:bg-gray-700 rounded-lg transition-all"
                              title="删除记录"
                            >
                              <TrashIcon className="w-5 h-5" />
                            </button>
                            <div className="w-px h-4 bg-gray-800 mx-1"></div>
                            <button 
                              onClick={() => setExpandedJob(expandedJob === job.id ? null : job.id)}
                              className="p-2 text-gray-500 hover:text-white hover:bg-gray-700 rounded-lg transition-all"
                            >
                              <Cog6ToothIcon className={`w-5 h-5 transition-transform ${expandedJob === job.id ? 'rotate-180' : ''}`} />
                            </button>
                          </div>
                        </div>
                      </div>

                      {expandedJob === job.id && (
                        <div className="px-6 pb-6 pt-2 animate-in slide-in-from-top-2 duration-300">
                          <div className="bg-gray-950 rounded-xl p-4 font-mono text-xs text-gray-400 h-64 overflow-y-auto border border-gray-800 space-y-1.5 custom-scrollbar">
                            {(() => {
                              try {
                                const logs = JSON.parse(job.logs || '[]');
                                if (!Array.isArray(logs)) return <div className="text-gray-500 italic">日志格式非数组</div>;
                                if (logs.length === 0) return <div className="text-gray-500 italic">暂无运行日志</div>;
                                
                                return logs.map((log: string, idx: number) => {
                                  const isSuccess = log.includes('成功') || log.includes('✓');
                                  const isError = log.includes('失败') || log.includes('✗') || log.includes('❌') || log.includes('错误');
                                  const isWarning = log.includes('⚠️') || log.includes('🛑') || log.includes('停止');
                                  
                                  return (
                                    <div key={idx} className={`${
                                      isSuccess ? 'text-emerald-400' : 
                                      isError ? 'text-rose-400 font-medium' : 
                                      isWarning ? 'text-amber-400' : ''
                                    }`}>
                                      {log}
                                    </div>
                                  );
                                });
                              } catch (e) {
                                return <div className="text-rose-400 font-bold italic">{'>> [错误]'} 日志解析失败: 数据可能已损坏。</div>;
                              }
                            })()}
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'accounts' && (
          <div className="max-w-6xl mx-auto animate-in fade-in duration-500">
            <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden shadow-xl">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-800/50">
                    <th className="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Email / Password</th>
                    <th className="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Account ID</th>
                    <th className="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {accounts.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-12 text-center text-gray-500 italic">
                        暂无已注册账号
                      </td>
                    </tr>
                  ) : (
                    accounts.map(acc => (
                      <tr key={acc.id} className="hover:bg-gray-800/30 transition-colors group">
                        <td className="px-6 py-4">
                          <div className="font-medium text-white">{acc.email}</div>
                          <div className="text-xs text-gray-500 font-mono mt-0.5">{acc.password}</div>
                        </td>
                        <td className="px-6 py-4 text-sm font-mono text-gray-400 truncate max-w-[120px]">
                          {acc.account_id || 'N/A'}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                            acc.status === 'active' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-gray-800 text-gray-500 border-gray-700'
                          }`}>
                            {acc.status.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button 
                            onClick={() => copyToClipboard(JSON.stringify(acc))}
                            className="p-2 text-gray-500 hover:text-white hover:bg-gray-700 rounded-lg transition-all"
                            title="复制 Token JSON"
                          >
                            <DocumentDuplicateIcon className="w-5 h-5" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default GPTRegistrarPage;
