import { buildAccessInfo } from './access-info.js';
import { applyTranslations, getLanguage, initializePreferences, localizeError, localizeTimelineDetail, localizeTimelineStep, t } from './preferences.js';
import { isValidChinaPassport, normalizeChinaPassport } from './passport-format.js';

const $ = selector => document.querySelector(selector);
const HISTORY_PAGE_SIZE = 20;
const STATUS_PAGE_SIZE = 20;
const hashDesktopToken = new URLSearchParams(window.location.hash.slice(1)).get('desktopToken') || '';
if (hashDesktopToken) sessionStorage.setItem('ppo-desktop-token', hashDesktopToken);
const desktopToken = hashDesktopToken || sessionStorage.getItem('ppo-desktop-token') || '';
if (hashDesktopToken) history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
const state = { history: [], queue: null, status: null, historyCursor: '', historyHasMore: false, evidenceUrls: [] };
const plateLetters = ['أ', 'ب', 'ج', 'د', 'ر', 'س', 'ص', 'ط', 'ع', 'ف', 'ق', 'ل', 'م', 'ن', 'ه', 'و', 'ي'];
const normalizePlateLetter = value => String(value || '').replaceAll('\u0640', '').trim();
let activeLetterSlot = 'letter1';
const steps = {
  queued: '等待执行', starting_browser: '正在启动浏览器', opening_official_site: '正在打开 PPO 官网', initializing_official_form: '正在初始化官网表单',
  filling_form: '正在填写查询信息', submitting_query: '正在提交查询', waiting_official_result: '等待官方结果',
  retrying_passport_format: '正在切换护照格式重试', retrying_official_session: '正在重建 PPO 官网会话', parsing_result: '正在解析查询结果', completed: '查询完成',
  failed: '查询失败', queue_expired: '排队超时，任务已终止', cancelled: '已取消', process_restarted: '程序重启，任务中断'
};
const statusMeta = status => {
  if (status === 'success') return { css: 'success', icon: '✓', label: '成功' };
  if (status === 'queued' || status === 'running') return { css: 'pending', icon: '…', label: status === 'queued' ? '排队中' : '执行中' };
  if (status === 'failed') return { css: 'failed', icon: '!', label: '失败' };
  return { css: 'cancelled', icon: '×', label: '中断' };
};

function renderAccessMeta(health = null) {
  const info = buildAccessInfo(window.location, health?.port);
  $('#access-address').textContent = info.origin;
  $('#access-port').textContent = getLanguage() === 'en' ? `${({ '本机访问':'Local access','局域网访问':'LAN access','公网访问':'Public access' })[info.kind] || info.kind} · Port ${info.port || info.portText.replace(/\D/g,'')}` : `${info.kind} · ${info.portText}`;
  $('#access-meta').title = `${info.origin} · ${info.portText}`;
}

function deviceId() {
  let value = localStorage.getItem('ppo-device-id');
  if (!value) { value = crypto.randomUUID(); localStorage.setItem('ppo-device-id', value); }
  return value;
}

function requestSummary(query) {
  const req = query.request || {};
  return `${[req.letter1, req.letter2, req.letter3].filter(Boolean).join(' ')} ${req.plateNumber || ''}`.trim() || '查询任务';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function renderLetterSlots() {
  for (const name of ['letter1', 'letter2', 'letter3']) {
    const value = $(`#${name}`).value;
    const slot = document.querySelector(`[data-letter-slot="${name}"]`);
    const display = $(`#${name}-display`);
    slot.classList.toggle('active', name === activeLetterSlot);
    slot.classList.toggle('filled', Boolean(value));
    display.textContent = value || t(`字${name.slice(-1)}`);
  }
  document.querySelectorAll('.letter-key').forEach(key => {
    key.classList.toggle('selected', ['letter1', 'letter2', 'letter3'].some(name => $(`#${name}`).value === key.dataset.char));
  });
}

function setActiveLetterSlot(name) {
  activeLetterSlot = name;
  renderLetterSlots();
}

function previewLetter(char) {
  $('#letter-preview span').textContent = char;
}

function initializePlatePicker() {
  $('#letter-palette').innerHTML = plateLetters.map(char =>
    `<button class="letter-key" type="button" data-char="${char}" title="${char === 'ه' ? '蛋形字母 ه（Hāʾ）' : `选择字母 ${char}`}" aria-label="${char === 'ه' ? '选择蛋形阿拉伯字母 ه' : `选择阿拉伯字母 ${char}`}">${char}</button>`
  ).join('');
  document.querySelectorAll('[data-letter-slot]').forEach(slot => {
    slot.addEventListener('click', () => setActiveLetterSlot(slot.dataset.letterSlot));
  });
  document.querySelectorAll('.letter-key').forEach(key => {
    const showPreview = () => previewLetter(key.dataset.char);
    key.addEventListener('mouseenter', showPreview);
    key.addEventListener('focus', showPreview);
    key.addEventListener('pointerdown', showPreview);
    key.addEventListener('click', () => {
      const current = activeLetterSlot;
      $(`#${current}`).value = key.dataset.char;
      previewLetter(key.dataset.char);
      if (current === 'letter1') setActiveLetterSlot('letter2');
      else if (current === 'letter2') setActiveLetterSlot('letter3');
      else { renderLetterSlots(); $('#plate-number').focus(); }
    });
  });
  $('#clear-letters').addEventListener('click', () => {
    for (const name of ['letter1', 'letter2', 'letter3']) $(`#${name}`).value = '';
    setActiveLetterSlot('letter1');
    previewLetter(plateLetters[0]);
  });
  $('#plate-number').addEventListener('input', event => {
    const cleaned = event.target.value.replace(/[^0-9]/g, '').slice(0, 8);
    if (event.target.value !== cleaned) event.target.value = cleaned;
  });
  renderLetterSlots();
}

function updateDocumentHint() {
  const input = $('#document-number');
  const hint = $('#document-hint');
  const ownerType = document.querySelector('[name="owner-type"]:checked')?.value || 'passport';
  const value = input.value.trim();
  hint.className = 'validation-hint';
  input.removeAttribute('aria-invalid');
  if (ownerType === 'national_id') {
    input.maxLength = 14;
    if (!value) hint.textContent = t('请输入 14 位纯数字的埃及身份证号。');
    else if (/^[0-9]{14}$/.test(value)) { hint.textContent = t('身份证号码格式正确。'); hint.classList.add('valid'); }
    else if (/[^0-9]/.test(value) || value.length >= 14) { hint.textContent = t('埃及身份证号必须是 14 位纯数字。'); hint.classList.add('invalid'); input.setAttribute('aria-invalid', 'true'); }
    else hint.textContent = t('继续输入，共需 14 位数字。');
    return;
  }
  input.maxLength = 9;
  if (!value) hint.textContent = t('支持中国普通护照 G/E 旧号段、新 E 字母号段，以及 DE/SE/PE 因公电子护照。');
  else if (isValidChinaPassport(value)) { hint.textContent = t('格式符合中国护照号码规则。'); hint.classList.add('valid'); }
  else if (/[^A-Za-z0-9]/.test(value) || value.length >= 9) { hint.textContent = t('格式不符合中国护照号码规则，请检查字母和位数。'); hint.classList.add('invalid'); input.setAttribute('aria-invalid', 'true'); }
  else hint.textContent = t('继续输入，完整中国护照号码应为 9 位。');
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'content-type': 'application/json', 'x-device-id': deviceId(), ...(options.headers || {}) } });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error?.message || '请求失败'), data.error || {});
  return data;
}

async function queryScreenshot(path) {
  const response = await fetch(path, { headers: { 'x-device-id': deviceId() } });
  if (!response.ok) {
    let data = {}; try { data = await response.json(); } catch {}
    throw new Error(data.error?.message || t('现场截图读取失败'));
  }
  return response.blob();
}

async function refresh() {
  try {
    const [health, history, serviceStatus] = await Promise.all([
      api('/api/v1/health'),
      api(`/api/v1/history?limit=${HISTORY_PAGE_SIZE}`),
      api('/api/v1/status')
    ]);
    state.queue = health.queue;
    state.history = history.items;
    state.historyCursor = history.nextCursor || '';
    state.status = serviceStatus;
    state.historyHasMore = Boolean(history.hasMore);
    renderAccessMeta(health);
    renderServiceBadge(serviceStatus);
    render();
  } catch {
    renderAccessMeta();
    $('#service-badge').className = 'service-badge offline';
    $('#service-badge span').textContent = t('连接失败');
  }
}

function renderServiceBadge(serviceStatus) {
  const badge = $('#service-badge');
  const official = serviceStatus?.official?.status;
  const level = official === 'outage' ? 'offline' : (official === 'degraded' || official === 'unknown' ? 'warning' : 'online');
  badge.className = `service-badge ${level}`;
  badge.querySelector('span').textContent = t(official === 'outage' ? '官网故障' : official === 'degraded' ? '官网波动' : official === 'unknown' ? '状态待确认' : '服务正常');
}

function render() {
  const running = state.queue?.running;
  $('#running-count').textContent = state.queue?.runningCount || 0;
  $('#queued-count').textContent = state.queue?.queuedCount || 0;
  $('#success-count').textContent = state.history.filter(item => item.status === 'success').length;
  $('#active-card').classList.toggle('hidden', !running);
  if (running) {
    $('#active-title').textContent = requestSummary(running);
    $('#active-percent').textContent = `${running.progress}%`;
    $('#active-progress').style.width = `${running.progress}%`;
    $('#active-step').textContent = t(steps[running.step] || running.step);
  } else if (state.queue?.queued?.length) {
    const mine = state.queue.queued[0];
    $('#active-card').classList.remove('hidden');
    $('#active-title').textContent = requestSummary(mine);
    $('#active-percent').textContent = getLanguage() === 'en' ? `Position ${mine.queuePosition}` : `第 ${mine.queuePosition} 位`;
    $('#active-progress').style.width = '5%';
    $('#active-step').textContent = getLanguage() === 'en' ? `Queued · about ${Math.max(1, Math.ceil((mine.estimatedWaitMs || 0) / 60_000))} min wait` : `正在排队，预计等待约 ${Math.max(1, Math.ceil((mine.estimatedWaitMs || 0) / 60_000))} 分钟`;
  }
  const notice = $('#queue-notice');
  if (state.queue?.circuit?.open) {
    notice.textContent = getLanguage() === 'en' ? `The PPO website is repeatedly failing. Queries are paused for about ${Math.max(1, Math.ceil(state.queue.circuit.retryAfterMs / 60_000))} minutes.` : `PPO 官网连续异常，查询入口已暂时保护性暂停，约 ${Math.max(1, Math.ceil(state.queue.circuit.retryAfterMs / 60_000))} 分钟后恢复。`;
    notice.classList.remove('hidden');
  } else if (state.queue && !state.queue.accepting) {
    notice.textContent = getLanguage() === 'en' ? `The queue has reached its ${state.queue.capacity}-task limit. Please try again later.` : `当前队列已达到 ${state.queue.capacity} 个任务，请稍后再试。`;
    notice.classList.remove('hidden');
  } else {
    notice.classList.add('hidden');
  }
  renderHistory();
}

function renderHistory() {
  $('#history-grid').innerHTML = state.history.map(item => {
    const meta = statusMeta(item.status);
    return `<button class="history-tile ${meta.css}" data-id="${item.id}" title="${t(meta.label)} · ${escapeHtml(requestSummary(item))}">${meta.icon}</button>`;
  }).join('') || '<p class="privacy-note history-empty">暂无查询记录</p>';
  $('#history-list').innerHTML = state.history.map(item => {
    const meta = statusMeta(item.status);
    const result = item.status === 'success' ? `${item.result?.totalFine || '0 جنيه'} · ${item.result?.violationCount || 0} ${getLanguage()==='en'?'violations':'笔'}` : t(steps[item.step] || meta.label);
    return `<button class="history-item" data-id="${item.id}"><i class="${meta.css}"></i><span><strong>${escapeHtml(requestSummary(item))}</strong><small>${escapeHtml(result)} · ${escapeHtml(t(meta.label))}</small></span><time>${new Date(item.createdAt).toLocaleString(getLanguage()==='en'?'en':'zh-CN', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })}</time></button>`;
  }).join('');
  $('#load-more-history').classList.toggle('hidden', !state.historyHasMore);
  $('#load-more-history').disabled = false;
  $('#load-more-history').textContent = t('加载更多记录');
  document.querySelectorAll('[data-id]').forEach(button => button.addEventListener('click', () => showDetail(button.dataset.id)));
}

function statusLabel(status) {
  return t(status === 'operational' ? '运行正常' : status === 'degraded' ? '服务波动' : status === 'outage' ? '服务中断' : status === 'offline' ? '已停止' : '等待检测');
}

function renderStatus(data) {
  const successRate = data.queries24h.successRate == null ? (getLanguage()==='en'?'No samples':'暂无样本') : `${data.queries24h.successRate}%`;
  const componentName = { server: t('本程序服务'), official: t('PPO 官网'), queue: t('队列') };
  $('#status-content').innerHTML = `<div class="status-components">
    <article><i class="${escapeHtml(data.server.status)}"></i><span><strong>${t('本程序服务')}</strong><small>${statusLabel(data.server.status)} · ${getLanguage()==='en'?`Up ${Math.floor(data.server.uptimeSeconds/60)} min`:`已运行 ${Math.floor(data.server.uptimeSeconds / 60)} 分钟`}</small></span></article>
    <article><i class="${escapeHtml(data.official.status)}"></i><span><strong>${t('PPO 官网')}</strong><small>${statusLabel(data.official.status)} · ${escapeHtml(t(data.official.message))}</small></span></article>
  </div>
  <div class="status-metrics">
    <div><span>${t('24 小时查询成功率')}</span><strong>${successRate}</strong><small>${getLanguage()==='en'?`${data.queries24h.success} success / ${data.queries24h.failed} failed`:`${data.queries24h.success} 成功 / ${data.queries24h.failed} 失败`}</small></div>
    <div><span>${t('当前队列')}</span><strong>${data.queue.running + data.queue.queued}/${data.queue.capacity}</strong><small>${t(data.queue.accepting ? '正常接收查询' : '暂时停止接收')}</small></div>
    <div><span>${t('24 小时流控')}</span><strong>${data.flow24h.rateLimited}</strong><small>${getLanguage()==='en'?`${data.flow24h.queueRejected} queue rejections`:`队列拒绝 ${data.flow24h.queueRejected} 次`}</small></div>
  </div>
  <h3 class="status-history-title">${t('最近状态记录')}</h3>
  <div class="status-history">${data.events.map(event => `<article><i class="${escapeHtml(event.status)}"></i><span><strong>${escapeHtml(componentName[event.component] || event.component)} · ${escapeHtml(t(event.message))}</strong><small>${new Date(event.createdAt).toLocaleString(getLanguage()==='en'?'en':'zh-CN')} · ${escapeHtml(event.code || 'STATUS')}</small></span></article>`).join('') || `<p class="privacy-note">${t('暂无状态变化记录')}</p>`}</div>
  <button id="load-more-status" class="load-more ${data.eventsPage?.hasMore ? '' : 'hidden'}" type="button">${t('加载更多状态记录')}</button>
  <p class="status-updated">${getLanguage()==='en'?'Updated':'更新时间'}：${new Date(data.generatedAt).toLocaleString(getLanguage()==='en'?'en':'zh-CN')}</p>`;
  const loadMore = $('#load-more-status');
  loadMore?.addEventListener('click', async () => {
    loadMore.disabled = true;
    loadMore.textContent = t('正在加载…');
    try { await loadStatus({ append: true }); }
    catch {
      loadMore.disabled = false;
      loadMore.textContent = t('加载更多状态记录');
    }
  });
}

async function loadStatus({ open = false, append = false } = {}) {
  const cursor = append ? (state.status?.eventsPage?.nextCursor || '') : '';
  const data = await api(`/api/v1/status?limit=${STATUS_PAGE_SIZE}${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`);
  if (append) data.events = [...(state.status?.events || []), ...data.events];
  state.status = data;
  renderServiceBadge(data);
  renderStatus(data);
  if (open) $('#status-dialog').showModal();
}

function initializeAdminEntry() {
  if (!desktopToken) return;
  const button = $('#admin-button');
  button.classList.remove('hidden');
  button.addEventListener('click', () => {
    window.location.href = `/admin.html#desktopToken=${encodeURIComponent(desktopToken)}`;
  });
}

async function showDetail(id) {
  const item = await api(`/api/v1/queries/${encodeURIComponent(id)}`);
  for (const url of state.evidenceUrls) URL.revokeObjectURL(url);
  state.evidenceUrls = [];
  const meta = statusMeta(item.status);
  const req = item.request || {};
  const maskedDocument = req.documentNumber || '—';
  const attempt = item.result?.attempt || item.error?.attempt || item.attempt || 1;
  const locale = getLanguage() === 'en' ? 'en' : 'zh-CN';
  $('#detail-content').innerHTML = `<dl class="detail-grid">
    <dt>${t('状态')}</dt><dd>${t(meta.label)}</dd><dt>${t('车牌')}</dt><dd>${escapeHtml(requestSummary(item))}</dd>
    <dt>${t('证件')}</dt><dd>${escapeHtml(maskedDocument)}</dd><dt>${t('追踪编号')}</dt><dd>${escapeHtml(item.traceId)}</dd>
    <dt>${t('来源')}</dt><dd>${escapeHtml(item.source)}</dd><dt>${t('创建时间')}</dt><dd>${new Date(item.createdAt).toLocaleString(locale)}</dd>
    <dt>${t('总罚款')}</dt><dd>${escapeHtml(item.result?.totalFine || '—')}</dd><dt>${t('违章笔数')}</dt><dd>${escapeHtml(item.result?.violationCount ?? '—')}</dd>
    <dt>${t('查询尝试')}</dt><dd>${getLanguage() === 'en' ? `${escapeHtml(attempt)} ${Number(attempt) === 1 ? 'attempt' : 'attempts'}` : `${escapeHtml(attempt)} 次`}</dd>
    <dt>${t('失败原因')}</dt><dd>${escapeHtml(item.error ? localizeError(item.error) : '—')}</dd>
    <dt>${t('官网提示')}</dt><dd dir="auto">${escapeHtml(item.error?.officialMessage || '—')}</dd>
  </dl>${item.status==='success'?`<section id="sms-binding-panel" class="sms-binding-panel"><span class="muted">${t('正在读取短信通知状态…')}</span></section>`:''}${item.diagnostics&&Object.values(item.diagnostics).some(Boolean)?`<section class="query-evidence"><h3>${t('查询现场截图')}</h3><p>${t('截图包含实际提交前表单和 PPO 最终结果或报错页面，仅当前设备可查看。')}</p><div id="query-evidence-grid" class="query-evidence-grid"><span class="muted">${t('正在加载…')}</span></div></section>`:''}<div class="timeline">${item.events.map(event => `<div>${escapeHtml(localizeTimelineStep(steps[event.step] || event.event))}${event.detail ? `<p>${escapeHtml(localizeTimelineDetail(event.detail))}</p>` : ''}<small>${new Date(event.createdAt).toLocaleString(locale)}${event.progress != null ? ` · ${event.progress}%` : ''}${event.attempt ? (getLanguage() === 'en' ? ` · Attempt ${event.attempt}` : ` · 第 ${event.attempt} 次`) : ''}</small></div>`).join('')}</div>`;
  $('#detail-dialog').showModal();
  if (item.status === 'success') loadSmsBinding(id);
  if (item.diagnostics && Object.values(item.diagnostics).some(Boolean)) {
    const grid = $('#query-evidence-grid'); grid.innerHTML = '';
    const files = [['before','提交前截图'],['after','最终结果或报错截图']].filter(([kind]) => item.diagnostics[kind]);
    for (const [kind,label] of files) {
      try {
        const blob = await queryScreenshot(`/api/v1/queries/${encodeURIComponent(id)}/diagnostics/${kind}`);
        const objectUrl = URL.createObjectURL(blob); state.evidenceUrls.push(objectUrl);
        grid.insertAdjacentHTML('beforeend', `<a class="query-evidence-card" href="${objectUrl}" target="_blank" rel="noopener"><img src="${objectUrl}" alt="${escapeHtml(t(label))}"><strong>${escapeHtml(t(label))}</strong><small>${t('点击查看原图')}</small></a>`);
      } catch (error) {
        grid.insertAdjacentHTML('beforeend', `<p class="form-message">${escapeHtml(error.message)}</p>`);
      }
    }
  }
}

function renderSmsBinding(id, binding) {
  const panel = $('#sms-binding-panel');
  if (!panel) return;
  const english = getLanguage() === 'en';
  if (!binding.available && binding.status !== 'verified') {
    panel.innerHTML = `<h3>${english?'SMS result notification':'短信结果通知'}</h3><p class="muted">${english?'SMS is not available yet. Ask the administrator to enable it.':'短信服务尚未启用，请联系管理员。'}</p>`;
    return;
  }
  if (binding.status === 'verified') {
    const hours = Number(binding.intervalHours || 168);
    const period = hours % 24 === 0 ? (english ? `${hours/24} day${hours===24?'':'s'}` : `${hours/24} 天`) : (english ? `${hours} hours` : `${hours} 小时`);
    const next = binding.nextRunAt ? new Date(binding.nextRunAt).toLocaleString(english?'en':'zh-CN') : '—';
    panel.innerHTML = `<h3>${english?'SMS result notification':'短信结果通知'}</h3><div class="sms-binding-success"><strong>✓ ${english?'Verified and enabled':'号码已验证并启用'}</strong><span>${escapeHtml(binding.phoneMasked)}</span></div><p class="muted">${english?`The system will automatically query every ${period} and send the result by SMS. Next run: ${next}.`:`系统已默认开启周期自动查询，将每 ${period} 查询一次并发送短信结果。下次查询：${next}。`}</p><form id="sms-schedule-form" class="sms-schedule-form"><label>${english?'Query interval (hours, minimum 24)':'自动查询周期（小时，最小 24）'}<input id="sms-schedule-hours" type="number" min="24" max="8760" step="1" value="${hours}" required></label><button class="ghost" type="submit">${english?'Save interval':'保存周期'}</button></form><button id="sms-change-phone" class="ghost" type="button">${english?'Change number':'更换手机号'}</button><p id="sms-binding-message" class="message hidden" role="alert"></p>`;
    $('#sms-schedule-form').addEventListener('submit', event => updateSmsSchedule(event, id));
    $('#sms-change-phone').addEventListener('click', () => renderSmsBinding(id, { ...binding, status:'unbound' }));
    return;
  }
  if (binding.status === 'pending') {
    panel.innerHTML = `<h3>${english?'Verify mobile number':'验证手机号'}</h3><p class="muted">${english?`A 6-digit code was sent to ${binding.phoneMasked}. After verification, automatic queries will run every ${binding.intervalHours || 168} hours.`:`6 位验证码已发送至 ${binding.phoneMasked}。验证成功后才会启用，并将默认每 ${binding.intervalHours || 168} 小时自动查询和发送结果。`}</p><form id="sms-code-form" class="sms-code-form"><input id="sms-binding-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" placeholder="${english?'6-digit code':'6 位验证码'}" required><button class="primary" type="submit">${english?'Verify and enable':'验证并启用'}</button></form><button id="sms-resend-code" class="ghost" type="button">${english?'Resend / change number':'重新发送或更换号码'}</button><p id="sms-binding-message" class="message hidden" role="alert"></p>`;
    $('#sms-code-form').addEventListener('submit', event => verifySmsBinding(event, id, binding.bindingId));
    $('#sms-resend-code').addEventListener('click', () => renderSmsBinding(id, { ...binding, status:'unbound' }));
    return;
  }
  panel.innerHTML = `<h3>${english?'SMS result notification':'短信结果通知'}</h3><p class="muted">${english?'Egyptian mobile numbers only. +20 is fixed. Automatic querying defaults to every 7 days; choose another interval below, with a 24-hour minimum.':'仅支持埃及手机号，国家前缀固定为 +20。验证成功后默认每 7 天自动查询一次；可选择其他周期，最短为 24 小时。'}</p><form id="sms-phone-form" class="sms-phone-form"><label class="sms-phone-field"><span>+20</span><input id="sms-binding-phone" type="tel" inputmode="tel" autocomplete="tel-national" maxlength="16" placeholder="10XXXXXXXX 或 010XXXXXXXX" required></label><label class="sms-period-field">${english?'Interval (hours)':'周期（小时）'}<input id="sms-binding-interval" type="number" min="24" max="8760" step="1" value="${Number(binding.intervalHours || 168)}" required></label><button class="primary" type="submit">${english?'Send verification code':'发送验证码'}</button></form><p class="sms-binding-policy">${english?'Scheduled work uses the same serial queue and yields while foreground work is queued. Device/IP configuration limits also apply.':'周期任务统一使用现有串行队列，前台已有任务时会主动让路；设备与 IP 配置限额仍然生效。'}</p><p id="sms-binding-message" class="message hidden" role="alert"></p>`;
  $('#sms-phone-form').addEventListener('submit', event => requestSmsBinding(event, id));
}

async function loadSmsBinding(id) {
  try { renderSmsBinding(id, await api(`/api/v1/queries/${encodeURIComponent(id)}/sms-binding`)); }
  catch (error) { const panel=$('#sms-binding-panel'); if(panel) panel.innerHTML=`<p class="message">${escapeHtml(localizeError(error))}</p>`; }
}

async function requestSmsBinding(event, id) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  try {
    const result = await api(`/api/v1/queries/${encodeURIComponent(id)}/sms-binding`, { method:'POST', body:JSON.stringify({ phone:$('#sms-binding-phone').value, intervalHours:Number($('#sms-binding-interval').value) }) });
    renderSmsBinding(id, result);
  } catch (error) {
    const message=$('#sms-binding-message'); message.textContent=localizeError(error); message.classList.remove('hidden'); button.disabled=false;
  }
}

async function updateSmsSchedule(event, id) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  try {
    const result = await api(`/api/v1/queries/${encodeURIComponent(id)}/sms-binding`, { method:'PATCH', body:JSON.stringify({ intervalHours:Number($('#sms-schedule-hours').value) }) });
    renderSmsBinding(id, result);
  } catch (error) {
    const message=$('#sms-binding-message'); message.textContent=localizeError(error); message.classList.remove('hidden'); button.disabled=false;
  }
}

async function verifySmsBinding(event, id, bindingId) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  try {
    const result = await api(`/api/v1/queries/${encodeURIComponent(id)}/sms-binding/verify`, { method:'POST', body:JSON.stringify({ bindingId, code:$('#sms-binding-code').value }) });
    renderSmsBinding(id, result);
  } catch (error) {
    const message=$('#sms-binding-message'); message.textContent=localizeError(error); message.classList.remove('hidden'); button.disabled=false;
  }
}

function savedProfiles() {
  try { return JSON.parse(localStorage.getItem('ppo-saved-profiles') || '[]'); } catch { return []; }
}
function updateProfiles() {
  const profiles = savedProfiles();
  $('#saved-profile').innerHTML = '<option value="">最近填写</option>' + profiles.map((profile, index) => `<option value="${index}">${escapeHtml(profile.label)}</option>`).join('');
}
function remember(payload) {
  const profiles = savedProfiles();
  const profile = {
    label: `${payload.plate.letters.join('')} ${payload.plate.number}`,
    plate: payload.plate,
    owner: { ...payload.owner, documentNumber: $('#remember-full').checked ? payload.owner.documentNumber : '' },
    rememberFull: $('#remember-full').checked,
    savedAt: Date.now()
  };
  const unique = profiles.filter(item => item.label !== profile.label);
  localStorage.setItem('ppo-saved-profiles', JSON.stringify([profile, ...unique].slice(0, 20)));
  updateProfiles();
}

$('#query-form').addEventListener('submit', async event => {
  event.preventDefault();
  const submit = $('#submit-button'); const message = $('#form-message');
  const ownerType = document.querySelector('[name="owner-type"]:checked').value;
  const rawLetters = [$('#letter1').value, $('#letter2').value, $('#letter3').value];
  if (!rawLetters[0] || !rawLetters[1] || (rawLetters[2] && !rawLetters[1])) {
    message.textContent = t('请从第一位开始，依次选择 2～3 个车牌阿拉伯字母。');
    message.style.color = ''; message.style.background = ''; message.style.borderColor = ''; message.classList.remove('hidden');
    setActiveLetterSlot(rawLetters[0] ? 'letter2' : 'letter1');
    return;
  }
  if (!/^[0-9]{1,8}$/.test($('#plate-number').value.trim())) {
    message.textContent = t('车牌数字只能输入 0–9，长度为 1～8 位。');
    message.style.color = ''; message.style.background = ''; message.style.borderColor = ''; message.classList.remove('hidden');
    $('#plate-number').focus(); return;
  }
  let documentNumber = $('#document-number').value.trim();
  if (ownerType === 'national_id' && !/^[0-9]{14}$/.test(documentNumber)) {
    message.textContent = t('埃及身份证号必须是 14 位纯数字。');
    message.style.color = ''; message.style.background = ''; message.style.borderColor = ''; message.classList.remove('hidden');
    $('#document-number').focus(); return;
  }
  if (ownerType === 'passport') {
    documentNumber = normalizeChinaPassport(documentNumber);
    $('#document-number').value = documentNumber;
  }
  if (ownerType === 'passport' && !isValidChinaPassport(documentNumber)) {
    message.textContent = t('中国护照号码格式不正确，请检查字母和位数。');
    message.style.color = ''; message.style.background = ''; message.style.borderColor = ''; message.classList.remove('hidden');
    updateDocumentHint(); $('#document-number').focus(); return;
  }
  const payload = {
    requestId: crypto.randomUUID(), deviceId: deviceId(),
    plate: { letters: rawLetters.filter(Boolean), number: $('#plate-number').value.trim() },
    owner: { type: ownerType, documentNumber, country: $('#country-select').value, foreignType: 'foreign' }
  };
  submit.disabled = true; message.classList.add('hidden');
  try {
    const result = await api('/api/v1/queries', { method: 'POST', body: JSON.stringify(payload) });
    remember(payload);
    message.textContent = t(result.reused ? '已找到相同任务，正在显示原查询进度。' : '提交成功，任务已进入查询队列。');
    message.style.color = 'var(--success-text)'; message.style.background = 'var(--success-bg)'; message.style.borderColor = 'var(--success-border)'; message.classList.remove('hidden');
    await refresh();
  } catch (error) {
    message.textContent = error.retryAfterMs ? `${localizeError(error)} ${getLanguage()==='en'?`(about ${Math.ceil(error.retryAfterMs/1000)}s)`:`（约 ${Math.ceil(error.retryAfterMs / 1000)} 秒）`}` : localizeError(error);
    message.style.color = ''; message.style.background = ''; message.style.borderColor = ''; message.classList.remove('hidden');
  } finally { submit.disabled = false; }
});

$('#saved-profile').addEventListener('change', event => {
  const profile = savedProfiles()[Number(event.target.value)]; if (!profile) return;
  [$('#letter1').value, $('#letter2').value, $('#letter3').value] = [profile.plate.letters[0] || '', profile.plate.letters[1] || '', profile.plate.letters[2] || ''].map(normalizePlateLetter);
  $('#plate-number').value = String(profile.plate.number || '').replace(/[^0-9]/g, '').slice(0, 8);
  $('#document-number').value = profile.owner.documentNumber || '';
  $('#remember-full').checked = Boolean(profile.rememberFull);
  const radio = document.querySelector(`[name="owner-type"][value="${profile.owner.type || 'passport'}"]`);
  if (radio) { radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true })); }
  renderLetterSlots();
  updateDocumentHint();
});
$('#document-number').addEventListener('input', event => {
  if (document.querySelector('[name="owner-type"]:checked')?.value === 'passport') {
    const upper = event.target.value.toUpperCase();
    if (event.target.value !== upper) event.target.value = upper;
  }
  updateDocumentHint();
});
$('#toggle-document').addEventListener('click', () => { const input = $('#document-number'); input.type = input.type === 'password' ? 'text' : 'password'; $('#toggle-document').textContent = t(input.type === 'password' ? '显示' : '隐藏'); });
$('#close-dialog').addEventListener('click', () => {
  $('#detail-dialog').close();
  for (const url of state.evidenceUrls) URL.revokeObjectURL(url);
  state.evidenceUrls = [];
});
$('#refresh-history').addEventListener('click', () => { state.historyCursor = ''; refresh(); });
$('#load-more-history').addEventListener('click', async () => {
  const button = $('#load-more-history');
  button.disabled = true; button.textContent = t('正在加载…');
  try {
    const data = await api(`/api/v1/history?limit=${HISTORY_PAGE_SIZE}${state.historyCursor?`&cursor=${encodeURIComponent(state.historyCursor)}`:''}`);
    state.history = [...state.history, ...data.items]; state.historyCursor = data.nextCursor || ''; state.historyHasMore = Boolean(data.hasMore); renderHistory();
  } catch { button.disabled = false; button.textContent = t('加载更多记录'); }
});
$('#service-badge').addEventListener('click', () => loadStatus({ open: true }));
$('#refresh-status').addEventListener('click', () => loadStatus());
$('#close-status-dialog').addEventListener('click', () => $('#status-dialog').close());
$('#feedback-button').addEventListener('click', () => $('#feedback-dialog').showModal());
$('#close-feedback-dialog').addEventListener('click', () => $('#feedback-dialog').close());
$('#feedback-content').addEventListener('input', event => { $('#feedback-count').textContent = `${event.target.value.length} / 2000`; });
function attachmentPayload(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(t('读取附件失败，请重新选择')));
    const inferredMime = ({png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',pdf:'application/pdf',txt:'text/plain',log:'text/plain'})[file.name.split('.').pop().toLowerCase()] || '';
    reader.onload = () => resolve({ name:file.name, mime:file.type || inferredMime, data:String(reader.result).split(',')[1] || '' });
    reader.readAsDataURL(file);
  });
}
async function validateAttachmentFile(file) {
  if (!file.type.startsWith('image/')) return;
  if (typeof createImageBitmap !== 'function') return;
  try {
    const image = await createImageBitmap(file);
    image.close();
  } catch {
    throw new Error(t('图片无法打开，请重新选择有效图片'));
  }
}
$('#feedback-form').addEventListener('submit', async event => {
  event.preventDefault();
  const submit = $('#feedback-submit');
  const message = $('#feedback-message');
  submit.disabled = true; message.classList.add('hidden');
  try {
    const files = [...$('#feedback-attachments').files];
    if (files.length > 3) throw new Error(t('最多只能上传 3 个附件'));
    if (files.some(file => file.size > 5 * 1024 * 1024)) throw new Error(t('单个附件不能超过 5 MB'));
    if (files.reduce((sum, file) => sum + file.size, 0) > 10 * 1024 * 1024) throw new Error(t('附件总大小不能超过 10 MB'));
    await Promise.all(files.map(validateAttachmentFile));
    const attachments = await Promise.all(files.map(attachmentPayload));
    const result = await api('/api/v1/feedback', { method:'POST', body:JSON.stringify({
      phone:$('#feedback-phone').value.trim(), wechat:$('#feedback-wechat').value.trim(),
      content:$('#feedback-content').value.trim(), pageUrl:`${location.origin}${location.pathname}`, attachments
    }) });
    message.textContent = t(result.message);
    message.style.color = 'var(--success-text)'; message.style.background = 'var(--success-bg)'; message.style.borderColor = 'var(--success-border)'; message.classList.remove('hidden');
    $('#feedback-content').value = ''; $('#feedback-attachments').value = ''; $('#feedback-count').textContent = '0 / 2000';
  } catch (error) {
    message.textContent = error.retryAfterMs ? `${localizeError(error)} ${getLanguage()==='en'?`(about ${Math.ceil(error.retryAfterMs/1000)}s)`:`（约 ${Math.ceil(error.retryAfterMs / 1000)} 秒）`}` : localizeError(error);
    message.style.color = ''; message.style.background = ''; message.style.borderColor = ''; message.classList.remove('hidden');
  } finally { submit.disabled = false; }
});
document.querySelectorAll('[name="owner-type"]').forEach(input => input.addEventListener('change', () => {
  if (!input.checked) return;
  const nationalId = input.value === 'national_id';
  $('#country-field').classList.toggle('hidden', nationalId);
  $('#document-number').inputMode = nationalId ? 'numeric' : 'text';
  $('#document-number').placeholder = getLanguage()==='en' ? (nationalId ? 'Enter the 14-digit Egyptian National ID' : 'Enter the full passport number') : (nationalId ? '请输入 14 位埃及身份证号' : '请输入完整护照号码');
  updateDocumentHint();
}));

const eventStreamId = sessionStorage.getItem('ppo-event-stream-id') || (crypto.randomUUID?.() || `stream-${Date.now()}-${Math.random().toString(36).slice(2)}`);
sessionStorage.setItem('ppo-event-stream-id', eventStreamId);
let events = null;
let eventReconnectTimer = null;
let eventHiddenTimer = null;

function disconnectEvents() {
  clearTimeout(eventReconnectTimer); eventReconnectTimer = null;
  if (events) events.close();
  events = null;
}

function scheduleEventReconnect(delay = 500) {
  clearTimeout(eventReconnectTimer);
  if (document.hidden) return;
  eventReconnectTimer = setTimeout(() => { eventReconnectTimer = null; connectEvents(); }, delay);
}

function handleEventMessage(event) {
  const data = JSON.parse(event.data);
  if (data.type === 'stream_reset') {
    disconnectEvents();
    scheduleEventReconnect(Number(data.retryAfterMs) || 500);
    return;
  }
  if (data.queue) state.queue = data.queue;
  if (data.query) {
    const index = state.history.findIndex(item => item.id === data.query.id);
    if (index >= 0) state.history[index] = { ...state.history[index], ...data.query };
    else state.history.unshift(data.query);
    state.history = state.history.slice(0, Math.max(HISTORY_PAGE_SIZE, state.history.length));
    if (data.query.status === 'failed') {
      const message = $('#form-message');
      message.textContent = getLanguage()==='en' ? `Query failed: ${data.query.error?.message || 'See the history diagnostics.'}` : `查询失败：${data.query.error?.message || '请查看历史记录中的诊断信息'}`;
      message.style.color = ''; message.style.background = ''; message.style.borderColor = ''; message.classList.remove('hidden');
    } else if (data.query.status === 'success') {
      const message = $('#form-message');
      message.textContent = getLanguage()==='en' ? `Completed: total fine ${data.query.result?.totalFine || '0 جنيه'}, ${data.query.result?.violationCount || 0} violations.` : `查询完成：总罚款 ${data.query.result?.totalFine || '0 جنيه'}，违章 ${data.query.result?.violationCount || 0} 笔。`;
      message.style.color = 'var(--success-text)'; message.style.background = 'var(--success-bg)'; message.style.borderColor = 'var(--success-border)'; message.classList.remove('hidden');
    }
  }
  render();
}

function connectEvents() {
  if (document.hidden || events) return;
  const source = new EventSource(`/api/v1/events?deviceId=${encodeURIComponent(deviceId())}&streamId=${encodeURIComponent(eventStreamId)}`);
  events = source;
  source.onmessage = event => { if (events === source) handleEventMessage(event); };
  source.onerror = () => { if (events === source) { $('#service-badge').className = 'service-badge offline'; $('#service-badge span').textContent = t('正在重连'); } };
  source.onopen = () => { if (events === source && state.status) renderServiceBadge(state.status); };
}

document.addEventListener('visibilitychange', () => {
  clearTimeout(eventHiddenTimer);
  if (document.hidden) eventHiddenTimer = setTimeout(disconnectEvents, 60_000);
  else connectEvents();
});
window.addEventListener('pagehide', disconnectEvents);
window.addEventListener('pageshow', connectEvents);
initializePreferences($('.topbar-actions'));
window.addEventListener('ppo:languagechange', () => { renderAccessMeta(); renderLetterSlots(); updateProfiles(); updateDocumentHint(); if(state.status){renderServiceBadge(state.status);renderStatus(state.status);} render(); applyTranslations(); });
initializePlatePicker(); updateProfiles(); updateDocumentHint(); initializeAdminEntry(); refresh();
connectEvents();
