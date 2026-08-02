import { describe, expect, it } from 'vitest';
import type {
  FileActor,
  FileReadPrincipal,
  ObjectStorageAdapter,
  SqlDatabase,
  SqlRunResult,
  SqlStatement,
} from '@ygb/contracts';
import {
  generateOpaqueFileToken,
  hashOpaqueFileToken,
} from '@ygb/domain';
import {
  DenyAllFileAuthorizationService,
  type FileAuthorizationResource,
} from './authorization';
import { authorizeExplicitAudienceRead } from './file-audience-authorization';
import { consumeFileReadIntent } from './file-read-service';

interface Scenario {
  staffStatus: 'ACTIVE' | 'DISABLED';
  roles: readonly string[];
  grants: readonly string[];
  denies: readonly string[];
  teamId: string | null;
  leader: boolean;
  authorityOrganizationId: string | null;
  directOrganizationId: string | null;
  teamOrganizationId: string | null;
  readIntentTokenHash?: string;
}

const NOW = 10_000;
const STAFF_ACTOR: FileActor = Object.freeze({
  type: 'STAFF',
  id: 'staff-1',
  roles: Object.freeze(['seller_ops']),
});
const STAFF_PRINCIPAL: FileReadPrincipal = Object.freeze({
  type: 'STAFF_SESSION',
  staffId: 'staff-1',
});
const RESOURCE: FileAuthorizationResource = Object.freeze({
  uploadIntentId: 'intent-1',
  fileObjectId: 'proof-file-1',
  ownerActorType: 'STAFF',
  ownerActorId: 'staff-uploader',
  purpose: 'SELLER_SETTLEMENT_PROOF',
  visibility: 'INTERNAL_ONLY',
  entityType: 'SELLER_SETTLEMENT',
  entityId: 'payment-1',
  fileEntityLinkId: 'proof-link-1',
  linkAuthorizationMode: 'EXPLICIT_AUDIENCES',
  linkExpiresAt: null,
  linkRevokedAt: null,
});

function scenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    staffStatus: 'ACTIVE',
    roles: ['seller_ops'],
    grants: ['SELLER_SETTLEMENT_VIEW'],
    denies: [],
    teamId: 'team-1',
    leader: false,
    authorityOrganizationId: 'seller-1',
    directOrganizationId: 'seller-1',
    teamOrganizationId: null,
    ...overrides,
  };
}

async function authorize(input: Scenario): Promise<void> {
  await authorizeExplicitAudienceRead(
    fakeDatabase(input),
    STAFF_PRINCIPAL,
    STAFF_ACTOR,
    RESOURCE,
    NOW,
  );
}

describe('seller settlement proof dynamic file authorization', () => {
  it('allows an active Owner with global scope', async () => {
    await expect(authorize(scenario({
      roles: ['owner'],
      grants: [],
      teamId: null,
      directOrganizationId: null,
    }))).resolves.toBeUndefined();
  });

  it('allows the active Seller Account Manager', async () => {
    await expect(authorize(scenario())).resolves.toBeUndefined();
  });

  it('allows a legal Team Manager over the assigned account manager', async () => {
    await expect(authorize(scenario({
      grants: ['SELLER_SETTLEMENT_VIEW', 'TASK_VIEW_TEAM'],
      leader: true,
      directOrganizationId: null,
      teamOrganizationId: 'seller-1',
    }))).resolves.toBeUndefined();
  });

  it('rejects VIEW permission without responsibility for the organization', async () => {
    await expect(authorize(scenario({
      directOrganizationId: null,
      teamOrganizationId: null,
    }))).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('applies Personal DENY after role defaults and grants', async () => {
    await expect(authorize(scenario({
      roles: ['owner'],
      grants: [],
      denies: ['SELLER_SETTLEMENT_VIEW'],
      teamId: null,
      directOrganizationId: null,
    }))).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects cross Seller Organization access', async () => {
    await expect(authorize(scenario({
      authorityOrganizationId: 'seller-2',
      directOrganizationId: 'seller-1',
    }))).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects guessed file or link identifiers', async () => {
    await expect(authorize(scenario({
      authorityOrganizationId: null,
    }))).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects Buyer and Seller principals even if a customer grant existed', async () => {
    const database = fakeDatabase(scenario());
    await expect(authorizeExplicitAudienceRead(
      database,
      {
        type: 'BUYER_SESSION',
        accountId: 'buyer-account',
        identitySubjectId: 'buyer-subject',
      },
      { type: 'BUYER_CUSTOMER', id: 'buyer-1', roles: [] },
      RESOURCE,
      NOW,
    )).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(authorizeExplicitAudienceRead(
      database,
      {
        type: 'SELLER_SESSION',
        accountId: 'seller-account',
        identitySubjectId: 'seller-subject',
      },
      { type: 'SELLER_MEMBER', id: 'member-1', roles: [] },
      RESOURCE,
      NOW,
    )).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects common file authorization bypass without Seller scope', async () => {
    await expect(authorizeExplicitAudienceRead(
      fakeDatabase(scenario({
        directOrganizationId: null,
        teamOrganizationId: null,
      })),
      STAFF_PRINCIPAL,
      STAFF_ACTOR,
      RESOURCE,
      NOW,
    )).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects consumption when Assignment is revoked after token issuance', async () => {
    const token = generateOpaqueFileToken();
    const input = scenario({
      directOrganizationId: null,
      readIntentTokenHash: await hashOpaqueFileToken(token),
    });
    await expect(consumeFileReadIntent(
      fakeDatabase(input),
      failIfStorageIsRead(),
      new DenyAllFileAuthorizationService(),
      { readIntentId: 'read-intent-1', accessToken: token },
      { actor: STAFF_ACTOR, principal: STAFF_PRINCIPAL, now: NOW },
    )).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects consumption when permission becomes DENY after token issuance', async () => {
    const token = generateOpaqueFileToken();
    const input = scenario({
      roles: ['owner'],
      grants: [],
      denies: ['SELLER_SETTLEMENT_VIEW'],
      teamId: null,
      directOrganizationId: null,
      readIntentTokenHash: await hashOpaqueFileToken(token),
    });
    await expect(consumeFileReadIntent(
      fakeDatabase(input),
      failIfStorageIsRead(),
      new DenyAllFileAuthorizationService(),
      { readIntentId: 'read-intent-1', accessToken: token },
      { actor: STAFF_ACTOR, principal: STAFF_PRINCIPAL, now: NOW },
    )).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

function fakeDatabase(input: Scenario): SqlDatabase {
  return {
    prepare(sql: string): SqlStatement {
      let bindings: readonly unknown[] = [];
      const statement: SqlStatement = {
        bind(...values: unknown[]): SqlStatement {
          bindings = values;
          return statement;
        },
        async first<T>(): Promise<T | null> {
          if (sql.includes('FROM file_read_intents read')) {
            if (!input.readIntentTokenHash) return null;
            return {
              id: 'proof-file-1',
              upload_intent_id: 'intent-1',
              object_key: 'proofs/proof-file-1.png',
              purpose: 'SELLER_SETTLEMENT_PROOF',
              visibility: 'INTERNAL_ONLY',
              status: 'VERIFIED',
              version: 1,
              detected_mime: 'image/png',
              uploaded_byte_size: 8,
              uploaded_sha256: 'unused-before-authorization',
              owner_actor_type: 'STAFF',
              owner_actor_id: 'staff-uploader',
              intent_status: 'VERIFIED',
              intent_version: 1,
              intent_expires_at: NOW + 100_000,
              file_entity_link_id: 'proof-link-1',
              entity_type: 'SELLER_SETTLEMENT',
              entity_id: 'payment-1',
              authorization_mode: 'EXPLICIT_AUDIENCES',
              link_expires_at: null,
              link_revoked_at: null,
              read_intent_id: 'read-intent-1',
              read_actor_type: 'STAFF',
              read_actor_id: 'staff-1',
              token_hash: input.readIntentTokenHash,
              read_status: 'ISSUED',
              read_expires_at: NOW + 10_000,
            } as T;
          }
          if (sql.includes('SELECT status')
            && sql.includes('FROM staff_users')) {
            return { status: input.staffStatus } as T;
          }
          if (sql.includes('SELECT id, display_name, status, authorization_version')) {
            return input.staffStatus === 'ACTIVE'
              ? {
                  id: 'staff-1',
                  display_name: 'Staff One',
                  status: 'ACTIVE',
                  authorization_version: 1,
                } as T
              : null;
          }
          if (sql.includes('FROM seller_payment_proofs proof')) {
            const linkId = String(bindings[1] ?? '');
            const fileObjectId = String(bindings[2] ?? '');
            return input.authorityOrganizationId !== null
              && linkId === 'proof-link-1'
              && fileObjectId === 'proof-file-1'
              ? {
                  payment_id: 'payment-1',
                  seller_organization_id: input.authorityOrganizationId,
                } as T
              : null;
          }
          if (sql.includes('FROM seller_staff_assignments assignment')
            && !sql.includes('assignee_membership')) {
            const organizationId = String(bindings[0] ?? '');
            return input.directOrganizationId === organizationId
              ? { allowed: 1 } as T
              : null;
          }
          if (sql.includes('assignee_membership')) {
            const organizationId = String(bindings[0] ?? '');
            return input.teamOrganizationId === organizationId
              ? { allowed: 1 } as T
              : null;
          }
          return null;
        },
        async all<T>(): Promise<{ results: T[] }> {
          if (sql.includes('SELECT role_code')) {
            return {
              results: input.roles.map((role_code) => ({ role_code })) as T[],
            };
          }
          if (sql.includes('SELECT permission_code, effect')) {
            return {
              results: [
                ...input.grants.map((permission_code) => ({
                  permission_code,
                  effect: 'GRANT',
                })),
                ...input.denies.map((permission_code) => ({
                  permission_code,
                  effect: 'DENY',
                })),
              ] as T[],
            };
          }
          if (sql.includes('membership.team_id')) {
            return {
              results: input.teamId === null
                ? []
                : [{
                    team_id: input.teamId,
                    team_status: 'ACTIVE',
                    department_status: 'ACTIVE',
                    is_leader: input.leader ? 1 : 0,
                  }] as T[],
            };
          }
          if (sql.includes('grant.staff_permission_code')) {
            return {
              results: [{
                staff_permission_code: 'SELLER_SETTLEMENT_VIEW',
                staff_scope_type: 'GLOBAL',
                staff_team_id: null,
              }] as T[],
            };
          }
          return { results: [] };
        },
        async run(): Promise<SqlRunResult> {
          return { meta: { changes: 1 } };
        },
      };
      return statement;
    },
    async batch(statements: readonly SqlStatement[]): Promise<SqlRunResult[]> {
      return statements.map(() => ({ meta: { changes: 1 } }));
    },
  };
}

function failIfStorageIsRead(): ObjectStorageAdapter {
  return {
    async putObject() { throw new Error('unexpected storage write'); },
    async headObject() { throw new Error('unexpected storage head'); },
    async readPrefix() { throw new Error('unexpected storage prefix read'); },
    async readObject() { throw new Error('authorization must fail first'); },
    async deleteObject() { throw new Error('unexpected storage delete'); },
  };
}