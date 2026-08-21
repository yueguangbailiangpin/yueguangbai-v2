import { isFrontendApiError } from '../../api/errors';

const DEMAND_REVIEW_HINTS: Readonly<Record<string, string>> = Object.freeze({
  VERSION_CONFLICT: '需求数据已被其他人处理，请刷新事实后重试。',
  DEMAND_BATCH_ALREADY_REVIEWED: '该需求已审核完成，请刷新队列。',
  DEMAND_BATCH_EXPIRED: '预约或下单截止时间已过期，无法发布。',
  SCHEDULE_WINDOW_CONFLICT: '按该首个下单日期排期会超出下单截止时间，请调整日期。',
  FORBIDDEN: '当前角色无权执行该操作。',
  NOT_FOUND: '需求不存在或不在当前授权范围内。',
  IDEMPOTENCY_CONFLICT: '同一请求编号已被不同内容使用，请刷新后重新提交。',
  REQUEST_IN_PROGRESS: '同一请求仍在处理中，请稍后查看结果。',
  DEPENDENCY_UNAVAILABLE: '服务暂时不可用，结果未确定时可安全重试原请求。',
  NETWORK_FAILURE: '网络中断，服务器是否已执行未知，请重试原请求确认结果。',
  MALFORMED_RESPONSE: '响应无法解析，服务器是否已执行未知，请重试原请求确认结果。',
});

export interface StaffMutationOutcome {
  code: string | null;
  hint: string;
}

export function describeStaffMutationError(error: unknown): StaffMutationOutcome {
  if (!isFrontendApiError(error)) {
    return { code: null, hint: '操作未完成，请刷新后重试。' };
  }
  // VALIDATION_ERROR 的含义取决于 HTTP 状态：400 是请求本身（通常是日期格式），
  // 409 是发布就绪检查（产品资料缺失），后一种附带字段级安全原因。
  if (error.code === 'VALIDATION_ERROR' && error.httpStatus === 409) {
    const reason = error.safeDetails?.['reason'];
    return {
      code: error.code,
      hint: typeof reason === 'string' && reason.length > 0
        ? reason
        : '产品资料未满足发布条件（金额、颜色规格、主图、排期或关键词），请先补齐。',
    };
  }
  if (error.code === 'VALIDATION_ERROR') {
    return {
      code: error.code,
      hint: '请求参数不正确，请检查首个下单日期后重新提交。',
    };
  }
  return {
    code: error.code,
    hint: DEMAND_REVIEW_HINTS[error.code] ?? '操作未完成，请按错误类型刷新事实后重试。',
  };
}
