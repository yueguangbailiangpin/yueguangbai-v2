export interface SqlRunMeta {
  changes: number;
  last_row_id?: number | string | null;
}

export interface SqlRunResult {
  meta: SqlRunMeta;
}

export interface SqlAllResult<T> {
  results: T[];
}

export interface SqlStatement {
  bind(...values: unknown[]): SqlStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<SqlAllResult<T>>;
  run(): Promise<SqlRunResult>;
}

export interface SqlDatabase {
  prepare(sql: string): SqlStatement;
  batch(statements: readonly SqlStatement[]): Promise<SqlRunResult[]>;
}

export function statementChangedOnce(
  result: SqlRunResult | undefined,
): boolean {
  return Number(result?.meta.changes ?? 0) === 1;
}
