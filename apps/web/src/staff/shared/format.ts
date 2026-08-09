const shanghai = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
export const formatShanghai = (value: number | null): string => value === null ? '未知' : `${shanghai.format(new Date(value))}（北京时间）`;
export function formatMinor(value: string, currency: 'JPY' | 'USD' | 'KRW' | 'CNY', exponent: 0 | 2): string {
  const number = BigInt(value);
  const sign = number < 0n ? '-' : '';
  const absolute = number < 0n ? -number : number;
  if (exponent === 0) return `${sign}${absolute.toLocaleString('zh-CN')} ${currency}`;
  const whole = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, '0');
  return `${sign}${whole.toLocaleString('zh-CN')}.${fraction} ${currency}`;
}
export function formatCny(value: string): string {
  const formatted = formatMinor(value, 'CNY', 2);
  return formatted.startsWith('-') ? `-¥${formatted.slice(1)}` : `¥${formatted}`;
}
