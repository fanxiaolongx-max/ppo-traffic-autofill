/**
 * PPO Traffic AutoFill - Content Script
 * 埃及交通违章查询 - 横向宽屏双列布局 + 违章罚款结果自动捕捉展示
 */

(function () {
  if (window.__ppoAutoFillLoaded) return;
  window.__ppoAutoFillLoaded = true;

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
  const LAST_RESULT_KEY = 'ppo_traffic_last_result';

  function cleanPassportNumber(str) {
    if (!str) return '';
    return str.trim().replace(/^[A-Za-z]{1,3}/, '').trim();
  }

  // 1. 初始化创建悬浮窗 DOM (横向宽屏双列布局)
  function createFloatingUI() {
    if (document.getElementById('ppo-autofill-container')) return;

    const container = document.createElement('div');
    container.id = 'ppo-autofill-container';

    container.innerHTML = `
      <div class="ppo-panel" id="ppo-main-panel">
        <!-- 头部拖拽栏 -->
        <div class="ppo-header" id="ppo-drag-header">
          <div class="ppo-title-wrap">
            <div class="ppo-badge-icon">🚗</div>
            <div>
              <div class="ppo-title-text">PPO 车牌违章助手 (横向宽屏版)</div>
              <span class="ppo-title-sub">مساعد مخالفات رخص المركبات</span>
            </div>
          </div>
          <div class="ppo-header-actions">
            <button class="ppo-tool-btn" id="ppo-btn-minimize" title="最小化">一</button>
            <button class="ppo-tool-btn" id="ppo-btn-close" title="收起">✕</button>
          </div>
        </div>

        <!-- 违章罚款结果捕捉展示横幅 -->
        <div class="ppo-result-banner" id="ppo-result-banner">
          <div class="ppo-result-header">
            <div class="ppo-result-title">
              <span>📋 实时捕捉到查询结果 (بيانات المخالفات)</span>
            </div>
            <span class="ppo-result-time" id="ppo-result-time">刚刚更新</span>
          </div>
          <div class="ppo-result-grid">
            <div class="ppo-result-card highlight">
              <div class="ppo-result-label">💰 总罚款 (اجمالي الغرامات)</div>
              <div class="ppo-result-val" id="ppo-res-total">0 جنيه</div>
            </div>
            <div class="ppo-result-card">
              <div class="ppo-result-label">🚨 违章笔数 (عدد المخالفات)</div>
              <div class="ppo-result-val" id="ppo-res-count">0</div>
            </div>
            <div class="ppo-result-card">
              <div class="ppo-result-label">🤝 和解罚款 (غرامات التصالح)</div>
              <div class="ppo-result-val" id="ppo-res-reconcile">0 جنيه</div>
            </div>
          </div>
        </div>

        <!-- 表单主体 (横向 2-Column 布局) -->
        <div class="ppo-body">
          <!-- 常用人员/配置切换管理栏 -->
          <div class="ppo-profile-section">
            <div class="ppo-profile-title">
              <span>👤 常用人员/车辆配置管理</span>
              <span style="font-size: 11px; font-weight: normal; color: var(--ppo-text-muted);">快速切换人员</span>
            </div>
            <div class="ppo-profile-controls">
              <select class="ppo-profile-select" id="ppo-profile-dropdown">
                <option value="">-- 选择已存人员配置 (点击切换) --</option>
              </select>
              <button type="button" class="ppo-profile-btn" id="ppo-btn-toggle-save" title="将当前填写的表单存为新人员配置">
                <span>➕ 存为配置</span>
              </button>
              <button type="button" class="ppo-profile-btn danger" id="ppo-btn-delete-profile" title="删除当前选中的人员配置">
                <span>🗑️</span>
              </button>
            </div>

            <div class="ppo-save-expander" id="ppo-save-expander">
              <input type="text" class="ppo-input" id="ppo-in-remark" placeholder="输入备注名称 (如: 张三-丰田车 / 李四)" maxlength="25" style="flex: 1; padding: 6px 10px; font-size: 12px;">
              <button type="button" class="ppo-profile-btn" id="ppo-btn-confirm-save" style="background: var(--ppo-primary); border-color: var(--ppo-gold);">
                <span>💾 确认保存</span>
              </button>
              <button type="button" class="ppo-profile-btn" id="ppo-btn-cancel-save">
                <span>✕</span>
              </button>
            </div>
          </div>

          <!-- 双列内容区域 -->
          <div class="ppo-columns-wrap">
            <!-- 右列 (RTL 第一列)：车牌号码与数字键盘 -->
            <div class="ppo-col-card">
              <!-- 车牌信息卡片 -->
              <div class="ppo-section">
                <div class="ppo-section-title">
                  <span>车牌号码 (License Plate)</span>
                  <span class="ar-hint">رقم الرخصة (حروف وأرقام)</span>
                </div>

                <div class="ppo-label" style="margin-bottom: 2px;">
                  <span>字母 (字1 / 字2 / 字3) 与数字:</span>
                </div>

                <div class="ppo-plate-box-wrap">
                  <div class="ppo-letter-item">
                    <input type="text" class="ppo-letter-input active-focus" id="ppo-in-letter1" maxlength="1" placeholder="字1" title="第1个字母" autocomplete="off" spellcheck="false">
                    <span>字1</span>
                  </div>
                  <div class="ppo-letter-item">
                    <input type="text" class="ppo-letter-input" id="ppo-in-letter2" maxlength="1" placeholder="字2" title="第2个字母" autocomplete="off" spellcheck="false">
                    <span>字2</span>
                  </div>
                  <div class="ppo-letter-item">
                    <input type="text" class="ppo-letter-input" id="ppo-in-letter3" maxlength="1" placeholder="字3" title="第3个字母" autocomplete="off" spellcheck="false">
                    <span>字3</span>
                  </div>
                  <div style="flex: 1; display: flex; flex-direction: column; gap: 2px;">
                    <input type="text" class="ppo-plate-num-input" id="ppo-in-platenum" placeholder="车牌数字 (如 1234)" maxlength="6" autocomplete="off" spellcheck="false">
                    <span style="font-size: 10.5px; color: var(--ppo-text-muted); text-align: center;">车牌数字</span>
                  </div>
                </div>

                <div style="margin-top: 8px; font-size: 11px; color: var(--ppo-text-muted);">
                  快捷字母面板 (点击直接填入当前高亮框):
                </div>
                <div class="ppo-letter-picker" id="ppo-letter-palette">
                  ${COMMON_LETTERS.map(char => `<button type="button" class="ppo-letter-btn" data-char="${char}">${char}</button>`).join('')}
                </div>

                <div class="ppo-preview-pill" id="ppo-plate-preview">
                  <span>实时车牌预览:</span>
                  <strong id="ppo-preview-val">-</strong>
                </div>
              </div>
            </div>

            <!-- 左列 (RTL 第二列)：数字格式与所有者信息 -->
            <div class="ppo-col-card">
              <!-- 数字格式选择 -->
              <div class="ppo-section">
                <div class="ppo-section-title">
                  <span>数字转换格式 (Numeral Mode)</span>
                  <span class="ar-hint">نمط الأرقام</span>
                </div>
                <div class="ppo-segmented" id="ppo-num-mode-switch">
                  <button class="ppo-segment-btn active" data-mode="latin">原样 (0-9)</button>
                  <button class="ppo-segment-btn" data-mode="eastern">埃及数字 (٠-٩)</button>
                  <button class="ppo-segment-btn" data-mode="persian">波斯数字 (۰-۹)</button>
                </div>
              </div>

              <!-- 所有者信息卡片 -->
              <div class="ppo-section">
                <div class="ppo-section-title">
                  <span>所有者信息 (Owner Details)</span>
                  <span class="ar-hint">بيانات المالك</span>
                </div>

                <div class="ppo-row">
                  <div class="ppo-col">
                    <label class="ppo-label">证件类型</label>
                    <div class="ppo-radio-group">
                      <label class="ppo-radio-label">
                        <input type="radio" name="ppo_owner_type" value="passport" checked> 护照 (جواز سفر)
                      </label>
                      <label class="ppo-radio-label">
                        <input type="radio" name="ppo_owner_type" value="national_id"> 身份证 (رقم قومي)
                      </label>
                    </div>
                  </div>
                </div>

                <div id="ppo-passport-fields">
                  <div class="ppo-row" style="margin-top: 6px;">
                    <div class="ppo-col">
                      <label class="ppo-label">身份属性</label>
                      <div class="ppo-radio-group">
                        <label class="ppo-radio-label">
                          <input type="radio" name="ppo_foreign_type" value="foreign" checked> 外籍 (أجنبي)
                        </label>
                        <label class="ppo-radio-label">
                          <input type="radio" name="ppo_foreign_type" value="citizen"> 埃及本国 (مواطن)
                        </label>
                      </div>
                    </div>
                  </div>

                  <div class="ppo-row" style="margin-top: 6px;">
                    <div class="ppo-col">
                      <label class="ppo-label">
                        <span>护照签发国 / 国籍 (默认中国)</span>
                        <span class="ar-tag">الجنسية</span>
                      </label>
                      <select class="ppo-select" id="ppo-in-country">
                        ${COUNTRY_OPTIONS.map(c => `<option value="${c.value}" ${c.value === '10206' ? 'selected' : ''}>${c.text}</option>`).join('')}
                      </select>
                    </div>
                  </div>

                  <div class="ppo-row" style="margin-top: 6px;">
                    <div class="ppo-col">
                      <label class="ppo-label">
                        <span>护照号码</span>
                        <span class="ar-tag">رقم الجواز</span>
                      </label>
                      <input type="text" class="ppo-input" id="ppo-in-passport-no" placeholder="输入护照号 (如 EA1234567 / 1234567)" maxlength="20">
                      <div class="ppo-hint-text highlight" id="ppo-passport-hint">
                        💡 提示：官方系统要求纯数字。若输入前缀字母（如 EA/E/G），将自动去除字母填入纯数字。
                      </div>
                    </div>
                  </div>
                </div>

                <div id="ppo-national-id-fields" style="display: none; margin-top: 6px;">
                  <div class="ppo-col">
                    <label class="ppo-label">
                      <span>国民身份证号 (14位)</span>
                      <span class="ar-tag">الرقم القومي</span>
                    </label>
                    <input type="text" class="ppo-input" id="ppo-in-national-id" placeholder="输入 14 位埃及身份证号" maxlength="14">
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 底部操作按钮 -->
        <div class="ppo-footer">
          <div class="ppo-footer-main-btn">
            <button type="button" class="ppo-btn-main" id="ppo-btn-fill-submit" title="填入并自动点击官方'إجمالى المخالفات'查询">
              <span>🔍 立即查询 (填入并自动查询)</span>
            </button>
          </div>
          
          <div class="ppo-footer-sub-btns">
            <button type="button" class="ppo-btn-sub" id="ppo-btn-fill">
              <span>⚡ 仅填入表单</span>
            </button>
            <button type="button" class="ppo-btn-sub" id="ppo-btn-clear" title="清空所有输入">
              <span>🧹 清空</span>
            </button>
          </div>
        </div>

        <div class="ppo-toast" id="ppo-toast">已成功！</div>
      </div>
    `;

    const bubble = document.createElement('div');
    bubble.id = 'ppo-toggle-bubble';
    bubble.title = '展开 PPO 违章填表悬浮窗';
    bubble.innerHTML = '🚗';

    document.body.appendChild(container);
    document.body.appendChild(bubble);

    bindEvents();
    syncProfilesFromStorage();
    checkPendingPpoTask();
    startResultObserver();
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

  // 2. 绑定交互与拖拽事件
  function bindEvents() {
    const container = document.getElementById('ppo-autofill-container');
    const panel = document.getElementById('ppo-main-panel');
    const dragHeader = document.getElementById('ppo-drag-header');
    const bubble = document.getElementById('ppo-toggle-bubble');

    let isDragging = false;
    let startX, startY, initialLeft, initialTop;

    dragHeader.addEventListener('mousedown', (e) => {
      if (e.target.closest('.ppo-tool-btn')) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = container.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      container.style.left = `${Math.max(10, initialLeft + dx)}px`;
      container.style.top = `${Math.max(10, initialTop + dy)}px`;
      container.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
      document.body.style.userSelect = '';
    });

    document.getElementById('ppo-btn-minimize').addEventListener('click', () => {
      panel.classList.toggle('minimized');
    });

    document.getElementById('ppo-btn-close').addEventListener('click', () => {
      container.style.display = 'none';
      bubble.style.display = 'flex';
    });

    bubble.addEventListener('click', () => {
      container.style.display = 'block';
      bubble.style.display = 'none';
      panel.classList.remove('minimized');
    });

    // 多配置切换与保存
    const profileDropdown = document.getElementById('ppo-profile-dropdown');
    profileDropdown.addEventListener('change', () => {
      if (profileDropdown.value) {
        applyProfileById(profileDropdown.value);
      }
    });

    const saveExpander = document.getElementById('ppo-save-expander');
    document.getElementById('ppo-btn-toggle-save').addEventListener('click', () => {
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

    document.getElementById('ppo-btn-cancel-save').addEventListener('click', () => {
      saveExpander.classList.remove('show');
    });

    document.getElementById('ppo-btn-confirm-save').addEventListener('click', () => {
      const remark = document.getElementById('ppo-in-remark')?.value.trim();
      saveNewProfile(remark);
      saveExpander.classList.remove('show');
    });

    document.getElementById('ppo-btn-delete-profile').addEventListener('click', () => {
      deleteCurrentProfile();
    });

    // 数字模式切换
    document.querySelectorAll('#ppo-num-mode-switch .ppo-segment-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#ppo-num-mode-switch .ppo-segment-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        numeralMode = btn.getAttribute('data-mode');
        updatePreview();
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

    document.getElementById('ppo-in-platenum').addEventListener('input', updatePreview);
    
    const passportInput = document.getElementById('ppo-in-passport-no');
    passportInput.addEventListener('input', () => {
      updatePreview();
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

    document.querySelectorAll('input[name="ppo_owner_type"]').forEach(radio => {
      radio.addEventListener('change', () => {
        const isPassport = radio.value === 'passport';
        document.getElementById('ppo-passport-fields').style.display = isPassport ? 'block' : 'none';
        document.getElementById('ppo-national-id-fields').style.display = isPassport ? 'none' : 'block';
      });
    });

    document.getElementById('ppo-btn-fill').addEventListener('click', () => {
      fillPPOForm(getFormDataFromUI(), false);
    });

    document.getElementById('ppo-btn-fill-submit').addEventListener('click', () => {
      fillPPOForm(getFormDataFromUI(), true);
    });

    document.getElementById('ppo-btn-clear').addEventListener('click', () => {
      clearForm();
      showToast('已清空输入框');
    });
  }

  function getFormDataFromUI() {
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
    if (!data) data = getFormDataFromUI();
    
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

  function setFormDataToUI(data) {
    if (!data) return;
    if (data.letter1) document.getElementById('ppo-in-letter1').value = data.letter1;
    if (data.letter2) document.getElementById('ppo-in-letter2').value = data.letter2;
    if (data.letter3) document.getElementById('ppo-in-letter3').value = data.letter3;
    if (data.platenum) document.getElementById('ppo-in-platenum').value = data.platenum;

    if (data.numeralMode) {
      numeralMode = data.numeralMode;
      document.querySelectorAll('#ppo-num-mode-switch .ppo-segment-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-mode') === numeralMode);
      });
    }

    const ownerType = data.ownerType || 'passport';
    const ownerRadio = document.querySelector(`input[name="ppo_owner_type"][value="${ownerType}"]`);
    if (ownerRadio) {
      ownerRadio.checked = true;
      document.getElementById('ppo-passport-fields').style.display = ownerType === 'passport' ? 'block' : 'none';
      document.getElementById('ppo-national-id-fields').style.display = ownerType === 'passport' ? 'none' : 'block';
    }

    const foreignType = data.foreignType || 'foreign';
    const foreignRadio = document.querySelector(`input[name="ppo_foreign_type"][value="${foreignType}"]`);
    if (foreignRadio) foreignRadio.checked = true;

    const countrySelect = document.getElementById('ppo-in-country');
    if (countrySelect) {
      countrySelect.value = data.country || '10206';
    }

    if (data.passportNo) document.getElementById('ppo-in-passport-no').value = data.passportNo;
    if (data.nationalId) document.getElementById('ppo-in-national-id').value = data.nationalId;

    updatePreview();
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

  const TARGET_PPO_URL = "https://www.ppo.gov.eg/ppo/r/ppoportal/ppoportal/traffic";

  // 3. 核心填表与智能页面状态检测查询
  function fillPPOForm(formData, autoSubmit = false) {
    const data = formData || getFormDataFromUI();

    const validation = isFormDataValid(data);
    if (!validation.valid) {
      showToast(`⚠️ ${validation.reason}！`, true);
      validateButtons();
      return;
    }

    let letter1Input = document.getElementById('P14_LETER_1');
    let numWithLetterInput = document.getElementById('P14_NUMBER_WITH_LETTER');

    // 如果当前处于「结果展示页」或未找到输入表单 (例如正在看结果，用户修改了车牌/人员再次点击查询)
    if (!letter1Input || !numWithLetterInput) {
      // 首先检查是否在同页面的其他 Tab，如果是则尝试点开「车牌违章」Tab
      const vehicleTab = Array.from(document.querySelectorAll('a, button, li')).find(el => 
        el.innerText && el.innerText.includes('مخالفات رخص المركبات')
      );

      if (vehicleTab && vehicleTab.offsetParent !== null) {
        vehicleTab.click();
        setTimeout(() => {
          const l1 = document.getElementById('P14_LETER_1');
          if (l1) {
            doFillOperations(data, autoSubmit);
          } else {
            navigateBackAndRequery(data, autoSubmit);
          }
        }, 350);
        return;
      }

      // 如果确实处于结果页或不可输入状态，启动自动返回查询流程
      navigateBackAndRequery(data, autoSubmit);
      return;
    }

    doFillOperations(data, autoSubmit);
  }

  // 自动返回查询页面并在加载完成后重新执行填入与查询
  function navigateBackAndRequery(data, autoSubmit) {
    showToast('🔄 检测到当前在结果页，正在自动返回查询页面...', false);

    // 将新的查询任务保存到浏览器全局存储中
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({
        pendingPpoTask: {
          data: data,
          autoSubmit: autoSubmit,
          timestamp: Date.now()
        }
      }, () => {
        // 优先查找页面上的「رجوع (返回)」或「بحث جديد (新查询)」按钮进行平滑回退
        const backBtn = Array.from(document.querySelectorAll('button, a, input[type="button"]')).find(el => 
          el.innerText && (el.innerText.includes('رجوع') || el.innerText.includes('بحث جديد'))
        );

        if (backBtn && typeof backBtn.click === 'function') {
          backBtn.click();
        } else {
          // 若按钮不存在，直接跳转回官方查询主地址
          window.location.href = TARGET_PPO_URL;
        }
      });
    } else {
      window.location.href = TARGET_PPO_URL;
    }
  }

  function doFillOperations(data, autoSubmit) {
    setRadioValue('P14_CHOSE_OPTION', '1');

    const rawNum = data.platenum || '';
    const convertedPlateNum = window.NumberUtils ? window.NumberUtils.convert(rawNum, data.numeralMode || numeralMode) : rawNum;

    setFieldValue('P14_LETER_1', data.letter1 || '');
    setFieldValue('P14_LETER_2', data.letter2 || '');
    setFieldValue('P14_LETER_3', data.letter3 || '');
    setFieldValue('P14_NUMBER_WITH_LETTER', convertedPlateNum);

    const ownerType = data.ownerType || 'passport';

    if (ownerType === 'passport') {
      setRadioValue('P14_ID_TYPE_NUMS_LETTERS', '1429');

      const isForeign = data.foreignType !== 'citizen';
      setRadioValue('P14_ISFOREIGN__NUMS_LETTERS', isForeign ? '1' : '0');

      const countryVal = data.country || '10206';
      setSelectValue('P14_PASSPORT_ISSUE_PLACE_NUMS_LETTERS', countryVal);

      const rawPassport = data.passportNo || '';
      const cleanedPassport = cleanPassportNumber(rawPassport);
      const finalPassport = window.NumberUtils ? window.NumberUtils.convert(cleanedPassport, data.numeralMode || numeralMode) : cleanedPassport;
      
      setFieldValue('P14_PASSPORT_NUM_NUMS_LETTERS', finalPassport);

    } else if (ownerType === 'national_id') {
      setRadioValue('P14_ID_TYPE_NUMS_LETTERS', '2153');

      const rawId = data.nationalId || '';
      const convertedId = window.NumberUtils ? window.NumberUtils.convert(rawId, data.numeralMode || numeralMode) : rawId;
      setFieldValue('P14_NATIONAL_ID_NUMS_LETTERS', convertedId);
    }

    showToast('✅ 成功一键填入表单！');

    if (autoSubmit) {
      setTimeout(() => {
        const submitBtn = document.getElementById('GET_FIN_LETTER_NUMBERS_BTN') || 
                          document.querySelector("button[id*='GET_FIN']");
        if (submitBtn) {
          showToast('🚀 正在提交查询...');
          isAwaitingQueryResult = true;
          querySubmissionTimestamp = Date.now();
          submitBtn.click();
        } else {
          showToast('⚠️ 请手动点击「إجمالى المخالفات」查询', true);
        }
      }, 400);
    }
  }

  function setFieldValue(id, value) {
    const el = document.getElementById(id);
    if (!el) return;

    if (window.apex && window.apex.item && window.apex.item(id)) {
      try {
        window.apex.item(id).setValue(value);
      } catch (e) {}
    }

    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function setRadioValue(groupName, value) {
    const radios = document.querySelectorAll(`input[name="${groupName}"]`);
    radios.forEach(radio => {
      if (radio.value === value) {
        radio.checked = true;
        radio.dispatchEvent(new Event('click', { bubbles: true }));
        radio.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    if (window.apex && window.apex.item && window.apex.item(groupName)) {
      try {
        window.apex.item(groupName).setValue(value);
      } catch (e) {}
    }
  }

  function setSelectValue(id, value) {
    const select = document.getElementById(id);
    if (!select) return;

    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));

    if (window.apex && window.apex.item && window.apex.item(id)) {
      try {
        window.apex.item(id).setValue(value);
      } catch (e) {}
    }
  }

  let currentTaskId = null;
  let lastReportedTaskId = null;
  let isAwaitingQueryResult = false;
  let querySubmissionTimestamp = 0;

  // 4. 实时监听并捕捉页面上的违章罚款信息与官方报错弹窗
  function startResultObserver() {
    // 监听 DOM 动态变化（Oracle APEX 局部刷新与弹窗）
    const observer = new MutationObserver(() => {
      checkAndScrapeResults();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // 轮询辅助检测
    setInterval(checkAndScrapeResults, 500);
  }

  let lastCapturedSign = '';

  function checkAndScrapeResults() {
    const isSummaryPage = window.location.href.includes('traffic-fines-summary');
    const pageText = document.body.innerText || '';
    const hasSummaryKeywords = pageText.includes('اجمالي الغرامات الشاملة') || pageText.includes('عدد المخالفات');

    // 如果已进入结果页，立即终止页面后续无休止的慢速资源转圈
    if (isSummaryPage || hasSummaryKeywords) {
      try {
        window.stop();
      } catch (e) {}
    }

    // 1. 检查是否有官方错误弹窗 (如: حدث خطأ أثناء تنفيذ الخدمة)
    const errorDialog = document.querySelector('.ui-dialog, .t-Alert--error, div[role="dialog"]');

    if (pageText.includes('حدث خطأ أثناء تنفيذ الخدمة') || (errorDialog && errorDialog.innerText.includes('خطأ'))) {
      isAwaitingQueryResult = false;
      const effectiveTaskId = currentTaskId || sessionStorage.getItem('ppo_active_task_id');
      
      showToast('⚠️ 官方系统提示：执行出错 (请核对车牌/证件号)', true);

      // 自动点击错误弹窗的「موافق (确定)」按钮恢复界面
      const okBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText && b.innerText.includes('موافق'));
      if (okBtn) {
        setTimeout(() => okBtn.click(), 800);
      }
      return;
    }

    // 2. 检查是否有无违章提示 (如: لا توجد مخالفات)
    if (pageText.includes('لا توجد مخالفات') || pageText.includes('لا يوجد مخالفات')) {
      isAwaitingQueryResult = false;
      displayCapturedResult({
        totalFine: '0 جنيه',
        violationCount: '0',
        reconcileFine: '0 جنيه',
        time: new Date().toLocaleTimeString()
      });
      return;
    }

    // 3. 检测结果页数据 (只要处于结果摘要页或包含违章结果关键字)
    if (isSummaryPage || hasSummaryKeywords) {
      let totalFine = '';
      let violationCount = '';
      let reconcileFine = '';

      // 扫描页面包含卡片结构的容器
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

      // 如果未通过精确父元素捕获，通过正则提取
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
        // 标记本次查询已完成捕获
        isAwaitingQueryResult = false;
        displayCapturedResult({
          totalFine: totalFine || '0 جنيه',
          violationCount: violationCount || '0',
          reconcileFine: reconcileFine || '0 جنيه',
          time: new Date().toLocaleTimeString()
        });
      }
    }
  }

  function renderResultBanner(res) {
    if (!res) return;
    const banner = document.getElementById('ppo-result-banner');
    if (banner) {
      document.getElementById('ppo-res-total').textContent = res.totalFine || '0 جنيه';
      document.getElementById('ppo-res-count').textContent = `${res.violationCount || 0} 笔`;
      document.getElementById('ppo-res-reconcile').textContent = res.reconcileFine || '0 جنيه';
      document.getElementById('ppo-result-time').textContent = res.time ? `更新于 ${res.time}` : '刚刚';
      banner.classList.add('show');
    }
  }

  function displayCapturedResult(res) {
    renderResultBanner(res);

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ [LAST_RESULT_KEY]: res });
    }

    showToast(`🎉 已成功获取罚款信息：总计 ${res.totalFine} (${res.violationCount} 笔违章)`);
  }

  // 5. 跨页面任务接收与执行 (带自适应轮询等待，确保 APEX 异步组件加载就绪)
  function checkPendingPpoTask() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['pendingPpoTask'], (res) => {
        const task = res.pendingPpoTask;
        if (task && task.timestamp && (Date.now() - task.timestamp < 60000)) {
          chrome.storage.local.remove('pendingPpoTask');
          
          setFormDataToUI(task.data);
          showToast('⚡ 检测到自动填表任务，正在准备填入...', false);
          
          // 轮询等待表单或 Tab 加载就绪 (最多等待 4 秒)
          let retries = 0;
          const timer = setInterval(() => {
            retries++;
            const letterInput = document.getElementById('P14_LETER_1');
            const vehicleTab = Array.from(document.querySelectorAll('a, button, li')).find(el => 
              el.innerText && el.innerText.includes('مخالفات رخص المركبات')
            );

            if (letterInput && letterInput.offsetParent !== null) {
              clearInterval(timer);
              setTimeout(() => {
                fillPPOForm(task.data, task.autoSubmit);
              }, 250);
            } else if (vehicleTab) {
              vehicleTab.click();
            }

            if (retries >= 15) {
              clearInterval(timer);
              fillPPOForm(task.data, task.autoSubmit);
            }
          }, 250);
        }
      });
    }
  }

  // 监听来自 Popup 的直接调用
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg.action === 'direct_fill') {
        setFormDataToUI(msg.data);
        fillPPOForm(msg.data, msg.autoSubmit);
        sendResponse({ success: true });
        return true;
      }
    });
  }

  // 6. 全局多配置管理体系 (纯原生 chrome.storage.local，跨全网全浏览器统一共享，不依赖任何特定站点)
  function syncProfilesFromStorage() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get([STORAGE_KEY, LAST_ACTIVE_KEY, LAST_RESULT_KEY], (res) => {
        const list = res[STORAGE_KEY] || [];
        renderProfileDropdown(list);

        const lastId = res[LAST_ACTIVE_KEY];
        const target = list.find(p => p.id === lastId) || (list.length > 0 ? list[0] : null);
        if (target) {
          applyProfileObj(target);
        } else {
          const countrySelect = document.getElementById('ppo-in-country');
          if (countrySelect) countrySelect.value = '10206';
        }

        if (res[LAST_RESULT_KEY]) {
          renderResultBanner(res[LAST_RESULT_KEY]);
        }
      });

      if (!window.__ppoStorageListenerAttached) {
        window.__ppoStorageListenerAttached = true;
        chrome.storage.onChanged.addListener((changes, areaName) => {
          if (areaName === 'local') {
            if (changes[STORAGE_KEY]) {
              const newList = changes[STORAGE_KEY].newValue || [];
              renderProfileDropdown(newList);
            }
            if (changes[LAST_ACTIVE_KEY]) {
              const newActiveId = changes[LAST_ACTIVE_KEY].newValue;
              if (newActiveId && newActiveId !== currentProfileId) {
                applyProfileById(newActiveId);
              }
            }
            if (changes[LAST_RESULT_KEY]) {
              renderResultBanner(changes[LAST_RESULT_KEY].newValue);
            }
          }
        });
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

      chrome.storage.local.set({
        [STORAGE_KEY]: list,
        [LAST_ACTIVE_KEY]: id
      }, () => {
        currentProfileId = id;
        renderProfileDropdown(list);
        showToast(`✅ 已存入浏览器本地统一存储: ${newProfile.remark}`);
      });
    });
  }

  function applyProfileById(id) {
    chrome.storage.local.get([STORAGE_KEY], (res) => {
      const list = res[STORAGE_KEY] || [];
      const profile = list.find(p => p.id === id);
      if (profile) applyProfileObj(profile);
    });
  }

  function applyProfileObj(profile) {
    currentProfileId = profile.id;
    chrome.storage.local.set({ [LAST_ACTIVE_KEY]: profile.id });

    setFormDataToUI(profile);

    const profileDropdown = document.getElementById('ppo-profile-dropdown');
    if (profileDropdown) profileDropdown.value = profile.id;

    showToast(`👤 已载入配置: ${profile.remark}`);
  }

  function deleteCurrentProfile() {
    if (!currentProfileId) {
      showToast('⚠️ 请先在下拉菜单中选择要删除的人员配置', true);
      return;
    }

    chrome.storage.local.get([STORAGE_KEY], (res) => {
      let list = res[STORAGE_KEY] || [];
      const item = list.find(p => p.id === currentProfileId);
      if (!confirm(`确定要删除人员配置「${item ? item.remark : ''}」吗？`)) return;

      list = list.filter(p => p.id !== currentProfileId);

      chrome.storage.local.set({
        [STORAGE_KEY]: list,
        [LAST_ACTIVE_KEY]: null
      }, () => {
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
    }, 2800);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createFloatingUI);
  } else {
    createFloatingUI();
  }
})();
