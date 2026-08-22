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

const ORDER_EVIDENCE_REVIEW_HINTS: Readonly<Record<string, string>> = Object.freeze({
  VERSION_CONFLICT: '订单资料已被其他人处理，请刷新订单事实后再决定。',
  STATE_CONFLICT: '订单资料、预约或下单指引状态已变化，请刷新订单事实后核对。',
  PRICE_MISMATCH: '订单金额存在差异，请勾选确认并填写价差原因后再通过。',
  FORBIDDEN: '当前角色无权核对订单资料。',
  NOT_FOUND: '订单资料不存在，或不在当前授权范围内。',
  IDEMPOTENCY_CONFLICT: '同一请求编号已被不同内容使用，请刷新订单事实后重新提交。',
  REQUEST_IN_PROGRESS: '同一请求仍在处理中，请稍后刷新订单事实查看结果。',
  BUYER_DAILY_EXCHANGE_RATE_NOT_FOUND:
    '缺少订单日期对应的买家日汇率，请先配置并确认汇率后再通过。',
  PRICING_RULE_NOT_FOUND:
    '缺少当前评论类型的卖家服务费规则，请先配置并确认规则后再通过。',
  SELLER_PRINCIPAL_RATE_NOT_FOUND:
    '缺少该卖家的本金汇率策略，请先配置并确认策略后再通过。',
  DEPENDENCY_UNAVAILABLE: '服务暂时不可用；结果未知时请安全重试完全相同的原请求。',
  NETWORK_FAILURE: '网络中断，服务器是否已执行未知，请重试完全相同的原请求确认结果。',
  MALFORMED_RESPONSE: '响应无法解析，服务器是否已执行未知，请重试完全相同的原请求确认结果。',
  MALFORMED_ERROR: '错误响应无法解析，服务器是否已执行未知，请重试完全相同的原请求确认结果。',
});

const REVIEW_DECISION_HINTS: Readonly<Record<string, string>> = Object.freeze({
  VERSION_CONFLICT: '评论资料已被其他人处理，请刷新评论事实后再决定。',
  REVIEW_STATE_CONFLICT: '评论当前状态已变化，请刷新评论事实后核对。',
  FORBIDDEN: '当前角色无权审核该评论。',
  REVIEW_CASE_NOT_FOUND: '评论不存在，或不在当前授权范围内。',
  NOT_FOUND: '评论不存在，或不在当前授权范围内。',
  IDEMPOTENCY_CONFLICT: '同一请求编号已被不同内容使用，请刷新后重新提交。',
  REQUEST_IN_PROGRESS: '同一请求仍在处理中，请稍后刷新评论事实查看结果。',
  DEPENDENCY_UNAVAILABLE: '服务暂时不可用；结果未知时请安全重试完全相同的原请求。',
  NETWORK_FAILURE: '网络中断，服务器是否已执行未知，请重试完全相同的原请求确认结果。',
  MALFORMED_RESPONSE: '响应无法解析，服务器是否已执行未知，请重试完全相同的原请求确认结果。',
  MALFORMED_ERROR: '错误响应无法解析，服务器是否已执行未知，请重试完全相同的原请求确认结果。',
});

const BUYER_REFUND_MUTATION_HINTS: Readonly<Record<string, string>> = Object.freeze({
  VERSION_CONFLICT: '返款事实已被其他人更新，请刷新返款事实后再操作。',
  BUYER_REFUND_STATE_CONFLICT: '返款状态已变化，请刷新返款事实后核对。',
  PAYMENT_ENTRY_NOT_FOUND: '原付款记录不存在，或不在当前授权范围内。',
  FILE_OBJECT_NOT_FOUND: '返款凭证不存在，或不在当前授权范围内。',
  FILE_NOT_VERIFIED: '返款凭证尚未验证完成，请确认上传状态后重试。',
  FORBIDDEN: '当前角色无权记录或冲正返款。',
  NOT_FOUND: '返款记录不存在，或不在当前授权范围内。',
  IDEMPOTENCY_CONFLICT: '同一请求编号已被不同内容使用，请刷新后重新提交。',
  REQUEST_IN_PROGRESS: '同一请求仍在处理中，请稍后刷新返款事实查看结果。',
  DEPENDENCY_UNAVAILABLE: '服务暂时不可用；结果未知时请安全重试完全相同的原请求。',
  NETWORK_FAILURE: '网络中断，服务器是否已执行未知，请重试完全相同的原请求确认结果。',
  MALFORMED_RESPONSE: '响应无法解析，服务器是否已执行未知，请重试完全相同的原请求确认结果。',
  MALFORMED_ERROR: '错误响应无法解析，服务器是否已执行未知，请重试完全相同的原请求确认结果。',
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

export function describeOrderEvidenceMutationError(error: unknown): StaffMutationOutcome {
  if (!isFrontendApiError(error)) {
    return { code: null, hint: '订单资料操作未完成，请刷新订单事实后重试。' };
  }
  if (error.code === 'VALIDATION_ERROR') {
    return {
      code: error.code,
      hint: '提交内容不完整或格式不正确，请核对备注和价差确认后重试。',
    };
  }
  return {
    code: error.code,
    hint: ORDER_EVIDENCE_REVIEW_HINTS[error.code]
      ?? '订单资料操作未完成，请按错误码刷新对应事实后重试。',
  };
}

export function describeReviewMutationError(error: unknown): StaffMutationOutcome {
  return describeKnownStaffMutationError(
    error,
    REVIEW_DECISION_HINTS,
    '评论审核操作未完成，请按错误码刷新评论事实后重试。',
  );
}

export function describeBuyerRefundMutationError(error: unknown): StaffMutationOutcome {
  return describeKnownStaffMutationError(
    error,
    BUYER_REFUND_MUTATION_HINTS,
    '返款操作未完成，请按错误码刷新返款事实后重试。',
  );
}

function describeKnownStaffMutationError(
  error: unknown,
  hints: Readonly<Record<string, string>>,
  fallback: string,
): StaffMutationOutcome {
  if (!isFrontendApiError(error)) return { code: null, hint: fallback };
  return { code: error.code, hint: hints[error.code] ?? fallback };
}
