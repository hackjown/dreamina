import axios from 'axios';
import WebSocket from 'ws';

export class BrowserbaseService {
    constructor(apiKey = null, projectId = null) {
        this.apiKey = apiKey;
        this.projectId = projectId;
        this.sessionId = null;
        this.sessionUrl = null;
        this.agentStream = null;
        this.wsConnection = null;
        this.messageId = 1;
        this.pendingCommands = new Map();
        
        // 允许通过设置覆盖 Base URL，默认为官方 API
        this.baseUrl = 'https://api.browserbase.com/v1';
    }

    /**
     * 创建新的 Browserbase 会话
     * @returns {Promise<{sessionId: string, sessionUrl: string, wsUrl: string}>}
     */
    async createSession() {
        try {
            console.log(`[Browserbase] 正在通过官方接口创建会话...`);
            const headers = { 
                'Content-Type': 'application/json',
                'x-bb-api-key': this.apiKey
            };

            const response = await axios.post(
                `${this.baseUrl}/sessions`,
                { 
                    projectId: this.projectId,
                    timeout: 600, // 增加超时到 10 分钟 (600s)
                    browserSettings: {
                        recordSession: true
                    }
                },
                { headers }
            );

            const data = response.data;
            if (!data.id) {
                throw new Error('创建会话失败: 未返回 session id');
            }

            this.sessionId = data.id;
            // 官方 API 返回 connectUrl (WSS)
            const wsUrl = data.connectUrl;
            this.sessionUrl = `https://www.browserbase.com/sessions/${this.sessionId}`;

            console.log(`[Browserbase] 会话已创建: ${this.sessionId}`);
            console.log(`[Browserbase] CDP URL: ${wsUrl ? '已获取' : '未获取'}`);

            return {
                sessionId: this.sessionId,
                sessionUrl: this.sessionUrl,
                wsUrl
            };
        } catch (error) {
            console.error('[Browserbase] 创建会话失败:', error.message);
            if (error.response) {
                console.error('[Browserbase] 响应状态:', error.response.status);
                console.error('[Browserbase] 响应数据:', JSON.stringify(error.response.data));
                
                if (error.response.status === 403) {
                    throw new Error('Browserbase 认证失败 (403): 请检查 API Key 和 Project ID 是否正确，或账户是否有权访问。');
                }
            }
            throw error;
        }
    }

    /**
     * 执行并等待 Agent 任务完成
     * @param {string} goal - 任务目标
     * @param {number} timeout - 超时 (ms)
     * @returns {Promise<string>} - 任务执行完毕后的完整文本反馈
     */
    async executeAgentTask(goal, timeout = 120000) {
        if (!this.sessionId) {
            throw new Error('会话未创建');
        }

        return new Promise(async (resolve, reject) => {
            try {
                const url = `${this.baseUrl}/sessions/${this.sessionId}/agent`;
                const headers = {
                    'x-bb-api-key': this.apiKey,
                    'Content-Type': 'application/json'
                };

                console.log(`[Browserbase] 启动分步任务: ${goal.substring(0, 50)}...`);
                const response = await axios.post(url, {
                    goal: goal,
                    model: 'google/gemini-3-flash-preview'
                }, {
                    responseType: 'stream',
                    headers,
                    timeout: timeout + 10000
                });

                const stream = response.data;
                let fullText = '';
                let timer = setTimeout(() => {
                    stream.destroy();
                    reject(new Error('Agent 任务执行超时'));
                }, timeout);

                stream.on('data', (chunk) => {
                    const lines = chunk.toString().split('\n').filter(l => l.trim());
                    for (const line of lines) {
                        try {
                            // 尝试解析 SSE 数据
                            const data = JSON.parse(line.replace(/^data:\s*/, ''));
                            if (data.type === 'agent:think' || data.type === 'text') {
                                fullText += (data.text || '');
                            }
                            if (data.type === 'agent:done') {
                                clearTimeout(timer);
                                stream.destroy();
                                resolve(fullText);
                                return;
                            }
                        } catch (e) {
                            // 非 JSON 数据，累加到 fullText
                            fullText += line;
                        }
                    }
                });

                stream.on('end', () => {
                    clearTimeout(timer);
                    resolve(fullText);
                });

                stream.on('error', (err) => {
                    clearTimeout(timer);
                    reject(err);
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * 规范化 Browserbase inspector 暴露的 WebSocket URL
     * @param {string} wsUrl
     * @returns {string}
     */
    normalizeWsUrl(wsUrl) {
        if (!wsUrl) {
            return '';
        }

        const decodedUrl = decodeURIComponent(wsUrl);
        if (decodedUrl.startsWith('wss://') || decodedUrl.startsWith('ws://')) {
            return decodedUrl;
        }

        return `wss://${decodedUrl}`;
    }

    /**
     * 发送 CDP 命令并等待响应
     * @param {string} method - CDP 方法名
     * @param {object} params - 参数
     * @param {string} sessionId - 可选的目标 Session ID (用于 CDP 扁平化)
     * @returns {Promise<object>} - 响应结果
     */
    sendCDPCommand(method, params = {}, sessionId = null) {
        return new Promise((resolve, reject) => {
            if (!this.wsConnection || this.wsConnection.readyState !== WebSocket.OPEN) {
                reject(new Error('WebSocket 未连接'));
                return;
            }

            const id = this.messageId++;
            const messageObj = { id, method, params };
            if (sessionId) {
                messageObj.sessionId = sessionId;
            }
            const message = JSON.stringify(messageObj);
            const timeoutId = setTimeout(() => {
                this.pendingCommands.delete(id);
                reject(new Error('CDP 命令超时'));
            }, 10000); // 增加超时到 10s

            this.pendingCommands.set(id, { resolve, reject, timeoutId });

            try {
                this.wsConnection.send(message);
            } catch (error) {
                clearTimeout(timeoutId);
                this.pendingCommands.delete(id);
                reject(error);
            }
        });
    }

    /**
     * 清理所有未完成的 CDP 命令
     * @param {string} reason
     */
    clearPendingCommands(reason = 'CDP 连接已关闭') {
        for (const [id, pending] of this.pendingCommands.entries()) {
            clearTimeout(pending.timeoutId);
            pending.reject(new Error(reason));
            this.pendingCommands.delete(id);
        }
    }

    /**
     * 获取当前浏览器上下文中的全部 targets
     * @returns {Promise<Array<object>>}
     */
    async getTargets() {
        const result = await this.sendCDPCommand('Target.getTargets');
        return Array.isArray(result?.targetInfos) ? result.targetInfos : [];
    }

    /**
     * 捕获指定目标的截图
     * @param {string} targetId
     * @returns {Promise<string>} Base64 编码的图片数据
     */
    async captureScreenshot(targetId) {
        if (!targetId) {
            // 如果未指定，尝试获取第一个 page 类型的 target
            const targets = await this.getTargets();
            const pageTarget = targets.find(t => t.type === 'page');
            if (!pageTarget) throw new Error('未找到可供截图的页面');
            targetId = pageTarget.targetId;
        }

        // 1. 附加到目标以获取 session
        const { sessionId } = await this.sendCDPCommand('Target.attachToTarget', {
            targetId,
            flatten: true
        });

        // 2. 在该 session 上执行截图
        const result = await this.sendCDPCommand('Page.captureScreenshot', {
            format: 'png',
            fromSurface: true
        }, sessionId); // 这里的 sendCDPCommand 需要增加 sessionId 参数支持

        return result.data; // Base64
    }

    /**
     * 连接到 CDP WebSocket 并监控 URL 变化（主动轮询）
     * @param {string} wsUrl - WebSocket URL
     * @param {object} options - 监控选项
     */
    connectToCDP(wsUrl, options = {}) {
        return new Promise((resolve, reject) => {
            const { 
                targetKeyword, 
                targetMatcher,
                targetLabel,
                onUrlChange, 
                onTargetReached, 
                timeout = 1800000,
                pollInterval = 3000 
            } = options;
            const reconnectDelay = 500;
            const staleReconnectMs = 12000;
            const targetDescription = targetLabel || targetKeyword || '目标页面';
            const initialUrl = options.initialUrl;
            
            const fullWsUrl = this.normalizeWsUrl(wsUrl);
            
            console.log(`[Browserbase] 连接到 CDP: ${fullWsUrl.substring(0, 60)}...`);
            
            let settled = false;
            let pollTimer = null;
            let reconnectTimer = null;
            const targetUrls = new Map();
            let lastUrlChangeAt = Date.now();
            let lastReconnectAt = 0;
            let pollInFlight = false;
            let hasLoggedConnectionReady = false;
            let initialNavigationTriggered = false;
            
            const timeoutId = setTimeout(() => {
                cleanup();
                settleReject(new Error('CDP 连接超时'));
            }, timeout);

            const cleanup = () => {
                clearTimeout(timeoutId);
                if (pollTimer) {
                    clearInterval(pollTimer);
                    pollTimer = null;
                }
                if (reconnectTimer) {
                    clearTimeout(reconnectTimer);
                    reconnectTimer = null;
                }
                if (this.wsConnection) {
                    this.clearPendingCommands('CDP 连接已关闭');
                    this.wsConnection.close();
                    this.wsConnection = null;
                }
            };

            const settleResolve = (value) => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve(value);
            };

            const settleReject = (error) => {
                if (settled) return;
                settled = true;
                cleanup();
                reject(error);
            };

            const scheduleReconnect = (reason) => {
                if (settled || reconnectTimer) return;
                lastReconnectAt = Date.now();
                reconnectTimer = setTimeout(() => {
                    reconnectTimer = null;
                    connect();
                }, reconnectDelay);
            };

            const resolveWithUrl = (currentUrl) => {
                if (onTargetReached) {
                    const result = onTargetReached(currentUrl);
                    settleResolve(result || currentUrl);
                    return;
                }
                settleResolve(currentUrl);
            };

            const isTargetUrl = (currentUrl) => {
                if (!currentUrl) return false;
                if (typeof targetMatcher === 'function') return targetMatcher(currentUrl);
                if (targetKeyword) return currentUrl.includes(targetKeyword);
                return false;
            };

            const handleObservedUrl = (currentUrl) => {
                lastUrlChangeAt = Date.now();
                // 忽略首个 data: 样式的页面
                if (currentUrl.startsWith('data:')) {
                    return false;
                }
                console.log(`[Browserbase] URL 变化: ${currentUrl}`);

                if (onUrlChange) onUrlChange(currentUrl);

                if (isTargetUrl(currentUrl)) {
                    console.log(`[Browserbase] 检测到${targetDescription}`);
                    resolveWithUrl(currentUrl);
                    return true;
                }
                return false;
            };

            const observeTargetUrl = (targetKey, currentUrl) => {
                if (!currentUrl || currentUrl === 'about:blank') return false;
                if (targetUrls.get(targetKey) === currentUrl) return false;
                targetUrls.set(targetKey, currentUrl);
                return handleObservedUrl(currentUrl);
            };

            const pollTargets = async () => {
                if (pollInFlight || settled || !this.wsConnection || this.wsConnection.readyState !== WebSocket.OPEN) return;
                pollInFlight = true;
                try {
                    let sawNewUrl = false;
                    const targets = await this.getTargets();

                    // 官方接口模式下处理初次跳转
                    if (initialUrl && !initialNavigationTriggered) {
                        initialNavigationTriggered = true;
                        console.log(`[Browserbase] 触发初次跳转: ${initialUrl}`);
                        this.sendCDPCommand('Page.navigate', { url: initialUrl }).catch(e => {
                            console.error(`[Browserbase] 初次跳转失败: ${e.message}`);
                            // 失败则允许下次重试
                            initialNavigationTriggered = false;
                        });
                    }

                    for (const target of targets) {
                        if (target.type && target.type !== 'page') continue;
                        const currentUrl = target.url || '';
                        const targetKey = target.targetId || currentUrl;
                        if (observeTargetUrl(targetKey, currentUrl)) return;
                        if (currentUrl && currentUrl !== 'about:blank') sawNewUrl = true;
                    }
                    if (!sawNewUrl) {
                        const now = Date.now();
                        if (now - lastUrlChangeAt >= staleReconnectMs && now - lastReconnectAt >= staleReconnectMs) {
                            scheduleReconnect('长时间未观测到新 URL');
                        }
                    }
                } catch (error) {
                    const now = Date.now();
                    if (now - lastUrlChangeAt >= staleReconnectMs && now - lastReconnectAt >= staleReconnectMs) {
                        scheduleReconnect('CDP 轮询异常');
                    }
                } finally {
                    pollInFlight = false;
                }
            };

            const connect = () => {
                if (settled) return;
                this.wsConnection = new WebSocket(fullWsUrl);
                this.wsConnection.on('open', () => {
                    this.messageId = 1;
                    lastReconnectAt = Date.now();
                    this.wsConnection.send(JSON.stringify({ id: this.messageId++, method: 'Target.setDiscoverTargets', params: { discover: true } }));
                    if (!hasLoggedConnectionReady) {
                        console.log('[Browserbase] CDP WebSocket 已连接');
                        hasLoggedConnectionReady = true;
                    }
                    pollTimer = setInterval(pollTargets, pollInterval);
                    pollTargets();
                });

                this.wsConnection.on('message', (data) => {
                    try {
                        const message = JSON.parse(data.toString());
                        if (Object.prototype.hasOwnProperty.call(message, 'id') && this.pendingCommands.has(message.id)) {
                            const pending = this.pendingCommands.get(message.id);
                            clearTimeout(pending.timeoutId);
                            this.pendingCommands.delete(message.id);
                            if (message.error) {
                                pending.reject(new Error(message.error.message || 'CDP 命令失败'));
                            } else {
                                pending.resolve(message.result);
                            }
                            return;
                        }

                        if (message.method === 'Target.targetCreated' || message.method === 'Target.targetInfoChanged') {
                            const info = message.params?.targetInfo;
                            if (info?.type === 'page') {
                                if (observeTargetUrl(info.targetId || info.url || 'page', info.url || '')) return;
                                setTimeout(pollTargets, 150);
                            }
                        }
                    } catch (e) {}
                });

                this.wsConnection.on('error', (error) => {
                    console.error('[Browserbase] CDP WebSocket 错误:', error.message);
                    this.clearPendingCommands(`CDP 连接异常: ${error.message}`);
                    scheduleReconnect('CDP 连接异常');
                });

                this.wsConnection.on('unexpected-response', (_request, response) => {
                    const statusCode = response?.statusCode;
                    this.clearPendingCommands(`CDP 握手失败: HTTP ${statusCode}`);
                    if (statusCode === 410) {
                        settleReject(new Error('Browserbase 会话已结束'));
                        return;
                    }
                    scheduleReconnect(`CDP 握手失败: HTTP ${statusCode}`);
                });

                this.wsConnection.on('close', () => {
                    this.clearPendingCommands('CDP 连接已关闭');
                    scheduleReconnect('CDP 连接已关闭');
                });
            };

            connect();
        });
    }

    disconnect() {
        if (this.agentStream) {
            this.agentStream.destroy();
            this.agentStream = null;
        }
        if (this.wsConnection) {
            this.wsConnection.close();
            this.wsConnection = null;
        }
    }
}
