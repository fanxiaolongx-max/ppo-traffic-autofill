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

// 点击桌面通知直接打开历史记录大窗口
chrome.notifications?.onClicked?.addListener((notifId) => {
  chrome.tabs.create({ url: chrome.runtime.getURL('history.html') });
});

// 2. 官方服务器健康状态与响应速度探测引擎 (PPO Server Health Monitor)
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
      status: status, // 'operational' (绿) | 'degraded' (黄) | 'down' (红)
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
    // 保留最近 90 个探测点
    if (list.length > 90) {
      list = list.slice(list.length - 90);
    }
    chrome.storage.local.set({ [PROBES_STORAGE_KEY]: list });
  });
}

// 设置周期性后台探测 (每 3 分钟自动巡检一次)
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

// Service Worker 启动时立即探测一次
probePPOServerHealth();

function handleShowResultNotification(scraped, fullPlate) {
  if (!scraped) return;
  const count = parseInt(scraped.violationCount, 10) || 0;
  const totalFine = scraped.totalFine || '0 جنيه';

  // 1. 设置浏览器右上角插件图标角标 (Badge)
  try {
    chrome.action.setBadgeText({ text: count > 0 ? String(count) : '0' });
    chrome.action.setBadgeBackgroundColor({ color: count > 0 ? '#ef4444' : '#10b981' });
    chrome.action.setTitle({
      title: `PPO 最新查询结果: ${totalFine} (${count} 笔违章) - 车牌: ${fullPlate || '埃及车辆'}`
    });
  } catch (e) {}

  // 2. 弹出系统级桌面通知 (右上角即时弹出)
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
        if (chrome.runtime.lastError) {
          // ignore or log
        }
      });
    }
  } catch (e) {}
}

// 3. 监听标签页 URL 变化：智能抓取结果页数据并触发角标与通知
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  const currentUrl = tab.url || changeInfo.url || '';
  if (currentUrl.includes('traffic-fines-summary') || currentUrl.includes('traffic?clear=201')) {
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        // 提取页面卡片结果
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
        chrome.storage.local.set({ ppo_traffic_last_result: scraped });

        // 辅助记录到历史列表 (全链兜底 + 防重保护)
        chrome.storage.local.get([
          'ppo_traffic_history_v1',
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

          const platenum = req.platenum || '';
          const letters = [req.letter1, req.letter2, req.letter3].filter(Boolean).join(' ');
          const fullPlate = `${letters} ${platenum}`.trim() || '埃及车辆';
          const passportNo = req.passportNo || req.nationalId || '';

          // 触发角标与右上角通知
          handleShowResultNotification(scraped, fullPlate);

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
                profileName: req.remark || '网页即时查询',
                rawRequestJson: JSON.stringify(req, null, 2)
              },
              result: {
                totalFine: scraped.totalFine || '0 جنيه',
                violationCount: scraped.violationCount || '0',
                reconcileFine: scraped.reconcileFine || '0 جنيه',
                time: scraped.time || new Date().toLocaleTimeString(),
                rawResponseText: `[后台智能抓取]\n总罚款: ${scraped.totalFine}\n违章笔数: ${scraped.violationCount}\n和解金额: ${scraped.reconcileFine}`
              }
            };
            historyList.unshift(newRecord);
            chrome.storage.local.set({ ppo_traffic_history_v1: historyList.slice(0, 500) });
          }
        });
      }
    }).catch(() => {});
  }
});

// 4. 执行查询任务的核心调度逻辑
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
      country: queryData.country || '10206', // 默认中国
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
            // 如果发送不通且当前在其他子页面，平滑导航回主表单页
            if (chrome.runtime.lastError && ppoTab.url && !ppoTab.url.includes('/traffic')) {
              chrome.tabs.update(ppoTab.id, { url: TARGET_PPO_URL });
            }
          });
        });
      } else {
        // 无相关标签页，新建打开
        chrome.tabs.create({ url: TARGET_PPO_URL, active: true });
      }
    });
  });
}

function handleOpenAndFill(data, autoSubmit, sendResponse) {
  dispatchQueryTask(data);
  if (sendResponse) sendResponse({ success: true });
}
