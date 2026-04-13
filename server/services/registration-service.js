import { chromium } from 'playwright-core';
import browserService from '../browser-service.js';
import { getDatabase } from '../database/index.js';
import crypto from 'crypto';
import * as settingsService from './settingsService.js';

const TEMPMAIL_API_BASE = 'https://api.tempmail.lol/v2';

/**
 * 自动注册服务
 */
class RegistrationService {
  constructor() {
    this.jobs = new Map();
  }

  async createDreaminaContext() {
    const browser = await browserService.ensureBrowser();
    const proxyUrl = process.env.PROXY_URL;
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
      proxy: proxyUrl ? { server: proxyUrl } : undefined
    });

    await browserService.applyStealth(context);
    return context;
  }

  async openDreaminaEmailAuth(page, jobId, mode = 'signin') {
    this.log(jobId, '正在打开 Dreamina...');
    await page.goto('https://dreamina.capcut.com/ai-tool/home', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(5000);

    this.log(jobId, '等待首页稳定 (10s)...');
    await page.waitForTimeout(10000);

    this.log(jobId, '正在寻找 "Sign in" 入口...');
    try {
      const clicked = await page.evaluate(() => {
        const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, null, false);
        let node;
        const candidates = [];
        while (node = walk.nextNode()) {
          const text = node.textContent?.trim();
          if (text === 'Sign in' || text === '登录') {
            const rect = node.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              candidates.push(node);
            }
          }
        }

        const best = candidates.find(el => el.tagName === 'BUTTON' || el.className.includes('login') || el.className.includes('sign')) || candidates[0];
        if (best) {
          best.click();
          return { tag: best.tagName, classes: best.className };
        }
        return null;
      });

      if (!clicked) {
        throw new Error('经全量扫描未发现 Sign in 文本元素');
      }

      this.log(jobId, `"Sign in" (${clicked.tag}) 点击成功，等待弹窗...`);
    } catch (error) {
      try { await page.screenshot({ path: `/tmp/failed_signin_${jobId || 'local'}.png` }); } catch {}
      throw new Error(`找不到登录入口: ${error.message}`);
    }

    await page.waitForTimeout(3000);

    this.log(jobId, '点击 "Continue with email"...');
    const continueEmailBtn = page.locator(':text-is("Continue with email")').first();
    await continueEmailBtn.click({ timeout: 10000 });
    await page.waitForTimeout(2000);

    if (mode === 'signup') {
      this.log(jobId, '切换到 "Sign up"...');
      const signUpTab = page.locator(':text("Sign up"), :text("注册")').first();
      if (await signUpTab.isVisible({ timeout: 5000 })) {
        await signUpTab.click();
      } else {
        await page.evaluate(() => {
          const links = Array.from(document.querySelectorAll('a, span, div, p'));
          const signup = links.find(el => el.textContent?.trim() === 'Sign up' || el.textContent?.trim() === '注册');
          if (signup) signup.click();
        });
      }
      await page.waitForTimeout(1500);
    } else {
      this.log(jobId, '确认处于邮箱登录页...');
      const signInTab = page.locator(':text("Sign in"), :text("登录")').first();
      if (await signInTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await signInTab.click().catch(() => {});
        await page.waitForTimeout(1000);
      }
    }
  }

  async waitForSessionCookie(context, page, jobId, timeout = 30000) {
    this.log(jobId, `等待登录 Cookie 写入 (${Math.round(timeout / 1000)}s)...`);
    const startPolling = Date.now();

    while (Date.now() - startPolling < timeout) {
      const cookies = await context.cookies();
      const sessionCookie = cookies.find((c) => c.name === 'sessionid_ss' || c.name === 'sessionid');
      const webIdCookie = cookies.find((c) => c.name === '_tea_web_id');
      const regionCookie = cookies.find((c) => c.name === 'store-country-code' || c.name === 'store-region');

      if (sessionCookie?.value) {
        return {
          sessionId: sessionCookie.value,
          webId: webIdCookie?.value || null,
          region: regionCookie?.value || 'us',
        };
      }

      const innerText = await page.evaluate(() => document.body.innerText).catch(() => '');
      if (
        innerText.includes('人机验证') || 
        innerText.includes('Security verification') ||
        innerText.includes('Please complete the verification')
      ) {
        await page.screenshot({ path: `/tmp/captcha_detected_${jobId || 'local'}.png` }).catch(()=>{});
        throw new Error('登录触发人机验证，当前自动刷新无法绕过');
      }

      if (
        innerText.includes('Confirm your email') ||
        innerText.includes('verification code') ||
        innerText.includes('验证码')
      ) {
         // 这里如果还是验证码页面，说明刚才填写的验证码可能由于某种原因没生效或被清空了
         // 但我们先不要在这里 throw，给轮询留一点缓冲时间
      }

      if (
        innerText.includes('Incorrect password') ||
        innerText.includes('wrong password') ||
        innerText.includes('密码错误')
      ) {
        throw new Error('账号密码错误，无法刷新 SessionID');
      }

      await page.waitForTimeout(1500);
    }

    try { await page.screenshot({ path: `/tmp/failed_refresh_cookie_${jobId || 'local'}.png` }); } catch {}
    throw new Error('登录后未获取到 sessionid_ss，可能被拦截或页面流程已变化');
  }

  async refreshExistingAccountSession({ email, password }, jobId = null) {
    if (!email) {
      throw new Error('缺少账号邮箱');
    }
    if (!password) {
      throw new Error('缺少账号密码');
    }

    this.log(jobId, `开始刷新账号 SessionID: ${email}`);
    const context = await this.createDreaminaContext();
    const page = await context.newPage();

    try {
      await this.openDreaminaEmailAuth(page, jobId, 'signin');

      this.log(jobId, `输入邮箱: ${email}`);
      const emailInput = page.locator('input[type="email"], input[placeholder*="email" i], input[name*="email" i]').first();
      await emailInput.waitFor({ timeout: 10000 });
      await emailInput.fill(email);

      this.log(jobId, '输入密码...');
      const passwordInput = page.locator('input[type="password"]').first();
      await passwordInput.waitFor({ timeout: 10000 });
      await passwordInput.fill(password);

      this.log(jobId, '提交登录...');
      const submitBtn = page.locator(
        'button:visible:has-text("Continue"), button:visible:has-text("Sign in"), button:visible[type="submit"]'
      ).first();

      if (await submitBtn.count().catch(() => 0)) {
        await submitBtn.click({ timeout: 10000 });
      } else {
        this.log(jobId, '未找到可见登录按钮，改用 Enter 提交...');
        await passwordInput.press('Enter');
      }

      const refreshed = await this.waitForSessionCookie(context, page, jobId, 30000);
      this.log(jobId, `成功刷新 SessionID: ${refreshed.sessionId.substring(0, 10)}...`);
      return refreshed;
    } catch (error) {
      this.log(jobId, `刷新 SessionID 失败: ${error.message}`);
      throw error;
    } finally {
      await context.close().catch(() => {});
    }
  }

  /**
   * 记录日志
   */
  log(jobId, message) {
    const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const logEntry = `[${timestamp}] ${message}`;
    console.log(`[register][job:${jobId?.substring(0, 8)}] ${message}`);
    
    if (jobId && this.jobs.has(jobId)) {
      const job = this.jobs.get(jobId);
      job.logs.push(logEntry);
      // 保持最近 200 条日志
      if (job.logs.length > 200) job.logs.shift();
    }
  }

  /**
   * 创建临时收件箱
   */
  async createInbox(jobId) {
    this.log(jobId, '正在通过 tempmail.lol 创建收件箱...');
    const resp = await fetch(`${TEMPMAIL_API_BASE}/inbox/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    
    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`创建收件箱失败 (${resp.status}): ${text}`);
    }
    
    const data = await resp.json();
    this.log(jobId, `收件箱创建成功: ${data.address}`);
    return {
      address: data.address,
      token: data.token
    };
  }

  /**
   * 轮询获取验证码
   */
  async pollVerifCode(jobId, token, timeout = 120000) {
    const start = Date.now();
    this.log(jobId, `正在轮询验证码 (Token: ${token.substring(0, 8)}...)...`);
    
    while (Date.now() - start < timeout) {
      const resp = await fetch(`${TEMPMAIL_API_BASE}/inbox?token=${token}`);
      if (!resp.ok) {
          this.log(jobId, `轮询接口返回错误 (${resp.status})，重试中...`);
          await new Promise(r => setTimeout(r, 5000));
          continue;
      }
      
      const emailData = await resp.json();
      const messages = emailData.emails || [];
      
      const dreaminaMsg = messages.find(m => {
        const subject = (m.subject || '').toLowerCase();
        const from = (m.from || '').toLowerCase();
        return subject.includes('dreamina') || subject.includes('capcut') || from.includes('capcut') || from.includes('dreamina');
      });

      if (dreaminaMsg) {
        this.log(jobId, `发现相关邮件: "${dreaminaMsg.subject}" (来自: ${dreaminaMsg.from})`);
        
        // 尝试从主题或正文中提取 6 位数字或大写字母组合
        const fullContent = `${dreaminaMsg.subject} ${dreaminaMsg.body || dreaminaMsg.html || ''}`;
        
        // 匹配 6 位大写字母或数字的组合 (CapCut 验证码通常是这种)
        // 避免匹配到 Dreamina 这种单词中的部分字符，使用 \b 边界
        // 或者专门寻找 "is XXXXXX" 这种模式
        const codes = fullContent.match(/\b([A-Z0-9]{6})\b/g) || [];
        
        // 过滤掉已知的非验证码字符串
        const forbidden = ['000000', 'CAPCUT'];
        const validCodes = codes.filter(c => !forbidden.includes(c.toUpperCase()) && !c.includes('Dream'));
        
        const code = validCodes[0] || null;
        
        if (code) {
          this.log(jobId, `成功提取验证码: ${code}`);
          return code;
        } else {
          this.log(jobId, '未在邮件中发现有效的 6 位验证码，继续等待...');
        }
      }
      
      await new Promise(r => setTimeout(r, 5000));
    }
    
    throw new Error('获取验证码超时');
  }

  async poll2925VerifCode(mailPage, initialCodes, jobId, timeout = 120000) {
    const start = Date.now();
    this.log(jobId, `开始在 2925 收件箱轮询新验证码...`);
    const forbidden = ['000000', 'CAPCUT', 'DREAMI', '2925CO', 'SELECT', 'DEVICE', 'GOPLAY', 'WINDOW', 'BUTTON'];
    
    while (Date.now() - start < timeout) {
       // 1. 尝试在当前所有 frame 中寻找验证码
       for (const frame of mailPage.frames()) {
           const bodyText = await frame.evaluate(() => document.body.innerText).catch(()=>'');
           const lines = bodyText.split('\n');
           for (const line of lines) {
              if (/(Dreamina|CapCut|Dream)/i.test(line)) {
                  const match = line.match(/(?:code is|is|code|验证码为|为)\s*:?\s*([A-Z0-9]{6})\b/i);
                  if (match) {
                     const c = match[1].toUpperCase();
                     if (!forbidden.some(f => c.includes(f)) && !initialCodes.has(c)) {
                        this.log(jobId, `成功提取到最新 2925 验证码: ${c}`);
                        return c;
                     }
                  }
              }
           }
       }

       // 2. 如果没找到，尝试点击“刷新”按钮。使用健壮的 Playwright 匹配
       try {
           const refreshBtn = mailPage.locator('button:has-text("刷新"), .refresh-btn, [title*="刷新"]').first();
           if (await refreshBtn.isVisible({ timeout: 1000 }).catch(()=>false)) {
               await refreshBtn.click({ force: true }).catch(()=>{});
           } else {
               // 兜底原生点击
               await mailPage.evaluate(() => {
                   document.querySelectorAll('button, a, span, div').forEach(el => {
                       if (el.innerText === '刷新' && el.offsetHeight > 0) {
                           el.click();
                       }
                   });
               }).catch(()=>{});
           }
       } catch (e) {}
       
       // 等待 5 秒进入下一个循环
       await mailPage.waitForTimeout(5000);
    }
    
    // 超时截取现场画面
    await mailPage.screenshot({ path: '/tmp/2925_poll_timeout.png', fullPage: true }).catch(()=>{});
    throw new Error('获取 2925 验证码超时 (120s 内没有出现新验证码，截图见 /tmp/2925_poll_timeout.png)');
  }

  /**
   * 执行自动注册流程
   * 
   * Dreamina 当前注册 UI 流程 (已于 2026-03 验证):
   *   1. 访问 https://dreamina.capcut.com/ai-tool/home
   *   2. 点击侧边栏 "Sign in" 按钮 → 弹出登录/注册 modal
   *   3. 点击 "Sign up" 链接 (Don't have an account? Sign up)
   *   4. 在 "Create an account" 表单中填写邮箱和密码
   *   5. 点击 "Continue" 提交
   *   6. 可能出现邮箱验证码步骤 → 用 tempmail.lol 轮询获取验证码
   *   7. 可能出现年龄验证 → 自动填写 2000-01-01
   *   8. 等待跳转到 ai-tool/** 并提取 sessionid cookie
   */
  async registerNewAccount(password = 'Seedance123456!', jobId = null, provider = 'tempmail.lol') {
    let email = '';
    let token = null;
    let masterEmail = null;
    let pass = null;
    let inboxUrl = null;
    let initialCodes = new Set();
    
    try {
      if (provider === '2925') {
        const { G2925EmailProvider } = await import('./gpt/g2925Provider.js');
        masterEmail = settingsService.getSetting('gpt_2925_master_email');
        pass = settingsService.getSetting('gpt_2925_password');
        inboxUrl = 'https://2925.com/#/mailList';
        
        if (!masterEmail || !pass) {
          throw new Error('未配置 2925 邮箱主账号或密码，前往设置中配置');
        }
        
        const emailProvider = new G2925EmailProvider(masterEmail);
        await emailProvider.generateAlias();
        email = emailProvider.getEmail();
        this.log(jobId, `生成 2925 邮箱: ${email}`);
      } else {
        const inbox = await this.createInbox(jobId);
        email = inbox.address;
        token = inbox.token;
      }

      this.log(jobId, `开始在浏览器中执行注册流程: ${email}`);

      const context = await this.createDreaminaContext();
      
      let mailPage = null;
      if (provider === '2925') {
        mailPage = await context.newPage();
        this.log(jobId, `在后台开启新标签页预登录 2925 邮箱...`);
        await mailPage.goto(inboxUrl, { waitUntil: 'domcontentloaded' });
        
        try {
          // 强行等待页面加载完成
          await mailPage.waitForTimeout(3000);
          
          // 查找输入框。密码框一般就是 password，用户名框一般是 text
          let passInput = mailPage.locator('input[type="password"]').first();
          let emailInput = mailPage.locator('input[type="text"]').first();
          
          // 最多等待 15 秒出现密码框
          await passInput.waitFor({ state: 'visible', timeout: 15000 });
          this.log(jobId, '已找到 2925 登录框，正在输入账号及密码...');
          
          // 按照用户指示，只需要输入邮箱的前半部分
          const userOnly = masterEmail.split('@')[0];
          await emailInput.fill(userOnly);
          await passInput.fill(pass);
          
          // 强制勾选“我已阅读并同意”以及其他可能存在的复选框
          await mailPage.evaluate(() => {
             document.querySelectorAll('input[type="checkbox"]').forEach(c => c.click());
          }).catch(()=>{});
          await mailPage.getByText('我已阅读并同意').click({ force: true }).catch(()=>{});
          await mailPage.waitForTimeout(1000); // 稍微等待 Vue 状态更新
          
          // 点击“登录”按钮。修正 locator 语法错误，增加空格容错
          const loginBtn = mailPage.getByText('登录').locator('visible=true').first(); 
          // (之前使用了无效的 visible=true 导致定位器崩溃并被 catch 吞噬。正确用法为 :visible)
          await mailPage.locator('text=登录 >> visible=true').first().click({ force: true }).catch(()=>{});
          
          await passInput.press('Enter').catch(()=>{});
          
          // 强力兜底方案：通过浏览器原生 JS 查找并点击，过滤掉中间所有的空格
          await mailPage.evaluate(() => {
             Array.from(document.querySelectorAll('button, div, span, a')).forEach(el => {
                 const text = (el.innerText || '').replace(/\s+/g, '');
                 if (text === '登录' && el.offsetHeight > 0) {
                     el.click();
                 }
             });
          }).catch(()=>{});
          
          this.log(jobId, '已提交 2925 登录请求...');
          await mailPage.waitForTimeout(5000); // 留出时间给页面跳转和动画
          
        } catch (e) {
          this.log(jobId, `注意: 在登录 2925 时发生异常或超时 (${e.message})`);
        }
        
        // 验证是否登录成功 (寻找收件箱最明显的标识："写信" 按钮，杜绝误判)
        try {
          await Promise.race([
            mailPage.waitForSelector('text=写信', { timeout: 15000 }),
            mailPage.waitForSelector('text=收信', { timeout: 15000 }),
            mailPage.waitForSelector('text=收件箱', { timeout: 15000 })
          ]);
          this.log(jobId, '2925 邮箱登录确认成功！');
          
          // 致命环节：登录后默认是 Dashboard！必须手动点击左侧的“收件箱”才能看到邮件列表
          this.log(jobId, '正在导航到收件箱列表...');
          const inboxLink = mailPage.locator('text=收件箱').first();
          await inboxLink.click({ force: true }).catch(()=>{});
          await mailPage.waitForTimeout(3000); // 等待收件箱列表加载
          
        } catch (e) {
          await mailPage.screenshot({ path: `/tmp/2925_login_failed.png`, fullPage: true }).catch(()=>{});
          throw new Error('未明确登录到 2925 邮箱，注册流程自动终止（截图见 /tmp/2925_login_failed.png）');
        }
        
        // 等待列表加载
        try {
          await mailPage.waitForSelector('.mail-list, #mailList, tr, li', { timeout: 10000 });
          await mailPage.waitForTimeout(2000); // 额外缓冲
        } catch (e) {
          this.log(jobId, `等待 2925 列表加载超时，尝试直接扫描...`);
        }

        // 登录后的历史验证码对照逻辑：扫描所有 frame
        for (const frame of mailPage.frames()) {
          const frameText = await frame.evaluate(() => document.body.innerText).catch(()=>'');
          // 模糊匹配所有 6 位混合串作为基准黑名单
          const possibleCodes = frameText.match(/\b([A-Z0-9]{6})\b/gi) || [];
          possibleCodes.forEach(c => initialCodes.add(c.toUpperCase()));
        }
        this.log(jobId, `当前收件箱历史快照建立完成: ${initialCodes.size} 个串。`);
      }

      const page = await context.newPage();

      try {
        await this.openDreaminaEmailAuth(page, jobId, 'signup');

        this.log(jobId, `输入邮箱: ${email}`);
        await page.fill('input[placeholder*="email" i]', email);
        
        // Check for "Send code" button (older flow sometimes appears depending on region)
        const sendCodeBtn = page.locator('text="Send code"').first();
        let expectsCode = false;
        if (await sendCodeBtn.isVisible({ timeout: 2000 })) {
           this.log(jobId, '检测到需要发送验证码...');
           await sendCodeBtn.click();
           expectsCode = true;
        }

        if (expectsCode) {
           const code = provider === '2925' 
               ? await this.poll2925VerifCode(mailPage, initialCodes, jobId) 
               : await this.pollVerifCode(jobId, token);
           this.log(jobId, `输入验证码: ${code}`);
           await page.fill('input[placeholder*="code" i]', code);
        }

        this.log(jobId, '设置密码...');
        await page.fill('input[type="password"]', password);

        this.log(jobId, '提交注册 (Continue)...');
        const submitBtn = page.locator(
          'button:visible:has-text("Continue"), button:visible[type="submit"]'
        ).first();
        if (await submitBtn.count().catch(() => 0)) {
          await submitBtn.click();
        } else {
          await page.locator('input[type="password"]').first().press('Enter');
        }
        
        // Handle "Confirm your email" / Verification Code
        try {
           this.log(jobId, '检查是否需要输入验证码 (15s)...');
           const verifyScreen = await Promise.race([
              page.waitForSelector(':text("Confirm your email")', { timeout: 15000 }).then(() => 'confirm'),
              page.waitForSelector('input[placeholder*="code" i]', { timeout: 15000 }).then(() => 'input'),
              page.waitForSelector('.captcha-modal', { timeout: 15000 }).then(() => 'captcha'),
           ]).catch(() => null);

           if (verifyScreen === 'confirm' || verifyScreen === 'input') {
              this.log(jobId, '检测到验证码界面，正在获取验证码...');
              const code = provider === '2925' 
                  ? await this.poll2925VerifCode(mailPage, initialCodes, jobId) 
                  : await this.pollVerifCode(jobId, token);
              this.log(jobId, `输入验证码: ${code}`);
              
              // 尝试聚焦并输入
              const codeInput = page.locator('input[placeholder*="code" i], input[maxlength="6"]').first();
              if (await codeInput.isVisible({ timeout: 2000 })) {
                 await codeInput.fill(code);
              } else {
                 // 如果找不到具体 input，尝试点击中间区域然后直接打字 (针对 6 个独立盒子的布局)
                 await page.mouse.click(720, 450); // 点击屏幕中心尝试聚焦
                 await page.keyboard.type(code, { delay: 100 });
              }
              await page.waitForTimeout(1000);
              await page.keyboard.press('Enter');
              
              // 提交后的额外等待
              await page.waitForTimeout(3000);
           } else if (verifyScreen === 'captcha') {
              throw new Error('检测到人机验证（Captcha），目前无法自动绕过。');
           }
        } catch (e) {
           this.log(jobId, `验证环节检查完成 / 跳过: ${e.message}`);
        }

        // Age Verification
        try {
          this.log(jobId, '检查年龄验证页面...');
          await page.waitForSelector('.gate_birthday-picker-input', { timeout: 8000 });
          
          this.log(jobId, '填写生日 (2000-01-01)...');
          await page.fill('.gate_birthday-picker-input', '2000');
          await page.waitForTimeout(500);

          const monthSelector = '.gate_birthday-picker-selector[role="combobox"]:nth-of-type(1)';
          await page.click(monthSelector);
          await page.waitForTimeout(500);
          await page.click('text="January"');

          const daySelector = '.gate_birthday-picker-selector[role="combobox"]:nth-of-type(2)';
          await page.click(daySelector);
          await page.waitForTimeout(500);
          await page.click('div[role="listbox"] >> text="1"');

          this.log(jobId, '点击 Next...');
          await page.click('button:has-text("Next")');
        } catch (e) {
          this.log(jobId, '未检测到年龄验证 (或已跳过)。');
        }
        
        this.log(jobId, '等待自动登录并提取 SessionID (轮询 30s)...');
        let sessionCookie = null;
        try {
          sessionCookie = await this.waitForSessionCookie(context, page, jobId, 30000);
        } catch (error) {
          // 注册流程下仍保留原来的昵称补齐逻辑，再尝试一次拿 cookie
          const startPolling = Date.now();
          while (Date.now() - startPolling < 30000 && !sessionCookie) {
            const cookies = await context.cookies();
            const existingSession = cookies.find(c => c.name === 'sessionid_ss' || c.name === 'sessionid');
            const webIdCookie = cookies.find(c => c.name === '_tea_web_id');
            if (existingSession) {
              sessionCookie = {
                sessionId: existingSession.value,
                webId: webIdCookie?.value || null,
                region: (cookies.find(c => c.name === 'store-country-code' || c.name === 'store-region')?.value) || 'us',
              };
              break;
            }

            // 可能需要设置昵称
            try {
              const nicknameInput = page.locator('input[placeholder*="Name" i], input[placeholder*="Nickname" i], [class*="nickname"]').first();
              if (await nicknameInput.isVisible({ timeout: 1000 })) {
                this.log(jobId, '检测到 "Set Nickname" 页面，正在自动填写...');
                const nick = email.split('@')[0].substring(0, 12);
                await nicknameInput.fill(nick);
                await page.waitForTimeout(500);
                await page.keyboard.press('Enter');
                const nextBtn = page.locator('button:has-text("Confirm"), button:has-text("Continue"), button:has-text("Next")').first();
                if (await nextBtn.isVisible()) await nextBtn.click();
              }
            } catch {
              // ignore
            }

            const pageContent = await page.content();
            if (pageContent.includes('already registered')) {
              throw new Error('该邮箱已注册过 Dreamina 账号');
            }
            if (pageContent.includes('Too many requests') || pageContent.includes('frequently')) {
              throw new Error('请求频繁，IP 可能受限');
            }

            await page.waitForTimeout(2000);
          }

          if (!sessionCookie) {
            throw error;
          }
        }
        
        if (!sessionCookie) {
          try { await page.screenshot({ path: `/tmp/failed_cookie_${jobId || 'local'}.png` }); } catch(err){}
          throw new Error('未在 Cookie 中找到 sessionid_ss，注册流程可能未完成或被拦截');
        }

        this.log(jobId, `成功获取 SessionID: ${sessionCookie.sessionId.substring(0, 10)}...`);

        const db = getDatabase();
        db.prepare(`
          INSERT INTO accounts (email, password, session_id, web_id, credits, status)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(email, password, sessionCookie.sessionId, sessionCookie.webId || null, 0, 'active');

        this.log(jobId, `账号已入库: ${email}（初始积分记为 0，待服务端同步）`);
        return { email, sessionId: sessionCookie.sessionId, webId: sessionCookie.webId || null, region: sessionCookie.region || 'us' };
      } finally {
        await context.close();
      }
    } catch (error) {
      this.log(jobId, `注册出错: ${error.message}`);
      throw error;
    }
  }

  /**
   * 启动批量注册任务
   */
  startBatchRegistration(count = 1, provider = 'tempmail.lol') {
    const jobId = crypto.randomUUID();
    const job = {
      id: jobId,
      count,
      provider,
      status: 'running',
      successCount: 0,
      failCount: 0,
      logs: [],
      startTime: new Date().toISOString()
    };
    
    this.jobs.set(jobId, job);
    
    // 异步执行
    (async () => {
      this.log(jobId, `开始批量注册任务: 数量=${count}, 邮箱服务=${provider}`);
      
      for (let i = 0; i < count; i++) {
        this.log(jobId, `--- 正在执行第 ${i + 1}/${count} 个账号的注册 ---`);
        try {
          await this.registerNewAccount('Seedance123456!', jobId, provider);
          job.successCount++;
        } catch (error) {
          this.log(jobId, `第 ${i + 1} 个账号注册失败: ${error.message}`);
          job.failCount++;
        }
        
        if (i < count - 1) {
          this.log(jobId, '等待 5 秒后继续下一个任务...');
          await new Promise(r => setTimeout(r, 5000));
        }
      }
      
      job.status = 'completed';
      job.endTime = new Date().toISOString();
      this.log(jobId, `批量注册任务已结束。成功: ${job.successCount}, 失败: ${job.failCount}`);
    })();
    
    return jobId;
  }

  getJobStatus(jobId) {
    return this.jobs.get(jobId) || null;
  }

  getAllJobs() {
    return Array.from(this.jobs.values());
  }
  
  clearJob(jobId) {
    return this.jobs.delete(jobId);
  }
}

const registrationService = new RegistrationService();
export default registrationService;
