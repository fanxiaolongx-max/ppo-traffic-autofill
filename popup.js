/**
 * PPO Traffic AutoFill - Popup Script
 * 支持在任意页面点击图标唤起、跨页面自动跳转填表与查询
 */

const TARGET_PPO_URL = "https://www.ppo.gov.eg/ppo/r/ppoportal/ppoportal/traffic";

const COUNTRY_OPTIONS = [
  { value: "10206", text: "الصين (中国 / China)" },
  { value: "2131", text: "السعودية (沙特阿拉伯)" },
  { value: "2132", text: "الإمارات (阿联酋)" },
  { value: "2133", text: "الأردن (约旦)" },
  { value: "2134", text: "الكويت (科威特)" },
  { value: "2135", text: "سوريا (叙利亚)" },
  { value: "2136", text: "لبنان (黎巴嫩)" },
  { value: "2141", text: "اليمن (也门)" },
  { value: "2142", text: "ليبيا (利比亚)" },
  { value: "2146", text: "السودان (苏丹)" },
  { value: "2148", text: "الولايات المتحدة الامريكية (美国)" },
  { value: "2152", text: "بريطانيا (英国)" },
  { value: "2150", text: "المانيا (德国)" },
  { value: "2149", text: "فرنسا (法国)" },
  { value: "2151", text: "ايطاليا (意大利)" },
  { value: "10202", text: "كندا (加拿大)" },
  { value: "10253", text: "اليابان (日本)" },
  { value: "10508", text: "كوريا الجنوبية (韩国)" },
  { value: "10274", text: "ماليزيا (马来西亚)" },
  { value: "10503", text: "سنغافورة (新加坡)" },
  { value: "10309", text: "قطر (卡塔尔)" },
  { value: "10183", text: "البحرين (巴林)" },
  { value: "10515", text: "سلطنة عمان (阿曼)" },
  { value: "10405", text: "روسيا (俄罗斯)" },
  { value: "10247", text: "الهند (印度)" },
  { value: "10300", text: "باكستان (巴基斯坦)" }
];

const COMMON_LETTERS = [
  'أ', 'ب', 'ج', 'د', 'ر', 'س', 'ص', 'ط',
  'ع', 'ف', 'ق', 'ك', 'ل', 'م', 'ن', 'هـ', 'و', 'ي'
];

let activeLetterTarget = 'letter1';
let numeralMode = 'latin';
let currentProfileId = null;

const STORAGE_KEY = 'ppo_traffic_profiles_v2';
const LAST_ACTIVE_KEY = 'ppo_traffic_last_active_id';

document.addEventListener('DOMContentLoaded', () => {
  initDOM();
  bindEvents();
  loadProfilesFromStorage();
  initPopupServerHealth();
});

function initDOM() {
  // 初始化国籍下拉菜单 (中国 10206 默认高亮置顶)
  const countrySelect = document.getElementById('ppo-in-country');
  if (countrySelect) {
    countrySelect.innerHTML = COUNTRY_OPTIONS.map(c => 
      `<option value="${c.value}" ${c.value === '10206' ? 'selected' : ''}>${c.text}</option>`
    ).join('');
  }

  // 初始化快捷字母面板
  const palette = document.getElementById('ppo-letter-palette');
  if (palette) {
    palette.innerHTML = COMMON_LETTERS.map(char => 
      `<button type="button" class="ppo-letter-btn" data-char="${char}">${char}</button>`
    ).join('');
  }

  updatePreview();
}

function setActiveLetterFocus(target) {
  activeLetterTarget = target;
  ['letter1', 'letter2', 'letter3'].forEach(name => {
    const input = document.getElementById(`ppo-in-${name}`);
    if (input) {
      input.classList.toggle('active-focus', name === target);
    }
  });
}

function cleanPassportNumber(str) {
  if (!str) return '';
  return str.trim().replace(/^[A-Za-z]{1,3}/, '').trim();
}

function bindEvents() {
  // 顶部历史记录大窗口按钮
  document.getElementById('ppo-btn-open-history')?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('history.html') });
  });

  // 顶部打开网页按钮
  document.getElementById('ppo-btn-open-portal')?.addEventListener('click', () => {
    chrome.tabs.create({ url: TARGET_PPO_URL });
  });

  // 多配置切换与保存
  const profileDropdown = document.getElementById('ppo-profile-dropdown');
  profileDropdown?.addEventListener('change', () => {
    applyProfile(profileDropdown.value);
  });

  document.getElementById('ppo-btn-update-profile')?.addEventListener('click', () => {
    updateCurrentProfile();
  });

  const saveExpander = document.getElementById('ppo-save-expander');
  document.getElementById('ppo-btn-toggle-save')?.addEventListener('click', () => {
    saveExpander.classList.toggle('show');
    if (saveExpander.classList.contains('show')) {
      const pNum = document.getElementById('ppo-in-platenum')?.value || '';
      const pPass = document.getElementById('ppo-in-passport-no')?.value || '';
      const defaultRemark = pNum || pPass ? `${pPass ? pPass + ' ' : ''}${pNum ? '(' + pNum + ')' : ''}` : '';
      const remarkInput = document.getElementById('ppo-in-remark');
      if (remarkInput && !remarkInput.value) {
        remarkInput.value = defaultRemark;
      }
      remarkInput?.focus();
    }
  });

  document.getElementById('ppo-btn-cancel-save')?.addEventListener('click', () => {
    saveExpander.classList.remove('show');
  });

  document.getElementById('ppo-btn-confirm-save')?.addEventListener('click', () => {
    const remark = document.getElementById('ppo-in-remark')?.value.trim();
    saveNewProfile(remark);
    saveExpander.classList.remove('show');
  });

  document.getElementById('ppo-btn-delete-profile')?.addEventListener('click', () => {
    deleteCurrentProfile();
  });

  // 数字格式切换
  document.querySelectorAll('#ppo-num-mode-switch .ppo-segment-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#ppo-num-mode-switch .ppo-segment-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      numeralMode = btn.getAttribute('data-mode');
      updatePreview();
      saveLiveDraft();
    });
  });

  // 字母输入框焦点跟踪与单步顺延
  const letterInputs = [
    { id: 'ppo-in-letter1', target: 'letter1', nextId: 'ppo-in-letter2', nextTarget: 'letter2' },
    { id: 'ppo-in-letter2', target: 'letter2', nextId: 'ppo-in-letter3', nextTarget: 'letter3' },
    { id: 'ppo-in-letter3', target: 'letter3', nextId: 'ppo-in-platenum', nextTarget: null }
  ];

  letterInputs.forEach(item => {
    const el = document.getElementById(item.id);
    if (!el) return;

    el.addEventListener('focus', () => {
      setActiveLetterFocus(item.target);
    });

    el.addEventListener('input', () => {
      updatePreview();
      saveLiveDraft();
      if (el.value.trim().length >= 1 && item.nextId) {
        const nextEl = document.getElementById(item.nextId);
        if (nextEl) {
          nextEl.focus();
          if (item.nextTarget) {
            setActiveLetterFocus(item.nextTarget);
          }
        }
      }
    });
  });

  // 快捷字母点击
  document.querySelectorAll('#ppo-letter-palette .ppo-letter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const char = btn.getAttribute('data-char');
      const targetInput = document.getElementById(`ppo-in-${activeLetterTarget}`);
      
      if (targetInput) {
        targetInput.value = char;
        updatePreview();
        saveLiveDraft();
        
        if (activeLetterTarget === 'letter1') {
          const next = document.getElementById('ppo-in-letter2');
          if (next) {
            next.focus();
            setActiveLetterFocus('letter2');
          }
        } else if (activeLetterTarget === 'letter2') {
          const next = document.getElementById('ppo-in-letter3');
          if (next) {
            next.focus();
            setActiveLetterFocus('letter3');
          }
        } else if (activeLetterTarget === 'letter3') {
          const next = document.getElementById('ppo-in-platenum');
          if (next) {
            next.focus();
          }
        }
      }
    });
  });

  // 车牌与护照输入监听
  document.getElementById('ppo-in-platenum')?.addEventListener('input', () => {
    updatePreview();
    saveLiveDraft();
  });
  
  const passportInput = document.getElementById('ppo-in-passport-no');
  passportInput?.addEventListener('input', () => {
    updatePreview();
    saveLiveDraft();
    const raw = passportInput.value.trim();
    const cleaned = cleanPassportNumber(raw);
    const hintEl = document.getElementById('ppo-passport-hint');
    if (hintEl) {
      if (/^[A-Za-z]/.test(raw)) {
        hintEl.innerHTML = `💡 已检测到前缀字母，实际填表将自动提取为: <strong>${cleaned || '...'}</strong>`;
      } else {
        hintEl.innerHTML = `💡 提示：官方系统要求纯数字。若输入前缀字母（如 EA/E/G），将自动去除字母填入纯数字。`;
      }
    }
  });

  document.getElementById('ppo-in-national-id')?.addEventListener('input', () => {
    updatePreview();
    saveLiveDraft();
  });

  document.getElementById('ppo-in-country')?.addEventListener('change', () => {
    saveLiveDraft();
  });

  // 证件类型切换
  document.querySelectorAll('input[name="ppo_owner_type"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const isPassport = radio.value === 'passport';
      document.getElementById('ppo-passport-fields').style.display = isPassport ? 'block' : 'none';
      document.getElementById('ppo-national-id-fields').style.display = isPassport ? 'none' : 'block';
      saveLiveDraft();
    });
  });

  document.querySelectorAll('input[name="ppo_foreign_type"]').forEach(radio => {
    radio.addEventListener('change', () => {
      saveLiveDraft();
    });
  });

  // 核心操作：立即查询 (填入并自动查询)
  document.getElementById('ppo-btn-fill-submit')?.addEventListener('click', () => {
    handleTriggerAction(true);
  });

  // 核心操作：仅填入表单
  document.getElementById('ppo-btn-fill')?.addEventListener('click', () => {
    handleTriggerAction(false);
  });

  // 清空按钮
  document.getElementById('ppo-btn-clear')?.addEventListener('click', () => {
    clearForm();
    showToast('已清空输入框');
  });

  // 强制自愈解卡按钮
  document.getElementById('ppo-btn-heal-portal')?.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const currentTab = tabs[0];
      if (currentTab && currentTab.url && currentTab.url.includes('ppo.gov.eg')) {
        chrome.tabs.sendMessage(currentTab.id, { action: 'force_unfreeze_heal' }, (resp) => {
          showToast('✅ 已发送强制自愈解卡指令');
        });
      } else {
        chrome.tabs.query({}, (allTabs) => {
          const ppoTab = allTabs.find(t => t.url && t.url.includes('ppo.gov.eg'));
          if (ppoTab) {
            chrome.tabs.sendMessage(ppoTab.id, { action: 'force_unfreeze_heal' }, () => {
              showToast('✅ 已对后台 PPO 页面执行自愈解卡');
            });
          } else {
            showToast('ℹ️ 未检测到运行中的 PPO 官网页面');
          }
        });
      }
    });
  });
}

function getFormData() {
  return {
    letter1: document.getElementById('ppo-in-letter1')?.value || '',
    letter2: document.getElementById('ppo-in-letter2')?.value || '',
    letter3: document.getElementById('ppo-in-letter3')?.value || '',
    platenum: document.getElementById('ppo-in-platenum')?.value || '',
    numeralMode: numeralMode,
    ownerType: document.querySelector('input[name="ppo_owner_type"]:checked')?.value || 'passport',
    foreignType: document.querySelector('input[name="ppo_foreign_type"]:checked')?.value || 'foreign',
    country: document.getElementById('ppo-in-country')?.value || '10206',
    passportNo: document.getElementById('ppo-in-passport-no')?.value || '',
    nationalId: document.getElementById('ppo-in-national-id')?.value || ''
  };
}

function isFormDataValid(data) {
  if (!data) data = getFormData();
  
  // 1. 车牌数字验证
  const platenum = (data.platenum || '').trim();
  if (!platenum) return { valid: false, reason: '请填写车牌数字' };

  // 2. 车牌字母验证 (至少填入 2 个字母)
  const l1 = (data.letter1 || '').trim();
  const l2 = (data.letter2 || '').trim();
  if (!l1 || !l2) return { valid: false, reason: '请至少填入前 2 个车牌字母' };

  // 3. 所有者证件验证
  if (data.ownerType === 'passport') {
    const passportCleaned = cleanPassportNumber(data.passportNo || '');
    if (!passportCleaned) return { valid: false, reason: '请填写护照号码' };
  } else if (data.ownerType === 'national_id') {
    const nid = (data.nationalId || '').trim();
    if (!nid || nid.length !== 14 || !/^\d{14}$/.test(nid)) {
      return { valid: false, reason: '请填写 14 位身份证号' };
    }
  }

  return { valid: true };
}

function validateButtons() {
  const submitBtn = document.getElementById('ppo-btn-fill-submit');
  const fillBtn = document.getElementById('ppo-btn-fill');
  const res = isFormDataValid();

  if (submitBtn) {
    submitBtn.disabled = !res.valid;
    submitBtn.title = res.valid 
      ? "填入并自动点击官方 'إجمالى المخالفات' 查询" 
      : `⚠️ 未输入完整信息：${res.reason}，暂不可查询`;
  }
  if (fillBtn) {
    fillBtn.disabled = !res.valid;
    fillBtn.title = res.valid 
      ? "仅填入表单" 
      : `⚠️ 未输入完整信息：${res.reason}`;
  }
}

// 智能跨页面检测与任务派发
function handleTriggerAction(autoSubmit) {
  const validation = isFormDataValid();
  if (!validation.valid) {
    showToast(`⚠️ ${validation.reason}！`, true);
    validateButtons();
    return;
  }

  const data = getFormData();
  showToast('🚀 正在处理中...');

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const currentTab = tabs[0];
    const isPpoPage = currentTab && currentTab.url && /ppo\.gov\.eg\/ppo\//i.test(currentTab.url);

    if (isPpoPage) {
      // 当前就是查询页面，直接发送消息给 content script
      chrome.tabs.sendMessage(currentTab.id, {
        action: 'direct_fill',
        data: data,
        autoSubmit: autoSubmit
      }, (response) => {
        if (chrome.runtime.lastError || !response?.success) {
          // 如果 content script 未响应，通过 background 调度
          dispatchViaBackground(data, autoSubmit);
        } else {
          showToast(autoSubmit ? '✅ 已填入并提交查询！' : '✅ 已填入表单！');
          setTimeout(() => window.close(), 600);
        }
      });
    } else {
      // 当前不是查询页面，派发给 background 自动打开并填入
      dispatchViaBackground(data, autoSubmit);
    }
  });
}

function dispatchViaBackground(data, autoSubmit) {
  chrome.runtime.sendMessage({
    action: 'open_and_fill',
    data: data,
    autoSubmit: autoSubmit
  }, (response) => {
    showToast('🚀 正在自动打开查询网页并填入...');
    setTimeout(() => {
      window.close();
    }, 800);
  });
}

function updatePreview() {
  const l1 = document.getElementById('ppo-in-letter1')?.value || '';
  const l2 = document.getElementById('ppo-in-letter2')?.value || '';
  const l3 = document.getElementById('ppo-in-letter3')?.value || '';
  const rawNum = document.getElementById('ppo-in-platenum')?.value || '';

  const convertedNum = window.NumberUtils ? window.NumberUtils.convert(rawNum, numeralMode) : rawNum;
  const lettersStr = [l1, l2, l3].filter(Boolean).join(' ');

  const previewEl = document.getElementById('ppo-preview-val');
  if (previewEl) {
    previewEl.innerText = `${convertedNum || '____'} | ${lettersStr || '____'}`;
  }

  validateButtons();
}

const LAST_RESULT_KEY = 'ppo_traffic_last_result';
const DRAFT_KEY = 'ppo_traffic_live_draft';

// 永久双重持久化写入 (写入 chrome.storage.local 并自动云端/全局备份至 chrome.storage.sync)
function saveProfilesListPermanently(list, activeId, callback) {
  const payload = {
    [STORAGE_KEY]: list,
    [LAST_ACTIVE_KEY]: activeId
  };

  chrome.storage.local.set(payload, () => {
    if (typeof chrome.storage.sync !== 'undefined') {
      try {
        chrome.storage.sync.set(payload, () => {});
      } catch (e) {}
    }
    if (typeof callback === 'function') callback();
  });
}

// 统一跨组件 Profile 存储管理 (双重灾备，永不丢失)
function loadProfilesFromStorage() {
  chrome.storage.local.get([STORAGE_KEY, LAST_ACTIVE_KEY, LAST_RESULT_KEY, DRAFT_KEY], (res) => {
    let list = res[STORAGE_KEY] || [];
    let lastId = res[LAST_ACTIVE_KEY];

    // 如果 local 异常丢失，自动从 sync 备份恢复
    if (list.length === 0 && typeof chrome.storage.sync !== 'undefined') {
      chrome.storage.sync.get([STORAGE_KEY, LAST_ACTIVE_KEY], (syncRes) => {
        if (syncRes && syncRes[STORAGE_KEY] && syncRes[STORAGE_KEY].length > 0) {
          list = syncRes[STORAGE_KEY];
          lastId = syncRes[LAST_ACTIVE_KEY] || lastId;
          // 自动修补回 local
          chrome.storage.local.set({ [STORAGE_KEY]: list, [LAST_ACTIVE_KEY]: lastId });
        }
        processLoadedProfiles(list, lastId, res);
      });
    } else {
      processLoadedProfiles(list, lastId, res);
    }
  });

  // 监听外部页面对 storage 的修改并实时同步
  if (!window.__ppoPopupStorageListener) {
    window.__ppoPopupStorageListener = true;
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local') {
        if (changes[STORAGE_KEY]) {
          renderProfileDropdown(changes[STORAGE_KEY].newValue || []);
        }
        if (changes[LAST_RESULT_KEY]) {
          const r = changes[LAST_RESULT_KEY].newValue;
          if (r) {
            const banner = document.getElementById('ppo-result-banner');
            if (banner) {
              document.getElementById('ppo-res-total').textContent = r.totalFine || '0 جنيه';
              document.getElementById('ppo-res-count').textContent = `${r.violationCount || 0} 笔`;
              document.getElementById('ppo-res-reconcile').textContent = r.reconcileFine || '0 جنيه';
              banner.classList.add('show');
            }
          }
        }
      }
    });
  }
}

function processLoadedProfiles(list, lastId, res) {
  renderProfileDropdown(list);

  const target = list.find(p => p.id === lastId) || (list.length > 0 ? list[0] : null);
  if (target) {
    applyProfileObj(target);
  } else {
    // 若无配置，检查是否有正在编辑的实时草稿
    if (res && res[DRAFT_KEY]) {
      applyDraftObj(res[DRAFT_KEY]);
    } else {
      const countrySelect = document.getElementById('ppo-in-country');
      if (countrySelect) countrySelect.value = '10206';
    }
  }

  if (res && res[LAST_RESULT_KEY]) {
    const r = res[LAST_RESULT_KEY];
    const banner = document.getElementById('ppo-result-banner');
    if (banner) {
      document.getElementById('ppo-res-total').textContent = r.totalFine || '0 جنيه';
      document.getElementById('ppo-res-count').textContent = `${r.violationCount || 0} 笔`;
      document.getElementById('ppo-res-reconcile').textContent = r.reconcileFine || '0 جنيه';
      document.getElementById('ppo-result-time').textContent = r.time ? `更新于 ${r.time}` : '最近';
      banner.classList.add('show');
    }
  }
}

function renderProfileDropdown(list) {
  const dropdown = document.getElementById('ppo-profile-dropdown');
  if (!dropdown) return;

  dropdown.innerHTML = `<option value="">-- 选择已存人员配置 (${list.length} 人) --</option>`;

  list.forEach(item => {
    const opt = document.createElement('option');
    opt.value = item.id;
    const titleText = item.remark || item.passportNo || item.platenum || '未命名配置';
    opt.textContent = `👤 ${titleText}`;
    opt.title = `${titleText} (护照: ${item.passportNo || '无'} / 车牌: ${item.platenum || '无'})`;
    if (item.id === currentProfileId) {
      opt.selected = true;
    }
    dropdown.appendChild(opt);
  });

  const updateBtn = document.getElementById('ppo-btn-update-profile');
  if (updateBtn) {
    updateBtn.style.display = currentProfileId ? 'inline-flex' : 'none';
  }
}

function saveNewProfile(remarkName) {
  chrome.storage.local.get([STORAGE_KEY], (res) => {
    const list = res[STORAGE_KEY] || [];
    const id = Date.now().toString();

    const newProfile = {
      id: id,
      remark: remarkName || `人员配置 ${list.length + 1}`,
      letter1: document.getElementById('ppo-in-letter1')?.value || '',
      letter2: document.getElementById('ppo-in-letter2')?.value || '',
      letter3: document.getElementById('ppo-in-letter3')?.value || '',
      platenum: document.getElementById('ppo-in-platenum')?.value || '',
      numeralMode: numeralMode,
      ownerType: document.querySelector('input[name="ppo_owner_type"]:checked')?.value || 'passport',
      foreignType: document.querySelector('input[name="ppo_foreign_type"]:checked')?.value || 'foreign',
      country: document.getElementById('ppo-in-country')?.value || '10206',
      passportNo: document.getElementById('ppo-in-passport-no')?.value || '',
      nationalId: document.getElementById('ppo-in-national-id')?.value || ''
    };

    list.push(newProfile);

    saveProfilesListPermanently(list, id, () => {
      currentProfileId = id;
      renderProfileDropdown(list);
      const updateBtn = document.getElementById('ppo-btn-update-profile');
      if (updateBtn) updateBtn.style.display = 'inline-flex';
      showToast(`✅ 已永久保存在本地与云端: ${newProfile.remark}`);
    });
  });
}

function updateCurrentProfile() {
  if (!currentProfileId) {
    showToast('⚠️ 未选中任何配置，请点击「➕ 新增」', true);
    return;
  }

  chrome.storage.local.get([STORAGE_KEY], (res) => {
    let list = res[STORAGE_KEY] || [];
    const index = list.findIndex(p => p.id === currentProfileId);
    if (index === -1) {
      showToast('⚠️ 未找到当前配置', true);
      return;
    }

    const formData = getFormData();
    const oldRemark = list[index].remark;

    list[index] = {
      ...formData,
      id: currentProfileId,
      remark: oldRemark || formData.passportNo || formData.platenum || '未命名配置'
    };

    saveProfilesListPermanently(list, currentProfileId, () => {
      renderProfileDropdown(list);
      showToast(`✅ 已永久覆盖更新「${list[index].remark}」`);
    });
  });
}

function applyProfile(id) {
  if (!id) {
    currentProfileId = null;
    chrome.storage.local.set({ [LAST_ACTIVE_KEY]: null });
    const updateBtn = document.getElementById('ppo-btn-update-profile');
    if (updateBtn) updateBtn.style.display = 'none';
    return;
  }

  chrome.storage.local.get([STORAGE_KEY], (res) => {
    const list = res[STORAGE_KEY] || [];
    const profile = list.find(p => p.id === id);
    if (profile) {
      applyProfileObj(profile);
    }
  });
}

function applyProfileObj(profile) {
  currentProfileId = profile.id;
  chrome.storage.local.set({ [LAST_ACTIVE_KEY]: profile.id });

  document.getElementById('ppo-in-letter1').value = profile.letter1 || '';
  document.getElementById('ppo-in-letter2').value = profile.letter2 || '';
  document.getElementById('ppo-in-letter3').value = profile.letter3 || '';
  document.getElementById('ppo-in-platenum').value = profile.platenum || '';

  if (profile.numeralMode) {
    numeralMode = profile.numeralMode;
    document.querySelectorAll('#ppo-num-mode-switch .ppo-segment-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-mode') === numeralMode);
    });
  }

  const ownerType = profile.ownerType || 'passport';
  const ownerRadio = document.querySelector(`input[name="ppo_owner_type"][value="${ownerType}"]`);
  if (ownerRadio) {
    ownerRadio.checked = true;
    document.getElementById('ppo-passport-fields').style.display = ownerType === 'passport' ? 'block' : 'none';
    document.getElementById('ppo-national-id-fields').style.display = ownerType === 'passport' ? 'none' : 'block';
  }

  const foreignType = profile.foreignType || 'foreign';
  const foreignRadio = document.querySelector(`input[name="ppo_foreign_type"][value="${foreignType}"]`);
  if (foreignRadio) foreignRadio.checked = true;

  const countrySelect = document.getElementById('ppo-in-country');
  if (countrySelect) {
    countrySelect.value = profile.country || '10206';
  }

  document.getElementById('ppo-in-passport-no').value = profile.passportNo || '';
  document.getElementById('ppo-in-national-id').value = profile.nationalId || '';

  const profileDropdown = document.getElementById('ppo-profile-dropdown');
  if (profileDropdown) profileDropdown.value = profile.id;

  const updateBtn = document.getElementById('ppo-btn-update-profile');
  if (updateBtn) updateBtn.style.display = 'inline-flex';

  updatePreview();
  showToast(`👤 已载入配置: ${profile.remark}`);
}

function applyDraftObj(draft) {
  if (!draft) return;
  if (draft.letter1) document.getElementById('ppo-in-letter1').value = draft.letter1;
  if (draft.letter2) document.getElementById('ppo-in-letter2').value = draft.letter2;
  if (draft.letter3) document.getElementById('ppo-in-letter3').value = draft.letter3;
  if (draft.platenum) document.getElementById('ppo-in-platenum').value = draft.platenum;
  if (draft.passportNo) document.getElementById('ppo-in-passport-no').value = draft.passportNo;
  if (draft.nationalId) document.getElementById('ppo-in-national-id').value = draft.nationalId;
  if (draft.country) {
    const cs = document.getElementById('ppo-in-country');
    if (cs) cs.value = draft.country;
  }
  updatePreview();
}

let draftDebounceTimer = null;
function saveLiveDraft() {
  if (draftDebounceTimer) clearTimeout(draftDebounceTimer);
  draftDebounceTimer = setTimeout(() => {
    const data = getFormData();
    chrome.storage.local.set({ [DRAFT_KEY]: data });
  }, 300);
}

function deleteCurrentProfile() {
  if (!currentProfileId) {
    showToast('⚠️ 请先在下拉框中选择要删除的人员配置', true);
    return;
  }

  chrome.storage.local.get([STORAGE_KEY], (res) => {
    let list = res[STORAGE_KEY] || [];
    const item = list.find(p => p.id === currentProfileId);
    if (!confirm(`确定要删除人员配置「${item ? item.remark : ''}」吗？`)) return;

    list = list.filter(p => p.id !== currentProfileId);

    saveProfilesListPermanently(list, null, () => {
      currentProfileId = null;
      renderProfileDropdown(list);
      clearForm();
      showToast('🗑️ 已删除该配置');
    });
  });
}

function clearForm() {
  ['ppo-in-letter1', 'ppo-in-letter2', 'ppo-in-letter3', 'ppo-in-platenum', 'ppo-in-passport-no', 'ppo-in-national-id', 'ppo-in-remark'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  
  const countrySelect = document.getElementById('ppo-in-country');
  if (countrySelect) countrySelect.value = '10206';

  const profileDropdown = document.getElementById('ppo-profile-dropdown');
  if (profileDropdown) profileDropdown.value = '';
  currentProfileId = null;

  setActiveLetterFocus('letter1');
  document.getElementById('ppo-in-letter1')?.focus();
  updatePreview();
}

function showToast(msg, isError = false) {
  const toast = document.getElementById('ppo-toast');
  if (!toast) return;
  toast.innerText = msg;
  toast.style.background = isError ? 'var(--ppo-danger)' : 'var(--ppo-success)';
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 2200);
}

function initPopupServerHealth() {
  loadPopupServerHealth();

  document.getElementById('popup-btn-ping')?.addEventListener('click', () => {
    const textEl = document.getElementById('popup-health-status-text');
    const pingBtn = document.getElementById('popup-btn-ping');
    if (textEl) textEl.textContent = '⏳ 探测中...';
    if (pingBtn) pingBtn.disabled = true;

    chrome.runtime.sendMessage({ action: 'ping_server_now' }, () => {
      if (pingBtn) pingBtn.disabled = false;
      loadPopupServerHealth();
    });
  });
}

function loadPopupServerHealth() {
  const SERVER_PROBES_STORAGE_KEY = 'ppo_traffic_server_probes_v1';
  chrome.storage.local.get([SERVER_PROBES_STORAGE_KEY], (res) => {
    const list = res[SERVER_PROBES_STORAGE_KEY] || [];
    const textEl = document.getElementById('popup-health-status-text');
    if (!textEl) return;

    if (list.length === 0) {
      textEl.textContent = '🟢 正常';
      return;
    }

    const latest = list[list.length - 1];
    const lat = latest.latencyMs || 0;
    if (latest.status === 'down') {
      textEl.innerHTML = `<span style="color: #f87171;">🔴 官方脱机/超时 (${lat}ms)</span>`;
    } else if (latest.status === 'degraded') {
      textEl.innerHTML = `<span style="color: #fbbf24;">🟡 响应缓慢 (${lat}ms)</span>`;
    } else {
      textEl.innerHTML = `<span style="color: #34d399;">🟢 极速正常 (${lat}ms)</span>`;
    }
  });
}
