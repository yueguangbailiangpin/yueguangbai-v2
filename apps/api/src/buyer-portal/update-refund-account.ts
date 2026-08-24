import type { SqlDatabase } from '@ygb/contracts';
import { BuyerPortalError } from './errors';

const ACCOUNT_NAME_MAX = 100;
const ACCOUNT_IDENTIFIER_MIN = 3;
const ACCOUNT_IDENTIFIER_MAX = 128;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/u;

export interface BuyerRefundAccountInput {
  accountName: string;
  accountIdentifier: string;
}

/**
 * P7a 买家收款账户：{ account_name, account_identifier } 精确两键，
 * NFKC 归一化并去首尾空白；姓名 1-100、支付宝账号 3-128，禁控制字符。
 * 成对提交（ALTER TABLE 加不了表级成对约束，应用层保证两字段同进同出）。
 */
export function parseBuyerRefundAccountInput(
  value: unknown,
): BuyerRefundAccountInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BuyerPortalError('VALIDATION_ERROR', 400);
  }
  const body = value as Record<string, unknown>;
  if (Object.keys(body).length !== 2
    || typeof body['account_name'] !== 'string'
    || typeof body['account_identifier'] !== 'string') {
    throw new BuyerPortalError('VALIDATION_ERROR', 400);
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
    throw new BuyerPortalError('VALIDATION_ERROR', 400);
  }
  return { accountName, accountIdentifier };
}

/**
 * 幂等覆写（同值重复提交结果一致）：不做乐观锁——买家资料是单用户
 * 场景，无并发对手方；version 递增沿用表约定。
 */
export async function updateBuyerRefundAccount(
  database: SqlDatabase,
  buyerCustomerId: string,
  input: BuyerRefundAccountInput,
  now: number,
): Promise<void> {
  await database.prepare(`
    UPDATE buyer_customers
    SET refund_account_name=?,
      refund_account_identifier=?,
      version=version+1,
      updated_at=?
    WHERE id=? AND access_status='ACTIVE'
  `).bind(
    input.accountName,
    input.accountIdentifier,
    now,
    buyerCustomerId,
  ).run();
}
