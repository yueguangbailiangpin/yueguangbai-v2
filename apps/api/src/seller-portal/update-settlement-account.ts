import type { SqlDatabase } from '@ygb/contracts';
import { SellerPortalError } from './errors';

const ACCOUNT_NAME_MAX = 100;
const ACCOUNT_IDENTIFIER_MIN = 3;
const ACCOUNT_IDENTIFIER_MAX = 128;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/u;

export interface SellerSettlementAccountInput {
  accountName: string;
  accountIdentifier: string;
}

/**
 * P16 卖家结算收款账户：{ account_name, account_identifier } 精确两键，
 * NFKC 归一化并去首尾空白；姓名 1-100、支付宝账号 3-128，禁控制字符。
 * 与买家 P7a 同构；成对约束在应用层（表级成对 CHECK 无法经 ALTER 添加）。
 * 仅 OWNER / OPERATIONS / FINANCE 可写（结算相关角色），VIEWER 只读。
 */
export function parseSellerSettlementAccountInput(
  value: unknown,
): SellerSettlementAccountInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SellerPortalError('VALIDATION_ERROR', 400);
  }
  const body = value as Record<string, unknown>;
  if (Object.keys(body).length !== 2
    || typeof body['account_name'] !== 'string'
    || typeof body['account_identifier'] !== 'string') {
    throw new SellerPortalError('VALIDATION_ERROR', 400);
  }
  const accountName = body['account_name'].normalize('NFKC').trim();
  const accountIdentifier
    = body['account_identifier'].normalize('NFKC').trim();
  if (accountName.length < 1
    || accountName.length > ACCOUNT_NAME_MAX
    || accountIdentifier.length < ACCOUNT_IDENTIFIER_MIN
    || accountIdentifier.length > ACCOUNT_IDENTIFIER_MAX
    || CONTROL_CHARS.test(accountName)
    || CONTROL_CHARS.test(accountIdentifier)) {
    throw new SellerPortalError('VALIDATION_ERROR', 400);
  }
  return { accountName, accountIdentifier };
}

/**
 * 幂等覆写（同值重复提交结果一致）；组织资料是低并发场景，不做乐观锁，
 * version 递增沿用表约定。
 */
export async function updateSellerSettlementAccount(
  database: SqlDatabase,
  sellerOrganizationId: string,
  input: SellerSettlementAccountInput,
  now: number,
): Promise<void> {
  await database.prepare(`
    UPDATE seller_organizations
    SET settlement_account_name=?,
      settlement_account_identifier=?,
      version=version+1,
      updated_at=?
    WHERE id=? AND status='ACTIVE'
  `).bind(
    input.accountName,
    input.accountIdentifier,
    now,
    sellerOrganizationId,
  ).run();
}
