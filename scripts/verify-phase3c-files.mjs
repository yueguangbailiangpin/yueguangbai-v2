import { DatabaseSync } from 'node:sqlite';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const migrationsDirectory = path.join(root, 'migrations');
const workDirectory = mkdtempSync(
  path.join(tmpdir(), 'ygb-v2-phase3c-files-'),
);
const databasePath = path.join(workDirectory, 'verification.sqlite');

try {
  const migrationFiles = readdirSync(migrationsDirectory)
    .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name))
    .sort();
  if (migrationFiles.at(-1) !== '0010_file_storage.sql') {
    throw new Error('0010_file_storage.sql 不是最终 Migration');
  }

  const database = new DatabaseSync(databasePath);
  try {
    database.exec('PRAGMA foreign_keys = ON;');
    for (const file of migrationFiles) {
      database.exec(readFileSync(
        path.join(migrationsDirectory, file),
        'utf8',
      ));
    }

    const requiredTables = [
      'file_upload_intents',
      'file_objects',
      'file_entity_links',
      'file_read_intents',
      'file_events',
    ];
    const requiredTriggers = [
      'trg_file_objects_intent_guard',
      'trg_file_objects_verified_guard',
      'trg_file_entity_links_verified_guard',
      'trg_file_read_intents_verified_guard',
      'trg_file_events_no_update',
      'trg_file_events_no_delete',
    ];
    const schemaObjects = new Set(database.prepare(`
      SELECT name
      FROM sqlite_schema
      WHERE type IN ('table', 'trigger')
    `).all().map((row) => String(row.name)));
    for (const name of [...requiredTables, ...requiredTriggers]) {
      if (!schemaObjects.has(name)) throw new Error(`缺少对象: ${name}`);
    }

    const columns = database.prepare(`
      PRAGMA table_info(file_objects)
    `).all().map((row) => String(row.name));
    for (const forbidden of [
      'public_url',
      'signed_url',
      'secret',
      'upload_token',
      'file_body',
    ]) {
      if (columns.includes(forbidden)) {
        throw new Error(`禁止持久化列: ${forbidden}`);
      }
    }

    database.exec(`
      INSERT INTO file_upload_intents (
        id, owner_actor_type, owner_actor_id,
        purpose, visibility, status,
        requested_file_count, manifest_hash,
        version, expires_at, failure_code,
        created_at, updated_at, completed_at
      ) VALUES (
        'intent-verify', 'STAFF', 'staff-verify',
        'ORDER_EVIDENCE', 'INTERNAL_ONLY', 'ISSUED',
        1, '${'1'.repeat(64)}',
        1, 2000, NULL,
        1000, 1000, NULL
      );

      INSERT INTO file_objects (
        id, upload_intent_id, slot_no,
        purpose, visibility, object_key,
        client_file_name, extension, declared_mime,
        expected_byte_size, status,
        upload_token_hash, upload_expires_at,
        uploaded_byte_size, detected_mime, uploaded_sha256,
        failure_code, delete_attempt_count, next_delete_at,
        version, created_at, updated_at,
        uploaded_at, verified_at, deleted_at
      ) VALUES (
        'object-verify', 'intent-verify', 1,
        'ORDER_EVIDENCE', 'INTERNAL_ONLY',
        'files/v1/2026/07/order-evidence/${'a'.repeat(64)}',
        'proof.png', 'png', 'image/png',
        11, 'RESERVED',
        '${'2'.repeat(64)}', 2000,
        NULL, NULL, NULL,
        NULL, 0, NULL,
        1, 1000, 1000,
        NULL, NULL, NULL
      );
    `);

    expectFailure(
      () => database.exec(`
        INSERT INTO file_entity_links (
          id, file_object_id, entity_type, entity_id,
          purpose, visibility,
          linked_by_actor_type, linked_by_actor_id,
          created_at
        ) VALUES (
          'link-blocked', 'object-verify', 'ORDER', 'order-1',
          'ORDER_EVIDENCE', 'INTERNAL_ONLY',
          'STAFF', 'staff-verify', 1100
        );
      `),
      'file_object_not_verified',
    );

    expectFailure(
      () => database.exec(`
        INSERT INTO file_read_intents (
          id, file_object_id, actor_type, actor_id,
          token_hash, status, use_count, expires_at,
          created_at, updated_at, consumed_at, revoked_at
        ) VALUES (
          'read-blocked', 'object-verify', 'STAFF', 'staff-verify',
          '${'3'.repeat(64)}', 'ISSUED', 0, 1900,
          1200, 1200, NULL, NULL
        );
      `),
      'file_object_not_readable',
    );

    database.exec(`
      INSERT INTO file_events (
        id, upload_intent_id, file_object_id,
        event_type, actor_type, actor_id,
        previous_status, next_status, metadata_json,
        idempotency_key, created_at
      ) VALUES (
        'event-immutable', 'intent-verify', NULL,
        'UPLOAD_INTENT_ISSUED', 'STAFF', 'staff-verify',
        NULL, 'ISSUED', '{}', 'verify-key', 1000
      );
    `);
    expectFailure(
      () => database.exec(`
        UPDATE file_events
        SET next_status='MUTATED'
        WHERE id='event-immutable';
      `),
      'file_events_are_immutable',
    );
    expectFailure(
      () => database.exec(`
        DELETE FROM file_events WHERE id='event-immutable';
      `),
      'file_events_are_immutable',
    );

    const state = database.prepare(`
      SELECT schema_version
      FROM app_schema_state
      WHERE singleton_id=1
    `).get();
    if (Number(state?.schema_version) !== 10) {
      throw new Error(`Schema 版本错误: ${String(state?.schema_version)}`);
    }

    const integrity = database.prepare('PRAGMA integrity_check').get();
    if (String(integrity?.integrity_check) !== 'ok') {
      throw new Error('integrity_check 失败');
    }
    const foreignKeys = database.prepare('PRAGMA foreign_key_check').all();
    if (foreignKeys.length !== 0) {
      throw new Error(`foreign_key_check 发现 ${foreignKeys.length} 项`);
    }

    console.log(JSON.stringify({
      status: 'PASS',
      migration: '0010_file_storage.sql',
      schema_version: 10,
      tables: requiredTables,
      triggers: requiredTriggers,
      verified_guards: [
        'entity_link_requires_verified_file',
        'read_intent_requires_verified_linked_file',
        'file_events_immutable',
      ],
      forbidden_persistence: [
        'public_url',
        'signed_url',
        'secret',
        'raw_upload_token',
        'file_body',
      ],
    }, null, 2));
  } finally {
    database.close();
  }
} finally {
  rmSync(workDirectory, { recursive: true, force: true });
}

function expectFailure(action, expectedMessage) {
  try {
    action();
  } catch (error) {
    if (String(error).includes(expectedMessage)) return;
    throw error;
  }
  throw new Error(`预期失败未发生: ${expectedMessage}`);
}
