import { DatabaseSync } from 'node:sqlite';
import {
  readFileSync,
  readdirSync,
} from 'node:fs';
import path from 'node:path';
import type {
  SqlAllResult,
  SqlDatabase,
  SqlRunResult,
  SqlStatement,
} from '@ygb/contracts';

type SqliteBinding =
  | null
  | string
  | number
  | bigint
  | Uint8Array;

export class SqliteDatabase implements SqlDatabase {
  readonly raw: DatabaseSync;

  constructor(fileName = ':memory:') {
    this.raw = new DatabaseSync(fileName);
    this.raw.exec('PRAGMA foreign_keys = ON;');
  }

  prepare(sql: string): SqlStatement {
    return new SqliteStatement(this, sql, []);
  }

  async batch(
    statements: readonly SqlStatement[],
  ): Promise<SqlRunResult[]> {
    this.raw.exec('BEGIN IMMEDIATE;');
    try {
      const results: SqlRunResult[] = [];
      for (const statement of statements) {
        if (!(statement instanceof SqliteStatement)
          || statement.database !== this) {
          throw new Error('foreign_sql_statement');
        }
        results.push(statement.runSync());
      }
      this.raw.exec('COMMIT;');
      return results;
    } catch (error) {
      this.raw.exec('ROLLBACK;');
      throw error;
    }
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  close(): void {
    this.raw.close();
  }
}

class SqliteStatement implements SqlStatement {
  constructor(
    readonly database: SqliteDatabase,
    private readonly sql: string,
    private readonly bindings: readonly SqliteBinding[],
  ) {}

  bind(...values: unknown[]): SqlStatement {
    return new SqliteStatement(
      this.database,
      this.sql,
      values.map(toSqliteBinding),
    );
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const row = this.database.raw.prepare(this.sql)
      .get(...this.bindings) as T | undefined;
    return row ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<SqlAllResult<T>> {
    const rows = this.database.raw.prepare(this.sql)
      .all(...this.bindings) as T[];
    return { results: rows };
  }

  async run(): Promise<SqlRunResult> {
    return this.runSync();
  }

  runSync(): SqlRunResult {
    const result = this.database.raw.prepare(this.sql)
      .run(...this.bindings);
    return {
      meta: {
        changes: Number(result.changes),
        last_row_id: normalizeLastInsertRowId(result.lastInsertRowid),
      },
    };
  }
}

export function applyMigrations(
  database: SqliteDatabase,
  migrationsDirectory = path.resolve(process.cwd(), 'migrations'),
): string[] {
  const files = readdirSync(migrationsDirectory)
    .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name))
    .sort();

  if (files.length === 0) throw new Error('no_migrations_found');

  for (const file of files) {
    database.exec('BEGIN IMMEDIATE;');
    try {
      database.exec(readFileSync(
        path.join(migrationsDirectory, file),
        'utf8',
      ));
      database.exec('COMMIT;');
    } catch (error) {
      try {
        database.exec('ROLLBACK;');
      } catch {
        // No open transaction only if SQLite already rolled the statement back.
      }
      throw error;
    }
  }
  return files;
}

export function createMigratedTestDatabase(): SqliteDatabase {
  const database = new SqliteDatabase();
  applyMigrations(database);
  return database;
}

function toSqliteBinding(value: unknown): SqliteBinding {
  if (value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'bigint') {
    return value;
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value.slice(0));
  }

  if (ArrayBuffer.isView(value)) {
    const source = new Uint8Array(
      value.buffer,
      value.byteOffset,
      value.byteLength,
    );
    const copy = new Uint8Array(source.byteLength);
    copy.set(source);
    return copy;
  }

  throw new Error('unsupported_sql_binding');
}

function normalizeLastInsertRowId(
  value: number | bigint,
): number | string {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric)
    ? numeric
    : value.toString();
}
