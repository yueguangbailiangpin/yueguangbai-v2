export const statusLabels: Readonly<Record<string, string>> = Object.freeze({
  PENDING_REVIEW: '待审核',
  APPROVED: '已确认',
  REJECTED: '未通过',
  CANCELLED: '已取消',
  EXPIRED: '已到期',
  ACTIVE: '进行中',
  UNPUBLISHED: '尚未发布',
  COMPLETED: '已完成',
  NONE: '尚未提交',
  PENDING_VERIFICATION: '资料审核中',
  CHANGES_REQUESTED: '需要修改',
  VERIFIED: '资料已核验',
  WITHDRAWN: '已撤回',
  CONSUMED: '已用于确认订单',
  CONFIRMED: '已确认',
  DUE: '待返款',
  PARTIALLY_PAID: '部分返款',
  PAID: '已返款',
  OVERPAID: '超额返款',
  PAYMENT_RECORDED: '记录付款',
  PAYMENT_REVERSED: '付款冲正',
});

export function statusLabel(value: string): string {
  return statusLabels[value] ?? value;
}

export const reviewTypeLabels: Readonly<Record<string, string>> = Object.freeze({
  RATING: '评分',
  TEXT: '文字评论',
  IMAGE: '图片评论',
  VIDEO: '视频评论',
});

export function reviewTypeLabel(value: string): string {
  return reviewTypeLabels[value] ?? value;
}

export function statusTone(value: string): 'neutral' | 'processing' | 'success' | 'warning' | 'danger' | 'expired' | 'conflict' {
  if (['APPROVED', 'VERIFIED', 'CONFIRMED', 'PAID', 'COMPLETED'].includes(value)) return 'success';
  if (['CHANGES_REQUESTED', 'PARTIALLY_PAID', 'DUE'].includes(value)) return 'warning';
  if (['REJECTED', 'OVERPAID'].includes(value)) return 'danger';
  if (['CANCELLED', 'EXPIRED', 'WITHDRAWN'].includes(value)) return 'expired';
  if (['PENDING_REVIEW', 'PENDING_VERIFICATION', 'ACTIVE'].includes(value)) return 'processing';
  return 'neutral';
}
