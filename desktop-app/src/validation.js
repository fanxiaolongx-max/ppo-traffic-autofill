import { isValidChinaPassport, normalizeChinaPassport } from '../public/passport-format.js';

const ALLOWED_PLATE_LETTERS = new Set(['أ', 'ب', 'ج', 'د', 'ر', 'س', 'ص', 'ط', 'ع', 'ف', 'ق', 'ك', 'ل', 'م', 'ن', 'هـ', 'و', 'ي']);
const SUPPORTED_COUNTRIES = new Set(['10206']);

function invalid(message, code) {
  throw Object.assign(new Error(message), { code, statusCode: 422 });
}

export function validateQueryPayload(payload) {
  const plate = payload?.plate || {};
  const owner = payload?.owner || {};
  const letters = Array.isArray(plate.letters) ? plate.letters.map(value => String(value || '').trim()) : [];
  const plateNumber = String(plate.number || '').trim();
  const ownerType = String(owner.type || '');
  let documentNumber = String(owner.documentNumber || '').trim();
  if (letters.length < 2 || letters.length > 3 || letters.some(value => !ALLOWED_PLATE_LETTERS.has(value))) {
    invalid('请从快捷面板依次选择 2～3 个有效车牌字母', 'INVALID_PLATE_LETTERS');
  }
  if (!/^[0-9]{1,8}$/.test(plateNumber)) invalid('车牌数字只能包含 0–9', 'INVALID_PLATE_NUMBER');
  if (!['passport', 'national_id'].includes(ownerType)) invalid('证件类型无效', 'INVALID_OWNER_TYPE');
  if (ownerType === 'national_id' && !/^[0-9]{14}$/.test(documentNumber)) {
    invalid('埃及身份证号必须是 14 位纯数字', 'INVALID_NATIONAL_ID');
  }
  if (ownerType === 'passport') {
    documentNumber = normalizeChinaPassport(documentNumber);
    if (!isValidChinaPassport(documentNumber)) {
      invalid('中国护照号码格式不正确，请检查字母和位数', 'INVALID_CHINA_PASSPORT');
    }
  }
  const country = String(owner.country || '10206');
  if (ownerType === 'passport' && !SUPPORTED_COUNTRIES.has(country)) {
    invalid('当前版本仅支持中国签发的护照', 'UNSUPPORTED_COUNTRY');
  }
  return {
    letter1: letters[0], letter2: letters[1], letter3: letters[2] || '',
    plateNumber, ownerType, documentNumber, country,
    foreignType: owner.foreignType === 'citizen' ? 'citizen' : 'foreign'
  };
}
