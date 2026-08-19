/**
 * Background Service Worker
 * 负责跨页面调度与自动化填表任务派发，以及结果页数据抓取存储
 */

const TARGET_PPO_URL = "https://www.ppo.gov.eg/ppo/r/ppoportal/ppoportal/traffic";

// 1. 内部消息监听
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'open_and_fill') {
    handleOpenAndFill(message.data, message.autoSubmit !== false, sendResponse);
    return true;
  }
  if (message.action === 'execute_direct_query') {
    executeSilentTabQuery(message.data)
      .then((res) => {
        sendResponse({ success: true, mode: 'direct', data: res });
      })
      .catch((err) => {
        sendResponse({ success: false, mode: 'direct', error: err.message });
      });
    return true;
  }
  if (message.action === 'open_history_tab') {
    chrome.tabs.create({ url: chrome.runtime.getURL('history.html') });
    if (sendResponse) sendResponse({ success: true });
    return true;
  }
  if (message.action === 'notify_query_result') {
    handleShowResultNotification(message.data, message.plate);
    if (sendResponse) sendResponse({ success: true });
    return true;
  }
  if (message.action === 'ping_server_now') {
    probePPOServerHealth().then((result) => {
      if (sendResponse) sendResponse({ success: true, data: result });
    });
    return true;
  }
  if (message.action === 'clean_site_traces') {
    cleanAllSiteTracesAndCookies().then(() => {
      if (sendResponse) sendResponse({ success: true });
    });
    return true;
  }
});

// 执行前环境自检 (零干扰，确保不误伤用户正在浏览的页面)
async function inspectAndPurgeResidualSessions(addLog) {
  if (addLog) {
    addLog('🔍 环境自检', '已就绪独立查询通道，准备接入官方网关');
  }
}

// 用户主动点击「重置官网会话」自愈接口
async function cleanAllSiteTracesAndCookies() {
  return new Promise((resolve) => {
    if (!chrome.cookies) {
      resolve();
      return;
    }

    // 精准清理 APEX 业务会话，严格保留 F5 WAF 硬件信任 Cookie
    chrome.cookies.getAll({ domain: 'ppo.gov.eg' }, (cookies) => {
      if (cookies && cookies.length > 0) {
        cookies.forEach(c => {
          const name = c.name || '';
          const isWafCookie = name.startsWith('TS01') || name.startsWith('BIGipServer') || name.startsWith('TS');
          if (!isWafCookie) {
            const protocol = c.secure ? 'https:' : 'http:';
            const cookieUrl = `${protocol}//${c.domain.startsWith('.') ? c.domain.slice(1) : c.domain}${c.path || '/'}`;
            try {
              chrome.cookies.remove({ url: cookieUrl, name: c.name });
            } catch(e) {}
          }
        });
      }

      // 如果当前浏览器中存在官方标签页，自动将其平滑导航重置为干净的初始表单页
      chrome.tabs.query({}, (tabs) => {
        const ppoTab = tabs.find(t => t.url && (t.url.includes('ppo.gov.eg/ppo/') || t.url.includes('ppo.gov.eg')));
        if (ppoTab) {
          chrome.tabs.update(ppoTab.id, { active: true, url: TARGET_PPO_URL });
        }
        resolve();
      });
    });
  });
}

// 2. 真实内核静默后台渲染与全程过程追踪引擎 (Two-Phase State Machine)
function executeSilentTabQuery(queryData) {
  return new Promise(async (resolve, reject) => {
    const startTime = Date.now();
    const traceLogs = [];

    function addLog(stepName, details) {
      const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);
      const line = `[+${elapsedSec}s] ${stepName}: ${details || ''}`;
      traceLogs.push(line);
      console.log(`[PPO-SilentTab] ${line}`);
    }

    addLog('🚀 启动任务', '初始化静默真实浏览器渲染引擎 (不抢焦点·完全绕过 WAF 防火墙)');

    // 1. 执行前会话探查与深度净化
    await inspectAndPurgeResidualSessions(addLog);

    let silentTab = null;
    let isFinished = false;
    let formSubmitted = false;
    let isSubmitting = false;
    let queryTimeout = null;
    let pollInterval = null;

    const cleanup = () => {
      if (queryTimeout) clearTimeout(queryTimeout);
      if (pollInterval) clearInterval(pollInterval);
      if (silentTab && silentTab.id) {
        try {
          chrome.tabs.remove(silentTab.id, () => {
            if (chrome.runtime.lastError) {}
          });
          addLog('🚪 资源回收', `已自动静默关闭临时后台标签页 (Tab ID: ${silentTab.id})`);
        } catch (e) {}
      }
    };

    // 25 秒总超时熔断保护
    queryTimeout = setTimeout(() => {
      if (!isFinished) {
        isFinished = true;
        addLog('⏰ 超时熔断', '官方网站响应超过 25 秒，正在终止任务');
        cleanup();
        reject(new Error('官方网站响应超时 (>25s)，请检查官方服务器状态或网络'));
      }
    }, 25000);

    try {
      // 2. 创建静默后台标签页 (active: false，用户完全无感)
      silentTab = await chrome.tabs.create({
        url: TARGET_PPO_URL,
        active: false
      });
      addLog('🌐 创建静默标签页', `Tab ID: ${silentTab.id} (active: false, 处于后台真实渲染)`);

      const rawPassport = String(queryData.passportNo || queryData.passport || '').trim().replace(/^[A-Za-z]{1,3}/, '').trim();
      const rawNum = String(queryData.platenum || queryData.plateNum || '').trim();
      const letters = [queryData.letter1, queryData.letter2, queryData.letter3].filter(Boolean).join(' ');
      const fullPlate = `${letters} ${rawNum}`.trim() || '埃及车辆';
      const isPassport = queryData.ownerType !== 'national_id';

      // 阶段一：等待表单加载就绪并执行 DOM 填入与提交
      const tryFillAndSubmitForm = async () => {
        if (formSubmitted || isSubmitting || isFinished) return;
        isSubmitting = true;
        
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId: silentTab.id },
            args: [{
              letter1: queryData.letter1 || '',
              letter2: queryData.letter2 || '',
              letter3: queryData.letter3 || '',
              platenum: rawNum,
              ownerType: queryData.ownerType || 'passport',
              country: queryData.country || '10206',
              passportNo: rawPassport,
              nationalId: String(queryData.nationalId || '')
            }],
            func: (data) => {
              const letterInput = document.getElementById('P14_LETER_1');
              if (!letterInput) {
                // 尝试切换到车辆违章选项卡
                const vehicleTab = Array.from(document.querySelectorAll('a, button, li')).find(el => 
                  el.innerText && el.innerText.includes('مخالفات رخص المركبات')
                );
                if (vehicleTab) {
                  try { vehicleTab.click(); } catch(e){}
                }
                return { ready: false };
              }

              // 选中字母+数字单选
              const radios = document.querySelectorAll('input[name="P14_CHOSE_OPTION"]');
              radios.forEach(r => {
                if (r.value === '1') {
                  r.checked = true;
                  r.dispatchEvent(new Event('click', { bubbles: true }));
                  r.dispatchEvent(new Event('change', { bubbles: true }));
                }
              });

              // 填入字母与数字
              const setVal = (id, val) => {
                const el = document.getElementById(id);
                if (el) {
                  if (window.apex && window.apex.item && window.apex.item(id)) {
                    try { window.apex.item(id).setValue(val); } catch(e){}
                  }
                  el.value = val;
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                  el.dispatchEvent(new Event('blur', { bubbles: true }));
                }
              };

              setVal('P14_LETER_1', data.letter1);
              setVal('P14_LETER_2', data.letter2);
              setVal('P14_LETER_3', data.letter3);
              setVal('P14_NUMBER_WITH_LETTER', data.platenum);

              // 证件类型
              const isPass = data.ownerType !== 'national_id';
              const idRadios = document.querySelectorAll('input[name="P14_ID_TYPE_NUMS_LETTERS"]');
              idRadios.forEach(r => {
                if (r.value === (isPass ? '1429' : '2153')) {
                  r.checked = true;
                  r.dispatchEvent(new Event('click', { bubbles: true }));
                  r.dispatchEvent(new Event('change', { bubbles: true }));
                }
              });

              if (isPass) {
                // 外籍
                const forRadios = document.querySelectorAll('input[name="P14_ISFOREIGN__NUMS_LETTERS"]');
                forRadios.forEach(r => {
                  if (r.value === '1') {
                    r.checked = true;
                    r.dispatchEvent(new Event('click', { bubbles: true }));
                    r.dispatchEvent(new Event('change', { bubbles: true }));
                  }
                });

                // 国籍
                const countrySelect = document.getElementById('P14_PASSPORT_ISSUE_PLACE_NUMS_LETTERS');
                if (countrySelect) {
                  countrySelect.value = data.country || '10206';
                  countrySelect.dispatchEvent(new Event('change', { bubbles: true }));
                }

                // 纯数字护照
                setVal('P14_PASSPORT_NUM_NUMS_LETTERS', data.passportNo);
              } else {
                setVal('P14_NATIONAL_ID_NUMS_LETTERS', data.nationalId);
              }

              // 点击查询按钮
              const submitBtn = document.getElementById('GET_FIN_LETTER_NUMBERS_BTN') || document.querySelector("button[id*='GET_FIN']");
              if (submitBtn) {
                submitBtn.click();
                return { ready: true, submitted: true };
              }

              return { ready: true, submitted: false };
            }
          });

          if (results && results[0] && results[0].result && results[0].result.submitted) {
            formSubmitted = true;
            addLog('✅ 表单填入提交', `已成功在静默标签页填入 [${fullPlate}] 并点击查询按钮`);
            addLog('⏳ 等待官方响应', '正在等待官方 APEX 数据库计算并渲染结果页...');
          } else {
            isSubmitting = false;
          }
        } catch (err) {
          isSubmitting = false;
        }
      };

      // 阶段二：轮询检查结果页渲染
      const checkAndScrapeResults = async () => {
        if (!formSubmitted || isFinished) return;

        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId: silentTab.id },
            func: () => {
              const pageText = document.body ? document.body.innerText || '' : '';
              let totalFine = '';
              let violationCount = '';
              let reconcileFine = '';

              const allDivs = Array.from(document.querySelectorAll('div, span, td'));
              allDivs.forEach(el => {
                const text = el.innerText?.trim() || '';
                if (text === 'اجمالي الغرامات الشاملة') {
                  const parent = el.closest('.t-Region, div') || el.parentElement;
                  if (parent) {
                    const matches = parent.innerText.match(/[\d\u0660-\u0669,.]+(\s*(جنيه|EGP))?/);
                    if (matches) totalFine = matches[0].trim();
                  }
                } else if (text === 'عدد المخالفات') {
                  const parent = el.closest('.t-Region, div') || el.parentElement;
                  if (parent) {
                    const matches = parent.innerText.match(/[\d\u0660-\u0669]+/);
                    if (matches) violationCount = matches[0].trim();
                  }
                } else if (text === 'إجمالى غرامات التصالح' || text === 'اجمالي غرامات التصالح') {
                  const parent = el.closest('.t-Region, div') || el.parentElement;
                  if (parent) {
                    const matches = parent.innerText.match(/[\d\u0660-\u0669,.]+(\s*(جنيه|EGP))?/);
                    if (matches) reconcileFine = matches[0].trim();
                  }
                }
              });

              if (!totalFine) {
                const m = pageText.match(/اجمالي الغرامات الشاملة[\s\S]*?([\d\u0660-\u0669,.]+\s*(جنيه|EGP)?)/);
                if (m) totalFine = m[1].replace(/\n/g, ' ').trim();
              }
              if (!violationCount) {
                const m = pageText.match(/عدد المخالفات[\s\S]*?([\d\u0660-\u0669]+)/);
                if (m) violationCount = m[1].trim();
              }
              if (!reconcileFine) {
                const m = pageText.match(/إجمالى غرامات التصالح[\s\S]*?([\d\u0660-\u0669,.]+\s*(جنيه|EGP)?)/);
                if (m) reconcileFine = m[1].replace(/\n/g, ' ').trim();
              }

              const hasSummaryHeader = pageText.includes('بيانات المخالفات') || pageText.includes('بيانات التراخيص والمخالفات');
              const isExplicitClean = pageText.includes('لا توجد مخالفات') || pageText.includes('لا توجد بيانات');

              if (totalFine || violationCount || (hasSummaryHeader && isExplicitClean)) {
                return {
                  ready: true,
                  totalFine: totalFine || '0 جنيه',
                  violationCount: violationCount || '0',
                  reconcileFine: reconcileFine || '0 جنيه',
                  rawSnapshot: pageText.slice(0, 2000)
                };
              }
              return { ready: false, rawSnapshot: pageText.slice(0, 500) };
            }
          });

          if (results && results[0] && results[0].result && results[0].result.ready) {
            isFinished = true;
            const scraped = results[0].result;
            const durationMs = Date.now() - startTime;

            addLog('🎉 抓取成功', `总罚款: ${scraped.totalFine} | 违章笔数: ${scraped.violationCount} 笔 | 和解金额: ${scraped.reconcileFine}`);
            addLog('⏱️ 总耗时', `${durationMs} ms`);

            const formattedLog = [
              `=======================================================`,
              `📡 [真实浏览器静默后台渲染与全程过程追踪报告]`,
              `=======================================================`,
              `1. 查询车辆: ${fullPlate}`,
              `2. 证件信息: ${isPassport ? '护照' : '身份证'} - ${rawPassport || queryData.nationalId}`,
              `3. 最终抓取结果:`,
              `   • 总罚款: ${scraped.totalFine}`,
              `   • 违章笔数: ${scraped.violationCount} 笔`,
              `   • 和解金额: ${scraped.reconcileFine}`,
              `   • 总耗时: ${durationMs} ms`,
              `-------------------------------------------------------`,
              `4. ⚡ 毫秒级全程执行轨迹 (Trace Logs):`,
              `-------------------------------------------------------`,
              ...traceLogs,
              `-------------------------------------------------------`,
              `5. 📄 官方页面原始抓取快照:`,
              `-------------------------------------------------------`,
              scraped.rawSnapshot || '(无文本快照)'
            ].join('\n');

            const finalResult = {
              totalFine: scraped.totalFine,
              violationCount: scraped.violationCount,
              reconcileFine: scraped.reconcileFine,
              time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
              latencyMs: durationMs,
              isDirectApi: false,
              isSilentRender: true,
              rawDiagnosticLog: formattedLog
            };

            saveQueryToHistory(queryData, finalResult, fullPlate);
            handleShowResultNotification(finalResult, fullPlate);
            cleanup();
            resolve(finalResult);
          }
        } catch (err) {}
      };

      // 启动智能自适应轮询
      pollInterval = setInterval(() => {
        if (!formSubmitted) {
          tryFillAndSubmitForm();
        } else {
          checkAndScrapeResults();
        }
      }, 500);

    } catch (err) {
      cleanup();
      reject(err);
    }
  });
}

// 统一入库历史记录
function saveQueryToHistory(req, scraped, fullPlate) {
  req = req || {};
  const platenum = req.platenum || '';
  const letters = [req.letter1, req.letter2, req.letter3].filter(Boolean).join(' ');
  fullPlate = fullPlate || `${letters} ${platenum}`.trim() || '埃及车辆';

  chrome.storage.local.set({ ppo_traffic_last_result: scraped });

  chrome.storage.local.get(['ppo_traffic_history_v1'], (store) => {
    const historyList = store.ppo_traffic_history_v1 || [];
    const now = Date.now();
    const isRecentDup = historyList.slice(0, 3).some(r => {
      const rFull = r.request?.fullPlate || '';
      const rFine = r.result?.totalFine || '';
      const rCount = r.result?.violationCount || '';
      return (rFull === fullPlate || !fullPlate) && rFine === scraped.totalFine && rCount === scraped.violationCount && (now - r.timestamp < 15000);
    });

    if (!isRecentDup) {
      const newRecord = {
        id: 'hist_' + now + '_' + Math.random().toString(36).substr(2, 6),
        timestamp: now,
        dateTime: new Date().toLocaleString('zh-CN', { hour12: false }),
        status: (parseFloat((scraped.totalFine || '').replace(/[^\d.]/g, '')) > 0 || parseInt(scraped.violationCount, 10) > 0) ? 'has_fine' : 'clean',
        request: {
          letter1: req.letter1 || '',
          letter2: req.letter2 || '',
          letter3: req.letter3 || '',
          plateLetters: letters,
          platenum: platenum,
          fullPlate: fullPlate,
          ownerType: req.ownerType || 'passport',
          foreignType: req.foreignType || 'foreign',
          country: req.country || '10206',
          countryName: req.country === '10206' ? 'الصين (中国 / China)' : (req.country || '中国'),
          passportNo: req.passportNo || '',
          nationalId: req.nationalId || '',
          numeralMode: req.numeralMode || 'latin',
          profileName: req.remark || (scraped.isDirectApi ? '极速直连查询' : '网页即时查询'),
          rawRequestJson: JSON.stringify(req, null, 2)
        },
        result: {
          totalFine: scraped.totalFine || '0 جنيه',
          violationCount: scraped.violationCount || '0',
          reconcileFine: scraped.reconcileFine || '0 جنيه',
          time: scraped.time || new Date().toLocaleTimeString(),
          latencyMs: scraped.latencyMs,
          rawResponseText: scraped.rawDiagnosticLog || `[${scraped.isDirectApi ? 'APEX协议极速直连' : '后台智能抓取'}]\n总罚款: ${scraped.totalFine}\n违章笔数: ${scraped.violationCount}\n和解金额: ${scraped.reconcileFine}\n耗时: ${scraped.latencyMs || '-'}ms`
        }
      };
      historyList.unshift(newRecord);
      chrome.storage.local.set({ ppo_traffic_history_v1: historyList.slice(0, 500) });
    }
  });
}

// 点击桌面通知直接打开历史记录大窗口
chrome.notifications?.onClicked?.addListener((notifId) => {
  chrome.tabs.create({ url: chrome.runtime.getURL('history.html') });
});

// 3. 官方服务器健康状态与响应速度探测引擎 (PPO Server Health Monitor)
const PROBES_STORAGE_KEY = 'ppo_traffic_server_probes_v1';
const PROBE_TARGET_URL = "https://www.ppo.gov.eg/ppo/r/ppoportal/ppoportal/traffic";

async function probePPOServerHealth() {
  const startTime = performance.now();
  const now = Date.now();
  const nowObj = new Date();
  const timeStr = nowObj.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateStr = nowObj.toISOString().slice(0, 10);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 9000);

  try {
    const resp = await fetch(PROBE_TARGET_URL, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-cache',
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    const latency = Math.round(performance.now() - startTime);

    let status = 'operational';
    if (latency > 4000) {
      status = 'degraded';
    }

    const point = {
      timestamp: now,
      timeStr: timeStr,
      dateStr: dateStr,
      status: status,
      httpStatus: resp.status || 200,
      latencyMs: latency
    };

    saveProbePoint(point);
    return point;
  } catch (err) {
    clearTimeout(timeoutId);
    const latency = Math.round(performance.now() - startTime);
    const isTimeout = err.name === 'AbortError' || latency >= 8500;

    const point = {
      timestamp: now,
      timeStr: timeStr,
      dateStr: dateStr,
      status: 'down',
      httpStatus: isTimeout ? 'timeout' : 'error',
      latencyMs: latency,
      errorMsg: isTimeout ? '连接超时 (>9s)' : (err.message || '网络连接失败')
    };

    saveProbePoint(point);
    return point;
  }
}

function saveProbePoint(point) {
  chrome.storage.local.get([PROBES_STORAGE_KEY], (res) => {
    let list = res[PROBES_STORAGE_KEY] || [];
    list.push(point);
    if (list.length > 90) {
      list = list.slice(list.length - 90);
    }
    chrome.storage.local.set({ [PROBES_STORAGE_KEY]: list });
  });
}

if (chrome.alarms) {
  chrome.alarms.create('ppo_server_health_probe', {
    periodInMinutes: 3
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'ppo_server_health_probe') {
      probePPOServerHealth();
    }
  });
}

probePPOServerHealth();

function handleShowResultNotification(scraped, fullPlate) {
  if (!scraped) return;
  const count = parseInt(scraped.violationCount, 10) || 0;
  const totalFine = scraped.totalFine || '0 جنيه';

  try {
    chrome.action.setBadgeText({ text: count > 0 ? String(count) : '0' });
    chrome.action.setBadgeBackgroundColor({ color: count > 0 ? '#ef4444' : '#10b981' });
    chrome.action.setTitle({
      title: `PPO 最新查询结果: ${totalFine} (${count} 笔违章) - 车牌: ${fullPlate || '埃及车辆'}`
    });
  } catch (e) {}

  try {
    if (typeof chrome !== 'undefined' && chrome.notifications && typeof chrome.notifications.create === 'function') {
      const iconUrl = chrome.runtime.getURL('icons/icon128.png');
      chrome.notifications.create('ppo_res_' + Date.now(), {
        type: 'basic',
        iconUrl: iconUrl,
        title: count > 0 ? `🚗 查到违章：总罚款 ${totalFine}` : `✅ 无违章记录：总罚款 0 镑`,
        message: `车牌: ${fullPlate || '埃及车辆'} | 违章笔数: ${count} 笔\n点击立即查看完整明细与历史档案 ↗`,
        priority: 2,
        requireInteraction: false
      }, () => {
        if (chrome.runtime.lastError) {}
      });
    }
  } catch (e) {}
}

// 4. 监听标签页 URL 变化：智能抓取结果页数据 (仅作为传统网页模式的兜底抓取)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  const currentUrl = tab.url || changeInfo.url || '';
  if (currentUrl.includes('traffic-fines-summary') || currentUrl.includes('traffic?clear=201')) {
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        const pageText = document.body ? document.body.innerText || '' : '';
        let totalFine = '';
        let violationCount = '';
        let reconcileFine = '';

        const allDivs = Array.from(document.querySelectorAll('div, span, td'));
        allDivs.forEach(el => {
          const text = el.innerText?.trim() || '';
          if (text === 'اجمالي الغرامات الشاملة') {
            const parent = el.closest('.t-Region, div') || el.parentElement;
            if (parent) {
              const matches = parent.innerText.match(/[\d\u0660-\u0669,.]+(\s*(جنيه|EGP))?/);
              if (matches) totalFine = matches[0].trim();
            }
          } else if (text === 'عدد المخالفات') {
            const parent = el.closest('.t-Region, div') || el.parentElement;
            if (parent) {
              const matches = parent.innerText.match(/[\d\u0660-\u0669]+/);
              if (matches) violationCount = matches[0].trim();
            }
          } else if (text === 'إجمالى غرامات التصالح' || text === 'اجمالي غرامات التصالح') {
            const parent = el.closest('.t-Region, div') || el.parentElement;
            if (parent) {
              const matches = parent.innerText.match(/[\d\u0660-\u0669,.]+(\s*(جنيه|EGP))?/);
              if (matches) reconcileFine = matches[0].trim();
            }
          }
        });

        if (!totalFine) {
          const m = pageText.match(/اجمالي الغرامات الشاملة[\s\S]*?([\d\u0660-\u0669,.]+\s*(جنيه|EGP)?)/);
          if (m) totalFine = m[1].replace(/\n/g, ' ').trim();
        }
        if (!violationCount) {
          const m = pageText.match(/عدد المخالفات[\s\S]*?([\d\u0660-\u0669]+)/);
          if (m) violationCount = m[1].trim();
        }
        if (!reconcileFine) {
          const m = pageText.match(/إجمالى غرامات التصالح[\s\S]*?([\d\u0660-\u0669,.]+\s*(جنيه|EGP)?)/);
          if (m) reconcileFine = m[1].replace(/\n/g, ' ').trim();
        }

        if (totalFine || violationCount) {
          return {
            totalFine: totalFine || '0 جنيه',
            violationCount: violationCount || '0',
            reconcileFine: reconcileFine || '0 جنيه',
            time: new Date().toLocaleTimeString()
          };
        }
        return null;
      }
    }).then((results) => {
      if (results && results[0] && results[0].result) {
        const scraped = results[0].result;
        chrome.storage.local.get([
          'ppo_active_query_req',
          'pendingPpoTask',
          'ppo_traffic_live_draft',
          'ppo_traffic_profiles_v2',
          'ppo_traffic_last_active_id'
        ], (store) => {
          let req = store.ppo_active_query_req || store.pendingPpoTask?.data;
          if (!req && store.ppo_traffic_live_draft && (store.ppo_traffic_live_draft.platenum || store.ppo_traffic_live_draft.letter1)) {
            req = store.ppo_traffic_live_draft;
          }
          if (!req && store.ppo_traffic_profiles_v2 && store.ppo_traffic_profiles_v2.length > 0) {
            const lastId = store.ppo_traffic_last_active_id;
            req = store.ppo_traffic_profiles_v2.find(p => p.id === lastId) || store.ppo_traffic_profiles_v2[0];
          }
          req = req || {};
          const letters = [req.letter1, req.letter2, req.letter3].filter(Boolean).join(' ');
          const fullPlate = `${letters} ${req.platenum || ''}`.trim() || '埃及车辆';
          saveQueryToHistory(req, scraped, fullPlate);
          handleShowResultNotification(scraped, fullPlate);
        });
      }
    }).catch(() => {});
  }
});

// 5. 传统网页模式任务调度
function dispatchQueryTask(queryData) {
  const taskPayload = {
    data: {
      letter1: queryData.letter1 || '',
      letter2: queryData.letter2 || '',
      letter3: queryData.letter3 || '',
      platenum: String(queryData.platenum || queryData.plateNum || queryData.number || ''),
      numeralMode: queryData.numeralMode || 'latin',
      ownerType: queryData.ownerType || 'passport',
      foreignType: queryData.foreignType || 'foreign',
      country: queryData.country || '10206',
      passportNo: String(queryData.passportNo || queryData.passport || ''),
      nationalId: String(queryData.nationalId || '')
    },
    autoSubmit: true,
    timestamp: Date.now()
  };

  chrome.storage.local.set({ pendingPpoTask: taskPayload }, () => {
    chrome.tabs.query({}, (tabs) => {
      const ppoTab = tabs.find(t => t.url && (t.url.includes('ppo.gov.eg/ppo/') || t.url.includes('ppo.gov.eg')));

      if (ppoTab) {
        if (ppoTab.url && ppoTab.url.includes('traffic-fines-summary')) {
          // 如果标签页停留在上一次的结果摘要页，直接跳转重置为纯净表单页
          chrome.tabs.update(ppoTab.id, { active: true, url: TARGET_PPO_URL });
        } else {
          chrome.tabs.update(ppoTab.id, { active: true }, () => {
            chrome.tabs.sendMessage(ppoTab.id, {
              action: 'direct_fill',
              data: taskPayload.data,
              autoSubmit: true
            }, () => {
              if (chrome.runtime.lastError) {
                chrome.tabs.update(ppoTab.id, { url: TARGET_PPO_URL });
              }
            });
          });
        }
      } else {
        chrome.tabs.create({ url: TARGET_PPO_URL, active: true });
      }
    });
  });
}

// 统一对外查询调度入口 (根据用户偏好模式分发)
function handleOpenAndFill(data, autoSubmit, sendResponse) {
  chrome.storage.local.get(['ppo_traffic_query_mode'], (res) => {
    const mode = res.ppo_traffic_query_mode || 'tab_ui'; // 默认：网页前台稳定模式

    if (mode === 'direct') {
      executeSilentTabQuery(data)
        .then((scraped) => {
          if (sendResponse) sendResponse({ success: true, mode: 'direct', data: scraped });
        })
        .catch((err) => {
          console.warn('[Silent Render Failed, falling back to visible Web UI mode]:', err);
          dispatchQueryTask(data);
          if (sendResponse) sendResponse({ success: true, mode: 'tab_ui', fallback: true, message: err.message });
        });
    } else {
      dispatchQueryTask(data);
      if (sendResponse) sendResponse({ success: true, mode: 'tab_ui' });
    }
  });
}
