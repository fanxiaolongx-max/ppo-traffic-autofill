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
  const HISTORY_STORAGE_KEY = 'ppo_traffic_history_v1';

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
            <button class="ppo-tool-btn ppo-tool-btn-heal" id="ppo-btn-heal" title="主动自愈解卡与清除卡顿遮罩">🛠️ 自愈</button>
            <button class="ppo-tool-btn ppo-tool-btn-history" id="ppo-btn-history" title="查看历史记录">📜 历史</button>
            <button class="ppo-tool-btn" id="ppo-btn-minimize" title="最小化">一</button>
            <button class="ppo-tool-btn" id="ppo-btn-close" title="收起">✕</button>
          </div>
        </div>

        <!-- 智能自愈与异常诊断横幅 (超时或报错时自动唤起) -->
        <div class="ppo-diagnostic-banner" id="ppo-diagnostic-banner">
          <div class="ppo-diag-header">
            <span class="ppo-diag-icon" id="ppo-diag-icon">⚠️</span>
            <div class="ppo-diag-title-wrap">
              <div class="ppo-diag-title" id="ppo-diag-title">官方系统响应较慢</div>
              <div class="ppo-diag-desc" id="ppo-diag-desc">已自动优化连接通道...</div>
            </div>
            <button type="button" class="ppo-diag-close" id="ppo-btn-close-diag" title="关闭提示">✕</button>
          </div>
          <div class="ppo-diag-actions">
            <button type="button" class="ppo-diag-btn primary" id="ppo-diag-btn-reload">🔄 刷新页面并重试</button>
            <button type="button" class="ppo-diag-btn" id="ppo-diag-btn-unfreeze">🛠️ 强制解卡</button>
            <button type="button" class="ppo-diag-btn" id="ppo-diag-btn-home">🌐 返回官网主页</button>
          </div>
        </div>

        <!-- 内置历史记录滑出抽屉 -->
        <div class="ppo-inpage-history-drawer" id="ppo-history-drawer">
          <div class="ppo-drawer-header">
            <span class="ppo-drawer-title">📜 历史查询记录 (<span id="ppo-drawer-count">0</span>)</span>
            <div class="ppo-drawer-actions">
              <button type="button" class="ppo-drawer-action-btn" id="ppo-btn-open-full-tab" title="在新标签页中打开完整大窗口">大窗口 ↗</button>
              <button type="button" class="ppo-drawer-action-btn" id="ppo-btn-close-drawer">✕</button>
            </div>
          </div>
          <div class="ppo-drawer-body" id="ppo-drawer-list">
            <!-- 动态渲染最近条目 -->
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
              <button type="button" class="ppo-profile-btn" id="ppo-btn-update-profile" title="将当前修改覆盖更新到选中的配置" style="display: none; background: rgba(212, 175, 55, 0.2); border-color: var(--ppo-gold); color: #fef08a;">
                <span>💾 覆盖更新</span>
              </button>
              <button type="button" class="ppo-profile-btn" id="ppo-btn-toggle-save" title="将当前填写的表单存为新人员配置">
                <span>➕ 新增</span>
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
                        💡 提示：请输入完整护照号，查询时会自动尝试不同格式并记忆最优结果。
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
      applyProfileById(profileDropdown.value);
    });

    document.getElementById('ppo-btn-update-profile')?.addEventListener('click', () => {
      updateCurrentProfile();
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

    document.getElementById('ppo-in-platenum').addEventListener('input', () => {
      updatePreview();
      saveLiveDraft();
    });
    
    passportInput.addEventListener('input', () => {
      updatePreview();
      saveLiveDraft();
      const hintEl = document.getElementById('ppo-passport-hint');
      if (hintEl) {
        hintEl.innerHTML = `💡 提示：请输入完整护照号，查询时会自动尝试不同格式并记忆最优结果。`;
      }
    });

    document.getElementById('ppo-in-national-id')?.addEventListener('input', () => {
      updatePreview();
      saveLiveDraft();
    });

    document.getElementById('ppo-in-country')?.addEventListener('change', () => {
      saveLiveDraft();
    });

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

    // 智能自愈与强制解卡按钮
    document.getElementById('ppo-btn-heal')?.addEventListener('click', () => {
      forceUnfreezeAndHeal();
    });

    // 异常诊断条交互事件
    document.getElementById('ppo-btn-close-diag')?.addEventListener('click', () => {
      hideDiagnosticBanner();
    });

    document.getElementById('ppo-diag-btn-reload')?.addEventListener('click', () => {
      const data = getFormDataFromUI();
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({
          pendingPpoTask: {
            data: data,
            autoSubmit: true,
            timestamp: Date.now()
          }
        }, () => {
          window.location.reload();
        });
      } else {
        window.location.reload();
      }
    });

    document.getElementById('ppo-diag-btn-unfreeze')?.addEventListener('click', () => {
      forceUnfreezeAndHeal();
    });

    document.getElementById('ppo-diag-btn-home')?.addEventListener('click', () => {
      window.location.href = TARGET_PPO_URL;
    });

    // 历史记录抽屉事件
    document.getElementById('ppo-btn-history')?.addEventListener('click', () => {
      const drawer = document.getElementById('ppo-history-drawer');
      if (drawer) {
        drawer.classList.toggle('show');
        if (drawer.classList.contains('show')) {
          renderInpageHistoryList();
        }
      }
    });

    document.getElementById('ppo-btn-close-drawer')?.addEventListener('click', () => {
      document.getElementById('ppo-history-drawer')?.classList.remove('show');
    });

    document.getElementById('ppo-btn-open-full-tab')?.addEventListener('click', () => {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ action: 'open_history_tab' });
      }
    });
  }

  let currentPassportFormat = 'raw';

  function getFormDataFromUI() {
    const rawPass = (document.getElementById('ppo-in-passport-no')?.value || '').trim();
    return {
      letter1: document.getElementById('ppo-in-letter1')?.value || '',
      letter2: document.getElementById('ppo-in-letter2')?.value || '',
      letter3: document.getElementById('ppo-in-letter3')?.value || '',
      platenum: document.getElementById('ppo-in-platenum')?.value || '',
      numeralMode: numeralMode,
      ownerType: document.querySelector('input[name="ppo_owner_type"]:checked')?.value || 'passport',
      foreignType: document.querySelector('input[name="ppo_foreign_type"]:checked')?.value || 'foreign',
      country: document.getElementById('ppo-in-country')?.value || '10206',
      passportNo: rawPass,
      passportFormat: currentPassportFormat || (/^[A-Za-z]/.test(rawPass) ? 'raw' : 'cleaned'),
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

    activeQueryData = { ...data };
    hasRetriedPassportAlternative = false;
    try {
      sessionStorage.setItem('ppo_active_query_req', JSON.stringify(activeQueryData));
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ ppo_active_query_req: activeQueryData });
      }
    } catch (e) {}

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

  // 清理当前页面内的 Session 访问痕迹 (保留 WAF 安全信任 Cookie)
  function purgeSiteSessionAndTraces() {
    try {
      sessionStorage.clear();
      localStorage.clear();
    } catch (e) {}
  }

  // 自动返回查询页面并在加载完成后重新执行填入与查询
  function navigateBackAndRequery(data, autoSubmit) {
    showToast('🔄 检测到当前在结果页，正在清除旧会话并开启全新查询...', false);
    purgeSiteSessionAndTraces();

    const cleanUrl = TARGET_PPO_URL;

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({
        pendingPpoTask: {
          data: data,
          autoSubmit: autoSubmit,
          timestamp: Date.now()
        }
      }, () => {
        window.location.href = cleanUrl;
      });
    } else {
      window.location.href = cleanUrl;
    }
  }

  function doFillOperations(data, autoSubmit) {
    activeQueryData = { ...data };
    try {
      sessionStorage.setItem('ppo_active_query_req', JSON.stringify(activeQueryData));
    } catch(e) {}

    setRadioValue('P14_CHOSE_OPTION', '1');

    const rawNum = data.platenum || '';
    const convertedPlateNum = window.NumberUtils ? window.NumberUtils.convert(rawNum, data.numeralMode || numeralMode) : rawNum;

    setFieldValue('P14_LETER_1', data.letter1 || '');
    setFieldValue('P14_LETER_2', data.letter2 || '');
    setFieldValue('P14_LETER_3', data.letter3 || '');
    setFieldValue('P14_NUMBER_WITH_LETTER', convertedPlateNum);

    const ownerType = data.ownerType || 'passport';

    if (ownerType === 'passport') {
      // 1. 强制切换官方单选为「جواز سفر (护照)」
      setRadioValue('P14_ID_TYPE_NUMS_LETTERS', '1429');

      // 2. 强制切换官方单选为「أجنبي (外籍)」
      const isForeign = data.foreignType !== 'citizen';
      setRadioValue('P14_ISFOREIGN__NUMS_LETTERS', isForeign ? '1' : '0');

      // 3. 选择签发国籍为「中国 10206」
      const countryVal = data.country || '10206';
      setSelectValue('P14_PASSPORT_ISSUE_PLACE_NUMS_LETTERS', countryVal);

      // 4. 填入护照号码 (自适应格式与生效属性强同步)
      const rawPassport = (data.rawPassportNo || data.passportNo || '').trim();
      let passportToFill = rawPassport;
      let effectiveFormat = data.passportFormat;

      if (effectiveFormat === 'raw') {
        passportToFill = rawPassport; // 明确指定为原版：直接使用带前缀字母 (如 EF2891946)
      } else if (effectiveFormat === 'cleaned') {
        passportToFill = cleanPassportNumber(rawPassport); // 明确指定为纯数字 (如 2891946)
      } else {
        if (/^[A-Za-z]/.test(rawPassport)) {
          passportToFill = rawPassport;
          effectiveFormat = 'raw';
        } else {
          passportToFill = rawPassport;
          effectiveFormat = 'cleaned';
        }
      }

      // 关键修正：确保 activeQueryData 中的 passportNo 永远是实际提交给官方的生效号码 (passportToFill)！
      activeQueryData = {
        ...data,
        passportNo: passportToFill,
        rawPassportNo: rawPassport,
        passportFormat: effectiveFormat
      };
      try {
        sessionStorage.setItem('ppo_active_query_req', JSON.stringify(activeQueryData));
      } catch (e) {}

      const finalPassport = window.NumberUtils ? window.NumberUtils.convert(passportToFill, data.numeralMode || numeralMode) : passportToFill;
      setFieldValue('P14_PASSPORT_NUM_NUMS_LETTERS', finalPassport);

      // APEX 动态显示延迟双重填入保障 (确保动态展示后值不丢失)
      setTimeout(() => {
        setFieldValue('P14_PASSPORT_NUM_NUMS_LETTERS', finalPassport);
        setSelectValue('P14_PASSPORT_ISSUE_PLACE_NUMS_LETTERS', countryVal);
      }, 250);

    } else if (ownerType === 'national_id') {
      setRadioValue('P14_ID_TYPE_NUMS_LETTERS', '2153');

      const rawId = data.nationalId || '';
      const convertedId = window.NumberUtils ? window.NumberUtils.convert(rawId, data.numeralMode || numeralMode) : rawId;
      setFieldValue('P14_NATIONAL_ID_NUMS_LETTERS', convertedId);

      setTimeout(() => {
        setFieldValue('P14_NATIONAL_ID_NUMS_LETTERS', convertedId);
      }, 250);
    }

    showToast('✅ 成功一键填入表单！');

    if (autoSubmit) {
      setTimeout(() => {
        const submitBtn = document.getElementById('GET_FIN_LETTER_NUMBERS_BTN') || 
                          document.querySelector("button[id*='GET_FIN']");
        if (submitBtn) {
          showToast('🚀 正在提交查询...');
          startQueryWatchdog();
          submitBtn.click();
        } else {
          showToast('⚠️ 请手动点击「إجمالى المخالفات」查询', true);
        }
      }, 600);
    }
  }

  function setFieldValue(id, value) {
    const el = document.getElementById(id);
    if (!el) return;

    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function setRadioValue(groupName, value) {
    const targetVal = String(value);

    // 1. 通过 input 查找并点击
    const radios = document.querySelectorAll(`input[name="${groupName}"]:not(#ppo-autofill-container *)`);
    radios.forEach(radio => {
      if (radio.value === targetVal) {
        radio.checked = true;
        try { radio.click(); } catch(e) {}
        radio.dispatchEvent(new Event('input', { bubbles: true }));
        radio.dispatchEvent(new Event('change', { bubbles: true }));

        const label = document.querySelector(`label[for="${radio.id}"]`);
        if (label) {
          try { label.click(); } catch(e) {}
        }
      } else {
        radio.checked = false;
      }
    });

    // 2. 通过官方原生 Label 文本做深度穿透点击 (确保触发 APEX 动态动作)
    if (groupName === 'P14_ID_TYPE_NUMS_LETTERS') {
      if (targetVal === '1429') {
        const passportLabels = Array.from(document.querySelectorAll('label')).filter(l => 
          !l.closest('#ppo-autofill-container') && l.innerText && l.innerText.trim().includes('جواز سفر')
        );
        passportLabels.forEach(l => {
          try { l.click(); } catch(e){}
        });
      } else if (targetVal === '2153') {
        const nidLabels = Array.from(document.querySelectorAll('label')).filter(l => 
          !l.closest('#ppo-autofill-container') && l.innerText && l.innerText.trim().includes('رقم قوم')
        );
        nidLabels.forEach(l => {
          try { l.click(); } catch(e){}
        });
      }
    } else if (groupName === 'P14_ISFOREIGN__NUMS_LETTERS') {
      if (targetVal === '1') {
        const foreignLabels = Array.from(document.querySelectorAll('label')).filter(l => 
          !l.closest('#ppo-autofill-container') && l.innerText && l.innerText.trim().includes('أجنبي')
        );
        foreignLabels.forEach(l => {
          try { l.click(); } catch(e){}
        });
      }
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
  let queryWatchdogInterval = null;
  let queryWatchdogSeconds = 0;

  // 智能主动自愈与死锁遮罩清理
  function removeBlockingOverlays(forceReset = false) {
    const overlays = document.querySelectorAll(
      '#apex_wait_overlay, .apex_wait_popup, .u-Processing, .ui-widget-overlay, ' +
      'div[class*="wait_overlay"], div[id*="wait"], div[class*="spinner"], div[class*="loading"]'
    );
    overlays.forEach(el => {
      try {
        el.style.display = 'none';
        el.remove();
      } catch (e) {}
    });

    if (forceReset) {
      document.querySelectorAll('button:disabled, input:disabled').forEach(el => {
        if (!el.closest('#ppo-autofill-container')) {
          el.disabled = false;
          el.removeAttribute('disabled');
        }
      });
    }
  }

  function startQueryWatchdog() {
    stopQueryWatchdog();
    queryWatchdogSeconds = 0;
    isAwaitingQueryResult = true;
    querySubmissionTimestamp = Date.now();
    try {
      sessionStorage.setItem('ppo_is_awaiting_query', 'true');
      sessionStorage.setItem('ppo_query_start_timestamp', String(querySubmissionTimestamp));
    } catch(e) {}

    hideDiagnosticBanner();

    queryWatchdogInterval = setInterval(() => {
      if (!isAwaitingQueryResult) {
        stopQueryWatchdog();
        return;
      }

      queryWatchdogSeconds++;

      // Stage 1: T=4s
      if (queryWatchdogSeconds === 4) {
        showToast('📡 正在等待官方违章数据库返回...', false);
      }

      // Stage 2: T=8s - 自动第1级解卡（清理挂起遮罩 & 隐式扫描）
      if (queryWatchdogSeconds === 8) {
        showToast('⚡ 官方响应较慢，已启动第 1 级通道 (自动清理挂起遮罩)...', false);
        removeBlockingOverlays(false);
        checkAndScrapeResults();
      }

      // Stage 3: T=15s - 自动第2级解卡（穿透死锁遮罩 & 强行重扫）
      if (queryWatchdogSeconds === 15) {
        showToast('🛡️ 正在执行第 2 级主动解卡 (穿透死锁遮罩并重新探测数据)...', false);
        removeBlockingOverlays(true);
        checkAndScrapeResults();
      }

      // Stage 4: T=25s - 终极自愈引导
      if (queryWatchdogSeconds >= 25) {
        stopQueryWatchdog();
        isAwaitingQueryResult = false;
        showDiagnosticBanner(
          '⚠️ 官方服务器响应超时 (>25秒)',
          '埃及公诉机关交通内网当前负载极高或 APEX 会话已脱机，建议点击下方「刷新页面并重试」重新发起。',
          true
        );
        showToast('⚠️ 官方系统响应超时，已唤起自愈诊断条', true);
      }
    }, 1000);
  }

  function stopQueryWatchdog() {
    if (queryWatchdogInterval) {
      clearInterval(queryWatchdogInterval);
      queryWatchdogInterval = null;
    }
  }

  function forceUnfreezeAndHeal() {
    removeBlockingOverlays(true);
    stopQueryWatchdog();
    isAwaitingQueryResult = false;
    checkAndScrapeResults();
    hideDiagnosticBanner();
    showToast('🎉 已执行强制自愈解卡！所有阻塞遮罩已清理，表单已重新就绪。');
  }

  function showDiagnosticBanner(title, desc, isError = true) {
    const banner = document.getElementById('ppo-diagnostic-banner');
    if (!banner) return;

    const titleEl = document.getElementById('ppo-diag-title');
    const descEl = document.getElementById('ppo-diag-desc');
    const iconEl = document.getElementById('ppo-diag-icon');

    if (titleEl) titleEl.textContent = title;
    if (descEl) descEl.textContent = desc;
    if (iconEl) iconEl.textContent = isError ? '⚠️' : 'ℹ️';

    banner.classList.add('show');
  }

  function hideDiagnosticBanner() {
    document.getElementById('ppo-diagnostic-banner')?.classList.remove('show');
  }

  // 智能阿拉伯语错误翻译与分类
  function classifyOfficialError(pageText, dialogText) {
    const combined = `${pageText} ${dialogText}`.toLowerCase();

    // 1. 车牌与证件不匹配 / 格式不正确 (الرقم القومي أو رقم الرخصة غير صحيح)
    if (combined.includes('رقم الرخصة غير صحيح') || combined.includes('الرقم القومي أو رقم الرخصة') || combined.includes('غير صحيح') || combined.includes('يرجى التحقق') || combined.includes('رقم الرخصة')) {
      return {
        title: '❌ 车牌号或证件号不匹配/不正确 (رقم الرخصة أو الرقم غير صحيح)',
        detail: '埃及交警车辆库提示：您填写的车牌号码（字母/数字）与填入的护照号/身份证号不匹配，或该车辆未登记在此证件名下。',
        suggestion: '排查指南：\n1. 请确保护照号输入纯数字部分（如护照号 E8961802，只需填入 8961802，移除首字母）；\n2. 检查车牌前 2~3 个阿拉伯字母及数字是否完全相符；\n3. 确认行驶证登记的所有人国籍与证件类型选择是否正确。已为您自动关闭官方报错弹窗。',
        autoDismiss: true,
        rawReason: 'الرقم القومي أو رقم الرخصة غير صحيح، يرجى التحقق'
      };
    }

    // 2. 官方会话已超时过期 (لقد انتهت جلستك)
    if (combined.includes('انتهت جلستك') || combined.includes('انتهت الجلسة') || combined.includes('إعادة تحميل') || combined.includes('جلسة') || combined.includes('session expired') || combined.includes('wwv_flow')) {
      return {
        title: '⏱️ 官方会话已超时过期 (انتهت جلستك)',
        detail: '长时间停留在网页或网关会话超时，埃及官方 APEX 引擎已终止本次会话。',
        suggestion: '点击自愈栏中的「🔄 刷新会话并重填」即可重新建立全新干净会话并自动填表。',
        autoDismiss: false,
        rawReason: 'لقد انتهت جلستك برجاء إعادة تحميل الصفحة'
      };
    }

    // 3. 官方服务执行出错 (حدث خطأ أثناء تنفيذ الخدمة)
    if (combined.includes('حدث خطأ أثناء تنفيذ الخدمة') || combined.includes('خطأ أثناء تنفيذ')) {
      return {
        title: '⚠️ 官方服务执行出错 (خطأ أثناء تنفيذ الخدمة)',
        detail: '官方数据接口繁忙、该车辆信息正在同步，或该车属于企业/其他特殊所有人。',
        suggestion: '请仔细核对车牌字母、数字及护照号是否完全属于该登记人。已自动关闭官方报错弹窗。',
        autoDismiss: true,
        rawReason: 'حدث خطأ أثناء تنفيذ الخدمة'
      };
    }

    if (combined.includes('الخدمة غير متاحة') || combined.includes('صيانة') || combined.includes('غير متوفرة')) {
      return {
        title: '🚧 官方系统正在维护 (الخدمة غير متاحة)',
        detail: '埃及交通违章查询接口当前正在维护或临时脱机。',
        suggestion: '建议稍候几分钟后再试。',
        autoDismiss: true,
        rawReason: 'الخدمة غير متاحة'
      };
    }

    if (combined.includes('502 bad gateway') || combined.includes('503 service') || combined.includes('504 gateway')) {
      return {
        title: '🌐 官方网关超时脱机 (502/503/504)',
        detail: '埃及政府网络网关无响应或遭遇网络拥堵。',
        suggestion: '请检查网络连接或运行 trust_ppo_cert.sh 证书信任脚本。',
        autoDismiss: false,
        rawReason: '502/503 Gateway Error'
      };
    }

    return {
      title: '⚠️ 官方系统返回异常提示',
      detail: dialogText ? dialogText.slice(0, 150) : '页面检测到官方异常提示信息。',
      suggestion: '请核对输入数据后重试。',
      autoDismiss: true,
      rawReason: dialogText || '官方异常'
    };
  }

  // 4. 实时监听并捕捉页面上的违章罚款信息与官方报错弹窗
  function ensureFloatingUIExists() {
    if (!document.getElementById('ppo-autofill-container') && document.body) {
      createFloatingUI();
    }
  }

  let scrapeDebounceTimer = null;

  function startResultObserver() {
    // 监听 DOM 动态变化（带防抖优化，绝不阻塞主线程）
    const observer = new MutationObserver(() => {
      if (scrapeDebounceTimer) clearTimeout(scrapeDebounceTimer);
      scrapeDebounceTimer = setTimeout(() => {
        checkAndScrapeResults();
      }, 500);
    });

    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        subtree: true
      });
    }
  }

  let lastCapturedSign = '';
  let lastSavedRecordFingerprint = '';
  let lastSavedRecordTimestamp = 0;
  let hasRetriedPassportAlternative = false;

  function checkAndScrapeResults() {
    const isSummaryPage = window.location.href.includes('traffic-fines-summary');
    
    // 1. 检查是否有官方错误弹窗 / 报错区域 / 警告横幅 (排除插件自身)
    const errorDialog = document.querySelector(
      '.ui-dialog:not(#ppo-autofill-container), .t-Alert, .t-Alert--error, .t-Alert--warning, .a-Alert, div[role="dialog"]:not(#ppo-autofill-container)'
    );

    const dialogText = errorDialog ? (errorDialog.innerText || '').trim() : '';
    const hasError = dialogText && (
      dialogText.includes('خطأ') || 
      dialogText.includes('حدث خطأ') || 
      dialogText.includes('الخدمة غير متاحة') || 
      dialogText.includes('انتهت الجلسة') ||
      dialogText.includes('انتهت جلستك') ||
      dialogText.includes('غير صحيح') ||
      dialogText.includes('يرجى التحقق')
    );

    // 严格限制：仅在到达官方结果摘要页、正在等待查询结果、或页面上明确浮现官方报错弹窗时才执行
    if (!isSummaryPage && !isAwaitingQueryResult && !hasError) {
      return;
    }

    if (hasError) {
      stopQueryWatchdog();
      isAwaitingQueryResult = false;
      const classified = classifyOfficialError('', dialogText);

      // 智能双模容错重试：如果是证件不匹配，且护照原版包含字母，自动切换格式重试 1 次 (跨页面刷新状态持久化)
      const isMismatchError = dialogText.includes('غير صحيح') || dialogText.includes('يرجى التحقق');
      let req = activeQueryData;
      if (!req) {
        try {
          const cached = sessionStorage.getItem('ppo_active_query_req');
          if (cached) req = JSON.parse(cached);
        } catch (e) {}
      }

      const rawPass = (req?.rawPassportNo || req?.passportNo || '').trim();
      const cleanedPass = cleanPassportNumber(rawPass);
      const retryCount = parseInt(sessionStorage.getItem('ppo_retry_count') || '0', 10);

      // 只要 rawPass 和 cleanedPass 存在差异（含有前缀字母），且是第 0 次失败，执行对称切换重试
      if (isMismatchError && retryCount === 0 && rawPass && rawPass !== cleanedPass) {
        sessionStorage.setItem('ppo_retry_count', '1');
        sessionStorage.setItem('ppo_is_awaiting_query', 'true');
        
        let nextPassToTry = '';
        let nextFormat = '';
        let switchMsg = '';

        // 判断第 1 次使用的是哪种格式：
        // 如果第 1 遍是带字母原版 (raw) -> 第 2 遍切为去头纯数字 (cleaned)
        // 如果第 1 遍是去头纯数字 (cleaned) -> 第 2 遍切为带字母原版 (raw)
        const passEl = document.getElementById('P14_PASSPORT_NUM_NUMS_LETTERS');
        const currentAttemptVal = (passEl ? passEl.value.trim() : '') || req?.passportNo || '';
        const wasFirstAttemptRaw = req?.passportFormat === 'raw' || currentAttemptVal === rawPass || /^[A-Za-z]/.test(currentAttemptVal);

        if (wasFirstAttemptRaw) {
          nextPassToTry = cleanedPass;
          nextFormat = 'cleaned';
          switchMsg = `🔄 带字母原版 [${rawPass}] 未匹配，正在自动去除前缀字母 [${cleanedPass}] 重新查询...`;
        } else {
          nextPassToTry = rawPass;
          nextFormat = 'raw';
          switchMsg = `🔄 纯数字护照 [${cleanedPass}] 未匹配，正在自动切换为带字母原版 [${rawPass}] 重新查询...`;
        }

        showToast(switchMsg, false);

        // 1. 关闭官方报错弹窗并解除遮罩
        const okBtn = Array.from(document.querySelectorAll('button, a, input[type="button"]')).find(b => 
          !b.closest('#ppo-autofill-container') && b.innerText && (b.innerText.includes('موافق') || b.innerText.includes('Close') || b.innerText.includes('OK') || b.innerText.includes('إغلاق'))
        );
        if (okBtn) {
          try { okBtn.click(); } catch(e){}
        }
        removeBlockingOverlays(true);

        // 2. 重新调用 doFillOperations 重新填表并提交
        const retryData = {
          ...req,
          ownerType: 'passport',
          passportNo: nextPassToTry,
          rawPassportNo: rawPass,
          passportFormat: nextFormat
        };
        sessionStorage.setItem('ppo_active_query_req', JSON.stringify(retryData));

        setTimeout(() => {
          doFillOperations(retryData, true);
        }, 500);
        return;
      }

      sessionStorage.removeItem('ppo_is_awaiting_query');
      sessionStorage.removeItem('ppo_retry_count');

      showDiagnosticBanner(classified.title, `${classified.detail} ${classified.suggestion}`, true);
      showToast(classified.title, true);

      let calcLatency = 0;
      if (querySubmissionTimestamp) {
        calcLatency = Date.now() - querySubmissionTimestamp;
      }

      const formattedErrorLog = [
        `=======================================================`,
        `🚨 [官方查询失败诊断与排查报告]`,
        `=======================================================`,
        `1. 失败诊断: ${classified.title}`,
        `2. 官方原始提示: ${dialogText || classified.rawReason}`,
        `3. 核心原因解析:`,
        `   ${classified.detail}`,
        `4. 解决排查建议:`,
        `   ${classified.suggestion}`,
        `5. 查询耗时: ${calcLatency ? `${calcLatency}ms` : '即时'}`,
        `=======================================================`
      ].join('\n');

      saveQueryHistoryRecord('error', {
        totalFine: '0',
        violationCount: '0',
        reconcileFine: '0',
        time: new Date().toLocaleTimeString(),
        latencyMs: calcLatency
      }, formattedErrorLog);

      if (classified.autoDismiss) {
        const okBtn = Array.from(document.querySelectorAll('button, a, input[type="button"]')).find(b => 
          !b.closest('#ppo-autofill-container') && b.innerText && (b.innerText.includes('موافق') || b.innerText.includes('Close') || b.innerText.includes('OK') || b.innerText.includes('إغلاق'))
        );
        if (okBtn) {
          setTimeout(() => {
            try { okBtn.click(); } catch(e){}
            removeBlockingOverlays(true);
          }, 800);
        } else {
          removeBlockingOverlays(true);
        }
      }
      return;
    }

    // 获取官方页面原始文本 (严格排除插件自身 DOM)
    let officialPageText = '';
    document.querySelectorAll('.t-Body-main, .t-Region, #main, .apex-item-display-only').forEach(el => {
      if (!el.closest('#ppo-autofill-container') && !el.closest('#ppo-toggle-bubble')) {
        officialPageText += ' ' + (el.innerText || '');
      }
    });

    // 2. 检查是否有无违章提示 (如: لا توجد مخالفات)
    if (officialPageText.includes('لا توجد مخالفات') || officialPageText.includes('لا يوجد مخالفات')) {
      stopQueryWatchdog();
      isAwaitingQueryResult = false;
      hideDiagnosticBanner();
      const cleanRes = {
        totalFine: '0 جنيه',
        violationCount: '0',
        reconcileFine: '0 جنيه',
        time: new Date().toLocaleTimeString()
      };
      saveQueryHistoryRecord('clean', cleanRes, '官方提示：لا توجد مخالفات (无交通违章记录)');
      displayCapturedResult(cleanRes);
      return;
    }

    // 3. 仅在官方结果摘要页或包含官方汇总标题时检测罚款数据
    const hasOfficialSummary = officialPageText.includes('اجمالي الغرامات الشاملة') || officialPageText.includes('بيانات المخالفات');
    if (isSummaryPage || hasOfficialSummary) {
      let totalFine = '';
      let violationCount = '';
      let reconcileFine = '';

      // 仅扫描官方 DOM 容器，严格排除插件自己的卡片
      const allDivs = Array.from(document.querySelectorAll('.t-Region div, .t-Region span, .t-Region td, .apex-item-display-only'));

      allDivs.forEach(el => {
        if (el.closest('#ppo-autofill-container') || el.closest('#ppo-toggle-bubble')) return;

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
        const m = officialPageText.match(/اجمالي الغرامات الشاملة[\s\S]*?([\d\u0660-\u0669,.]+\s*(جنيه|EGP)?)/);
        if (m) totalFine = m[1].replace(/\n/g, ' ').trim();
      }
      if (!violationCount) {
        const m = officialPageText.match(/عدد المخالفات[\s\S]*?([\d\u0660-\u0669]+)/);
        if (m) violationCount = m[1].trim();
      }
      if (!reconcileFine) {
        const m = officialPageText.match(/إجمالى غرامات التصالح[\s\S]*?([\d\u0660-\u0669,.]+\s*(جنيه|EGP)?)/);
        if (m) reconcileFine = m[1].replace(/\n/g, ' ').trim();
      }

      if (totalFine || violationCount) {
        const captureSign = `${totalFine}_${violationCount}_${reconcileFine}`;
        if (lastCapturedSign === captureSign) {
          return; // 已捕获过，避免重复入库
        }
        lastCapturedSign = captureSign;

        let calculatedLatency = 0;
        if (querySubmissionTimestamp) {
          calculatedLatency = Date.now() - querySubmissionTimestamp;
        } else {
          try {
            const startTs = sessionStorage.getItem('ppo_query_start_timestamp');
            if (startTs) {
              calculatedLatency = Date.now() - parseInt(startTs, 10);
            }
          } catch(e) {}
        }
        if (!calculatedLatency || calculatedLatency <= 0) {
          calculatedLatency = 1500;
        }

        stopQueryWatchdog();
        isAwaitingQueryResult = false;
        hideDiagnosticBanner();
        displayCapturedResult({
          totalFine: totalFine || '0 جنيه',
          violationCount: violationCount || '0',
          reconcileFine: reconcileFine || '0 جنيه',
          time: new Date().toLocaleTimeString(),
          latencyMs: calculatedLatency
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
    stopQueryWatchdog();
    hideDiagnosticBanner();
    renderResultBanner(res);

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ [LAST_RESULT_KEY]: res });
    }

    let req = activeQueryData;
    if (!req) {
      try {
        const cached = sessionStorage.getItem('ppo_active_query_req');
        if (cached) req = JSON.parse(cached);
      } catch (e) {}
    }
    const letters = [req?.letter1, req?.letter2, req?.letter3].filter(Boolean).join(' ');
    const platenum = req?.platenum || '';
    const fullPlate = `${letters} ${platenum}`.trim() || '埃及车辆';

    // 触发右上角插件角标 (Badge) 与系统桌面通知
    try {
      chrome.runtime.sendMessage({
        action: 'notify_query_result',
        data: res,
        plate: fullPlate
      });
    } catch (e) {}

    // 获取官方纯净快照
    let officialSnapshot = '';
    document.querySelectorAll('.t-Body-main, .t-Region, #main').forEach(el => {
      if (!el.closest('#ppo-autofill-container') && !el.closest('#ppo-toggle-bubble')) {
        officialSnapshot += ' ' + (el.innerText || '');
      }
    });
    saveQueryHistoryRecord('has_fine', res, officialSnapshot.slice(0, 3000));

    // 智能学习并自动保存/更新到常用配置库 (记住本次成功的护照格式)
    autoLearnAndSaveProfileOnSuccess(req);

    showToast(`🎉 已成功获取罚款信息：总计 ${res.totalFine} (${res.violationCount} 笔违章)`);
  }

  // 自动将本次查询成功的车辆与对应生效护照格式（纯数字 vs 带字母原版）更新或存入常用配置库
  function autoLearnAndSaveProfileOnSuccess(req) {
    if (!req) {
      try {
        const cached = sessionStorage.getItem('ppo_active_query_req');
        if (cached) req = JSON.parse(cached);
      } catch (e) {}
    }
    if (!req || (!req.platenum && !req.letter1)) return;
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;

    const platenum = (req.platenum || '').trim();
    const l1 = (req.letter1 || '').trim();
    const l2 = (req.letter2 || '').trim();
    const l3 = (req.letter3 || '').trim();
    const letters = [l1, l2, l3].filter(Boolean).join(' ');
    const fullPlate = `${letters} ${platenum}`.trim() || '埃及车辆';

    // 获取官方页面表单上实际生效的护照号与模式
    const passInput = document.getElementById('P14_PASSPORT_NUM_NUMS_LETTERS');
    const winningPass = (passInput ? passInput.value.trim() : '') || (req.passportNo || '').trim();
    const isRawLetter = /^[A-Za-z]/.test(winningPass) || req.passportFormat === 'raw';
    const winningFormat = isRawLetter ? 'raw' : 'cleaned';
    const rawPass = (req.rawPassportNo || req.passportNo || '').trim() || winningPass;

    chrome.storage.local.get([STORAGE_KEY, LAST_ACTIVE_KEY], (store) => {
      let list = store[STORAGE_KEY] || [];
      let updated = false;

      // 寻找是否已存在相同车牌或相同 ID 的配置
      let profile = list.find(p => p.id === currentProfileId) || 
                    list.find(p => p.platenum === platenum && p.letter1 === l1 && p.letter2 === l2);

      if (profile) {
        profile.passportNo = winningPass;
        profile.rawPassportNo = rawPass;
        profile.passportFormat = winningFormat;
        profile.letter1 = l1;
        profile.letter2 = l2;
        profile.letter3 = l3;
        profile.platenum = platenum;
        profile.ownerType = req.ownerType || 'passport';
        profile.country = req.country || '10206';
        profile.numeralMode = req.numeralMode || numeralMode;
        if (req.nationalId) profile.nationalId = req.nationalId;
        updated = true;
      } else {
        const newId = 'prof_' + Date.now() + Math.random().toString(36).substr(2, 4);
        const defaultRemark = req.remark || `${winningPass ? winningPass + ' ' : ''}(${platenum})`;
        profile = {
          id: newId,
          remark: defaultRemark,
          letter1: l1,
          letter2: l2,
          letter3: l3,
          platenum: platenum,
          numeralMode: req.numeralMode || numeralMode,
          ownerType: req.ownerType || 'passport',
          foreignType: req.foreignType || 'foreign',
          country: req.country || '10206',
          passportNo: winningPass,
          rawPassportNo: rawPass,
          passportFormat: winningFormat,
          nationalId: req.nationalId || ''
        };
        list.push(profile);
        updated = true;
      }

      if (updated) {
        currentProfileId = profile.id;
        currentPassportFormat = winningFormat;
        saveProfilesListPermanently(list, profile.id, () => {
          renderProfileDropdown(list);
          updatePassportHint(winningPass, winningFormat);
        });
      }
    });
  }

  let activeQueryData = null;

  function saveQueryHistoryRecord(status, resultObj, rawSnapshot) {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;

    let req = activeQueryData;
    if (!req) {
      try {
        const cached = sessionStorage.getItem('ppo_active_query_req');
        if (cached) req = JSON.parse(cached);
      } catch (e) {}
    }

    const letters = [req?.letter1, req?.letter2, req?.letter3].filter(Boolean).join(' ');
    const platenum = req?.platenum || '';
    const fullPlate = `${letters} ${platenum}`.trim() || '埃及车辆';

    // 严格防重入：针对报错设定 3 秒短防抖，针对普通结果设定 10 秒防抖
    const fp = `${fullPlate}_${resultObj.totalFine}_${resultObj.violationCount}_${status}`;
    const now = Date.now();
    const deDupWindow = status === 'error' ? 3000 : 10000;
    if (lastSavedRecordFingerprint === fp && (now - lastSavedRecordTimestamp < deDupWindow)) {
      return;
    }
    lastSavedRecordFingerprint = fp;
    lastSavedRecordTimestamp = now;

    chrome.storage.local.get([
      HISTORY_STORAGE_KEY,
      'ppo_active_query_req',
      'pendingPpoTask',
      'ppo_traffic_live_draft',
      STORAGE_KEY,
      LAST_ACTIVE_KEY
    ], (store) => {
      let req = activeQueryData;
      if (!req) {
        try {
          const cached = sessionStorage.getItem('ppo_active_query_req');
          if (cached) req = JSON.parse(cached);
        } catch (e) {}
      }
      if (!req) req = store.ppo_active_query_req;
      if (!req) req = store.pendingPpoTask?.data;
      if (!req && store.ppo_traffic_live_draft && (store.ppo_traffic_live_draft.platenum || store.ppo_traffic_live_draft.letter1)) {
        req = store.ppo_traffic_live_draft;
      }
      if (!req && store[STORAGE_KEY] && store[STORAGE_KEY].length > 0) {
        const lastId = store[LAST_ACTIVE_KEY];
        req = store[STORAGE_KEY].find(p => p.id === lastId) || store[STORAGE_KEY][0];
      }
      if (!req) {
        req = getFormDataFromUI();
      }

      const platenum = req?.platenum || '';
      const letters = [req?.letter1, req?.letter2, req?.letter3].filter(Boolean).join(' ');
      const fullPlate = `${letters} ${platenum}`.trim() || '埃及车辆';
      const passportNo = req?.passportNo || req?.nationalId || '';

      const now = Date.now();
      const historyList = store[HISTORY_STORAGE_KEY] || [];

      // 防重机制 (区分状态与合理时间窗口)
      const isRecentDup = historyList.slice(0, 3).some(r => {
        const rPlate = r.request?.fullPlate || '';
        const rFine = r.result?.totalFine || '';
        const rCount = r.result?.violationCount || '';
        const rStatus = r.status || '';
        const timeDiff = now - r.timestamp;

        if (status === 'error') {
          return rStatus === 'error' && rPlate === fullPlate && timeDiff < 3000;
        }
        return rStatus === status && (rPlate === fullPlate || !fullPlate) && rFine === resultObj?.totalFine && rCount === resultObj?.violationCount && timeDiff < 10000;
      });

      if (isRecentDup) {
        return;
      }

      const countryObj = COUNTRY_OPTIONS.find(c => c.value === req?.country);
      const countryName = countryObj ? countryObj.text : (req?.country === '10206' ? 'الصين (中国 / China)' : (req?.country || '中国'));

      const winningPass = req?.passportNo || (document.getElementById('P14_PASSPORT_NUM_NUMS_LETTERS')?.value.trim()) || '';
      const winningFormat = req?.passportFormat || (/^[A-Za-z]/.test(winningPass) ? 'raw' : 'cleaned');
      const rawPass = req?.rawPassportNo || winningPass;

      const historyRecord = {
        id: 'hist_' + now + '_' + Math.random().toString(36).substr(2, 6),
        timestamp: now,
        dateTime: new Date().toLocaleString('zh-CN', { hour12: false }),
        status: status, // 'has_fine' | 'clean' | 'error'
        request: {
          letter1: req?.letter1 || '',
          letter2: req?.letter2 || '',
          letter3: req?.letter3 || '',
          plateLetters: letters,
          platenum: platenum,
          fullPlate: fullPlate,
          ownerType: req?.ownerType || 'passport',
          foreignType: req?.foreignType || 'foreign',
          country: req?.country || '10206',
          countryName: countryName,
          passportNo: winningPass,
          rawPassportNo: rawPass,
          passportFormat: winningFormat,
          nationalId: req?.nationalId || '',
          numeralMode: req?.numeralMode || numeralMode,
          profileName: req?.remark || (currentProfileId ? '已存配置' : '手动输入'),
          rawRequestJson: JSON.stringify({
            ...req,
            passportNo: winningPass,
            rawPassportNo: rawPass,
            passportFormat: winningFormat
          }, null, 2)
        },
        result: {
          totalFine: resultObj?.totalFine || '0 جنيه',
          violationCount: resultObj?.violationCount || '0',
          reconcileFine: resultObj?.reconcileFine || '0 جنيه',
          time: resultObj?.time || new Date().toLocaleTimeString(),
          latencyMs: resultObj?.latencyMs || 1500,
          rawResponseText: rawSnapshot || `[后台智能抓取]\n总罚款: ${resultObj?.totalFine || '0 جنيه'}\n违章笔数: ${resultObj?.violationCount || '0'}\n和解金额: ${resultObj?.reconcileFine || '0 جنيه'}\n耗时: ${resultObj?.latencyMs || 1500}ms`
        }
      };

      historyList.unshift(historyRecord);
      const trimmed = historyList.slice(0, 500);
      chrome.storage.local.set({ [HISTORY_STORAGE_KEY]: trimmed }, () => {
        renderInpageHistoryList();
      });
    });
  }

  function renderInpageHistoryList() {
    const listEl = document.getElementById('ppo-drawer-list');
    const countEl = document.getElementById('ppo-drawer-count');
    if (!listEl) return;

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get([HISTORY_STORAGE_KEY], (res) => {
        const list = res[HISTORY_STORAGE_KEY] || [];
        if (countEl) countEl.textContent = list.length;

        if (list.length === 0) {
          listEl.innerHTML = '<div class="ppo-drawer-empty">暂无历史查询记录</div>';
          return;
        }

        const recent = list.slice(0, 15);
        listEl.innerHTML = recent.map(rec => {
          const letters = [rec.request?.letter1, rec.request?.letter2, rec.request?.letter3].filter(Boolean).join(' ') || '-';
          const num = rec.request?.platenum || '-';
          const fine = rec.result?.totalFine || '0 جنيه';
          const count = rec.result?.violationCount || '0';
          const isError = rec.status === 'error';
          const isFine = !isError && (parseFloat(fine.replace(/[^\d.]/g, '')) > 0 || parseInt(count, 10) > 0);

          return `
            <div class="ppo-drawer-item ${isFine ? 'has-fine' : ''}">
              <div class="ppo-d-left">
                <div class="ppo-d-plate">
                  <span class="ppo-d-letters">${letters}</span>
                  <span class="ppo-d-num">${num}</span>
                </div>
                <div class="ppo-d-time">${rec.dateTime || ''} · ${rec.request?.passportNo || rec.request?.nationalId || ''}</div>
              </div>
              <div class="ppo-d-right">
                <div class="ppo-d-fine ${isFine ? 'gold' : ''}">${isError ? '出错' : fine}</div>
                <button type="button" class="ppo-d-refill-btn" data-id="${rec.id}">填入</button>
              </div>
            </div>
          `;
        }).join('');

        listEl.querySelectorAll('.ppo-d-refill-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const id = btn.dataset.id;
            const target = list.find(r => r.id === id);
            if (target && target.request) {
              setFormDataToUI(target.request);
              showToast(`已填入历史记录: ${target.request.fullPlate}`);
              document.getElementById('ppo-history-drawer')?.classList.remove('show');
            }
          });
        });
      });
    }
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
          
          let hasClickedTab = false;
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
              }, 200);
            } else if (vehicleTab && !hasClickedTab) {
              hasClickedTab = true;
              try { vehicleTab.click(); } catch(e){}
            }

            if (retries >= 15) {
              clearInterval(timer);
              fillPPOForm(task.data, task.autoSubmit);
            }
          }, 300);
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

  // 6. 全局多配置管理体系 (纯原生 chrome.storage.local + chrome.storage.sync 双重灾备，跨全网全浏览器统一共享，永不丢失)
  const DRAFT_KEY = 'ppo_traffic_live_draft';

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

  function syncProfilesFromStorage() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get([STORAGE_KEY, LAST_ACTIVE_KEY, LAST_RESULT_KEY, DRAFT_KEY], (res) => {
        let list = res[STORAGE_KEY] || [];
        let lastId = res[LAST_ACTIVE_KEY];

        // 若 local 为空，从 sync 云端恢复
        if (list.length === 0 && typeof chrome.storage.sync !== 'undefined') {
          chrome.storage.sync.get([STORAGE_KEY, LAST_ACTIVE_KEY], (syncRes) => {
            if (syncRes && syncRes[STORAGE_KEY] && syncRes[STORAGE_KEY].length > 0) {
              list = syncRes[STORAGE_KEY];
              lastId = syncRes[LAST_ACTIVE_KEY] || lastId;
              chrome.storage.local.set({ [STORAGE_KEY]: list, [LAST_ACTIVE_KEY]: lastId });
            }
            processLoadedProfiles(list, lastId, res);
          });
        } else {
          processLoadedProfiles(list, lastId, res);
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
      renderResultBanner(res[LAST_RESULT_KEY]);
    }
  }

  function updatePassportHint(pass, format) {
    const hintEl = document.getElementById('ppo-passport-hint');
    if (!hintEl) return;
    const raw = (pass || document.getElementById('ppo-in-passport-no')?.value || '').trim();
    if (!raw) {
      hintEl.innerHTML = `💡 提示：系统已具备自学习记忆能力，将自动为您使用并记忆该车辆在交警库中生效的护照格式。`;
      return;
    }
    const isRaw = format === 'raw' || (/^[A-Za-z]/.test(raw) && format !== 'cleaned');
    if (isRaw) {
      hintEl.innerHTML = `🏷️ 护照提交格式: <strong style="color:#60a5fa;">🔤 完整原版 [${raw}]</strong> (查询将直接使用此格式一次性命中)`;
    } else {
      hintEl.innerHTML = `🏷️ 护照提交格式: <strong style="color:#34d399;">🔢 去前缀纯数字 [${cleanPassportNumber(raw)}]</strong> (查询将使用纯数字格式提交)`;
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
      const isRaw = item.passportFormat === 'raw' || /^[A-Za-z]/.test(item.passportNo || '');
      const formatTag = item.ownerType === 'national_id' ? ' [🆔身份证]' : (isRaw ? ' [🔤带字母]' : ' [🔢纯数字]');
      opt.textContent = `👤 ${titleText}${formatTag}`;
      opt.title = `${titleText} (护照: ${item.passportNo || '无'} / 格式: ${isRaw ? '带字母原版' : '纯数字'})`;
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
        showToast(`✅ 已永久存入浏览器本地与云端: ${newProfile.remark}`);
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

      const formData = getFormDataFromUI();
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

  function applyProfileById(id) {
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
      if (profile) applyProfileObj(profile);
    });
  }

  function applyProfileObj(profile) {
    currentProfileId = profile.id;
    chrome.storage.local.set({ [LAST_ACTIVE_KEY]: profile.id });

    currentPassportFormat = profile.passportFormat || (/^[A-Za-z]/.test(profile.passportNo || '') ? 'raw' : 'cleaned');
    setFormDataToUI(profile);

    const profileDropdown = document.getElementById('ppo-profile-dropdown');
    if (profileDropdown) profileDropdown.value = profile.id;

    const updateBtn = document.getElementById('ppo-btn-update-profile');
    if (updateBtn) updateBtn.style.display = 'inline-flex';

    updatePassportHint(profile.passportNo, currentPassportFormat);
    showToast(`👤 已载入配置: ${profile.remark}`);
  }

  function applyDraftObj(draft) {
    if (!draft) return;
    setFormDataToUI(draft);
  }

  let draftDebounceTimer = null;
  function saveLiveDraft() {
    if (draftDebounceTimer) clearTimeout(draftDebounceTimer);
    draftDebounceTimer = setTimeout(() => {
      const data = getFormDataFromUI();
      chrome.storage.local.set({ [DRAFT_KEY]: data });
    }, 300);
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

    const updateBtn = document.getElementById('ppo-btn-update-profile');
    if (updateBtn) updateBtn.style.display = 'none';

    setActiveLetterFocus('letter1');
    document.getElementById('ppo-in-letter1')?.focus();
    updatePreview();
  }

  let toastTimer = null;

  function showToast(msg, isError = false) {
    const toast = document.getElementById('ppo-toast');
    if (!toast) return;
    if (toastTimer) clearTimeout(toastTimer);
    toast.innerText = msg;
    toast.style.background = isError ? 'var(--ppo-danger)' : 'var(--ppo-success)';
    toast.classList.add('show');
    toastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, 2800);
  }

  function ensureFormFieldsInteractable() {
    const fields = [
      'P14_LICENSE_LETTERS_FIRST',
      'P14_LICENSE_LETTERS_SECOND',
      'P14_LICENSE_LETTERS_LAST',
      'P14_LICENSE_NUMBERS',
      'P14_IDENTIFIER_NUMBER',
      'P14_NATIONALITY_ID'
    ];
    fields.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.disabled = false;
        el.removeAttribute('disabled');
        el.style.pointerEvents = 'auto';
      }
    });
  }

  function initApp() {
    createFloatingUI();

    // 恢复查询与自动重试生命周期状态 (支持官方整页刷新后的状态接续)
    const storedAwaiting = sessionStorage.getItem('ppo_is_awaiting_query');
    if (storedAwaiting === 'true') {
      isAwaitingQueryResult = true;
      try {
        const cached = sessionStorage.getItem('ppo_active_query_req');
        if (cached) activeQueryData = JSON.parse(cached);
      } catch(e) {}
      startQueryWatchdog();
      setTimeout(() => {
        checkAndScrapeResults();
      }, 500);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
})();
