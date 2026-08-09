import type {
  SqlDatabase,
  StaffMcpCurrentActor,
  StaffMcpNextStep,
  StaffMcpToolName,
  StaffPermissionCode,
} from '@ygb/contracts';
import {
  listVisibleWorkItems,
  scopeAllowsBuyer,
  scopeAllowsSellerOrganization,
  type AssignmentStaffAuthorization,
} from '../staff-assignment';
import {
  StaffMcpApplicationError,
  type StaffMcpApplicationOutput,
  type StaffMcpApplicationService,
} from './application-service';

const MARKETPLACE = Object.freeze({
  AMAZON_JP: 'JP',
  AMAZON_US: 'US',
  COUPANG_KR: 'KR',
} as const);

type ToolMarketplace = keyof typeof MARKETPLACE;

/** Production read/draft service. D1 remains the only business authority. */
export class D1StaffMcpApplicationService
implements StaffMcpApplicationService {
  constructor(private readonly database: SqlDatabase) {}

  async execute(
    toolName: StaffMcpToolName,
    args: Readonly<Record<string, unknown>>,
    actor: StaffMcpCurrentActor,
  ): Promise<StaffMcpApplicationOutput> {
    switch (toolName) {
      case 'list_staff_tasks_v1':
        return this.tasks(args, actor);
      case 'list_staff_exceptions_v1':
        throw new StaffMcpApplicationError('PROVIDER_UNAVAILABLE');
      case 'get_customer_summary_v1':
        return this.customer(args, actor);
      case 'get_order_summary_v1':
        return this.order(args, actor);
      case 'get_review_summary_v1':
        return this.review(args, actor);
      case 'get_refund_summary_v1':
        return this.refund(args, actor);
      case 'get_settlement_summary_v1':
        return this.settlement(args, actor);
      case 'read_task_screenshot_v1':
        throw new StaffMcpApplicationError('PROVIDER_UNAVAILABLE');
      case 'draft_wechat_message_v1':
        return this.wechatDraft(args, actor);
      case 'draft_reconciliation_v1': {
        const source = await this.settlement(args, actor);
        return draftFrom(source, '对账草稿已生成。请在受控 Web 页面核对最新明细后确认。');
      }
      case 'draft_payment_batch_v1': {
        const sources = await Promise.all((args['refund_ids'] as readonly string[])
          .map((refundId) => this.refund({
            refund_id: refundId,
            marketplace_code: args['marketplace_code'],
          }, actor)));
        return {
          kind: 'DRAFT',
          data: { draft_text: `付款批次草稿：共 ${sources.length} 笔返款。此草稿不可执行。` },
          sourceReferences: sources.flatMap((source) => source.sourceReferences),
          warnings: ['请在 Web 重新授权并逐笔读取最新状态。'],
          nextStep: webStep('请在受控 Web 页面逐笔核对并确认。', '/staff/buyer-refunds'),
          auditScope: { type: 'REFUND_BATCH', id: `count-${sources.length}` },
        };
      }
      case 'draft_review_recommendation_v1': {
        const source = await this.review(args, actor);
        return draftFrom(
          source,
          '审核建议草稿：请在 Web 重新读取评论、证据、当前权限和最新版本后决定。',
          webStep('请在受控 Web 页面作出最终审核决定。', `/staff/reviews/${String(args['review_id'])}`),
        );
      }
      case 'get_web_confirmation_step_v1':
        return this.webConfirmation(args, actor);
    }
  }

  private async tasks(
    args: Readonly<Record<string, unknown>>,
    actor: StaffMcpCurrentActor,
  ): Promise<StaffMcpApplicationOutput> {
    if (!actor.permissions.has('TASK_VIEW_OPEN')) notFound();
    const status = (args['status'] ?? 'OPEN') as 'OPEN' | 'COMPLETED' | 'CANCELLED';
    const cursor = decodeCursor(args['cursor']);
    const page = await listVisibleWorkItems(
      this.database,
      assignmentActor(actor),
      { status, limit: Number(args['limit']), cursor },
    ).catch(() => notFound());
    return {
      kind: 'FACT',
      data: {
        items: page.work_items.map((item) => ({
          task_id: item.work_item_id,
          title: workItemTitle(item.work_type),
          status: item.status,
          updated_at: Number(item.updated_at),
        })),
        next_cursor: encodeCursor(page.next_cursor),
      },
      sourceReferences: page.work_items.map((item) => ({
        object_type: 'TASK', object_id: item.work_item_id, version: Number(item.version),
      })),
      warnings: [],
      nextStep: none(),
      auditScope: { type: 'TASK_PAGE', id: `count-${page.work_items.length}` },
    };
  }

  private async customer(
    args: Readonly<Record<string, unknown>>,
    actor: StaffMcpCurrentActor,
  ): Promise<StaffMcpApplicationOutput> {
    const id = String(args['customer_id']);
    const marketplace = databaseMarketplace(args['marketplace_code']);
    if (args['customer_type'] === 'BUYER') {
      if (!actor.permissions.has('BUYER_VIEW')
        || !scopeAllowsBuyer(actor.dataScope, id)) notFound();
      const row = await this.database.prepare(`
        SELECT id,marketplace_code,display_name,access_status,version
        FROM buyer_customers WHERE id=? AND marketplace_code=?
      `).bind(id, marketplace).first<{
        id: string; marketplace_code: string; display_name: string;
        access_status: string; version: number;
      }>();
      if (!row) notFound();
      return fact('BUYER', row.id, Number(row.version), {
        summary: {
          customer_id: row.id,
          customer_type: 'BUYER',
          marketplace_code: toolMarketplace(row.marketplace_code),
          name: row.display_name,
          status: row.access_status,
          wechat_id: null,
        },
      });
    }
    if (!actor.permissions.has('SELLER_VIEW')
      || !scopeAllowsSellerOrganization(actor.dataScope, id)) notFound();
    const row = await this.database.prepare(`
      SELECT id,marketplace_code,organization_name,status,version
      FROM seller_organizations WHERE id=? AND marketplace_code=?
    `).bind(id, marketplace).first<{
      id: string; marketplace_code: string; organization_name: string;
      status: string; version: number;
    }>();
    if (!row) notFound();
    return fact('SELLER_ORGANIZATION', row.id, Number(row.version), {
      summary: {
        customer_id: row.id,
        customer_type: 'SELLER_ORGANIZATION',
        marketplace_code: toolMarketplace(row.marketplace_code),
        name: row.organization_name,
        status: row.status,
        wechat_id: null,
      },
    });
  }

  private async order(
    args: Readonly<Record<string, unknown>>,
    actor: StaffMcpCurrentActor,
  ): Promise<StaffMcpApplicationOutput> {
    if (!actor.permissions.has('ORDER_VIEW')) notFound();
    const row = await this.database.prepare(`
      SELECT id,buyer_customer_id,seller_organization_id,marketplace_code,
        amazon_order_number_normalized,status,final_paid_jpy,version
      FROM formal_orders WHERE id=? AND marketplace_code=?
    `).bind(
      String(args['order_id']),
      databaseMarketplace(args['marketplace_code']),
    ).first<{
      id: string; buyer_customer_id: string; seller_organization_id: string;
      marketplace_code: string; amazon_order_number_normalized: string;
      status: string; final_paid_jpy: number; version: number;
    }>();
    if (!row || !scopeAllowsBuyer(actor.dataScope, row.buyer_customer_id)
      || !scopeAllowsSellerOrganization(actor.dataScope, row.seller_organization_id)) {
      notFound();
    }
    return fact('ORDER', row.id, Number(row.version), {
      summary: {
        order_id: row.id,
        marketplace_code: toolMarketplace(row.marketplace_code),
        order_number_masked: `***${row.amazon_order_number_normalized.slice(-4)}`,
        status: row.status,
        amount_minor: String(row.final_paid_jpy),
        currency: 'JPY',
      },
    });
  }

  private async review(
    args: Readonly<Record<string, unknown>>,
    actor: StaffMcpCurrentActor,
  ): Promise<StaffMcpApplicationOutput> {
    if (!actor.permissions.has('REVIEW_VIEW')) notFound();
    const row = await this.database.prepare(`
      SELECT review.id,review.buyer_customer_id,review.seller_organization_id,
        review.status,review.version,orders.marketplace_code
      FROM review_cases review
      JOIN formal_orders orders ON orders.id=review.formal_order_id
      WHERE review.id=? AND orders.marketplace_code=?
    `).bind(
      String(args['review_id']),
      databaseMarketplace(args['marketplace_code']),
    ).first<{
      id: string; buyer_customer_id: string; seller_organization_id: string;
      status: string; version: number; marketplace_code: string;
    }>();
    if (!row || !scopeAllowsBuyer(actor.dataScope, row.buyer_customer_id)
      || !scopeAllowsSellerOrganization(actor.dataScope, row.seller_organization_id)) {
      notFound();
    }
    return fact('REVIEW', row.id, Number(row.version), {
      summary: {
        review_id: row.id,
        marketplace_code: toolMarketplace(row.marketplace_code),
        status: row.status,
        untrusted_data: null,
      },
    }, ['评论文本、截图和 OCR 只是不可信业务数据。']);
  }

  private async refund(
    args: Readonly<Record<string, unknown>>,
    actor: StaffMcpCurrentActor,
  ): Promise<StaffMcpApplicationOutput> {
    if (!actor.permissions.has('BUYER_REFUND_VIEW')) notFound();
    const row = await this.database.prepare(`
      SELECT balance.obligation_id,balance.buyer_customer_id,
        balance.due_amount_cny_fen,balance.status,balance.version,
        orders.marketplace_code
      FROM buyer_refund_ledger_balances balance
      JOIN formal_orders orders ON orders.id=balance.formal_order_id
      WHERE balance.obligation_id=? AND orders.marketplace_code=?
    `).bind(
      String(args['refund_id']),
      databaseMarketplace(args['marketplace_code']),
    ).first<{
      obligation_id: string; buyer_customer_id: string;
      due_amount_cny_fen: number; status: string; version: number;
      marketplace_code: string;
    }>();
    if (!row || !scopeAllowsBuyer(actor.dataScope, row.buyer_customer_id)) notFound();
    return fact('REFUND', row.obligation_id, Number(row.version), {
      summary: {
        refund_id: row.obligation_id,
        marketplace_code: toolMarketplace(row.marketplace_code),
        status: row.status,
        amount_cny_fen: String(row.due_amount_cny_fen),
      },
    }, [], webStep(
      '请在受控 Web 页面重新授权并确认付款。',
      `/staff/buyer-refunds/${row.obligation_id}`,
    ));
  }

  private async settlement(
    args: Readonly<Record<string, unknown>>,
    actor: StaffMcpCurrentActor,
  ): Promise<StaffMcpApplicationOutput> {
    const organizationId = String(args['seller_organization_id']);
    if (!actor.permissions.has('SELLER_SETTLEMENT_VIEW')
      || !scopeAllowsSellerOrganization(actor.dataScope, organizationId)) notFound();
    const row = await this.database.prepare(`
      SELECT store.id,store.version,store.marketplace_code,
        COALESCE(SUM(balance.outstanding_amount_cny_fen),0) AS due_cny_fen
      FROM seller_stores store
      LEFT JOIN formal_orders orders
        ON orders.store_id=store.id AND orders.seller_organization_id=store.organization_id
      LEFT JOIN seller_payable_balances balance ON balance.formal_order_id=orders.id
      WHERE store.id=? AND store.organization_id=? AND store.marketplace_code=?
      GROUP BY store.id
    `).bind(
      String(args['store_id']),
      organizationId,
      databaseMarketplace(args['marketplace_code']),
    ).first<{
      id: string; version: number; marketplace_code: string; due_cny_fen: number;
    }>();
    if (!row) notFound();
    return fact('SETTLEMENT', organizationId, Number(row.version), {
      summary: {
        seller_organization_id: organizationId,
        store_id: row.id,
        marketplace_code: toolMarketplace(row.marketplace_code),
        status: Number(row.due_cny_fen) > 0 ? 'DUE' : 'CLEAR',
        due_cny_fen: String(row.due_cny_fen),
      },
    }, [], webStep(
      '请在受控 Web 页面重新授权并确认结算。',
      `/staff/seller-settlements/${organizationId}`,
    ));
  }

  private async wechatDraft(
    args: Readonly<Record<string, unknown>>,
    actor: StaffMcpCurrentActor,
  ): Promise<StaffMcpApplicationOutput> {
    const objectId = String(args['object_id']);
    const marketplace = args['marketplace_code'];
    const source = args['object_type'] === 'ORDER'
      ? await this.order({ order_id: objectId, marketplace_code: marketplace }, actor)
      : args['object_type'] === 'REVIEW'
        ? await this.review({ review_id: objectId, marketplace_code: marketplace }, actor)
        : args['object_type'] === 'REFUND'
          ? await this.refund({ refund_id: objectId, marketplace_code: marketplace }, actor)
          : args['object_type'] === 'CUSTOMER'
            ? await this.customer({
                customer_type: actor.permissions.has('BUYER_VIEW')
                  ? 'BUYER' : 'SELLER_ORGANIZATION',
                customer_id: objectId,
                marketplace_code: marketplace,
              }, actor)
            : notFound();
    const greeting = args['tone'] === 'POLITE' ? '您好，辛苦您了。' : '您好。';
    return draftFrom(
      source,
      `${greeting}请您方便时登录受控页面查看当前事项。`,
    );
  }

  private async webConfirmation(
    args: Readonly<Record<string, unknown>>,
    actor: StaffMcpCurrentActor,
  ): Promise<StaffMcpApplicationOutput> {
    const action = String(args['action']);
    const objectId = String(args['object_id']);
    const mapping: Readonly<Record<string, {
      permission: StaffPermissionCode; path: string;
    }>> = {
      REFUND_PAYMENT: { permission: 'BUYER_REFUND_VIEW', path: 'buyer-refunds' },
      SELLER_SETTLEMENT: { permission: 'SELLER_SETTLEMENT_VIEW', path: 'seller-settlements' },
      RATE_CHANGE: { permission: 'FINANCIAL_VIEW', path: 'pricing' },
      REVIEW_DECISION: { permission: 'REVIEW_VIEW', path: 'reviews' },
      ORDER_CLOSE: { permission: 'ORDER_VIEW', path: 'orders' },
    };
    const selected = mapping[action];
    if (!selected || !actor.permissions.has(selected.permission)) notFound();
    await this.authorizeConfirmation(action, objectId, actor);
    return {
      kind: 'WARNING',
      data: { summary: { formal_action_executed: false, confirmation_required: true } },
      sourceReferences: [{ object_type: sourceType(action), object_id: objectId, version: null }],
      warnings: ['ChatGPT 中的自然语言“确认”不会执行正式写入。'],
      nextStep: webStep(
        '请员工在 Web 重新授权、读取最新版本并点击确认。',
        `/staff/${selected.path}/${objectId}`,
      ),
      auditScope: { type: sourceType(action), id: objectId },
    };
  }

  private async authorizeConfirmation(
    action: string,
    objectId: string,
    actor: StaffMcpCurrentActor,
  ): Promise<void> {
    const table = action === 'REFUND_PAYMENT'
      ? 'buyer_refund_obligations'
      : action === 'SELLER_SETTLEMENT'
        ? 'seller_organizations'
        : action === 'RATE_CHANGE'
          ? 'buyer_daily_exchange_rates'
          : action === 'REVIEW_DECISION'
            ? 'review_cases'
            : action === 'ORDER_CLOSE'
              ? 'formal_orders'
              : null;
    if (!table) notFound();
    if (table === 'buyer_refund_obligations') {
      const row = await this.database.prepare(`
        SELECT buyer_customer_id FROM buyer_refund_obligations WHERE id=?
      `).bind(objectId).first<{ buyer_customer_id: string }>();
      if (!row || !scopeAllowsBuyer(actor.dataScope, row.buyer_customer_id)) notFound();
      return;
    }
    if (table === 'seller_organizations') {
      const row = await this.database.prepare(`
        SELECT id FROM seller_organizations WHERE id=?
      `).bind(objectId).first<{ id: string }>();
      if (!row || !scopeAllowsSellerOrganization(actor.dataScope, row.id)) notFound();
      return;
    }
    if (table === 'review_cases' || table === 'formal_orders') {
      const row = await this.database.prepare(`
        SELECT buyer_customer_id,seller_organization_id FROM ${table} WHERE id=?
      `).bind(objectId).first<{
        buyer_customer_id: string; seller_organization_id: string;
      }>();
      if (!row || !scopeAllowsBuyer(actor.dataScope, row.buyer_customer_id)
        || !scopeAllowsSellerOrganization(actor.dataScope, row.seller_organization_id)) {
        notFound();
      }
      return;
    }
    if (actor.dataScope.type !== 'GLOBAL'
      || !await this.database.prepare(`
        SELECT id FROM buyer_daily_exchange_rates WHERE id=?
      `).bind(objectId).first()) notFound();
  }
}

function assignmentActor(actor: StaffMcpCurrentActor): AssignmentStaffAuthorization {
  return {
    staffId: actor.staffId,
    displayName: actor.displayName,
    staffStatus: 'ACTIVE',
    authorizationVersion: actor.authorizationVersion,
    roles: new Set([actor.role]),
    permissions: actor.permissions,
    memberTeamIds: actor.memberTeamIds,
    leaderTeamIds: actor.leaderTeamIds,
  };
}

function databaseMarketplace(value: unknown): string {
  const mapped = MARKETPLACE[String(value) as ToolMarketplace];
  return mapped ?? notFound();
}

function toolMarketplace(value: string): ToolMarketplace {
  const match = Object.entries(MARKETPLACE).find(([, code]) => code === value)?.[0];
  return (match as ToolMarketplace | undefined) ?? notFound();
}

function fact(
  objectType: string,
  objectId: string,
  version: number,
  data: Record<string, unknown>,
  warnings: readonly string[] = [],
  nextStep = none(),
): StaffMcpApplicationOutput {
  return {
    kind: 'FACT', data,
    sourceReferences: [{ object_type: objectType, object_id: objectId, version }],
    warnings, nextStep,
    auditScope: { type: objectType, id: objectId },
  };
}

function draftFrom(
  source: StaffMcpApplicationOutput,
  text: string,
  nextStep: StaffMcpNextStep = none(),
): StaffMcpApplicationOutput {
  return {
    kind: 'DRAFT',
    data: { draft_text: text },
    sourceReferences: source.sourceReferences,
    warnings: [], nextStep,
    auditScope: source.auditScope,
  };
}

function none(): StaffMcpNextStep {
  return { kind: 'NONE', label: '无需 Web 操作', web_path: null };
}

function webStep(label: string, path: string): StaffMcpNextStep {
  return { kind: 'WEB_CONFIRMATION_REQUIRED', label, web_path: path };
}

function decodeCursor(value: unknown): { createdAt: number; id: string } | null {
  if (value === null || value === undefined) return null;
  try {
    const normalized = String(value).replaceAll('-', '+').replaceAll('_', '/');
    const decoded = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
    const parsed: unknown = JSON.parse(decoded);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) notFound();
    const row = parsed as Record<string, unknown>;
    if (Object.keys(row).length !== 2 || !Number.isSafeInteger(row['at'])
      || Number(row['at']) < 0 || typeof row['id'] !== 'string') notFound();
    return { createdAt: Number(row['at']), id: row['id'] };
  } catch {
    return notFound();
  }
}

function encodeCursor(value: string | null): string | null {
  if (!value) return null;
  const parsed = JSON.parse(value) as { createdAt: number; id: string };
  return btoa(JSON.stringify({ at: parsed.createdAt, id: parsed.id }))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function workItemTitle(value: string): string {
  return ({
    PRODUCT_APPLICATION_REVIEW: '商品申请审核',
    DEMAND_REVIEW: '需求审核',
    RESERVATION_DECISION: '预约处理',
    ORDER_INSTRUCTION_PUBLISH: '订单指示发布',
    ORDER_EVIDENCE_REVIEW: '订单证据审核',
    REVIEW_DECISION: '评论审核',
    BUYER_REFUND_PROCESSING: '买家返款处理',
  } as Readonly<Record<string, string>>)[value] ?? '员工待办';
}

function sourceType(action: string): string {
  return ({
    REFUND_PAYMENT: 'REFUND',
    SELLER_SETTLEMENT: 'SETTLEMENT',
    RATE_CHANGE: 'RATE',
    REVIEW_DECISION: 'REVIEW',
    ORDER_CLOSE: 'ORDER',
  } as Readonly<Record<string, string>>)[action] ?? 'TASK';
}

function notFound(): never {
  throw new StaffMcpApplicationError('NOT_FOUND');
}
