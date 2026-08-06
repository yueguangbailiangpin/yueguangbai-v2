const shanghai = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
export const formatShanghai = (value: number | null): string => value === null ? '未知' : `${shanghai.format(new Date(value))}（北京时间）`;
export function formatMinor(value: string, currency: 'JPY' | 'USD' | 'KRW' | 'CNY', exponent: 0 | 2): string {
  const number = BigInt(value);
  if (exponent === 0) return `${number.toLocaleString('zh-CN')} ${currency}`;
  const whole = number / 100n; const fraction = (number % 100n).toString().padStart(2, '0');
  return `${whole.toLocaleString('zh-CN')}.${fraction} ${currency}`;
}
export const formatCny = (value: string): string => `¥${formatMinor(value, 'CNY', 2)}`;
