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
});

// 2. 监听标签页 URL 变化：一旦检测到进入 traffic-fines-summary 结果页，立即执行 window.stop() 截停转圈并强行提取
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const currentUrl = changeInfo.url || tab.url || '';
  if (currentUrl.includes('traffic-fines-summary') || currentUrl.includes('traffic?clear=201')) {
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        try {
          window.stop(); // 立即停止浏览器标签转圈
        } catch (e) {}

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
      }
    }).catch(() => {});
  }
});

// 3. 执行查询任务的核心调度逻辑
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
    // 兼容所有 ppo.gov.eg 域名（含 www 与非 www）
    chrome.tabs.query({}, (tabs) => {
      const ppoTab = tabs.find(t => t.url && (t.url.includes('ppo.gov.eg/ppo/') || t.url.includes('ppo.gov.eg')));

      if (ppoTab) {
        chrome.tabs.update(ppoTab.id, { active: true }, () => {
          // 尝试直接发送消息填表
          chrome.tabs.sendMessage(ppoTab.id, {
            action: 'direct_fill',
            data: taskPayload.data,
            autoSubmit: true
          }, () => {
            // 若该标签页在插件刷新前就打开过导致未注入脚本，自动刷新以载入自动填表任务
            if (chrome.runtime.lastError) {
              console.log("标签页脚本未就绪，正在刷新标签页以载入自动填表任务...");
              chrome.tabs.reload(ppoTab.id);
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
