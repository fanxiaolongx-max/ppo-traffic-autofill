const RULES = [
  {
    code: 'LICENSE_DATA_UPDATE_REQUIRED',
    pattern: /لا توجد? لهذه الرخصة بيانات مسجلة حديثة|التوجه (?:الى|إلى) نيابة المرور المختصة لتحديث البيانات/,
    message: '该车辆牌照暂无近期登记数据，请前往所属交通检察机关更新资料',
    infrastructure: false
  },
  {
    code: 'IDENTITY_MISMATCH',
    pattern: /رقم الرخصة غير صحيح|الرقم القومي أو رقم الرخصة|غير صحيح|يرجى التحقق|رقم الرخصة/,
    message: '车牌号或证件号不匹配，请核对车牌字母、数字、证件类型及签发国家',
    infrastructure: false
  },
  {
    code: 'SESSION_EXPIRED',
    pattern: /انتهت جلستك|انتهت الجلسة|إعادة تحميل|session expired|wwv_flow/,
    message: 'PPO 官网会话已过期，请稍后重新查询',
    infrastructure: true
  },
  {
    code: 'OFFICIAL_PROCESSING_ERROR',
    pattern: /حدث خطأ أثناء معالجة الطلب|معالجة الطلب|برجاء المحاولة لاحقا/,
    message: 'PPO 官网后端暂时无法处理请求，填写内容不一定有误，请稍后再试',
    infrastructure: true
  },
  {
    code: 'OFFICIAL_EXECUTION_ERROR',
    pattern: /حدث خطأ أثناء تنفيذ الخدمة|خطأ أثناء تنفيذ/,
    message: 'PPO 官网执行查询服务时出错，请核对信息后稍后再试',
    infrastructure: false
  },
  {
    code: 'OFFICIAL_MAINTENANCE',
    pattern: /الخدمة غير متاحة|صيانة|غير متوفرة/,
    message: 'PPO 官网正在维护或暂时离线，请稍后再试',
    infrastructure: true
  },
  {
    code: 'OFFICIAL_GATEWAY_ERROR',
    pattern: /502\s+bad gateway|503\s+service|504\s+gateway|bad gateway|gateway timeout/,
    message: 'PPO 官网网关无响应或超时，请稍后再试',
    infrastructure: true
  }
];

export function matchOfficialError(text) {
  const normalized = String(text || '').toLowerCase();
  return RULES.find(rule => rule.pattern.test(normalized)) || null;
}

export function classifyOfficialError(text) {
  const raw = String(text || '').trim().slice(0, 1500);
  const matched = matchOfficialError(raw);
  if (matched) return Object.assign(new Error(matched.message), {
    code: matched.code,
    officialMessage: raw,
    infrastructure: matched.infrastructure
  });
  return Object.assign(new Error('PPO 官网返回了未识别的错误提示'), {
    code: 'OFFICIAL_ERROR',
    officialMessage: raw,
    infrastructure: true
  });
}

export function isInfrastructureError(code) {
  return new Set([
    'QUERY_TIMEOUT', 'SESSION_EXPIRED', 'OFFICIAL_PROCESSING_ERROR',
    'OFFICIAL_MAINTENANCE', 'OFFICIAL_GATEWAY_ERROR',
    'OFFICIAL_UNAVAILABLE', 'OFFICIAL_ERROR', 'BROWSER_NOT_FOUND', 'FORM_CHANGED',
    'FORM_NOT_READY', 'QUERY_FAILED'
  ]).has(code);
}
