import test from 'node:test';
import assert from 'node:assert/strict';

test('translates every public query detail label in English mode', async () => {
  globalThis.localStorage = { getItem: key => key === 'ppo-language' ? 'en' : null };
  const { localizeTimelineDetail, localizeTimelineStep, t } = await import(`../public/preferences.js?test=${Date.now()}`);
  assert.deepEqual(
    ['状态', '车牌', '证件', '追踪编号', '来源', '创建时间', '总罚款', '违章笔数', '查询尝试', '失败原因', '官网提示'].map(t),
    ['Status', 'Plate', 'Document', 'Trace ID', 'Source', 'Created', 'Total fine', 'Violations', 'Query attempts', 'Failure reason', 'Official message']
  );
  assert.deepEqual(
    ['等待执行', '正在启动浏览器', '正在打开 PPO 官网', '正在初始化官网表单', '正在填写查询信息', '正在提交查询', '等待官方结果', '正在切换护照格式重试', '正在解析查询结果', '查询完成'].map(localizeTimelineStep),
    ['Waiting to run', 'Starting browser', 'Opening the PPO website', 'Initializing the PPO form', 'Filling query details', 'Submitting query', 'Waiting for the PPO result', 'Retrying with an alternate passport format', 'Parsing the query result', 'Query completed']
  );
  assert.equal(localizeTimelineDetail('等待车辆查询表单完成初始化'), 'Waiting for the vehicle query form to initialize');
  assert.equal(localizeTimelineDetail('车辆查询页签已激活，表单初始化完成'), 'Vehicle query tab activated; form initialization completed');
  assert.equal(localizeTimelineDetail('车辆查询表单初始化完成'), 'Vehicle query form initialization completed');
  assert.equal(localizeTimelineDetail('正在触发 PPO 官网查询按钮'), 'Triggering the PPO website query button');
  assert.equal(localizeTimelineDetail('护照格式切换，第 2/2 次尝试'), 'Switching passport format for attempt 2/2');
  assert.equal(localizeTimelineDetail('第 2/2 次：已去除护照英文字母前缀后重试'), 'Attempt 2/2: retrying without the passport letter prefix');
});
