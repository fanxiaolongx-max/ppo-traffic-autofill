import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyOfficialError, isInfrastructureError } from '../src/official-error.js';
import { chromeCompatibleUserAgent } from '../src/query-driver.js';

const cases = [
  ['خطأ\nلا يوجد لهذه الرخصة بيانات مسجلة حديثة برجاء التوجه الى نيابة المرور المختصة لتحديث البيانات\nموافق', 'LICENSE_DATA_UPDATE_REQUIRED'],
  ['خطأ\nاسم المستخدم أو كلمة السر غير صحيحة\nموافق', 'OFFICIAL_AUTH_ERROR'],
  ['الرقم القومي أو رقم الرخصة غير صحيح، يرجى التحقق', 'IDENTITY_MISMATCH'],
  ['لقد انتهت جلستك برجاء إعادة تحميل الصفحة', 'SESSION_EXPIRED'],
  ['حدث خطأ أثناء معالجة الطلب برجاء المحاولة لاحقا', 'OFFICIAL_PROCESSING_ERROR'],
  ['حدث خطأ أثناء تنفيذ الخدمة', 'OFFICIAL_EXECUTION_ERROR'],
  ['الخدمة غير متاحة - صيانة', 'OFFICIAL_MAINTENANCE'],
  ['502 Bad Gateway', 'OFFICIAL_GATEWAY_ERROR']
];

for (const [message, code] of cases) {
  test(`classifies ${code}`, () => assert.equal(classifyOfficialError(message).code, code));
}

test('only system-wide failures contribute to the circuit breaker', () => {
  assert.equal(isInfrastructureError('LICENSE_DATA_UPDATE_REQUIRED'), false);
  assert.equal(isInfrastructureError('IDENTITY_MISMATCH'), false);
  assert.equal(isInfrastructureError('OFFICIAL_EXECUTION_ERROR'), false);
  assert.equal(isInfrastructureError('OFFICIAL_AUTH_ERROR'), true);
  assert.equal(isInfrastructureError('OFFICIAL_PROCESSING_ERROR'), true);
  assert.equal(isInfrastructureError('OFFICIAL_GATEWAY_ERROR'), true);
});

test('uses the embedded Chromium engine without Electron product tokens', () => {
  const value = chromeCompatibleUserAgent('Mozilla/5.0 Chrome/142.0.0.0 Electron/43.4.1 Safari/537.36 ppo-query-hub/1.0.9');
  assert.equal(value, 'Mozilla/5.0 Chrome/142.0.0.0 Safari/537.36');
});
