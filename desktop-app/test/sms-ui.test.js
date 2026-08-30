import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
const preferences = fs.readFileSync(new URL('../public/preferences.css', import.meta.url), 'utf8');

test('SMS schedule UI uses whole days and converts them to backend hours', () => {
  assert.match(app, /id="sms-binding-days"[^>]+min="1"[^>]+max="365"/);
  assert.match(app, /id="sms-schedule-days"[^>]+min="1"[^>]+max="365"/);
  assert.match(app, /\$\('#sms-binding-days'\)\.value\) \* 24/);
  assert.match(app, /\$\('#sms-schedule-days'\)\.value\) \* 24/);
  assert.doesNotMatch(app, /周期（小时）|minimum 24|sms-binding-interval|sms-schedule-hours/);
});

test('SMS notification card has explicit light-theme surfaces', () => {
  assert.match(styles, /\.sms-binding-panel \{/);
  assert.match(preferences, /data-theme="light"\] \.sms-binding-panel/);
  assert.match(preferences, /data-theme="light"\] \.sms-phone-field input[^\n]+background:transparent/);
  assert.doesNotMatch(styles, /sms-phone-field[^\n]+background:#090f16/);
});

test('a foreground query opens its successful detail once without reacting to history refreshes', () => {
  assert.match(app, /trackAutoOpenDetail\(result\.query\)/);
  assert.match(app, /if \(data\.query\) considerAutoOpenDetail\(data\.query\)/);
  assert.match(app, /state\.autoOpenQueryIds\.delete\(query\.id\)/);
  assert.match(app, /if \(state\.autoOpenDetailBusy \|\| dialog\.open \|\| !state\.autoOpenReadyIds\.length\) return/);
  const refreshBody = app.match(/async function refresh\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.doesNotMatch(refreshBody, /trackAutoOpenDetail/);
});

test('admin exposes phone binding management and public SMS service health', () => {
  const adminHtml = fs.readFileSync(new URL('../public/admin.html', import.meta.url), 'utf8');
  const adminJs = fs.readFileSync(new URL('../public/admin.js', import.meta.url), 'utf8');
  const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.match(adminHtml, /id="sms-binding-create"/);
  assert.match(adminHtml, /id="sms-binding-body"/);
  assert.match(adminHtml, /id="check-sms-health"/);
  assert.match(adminHtml, /id="sms-confirm-dialog"/);
  assert.match(adminJs, /\/api\/v1\/admin\/sms\/bindings/);
  assert.match(adminJs, /binding-run/);
  assert.match(adminJs, /confirmed:true/);
  assert.match(server, /SMS_CONFIRMATION_REQUIRED/);
  assert.match(server, /adminSmsBindingRun/);
  assert.match(server, /source: 'manual_sms'/);
  assert.match(app, /data\.sms\?\.status/);
  assert.match(app, /短信通知服务/);
});
