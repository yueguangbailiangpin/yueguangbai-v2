export class CloudflareD1RestDatabase {
  constructor({ accountId, databaseId, token, fetchImpl = fetch }) {
    if (!/^[0-9a-f]{32}$/u.test(accountId)
      || !/^[0-9a-f-]{36}$/u.test(databaseId)
      || typeof token !== 'string'
      || token.length < 20) {
      throw new Error('invalid_d1_rest_configuration');
    }
    this.accountId = accountId;
    this.databaseId = databaseId;
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  prepare(sql) {
    return new CloudflareD1RestStatement(this, sql, []);
  }

  async batch(statements) {
    if (!Array.isArray(statements) || statements.length < 1
      || statements.some((statement) => !(statement instanceof CloudflareD1RestStatement)
        || statement.database !== this)) {
      throw new Error('invalid_d1_rest_batch');
    }
    const results = await this.query({
      batch: statements.map((statement) => statement.query),
    });
    if (results.length !== statements.length) {
      throw new Error('d1_rest_batch_result_mismatch');
    }
    return results.map(runResult);
  }

  async query(body) {
    const response = await this.fetchImpl(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/d1/database/${this.databaseId}/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    ).catch(() => null);
    if (!response?.ok) throw new Error('d1_rest_query_failed');
    const envelope = await response.json().catch(() => null);
    if (!envelope || envelope.success !== true || !Array.isArray(envelope.result)
      || envelope.result.some((result) => result?.success !== true)) {
      throw new Error('d1_rest_query_failed');
    }
    return envelope.result;
  }
}

class CloudflareD1RestStatement {
  constructor(database, sql, params) {
    if (typeof sql !== 'string' || sql.trim().length < 1) {
      throw new Error('invalid_d1_rest_statement');
    }
    this.database = database;
    this.query = { sql, params };
  }

  bind(...params) {
    if (params.some((value) => value !== null
      && typeof value !== 'string'
      && typeof value !== 'number')) {
      throw new Error('unsupported_d1_rest_binding');
    }
    return new CloudflareD1RestStatement(this.database, this.query.sql, params);
  }

  async first() {
    const [result] = await this.database.query(this.query);
    const rows = result?.results;
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  }

  async all() {
    const [result] = await this.database.query(this.query);
    return { results: Array.isArray(result?.results) ? result.results : [] };
  }

  async run() {
    const [result] = await this.database.query(this.query);
    return runResult(result);
  }
}

function runResult(result) {
  return {
    meta: {
      changes: Number(result?.meta?.changes ?? 0),
      last_row_id: result?.meta?.last_row_id ?? null,
    },
  };
}
