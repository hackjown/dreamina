import { getDatabase } from '../database/index.js';
import { getSetting } from './settingsService.js';
import { BrowserbaseService } from './gpt/browserbaseService.js';
import { OAuthService } from './gpt/oauthService.js';
import { DDGEmailProvider } from './gpt/ddgProvider.js';
import { G2925EmailProvider } from './gpt/g2925Provider.js';
import { generateRandomName, generateRandomPassword } from './gpt/randomIdentity.js';
import axios from 'axios';

class GPTService {
  constructor() {
    this.activeJobs = new Map();
    this.stoppedJobs = new Set();
  }

  generateUserData() {
    const fullName = generateRandomName();
    const password = generateRandomPassword();
    const age = 25 + Math.floor(Math.random() * 16);
    const birthYear = new Date().getFullYear() - age;
    const birthMonth = 1 + Math.floor(Math.random() * 12);
    const birthDay = 1 + Math.floor(Math.random() * 28);
    const birthDate = `${birthYear}-${String(birthMonth).padStart(2, '0')}-${String(birthDay).padStart(2, '0')}`;
    return { fullName, password, age, birthDate, birthMonth, birthDay, birthYear };
  }

  getAccounts() {
    return getDatabase().prepare('SELECT * FROM gpt_accounts ORDER BY created_at DESC').all();
  }

  getJobs() {
    return getDatabase().prepare('SELECT * FROM gpt_jobs ORDER BY created_at DESC').all();
  }

  getJob(id) {
    return getDatabase().prepare('SELECT * FROM gpt_jobs WHERE id = ?').get(id);
  }

  async startBatch(count) {
    const db = getDatabase();
    const result = db.prepare('INSERT INTO gpt_jobs (total_count, status, logs) VALUES (?, ?, ?)').run(count, 'running', '[]');
    const jobId = result.lastInsertRowid;
    this.runJob(jobId, count).catch(err => console.error(`[GPTService] Job ${jobId} failed:`, err));
    return jobId;
  }

  async stopJob(id) {
    const db = getDatabase();
    const job = db.prepare('SELECT * FROM gpt_jobs WHERE id = ?').get(id);
    if (!job || job.status !== 'running') return;
    this.stoppedJobs.add(Number(id));
    db.prepare('UPDATE gpt_jobs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('failed', id);
    const currentLogs = JSON.parse(job.logs || '[]');
    currentLogs.push(`[${new Date().toLocaleTimeString()}] ⚠️ 任务已被用户手动停止`);
    this.updateJobLogs(id, currentLogs);
  }

  deleteJob(id) {
    getDatabase().prepare('DELETE FROM gpt_jobs WHERE id = ?').run(Number(id));
    this.stoppedJobs.delete(Number(id));
  }

  async runJob(jobId, count) {
    const logs = [];
    const addLog = (message) => {
      logs.push(`[${new Date().toLocaleTimeString()}] ${message}`);
      this.updateJobLogs(jobId, logs);
    };
    addLog(`全新注册流程开始，目标数量: ${count}`);
    let successCount = 0, failCount = 0;
    for (let i = 0; i < count; i++) {
      if (this.stoppedJobs.has(Number(jobId))) {
        addLog(`🛑 任务已停止，跳过后续步骤`);
        break;
      }
      addLog(`开始注册第 ${i + 1}/${count} 个账号...`);
      try {
        const account = await this.runSingleRegistration(addLog);
        successCount++;
        this.updateJobProgress(jobId, successCount, failCount);
        addLog(`✓ 注册成功: ${account.email}`);
        await this.handleCPAUpload(account, addLog);
      } catch (err) {
        failCount++;
        this.updateJobProgress(jobId, successCount, failCount);
        addLog(`✗ 注册失败: ${err.message}`);
        if (err.message.includes('未配置')) break;
      }
    }
    this.stoppedJobs.delete(Number(jobId));
    const db = getDatabase(), currentJob = db.prepare('SELECT status FROM gpt_jobs WHERE id = ?').get(jobId);
    if (currentJob?.status === 'running') {
      const finalStatus = successCount === count ? 'completed' : (successCount > 0 ? 'partially_completed' : 'failed');
      db.prepare('UPDATE gpt_jobs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(finalStatus, jobId);
      addLog(`任务完成！成功: ${successCount}, 失败: ${failCount}`);
    }
  }

  updateJobLogs(jobId, logs) {
    getDatabase().prepare('UPDATE gpt_jobs SET logs = ? WHERE id = ?').run(JSON.stringify(logs), jobId);
  }

  updateJobProgress(jobId, successCount, failCount) {
    getDatabase().prepare('UPDATE gpt_jobs SET success_count = ?, fail_count = ? WHERE id = ?').run(successCount, failCount, jobId);
  }

  async runSingleRegistration(addLog) {
    const providerValue = getSetting('gpt_email_provider') || 'ddg';
    const provider = String(providerValue).toLowerCase();
    const is2925 = provider.includes('2925');
    
    const ddgToken = getSetting('gpt_ddg_token');
    const g2925Master = getSetting('gpt_2925_master_email');
    const g2925Password = getSetting('gpt_2925_password');
    const proxyUrl = getSetting('gpt_cli_proxy_url');
    const proxyToken = getSetting('gpt_cli_proxy_token');
    
    let mailInboxUrl;
    if (provider === 'ddg') {
        mailInboxUrl = getSetting('gpt_ddg_inbox_url') || getSetting('gpt_mail_inbox_url') || '';
    } else {
        mailInboxUrl = getSetting('gpt_2925_inbox_url') || getSetting('gpt_mail_inbox_url') || 'https://2925.com/#/mailList';
    }

    if (!proxyUrl || !proxyToken) throw new Error('未配置 CLI Proxy URL 或 Token');
    if (provider === 'ddg' && !ddgToken) throw new Error('使用 DDG 模式但未配置 DDG Token');
    if (is2925 && (!g2925Master || !g2925Password)) throw new Error('使用 2925 模式但未配置主账号或密码');

    let emailProvider;
    if (provider === 'ddg') {
        emailProvider = new DDGEmailProvider(ddgToken);
        addLog(`[初始化] 邮箱模式: DuckDuckGo (别名方案)`);
    } else {
        emailProvider = new G2925EmailProvider(g2925Master);
        addLog(`[初始化] 邮箱模式: 2925.com (子账号方案) [当前值: ${providerValue}]`);
    }

    const oauth = new OAuthService();
    const browserService = (await import('../browser-service.js')).default;

    let browserContext = null;
    try {
      const userData = this.generateUserData();
      await emailProvider.generateAlias();
      const email = emailProvider.getEmail();
      addLog(`生成备用账号: ${email}`);

      addLog(`启动本地装甲浏览器实例...`);
      const browser = await browserService.ensureBrowser();
      browserContext = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 }
      });
      await browserService.applyStealth(browserContext);

      const page = await browserContext.newPage();
      
      // ===== 阶段 0: 前置挂载邮箱收发中心 =====
      addLog(`[阶段 0] 前置挂载邮箱收发中心: ${mailInboxUrl} ...`);
      const mailPage = await browserContext.newPage();
      await mailPage.goto(mailInboxUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(()=>{});
      await mailPage.waitForTimeout(3000);
      
      try {
          if (is2925) {
              const passInput = mailPage.locator('input[type="password"]').first();
              const emailInput = mailPage.locator('input[type="text"]').first();
              
              const isLoginPage = await passInput.isVisible({ timeout: 15000 }).catch(()=>false);
              
              if (isLoginPage) {
                  addLog(`[阶段 0] 执行 2925 主账号自动登录...`);
                  await emailInput.fill(g2925Master.split('@')[0]);
                  await passInput.fill(g2925Password);
                  
                  // 强制勾选协议
                  await mailPage.evaluate(() => {
                     document.querySelectorAll('input[type="checkbox"]').forEach(c => { if (!c.checked) c.click(); });
                  }).catch(()=>{});
                  
                  await mailPage.waitForTimeout(1000);
                  
                  // 多重登录触发
                  await passInput.press('Enter').catch(()=>{});
                  await mailPage.evaluate(() => {
                     Array.from(document.querySelectorAll('button, div, span, a')).forEach(el => {
                         const text = (el.innerText || '').replace(/\s+/g, '');
                         if (text === '登录' && el.offsetHeight > 0) el.click();
                     });
                  }).catch(()=>{});
                  
                  addLog(`[阶段 0] 已提交 2925 登录请求，等待跳转...`);
                  await mailPage.waitForTimeout(5000);
              } else {
                  addLog(`[阶段 0] 2925 登录框未出现，可能已处于登录状态或正在加载。`);
              }

              // 验证登录并进入收件箱
              await Promise.race([
                 mailPage.waitForSelector('text=写信', { timeout: 15000 }),
                 mailPage.waitForSelector('text=收信', { timeout: 15000 }),
                 mailPage.waitForSelector('text=收件箱', { timeout: 15000 })
              ]);
              addLog(`[阶段 0] 2925 邮箱登录确认成功！正在跳转收件箱...`);
              
              // 关键修复：显式点击收件箱，防止停留在 Dashboard
              await mailPage.locator('text=收件箱').first().click({ force: true }).catch(()=>{});
              await mailPage.waitForTimeout(3000);
          } else {
              addLog(`[阶段 0] 非 2925 系统的通用收信中心模式，正等待页面稳定...`);
              await mailPage.waitForTimeout(5000);
              addLog(`[阶段 0] 收信中心就绪`);
          }
      } catch (e) {
          addLog(`[阶段 0] 邮箱系统初始化异常: ${e.message}`);
          if (is2925) {
              await mailPage.screenshot({ path: '/tmp/2925_init_failed.png', fullPage: true }).catch(()=>{});
              throw new Error('2925 邮箱登录失败或无法进入收件箱，流程终止');
          }
      }
      
      try {
          await mailPage.waitForSelector('.mail-list, #mailList, tr, li', { timeout: 10000 });
          await mailPage.waitForTimeout(2000);
      } catch (e) {
          addLog(`[阶段 0] 等待 2925 列表加载超时，尝试直接扫描...`);
      }
      
      const initialCodes = new Set();
      try {
         for (const frame of mailPage.frames()) {
              const t = await frame.evaluate(() => document.body.innerText).catch(()=>'');
              const any6 = t.match(/\b\d{6}\b/g) || [];
              any6.forEach(c => initialCodes.add(c));
         }
         addLog(`[阶段 0] 🛡️ 预先隔离并挂起 ${initialCodes.size} 个历史遗留验证码。`);
      } catch(e) {}
      
      await page.bringToFront();

      // ===== 阶段 1: 登录代理中心 =====
      addLog(`[阶段 1] 首航：渗透代理后台 ${proxyUrl} ...`);
      await page.goto(proxyUrl, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(1000);
      
      const pwdInput = page.locator('input[type="password"]');
      if (await pwdInput.isVisible().catch(()=>false)) {
        await pwdInput.fill(proxyToken);
        await page.getByRole('button', { name: '登录' }).click();
        await page.waitForTimeout(2000);
      }

      // ===== 阶段 2: 点击 OAuth 登录 =====
      addLog(`[阶段 2] 锁定 Codex OAuth，准备发起授权重定向...`);
      await page.getByText('OAuth 登录').click().catch(()=>{});
      await page.waitForTimeout(1000);
      
      try {
          const codexCard = page.locator('div, tr, li, .card').filter({ hasText: 'Codex OAuth' }).filter({ has: page.locator('button:has-text("登录")') }).last();
          await codexCard.locator('button:has-text("登录")').first().click({ timeout: 5000 });
      } catch (err) {
          await page.getByRole('button', { name: '登录', exact: true }).first().click().catch(()=>{});
      }
      await page.waitForTimeout(1500);
      
      const [signupPage] = await Promise.all([
        browserContext.waitForEvent('page'),
        page.getByText('打开链接').first().click({ force: true })
      ]);
      
      // ===== 阶段 3: 注册 =====
      addLog(`[阶段 3] 进入战场！准备开始无痕注册流程...`);
      await signupPage.waitForSelector(':text("注册"), :text("Sign up")', { timeout: 30000 }).catch(()=>{});
      await signupPage.locator(':text("注册"), :text("Sign up")').first().click({ force: true }).catch(()=>{});
      await signupPage.waitForTimeout(2000);

      addLog(`[阶段 3] 注入随机账密...`);
      await signupPage.locator('input[type="email"]').fill(email);
      await signupPage.locator('input[type="email"]').press('Enter').catch(()=>{});
      await signupPage.locator('button[type="submit"], button:has-text("继续"), button:has-text("Continue")').first().click().catch(()=>{});
      await signupPage.waitForTimeout(2000);
      
      await signupPage.waitForSelector('input[type="password"]', { timeout: 15000 }).catch(()=>{});
      await signupPage.locator('input[type="password"]').fill(userData.password);
      await signupPage.locator('input[type="password"]').press('Enter').catch(()=>{});
      await signupPage.locator('button[type="submit"], button:has-text("继续"), button:has-text("Continue")').first().click().catch(()=>{});
      
      addLog(`[阶段 3] 等待 OpenAI 发送验证信并进入邮箱查收提示页...`);
      try {
          await signupPage.waitForSelector(':text("Verify your email"), :text("验证"), :text("code"), :text("puzzle")', { timeout: 20000 });
      } catch (e) {
          await signupPage.screenshot({ path: '/tmp/gpt_auth_fail.png' }).catch(()=>{});
          throw new Error('未能在提交密码后跳转到邮箱验证页');
      }

      const code1 = await this.pollInboxForOpenAI(mailPage, initialCodes, addLog, '一维取码');
      initialCodes.add(code1);

      await signupPage.bringToFront();
      const inputs1 = await signupPage.$$('input[type="text"]');
      if (inputs1.length >= 6) {
         for (let i=0; i<6; i++) { await inputs1[i].fill(code1[i]); await signupPage.waitForTimeout(150); }
      } else {
         await signupPage.locator('input').first().fill(code1).catch(()=>{});
      }
      // 提交验证码：按 Enter + 点击按钮
      await signupPage.locator('input').first().press('Enter').catch(()=>{});
      await signupPage.locator('button[type="submit"], button:has-text("继续"), button:has-text("Continue"), button:has-text("验证")').first().click().catch(()=>{});
      
      addLog(`[阶段 3] 验证码验证中，静待页面跳转加载...`);
      await signupPage.waitForLoadState('networkidle', { timeout: 15000 }).catch(()=>{});
      await signupPage.waitForTimeout(4000);
      
      // ===== handleAboutYou: 填写姓名和生日 =====
      const handleAboutYou = async (pageObj, phaseStr) => {
         try {
             // 先等待 URL 变成 about-you，最多等 20 秒
             let isAboutYou = false;
             for (let w = 0; w < 20; w++) {
                 if (pageObj.url().includes('about-you')) { isAboutYou = true; break; }
                 await pageObj.waitForTimeout(1000);
             }
             if (!isAboutYou) {
                 addLog(`[${phaseStr}] 当前页面不是 About You (URL: ${pageObj.url()})，跳过。`);
                 return;
             }
             
             await pageObj.locator('input').first().waitFor({ state: 'visible', timeout: 10000 });
             addLog(`[${phaseStr}] 🎯 探测到身份信息补全(About You)界面，开始盲注...`);
             
             // 调试探针
             const inputDebug = await pageObj.evaluate(() => {
                 return Array.from(document.querySelectorAll('input')).map((el, i) => ({
                     index: i, type: el.type, name: el.name,
                     placeholder: el.placeholder, visible: el.offsetHeight > 0
                 }));
             });
             addLog(`[${phaseStr}] 页面 input 探针: ${JSON.stringify(inputDebug)}`);
             
             // 1. 填写全名
             const nameInput = pageObj.locator('input[type="text"]').first();
             if (await nameInput.isVisible().catch(()=>false)) {
                 await nameInput.click();
                 await pageObj.keyboard.type(userData.fullName, { delay: 40 });
                 addLog(`[${phaseStr}] 全名已注入: ${userData.fullName}`);
             }
             await pageObj.waitForTimeout(500);
             
             // 2. 填写生日：生日框是 React 自定义组件(hidden input)，
             //    必须先让全名框失焦，然后用 Tab 跳到生日组件
             
             // 先点击页面空白处，让全名框失焦
             await pageObj.locator('body').click({ position: { x: 10, y: 10 } }).catch(()=>{});
             await pageObj.waitForTimeout(300);
             
             // 用 Tab 从全名框跳到生日组件
             await nameInput.click().catch(()=>{});
             await pageObj.waitForTimeout(200);
             await pageObj.keyboard.press('Tab');
             await pageObj.waitForTimeout(500);
             await pageObj.keyboard.type('19930809', { delay: 40 });
             addLog(`[${phaseStr}] 生日已通过 Tab 跳转注入: 19930809`);
             
             await pageObj.waitForTimeout(1500);
             await pageObj.screenshot({ path: '/tmp/gpt_aboutyou_filled.png' }).catch(()=>{});
             
             // 点击继续按钮
             const submitBtn = pageObj.locator('button[type="submit"], button:has-text("Agree"), button:has-text("同意"), button:has-text("继续"), button:has-text("Continue")');
             if (await submitBtn.first().isVisible({timeout: 1000}).catch(()=>false)) {
                 await submitBtn.first().click({ force: true }).catch(()=>{});
             } else {
                 await pageObj.evaluate(() => {
                     const btns = Array.from(document.querySelectorAll('button:not([disabled])'));
                     if (btns.length > 0) btns[btns.length - 1].click();
                 }).catch(()=>{});
             }
             
             // 强制验证是否通过了 About You
             for (let i = 0; i < 10; i++) {
                 await pageObj.waitForTimeout(1000);
                 if (!pageObj.url().includes('about-you')) break;
             }
             
             if (pageObj.url().includes('about-you')) {
                 await pageObj.screenshot({ path: '/tmp/gpt_auth_fail.png' }).catch(()=>{});
                 throw new Error('填写的姓名或生日被拒绝，无法跳出 About You 页面，请查看崩溃截图 /tmp/gpt_auth_fail.png');
             }
             
         } catch(err) {
             if (err.message.includes('被拒绝，无法跳出')) throw err;
         }
      };

      await handleAboutYou(signupPage, '阶段 3');

      // ===== 阶段 4: 关闭注册页，放弃手机绑定 =====
      addLog(`[阶段 4] 关闭注册窗口，跳过手机绑定...`);
      await signupPage.close().catch(()=>{});

      // ===== 设置回调 URL 拦截器 =====
      let callbackUrl = '';
      browserContext.on('request', (req) => {
          const url = req.url();
          if (url.includes('localhost:1455') && !callbackUrl) {
              callbackUrl = url;
          }
      });

      // ===== 执行登录流程（可重试最多 3 次） =====
      const doLogin = async (attempt) => {
          addLog(`[阶段 5] 第${attempt}次登录尝试：点击"打开链接"进入 OpenAI 登录页...`);
          await page.bringToFront();
          await page.waitForTimeout(1000);
          
          const [lp] = await Promise.all([
              browserContext.waitForEvent('page'),
              page.getByText('打开链接').first().click({ force: true })
          ]);
          
          // 输入邮箱
          await lp.waitForSelector('input[type="email"]', { timeout: 30000 }).catch(()=>{});
          await lp.locator('input[type="email"]').fill(email);
          await lp.locator('input[type="email"]').press('Enter').catch(()=>{});
          await lp.locator('button[type="submit"], button:has-text("继续"), button:has-text("Continue")').first().click().catch(()=>{});
          addLog(`[阶段 5] 已输入邮箱: ${email}`);
          
          // 输入密码
          await lp.waitForSelector('input[type="password"]', { state: 'visible', timeout: 30000 }).catch(()=>{});
          await lp.waitForTimeout(500);
          if (await lp.locator('input[type="password"]').isVisible().catch(()=>false)) {
              await lp.locator('input[type="password"]').fill(userData.password);
              await lp.locator('input[type="password"]').press('Enter').catch(()=>{});
              await lp.locator('button[type="submit"], button:has-text("继续"), button:has-text("Continue")').first().click().catch(()=>{});
              addLog(`[阶段 5] 已输入密码并提交`);
          }
          
          // 检测是否需要邮箱验证码
          await lp.waitForTimeout(3000);
          const needCode = await lp.locator('input[autocomplete="one-time-code"], input[name="code"]').first().isVisible({ timeout: 15000 }).catch(()=>false);
          if (needCode) {
              addLog(`[阶段 6] 需要登录验证码，折返邮箱查收...`);
              const code = await this.pollInboxForOpenAI(mailPage, initialCodes, addLog, `第${attempt}次取码`);
              initialCodes.add(code);
              await lp.bringToFront();
              const codeInputs = await lp.$$('input[type="text"], input[inputmode="numeric"]');
              if (codeInputs.length >= 6) {
                  for (let i=0; i<6; i++) { await codeInputs[i].fill(code[i]); await lp.waitForTimeout(100); }
              } else {
                  await lp.locator('input').first().fill(code).catch(()=>{});
              }
              await lp.locator('input').first().press('Enter').catch(()=>{});
              await lp.locator('button[type="submit"], button:has-text("继续"), button:has-text("Continue"), button:has-text("验证")').first().click().catch(()=>{});
              addLog(`[阶段 6] 验证码已提交，等待页面跳转...`);
              await lp.waitForTimeout(5000);
          }
          
          // 等待页面稳定，检查最终状态
          await lp.waitForTimeout(3000);
          return lp;
      };

      let activePage = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
          activePage = await doLogin(attempt);
          
          // 检查是否已经拦截到回调
          if (callbackUrl) {
              addLog(`[阶段 7] ✅ 已通过请求拦截器捕获回调 URL！`);
              break;
          }
          
          const currentUrl = activePage.url();
          
          // 如果到了 consent 页面，点击继续
          if (currentUrl.includes('consent')) {
              addLog(`[阶段 7] 到达授权同意页面，点击继续...`);
              const consentBtn = activePage.locator('button[type="submit"], button:has-text("Continue"), button:has-text("继续"), button:has-text("Accept"), button:has-text("同意")');
              await consentBtn.first().waitFor({ state: 'visible', timeout: 5000 }).catch(()=>{});
              await consentBtn.first().click().catch(()=>{});
              await activePage.waitForTimeout(5000);
              break;
          }
          
          // 如果遇到手机验证，关闭重试
          if (currentUrl.includes('add-phone') || currentUrl.includes('phone')) {
              addLog(`[阶段 7] 遇到手机绑定页面(第${attempt}次)，关闭重试...`);
              await activePage.close().catch(()=>{});
              continue;
          }
          
          // chrome-error 说明已经跳到 localhost:1455 了（回调已被拦截器捕获）
          if (currentUrl.includes('chrome-error') || callbackUrl) {
              break;
          }
          
          // 如果在 about-you 页面（理论上不该出现，但以防万一）
          if (currentUrl.includes('about-you')) {
              await handleAboutYou(activePage, `第${attempt}次`);
              await activePage.waitForTimeout(3000);
              const afterUrl = activePage.url();
              if (afterUrl.includes('consent') || afterUrl.includes('add-phone') || callbackUrl) {
                  continue;
              }
          }
          
          // 等一下看 consent 会不会出现
          try {
              await activePage.waitForURL(/consent|localhost:1455/, { timeout: 15000 });
              if (activePage.url().includes('consent')) {
                  addLog(`[阶段 7] 到达授权同意页面，点击继续...`);
                  const cb = activePage.locator('button[type="submit"], button:has-text("Continue"), button:has-text("继续")');
                  await cb.first().click().catch(()=>{});
                  await activePage.waitForTimeout(5000);
              }
              break;
          } catch (e) {
              if (callbackUrl) break;
              addLog(`[阶段 7] 第${attempt}次未到达授权页，当前: ${activePage.url()}`);
              await activePage.close().catch(()=>{});
          }
      }

      // 等待拦截器捕获回调
      if (!callbackUrl) {
          await (activePage || page).waitForTimeout(5000);
      }
      
      if (!callbackUrl) {
          await (activePage || page).screenshot({ path: '/tmp/gpt_auth_fail.png' }).catch(()=>{});
          throw new Error('未能拦截到回调 URL。最终页面: ' + (activePage?.url() || 'unknown'));
      }

      addLog(`[最终阶段] 拦截到高价值毁链回调 URL: ${callbackUrl.substring(0, 50)}...`);
      addLog(`[最终阶段] 反哺喂入代理后台...`);
      
      await page.bringToFront();
      await page.waitForTimeout(1000);
      
      // 确保进入 #/oauth 路由
      if (!page.url().includes('#/oauth')) {
          addLog(`[最终阶段] 正在跳转至 OAuth 配置页...`);
          await page.goto('http://192.168.50.188:8317/management.html#/oauth', { waitUntil: 'networkidle' }).catch(()=>{});
          await page.waitForTimeout(2000);
      }
      
      // --- 输入注入：核弹级方案 ---
      await page.evaluate((url) => {
          const findInput = () => {
              const inputs = Array.from(document.querySelectorAll('input'));
              return inputs.find(i => (i.placeholder && i.placeholder.includes('callback')) || i.className.includes('input'));
          };
          const target = findInput();
          if (target) {
              target.focus();
              const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
              nativeInputValueSetter.call(target, url);
              target.dispatchEvent(new Event('input', { bubbles: true }));
              target.dispatchEvent(new Event('change', { bubbles: true }));
              target.blur();
          }
      }, callbackUrl);
      
      // 兜底：Playwright 直接 fill
      try {
          const pInput = page.locator('input.input[placeholder*="callback"]').first();
          if (await pInput.isVisible({timeout:1000})) {
              await pInput.fill(callbackUrl);
          }
      } catch(e) {}
      
      addLog(`[最终阶段] 回调 URL 已注入`);
      await page.waitForTimeout(1000);
      
      // --- 点击触发：核弹级方案 ---
      let clicked = false;
      
      // 方式1: getByText + force click
      try {
          const btn = page.locator('button:has-text("提交回调")').first();
          if (await btn.isVisible({timeout:2000})) {
              await btn.click({ force: true, timeout: 5000 });
              clicked = true;
              addLog(`[最终阶段] 触发方式1 (getByText) 成功`);
          }
      } catch(e) {}
      
      // 方式2: JS Eval Click
      if (!clicked) {
          try {
              const res = await page.evaluate(() => {
                  const buttons = Array.from(document.querySelectorAll('button'));
                  const target = buttons.find(b => b.textContent.includes('提交回调'));
                  if (target) {
                      target.scrollIntoView();
                      target.click();
                      return true;
                  }
                  return false;
              });
              if (res) {
                  clicked = true;
                  addLog(`[最终阶段] 触发方式2 (JS Eval) 成功`);
              }
          } catch(e) {}
      }
      
      // 方式3: 回车键兜底
      if (!clicked) {
          try {
              await page.focus('input.input[placeholder*="callback"]');
              await page.keyboard.press('Enter');
              clicked = true;
              addLog(`[最终阶段] 触发方式3 (Keyboard Enter) 成功`);
          } catch(e) {}
      }
      
      addLog(`[最终阶段] 回调 URL 提交操作已分发`);
      await page.waitForTimeout(5000);
      
      // 回调 URL 已提交给代理后台，代理会自动处理 Token 交换
      // 本地只保存账号信息
      const accountData = { 
          email, 
          password: userData.password, 
          access_token: 'delegated_to_proxy', 
          refresh_token: '', 
          id_token: '', 
          account_id: callbackUrl 
      };
      this.saveAccount(accountData);
      addLog(`✅ 注册完成！回调 URL 已提交代理，账号已入库: ${email}`);
      return accountData;
      
    } catch (err) {
      if (browserContext && browserContext.pages) {
         try {
             const pages = browserContext.pages();
             if (pages.length > 0) {
                 await pages[pages.length - 1].screenshot({ path: '/tmp/gpt_auth_fail.png' }).catch(()=>{});
                 addLog(`[严重故障] 流程中崩，已留存案发截图至 /tmp/gpt_auth_fail.png`);
             }
         } catch (e) {}
      }
      throw err;
    } finally {
      if (browserContext) {
        await browserContext.close().catch(()=>{});
      }
    }
  }

  async pollInboxForOpenAI(mailPage, initialCodes, addLog, phaseName) {
      try {
         await mailPage.bringToFront();
         const start = Date.now();
         const forbiddenKeywords = ['DREAMI', 'CAPCUT', '2925CO', 'BYTEDANCE'];
         
         while (Date.now() - start < 120000) { 
             for (const frame of mailPage.frames()) {
                 const t = await frame.evaluate(() => document.body.innerText).catch(()=>'');
                 
                 // 检查关键词排除干扰
                 const hasForbidden = forbiddenKeywords.some(kw => t.toUpperCase().includes(kw));
                 if (hasForbidden) continue;

                 if (/OpenAI|ChatGPT/i.test(t)) {
                     const match = t.match(/(?:验证码|code|代码)[^\d]*(\d{6})/i);
                     if (match) {
                         const code = match[1];
                         if (code && !initialCodes.has(code)) {
                             addLog(`  -> [${phaseName}] 狙击成功！新码脱壳: ${code}`);
                             return code;
                         }
                     }
                     const any6 = t.match(/\b\d{6}\b/g);
                     if (any6) {
                        for(const c of any6) {
                           if(!initialCodes.has(c)) {
                               addLog(`  -> [${phaseName}] 宽松模式命中：${c}`);
                               return c;
                           }
                        }
                     }
                 }
             }

             const refreshBtn = mailPage.locator('button:has-text("刷新"), .refresh-btn, [title*="刷新"]').first();
             if (await refreshBtn.isVisible({ timeout: 1000 }).catch(()=>false)) {
                 await refreshBtn.click({ force: true }).catch(()=>{});
             } else {
                 await mailPage.evaluate(() => {
                     document.querySelectorAll('button, a, span, div').forEach(el => {
                         if ((el.innerText === '刷新' || el.innerText === '收信') && el.offsetHeight > 0) el.click();
                     });
                 }).catch(()=>{});
             }
             await mailPage.waitForTimeout(5000);
         }
         
         await mailPage.screenshot({ path: '/tmp/gpt_mail_timeout.png' }).catch(()=>{});
         throw new Error(`120秒轮询枯竭未见验证码，请检查主账号余额及网络 (截图:/tmp/gpt_mail_timeout.png)`);
      } catch (e) {
         throw e;
      }
  }

  saveAccount(data) {
    getDatabase().prepare(`
      INSERT INTO gpt_accounts (email, password, access_token, refresh_token, id_token, account_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET access_token = excluded.access_token, refresh_token = excluded.refresh_token, updated_at = CURRENT_TIMESTAMP
    `).run(data.email, data.password, data.access_token, data.refresh_token, data.id_token, data.account_id, 'active');
  }

  async handleCPAUpload(account, addLog) {
    const proxyUrl = getSetting('gpt_cli_proxy_url'), proxyToken = getSetting('gpt_cli_proxy_token');
    if (!proxyUrl || !proxyToken) return;
    try {
      addLog(`[CPA] 正在上传至 CLI Proxy...`);
      await axios.post(proxyUrl, {
        access_token: account.access_token, account_id: account.account_id,
        disabled: false, email: account.email, expired: account.expired,
        id_token: account.id_token, last_refresh: account.last_refresh,
        refresh_token: account.refresh_token, type: 'codex'
      }, { headers: { 'Authorization': `Bearer ${proxyToken}`, 'Content-Type': 'application/json' } });
      addLog(`  [CPA] ✓ 上传成功`);
    } catch (err) {
      addLog(`  [CPA] ✗ 上传失败: ${err.message}`);
    }
  }
}

export const gptService = new GPTService();
export default gptService;
