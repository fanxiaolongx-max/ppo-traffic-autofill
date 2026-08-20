// Mainland Chinese passport formats published by the NIA and foreign-affairs authorities.
// Ordinary: G + 8 digits, E + 8 digits, or E + a letter other than I/O + 7 digits.
// Electronic diplomatic/service/public-affairs: DE/SE/PE + 7 digits.
export const CHINA_PASSPORT_PATTERN = /^(?:G\d{8}|E\d{8}|E[A-HJ-NP-Z]\d{7}|(?:DE|SE|PE)\d{7})$/;

export function normalizeChinaPassport(value) {
  return String(value || '').trim().toUpperCase();
}

export function isValidChinaPassport(value) {
  return CHINA_PASSPORT_PATTERN.test(normalizeChinaPassport(value));
}
