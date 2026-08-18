/**
 * PPO 埃及车辆违章 (مخالفات رخص المركبات - 车牌号查询) 表单全量采集脚本
 * 
 * 使用方法：
 * 1. 确保当前停留在 "مخالفات رخص المركبات" (车辆牌照违章) 页面
 * 2. 按 F12 打开 Console (控制台)
 * 3. 粘贴本代码并回车运行
 * 4. 结果会自动复制到剪贴板，直接粘贴发到对话中即可！
 */

(() => {
  console.log("%c🚗 正在采集「مخالفات رخص المركبات (车牌违章)」表单结构与字段信息...", "color: #eab308; font-size: 15px; font-weight: bold;");

  const result = {
    url: window.location.href,
    title: document.title,
    isApex: typeof window.apex !== "undefined",
    activeTab: "مخالفات رخص المركبات",
    apexItems: [],
    plateInputs: [],     // 车牌输入框 (字母框、数字框)
    allInputs: [],       // 所有输入框
    selects: [],         // 下拉选择框 (国籍、省份等)
    radios: {},          // 单选框组 (如: 字母+数字 / 纯数字，所有者类型等)
    buttons: []          // 提交查询等按钮
  };

  // 1. APEX 全局 items 探测
  if (result.isApex && window.apex.item) {
    try {
      document.querySelectorAll("[id^='P']").forEach(el => {
        if (el.id && window.apex.item(el.id)) {
          const item = window.apex.item(el.id);
          result.apexItems.push({
            id: el.id,
            value: item.getValue ? item.getValue() : el.value,
            nodeName: el.nodeName,
            className: el.className
          });
        }
      });
    } catch (e) {
      console.warn("APEX error:", e);
    }
  }

  // 辅助函数：查找元素关联的 Label
  function getLabelText(el) {
    if (el.id) {
      const label = document.querySelector(`label[for='${el.id}']`);
      if (label && label.innerText.trim()) return label.innerText.trim();
    }
    const parentLabel = el.closest('label');
    if (parentLabel && parentLabel.innerText.trim()) return parentLabel.innerText.trim();
    const formGroup = el.closest('.t-Form-fieldContainer, .form-group, .field, div');
    if (formGroup) {
      const labelEl = formGroup.querySelector('.t-Form-label, label, .label');
      if (labelEl && labelEl.innerText.trim()) return labelEl.innerText.trim();
    }
    return el.placeholder || el.getAttribute('aria-label') || el.name || "";
  }

  // 2. 采集所有 input 元素
  document.querySelectorAll('input:not([type="hidden"]), textarea').forEach(input => {
    const inputType = (input.type || 'text').toLowerCase();
    
    if (inputType === 'radio') {
      const groupName = input.name || 'unnamed_radio_group';
      if (!result.radios[groupName]) result.radios[groupName] = [];
      let radioLabel = "";
      if (input.id) {
        const l = document.querySelector(`label[for='${input.id}']`);
        if (l) radioLabel = l.innerText.trim();
      }
      if (!radioLabel && input.parentElement) {
        radioLabel = input.parentElement.innerText.trim();
      }
      result.radios[groupName].push({
        id: input.id || null,
        value: input.value,
        label: radioLabel,
        checked: input.checked,
        isVisible: input.offsetParent !== null
      });
    } else if (inputType !== 'button' && inputType !== 'submit') {
      const itemData = {
        tag: input.tagName.toLowerCase(),
        id: input.id || null,
        name: input.name || null,
        type: input.type || 'text',
        maxLength: input.maxLength > 0 ? input.maxLength : null,
        placeholder: input.placeholder || null,
        label: getLabelText(input),
        currentValue: input.value || "",
        className: input.className,
        isVisible: input.offsetParent !== null
      };

      result.allInputs.push(itemData);

      // 特别标记车牌输入框 (如 1-3 个字母输入框 + 数字输入框)
      if (input.closest('.t-Form-fieldContainer') || input.maxLength <= 4 || /plate|license|char|num|رقم|حرف/i.test(input.id + input.name + itemData.label)) {
        result.plateInputs.push(itemData);
      }
    }
  });

  // 3. 采集所有下拉菜单 (例如: 国籍 الجنسية / 省份 等)
  document.querySelectorAll('select').forEach(select => {
    const options = Array.from(select.options).map(opt => ({
      value: opt.value,
      text: opt.innerText.trim(),
      selected: opt.selected
    }));
    result.selects.push({
      id: select.id || null,
      name: select.name || null,
      label: getLabelText(select),
      className: select.className,
      isVisible: select.offsetParent !== null,
      optionsCount: options.length,
      optionsSample: options.slice(0, 10),
      allOptions: options
    });
  });

  // 4. 采集所有按钮 (如: إجمالي المخالفات)
  document.querySelectorAll('button, input[type="button"], input[type="submit"], a.t-Button').forEach(btn => {
    const text = btn.innerText.trim() || btn.value || "";
    if (text) {
      result.buttons.push({
        text: text,
        id: btn.id || null,
        type: btn.type || 'button',
        className: btn.className,
        isVisible: btn.offsetParent !== null
      });
    }
  });

  const jsonString = JSON.stringify(result, null, 2);

  // 自动复制到剪贴板
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(jsonString).then(() => {
      console.log("%c✅ 扫描完成！车牌违章表单数据已复制到剪贴板，请直接粘贴发给我！", "color: #22c55e; font-size: 16px; font-weight: bold;");
    });
  }

  console.log("=== 完整 JSON 数据 ===");
  console.log(jsonString);
  return result;
})();
