const ARABIC_DIGITS = '0-9٠-٩';
const INTEGER = `[${ARABIC_DIGITS}]+`;
const MONEY = `[${ARABIC_DIGITS}.,]+(?:\\s*(?:جنيه|EGP|ج\\.م))?`;

function first(text, pattern) {
  return String(text || '').match(pattern)?.[1]?.replace(/\s+/g, ' ').trim() || '';
}

export function parseOfficialSummary(text) {
  const source = String(text || '');
  if (/لا\s+(?:توجد|يوجد)\s+مخالفات/.test(source)) {
    return { totalFine: '0 جنيه', violationCount: '0', reconcileFine: '0 جنيه' };
  }

  const totalFine = first(source, new RegExp(
    `(?:إجمالي|إجمالى|اجمالي|اجمالى)\\s+الغرامات\\s+الشاملة[^${ARABIC_DIGITS}]{0,40}(${MONEY})`, 'i'
  )) || first(source, new RegExp(
    `المبلغ\\s+(?:الإجمالي|الاجمالي)[^${ARABIC_DIGITS}]{0,40}(${MONEY})`, 'i'
  ));

  // 必须使用官网的完整字段名“عدد المخالفات”。仅匹配“المخالفات”会从页面标题
  // 开始搜索并把前面的总罚款金额误当成违章笔数。
  const violationCount = first(source, new RegExp(
    `عدد\\s+المخالفات[^${ARABIC_DIGITS}]{0,30}(${INTEGER})`, 'i'
  ));

  const reconcileFine = first(source, new RegExp(
    `(?:إجمالي|إجمالى|اجمالي|اجمالى)\\s+غرامات\\s+التصالح[^${ARABIC_DIGITS}]{0,40}(${MONEY})`, 'i'
  )) || first(source, new RegExp(
    `قيمة\\s+التصالح[^${ARABIC_DIGITS}]{0,40}(${MONEY})`, 'i'
  ));

  return {
    totalFine: totalFine || '0 جنيه',
    violationCount: violationCount || '0',
    reconcileFine: reconcileFine || '0 جنيه'
  };
}
