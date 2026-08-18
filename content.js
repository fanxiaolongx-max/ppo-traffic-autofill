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
    
    const passportInput = document.getElementById('ppo-in-passport-no');
    passportInput.addEventListener('input', () => {
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

    activeQueryData = { ...data };
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

    const cleanUrl = TARGET_PPO_URL + '?clear=201,14,RP';

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
          startQueryWatchdog();
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

    if (combined.includes('حدث خطأ أثناء تنفيذ الخدمة')) {
      return {
        title: '⚠️ 官方服务执行出错 (خطأ أثناء تنفيذ الخدمة)',
        detail: '车牌与填入的证件号不匹配（该车可能属于其他所有人），或官方车辆库当前繁忙。',
        suggestion: '请仔细核对车牌字母、数字及护照号是否完全属于该登记人。已自动关闭官方报错弹窗。',
        autoDismiss: true
      };
    }
    if (combined.includes('رقم اللوحة') || combined.includes('حروف اللوحة')) {
      return {
        title: '⚠️ 车牌号码格式错误 (رقم اللوحة غير صحيح)',
        detail: '填写的车牌字母或数字格式不符合埃及交通局规范。',
        suggestion: '请核对车牌前2~3个字母与数字组合。',
        autoDismiss: true
      };
    }
    if (combined.includes('رقم جواز السفر') || combined.includes('الرقم القومي')) {
      return {
        title: '⚠️ 证件号码不匹配 (بيانات الرقم القومي / الجواز)',
        detail: '护照号或埃及身份证号格式有误或与该车不符。',
        suggestion: '请确保护照号输入纯数字部分，或核对埃及14位身份证号。',
        autoDismiss: true
      };
    }
    if (combined.includes('الخدمة غير متاحة') || combined.includes('صيانة') || combined.includes('غير متوفرة')) {
      return {
        title: '🚧 官方系统正在维护 (الخدمة غير متاحة)',
        detail: '埃及交通违章查询接口当前正在维护或临时脱机。',
        suggestion: '建议稍候几分钟后再试。',
        autoDismiss: true
      };
    }
    if (combined.includes('انتهت الجلسة') || combined.includes('session expired') || combined.includes('wwv_flow')) {
      return {
        title: '⏱️ 官方系统会话已过期 (انتهت صلاحية الجلسة)',
        detail: '长时间停留在页面导致 APEX 会话令牌失效。',
        suggestion: '点击下方「🔄 刷新重试」即可重新建立会话并自动填表。',
        autoDismiss: false
      };
    }
    if (combined.includes('502 bad gateway') || combined.includes('503 service') || combined.includes('504 gateway')) {
      return {
        title: '🌐 官方网关超时脱机 (502/503/504)',
        detail: '埃及政府网络网关无响应或遭遇网络拥堵。',
        suggestion: '请检查网络连接或运行 trust_ppo_cert.sh 证书信任脚本。',
        autoDismiss: false
      };
    }

    return {
      title: '⚠️ 官方系统返回异常提示',
      detail: dialogText ? dialogText.slice(0, 100) : '页面检测到官方异常提示信息。',
      suggestion: '请核对输入数据后重试。',
      autoDismiss: true
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

  function checkAndScrapeResults() {
    const isSummaryPage = window.location.href.includes('traffic-fines-summary');
    
    // 性能极速放行：在普通表单页且未处于等待状态时，不执行重度 DOM 遍历与 Reflow
    const errorDialog = document.querySelector('.ui-dialog, .t-Alert--error, div[role="dialog"]');
    if (!isSummaryPage && !errorDialog && !isAwaitingQueryResult) {
      return;
    }

    const pageText = (document.body ? document.body.innerText : '') || '';
    const hasSummaryKeywords = pageText.includes('اجمالي الغرامات الشاملة') || pageText.includes('عدد المخالفات') || pageText.includes('بيانات المخالفات');

    // 1. 检查是否有官方错误弹窗 / 报错区域
    const hasError = errorDialog && (errorDialog.innerText.includes('خطأ') || errorDialog.innerText.includes('حدث خطأ') || errorDialog.innerText.includes('الخدمة غير متاحة') || errorDialog.innerText.includes('انتهت الجلسة'));

    if (hasError) {
      stopQueryWatchdog();
      isAwaitingQueryResult = false;
      const dialogText = errorDialog ? errorDialog.innerText : '';
      const classified = classifyOfficialError(pageText, dialogText);

      showDiagnosticBanner(classified.title, `${classified.detail} ${classified.suggestion}`, true);
      showToast(classified.title, true);

      saveQueryHistoryRecord('error', {
        totalFine: '0',
        violationCount: '0',
        reconcileFine: '0',
        time: new Date().toLocaleTimeString()
      }, `[官方报错]\n类型: ${classified.title}\n详情: ${classified.detail}\n原文: ${dialogText || pageText.slice(0, 300)}`);

      if (classified.autoDismiss) {
        // 自动点击错误弹窗的「موافق (确定)」或「Close/✕」按钮恢复界面
        const okBtn = Array.from(document.querySelectorAll('button, a, input[type="button"]')).find(b => 
          b.innerText && (b.innerText.includes('موافق') || b.innerText.includes('Close') || b.innerText.includes('OK') || b.innerText.includes('إغلاق'))
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

    // 2. 检查是否有无违章提示 (如: لا توجد مخالفات)
    if (pageText.includes('لا توجد مخالفات') || pageText.includes('لا يوجد مخالفات')) {
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
        const captureSign = `${totalFine}_${violationCount}_${reconcileFine}`;
        if (lastCapturedSign === captureSign) {
          return; // 已捕获过相同结果，避免重复弹窗与入库
        }
        lastCapturedSign = captureSign;

        stopQueryWatchdog();
        isAwaitingQueryResult = false;
        hideDiagnosticBanner();
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

    const pageSnapshot = (document.body ? document.body.innerText || '' : '').slice(0, 3000);
    saveQueryHistoryRecord('has_fine', res, pageSnapshot);

    showToast(`🎉 已成功获取罚款信息：总计 ${res.totalFine} (${res.violationCount} 笔违章)`);
  }

  let activeQueryData = null;
  let lastRecordedHistoryKey = '';

  function saveQueryHistoryRecord(status, resultObj, rawSnapshot) {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;

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

      // 防重机制 (15秒内相同车牌与结果不重复入库)
      const isRecentDup = historyList.slice(0, 3).some(r => {
        const rPlate = r.request?.fullPlate || '';
        const rFine = r.result?.totalFine || '';
        const rCount = r.result?.violationCount || '';
        return (rPlate === fullPlate || !fullPlate) && rFine === resultObj?.totalFine && rCount === resultObj?.violationCount && (now - r.timestamp < 15000);
      });

      if (isRecentDup) {
        return;
      }

      const countryObj = COUNTRY_OPTIONS.find(c => c.value === req?.country);
      const countryName = countryObj ? countryObj.text : (req?.country === '10206' ? 'الصين (中国 / China)' : (req?.country || '中国'));

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
          passportNo: req?.passportNo || '',
          nationalId: req?.nationalId || '',
          numeralMode: req?.numeralMode || numeralMode,
          profileName: req?.remark || (currentProfileId ? '已存配置' : '手动输入'),
          rawRequestJson: JSON.stringify(req || {}, null, 2)
        },
        result: {
          totalFine: resultObj?.totalFine || '0 جنيه',
          violationCount: resultObj?.violationCount || '0',
          reconcileFine: resultObj?.reconcileFine || '0 جنيه',
          time: resultObj?.time || new Date().toLocaleTimeString(),
          rawResponseText: rawSnapshot || ''
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

    setFormDataToUI(profile);

    const profileDropdown = document.getElementById('ppo-profile-dropdown');
    if (profileDropdown) profileDropdown.value = profile.id;

    const updateBtn = document.getElementById('ppo-btn-update-profile');
    if (updateBtn) updateBtn.style.display = 'inline-flex';

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
    // 保持静默零干扰：不主动打断官方 APEX 的正常异步组件初始化
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
})();
