import { applyTranslations, getLanguage, initializePreferences, localizeError, t } from './preferences.js';

const $ = selector => document.querySelector(selector);
const hashToken = new URLSearchParams(location.hash.slice(1)).get('desktopToken') || '';
if (hashToken) sessionStorage.setItem('ppo-desktop-token', hashToken);
const token = hashToken || sessionStorage.getItem('ppo-desktop-token') || '';
if (hashToken) history.replaceState(null, '', '/admin');
const state = { auth:null, csrfToken:'', overview:null, queries:[], queryCursor:'', feedback:[], feedbackCursor:'', logs:[], logCursor:'', serviceEvents:[], serviceCursor:'', attachmentUrls:[] };

function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[char]); }
function formatTime(value) { return value ? new Date(value).toLocaleString(getLanguage()==='en'?'en':'zh-CN') : '—'; }
function requestSummary(record) { const request=record?.request||{}; return `${[request.letter1,request.letter2,request.letter3].filter(Boolean).join(' ')} ${request.plateNumber||''}`.trim()||'—'; }
function maskDocument(value) { const text=String(value||''); return text.length>4 ? `${text.slice(0,2)}${'*'.repeat(Math.min(8,text.length-4))}${text.slice(-2)}` : '*'.repeat(text.length); }
function statusLabel(status) { return t(({success:'成功',failed:'失败',queued:'排队中',running:'执行中',cancelled:'已取消',interrupted:'中断',operational:'运行正常',degraded:'服务波动',outage:'服务中断',offline:'已停止',unknown:'等待检测',new:'未读',read:'已读',resolved:'已处理',archived:'已归档'})[status]||status||'未知'); }
function componentLabel(component) { return t(({server:'本程序服务',official:'PPO 官网',queue:'队列',rate_limit:'流控'})[component]||component); }
function geoText(geo) { if (!geo) return t('待定位'); if (geo.scope==='loopback') return t('本机'); if (geo.scope==='private'||geo.scope==='link_local') return t('局域网'); if (geo.unavailable) return t('定位暂不可用'); return [geo.country,geo.region,geo.city,geo.isp].filter(Boolean).join(' · ')||t('未知'); }
function updatePager(buttonSelector, hasMore, activeLabel) { const button=$(buttonSelector); button.disabled=!hasMore; button.textContent=hasMore?t(activeLabel):t('已全部加载'); }

async function adminApi(path, options={}) {
  const headers = { ...(token ? {'x-desktop-token':token} : {}), ...(state.csrfToken ? {'x-csrf-token':state.csrfToken} : {}), ...(options.body ? {'content-type':'application/json'} : {}), ...(options.headers||{}) };
  const response = await fetch(path, { credentials:'same-origin', ...options, headers });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error?.message||'管理员接口请求失败'), data.error||{}, { status:response.status });
  return data;
}

async function adminAttachment(path) {
  const headers = { ...(token ? {'x-desktop-token':token} : {}), ...(state.csrfToken ? {'x-csrf-token':state.csrfToken} : {}) };
  const response = await fetch(path, { credentials:'same-origin', headers });
  if (!response.ok) {
    let data={}; try { data=await response.json(); } catch {}
    throw new Error(data.error?.message||t('附件读取失败'));
  }
  return response.blob();
}

function renderMetrics(status) {
  const rate=status.queries24h.successRate==null?'—':`${status.queries24h.successRate}%`;
  $('#metric-grid').innerHTML=[
    [t('本程序服务'),status.server.status,statusLabel(status.server.status),getLanguage()==='en'?`Up ${Math.floor(status.server.uptimeSeconds/60)} min`:`运行 ${Math.floor(status.server.uptimeSeconds/60)} 分钟`],
    [t('PPO 官网'),status.official.status,statusLabel(status.official.status),status.official.message],
    [getLanguage()==='en'?'24-hour success rate':'24 小时成功率','',rate,getLanguage()==='en'?`${status.queries24h.success} success / ${status.queries24h.failed} failed`:`${status.queries24h.success} 成功 / ${status.queries24h.failed} 失败`],
    [t('当前队列'),'',`${status.queue.running+status.queue.queued}/${status.queue.capacity}`,t(status.queue.accepting?'正常接收查询':'暂时停止接收')],
    [t('未读'),'',state.overview?.feedback?.unread||0,getLanguage()==='en'?`${state.overview?.feedback?.total||0} total`:`累计 ${state.overview?.feedback?.total||0} 条`]
  ].map(([label,css,value,note])=>`<article class="metric"><span>${escapeHtml(label)}</span><strong>${css?`<i class="${escapeHtml(css)}"></i>`:''}${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></article>`).join('');
}

function renderQueue(queue) {
  const rows=[]; if(queue.running) rows.push({...queue.running,queuePosition:'执行中'}); queue.queued.forEach((record,index)=>rows.push({...record,queuePosition:index+1}));
  $('#queue-body').innerHTML=rows.map(record=>`<tr><td>${escapeHtml(record.queuePosition==='执行中'?statusLabel('running'):record.queuePosition)}</td><td><span class="status ${escapeHtml(record.status)}"><i></i>${statusLabel(record.status)}</span></td><td class="mono nowrap">${escapeHtml(requestSummary(record))}</td><td class="mono">${escapeHtml(record.request?.documentNumber||'—')}</td><td><button class="search-value mono" data-search-log="${escapeHtml(record.traceId)}">${escapeHtml(record.traceId)}</button></td><td><span class="mono">${escapeHtml(record.deviceId||'—')}</span><small class="muted block">${escapeHtml(record.sourceIp||'—')} · ${escapeHtml(geoText(record.geo))}</small></td><td>${escapeHtml(record.progress)}% · ${escapeHtml(record.step)}</td></tr>`).join('')||(getLanguage()==='en'?'<tr><td colspan="7" class="muted">No running or queued tasks</td></tr>':'<tr><td colspan="7" class="muted">当前没有运行或排队任务</td></tr>');
  bindLogSearchButtons();
}

function renderServiceHistory(events) { $('#service-history').innerHTML=events.map(event=>`<article class="service-event"><i class="${escapeHtml(event.status)}"></i><strong>${escapeHtml(componentLabel(event.component))}</strong><span>${escapeHtml(t(event.message))} <small class="muted">${escapeHtml(event.code||'')}</small></span><time>${formatTime(event.createdAt)}</time></article>`).join('')||`<p class="muted">${t('暂无服务状态记录')}</p>`; }

async function loadServiceEvents({append=false}={}) {
  if(!append) state.serviceCursor='';
  const params=new URLSearchParams({limit:'10'}); if(append&&state.serviceCursor)params.set('cursor',state.serviceCursor);
  const data=await adminApi(`/api/v1/admin/service-events?${params}`);
  state.serviceEvents=append?[...state.serviceEvents,...data.items]:data.items; state.serviceCursor=data.nextCursor||'';
  renderServiceHistory(state.serviceEvents);
  $('#service-total').textContent=getLanguage()==='en'?`${data.total} total`:`共 ${data.total} 条`;
  $('#service-page-summary').textContent=getLanguage()==='en'?`Showing ${state.serviceEvents.length} of ${data.total}`:`已显示 ${state.serviceEvents.length} / 共 ${data.total} 条`;
  updatePager('#load-more-service-events',data.hasMore,'加载更多状态记录');
}

async function loadOverview() {
  const data=await adminApi('/api/v1/admin/overview'); state.overview=data; renderMetrics(data.status); renderQueue(data.queue);
  const unread=data.feedback?.unread||0; $('#feedback-unread').textContent=unread; $('#feedback-unread').classList.toggle('hidden',!unread);
  $('#admin-live').className='live online'; $('#admin-live').innerHTML=`<i></i>${t('已连接')}`;
}

function renderCoreStatus(data) {
  state.core=data;
  $('#core-state').textContent=data.switching?t('正在切换核心'):data.checking?t('正在检查更新'):t('运行正常');
  $('#core-summary').innerHTML=`<div><span>${getLanguage()==='en'?'Shell':'稳定外壳'}</span><strong>v${escapeHtml(data.shellVersion||'—')}</strong></div><div><span>${getLanguage()==='en'?'Active core':'当前核心'}</span><strong>v${escapeHtml(data.activeVersion||'—')}</strong></div><div><span>${getLanguage()==='en'?'Rollback core':'可回滚核心'}</span><strong>${data.previousVersion?`v${escapeHtml(data.previousVersion)}`:'—'}</strong></div><div><span>${getLanguage()==='en'?'Installed':'已安装核心'}</span><strong>${escapeHtml((data.installedVersions||[]).join(' / ')||'—')}</strong></div>`;
  $('#install-core-update').classList.toggle('hidden',!data.available); if(data.available)$('#install-core-update').textContent=getLanguage()==='en'?`Update to core v${data.available.version}`:`平滑更新到核心 v${data.available.version}`;
  $('#rollback-core').classList.toggle('hidden',!data.previousVersion||data.previousVersion===data.activeVersion);
  if(data.error){$('#core-message').textContent=data.error;$('#core-message').classList.remove('hidden');}
}
async function loadCoreStatus(){renderCoreStatus(await adminApi('/api/v1/admin/core/status'));}
async function coreAction(action){const message=$('#core-message');message.classList.add('hidden');try{const data=await adminApi(`/api/v1/admin/core/${action}`,{method:'POST',body:'{}'});message.textContent=data.message||t('操作已开始');message.classList.remove('hidden');if(action==='check')renderCoreStatus(data);else setTimeout(()=>location.reload(),6000);}catch(error){message.textContent=localizeError(error);message.classList.remove('hidden');}}

function queryResultText(record) { return record.status==='success'?`${record.result?.totalFine||'0 جنيه'} · ${record.result?.violationCount||0} ${getLanguage()==='en'?'violations':'笔'}`:(record.error?.message||record.detail||record.step||'—'); }
function renderQueries(data,append=false) {
  const rows=data.items.map(record=>`<tr><td class="nowrap">${formatTime(record.createdAt)}</td><td><span class="status ${escapeHtml(record.status)}"><i></i>${statusLabel(record.status)}</span></td><td><button class="search-value mono" data-search-log="${escapeHtml(requestSummary(record))}">${escapeHtml(requestSummary(record))}</button></td><td><button class="search-value mono" data-search-log="${escapeHtml(maskDocument(record.request?.documentNumber))}">${escapeHtml(record.request?.documentNumber||'—')}</button></td><td><button class="search-value mono" data-search-log="${escapeHtml(record.traceId)}">${escapeHtml(record.traceId)}</button></td><td><span class="mono">${escapeHtml(record.sourceIp||'—')}</span><small class="muted block">${escapeHtml(geoText(record.geo))}</small></td><td class="mono">${escapeHtml(record.deviceId||'—')}</td><td>${escapeHtml(queryResultText(record))}</td><td><div class="cell-action"><button data-query-id="${escapeHtml(record.id)}">详情</button><button data-search-log="${escapeHtml(record.traceId)}">日志</button></div></td></tr>`).join('');
  if(append) $('#query-body').insertAdjacentHTML('beforeend',rows); else $('#query-body').innerHTML=rows||`<tr><td colspan="9" class="muted">${t('没有匹配的查询记录')}</td></tr>`;
  $('#query-total').textContent=getLanguage()==='en'?`${data.total} total`:`共 ${data.total} 条`; $('#query-page-summary').textContent=getLanguage()==='en'?`Showing ${state.queries.length} of ${data.total}`:`已显示 ${state.queries.length} / 共 ${data.total} 条`; updatePager('#load-more-queries',data.hasMore,'加载更多查询'); bindQueryButtons(); bindLogSearchButtons();
}
async function loadQueries({append=false}={}) { if(!append) state.queryCursor=''; const params=new URLSearchParams({q:$('#query-search').value.trim(),status:$('#query-status').value,limit:'50'}); if(append&&state.queryCursor)params.set('cursor',state.queryCursor); const data=await adminApi(`/api/v1/admin/queries?${params}`); state.queryCursor=data.nextCursor||''; state.queries=append?[...state.queries,...data.items]:data.items; renderQueries(data,append); }

function renderFeedback(data,append=false) {
  const rows=data.items.map(item=>`<tr><td class="nowrap">${formatTime(item.createdAt)}</td><td><span class="status feedback-${escapeHtml(item.status)}"><i></i>${statusLabel(item.status)}</span></td><td class="feedback-copy" data-no-i18n>${escapeHtml(item.content)}${item.attachments?.length?`<small class="muted block">📎 ${item.attachments.length} ${getLanguage()==='en'?'attachment(s)':'个附件'}</small>`:''}</td><td>${escapeHtml(item.phone||'—')}<small class="muted block">${getLanguage()==='en'?'WeChat':'微信'}：${escapeHtml(item.wechat||'—')}</small></td><td class="mono">${escapeHtml(item.deviceId)}</td><td><span class="mono">${escapeHtml(item.sourceIp||'—')}</span><small class="muted block">${escapeHtml(geoText(item.geo))}</small></td><td><button data-feedback-id="${escapeHtml(item.id)}">${t('查看处理')}</button></td></tr>`).join('');
  if(append) $('#feedback-body').insertAdjacentHTML('beforeend',rows); else $('#feedback-body').innerHTML=rows||`<tr><td colspan="7" class="muted">${t('没有匹配的反馈')}</td></tr>`;
  $('#feedback-total').textContent=getLanguage()==='en'?`${data.total} total`:`共 ${data.total} 条`; $('#feedback-page-summary').textContent=getLanguage()==='en'?`Showing ${state.feedback.length} of ${data.total}`:`已显示 ${state.feedback.length} / 共 ${data.total} 条`; updatePager('#load-more-feedback',data.hasMore,'加载更多反馈'); bindFeedbackButtons();
}
async function loadFeedback({append=false}={}) { if(!append) state.feedbackCursor=''; const params=new URLSearchParams({q:$('#feedback-search').value.trim(),status:$('#feedback-status').value,limit:'50'}); if(append&&state.feedbackCursor)params.set('cursor',state.feedbackCursor); const data=await adminApi(`/api/v1/admin/feedback?${params}`); state.feedbackCursor=data.nextCursor||''; state.feedback=append?[...state.feedback,...data.items]:data.items; renderFeedback(data,append); }

function logSummary(entry) { return entry.error?.message||entry.message||entry.detail||entry.code||entry.result?.totalFine||entry.step||'—'; }
function renderLogs(data) { $('#log-path').textContent=data.logDir; $('#log-path').title=`${data.logDir}\n${data.diagnosticsDir}`; $('#log-body').innerHTML=state.logs.map((entry,index)=>`<tr class="log-row" data-log-index="${index}" title="${t('点击查看该条日志的完整单行 JSON')}"><td class="mono">${escapeHtml(entry.localTimestamp||formatTime(entry.timestamp))}</td><td><span class="level ${escapeHtml(entry.level)}">${escapeHtml(String(entry.level||'').toUpperCase())}</span></td><td class="mono">${escapeHtml(entry.event)}</td><td class="mono">${escapeHtml(entry.traceId||'—')}</td><td class="mono">${escapeHtml(entry.plate||'—')}</td><td class="mono">${escapeHtml(entry.documentMasked||'—')}</td><td>${escapeHtml(logSummary(entry))}</td></tr>`).join('')||`<tr><td colspan="7" class="muted">${t('没有匹配的日志')}</td></tr>`; $('#log-summary').textContent=getLanguage()==='en'?`Showing ${state.logs.length}${data.hasMore?' · More available':' · All loaded'} · Updated ${formatTime(data.generatedAt)}`:`已显示 ${state.logs.length} 条${data.hasMore?' · 还有更多':' · 已全部加载'} · 更新时间 ${formatTime(data.generatedAt)}`; updatePager('#load-more-logs',data.hasMore,'加载更多日志'); document.querySelectorAll('.log-row').forEach(row=>row.addEventListener('click',()=>{$('#log-detail').textContent=JSON.stringify(state.logs[Number(row.dataset.logIndex)]);$('#log-dialog').showModal();})); }
async function loadLogs({append=false}={}) { if(!append)state.logCursor=''; const params=new URLSearchParams({q:$('#log-search').value.trim(),level:$('#log-level').value,event:$('#log-event').value.trim(),limit:'50'}); if(append&&state.logCursor)params.set('cursor',state.logCursor); const data=await adminApi(`/api/v1/admin/logs?${params}`); state.logCursor=data.nextCursor||''; state.logs=append?[...state.logs,...data.items]:data.items; renderLogs(data); }

function bindLogSearchButtons() { document.querySelectorAll('[data-search-log]').forEach(button=>button.addEventListener('click',event=>{event.stopPropagation();$('#log-search').value=button.dataset.searchLog;$('#log-event').value='';loadLogs();$('.logs-panel').scrollIntoView({behavior:'smooth',block:'start'});})); }
function bindQueryButtons() { document.querySelectorAll('[data-query-id]').forEach(button=>button.addEventListener('click',()=>showQuery(button.dataset.queryId))); }
function bindFeedbackButtons() { document.querySelectorAll('[data-feedback-id]').forEach(button=>button.addEventListener('click',()=>showFeedback(button.dataset.feedbackId))); }

async function showQuery(id) {
  const record=await adminApi(`/api/v1/admin/queries/${encodeURIComponent(id)}`), request=record.request||{};
  $('#query-detail').innerHTML=`<dl class="detail-grid"><dt>状态</dt><dd>${statusLabel(record.status)}</dd><dt>任务 / 追踪编号</dt><dd class="mono">${escapeHtml(record.id)}<br>${escapeHtml(record.traceId)}</dd><dt>车牌 / 完整证件</dt><dd class="mono">${escapeHtml(requestSummary(record))} · ${escapeHtml(request.documentNumber||'—')}</dd><dt>来源 / IP</dt><dd>${escapeHtml(record.source)} · <span class="mono">${escapeHtml(record.sourceIp||'—')}</span></dd><dt>IP 归属信息</dt><dd>${escapeHtml(geoText(record.geo))}<br><span class="muted">${t('时区')} ${escapeHtml(record.geo?.timezone||'—')}</span></dd><dt>设备标识</dt><dd class="mono">${escapeHtml(record.deviceId||'—')}</dd><dt>User-Agent</dt><dd>${escapeHtml(record.userAgent||'—')}</dd><dt>创建 / 完成</dt><dd>${formatTime(record.createdAt)} / ${formatTime(record.finishedAt)}</dd><dt>结果</dt><dd>${escapeHtml(queryResultText(record))}</dd><dt>官网原始提示</dt><dd dir="auto">${escapeHtml(record.error?.officialMessage||'—')}</dd></dl><div class="event-list">${record.events.map(event=>`<article><strong>${escapeHtml(event.step||event.event)}</strong><small>${formatTime(event.createdAt)} · ${event.progress??'—'}% · ${escapeHtml(event.details?.detail||'')}</small></article>`).join('')}</div>`; $('#query-dialog').showModal();
}
async function showFeedback(id) {
  const item=await adminApi(`/api/v1/admin/feedback/${encodeURIComponent(id)}`);
  for(const url of state.attachmentUrls) URL.revokeObjectURL(url); state.attachmentUrls=[];
  $('#feedback-detail').innerHTML=`<dl class="detail-grid"><dt>反馈编号</dt><dd class="mono">${escapeHtml(item.id)}</dd><dt>提交时间</dt><dd>${formatTime(item.createdAt)}</dd><dt>反馈内容</dt><dd class="preserve">${escapeHtml(item.content)}</dd><dt>附件</dt><dd><div id="feedback-attachments-view" class="attachment-grid"><span class="muted">${item.attachments?.length?t('正在加载…'):t('无附件')}</span></div></dd><dt>手机号</dt><dd>${escapeHtml(item.phone||'—')}</dd><dt>微信号</dt><dd>${escapeHtml(item.wechat||'—')}</dd><dt>设备标识</dt><dd class="mono">${escapeHtml(item.deviceId)}</dd><dt>来源 IP</dt><dd class="mono">${escapeHtml(item.sourceIp||'—')}</dd><dt>IP 归属信息</dt><dd>${escapeHtml(geoText(item.geo))}<br><span class="muted">${t('时区')} ${escapeHtml(item.geo?.timezone||'—')}</span></dd><dt>User-Agent</dt><dd>${escapeHtml(item.userAgent||'—')}</dd><dt>页面</dt><dd>${escapeHtml(item.pageUrl||'—')}</dd></dl><form id="feedback-update-form" class="feedback-update"><label>处理状态<select id="feedback-update-status"><option value="new">未读</option><option value="read">已读</option><option value="resolved">已处理</option><option value="archived">已归档</option></select></label><label>管理员备注<textarea id="feedback-admin-note" maxlength="2000" placeholder="记录处理结果或后续事项">${escapeHtml(item.adminNote||'')}</textarea></label><button type="submit">保存处理结果</button><p id="feedback-update-message" class="form-message hidden"></p></form>`;
  $('#feedback-dialog').showModal();
  if(item.attachments?.length) {
    const view=$('#feedback-attachments-view'); view.innerHTML='';
    for(const attachment of item.attachments) {
      try {
        const blob=await adminAttachment(`/api/v1/admin/feedback/${encodeURIComponent(item.id)}/attachments/${encodeURIComponent(attachment.id)}`);
        const objectUrl=URL.createObjectURL(blob); state.attachmentUrls.push(objectUrl);
        const preview=attachment.mime.startsWith('image/')?`<img src="${objectUrl}" alt="${escapeHtml(attachment.name)}">`:'<span class="attachment-file-icon">📄</span>';
        view.insertAdjacentHTML('beforeend',`<a class="attachment-card" href="${objectUrl}" download="${escapeHtml(attachment.name)}" target="_blank" rel="noopener">${preview}<strong data-no-i18n>${escapeHtml(attachment.name)}</strong><small>${Math.max(1,Math.ceil(attachment.size/1024))} KB · ${t('查看或下载')}</small></a>`);
      } catch(error) { view.insertAdjacentHTML('beforeend',`<p class="form-message">${escapeHtml(error.message)}</p>`); }
    }
  }
  $('#feedback-update-status').value=item.status; $('#feedback-update-form').addEventListener('submit',async event=>{event.preventDefault();const message=$('#feedback-update-message');try{await adminApi(`/api/v1/admin/feedback/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({status:$('#feedback-update-status').value,adminNote:$('#feedback-admin-note').value.trim()})});message.textContent=t('已保存');message.classList.remove('hidden');await Promise.all([loadFeedback(),loadOverview()]);}catch(error){message.textContent=localizeError(error);message.classList.remove('hidden');}});
}

function showLogin(auth) { $('#admin-content').classList.add('hidden'); $('#login-panel').classList.remove('hidden'); $('#login-hint').textContent=auth.passwordConfigured?t('请输入远程管理员密码。'):(getLanguage()==='en'?'No password is configured. Open Admin from the desktop GUI and select “Set password”.':'尚未设置密码。请先在桌面 GUI 的 Admin 页面点击“设置密码”。'); $('#login-password').disabled=!auth.passwordConfigured; $('#admin-live').className='live offline'; $('#admin-live').innerHTML=`<i></i>${t('需要登录')}`; }
async function enterAdmin(auth) { state.auth=auth; state.csrfToken=auth.csrfToken||''; $('#login-panel').classList.add('hidden'); $('#admin-content').classList.remove('hidden'); $('#password-button').classList.remove('hidden'); $('#logout-button').classList.toggle('hidden',auth.desktop); $('#current-password-field').classList.toggle('hidden',auth.desktop); await Promise.all([loadOverview(),loadQueries(),loadFeedback(),loadLogs(),loadServiceEvents(),loadCoreStatus()]); }
async function initialize() { try { const auth=await adminApi('/api/v1/admin/auth/status'); if(auth.authenticated) await enterAdmin(auth); else showLogin(auth); } catch(error) { showLogin({passwordConfigured:false}); $('#login-message').textContent=localizeError(error); $('#login-message').classList.remove('hidden'); } }

$('#login-form').addEventListener('submit',async event=>{event.preventDefault();const message=$('#login-message');message.classList.add('hidden');try{const result=await adminApi('/api/v1/admin/login',{method:'POST',body:JSON.stringify({password:$('#login-password').value})});await enterAdmin({authenticated:true,desktop:false,passwordConfigured:true,csrfToken:result.csrfToken});}catch(error){message.textContent=error.retryAfterMs?`${localizeError(error)} ${getLanguage()==='en'?`(about ${Math.ceil(error.retryAfterMs/1000)}s)`:`（约 ${Math.ceil(error.retryAfterMs/1000)} 秒）`}`:localizeError(error);message.classList.remove('hidden');}});
$('#logout-button').addEventListener('click',async()=>{await adminApi('/api/v1/admin/logout',{method:'POST',body:'{}'});state.csrfToken='';showLogin({passwordConfigured:true});});
$('#password-button').addEventListener('click',()=>{$('#password-message').classList.add('hidden');$('#password-form').reset();$('#password-dialog').showModal();});
$('#password-form').addEventListener('submit',async event=>{event.preventDefault();const message=$('#password-message'),next=$('#new-password').value;if(next!==$('#confirm-password').value){message.textContent=getLanguage()==='en'?'The new passwords do not match.':'两次输入的新密码不一致';message.classList.remove('hidden');return;}try{const result=await adminApi('/api/v1/admin/password',{method:'POST',body:JSON.stringify({currentPassword:$('#current-password').value,newPassword:next})});message.textContent=getLanguage()==='en'?'Password updated.':'密码已更新。';message.classList.remove('hidden');if(result.reloginRequired)setTimeout(()=>location.reload(),700);}catch(error){message.textContent=localizeError(error);message.classList.remove('hidden');}});
$('#back-main').addEventListener('click',()=>{location.href=token?`/#desktopToken=${encodeURIComponent(token)}`:'/';});
$('#refresh-overview').addEventListener('click',()=>Promise.all([loadOverview(),loadServiceEvents()])); $('#query-filter').addEventListener('submit',event=>{event.preventDefault();loadQueries();}); $('#load-more-queries').addEventListener('click',()=>loadQueries({append:true}));
$('#feedback-filter').addEventListener('submit',event=>{event.preventDefault();loadFeedback();}); $('#load-more-feedback').addEventListener('click',()=>loadFeedback({append:true}));
$('#check-core-update').addEventListener('click',()=>coreAction('check')); $('#install-core-update').addEventListener('click',()=>coreAction('update')); $('#rollback-core').addEventListener('click',()=>coreAction('rollback'));
$('#log-filter').addEventListener('submit',event=>{event.preventDefault();loadLogs();}); $('#load-more-logs').addEventListener('click',()=>loadLogs({append:true})); $('#load-more-service-events').addEventListener('click',()=>loadServiceEvents({append:true})); document.querySelectorAll('[data-event]').forEach(button=>button.addEventListener('click',()=>{$('#log-event').value=button.dataset.event;loadLogs();})); document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>document.getElementById(button.dataset.close).close()));
initializePreferences($('.header-actions'));
window.addEventListener('ppo:languagechange',()=>{ if(state.auth)Promise.all([loadOverview(),loadQueries(),loadFeedback(),loadLogs(),loadServiceEvents(),loadCoreStatus()]).then(()=>applyTranslations()).catch(()=>{}); else showLogin({passwordConfigured:!$('#login-password').disabled}); });
setInterval(()=>{if(state.auth&&!document.hidden)loadOverview().catch(()=>{});},10_000); initialize();
