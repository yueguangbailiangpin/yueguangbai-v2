const shanghai = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function formatShanghai(epochMilliseconds: number | null): string {
  if (epochMilliseconds === null) return '未知';
  return `${shanghai.format(new Date(epochMilliseconds))}（北京时间）`;
}

export function formatDateOnly(value: string | null): string {
  return value ?? '未知';
}

export function formatJpy(value: string | number): string {
  const text = typeof value === 'number' ? String(value) : value;
  return `¥${groupInteger(text)} JPY`;
}

export function formatSignedJpyDifference(value: number): string {
  if (value === 0) return '¥0 JPY';
  return `${value > 0 ? '+' : '-'}${formatJpy(Math.abs(value))}`;
}

export function priceDifferenceDirection(value: number): string {
  if (value > 0) return '实际支付高于参考金额';
  if (value < 0) return '实际支付低于参考金额';
  return '实际支付与参考金额一致';
}

export function formatCnyFen(value: string): string {
  const whole = value.length > 2 ? value.slice(0, -2) : '0';
  const fraction = value.padStart(3, '0').slice(-2);
  return `¥${groupInteger(whole)}.${fraction} CNY`;
}

export function formatBps(value: number): string {
  const whole = Math.floor(value / 100);
  const fraction = String(value % 100).padStart(2, '0');
  return `${whole}.${fraction}%`;
}

function groupInteger(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
}
