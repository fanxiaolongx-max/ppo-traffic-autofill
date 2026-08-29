import fs from 'node:fs';
import path from 'node:path';
import { parseOfficialSummary } from './result-parser.js';
import { classifyOfficialError } from './official-error.js';

const TARGET_URL = 'https://www.ppo.gov.eg/ppo/r/ppoportal/ppoportal/traffic';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let electronApi;

async function loadElectron() {
  electronApi ||= await import('electron');
  return electronApi;
}

function cleanPassport(value) {
  return String(value || '').replace(/^[A-Za-z]+/, '');
}

export function chromeCompatibleUserAgent(value) {
  return String(value || '')
    .replace(/\sElectron\/[\d.]+/gi, '')
    .replace(/\s(?:ppo-query-hub|埃及车辆违章查询)\/[\d.]+/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function fillOfficialForm(data) {
  const fire = element => ['input', 'change', 'blur'].forEach(type => element.dispatchEvent(new Event(type, { bubbles: true })));
  const setField = (id, value) => {
    const element = document.getElementById(id);
    if (!element) throw new Error(`FIELD_NOT_FOUND:${id}`);
    element.value = value;
    fire(element);
  };
  const setRadio = (name, value) => {
    const targetValue = String(value);
    const radios = [...document.querySelectorAll(`input[name="${name}"]`)];
    const target = radios.find(item => item.value === targetValue);
    if (!target) throw new Error(`RADIO_NOT_FOUND:${name}:${value}`);
    radios.forEach(radio => {
      if (radio === target) {
        radio.checked = true;
        try { radio.click(); } catch {}
        fire(radio);
        const label = document.querySelector(`label[for="${radio.id}"]`);
        try { label?.click(); } catch {}
      } else {
        radio.checked = false;
      }
    });

    const officialLabel = name === 'P14_ID_TYPE_NUMS_LETTERS'
      ? (targetValue === '1429' ? 'جواز سفر' : 'رقم قوم')
      : (name === 'P14_ISFOREIGN__NUMS_LETTERS' && targetValue === '1' ? 'أجنبي' : '');
    if (officialLabel) {
      [...document.querySelectorAll('label')]
        .filter(label => label.innerText?.trim().includes(officialLabel))
        .forEach(label => { try { label.click(); } catch {} });
    }
  };
  const setSelect = (id, value) => {
    const element = document.getElementById(id);
    if (!element) return false;
    element.value = value;
    fire(element);
    try { window.apex?.item?.(id)?.setValue(value); } catch {}
    return true;
  };
  const setDynamicField = (id, value) => {
    const element = document.getElementById(id);
    if (!element) return false;
    element.value = value;
    fire(element);
    return true;
  };
  setRadio('P14_CHOSE_OPTION', '1');
  setField('P14_LETER_1', data.letter1);
  setField('P14_LETER_2', data.letter2 || '');
  setField('P14_LETER_3', data.letter3 || '');
  setField('P14_NUMBER_WITH_LETTER', data.plateNumber);
  if (data.ownerType === 'national_id') {
    setRadio('P14_ID_TYPE_NUMS_LETTERS', '2153');
    setDynamicField('P14_NATIONAL_ID_NUMS_LETTERS', data.documentNumber);
    setTimeout(() => setDynamicField('P14_NATIONAL_ID_NUMS_LETTERS', data.documentNumber), 250);
  } else {
    setRadio('P14_ID_TYPE_NUMS_LETTERS', '1429');
    setRadio('P14_ISFOREIGN__NUMS_LETTERS', data.foreignType === 'citizen' ? '0' : '1');
    setSelect('P14_PASSPORT_ISSUE_PLACE_NUMS_LETTERS', data.country);
    setDynamicField('P14_PASSPORT_NUM_NUMS_LETTERS', data.effectiveDocument);
    setTimeout(() => {
      setDynamicField('P14_PASSPORT_NUM_NUMS_LETTERS', data.effectiveDocument);
      setSelect('P14_PASSPORT_ISSUE_PLACE_NUMS_LETTERS', data.country);
    }, 250);
  }

  return {
    letter1: document.getElementById('P14_LETER_1')?.value || '',
    letter2: document.getElementById('P14_LETER_2')?.value || '',
    letter3: document.getElementById('P14_LETER_3')?.value || '',
    plateNumber: document.getElementById('P14_NUMBER_WITH_LETTER')?.value || ''
  };
}

function inspectOfficialForm() {
  const isVisible = element => {
    if (!element || element.offsetParent === null) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const letter = document.getElementById('P14_LETER_1');
  const number = document.getElementById('P14_NUMBER_WITH_LETTER');
  const vehicleTab = [...document.querySelectorAll('a, button, li')]
    .find(element => element.innerText?.includes('مخالفات رخص المركبات'));
  return {
    ready: isVisible(letter) && isVisible(number),
    fieldsExist: Boolean(letter && number),
    letterVisible: isVisible(letter),
    numberVisible: isVisible(number),
    vehicleTabFound: Boolean(vehicleTab),
    vehicleTabVisible: isVisible(vehicleTab),
    url: location.href,
    title: document.title,
    readyState: document.readyState
  };
}

function activateVehicleQueryTab() {
  const isVisible = element => element && element.offsetParent !== null && element.getBoundingClientRect().width > 0;
  const vehicleTab = [...document.querySelectorAll('a, button, li')]
    .find(element => element.innerText?.includes('مخالفات رخص المركبات') && isVisible(element));
  if (!vehicleTab) return false;
  vehicleTab.click();
  return true;
}

function stabilizeOfficialForm(data) {
  const fire = element => ['input', 'change', 'blur'].forEach(type => element.dispatchEvent(new Event(type, { bubbles: true })));
  const setField = (id, value) => {
    const element = document.getElementById(id);
    if (!element) return false;
    element.value = value;
    fire(element);
    return true;
  };
  setField('P14_LETER_1', data.letter1);
  setField('P14_LETER_2', data.letter2 || '');
  setField('P14_LETER_3', data.letter3 || '');
  setField('P14_NUMBER_WITH_LETTER', data.plateNumber);
  if (data.ownerType === 'national_id') {
    setField('P14_NATIONAL_ID_NUMS_LETTERS', data.documentNumber);
  } else {
    setField('P14_PASSPORT_NUM_NUMS_LETTERS', data.effectiveDocument);
    const country = document.getElementById('P14_PASSPORT_ISSUE_PLACE_NUMS_LETTERS');
    if (country) {
      country.value = data.country;
      country.dispatchEvent(new Event('change', { bubbles: true }));
      try { window.apex?.item?.('P14_PASSPORT_ISSUE_PLACE_NUMS_LETTERS')?.setValue(data.country); } catch {}
    }
  }
}

function clearOfficialPageState() {
  try { sessionStorage.clear(); } catch {}
  try { localStorage.clear(); } catch {}
}

function inspectOfficialPage() {
  const body = document.body?.innerText || '';
  const dialogs = [...document.querySelectorAll('.ui-dialog, .t-Alert, .a-Alert, div[role="dialog"]')]
    .map(element => element.innerText || '')
    .filter(Boolean);
  const dialog = dialogs.find(text => /خطأ|غير صحيح|يرجى التحقق|اسم المستخدم|كلمة السر|انتهت جلستك|انتهت الجلسة|الخدمة غير متاحة|صيانة|غير متوفرة/.test(text));
  if (dialog) return { kind: 'error', text: dialog.slice(0, 1500), url: location.href, title: document.title };
  if (location.href.includes('traffic-fines-summary') || location.href.includes('traffic?clear=201')) {
    return { kind: 'result', body: body.slice(0, 30_000), url: location.href, title: document.title };
  }
  const pageError = body.match(/لا توجد? لهذه الرخصة بيانات مسجلة حديثة[^\n]*|التوجه (?:الى|إلى) نيابة المرور المختصة لتحديث البيانات[^\n]*|الرقم القومي أو رقم الرخصة غير صحيح[^\n]*|رقم الرخصة غير صحيح[^\n]*|يرجى التحقق[^\n]*|اسم المستخدم أو كلمة السر غير صحيحة[^\n]*|انتهت جلستك[^\n]*|انتهت الجلسة[^\n]*|حدث خطأ أثناء معالجة الطلب[^\n]*|حدث خطأ أثناء تنفيذ الخدمة[^\n]*|الخدمة غير متاحة[^\n]*|502\s+bad gateway[^\n]*|503\s+service[^\n]*|504\s+gateway[^\n]*|gateway timeout[^\n]*/i);
  if (pageError) return { kind: 'error', text: pageError[0].slice(0, 1500), url: location.href, title: document.title };
  return { kind: 'waiting', url: location.href, title: document.title, bodyLength: body.length, readyState: document.readyState };
}

function collectPageSnapshot() {
  const dialogs = [...document.querySelectorAll('.ui-dialog, .ui-dialog-content, .t-Alert, .a-Alert, div[role="dialog"]')]
    .map(element => (element.innerText || '').trim()).filter(Boolean);
  return {
    capturedAt: new Date().toISOString(),
    url: location.href,
    title: document.title,
    userAgent: navigator.userAgent,
    readyState: document.readyState,
    bodyText: (document.body?.innerText || '').slice(0, 50_000),
    dialogs,
    activeElement: document.activeElement?.id || document.activeElement?.tagName || '',
    visibleButtons: [...document.querySelectorAll('button, input[type="submit"], input[type="button"]')]
      .filter(element => element.offsetParent !== null)
      .map(element => ({ id: element.id || '', text: (element.innerText || element.value || '').trim().slice(0, 200), disabled: Boolean(element.disabled) }))
      .slice(0, 100)
  };
}

function prepareOfficialSubmit() {
  const candidates = [...document.querySelectorAll('[id*="GET_FIN"]')];
  const button = document.getElementById('GET_FIN_LETTER_NUMBERS_BTN')
    || candidates.find(element => element.offsetParent !== null);
  if (!button) return { found: false };
  button.scrollIntoView({ block: 'center', inline: 'center' });
  const rect = button.getBoundingClientRect();
  const passport = document.getElementById('P14_PASSPORT_NUM_NUMS_LETTERS')?.value || '';
  const nationalId = document.getElementById('P14_NATIONAL_ID_NUMS_LETTERS')?.value || '';
  return {
    found: true,
    disabled: Boolean(button.disabled),
    visible: rect.width > 0 && rect.height > 0,
    center: { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) },
    formState: {
      letter1: document.getElementById('P14_LETER_1')?.value || '',
      letter2: document.getElementById('P14_LETER_2')?.value || '',
      letter3: document.getElementById('P14_LETER_3')?.value || '',
      plateNumber: document.getElementById('P14_NUMBER_WITH_LETTER')?.value || '',
      idType: document.querySelector('input[name="P14_ID_TYPE_NUMS_LETTERS"]:checked')?.value || '',
      foreignType: document.querySelector('input[name="P14_ISFOREIGN__NUMS_LETTERS"]:checked')?.value || '',
      country: document.getElementById('P14_PASSPORT_ISSUE_PLACE_NUMS_LETTERS')?.value || '',
      documentLength: Math.max(passport.length, nationalId.length)
    }
  };
}

function clickOfficialSubmit() {
  const candidates = [...document.querySelectorAll('[id*="GET_FIN"]')];
  const button = document.getElementById('GET_FIN_LETTER_NUMBERS_BTN')
    || candidates.find(element => element.offsetParent !== null);
  if (!button) return false;
  button.click();
  return true;
}

export class PPOQueryDriver {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.window = null;
    this.browserSession = null;
    this.certificateHandlerInstalled = false;
  }

  async ensureBrowser() {
    if (this.window && !this.window.isDestroyed()) return;
    const { BrowserWindow, session } = await loadElectron();
    const partition = 'persist:ppo-query-engine';
    const browserSession = session.fromPartition(partition);
    this.browserSession = browserSession;
    const compatibleUserAgent = chromeCompatibleUserAgent(browserSession.getUserAgent());
    if (compatibleUserAgent) browserSession.setUserAgent(compatibleUserAgent);
    if (!this.certificateHandlerInstalled) {
      browserSession.setCertificateVerifyProc((request, callback) => {
        const hostname = String(request.hostname || '').toLowerCase();
        callback(hostname === 'ppo.gov.eg' || hostname.endsWith('.ppo.gov.eg') ? 0 : -3);
      });
      this.certificateHandlerInstalled = true;
    }
    this.window = new BrowserWindow({
      show: false,
      width: 1440,
      height: 960,
      title: 'PPO 查询执行器',
      webPreferences: {
        partition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false
      }
    });
    this.window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.window.on('closed', () => { this.window = null; });
  }

  async execute(input, report) {
    await this.ensureBrowser();
    const formats = this.passportAttempts(input).slice(0, this.config.maxRetries + 1);
    let formatIndex = 0;
    let attempt = 0;
    let sessionRecoveryUsed = false;
    const retryKinds = [];
    let lastError;
    while (formatIndex < formats.length) {
      attempt += 1;
      try {
        const result = await this.runAttempt({ ...input, ...formats[formatIndex] }, report, attempt);
        return { ...result, retryKinds };
      } catch (error) {
        error.attempt = attempt;
        lastError = error;
        const canRepairSession = ['OFFICIAL_AUTH_ERROR', 'SESSION_EXPIRED'].includes(error.code) && !sessionRecoveryUsed;
        if (canRepairSession) {
          sessionRecoveryUsed = true;
          retryKinds.push('official_session');
          report({
            step: 'retrying_official_session', progress: 10, attempt: attempt + 1,
            detail: '检测到 PPO 官网内部会话异常，正在重建独立官网会话后重试（最多一次）'
          });
          await this.resetOfficialSession();
          continue;
        }
        const canTryAlternate = error.code === 'IDENTITY_MISMATCH' && formatIndex + 1 < formats.length;
        if (!canTryAlternate) {
          if (!error.diagnostic) {
            error.diagnostic = await this.captureDiagnostics(String(error.code || 'query-failed').toLowerCase(), {
              attempt,
              submitState: error.submitState,
              preSubmitImage: error.preSubmitImage
            }).catch(() => null);
          }
          error.retryKinds = retryKinds;
          throw error;
        }
        formatIndex += 1;
        retryKinds.push('passport_format');
        report({
          step: 'retrying_passport_format', progress: 42, attempt: attempt + 1,
          retryFormat: 'without_prefix',
          detail: `已去除护照英文字母前缀，准备第 ${attempt + 1} 次查询（总尝试次数有严格上限）`
        });
      }
    }
    if (lastError) lastError.retryKinds = retryKinds;
    throw lastError;
  }

  async resetOfficialSession() {
    if (this.window && !this.window.isDestroyed()) {
      await this.window.loadURL('about:blank').catch(() => {});
      this.window.destroy();
      this.window = null;
    }
    if (this.browserSession) {
      await this.browserSession.clearStorageData({
        origin: 'https://www.ppo.gov.eg',
        storages: ['localstorage', 'indexdb', 'serviceworkers', 'cachestorage']
      }).catch(() => {});
      await this.browserSession.clearCache().catch(() => {});
    }
    await delay(250);
    await this.ensureBrowser();
  }

  passportAttempts(input) {
    if (input.ownerType !== 'passport') return [{}];
    const raw = String(input.documentNumber || '').trim();
    const cleaned = cleanPassport(raw);
    return raw !== cleaned ? [{ effectiveDocument: raw }, { effectiveDocument: cleaned }] : [{ effectiveDocument: raw }];
  }

  async executeJavaScript(fn, argument) {
    const source = argument === undefined ? `(${fn.toString()})()` : `(${fn.toString()})(${JSON.stringify(argument)})`;
    return this.window.webContents.executeJavaScript(source, true);
  }

  async waitForSelector(selector, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = await this.window.webContents.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(selector)}))`, true).catch(() => false);
      if (found) return;
      await delay(250);
    }
    throw Object.assign(new Error(`等待官网表单超时: ${selector}`), { code: 'FORM_CHANGED' });
  }

  async navigate(url, timeoutMs) {
    try {
      await Promise.race([
        this.window.loadURL(url),
        delay(timeoutMs).then(() => { throw Object.assign(new Error('打开 PPO 官网超时'), { code: 'OFFICIAL_UNAVAILABLE' }); })
      ]);
    } catch (error) {
      if (error.code === 'OFFICIAL_UNAVAILABLE') throw error;
      throw Object.assign(new Error('无法打开 PPO 官网，请检查网络或稍后再试'), {
        code: 'OFFICIAL_UNAVAILABLE', navigationError: error.message
      });
    }
  }

  async initializeOfficialForm(report, attempt) {
    report({ step: 'initializing_official_form', progress: 18, attempt, detail: '等待车辆查询表单完成初始化' });
    let clickedVehicleTab = false;
    let lastState = null;
    for (let retries = 0; retries < 15; retries += 1) {
      lastState = await this.executeJavaScript(inspectOfficialForm);
      if (lastState.ready) {
        report({
          step: 'initializing_official_form',
          progress: 22,
          attempt,
          detail: clickedVehicleTab ? '车辆查询页签已激活，表单初始化完成' : '车辆查询表单初始化完成',
          diagnostic: lastState
        });
        return;
      }
      if (!clickedVehicleTab && lastState.vehicleTabVisible) {
        clickedVehicleTab = await this.executeJavaScript(activateVehicleQueryTab);
        if (clickedVehicleTab) {
          report({ step: 'initializing_official_form', progress: 20, attempt, detail: '正在激活车辆牌照违章查询页签' });
        }
      }
      await delay(300);
    }
    const error = Object.assign(new Error('PPO 车辆查询表单未完成初始化'), {
      code: 'FORM_CHANGED',
      formState: lastState
    });
    throw error;
  }

  async runAttempt(input, report, attempt) {
    const currentUrl = this.window.webContents.getURL();
    if (currentUrl.includes('ppo.gov.eg')) {
      await this.executeJavaScript(clearOfficialPageState).catch(() => {});
    }
    report({ step: 'opening_official_site', progress: 12, attempt });
    await this.navigate(TARGET_URL, 25_000);
    await this.initializeOfficialForm(report, attempt);
    report({ step: 'filling_form', progress: 28, attempt });
    await this.executeJavaScript(fillOfficialForm, input);
    await delay(350);
    await this.executeJavaScript(stabilizeOfficialForm, input);
    await delay(350);
    report({ step: 'submitting_query', progress: 46, attempt });
    const submitState = await this.executeJavaScript(prepareOfficialSubmit);
    if (!submitState.found || !submitState.visible) throw Object.assign(new Error('未找到可用的官网查询按钮'), { code: 'FORM_CHANGED' });
    if (submitState.disabled) throw Object.assign(new Error('官网查询按钮处于禁用状态，请检查表单参数'), { code: 'FORM_NOT_READY' });
    report({ step: 'submitting_query', progress: 48, attempt, detail: '正在触发 PPO 官网查询按钮', diagnostic: submitState.formState });
    const preSubmitImage = await this.window.webContents.capturePage()
      .then(image => image.toPNG())
      .catch(() => null);
    const clicked = await this.executeJavaScript(clickOfficialSubmit);
    if (!clicked) {
      const error = Object.assign(new Error('PPO 官网查询按钮在提交前消失'), {
        code: 'FORM_CHANGED', submitState: submitState.formState
      });
      Object.defineProperty(error, 'preSubmitImage', { value: preSubmitImage, enumerable: false });
      throw error;
    }
    report({ step: 'waiting_official_result', progress: 60, attempt });

    const deadline = Date.now() + this.config.queryTimeoutMs;
    const waitStartedAt = Date.now();
    let lastProgressReport = 0;
    while (Date.now() < deadline) {
      const state = await this.executeJavaScript(inspectOfficialPage);
      if (state.kind === 'error') {
        const error = this.classifyError(state.text);
        error.submitState = submitState.formState;
        Object.defineProperty(error, 'preSubmitImage', { value: preSubmitImage, enumerable: false });
        throw error;
      }
      if (state.kind === 'result') {
        report({ step: 'parsing_result', progress: 88, attempt });
        const diagnostic = await this.captureDiagnostics('success', {
          attempt,
          submitState: submitState.formState,
          preSubmitImage
        }).catch(error => {
          this.logger?.warn?.('query_success_diagnostic_failed', {
            attempt,
            error: { message: error.message, code: error.code || null }
          });
          return null;
        });
        return { ...this.parseResult(state.body, state.url, attempt), diagnostic };
      }
      const waitedSeconds = Math.floor((Date.now() - waitStartedAt) / 1000);
      if (waitedSeconds >= lastProgressReport + 5) {
        lastProgressReport = waitedSeconds;
        report({
          step: 'waiting_official_result',
          progress: Math.min(85, 60 + Math.floor(waitedSeconds / 3)),
          attempt,
          detail: `已等待 ${waitedSeconds} 秒，页面状态 ${state.readyState || 'unknown'}`,
          diagnostic: { url: state.url, title: state.title, bodyLength: state.bodyLength }
        });
      }
      await delay(800);
    }
    const diagnostic = await this.captureDiagnostics('timeout', {
      attempt,
      submitState: submitState.formState,
      preSubmitImage
    });
    throw Object.assign(new Error(`官方查询超过 ${this.config.queryTimeoutMs / 1000} 秒未返回`), { code: 'QUERY_TIMEOUT', diagnostic });
  }

  async captureDiagnostics(reason, context = {}) {
    const diagnosticDir = path.join(this.config.dataDir, 'diagnostics');
    fs.mkdirSync(diagnosticDir, { recursive: true, mode: 0o700 });
    const safeReason = String(reason || 'query-failed').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 80);
    const stamp = `${new Date().toISOString().replace(/[:.]/g, '-')}-${safeReason}`;
    const snapshotPath = path.join(diagnosticDir, `${stamp}.json`);
    const screenshotPath = path.join(diagnosticDir, `${stamp}.png`);
    const preSubmitScreenshotPath = path.join(diagnosticDir, `${stamp}-before-submit.png`);
    const pageSnapshot = await this.executeJavaScript(collectPageSnapshot).catch(error => ({
      capturedAt: new Date().toISOString(),
      captureError: error.message,
      url: this.window?.webContents.getURL() || ''
    }));
    const snapshot = {
      ...pageSnapshot,
      queryContext: {
        attempt: context.attempt || null,
        submitState: context.submitState || null
      }
    };
    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), { encoding: 'utf8', mode: 0o600 });
    if (Buffer.isBuffer(context.preSubmitImage) && context.preSubmitImage.length) {
      fs.writeFileSync(preSubmitScreenshotPath, context.preSubmitImage, { mode: 0o600 });
    }
    try {
      await delay(150);
      const image = await this.window.webContents.capturePage();
      fs.writeFileSync(screenshotPath, image.toPNG(), { mode: 0o600 });
    } catch {}
    return {
      reason,
      url: snapshot.url || '',
      title: snapshot.title || '',
      userAgent: snapshot.userAgent || '',
      readyState: snapshot.readyState || '',
      bodyLength: snapshot.bodyText?.length || 0,
      dialogCount: snapshot.dialogs?.length || 0,
      submitState: context.submitState || null,
      snapshotPath,
      screenshotPath: fs.existsSync(screenshotPath) ? screenshotPath : null,
      preSubmitScreenshotPath: fs.existsSync(preSubmitScreenshotPath) ? preSubmitScreenshotPath : null
    };
  }

  classifyError(text) {
    return classifyOfficialError(text);
  }

  parseResult(text, url, attempt) {
    const summary = parseOfficialSummary(text);
    return {
      ...summary,
      resultUrl: url,
      attempt,
      capturedAt: new Date().toISOString(),
      rawText: text
    };
  }

  async close() {
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
    this.browserSession = null;
  }
}
