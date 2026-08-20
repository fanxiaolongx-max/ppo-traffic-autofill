/**
 * 语言与数字转换工具库
 * 支持标准数字 (0-9)、东阿拉伯数字 (埃及 ٠-٩)、波斯数字 (۰-۹) 转换及常见阿文字母表
 */

const NumberUtils = {
  // 标准数字 (0-9)
  latinDigits: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
  
  // 东阿拉伯数字 (埃及/中东官方标准: ٠ ١ ٢ ٣ ٤ ٥ ٦ ٧ ٨ ٩)
  easternArabicDigits: ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'],
  
  // 波斯数字 (Farsi: ۰ ۱ ۲ ۳ ۴ ۵ ۶ ۷ ۸ ۹)
  persianDigits: ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'],

  // 常见埃及车牌阿拉伯字母表 (方便用户直接点选，免安装阿文输入法)
  arabicPlateLetters: [
    { ar: 'أ', name: 'Alif' },
    { ar: 'ب', name: 'Baa' },
    { ar: 'ج', name: 'Geem' },
    { ar: 'د', name: 'Daal' },
    { ar: 'ر', name: 'Raa' },
    { ar: 'س', name: 'Seen' },
    { ar: 'ص', name: 'Saad' },
    { ar: 'ط', name: 'Taa' },
    { ar: 'ع', name: 'Ain' },
    { ar: 'ف', name: 'Faa' },
    { ar: 'ق', name: 'Qaaf' },
    { ar: 'ل', name: 'Laam' },
    { ar: 'م', name: 'Meem' },
    { ar: 'ن', name: 'Noon' },
    { ar: 'ه', name: 'Haa' },
    { ar: 'و', name: 'Waaw' },
    { ar: 'ي', name: 'Yaa' }
  ],

  /**
   * 转为东阿拉伯数字 (埃及常用 ٠-٩)
   */
  toEasternArabic(str) {
    if (!str && str !== 0) return '';
    return String(str)
      .replace(/[0-9]/g, d => this.easternArabicDigits[parseInt(d, 10)])
      .replace(/[۰-۹]/g, d => {
        const idx = this.persianDigits.indexOf(d);
        return idx !== -1 ? this.easternArabicDigits[idx] : d;
      });
  },

  /**
   * 转为波斯数字 (۰-۹)
   */
  toPersian(str) {
    if (!str && str !== 0) return '';
    return String(str)
      .replace(/[0-9]/g, d => this.persianDigits[parseInt(d, 10)])
      .replace(/[٠-٩]/g, d => {
        const idx = this.easternArabicDigits.indexOf(d);
        return idx !== -1 ? this.persianDigits[idx] : d;
      });
  },

  /**
   * 转为标准英数 (0-9)
   */
  toLatin(str) {
    if (!str && str !== 0) return '';
    return String(str)
      .replace(/[٠-٩]/g, d => this.easternArabicDigits.indexOf(d).toString())
      .replace(/[۰-۹]/g, d => this.persianDigits.indexOf(d).toString());
  },

  /**
   * 按照目标格式转换
   * @param {string} str 待转字符串
   * @param {'eastern'|'persian'|'latin'} mode 目标模式
   */
  convert(str, mode = 'eastern') {
    if (mode === 'eastern') return this.toEasternArabic(str);
    if (mode === 'persian') return this.toPersian(str);
    if (mode === 'latin') return this.toLatin(str);
    return str;
  }
};

/**
 * 埃及当地时段工具
 *
 * 用途：官方后端在埃及当地深夜时段容易出现「حدث خطأ أثناء معالجة الطلب」(处理请求出错)，
 * 此时前端页面一切正常、表单也能提交，但后端服务调不通，查询必然失败。
 * 查询前先做提醒，避免用户以为是自己车牌或证件填错了。
 *
 * 注意：必须按埃及当地时间判断，不能用本机时间 —— 用户可能身处任意时区，
 * 而官方系统的作息只跟开罗时间有关。
 */
const EgyptTimeUtils = {
  NIGHT_START_HOUR: 0,   // 埃及当地 00:00 起
  NIGHT_END_HOUR: 6,     // 埃及当地 06:00 止 (不含)
  TIMEZONE: 'Africa/Cairo',
  SKIP_KEY: 'ppo_night_warning_skip_date',

  /** 取埃及当地小时数 (0-23)，取不到时回退本机时间 */
  getCairoHour() {
    try {
      const text = new Intl.DateTimeFormat('en-US', {
        timeZone: this.TIMEZONE,
        hour: '2-digit',
        hour12: false,
        hourCycle: 'h23'
      }).format(new Date());
      const hour = parseInt(text, 10);
      if (Number.isNaN(hour)) return new Date().getHours();
      return hour % 24; // 部分实现会把午夜返回成 24
    } catch (e) {
      return new Date().getHours();
    }
  },

  /** 取埃及当地时刻文本，如 "00:35" */
  getCairoTimeText() {
    try {
      return new Intl.DateTimeFormat('zh-CN', {
        timeZone: this.TIMEZONE,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        hourCycle: 'h23'
      }).format(new Date());
    } catch (e) {
      return '';
    }
  },

  /** 取埃及当地日期，如 "2026-08-20"，用于「今天不再提示」 */
  getCairoDateStr() {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: this.TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(new Date());
    } catch (e) {
      return new Date().toISOString().slice(0, 10);
    }
  },

  /** 当前是否处于埃及当地深夜时段 */
  isLateNight() {
    const hour = this.getCairoHour();
    return hour >= this.NIGHT_START_HOUR && hour < this.NIGHT_END_HOUR;
  },

  /** 供界面直接展示的提醒文案 */
  getWarningText() {
    return `现在是埃及当地 ${this.getCairoTimeText()}，属于深夜时段。\n\n`
      + '官方后端服务在深夜容易出现「处理请求出错 / 会话已结束」，此时无论用扩展还是手动填表都查不出结果，'
      + '与你填写的车牌、护照号无关。\n\n建议在埃及当地白天再查询。';
  },

  /** 今天是否已被用户选择「不再提示」 */
  isSuppressedToday() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([this.SKIP_KEY], (res) => {
          resolve(res && res[this.SKIP_KEY] === this.getCairoDateStr());
        });
      } catch (e) {
        resolve(false);
      }
    });
  },

  /** 记录今天不再提示 */
  suppressForToday() {
    try {
      chrome.storage.local.set({ [this.SKIP_KEY]: this.getCairoDateStr() });
    } catch (e) {}
  },

  /** 是否需要在本次查询前提醒 */
  async shouldWarnBeforeQuery() {
    if (!this.isLateNight()) return false;
    return !(await this.isSuppressedToday());
  }
};

if (typeof window !== 'undefined') {
  window.NumberUtils = NumberUtils;
  window.EgyptTimeUtils = EgyptTimeUtils;
}
