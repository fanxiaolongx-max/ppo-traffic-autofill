import test from 'node:test';
import assert from 'node:assert/strict';
import { validateQueryPayload } from '../src/validation.js';

const valid = {
  plate: { letters: ['أ', 'ف', 'س'], number: '3413' },
  owner: { type: 'passport', documentNumber: 'EA8961802', country: '10206', foreignType: 'foreign' }
};

test('accepts a supported passport query', () => {
  assert.equal(validateQueryPayload(valid).documentNumber, 'EA8961802');
  for (const documentNumber of ['G12345678', 'E12345678', 'EH1234567', 'DE1234567', 'SE1234567', 'PE1234567']) {
    assert.equal(validateQueryPayload({ ...valid, owner: { ...valid.owner, documentNumber: documentNumber.toLowerCase() } }).documentNumber, documentNumber);
  }
});

test('requires two or three plate letters', () => {
  const twoLetterFourDigit = validateQueryPayload({ ...valid, plate: { letters: ['أ', 'ف'], number: '3413' } });
  assert.deepEqual([twoLetterFourDigit.letter1, twoLetterFourDigit.letter2, twoLetterFourDigit.letter3, twoLetterFourDigit.plateNumber], ['أ', 'ف', '', '3413']);
  assert.throws(() => validateQueryPayload({ ...valid, plate: { letters: ['أ'], number: '3413' } }), error => error.code === 'INVALID_PLATE_LETTERS');
});

test('requires a fourteen digit Egyptian national id', () => {
  assert.throws(() => validateQueryPayload({ ...valid, owner: { type: 'national_id', documentNumber: '123' } }), error => error.code === 'INVALID_NATIONAL_ID');
  assert.equal(validateQueryPayload({ ...valid, owner: { type: 'national_id', documentNumber: '12345678901234' } }).ownerType, 'national_id');
});

test('rejects unsupported countries and malformed passport numbers', () => {
  assert.throws(() => validateQueryPayload({ ...valid, owner: { ...valid.owner, country: '99999' } }), error => error.code === 'UNSUPPORTED_COUNTRY');
  for (const documentNumber of ['EA 896', 'EI1234567', 'EO1234567', 'E1234567', 'A12345678']) {
    assert.throws(() => validateQueryPayload({ ...valid, owner: { ...valid.owner, documentNumber } }), error => error.code === 'INVALID_CHINA_PASSPORT');
  }
});
