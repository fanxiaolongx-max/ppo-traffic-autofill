import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOfficialSummary } from '../src/result-parser.js';

test('keeps total fine and violation count as separate PPO fields', () => {
  const text = 'خدمات المرور - إجمالى المخالفات بيانات المخالفات اجمالي الغرامات الشاملة 1000 جنيه عدد المخالفات 3 إجمالى غرامات التصالح 0 جنيه';
  assert.deepEqual(parseOfficialSummary(text), {
    totalFine: '1000 جنيه',
    violationCount: '3',
    reconcileFine: '0 جنيه'
  });
});

test('does not treat a generic page title as the violation count label', () => {
  const text = 'إجمالى المخالفات بيانات المخالفات اجمالي الغرامات الشاملة 7400 جنيه عدد المخالفات 18 إجمالى غرامات التصالح 0 جنيه';
  assert.equal(parseOfficialSummary(text).violationCount, '18');
});

test('supports Arabic digits and clean results', () => {
  assert.equal(parseOfficialSummary('اجمالي الغرامات الشاملة ١٠٠٠ جنيه عدد المخالفات ٣ إجمالى غرامات التصالح ٠ جنيه').violationCount, '٣');
  assert.deepEqual(parseOfficialSummary('لا توجد مخالفات'), {
    totalFine: '0 جنيه', violationCount: '0', reconcileFine: '0 جنيه'
  });
});
