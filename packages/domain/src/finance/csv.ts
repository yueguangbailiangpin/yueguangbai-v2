import { formatFenAsCny, parseSignedIntegerString } from '../money/signed-integer';

export const FINANCIAL_CSV_MAX_ROWS = 50_000;
export const FINANCIAL_CSV_MAX_BYTES = 25 * 1024 * 1024;

export class FinancialCsvError extends Error {
  constructor(public readonly code: 'EXPORT_TOO_LARGE' | 'INVALID_CSV_VALUE') {
    super(code);
    this.name = 'FinancialCsvError';
  }
}

export interface FinancialCsvColumn<Row> {
  header: string;
  value: (row: Row) => string | number | null;
  kind?: 'TEXT' | 'INTEGER' | 'FEN' | 'CNY';
}

export function protectSpreadsheetText(value: string): string {
  return /^[=+\-@\t\r]/u.test(value) ? `'${value}` : value;
}

export function quoteCsvCell(value: string): string {
  return /[",\r\n]/u.test(value)
    ? `"${value.replaceAll('"', '""')}"`
    : value;
}

export function serializeFinancialCsv<Row>(
  rows: readonly Row[],
  columns: readonly FinancialCsvColumn<Row>[],
): Uint8Array {
  if (rows.length > FINANCIAL_CSV_MAX_ROWS) {
    throw new FinancialCsvError('EXPORT_TOO_LARGE');
  }
  if (columns.length < 1 || columns.some((column) => column.header.length < 1)) {
    throw new FinancialCsvError('INVALID_CSV_VALUE');
  }

  const lines: string[] = [];
  lines.push(columns.map((column) => quoteCsvCell(
    protectSpreadsheetText(column.header),
  )).join(','));
  for (const row of rows) {
    lines.push(columns.map((column) => {
      const raw = column.value(row);
      if (raw === null) return '';
      const value = String(raw);
      if (column.kind === 'INTEGER') {
        return quoteCsvCell(parseSignedIntegerString(value).toString(10));
      }
      if (column.kind === 'FEN') {
        return quoteCsvCell(parseSignedIntegerString(value).toString(10));
      }
      if (column.kind === 'CNY') {
        return quoteCsvCell(formatFenAsCny(parseSignedIntegerString(value)));
      }
      return quoteCsvCell(protectSpreadsheetText(value));
    }).join(','));
  }

  const body = `\uFEFF${lines.join('\r\n')}\r\n`;
  const bytes = new TextEncoder().encode(body);
  if (bytes.byteLength > FINANCIAL_CSV_MAX_BYTES) {
    throw new FinancialCsvError('EXPORT_TOO_LARGE');
  }
  return bytes;
}
