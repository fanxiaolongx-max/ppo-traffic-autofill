/**
 * PPO Traffic History Viewer Logic
 * 埃及交通违章历史查询记录中心 - 数据管理、统计、检索、详情查看与导出
 */

const HISTORY_STORAGE_KEY = 'ppo_traffic_history_v1';
const TARGET_PPO_URL = "https://www.ppo.gov.eg/ppo/r/ppoportal/ppoportal/traffic";

let allRecords = [];
let filteredRecords = [];
let activeStatusFilter = 'all';
let activeSortOption = 'time_desc';
let activeSearchQuery = '';
let currentViewMode = 'table'; // 'table' | 'cards'
let currentDetailRecord = null;

document.addEventListener('DOMContentLoaded', () => {
  initDOM();
  bindEvents();
  loadHistoryFromStorage();
  listenStorageChanges();
});

function initDOM() {
  // 检查 URL 参数是否有 pre-search
  const params = new URLSearchParams(window.location.search);
  const q = params.get('q');
  if (q) {
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
      searchInput.value = q;
      activeSearchQuery = q.trim();
    }
  }
}

function bindEvents() {
  // 搜索框
  const searchInput = document.getElementById('search-input');
  const clearSearchBtn = document.getElementById('btn-clear-search');

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      activeSearchQuery = e.target.value.trim();
      clearSearchBtn.style.display = activeSearchQuery ? 'block' : 'none';
      applyFiltersAndRender();
    });
  }

  if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', () => {
      searchInput.value = '';
      activeSearchQuery = '';
      clearSearchBtn.style.display = 'none';
      applyFiltersAndRender();
    });
  }

  // 状态过滤药丸按钮
  const filterPills = document.querySelectorAll('#status-filters .filter-pill');
  filterPills.forEach(pill => {
    pill.addEventListener('click', () => {
      filterPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      activeStatusFilter = pill.dataset.status;
      applyFiltersAndRender();
    });
  });

  // 排序下拉
  const sortSelect = document.getElementById('sort-select');
  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      activeSortOption = e.target.value;
      applyFiltersAndRender();
    });
  }

  // 视图切换
  const btnTable = document.getElementById('btn-view-table');
  const btnCards = document.getElementById('btn-view-cards');
  const tableContainer = document.getElementById('history-table-container');
  const cardsContainer = document.getElementById('history-cards-container');

  if (btnTable && btnCards) {
    btnTable.addEventListener('click', () => {
      currentViewMode = 'table';
      btnTable.classList.add('active');
      btnCards.classList.remove('active');
      tableContainer.style.display = 'block';
      cardsContainer.style.display = 'none';
      renderView();
    });

    btnCards.addEventListener('click', () => {
      currentViewMode = 'cards';
      btnCards.classList.add('active');
      btnTable.classList.remove('active');
      tableContainer.style.display = 'none';
      cardsContainer.style.display = 'grid';
      renderView();
    });
  }

  // 顶部操作按钮
  document.getElementById('btn-open-portal')?.addEventListener('click', () => {
    chrome.tabs.create({ url: TARGET_PPO_URL, active: true });
  });

  document.getElementById('btn-empty-open-portal')?.addEventListener('click', () => {
    chrome.tabs.create({ url: TARGET_PPO_URL, active: true });
  });

  document.getElementById('btn-clear-all')?.addEventListener('click', handleClearAll);

  // 导出下拉菜单切换
  const exportBtn = document.getElementById('btn-export-menu');
  const exportDropdown = document.getElementById('export-dropdown');
  if (exportBtn && exportDropdown) {
    exportBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      exportDropdown.classList.toggle('show');
    });

    document.addEventListener('click', (e) => {
      if (!exportDropdown.contains(e.target) && e.target !== exportBtn) {
        exportDropdown.classList.remove('show');
      }
    });
  }

  // 导出功能
  document.getElementById('btn-export-json')?.addEventListener('click', (e) => {
    e.stopPropagation();
    exportDropdown?.classList.remove('show');
    exportAsJSON();
  });
  document.getElementById('btn-export-csv')?.addEventListener('click', (e) => {
    e.stopPropagation();
    exportDropdown?.classList.remove('show');
    exportAsCSV();
  });

  // 详情弹窗控制
  const modalOverlay = document.getElementById('detail-modal-overlay');
  document.getElementById('btn-modal-close')?.addEventListener('click', () => {
    modalOverlay.classList.remove('show');
    currentDetailRecord = null;
  });

  modalOverlay?.addEventListener('click', (e) => {
    if (e.target === modalOverlay) {
      modalOverlay.classList.remove('show');
      currentDetailRecord = null;
    }
  });

  // 详情弹窗内复制按钮
  document.getElementById('btn-copy-req-json')?.addEventListener('click', () => {
    const text = document.getElementById('modal-raw-req-json').textContent;
    copyTextToClipboard(text, 'btn-copy-req-json', '已复制 JSON');
  });

  document.getElementById('btn-copy-resp-text')?.addEventListener('click', () => {
    const text = document.getElementById('modal-raw-resp-text').textContent;
    copyTextToClipboard(text, 'btn-copy-resp-text', '已复制文本');
  });

  // 详情弹窗内操作按钮
  document.getElementById('btn-modal-refill-btn')?.addEventListener('click', () => {
    if (currentDetailRecord) {
      refillAndQueryRecord(currentDetailRecord);
    }
  });

  document.getElementById('btn-modal-delete-item')?.addEventListener('click', () => {
    if (currentDetailRecord) {
      deleteSingleRecord(currentDetailRecord.id);
      modalOverlay.classList.remove('show');
    }
  });
}

function loadHistoryFromStorage() {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get([HISTORY_STORAGE_KEY], (res) => {
      allRecords = res[HISTORY_STORAGE_KEY] || [];
      updateDashboardStats();
      applyFiltersAndRender();
    });
  }
}

function listenStorageChanges() {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[HISTORY_STORAGE_KEY]) {
        allRecords = changes[HISTORY_STORAGE_KEY].newValue || [];
        updateDashboardStats();
        applyFiltersAndRender();
      }
    });
  }
}

// 计算与更新统计数据
function updateDashboardStats() {
  const totalQueries = allRecords.length;
  let totalFinesSum = 0;
  let totalViolationsCount = 0;
  const uniquePlatesSet = new Set();

  let countWithFine = 0;
  let countClean = 0;
  let countError = 0;

  allRecords.forEach(rec => {
    // 提取数字并累加
    const fineText = rec.result?.totalFine || '';
    const numericFine = parseFloat(fineText.replace(/[^\d.]/g, '')) || 0;
    totalFinesSum += numericFine;

    const countText = rec.result?.violationCount || '0';
    const numericCount = parseInt(countText.replace(/[^\d]/g, ''), 10) || 0;
    totalViolationsCount += numericCount;

    // 统计车牌
    const plateStr = rec.request?.fullPlate || `${rec.request?.letter1 || ''}${rec.request?.letter2 || ''}${rec.request?.letter3 || ''}_${rec.request?.platenum || ''}`;
    if (plateStr) uniquePlatesSet.add(plateStr.trim());

    // 状态分类统计
    if (rec.status === 'error') {
      countError++;
    } else if (numericCount > 0 || numericFine > 0) {
      countWithFine++;
    } else {
      countClean++;
    }
  });

  // 更新 DOM
  document.getElementById('stat-total-queries').textContent = totalQueries.toLocaleString();
  document.getElementById('stat-total-fines').textContent = `${totalFinesSum.toLocaleString()} جنيه`;
  document.getElementById('stat-total-violations').textContent = `${totalViolationsCount.toLocaleString()} 笔`;
  document.getElementById('stat-unique-plates').textContent = uniquePlatesSet.size.toLocaleString();

  // 更新过滤按钮数字
  document.getElementById('count-all').textContent = totalQueries;
  document.getElementById('count-fine').textContent = countWithFine;
  document.getElementById('count-clean').textContent = countClean;
  document.getElementById('count-error').textContent = countError;
}

// 过滤与排序
function applyFiltersAndRender() {
  filteredRecords = allRecords.filter(rec => {
    // 1. 状态过滤
    const vCount = parseInt((rec.result?.violationCount || '0').replace(/[^\d]/g, ''), 10) || 0;
    const fineNum = parseFloat((rec.result?.totalFine || '0').replace(/[^\d.]/g, '')) || 0;

    if (activeStatusFilter === 'has_fine') {
      if (rec.status === 'error' || (vCount === 0 && fineNum === 0)) return false;
    } else if (activeStatusFilter === 'clean') {
      if (rec.status === 'error' || vCount > 0 || fineNum > 0) return false;
    } else if (activeStatusFilter === 'error') {
      if (rec.status !== 'error') return false;
    }

    // 2. 搜索框过滤
    if (activeSearchQuery) {
      const q = activeSearchQuery.toLowerCase();
      const matchPlate = (rec.request?.fullPlate || '').toLowerCase().includes(q) ||
                         (rec.request?.platenum || '').toLowerCase().includes(q) ||
                         (rec.request?.letter1 || '').includes(q) ||
                         (rec.request?.letter2 || '').includes(q) ||
                         (rec.request?.letter3 || '').includes(q);
      const matchPassport = (rec.request?.passportNo || '').toLowerCase().includes(q) ||
                            (rec.request?.nationalId || '').toLowerCase().includes(q);
      const matchCountry = (rec.request?.countryName || '').toLowerCase().includes(q);
      const matchDate = (rec.dateTime || '').toLowerCase().includes(q);
      const matchResult = (rec.result?.totalFine || '').toLowerCase().includes(q);

      if (!matchPlate && !matchPassport && !matchCountry && !matchDate && !matchResult) {
        return false;
      }
    }

    return true;
  });

  // 排序
  filteredRecords.sort((a, b) => {
    if (activeSortOption === 'time_desc') {
      return (b.timestamp || 0) - (a.timestamp || 0);
    } else if (activeSortOption === 'time_asc') {
      return (a.timestamp || 0) - (b.timestamp || 0);
    } else if (activeSortOption === 'fine_desc') {
      const fA = parseFloat((a.result?.totalFine || '0').replace(/[^\d.]/g, '')) || 0;
      const fB = parseFloat((b.result?.totalFine || '0').replace(/[^\d.]/g, '')) || 0;
      return fB - fA;
    } else if (activeSortOption === 'fine_asc') {
      const fA = parseFloat((a.result?.totalFine || '0').replace(/[^\d.]/g, '')) || 0;
      const fB = parseFloat((b.result?.totalFine || '0').replace(/[^\d.]/g, '')) || 0;
      return fA - fB;
    } else if (activeSortOption === 'count_desc') {
      const cA = parseInt((a.result?.violationCount || '0').replace(/[^\d]/g, ''), 10) || 0;
      const cB = parseInt((b.result?.violationCount || '0').replace(/[^\d]/g, ''), 10) || 0;
      return cB - cA;
    }
    return 0;
  });

  // 更新计数
  document.getElementById('visible-count').textContent = filteredRecords.length;
  document.getElementById('total-count').textContent = allRecords.length;

  renderView();
}

function renderView() {
  const emptyState = document.getElementById('history-empty-state');
  const tableContainer = document.getElementById('history-table-container');
  const cardsContainer = document.getElementById('history-cards-container');

  if (filteredRecords.length === 0) {
    emptyState.style.display = 'flex';
    tableContainer.style.display = 'none';
    cardsContainer.style.display = 'none';
    return;
  }

  emptyState.style.display = 'none';

  if (currentViewMode === 'table') {
    tableContainer.style.display = 'block';
    cardsContainer.style.display = 'none';
    renderTableView();
  } else {
    tableContainer.style.display = 'none';
    cardsContainer.style.display = 'grid';
    renderCardsView();
  }
}

function renderTableView() {
  const tbody = document.getElementById('history-table-body');
  if (!tbody) return;

  tbody.innerHTML = filteredRecords.map(rec => {
    const letters = [rec.request?.letter1, rec.request?.letter2, rec.request?.letter3].filter(Boolean).join(' ') || '-';
    const num = rec.request?.platenum || '-';
    const fineText = rec.result?.totalFine || '0 جنيه';
    const numericFine = parseFloat(fineText.replace(/[^\d.]/g, '')) || 0;
    const vCount = rec.result?.violationCount || '0';
    const reconcileText = rec.result?.reconcileFine || '0 جنيه';
    
    let statusHtml = '';
    if (rec.status === 'error') {
      statusHtml = '<span class="status-badge error">⚠️ 查询出错</span>';
    } else if (numericFine > 0 || parseInt(vCount, 10) > 0) {
      statusHtml = '<span class="status-badge has-fine">🚨 有罚款</span>';
    } else {
      statusHtml = '<span class="status-badge clean">✅ 无违章</span>';
    }

    const idLabel = rec.request?.ownerType === 'passport' 
      ? `护照: ${rec.request?.passportNo || '-'}` 
      : `埃及ID: ${rec.request?.nationalId || '-'}`;
    const countryLabel = rec.request?.countryName || (rec.request?.country === '10206' ? '中国' : rec.request?.country || '');

    return `
      <tr data-id="${rec.id}">
        <td style="font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--text-sub);">
          ${rec.dateTime || new Date(rec.timestamp).toLocaleString()}
        </td>
        <td>
          <div class="plate-badge-cell">
            <span class="arabic-letters-tag">${letters}</span>
            <span class="plate-num-tag">${num}</span>
          </div>
        </td>
        <td>
          <div class="owner-cell">
            <span class="owner-main">${idLabel}</span>
            <span class="owner-sub">${countryLabel}</span>
          </div>
        </td>
        <td style="text-align: center; font-weight: 700; color: ${parseInt(vCount, 10) > 0 ? '#f87171' : 'var(--text-muted)'};">
          ${vCount} 笔
        </td>
        <td class="fine-amount ${numericFine > 0 ? 'has-fine' : 'zero'}">
          ${fineText}
        </td>
        <td class="fine-amount" style="color: ${parseFloat(reconcileText) > 0 ? '#34d399' : 'var(--text-muted)'};">
          ${reconcileText}
        </td>
        <td style="text-align: center;">
          ${statusHtml}
        </td>
        <td>
          <div class="action-buttons">
            <button type="button" class="btn-table-action btn-inspect" data-id="${rec.id}" title="查看详细请求与抓取快照">详情</button>
            <button type="button" class="btn-table-action btn-table-fill btn-refill" data-id="${rec.id}" title="一键将该车辆数据填入官网并查询">填表</button>
            <button type="button" class="btn-table-action btn-table-del btn-del" data-id="${rec.id}" title="删除此条记录">✕</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  bindItemActions(tbody);
}

function renderCardsView() {
  const container = document.getElementById('history-cards-container');
  if (!container) return;

  container.innerHTML = filteredRecords.map(rec => {
    const letters = [rec.request?.letter1, rec.request?.letter2, rec.request?.letter3].filter(Boolean).join(' ') || '-';
    const num = rec.request?.platenum || '-';
    const fineText = rec.result?.totalFine || '0 جنيه';
    const numericFine = parseFloat(fineText.replace(/[^\d.]/g, '')) || 0;
    const vCount = rec.result?.violationCount || '0';
    const reconcileText = rec.result?.reconcileFine || '0 جنيه';

    let statusHtml = '';
    if (rec.status === 'error') {
      statusHtml = '<span class="status-badge error">⚠️ 官方出错</span>';
    } else if (numericFine > 0) {
      statusHtml = '<span class="status-badge has-fine">🚨 有罚款</span>';
    } else {
      statusHtml = '<span class="status-badge clean">✅ 无违章</span>';
    }

    const idLabel = rec.request?.ownerType === 'passport' 
      ? `护照: ${rec.request?.passportNo || '-'}` 
      : `ID: ${rec.request?.nationalId || '-'}`;

    return `
      <div class="history-card ${numericFine > 0 ? 'has-fine' : ''}" data-id="${rec.id}">
        <div class="history-card-header">
          <span class="card-time">${rec.dateTime || new Date(rec.timestamp).toLocaleString()}</span>
          ${statusHtml}
        </div>

        <div class="card-plate-box">
          <div class="plate-badge-cell">
            <span class="arabic-letters-tag">${letters}</span>
            <span class="plate-num-tag">${num}</span>
          </div>
          <span style="font-size: 12px; color: var(--text-muted);">${rec.request?.countryName || ''}</span>
        </div>

        <div style="font-size: 12px; color: var(--text-sub); font-family: 'JetBrains Mono', monospace;">
          ${idLabel}
        </div>

        <div class="card-fines-row">
          <div>
            <div style="font-size: 11px; color: var(--text-muted);">总罚款金额</div>
            <div style="font-size: 16px; font-weight: 700; color: ${numericFine > 0 ? '#fde047' : 'var(--text-muted)'}; font-family: 'JetBrains Mono';">
              ${fineText}
            </div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 11px; color: var(--text-muted);">违章笔数 / 和解</div>
            <div style="font-size: 13px; font-weight: 600; color: #cbd5e1;">
              ${vCount} 笔 (${reconcileText})
            </div>
          </div>
        </div>

        <div class="card-footer-actions">
          <button type="button" class="btn-table-action btn-inspect" data-id="${rec.id}">查看详情</button>
          <button type="button" class="btn-table-action btn-table-fill btn-refill" data-id="${rec.id}">一键填表</button>
          <button type="button" class="btn-table-action btn-table-del btn-del" data-id="${rec.id}">删除</button>
        </div>
      </div>
    `;
  }).join('');

  bindItemActions(container);
}

function bindItemActions(container) {
  // 详情按钮
  container.querySelectorAll('.btn-inspect').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const rec = allRecords.find(r => r.id === id);
      if (rec) openDetailModal(rec);
    });
  });

  // 填表按钮
  container.querySelectorAll('.btn-refill').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const rec = allRecords.find(r => r.id === id);
      if (rec) refillAndQueryRecord(rec);
    });
  });

  // 删除按钮
  container.querySelectorAll('.btn-del').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      deleteSingleRecord(id);
    });
  });
}

// 打开详情弹窗
function openDetailModal(rec) {
  currentDetailRecord = rec;
  const modal = document.getElementById('detail-modal-overlay');

  document.getElementById('modal-record-id').textContent = `ID: ${rec.id}`;

  // 结果横幅
  document.getElementById('modal-res-total').textContent = rec.result?.totalFine || '0 جنيه';
  document.getElementById('modal-res-count').textContent = `${rec.result?.violationCount || 0} 笔`;
  document.getElementById('modal-res-reconcile').textContent = rec.result?.reconcileFine || '0 جنيه';
  document.getElementById('modal-res-time').textContent = rec.dateTime || new Date(rec.timestamp).toLocaleString();

  // 结构化字段
  const letters = [rec.request?.letter1, rec.request?.letter2, rec.request?.letter3].filter(Boolean).join(' ') || '-';
  document.getElementById('modal-req-plate').textContent = rec.request?.fullPlate || `${letters} ${rec.request?.platenum || ''}`;
  document.getElementById('modal-req-letters').textContent = `${rec.request?.letter1 || ''} | ${rec.request?.letter2 || ''} | ${rec.request?.letter3 || ''}`;
  document.getElementById('modal-req-num').textContent = rec.request?.platenum || '-';
  document.getElementById('modal-req-owner-type').textContent = rec.request?.ownerType === 'passport' ? '护照 (Passport)' : '埃及身份证 (National ID)';
  document.getElementById('modal-req-id-num').textContent = rec.request?.passportNo || rec.request?.nationalId || '-';
  document.getElementById('modal-req-country').textContent = rec.request?.countryName || rec.request?.country || '-';
  document.getElementById('modal-req-numeral').textContent = rec.request?.numeralMode === 'arabic' ? '阿拉伯/埃及数字' : rec.request?.numeralMode === 'farsi' ? '波斯数字' : '原样数字 (0-9)';
  document.getElementById('modal-req-profile').textContent = rec.request?.profileName || '临时输入';

  // 原始请求与原始响应
  let rawReqText = rec.request?.rawRequestJson;
  if (!rawReqText) {
    rawReqText = JSON.stringify(rec.request || {}, null, 2);
  }
  document.getElementById('modal-raw-req-json').textContent = rawReqText;

  let rawRespText = rec.result?.rawResponseText;
  if (!rawRespText) {
    rawRespText = `[抓取结果结构]\n总罚款: ${rec.result?.totalFine || '0'}\n违章笔数: ${rec.result?.violationCount || '0'}\n和解罚款: ${rec.result?.reconcileFine || '0'}\n状态: ${rec.status || 'success'}`;
  }
  document.getElementById('modal-raw-resp-text').textContent = rawRespText;

  modal.classList.add('show');
}

// 一键再次填表
function refillAndQueryRecord(rec) {
  const req = rec.request;
  if (!req) return;

  const taskPayload = {
    data: {
      letter1: req.letter1 || '',
      letter2: req.letter2 || '',
      letter3: req.letter3 || '',
      platenum: req.platenum || '',
      numeralMode: req.numeralMode || 'latin',
      ownerType: req.ownerType || 'passport',
      foreignType: req.foreignType || 'foreign',
      country: req.country || '10206',
      passportNo: req.passportNo || '',
      nationalId: req.nationalId || ''
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
            if (chrome.runtime.lastError) {
              chrome.tabs.reload(ppoTab.id);
            }
          });
        });
      } else {
        chrome.tabs.create({ url: TARGET_PPO_URL, active: true });
      }
    });
  });
}

// 删除单条记录
function deleteSingleRecord(id) {
  if (!id) return;
  allRecords = allRecords.filter(r => r.id !== id);
  chrome.storage.local.set({ [HISTORY_STORAGE_KEY]: allRecords }, () => {
    updateDashboardStats();
    applyFiltersAndRender();
  });
}

// 清空全部记录
function handleClearAll() {
  if (allRecords.length === 0) {
    alert('当前没有任何历史记录需要清空。');
    return;
  }

  if (confirm(`⚠️ 确定要清空全部 ${allRecords.length} 条历史查询记录吗？此操作无法撤销。`)) {
    allRecords = [];
    chrome.storage.local.set({ [HISTORY_STORAGE_KEY]: [] }, () => {
      updateDashboardStats();
      applyFiltersAndRender();
    });
  }
}

// 导出为 JSON
function exportAsJSON() {
  if (allRecords.length === 0) {
    alert('暂无数据可导出');
    return;
  }

  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(allRecords, null, 2));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute("href", dataStr);
  const nowStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  downloadAnchor.setAttribute("download", `ppo_traffic_history_${nowStr}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
}

// 导出为 CSV
function exportAsCSV() {
  if (allRecords.length === 0) {
    alert('暂无数据可导出');
    return;
  }

  const headers = ['记录ID', '查询时间', '车牌字母', '车牌数字', '完整车牌', '证件类型', '护照/证件号', '国籍', '违章笔数', '总罚款金额', '和解金额', '查询状态'];
  const rows = allRecords.map(r => [
    `"${r.id || ''}"`,
    `"${r.dateTime || ''}"`,
    `"${[r.request?.letter1, r.request?.letter2, r.request?.letter3].filter(Boolean).join(' ')}"`,
    `"${r.request?.platenum || ''}"`,
    `"${r.request?.fullPlate || ''}"`,
    `"${r.request?.ownerType || ''}"`,
    `"${r.request?.passportNo || r.request?.nationalId || ''}"`,
    `"${r.request?.countryName || r.request?.country || ''}"`,
    `"${r.result?.violationCount || '0'}"`,
    `"${r.result?.totalFine || '0'}"`,
    `"${r.result?.reconcileFine || '0'}"`,
    `"${r.status || 'success'}"`
  ]);

  const csvContent = "\uFEFF" + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute('href', url);
  const nowStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  downloadAnchor.setAttribute('download', `ppo_traffic_history_${nowStr}.csv`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
}

function copyTextToClipboard(text, btnId, successText) {
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById(btnId);
    if (btn) {
      const original = btn.textContent;
      btn.textContent = `✅ ${successText}`;
      setTimeout(() => { btn.textContent = original; }, 1800);
    }
  }).catch(() => {
    alert('复制失败，请手动选取复制');
  });
}

// 常用车辆与人员配置库管理 (Profiles Manager)
const PROFILES_STORAGE_KEY = 'ppo_traffic_profiles_v2';
const PROFILES_LAST_ACTIVE = 'ppo_traffic_last_active_id';

function initProfilesManager() {
  const profilesModal = document.getElementById('profiles-modal-overlay');
  
  document.getElementById('btn-open-profiles-mgr')?.addEventListener('click', () => {
    loadAndRenderProfilesManager();
    profilesModal?.classList.add('show');
  });

  document.getElementById('btn-close-profiles-modal')?.addEventListener('click', () => {
    profilesModal?.classList.remove('show');
  });

  document.getElementById('btn-profiles-modal-done')?.addEventListener('click', () => {
    profilesModal?.classList.remove('show');
  });

  profilesModal?.addEventListener('click', (e) => {
    if (e.target === profilesModal) {
      profilesModal.classList.remove('show');
    }
  });

  // 导出配置备份
  document.getElementById('btn-export-profiles-json')?.addEventListener('click', exportProfilesBackup);

  // 导入配置备份
  document.getElementById('input-import-profiles')?.addEventListener('change', handleImportProfiles);
}

function loadAndRenderProfilesManager() {
  chrome.storage.local.get([PROFILES_STORAGE_KEY], (res) => {
    let list = res[PROFILES_STORAGE_KEY] || [];
    
    // 若 local 为空，从 sync 恢复
    if (list.length === 0 && typeof chrome.storage.sync !== 'undefined') {
      chrome.storage.sync.get([PROFILES_STORAGE_KEY], (syncRes) => {
        if (syncRes && syncRes[PROFILES_STORAGE_KEY] && syncRes[PROFILES_STORAGE_KEY].length > 0) {
          list = syncRes[PROFILES_STORAGE_KEY];
          chrome.storage.local.set({ [PROFILES_STORAGE_KEY]: list });
        }
        renderProfilesManagerUI(list);
      });
    } else {
      renderProfilesManagerUI(list);
    }
  });
}

function renderProfilesManagerUI(list) {
  const countEl = document.getElementById('profiles-mgr-count');
  const listEl = document.getElementById('profiles-mgr-list');
  if (countEl) countEl.textContent = list.length;
  if (!listEl) return;

  if (list.length === 0) {
    listEl.innerHTML = `
      <div style="text-align: center; padding: 40px 20px; color: var(--text-muted); font-size: 13px;">
        暂未保存任何常用人员配置。<br>可在扩展弹窗或网页悬浮窗中填写表单后点击「➕ 新增」保存！
      </div>
    `;
    return;
  }

  listEl.innerHTML = list.map(item => {
    const letters = [item.letter1, item.letter2, item.letter3].filter(Boolean).join(' ') || '-';
    const num = item.platenum || '-';
    const idVal = item.passportNo || item.nationalId || '未填证件';
    const isPassport = item.ownerType !== 'national_id';

    return `
      <div class="card-row" style="padding: 12px 16px; background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border-color); border-radius: 8px; display: flex; justify-content: space-between; align-items: center;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <span style="font-size: 20px;">👤</span>
          <div>
            <div style="font-weight: 700; color: #fff; font-size: 14px;">${item.remark || '未命名配置'}</div>
            <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">
              车牌: <strong style="color: var(--primary-gold);">${letters} ${num}</strong> · 
              ${isPassport ? '护照' : '身份证'}: <span>${idVal}</span>
            </div>
          </div>
        </div>
        <div style="display: flex; gap: 8px;">
          <button type="button" class="btn btn-primary btn-mgr-fill" data-id="${item.id}" style="padding: 4px 10px; font-size: 12px;">🚀 填表查询</button>
          <button type="button" class="btn btn-danger-outline btn-mgr-del" data-id="${item.id}" style="padding: 4px 10px; font-size: 12px;">🗑️ 删除</button>
        </div>
      </div>
    `;
  }).join('');

  // 绑定填表查询
  listEl.querySelectorAll('.btn-mgr-fill').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const target = list.find(p => p.id === id);
      if (target) {
        chrome.storage.local.set({
          pendingPpoTask: {
            data: target,
            autoSubmit: true,
            timestamp: Date.now()
          }
        }, () => {
          chrome.tabs.create({ url: TARGET_PPO_URL });
        });
      }
    });
  });

  // 绑定删除
  listEl.querySelectorAll('.btn-mgr-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const target = list.find(p => p.id === id);
      if (confirm(`确定要删除常用配置「${target?.remark || ''}」吗？`)) {
        const updated = list.filter(p => p.id !== id);
        chrome.storage.local.set({ [PROFILES_STORAGE_KEY]: updated }, () => {
          if (typeof chrome.storage.sync !== 'undefined') {
            try { chrome.storage.sync.set({ [PROFILES_STORAGE_KEY]: updated }, () => {}); } catch(e){}
          }
          renderProfilesManagerUI(updated);
        });
      }
    });
  });
}

function exportProfilesBackup() {
  chrome.storage.local.get([PROFILES_STORAGE_KEY], (res) => {
    const list = res[PROFILES_STORAGE_KEY] || [];
    if (list.length === 0) {
      alert('当前没有保存任何车辆配置，暂无数据可导出。');
      return;
    }

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(list, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    const nowStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    downloadAnchor.setAttribute("download", `ppo_profiles_backup_${nowStr}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  });
}

function handleImportProfiles(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const imported = JSON.parse(event.target.result);
      if (!Array.isArray(imported)) {
        alert('导入失败：文件格式不符合车辆配置规范');
        return;
      }

      chrome.storage.local.get([PROFILES_STORAGE_KEY], (res) => {
        let existing = res[PROFILES_STORAGE_KEY] || [];
        // 合并去重
        imported.forEach(item => {
          if (item && (item.platenum || item.passportNo || item.nationalId)) {
            const exists = existing.some(e => e.id === item.id || (e.remark === item.remark && e.platenum === item.platenum));
            if (!exists) {
              if (!item.id) item.id = Date.now() + Math.random().toString(36).substr(2, 4);
              existing.push(item);
            }
          }
        });

        chrome.storage.local.set({ [PROFILES_STORAGE_KEY]: existing }, () => {
          if (typeof chrome.storage.sync !== 'undefined') {
            try { chrome.storage.sync.set({ [PROFILES_STORAGE_KEY]: existing }, () => {}); } catch(e){}
          }
          renderProfilesManagerUI(existing);
          alert(`🎉 成功导入并恢复配置！当前配置总数: ${existing.length} 个`);
        });
      });
    } catch (err) {
      alert('解析备份文件失败: ' + err.message);
    }
  };
  reader.readAsText(file);
}

// 页面加载就绪后初始化配置管理器
document.addEventListener('DOMContentLoaded', () => {
  initProfilesManager();
});
