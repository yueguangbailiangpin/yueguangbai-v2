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
  throughSchemaVersion?: number,
): string[] {
  const availableFiles = readdirSync(migrationsDirectory)
    .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name))
    .sort();

  if (availableFiles.length === 0) throw new Error('no_migrations_found');
  if (
    throughSchemaVersion !== undefined
    && (!Number.isInteger(throughSchemaVersion) || throughSchemaVersion < 1)
  ) {
    throw new Error('invalid_migration_target');
  }
  const files = throughSchemaVersion === undefined
    ? availableFiles
    : availableFiles.filter(
      (name) => Number.parseInt(name.slice(0, 4), 10) <= throughSchemaVersion,
    );
  if (
    throughSchemaVersion !== undefined
    && !files.some(
      (name) => Number.parseInt(name.slice(0, 4), 10) === throughSchemaVersion,
    )
  ) {
    throw new Error('migration_target_not_found');
  }

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

export interface CreateMigratedTestDatabaseOptions {
  throughSchemaVersion?: number;
}

export function createMigratedTestDatabase(
  options: CreateMigratedTestDatabaseOptions = {},
): SqliteDatabase {
  const database = new SqliteDatabase();
  applyMigrations(
    database,
    path.resolve(process.cwd(), 'migrations'),
    options.throughSchemaVersion,
  );
  // Phase 3H workflows require an explicit, fully eligible assignee. Keep a
  // deterministic owner fixture available to tests that focus on another
  // bounded context and do not define their own staff topology. The D-056
  // fixed-assignment model has no departments/teams any more — a plain
  // owner account is enough.
  database.exec(`
    INSERT INTO staff_users (
      id, display_name, status, authorization_version, version,
      created_at, updated_at, disabled_at
    ) VALUES ('zz-phase3h-test-owner','Phase 3H Test Owner','ACTIVE',1,1,1,1,NULL);
    INSERT INTO staff_role_assignments (
      staff_id, role_code, status, assigned_by_staff_id, assigned_at,
      revoked_at, created_at, updated_at
    ) VALUES ('zz-phase3h-test-owner','owner','ACTIVE',NULL,1,NULL,1,1);
  `);
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
