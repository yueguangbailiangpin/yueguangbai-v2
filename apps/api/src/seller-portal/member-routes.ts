import { apiFailure, apiSuccess, type SqlDatabase, type SqlStatement } from '@ygb/contracts';
import {
  hashCustomerPassword,
  hashOneTimeToken,
  normalizeWechatId,
  validateCustomerPassword,
  verifyCustomerPassword,
} from '@ygb/domain';
import type { Context, Hono } from 'hono';
import type { AppEnv } from '../app';
import { issueCustomerSession } from '../customer-auth/authenticate-customer';
import { consumeCustomerSecurityRateLimit } from '../customer-security/rate-limit';
import { writeCustomerSessionCookie } from '../http-auth/cookies';
import { CUSTOMER_SESSION_TTL_MS, requireCustomerSessionSecret } from '../http-auth/config';
import { requestIdFromContext } from '../http-auth/errors';
import { customerSessionMiddleware } from '../middleware/customer-auth';
import { customerAuthOriginGuard } from '../middleware/origin-guard';
import { resolveSellerPortalActor } from './actor';

const TTL = 7 * 24 * 60 * 60 * 1000;
class MemberError extends Error {
  constructor(
    public code:
      | 'VALIDATION_ERROR'
      | 'FORBIDDEN'
      | 'NOT_FOUND'
      | 'CONFLICT'
      | 'RATE_LIMITED'
      | 'DEPENDENCY_UNAVAILABLE',
    public status: 400 | 403 | 404 | 409 | 429 | 503,
  ) {
    super(code);
  }
}
interface Invitation {
  id: string;
  token_hash: string;
  organization_id: string;
  invited_wechat_normalized: string;
  invited_wechat_display: string;
  invited_display_name: string;
  invited_role: 'OPERATIONS' | 'FINANCE' | 'VIEWER';
  store_scope_json: string;
  issued_by_member_id: string;
  status: string;
  version: number;
  issued_at: number;
  expires_at: number;
}
interface ExistingIdentity {
  identity_subject_id: string;
  account_id: string | null;
  account_status: string | null;
  session_version: number | null;
  algorithm: 'PBKDF2_SHA256' | null;
  iterations: number | null;
  salt_base64url: string | null;
  hash_base64url: string | null;
}

export function registerSellerMemberRoutes(app: Hono<AppEnv>): void {
  const session = customerSessionMiddleware(),
    origin = customerAuthOriginGuard();
  app.get('/api/seller-portal/members', session, wrap(listMembers));
  app.get('/api/seller-portal/member-invitations', session, wrap(listInvitations));
  app.post('/api/seller-portal/member-invitations', origin, session, wrap(issueInvitation));
  app.post(
    '/api/seller-portal/member-invitations/:id/revoke',
    origin,
    session,
    wrap(revokeInvitation),
  );
  app.get('/api/seller-auth/member-invitations/:token', wrap(readPublicInvitation));
  app.post('/api/seller-auth/member-register', origin, wrap(completeInvitation));
}

async function listMembers(context: Context<AppEnv>) {
  const actor = await ownerActor(context);
  const rows = await context.env.DB.prepare(
    `SELECT member.id,member.display_name,member.role,member.primary_owner,member.status,member.member_number,
      claim.display_wechat AS wechat_id
    FROM seller_organization_members member
    LEFT JOIN wechat_identity_claims claim ON claim.identity_subject_id=member.identity_subject_id AND claim.status='ACTIVE'
    WHERE member.organization_id=? ORDER BY member.primary_owner DESC,member.member_number,member.id`,
  )
    .bind(actor.sellerOrganizationId)
    .all<any>();
  return ok(context, {
    members: rows.results.map((row) => ({
      member_id: String(row.id),
      display_name: String(row.display_name),
      role: row.role,
      wechat_id: row.wechat_id === null ? null : String(row.wechat_id),
      primary_owner: Number(row.primary_owner) === 1,
      status: row.status,
      member_number: Number(row.member_number),
    })),
  });
}
async function listInvitations(context: Context<AppEnv>) {
  const actor = await ownerActor(context);
  await expireInvitations(context.env.DB, actor.sellerOrganizationId, Date.now());
  const rows = await context.env.DB.prepare(
    `SELECT id,invited_wechat_display,invited_display_name,invited_role,store_scope_json,status,version,issued_at,expires_at,consumed_at,revoked_at
    FROM seller_member_invitations WHERE organization_id=? ORDER BY issued_at DESC,id DESC LIMIT 100`,
  )
    .bind(actor.sellerOrganizationId)
    .all<any>();
  return ok(context, {
    invitations: rows.results.map((row) => ({
      invitation_id: String(row.id),
      wechat_id: String(row.invited_wechat_display),
      display_name: String(row.invited_display_name),
      role: row.invited_role,
      store_ids: [],
      status: row.status,
      version: Number(row.version),
      issued_at: Number(row.issued_at),
      expires_at: Number(row.expires_at),
      consumed_at: row.consumed_at === null ? null : Number(row.consumed_at),
      revoked_at: row.revoked_at === null ? null : Number(row.revoked_at),
    })),
  });
}
async function issueInvitation(context: Context<AppEnv>) {
  const actor = await ownerActor(context);
  // D-056 §4.4: members see the whole organization, so invitations no longer
  // carry a store scope.
  const body = await exact(context, ['wechat_id', 'display_name', 'role']);
  if (
    typeof body['wechat_id'] !== 'string' ||
    typeof body['display_name'] !== 'string' ||
    typeof body['role'] !== 'string'
  )
    validation();
  const role = body['role'];
  if (!['OPERATIONS', 'FINANCE', 'VIEWER'].includes(role)) validation();
  const wechat = normalizeWechatId(body['wechat_id']),
    display = text(body['display_name'], 100);
  const membership = await context.env.DB.prepare(
    `SELECT member.id FROM wechat_identity_claims claim JOIN seller_organization_members member ON member.identity_subject_id=claim.identity_subject_id WHERE claim.normalized_wechat=? AND claim.status IN('ACTIVE','RESERVED') AND member.status='ACTIVE' LIMIT 1`,
  )
    .bind(wechat.normalized)
    .first();
  if (membership) throw new MemberError('CONFLICT', 409);
  await expireInvitations(context.env.DB, actor.sellerOrganizationId, Date.now());
  const active = await context.env.DB.prepare(
    `SELECT 1 AS present FROM seller_member_invitations WHERE organization_id=? AND invited_wechat_normalized=? AND status='ACTIVE'`,
  )
    .bind(actor.sellerOrganizationId, wechat.normalized)
    .first();
  if (active) throw new MemberError('CONFLICT', 409);
  const now = Date.now(),
    token = randomToken(),
    hash = await hashOneTimeToken(token),
    id = crypto.randomUUID(),
    expires = now + TTL;
  await context.env.DB.batch([
    context.env.DB.prepare(
      `INSERT INTO seller_member_invitations(id,token_hash,organization_id,invited_wechat_normalized,invited_wechat_display,invited_display_name,invited_role,store_scope_json,issued_by_member_id,status,version,issued_at,expires_at,consumed_at,consumed_member_id,consumed_account_id,revoked_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'ACTIVE',1,?,?,NULL,NULL,NULL,NULL,?,?)`,
    ).bind(
      id,
      hash,
      actor.sellerOrganizationId,
      wechat.normalized,
      wechat.display,
      display,
      role,
      JSON.stringify([]),
      actor.memberId,
      now,
      expires,
      now,
      now,
    ),
    event(context.env.DB, id, 'ISSUED', 'SELLER_MEMBER', actor.memberId, now),
  ]);
  return ok(
    context,
    {
      invitation: {
        invitation_id: id,
        registration_token: token,
        registration_path: `/seller/member-register?token=${encodeURIComponent(token)}`,
        wechat_id: wechat.display,
        display_name: display,
        role,
        store_ids: [],
        status: 'ACTIVE',
        version: 1,
        expires_at: expires,
      },
    },
    201,
  );
}
async function revokeInvitation(context: Context<AppEnv>) {
  const actor = await ownerActor(context);
  const body = await exact(context, ['expected_version']);
  if (!Number.isSafeInteger(body['expected_version'])) validation();
  const now = Date.now();
  const result = await context.env.DB.prepare(
    `UPDATE seller_member_invitations SET status='REVOKED',version=version+1,revoked_at=?,updated_at=? WHERE id=? AND organization_id=? AND status='ACTIVE' AND version=?`,
  )
    .bind(
      now,
      now,
      clean(context.req.param('id') ?? ''),
      actor.sellerOrganizationId,
      Number(body['expected_version']),
    )
    .run();
  if (Number(result.meta.changes) !== 1) throw new MemberError('CONFLICT', 409);
  await event(
    context.env.DB,
    clean(context.req.param('id') ?? ''),
    'REVOKED',
    'SELLER_MEMBER',
    actor.memberId,
    now,
  ).run();
  return ok(context, { revoked: true, revoked_at: now });
}
async function readPublicInvitation(context: Context<AppEnv>) {
  const token = context.req.param('token') ?? '';
  await rate(context, token);
  const invitation = await invitationByToken(context.env.DB, token, Date.now());
  return ok(context, {
    invitation: {
      invitation_valid: true,
      organization_name: invitation.organizationName,
      wechat_hint: mask(invitation.row.invited_wechat_display),
      display_name: invitation.row.invited_display_name,
      role: invitation.row.invited_role,
      expires_at: invitation.row.expires_at,
      existing_moonwhite_account:
        (await existingIdentity(context.env.DB, invitation.row.invited_wechat_normalized))
          ?.account_id != null,
    },
  });
}
async function completeInvitation(context: Context<AppEnv>) {
  const body = await exact(context, [
    'invitation_token',
    'wechat_id',
    'password',
    'password_confirmation',
  ]);
  if (
    typeof body['invitation_token'] !== 'string' ||
    typeof body['wechat_id'] !== 'string' ||
    typeof body['password'] !== 'string' ||
    typeof body['password_confirmation'] !== 'string' ||
    body['password'] !== body['password_confirmation']
  )
    validation();
  await rate(context, body['invitation_token']);
  try {
    validateCustomerPassword(body['password']);
  } catch {
    validation();
  }
  const now = Date.now(),
    wechat = normalizeWechatId(body['wechat_id']),
    invitation = await invitationByToken(context.env.DB, body['invitation_token'], now);
  if (invitation.row.invited_wechat_normalized !== wechat.normalized)
    throw new MemberError('CONFLICT', 409);
  const existing = await existingIdentity(context.env.DB, wechat.normalized);
  if (existing?.account_id) {
    if (
      existing.account_status !== 'ACTIVE' ||
      !existing.algorithm ||
      !existing.iterations ||
      !existing.salt_base64url ||
      !existing.hash_base64url
    )
      throw new MemberError('CONFLICT', 409);
    const valid = await verifyCustomerPassword(body['password'], {
      algorithm: existing.algorithm,
      iterations: Number(existing.iterations),
      saltBase64Url: existing.salt_base64url,
      hashBase64Url: existing.hash_base64url,
    });
    if (!valid) throw new MemberError('CONFLICT', 409);
  }
  if (existing) {
    const seller = await context.env.DB.prepare(
      `SELECT 1 AS present FROM seller_organization_members WHERE identity_subject_id=? AND status='ACTIVE' LIMIT 1`,
    )
      .bind(existing.identity_subject_id)
      .first();
    if (seller) throw new MemberError('CONFLICT', 409);
  }
  const org = await context.env.DB.prepare(
    `SELECT seller_code,organization_name,next_member_number,status FROM seller_organizations WHERE id=?`,
  )
    .bind(invitation.row.organization_id)
    .first<{
      seller_code: string;
      organization_name: string;
      next_member_number: number;
      status: string;
    }>();
  if (!org || org.status !== 'ACTIVE') throw new MemberError('CONFLICT', 409);
  const number = Number(org.next_member_number);
  if (!Number.isSafeInteger(number) || number < 1)
    throw new MemberError('DEPENDENCY_UNAVAILABLE', 503);
  const subjectId = existing?.identity_subject_id ?? crypto.randomUUID(),
    accountId = existing?.account_id ?? crypto.randomUUID(),
    memberId = crypto.randomUUID();
  const credential = existing?.account_id ? null : await hashCustomerPassword(body['password']);
  const statements: SqlStatement[] = [];
  if (!existing) {
    statements.push(
      context.env.DB.prepare(
        `INSERT INTO customer_identity_subjects(id,subject_type,created_at) VALUES(?,'SELLER_ORG_MEMBER',?)`,
      ).bind(subjectId, now),
      context.env.DB.prepare(
        `INSERT INTO wechat_identity_claims(id,identity_subject_id,display_wechat,normalized_wechat,status,version,acquired_at,reserved_at,released_at,created_at,updated_at,identity_subject_type) VALUES(?,?,?,?,'ACTIVE',1,?,NULL,NULL,?,?,'SELLER_ORG_MEMBER')`,
      ).bind(crypto.randomUUID(), subjectId, wechat.display, wechat.normalized, now, now, now),
    );
  }
  if (!existing?.account_id && credential) {
    statements.push(
      context.env.DB.prepare(
        `INSERT INTO customer_login_accounts(id,identity_subject_id,account_type,login_identifier_display,login_identifier_normalized,status,session_version,password_change_required,version,created_at,updated_at,activated_at,disabled_at,registration_source) VALUES(?,?,'SELLER_MEMBER',?,?,'ACTIVE',1,0,1,?,?,?,NULL,'SELF_REGISTRATION_CLAIM')`,
      ).bind(accountId, subjectId, wechat.display, wechat.normalized, now, now, now),
      context.env.DB.prepare(
        `INSERT INTO customer_password_credentials(account_id,algorithm,iterations,salt_base64url,hash_base64url,password_version,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)`,
      ).bind(
        accountId,
        credential.algorithm,
        credential.iterations,
        credential.saltBase64Url,
        credential.hashBase64Url,
        now,
        now,
      ),
    );
  }
  statements.push(
    context.env.DB.prepare(
      `INSERT INTO seller_organization_members(id,identity_subject_id,organization_id,member_number,username_fallback,display_name,role,primary_owner,status,version,created_at,updated_at,activated_at,disabled_at) VALUES(?,?,?,?,?, ?,?,0,'ACTIVE',1,?,?,?,NULL)`,
    ).bind(
      memberId,
      subjectId,
      invitation.row.organization_id,
      number,
      `${org.seller_code}-member-${number}`,
      invitation.row.invited_display_name,
      invitation.row.invited_role,
      now,
      now,
      now,
    ),
    context.env.DB.prepare(
      `UPDATE seller_organizations SET next_member_number=next_member_number+1,version=version+1,updated_at=? WHERE id=? AND next_member_number=?`,
    ).bind(now, invitation.row.organization_id, number),
    context.env.DB.prepare(
      `INSERT OR IGNORE INTO customer_account_personas(account_id,identity_subject_id,persona_type,buyer_customer_id,seller_member_id,created_at) VALUES(?,?,'SELLER_MEMBER',NULL,?,?)`,
    ).bind(accountId, subjectId, memberId, now),
    context.env.DB.prepare(
      `UPDATE seller_member_invitations SET status='CONSUMED',version=version+1,consumed_at=?,consumed_member_id=?,consumed_account_id=?,updated_at=? WHERE id=? AND status='ACTIVE' AND expires_at>?`,
    ).bind(now, memberId, accountId, now, invitation.row.id, now),
    event(context.env.DB, invitation.row.id, 'CONSUMED', 'CUSTOMER', accountId, now),
  );
  await context.env.DB.batch(statements);
  const sessionVersion = Number(existing?.session_version ?? 1),
    secret = requireCustomerSessionSecret(context.env.CUSTOMER_SESSION_SECRET);
  const token = await issueCustomerSession(
    {
      accountId,
      identitySubjectId: subjectId,
      accountType: 'SELLER_MEMBER',
      availablePersonas: ['SELLER_MEMBER'],
      sessionVersion,
      passwordChangeRequired: false,
    },
    secret,
    { now, ttlMs: CUSTOMER_SESSION_TTL_MS },
  );
  writeCustomerSessionCookie(context, token);
  return ok(
    context,
    {
      session_established: true,
      next_path: '/seller',
      seller_organization_id: invitation.row.organization_id,
      seller_member_id: memberId,
    },
    201,
  );
}

async function ownerActor(context: Context<AppEnv>) {
  const actor = await resolveSellerPortalActor(context);
  if (actor.role !== 'OWNER') throw new MemberError('FORBIDDEN', 403);
  return actor;
}
async function invitationByToken(database: SqlDatabase, token: string, now: number) {
  const hash = await hashOneTimeToken(token);
  const row = await database
    .prepare(
      `SELECT * FROM seller_member_invitations WHERE token_hash=? AND status='ACTIVE' AND expires_at>?`,
    )
    .bind(hash, now)
    .first<Invitation>();
  if (!row) throw new MemberError('CONFLICT', 409);
  const org = await database
    .prepare(`SELECT organization_name,status FROM seller_organizations WHERE id=?`)
    .bind(row.organization_id)
    .first<{ organization_name: string; status: string }>();
  if (!org || org.status !== 'ACTIVE') throw new MemberError('CONFLICT', 409);
  return { row, organizationName: org.organization_name };
}
async function existingIdentity(database: SqlDatabase, wechat: string) {
  const rows = await database
    .prepare(
      `SELECT claim.identity_subject_id,account.id AS account_id,account.status AS account_status,account.session_version,credential.algorithm,credential.iterations,credential.salt_base64url,credential.hash_base64url FROM wechat_identity_claims claim LEFT JOIN customer_login_accounts account ON account.identity_subject_id=claim.identity_subject_id LEFT JOIN customer_password_credentials credential ON credential.account_id=account.id WHERE claim.normalized_wechat=? AND claim.status IN('ACTIVE','RESERVED')`,
    )
    .bind(wechat)
    .all<ExistingIdentity>();
  if (rows.results.length > 1) throw new MemberError('CONFLICT', 409);
  return rows.results[0] ?? null;
}
async function expireInvitations(database: SqlDatabase, org: string, now: number) {
  await database
    .prepare(
      `UPDATE seller_member_invitations SET status='EXPIRED',version=version+1,updated_at=? WHERE organization_id=? AND status='ACTIVE' AND expires_at<=?`,
    )
    .bind(now, org, now)
    .run();
}
function event(
  database: SqlDatabase,
  id: string,
  type: 'ISSUED' | 'CONSUMED' | 'REVOKED' | 'EXPIRED',
  actorType: 'SELLER_MEMBER' | 'CUSTOMER' | 'SYSTEM',
  actorId: string | null,
  now: number,
) {
  return database
    .prepare(
      `INSERT INTO seller_member_invitation_events(id,invitation_id,event_type,actor_type,actor_id,created_at) VALUES(?,?,?,?,?,?)`,
    )
    .bind(crypto.randomUUID(), id, type, actorType, actorId, now);
}
async function rate(context: Context<AppEnv>, token: string) {
  const secret = String(context.env.CUSTOMER_SECURITY_TOKEN_SECRET ?? '');
  if (new TextEncoder().encode(secret).byteLength < 32)
    throw new MemberError('DEPENDENCY_UNAVAILABLE', 503);
  const result = await consumeCustomerSecurityRateLimit(context.env.DB, {
    operation: 'INVITATION',
    primaryScope: { type: 'TOKEN', value: token },
    networkSource: context.req.header('CF-Connecting-IP') ?? null,
    deviceId: context.req.header('X-Device-ID') ?? null,
    secret,
    now: Date.now(),
  });
  if (result.limited) throw new MemberError('RATE_LIMITED', 429);
}
function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}
async function exact(context: Context<AppEnv>, keys: string[]) {
  let value: unknown;
  try {
    value = await context.req.json();
  } catch {
    validation();
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) validation();
  const body = value as Record<string, unknown>;
  if (Object.keys(body).length !== keys.length || keys.some((key) => !Object.hasOwn(body, key)))
    validation();
  return body;
}
function clean(value: string) {
  const v = String(value).normalize('NFKC').trim();
  if (v.length < 1 || v.length > 200 || /[\u0000-\u001f\u007f]/u.test(v)) validation();
  return v;
}
function text(value: string, max: number) {
  const v = clean(value);
  if (v.length > max) validation();
  return v;
}
function mask(value: string) {
  return value.length <= 4 ? '***' : `${value.slice(0, 2)}***${value.slice(-2)}`;
}
function validation(): never {
  throw new MemberError('VALIDATION_ERROR', 400);
}
function ok(context: Context<AppEnv>, data: unknown, status = 200) {
  context.header('Cache-Control', 'no-store');
  return context.json(apiSuccess(data, requestIdFromContext(context)), status as 200 | 201);
}
function wrap(handler: (context: Context<AppEnv>) => Promise<Response>) {
  return async (context: Context<AppEnv>) => {
    try {
      return await handler(context);
    } catch (error) {
      const e =
        error instanceof MemberError ? error : new MemberError('DEPENDENCY_UNAVAILABLE', 503);
      return context.json(
        apiFailure(
          e.code,
          e.code === 'FORBIDDEN'
            ? '只有卖家主账号可以管理员工成员'
            : e.code === 'RATE_LIMITED'
              ? '尝试次数过多，请稍后再试'
              : e.code === 'NOT_FOUND'
                ? '没有找到对应记录'
                : e.code === 'CONFLICT'
                  ? '邀请已失效、身份已占用或密码验证失败'
                  : e.code === 'VALIDATION_ERROR'
                    ? '提交信息不正确'
                    : '卖家成员服务暂时不可用',
          requestIdFromContext(context),
        ),
        e.status,
      );
    }
  };
}
