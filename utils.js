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
    { ar: 'ك', name: 'Kaaf' },
    { ar: 'ل', name: 'Laam' },
    { ar: 'م', name: 'Meem' },
    { ar: 'ن', name: 'Noon' },
    { ar: 'هـ', name: 'Haa' },
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

if (typeof window !== 'undefined') {
  window.NumberUtils = NumberUtils;
}
