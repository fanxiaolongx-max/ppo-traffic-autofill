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

// 全面清理该站点的 Cookie、Session 和本地缓存痕迹 (清除 APEX 历史会话死锁)
async function cleanAllSiteTracesAndCookies() {
  try {
    if (chrome.cookies) {
      const domains = ['.ppo.gov.eg', 'www.ppo.gov.eg', 'ppo.gov.eg'];
      for (const domain of domains) {
        const cookies = await chrome.cookies.getAll({ domain });
        for (const cookie of cookies) {
          const protocol = cookie.secure ? "https:" : "http:";
          const cookieUrl = `${protocol}//${cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain}${cookie.path}`;
          await chrome.cookies.remove({ url: cookieUrl, name: cookie.name }).catch(() => {});
        }
      }
    }
  } catch (e) {}

  try {
    if (chrome.browsingData) {
      await chrome.browsingData.remove({
        origins: [
          "https://www.ppo.gov.eg",
          "https://ppo.gov.eg"
        ]
      }, {
        cache: true,
        cookies: true,
        localStorage: true,
        serviceWorkers: true
      }).catch(() => {});
    }
  } catch (e) {}
}

// 2. 真实内核静默后台渲染与全程过程追踪引擎 (Silent Background Browser Engine)
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

    // 1. 先快速抹除旧会话 Cookie，确保拿到最新状态
    await cleanAllSiteTracesAndCookies();
    addLog('🧹 会话净化', '已清除本地残留 Cookie 痕迹，重置干净环境');

    let silentTab = null;
    let isFinished = false;
    let queryTimeout = null;

    const cleanup = () => {
      if (queryTimeout) clearTimeout(queryTimeout);
      if (silentTab && silentTab.id) {
        try {
          chrome.tabs.remove(silentTab.id, () => {
            if (chrome.runtime.lastError) {}
          });
          addLog('🚪 资源回收', `已自动静默关闭临时后台标签页 (Tab ID: ${silentTab.id})`);
        } catch (e) {}
      }
    };

    // 设置 25 秒总超时熔断保护
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
        url: `${TARGET_PPO_URL}?clear=201,14,RP`,
        active: false
      });
      addLog('🌐 创建静默标签页', `Tab ID: ${silentTab.id} (active: false, 处于后台真实渲染)`);

      const rawPassport = String(queryData.passportNo || queryData.passport || '').trim().replace(/^[A-Za-z]{1,3}/, '').trim();
      const rawNum = String(queryData.platenum || queryData.plateNum || '').trim();
      const letters = [queryData.letter1, queryData.letter2, queryData.letter3].filter(Boolean).join(' ');
      const fullPlate = `${letters} ${rawNum}`.trim() || '埃及车辆';
      const isPassport = queryData.ownerType !== 'national_id';

      // 3. 监听标签页更新与结果抓取
      const onTabUpdatedListener = (tabId, changeInfo, tab) => {
        if (tabId !== silentTab.id) return;

        if (changeInfo.status === 'complete') {
          const currentUrl = tab.url || '';
          addLog('📄 页面加载完成', `当前 URL: ${currentUrl}`);

          // 如果在结果页
          if (currentUrl.includes('traffic-fines-summary') || currentUrl.includes('traffic?clear=201')) {
            addLog('🎯 进入结果页', '官方 WAF 放行并成功返回结果页，正在提取罚款数据...');
            
            setTimeout(() => {
              chrome.scripting.executeScript({
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

                  return {
                    totalFine: totalFine || '0 جنيه',
                    violationCount: violationCount || '0',
                    reconcileFine: reconcileFine || '0 جنيه',
                    rawSnapshot: pageText.slice(0, 2000)
                  };
                }
              }).then((results) => {
                if (isFinished) return;
                isFinished = true;
                chrome.tabs.onUpdated.removeListener(onTabUpdatedListener);

                const scraped = (results && results[0] && results[0].result) || {
                  totalFine: '0 جنيه',
                  violationCount: '0',
                  reconcileFine: '0 جنيه',
                  rawSnapshot: ''
                };

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
              }).catch((e) => {
                if (!isFinished) {
                  isFinished = true;
                  chrome.tabs.onUpdated.removeListener(onTabUpdatedListener);
                  cleanup();
                  reject(e);
                }
              });
            }, 600);
          } else if (currentUrl.includes('/traffic')) {
            // 表单页面加载完成，派发自动填表
            addLog('📝 表单页面就绪', '正在向静默标签页发送自动填表与提交指令...');
            setTimeout(() => {
              chrome.tabs.sendMessage(silentTab.id, {
                action: 'direct_fill',
                data: {
                  letter1: queryData.letter1 || '',
                  letter2: queryData.letter2 || '',
                  letter3: queryData.letter3 || '',
                  platenum: rawNum,
                  numeralMode: queryData.numeralMode || 'latin',
                  ownerType: queryData.ownerType || 'passport',
                  foreignType: queryData.foreignType || 'foreign',
                  country: queryData.country || '10206',
                  passportNo: rawPassport,
                  nationalId: String(queryData.nationalId || '')
                },
                autoSubmit: true
              }, (resp) => {
                if (chrome.runtime.lastError) {
                  addLog('⚠️ 填表握手', '等待 Content Script 自动巡检执行');
                } else {
                  addLog('✅ 表单填入提交', '已成功在静默标签页完成 DOM 填入并触发官方查询');
                }
              });
            }, 800);
          }
        }
      };

      chrome.tabs.onUpdated.addListener(onTabUpdatedListener);

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
        chrome.tabs.update(ppoTab.id, { active: true }, () => {
          chrome.tabs.sendMessage(ppoTab.id, {
            action: 'direct_fill',
            data: taskPayload.data,
            autoSubmit: true
          }, () => {
            if (chrome.runtime.lastError && ppoTab.url && !ppoTab.url.includes('/traffic')) {
              chrome.tabs.update(ppoTab.id, { url: TARGET_PPO_URL });
            }
          });
        });
      } else {
        chrome.tabs.create({ url: TARGET_PPO_URL, active: true });
      }
    });
  });
}

// 统一对外查询调度入口 (根据用户偏好模式分发)
function handleOpenAndFill(data, autoSubmit, sendResponse) {
  chrome.storage.local.get(['ppo_traffic_query_mode'], (res) => {
    const mode = res.ppo_traffic_query_mode || 'direct'; // 默认新逻辑：极速静默真实渲染

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
