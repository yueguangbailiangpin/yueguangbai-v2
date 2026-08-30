import { RateSummaryCard } from '../shared/RateSummaryCard';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { z } from 'zod';
import { isFrontendApiError } from '../../api/errors';
import { identityApiRequest } from '../../api/identity-request';
import { operationHeaders } from '../../api/idempotency';
import { useCurrentStaffSession } from '../../auth/staff/StaffSessionBoundary';
import { useFileUpload } from '../../buyer/shared/useFileUpload';
import { FileDropZone } from '../../ui/FileDropZone';
import {
  Alert, Button, Card, Checkbox, DataTable, EmptyState, FormField,
  RequestIdDisplay, Select, StatusBadge, TextInput,
} from '../../ui/primitives';
import { staffApi } from '../api/client';
import type {
  DemandSchedulePreview,
  StaffProductDetail,
  StaffReservationSchedulePage,
} from '../contracts/runtime';
import { staffWorkbenchKeys } from '../queries/keys';
import {
  StaffMutationAuthority,
  type StaffMutationRequest,
} from '../mutations/StaffMutationAuthority';
import { StaffProtectedImage } from '../shared/StaffProtectedImage';
import { formatShanghai } from '../shared/format';

export function ProductSchedulingWorkspace(): React.JSX.Element {
  const { productId, demandId } = useParams();
  if (demandId) return <ReservationScheduleDetail demandId={demandId} />;
  if (productId) return <ProductDetail productId={productId} />;
  return <ProductList />;
}

function ProductList(): React.JSX.Element {
  const session = useCurrentStaffSession();
  const client = useQueryClient();
  const [parameters, setParameters] = useSearchParams();
  const search = parameters.get('q') ?? '';
  const cursor = parameters.get('cursor');
  const authorized = session.permissions.includes('PRODUCT_VIEW');
  const query = useQuery({
    queryKey: staffWorkbenchKeys.products(
      session.authorization_version, search, cursor,
    ),
    queryFn: ({ signal }) => staffApi.products(client, { search, cursor }, signal)
      .then((response) => response.data.page),
    enabled: authorized,
    retry: false,
  });
  if (!authorized) return <PermissionMessage />;
  return <main className="product-scheduling-workspace">
    <form className="product-search" role="search" onSubmit={(event) => {
      event.preventDefault();
      const value = String(new FormData(event.currentTarget).get('search') ?? '').trim();
      setParameters(value ? { q: value } : {});
    }}>
      <FormField label="搜索产品" htmlFor="staff-product-search">
        <TextInput id="staff-product-search" name="search" defaultValue={search}
          placeholder="产品名称、ASIN 或店铺" maxLength={200} />
      </FormField>
      <Button type="submit">搜索</Button>
    </form>
    {query.isPending ? <p role="status">加载中…</p>
      : query.isError ? <QueryError error={query.error} retry={() => { void query.refetch(); }} />
      : query.data.items.length === 0 ? <EmptyState title="没有可查看的产品"
        description="请检查搜索条件，或确认产品所在卖家/买家在您的有效数据范围内。" />
      : <Card><DataTable caption="员工产品库"><thead><tr>
          <th scope="col">产品</th><th scope="col">店铺 / ASIN</th>
          <th scope="col">主要对接人</th>
          <th scope="col">下单节奏</th><th scope="col">状态</th><th scope="col">操作</th>
        </tr></thead><tbody>{query.data.items.map((product) => <tr key={product.product_id}>
          <th scope="row">{product.product_name}<small>当前 v{product.current_version_no}</small></th>
          <td>{product.store_name}<small>{product.asin}</small></td>
          <td>{product.primary_contact_member_name ?? '未设置'}</td>
          <td>{cadenceLabel(product.cadence)}</td>
          <td><StatusBadge tone={product.status === 'ACTIVE' ? 'success' : 'neutral'}>
            {product.status === 'ACTIVE' ? '有效' : '已停用'}
          </StatusBadge></td>
          <td><Link className="button-link" to={`/staff/products/${encodeURIComponent(product.product_id)}`}>
            查看详情
          </Link></td>
        </tr>)}</tbody></DataTable></Card>}
    {query.data ? <nav className="pagination-actions" aria-label="产品分页">
      <Button className="secondary" disabled={!cursor} onClick={() => {
        const next = new URLSearchParams(parameters); next.delete('cursor'); setParameters(next);
      }}>返回第一页</Button>
      <Button className="secondary" disabled={!query.data.next_cursor} onClick={() => {
        const next = new URLSearchParams(parameters);
        if (query.data.next_cursor) next.set('cursor', query.data.next_cursor);
        setParameters(next);
      }}>下一页</Button>
    </nav> : null}
  </main>;
}

function ProductDetail({ productId }: { productId: string }): React.JSX.Element {
  const session = useCurrentStaffSession();
  const client = useQueryClient();
  const authorized = session.permissions.includes('PRODUCT_VIEW');
  const canEdit = (session.role.code === 'owner' || session.role.code === 'seller_ops')
    && session.permissions.includes('PRODUCT_REVIEW')
    && session.permissions.includes('DEMAND_PUBLISH');
  const query = useQuery({
    queryKey: staffWorkbenchKeys.product(session.authorization_version, productId),
    queryFn: ({ signal }) => staffApi.product(client, productId, signal)
      .then((response) => response.data.product),
    enabled: authorized,
    retry: false,
  });
  if (!authorized) return <PermissionMessage />;
  if (query.isPending) return <main className="product-scheduling-workspace"><p role="status">加载中…</p></main>;
  if (query.isError) return <main className="product-scheduling-workspace"><QueryError error={query.error}
    retry={() => { void query.refetch(); }} /></main>;
  const product = query.data;
  return <main className="product-scheduling-workspace">
    <nav className="breadcrumb" aria-label="面包屑"><Link to="/staff/products">产品库</Link><span>/</span>
      <span aria-current="page">{product.product_name}</span></nav>
    <section className="product-detail-summary">
      <Card><p className="eyebrow">当前产品版本</p><h2>{product.product_name}</h2>
        <dl><dt>店铺</dt><dd>{product.store_name}</dd><dt>ASIN</dt><dd>{product.asin}</dd>
          <dt>下单节奏</dt><dd>{cadenceLabel(product.cadence)}</dd></dl></Card>
      <Card><p className="eyebrow">排期口径</p><h2>北京时间自然日</h2>
        <p>周六、周日及所有节假日连续计入，不接入工作日日历。</p>
        <CadenceExamples /></Card>
    </section>
    <PrimaryContactCard product={product} />
    <RateSummaryCard organizationId={null} />
    {canEdit ? <ProductVersionForm product={product} /> : null}
    {product.versions.length > 0 ? <MainImageCard product={product} canEdit={canEdit} /> : null}
    <section aria-labelledby="product-demands-title"><h2 id="product-demands-title">需求与预约</h2>
      {product.demands.length === 0 ? <EmptyState title="暂无需求" description="该产品还没有需求记录。" />
        : <Card><DataTable caption="产品需求排期"><thead><tr><th scope="col">需求</th>
          <th scope="col">状态</th><th scope="col">有效预约</th><th scope="col">首单日期</th>
          <th scope="col">下单截止</th><th scope="col">操作</th></tr></thead><tbody>
          {product.demands.map((demand) => <tr key={demand.demand_batch_id}>
            <th scope="row">{demand.demand_batch_id}</th><td>{demandStatus(demand.status)}</td>
            <td>{demand.effective_reservation_count} / {demand.target_quantity}</td>
            <td>{demand.first_order_date ?? '尚未配置排期'}</td>
            <td>{formatShanghai(demand.order_deadline)}</td>
            <td><Link className="button-link"
              to={`/staff/demands/${encodeURIComponent(demand.demand_batch_id)}/reservations`}>
              查看预约
            </Link></td>
          </tr>)}</tbody></DataTable></Card>}
    </section>
    <details className="product-version-history">
      <summary><h2 id="product-versions-title">版本历史（{product.versions.length}）</h2></summary>
    <section aria-labelledby="product-versions-title">
      <ol className="version-history">{product.versions.map((version) => <li key={version.product_version_id}>
        <strong>版本 v{version.version_no} · {version.product_name}</strong>
        <span>{cadenceLabel(version.cadence)} · {formatShanghai(version.created_at)}</span>
        <span>{version.main_image
          ? `已绑定主图（${version.main_image.client_file_name}）`
          : '未绑定主图'}</span>
      </li>)}</ol></section>
    </details>
  </main>;
}

function MainImageCard({ product, canEdit }: {
  product: StaffProductDetail;
  canEdit: boolean;
}): React.JSX.Element | null {
  const client = useQueryClient();
  const [uploader, upload] = useFileUpload();
  const current = product.versions[0]!;
  const authority = useMemo(
    () => new StaffMutationAuthority<Awaited<ReturnType<typeof staffApi.linkMainImage>>>(),
    [],
  );
  const mutation = useMutation({
    mutationFn: (request: StaffMutationRequest | null) =>
      request === null
        ? authority.retry()
        : authority.execute(request, ({ body }, key) =>
            staffApi.linkMainImage(client, current.product_version_id, body, key)),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: staffWorkbenchKeys.productsRoot });
    },
  });
  const bound = current.main_image;
  const uploaded = upload.manifest?.files[0] ?? null;
  function bind(): void {
    if (!uploaded) return;
    mutation.mutate({
      action: 'link-product-version-main-image',
      path: `/api/staff/catalog/product-versions/${encodeURIComponent(current.product_version_id)}/main-image`,
      body: {
        file_object_id: uploaded.file_object_id,
        expected_file_version: uploaded.file_version,
      },
    });
  }
  return <Card className="product-main-image">
    <h2>当前版本主图 · 当前 v{current.version_no}</h2>
    {bound ? <>
      <dl><dt>文件</dt><dd>{bound.client_file_name}</dd>
        <dt>绑定时间</dt><dd>{formatShanghai(bound.bound_at)}</dd></dl>
      <StaffProtectedImage
        alt={`${current.product_name} 主图`}
        className="protected-product-main-image"
        fallback={<span className="protected-image-placeholder">主图加载中</span>}
        reference={{
          file_object_id: bound.file_object_id,
          file_version: bound.file_version,
          purpose: 'PRODUCT_IMAGE',
          visibility: 'SELLER_VISIBLE',
        }}
      />
      <p>主图与产品版本一次绑定，不可改写；如需更换，请新增产品版本后为新版本绑定。</p>
    </> : <>
      <Alert tone="warning">该版本尚未绑定主图；未绑定主图的版本不能通过需求发布审核。</Alert>
      {canEdit ? <>
        <FileDropZone
          id="staff-product-main-image"
          aria-label="产品主图"
          accept="image/jpeg,image/png,image/webp"
          disabled={mutation.isPending}
          maximumFiles={1}
          maximumBytes={10 * 1024 * 1024}
          buttonLabel="选择主图"
          emptyLabel="尚未选择主图"
          onFilesChange={(files) => {
            if (!mutation.isPending) {
              authority.release();
              mutation.reset();
            }
            const file = files[0];
            if (file) void uploader.start('staffProductImage', [file]);
          }}
        />
        <p className="staff-upload-state">上传状态：{upload.state}</p>
        <Button
          disabled={upload.state !== 'VERIFIED' || !uploaded || mutation.isPending}
          loading={mutation.isPending}
          loadingLabel="绑定中…"
          onClick={bind}
        >
          绑定为主图
        </Button>
      </> : <p>需要具有商品审核权限的员工补齐主图。</p>}
    </>}
    {mutation.isError ? <>
      <Alert tone="danger">主图绑定未完成。（错误码：{mainImageError(mutation.error)}）</Alert>
      <RequestIdDisplay
        requestId={isFrontendApiError(mutation.error) ? mutation.error.requestId : null}
      />
    </> : null}
  </Card>;
}

function mainImageError(error: unknown): string {
  if (!isFrontendApiError(error)) return 'UNKNOWN';
  return error.code;
}

function ProductVersionForm({ product }: { product: StaffProductDetail }): React.JSX.Element {
  const client = useQueryClient();
  const authority = useMemo(() => new StaffMutationAuthority<
    Awaited<ReturnType<typeof staffApi.addProductVersion>>
  >(), []);
  const [uploader, upload] = useFileUpload();
  const current = product.versions[0];
  const [mainImageChoice, setMainImageChoice] = useState<'INHERIT' | 'NONE' | 'UPLOAD'>(
    current?.main_image ? 'INHERIT' : 'NONE',
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string|null>(null);
  const [requestId, setRequestId] = useState<string|null>(null);
  if (!current) return <Alert tone="warning">当前产品没有可复制的版本。</Alert>;
  const uploaded = upload.manifest?.files[0] ?? null;
  async function execute(request: StaffMutationRequest | null): Promise<void> {
    setBusy(true); setMessage(null); setRequestId(null);
    try {
      const response = request === null
        ? await authority.retry()
        : await authority.execute(request, ({ body }, key) =>
            staffApi.addProductVersion(client, product.product_id, body, key));
      setRequestId(response.requestId); setMessage('新产品版本已保存，旧版本保持不变。');
      await client.invalidateQueries({ queryKey: staffWorkbenchKeys.productsRoot });
    } catch (error) {
      setRequestId(isFrontendApiError(error) ? error.requestId : null);
      setMessage(errorMessage(error));
    } finally { setBusy(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (authority.canRetry()) {
      void execute(null);
      return;
    }
    if (mainImageChoice === 'UPLOAD'
      && (upload.state !== 'VERIFIED' || !uploaded)) {
      setMessage('请先完成新主图上传，或改选继承上一版主图。');
      return;
    }
    const data = new FormData(event.currentTarget);
    const body = {
      expected_version: product.aggregate_version,
      version: {
        product_name: String(data.get('product_name') ?? ''),
        search_keywords: String(data.get('search_keywords') ?? '').split('\n')
          .map((value) => value.trim()).filter(Boolean),
        ordering_guide_expected_amount_jpy: Number(data.get('amount')),
        color_spec_mode: String(data.get('color_mode')),
        default_buyer_self_pay_bps: Number(data.get('self_pay_bps')),
        product_url: emptyToNull(data.get('product_url')),
        buyer_visible_notes: emptyToNull(data.get('buyer_notes')),
        internal_notes: emptyToNull(data.get('internal_notes')),
        order_interval_days: Number(data.get('interval')),
        orders_per_run: Number(data.get('per_run')),
      },
      main_image: mainImageChoice === 'UPLOAD' && uploaded
        ? {
            file_object_id: uploaded.file_object_id,
            expected_file_version: uploaded.file_version,
          }
        : mainImageChoice,
    };
    void execute({ action: 'add-product-version',
      path: `/api/staff/catalog/products/${encodeURIComponent(product.product_id)}/versions`, body });
  }
  return <Card className="product-version-form"><h2>新增版本</h2>
    <Alert tone="warning">修改下单节奏会新增版本，只影响未来发布的需求，已发布需求不会静默继承。</Alert>
    <form onSubmit={submit} onChange={() => {
      if (busy) return;
      authority.release(); setMessage(null); setRequestId(null);
    }}>
      <fieldset disabled={busy}>
        <FormField label="产品名称" htmlFor="version-product-name"><TextInput id="version-product-name"
        name="product_name" required maxLength={200} defaultValue={current.product_name} /></FormField>
        <FormField label="搜索关键词（每行一个）" htmlFor="version-keywords"><textarea id="version-keywords"
        name="search_keywords" required defaultValue={current.search_keywords.join('\n')} /></FormField>
        <div className="schedule-form-grid">
          <FormField label="间隔（天）" htmlFor="version-interval"><TextInput id="version-interval"
          name="interval" type="number" min={1} max={36500} required
          defaultValue={current.cadence?.order_interval_days ?? 1} /></FormField>
          <FormField label="每次下单数" htmlFor="version-per-run"><TextInput id="version-per-run"
          name="per_run" type="number" min={1} max={100000} required
          defaultValue={current.cadence?.orders_per_run ?? 1} /></FormField>
          <FormField label="参考金额（JPY）" htmlFor="version-amount"><TextInput id="version-amount"
          name="amount" type="number" min={0} required
          defaultValue={current.ordering_guide_expected_amount_jpy} /></FormField>
          <FormField label="买家自费比例（bps）" htmlFor="version-self-pay"><TextInput id="version-self-pay"
          name="self_pay_bps" type="number" min={0} max={10000} required
          defaultValue={current.default_buyer_self_pay_bps} /></FormField>
        </div>
        <FormField label="颜色规格" htmlFor="version-color"><Select id="version-color" name="color_mode"
        defaultValue={current.color_spec_mode}><option value="MAIN_IMAGE_VARIANT">按主图规格</option>
        <option value="ANY_VARIANT">任意规格</option></Select></FormField>
        <FormField label="产品链接" htmlFor="version-url"><TextInput id="version-url" name="product_url"
        type="url" defaultValue={current.product_url ?? ''} /></FormField>
        <FormField label="买家说明" htmlFor="version-buyer-notes"><textarea id="version-buyer-notes"
        name="buyer_notes" defaultValue={current.buyer_visible_notes ?? ''} /></FormField>
        <FormField label="内部说明" htmlFor="version-internal-notes"><textarea id="version-internal-notes"
        name="internal_notes" defaultValue={current.internal_notes ?? ''} /></FormField>
        <fieldset className="form-fieldset version-main-image-choice">
          <legend>新版本主图</legend>
          {current.main_image ? <label className="version-main-image-option">
            <input type="radio" name="version_main_image" value="INHERIT"
              checked={mainImageChoice === 'INHERIT'}
              onChange={() => setMainImageChoice('INHERIT')} />
            继承上一版主图（推荐，保存后立即生效）
          </label> : null}
          <label className="version-main-image-option">
            <input type="radio" name="version_main_image" value="UPLOAD"
              checked={mainImageChoice === 'UPLOAD'}
              onChange={() => setMainImageChoice('UPLOAD')} />
            上传新主图，作为本版本主图
          </label>
          <label className="version-main-image-option">
            <input type="radio" name="version_main_image" value="NONE"
              checked={mainImageChoice === 'NONE'}
              onChange={() => setMainImageChoice('NONE')} />
            暂不设置（稍后在产品详情手动上传绑定）
          </label>
          {mainImageChoice === 'UPLOAD' ? <>
            <FileDropZone
              id="version-new-main-image"
              aria-label="新版本主图"
              accept="image/jpeg,image/png,image/webp"
              maximumFiles={1}
              maximumBytes={10 * 1024 * 1024}
              buttonLabel="选择新主图"
              emptyLabel="尚未选择主图"
              onFilesChange={(files) => {
                const file = files[0];
                if (file) void uploader.start('staffProductImage', [file]);
              }}
            />
            <p className="staff-upload-state">上传状态：{upload.state}</p>
          </> : null}
        </fieldset>
        <CadenceExamples />
      </fieldset>
      {message ? <Alert tone={message.startsWith('新产品') ? 'success' : 'danger'}>{message}</Alert> : null}
      <RequestIdDisplay requestId={requestId} />
      {authority.canRetry() ? <Button type="button" className="secondary"
        disabled={busy} onClick={() => { void execute(null); }}>重试</Button> : null}
      <Button type="submit" loading={busy} loadingLabel="保存中…">保存为新版本</Button>
    </form>
  </Card>;
}

function ReservationScheduleDetail({ demandId }: { demandId: string }): React.JSX.Element {
  const session = useCurrentStaffSession();
  const client = useQueryClient();
  const [cursor, setCursor] = useState<string|null>(null);
  const [cursorHistory, setCursorHistory] = useState<(string|null)[]>([]);
  const authorized = session.permissions.includes('PRODUCT_VIEW');
  const canEdit = (session.role.code === 'owner' || session.role.code === 'seller_ops')
    && session.permissions.includes('PRODUCT_REVIEW')
    && session.permissions.includes('DEMAND_PUBLISH');
  const query = useQuery({
    queryKey: staffWorkbenchKeys.reservationSchedule(
      session.authorization_version, demandId, cursor,
    ),
    queryFn: ({ signal }) => staffApi.reservationSchedule(client, demandId, cursor, signal)
      .then((response) => response.data.page),
    enabled: authorized,
    retry: false,
  });
  useEffect(() => () => {
    client.removeQueries({ queryKey: ['staff', 'products', session.authorization_version,
      'reservation-schedule', demandId] });
  }, [client, demandId, session.authorization_version]);
  if (!authorized) return <PermissionMessage />;
  if (query.isPending) return <main className="product-scheduling-workspace"><p role="status">正在加载预约排期</p></main>;
  if (query.isError) return <main className="product-scheduling-workspace"><QueryError error={query.error}
    retry={() => { void query.refetch(); }} /></main>;
  const page = query.data;
  return <main className="product-scheduling-workspace">
    <nav className="breadcrumb" aria-label="面包屑"><Link to="/staff/products">产品库</Link><span>/</span>
      <Link to={`/staff/products/${encodeURIComponent(page.demand.product_id)}`}>{page.demand.product_name}</Link>
      <span>/</span><span aria-current="page">预约排期</span></nav>
    <section className="reservation-summary">
      <Card><p className="eyebrow">有效队列</p><strong>{page.demand.effective_reservation_count}</strong>
        <span> / {page.demand.target_quantity} 个理论名额</span></Card>
      <Card><p className="eyebrow">当前排期</p><strong>{page.demand.schedule
        ? cadenceLabel(page.demand.schedule) : '尚未配置排期'}</strong>
        <span>{page.demand.schedule?.first_order_date ?? '需要卖家对接人工补齐'}</span></Card>
      <Card><p className="eyebrow">需求状态</p>
        <StatusBadge tone={page.demand.status === 'PUBLISHED' ? 'success' : 'neutral'}>
          {demandStatus(page.demand.status)}
        </StatusBadge></Card>
    </section>
    {page.demand.status === 'PUBLISHED' && page.demand.can_close
      ? <DemandCloseForm demandId={demandId} page={page} /> : null}
    {canEdit ? <ScheduleChangeForm demandId={demandId} page={page} /> : null}
    <Card><DataTable caption="预约排名与预计下单日期"><thead><tr>
      <th scope="col">排名</th><th scope="col">买家标识</th><th scope="col">预约时间</th>
      <th scope="col">状态</th><th scope="col">预计日期</th><th scope="col">实际订单</th>
      <th scope="col">操作</th>
    </tr></thead><tbody>{page.items.map((item) => <tr key={item.reservation_id}>
      <td>{item.rank ?? '—'}</td><th scope="row">{item.buyer_reference}
        {item.buyer_display_name ? <small>{item.buyer_display_name}</small> : null}</th>
      <td>{formatShanghai(item.submitted_at)}</td>
      <td>{reservationStatus(item.status)}
        {item.status === 'APPROVED' && item.decision_source === 'AUTO'
          ? <span className="auto-approved-badge">自动通过</span>
          : null}</td>
      <td>{item.planned_order_date ?? '—'}</td><td>{item.actual_order_status
        ? `${item.actual_order_status}${item.actual_order_date ? ` · ${item.actual_order_date}` : ''}` : '尚无'}</td>
      <td>{item.status === 'APPROVED' && item.decision_source === 'AUTO'
        ? <ReopenReservationForm item={item} />
        : null}</td>
    </tr>)}</tbody></DataTable></Card>
    <nav className="pagination-actions" aria-label="预约分页"><Button className="secondary"
      disabled={cursorHistory.length === 0} onClick={() => {
        setCursor(cursorHistory.at(-1) ?? null); setCursorHistory((all) => all.slice(0, -1));
      }}>上一页</Button><Button className="secondary" disabled={!page.next_cursor} onClick={() => {
        setCursorHistory((all) => [...all, cursor]); setCursor(page.next_cursor);
      }}>下一页</Button></nav>
  </main>;
}

function DemandCloseForm({ demandId, page }: {
  demandId: string; page: StaffReservationSchedulePage;
}): React.JSX.Element {
  const session = useCurrentStaffSession();
  const client = useQueryClient();
  const authority = useMemo(() => new StaffMutationAuthority<
    Awaited<ReturnType<typeof staffApi.closeDemand>>
  >(), []);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string|null>(null);
  const [requestId, setRequestId] = useState<string|null>(null);

  async function execute(request: StaffMutationRequest | null): Promise<void> {
    setBusy(true); setMessage(null); setRequestId(null);
    try {
      const response = request === null
        ? await authority.retry()
        : await authority.execute(request, ({ body }, key) =>
            staffApi.closeDemand(client, demandId, body, key));
      setRequestId(response.requestId);
      setMessage(response.data.demand_close.replayed
        ? '需求已关闭，已复用首次请求结果。'
        : '需求已关闭。');
      await Promise.all([
        client.invalidateQueries({
          queryKey: ['staff', 'products', session.authorization_version,
            'reservation-schedule', demandId],
        }),
        client.invalidateQueries({ queryKey: staffWorkbenchKeys.productsRoot }),
        client.invalidateQueries({ queryKey: staffWorkbenchKeys.queueRoot }),
      ]);
    } catch (error) {
      setRequestId(isFrontendApiError(error) ? error.requestId : null);
      setMessage(errorMessage(error));
    } finally { setBusy(false); }
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (authority.canRetry()) {
      void execute(null);
      return;
    }
    const data = new FormData(event.currentTarget);
    const reason = String(data.get('close_reason') ?? '').trim();
    if (!reason) {
      setMessage('请填写关闭原因。');
      return;
    }
    void execute({
      action: 'close-demand-batch',
      path: `/api/staff/demand-batches/${encodeURIComponent(demandId)}/close`,
      body: {
        expected_version: page.demand.demand_version,
        close_reason: reason,
      },
    });
  }

  return <Card className="demand-close-form">
    <h2>关闭需求</h2>
    {!open ? <>
      <p>需求当前为已发布状态；关闭后将不再出现在买家公开需求列表。</p>
      <Button type="button" onClick={() => setOpen(true)}>关闭需求</Button>
    </> : <form onSubmit={submit} onChange={() => {
      if (busy) return;
      authority.release(); setMessage(null); setRequestId(null);
    }}>
      <fieldset disabled={busy}>
        <p>当前需求版本：v{page.demand.demand_version}</p>
        <FormField label="关闭确认" htmlFor="demand-close-confirm">
          <Checkbox
            name="confirm_close"
            label="我确认关闭该已发布需求"
            required
          />
        </FormField>
        <FormField label="关闭原因" htmlFor="demand-close-reason">
          <textarea name="close_reason" required maxLength={1000}
            placeholder="请输入关闭原因，便于后续审计追溯" />
        </FormField>
      </fieldset>
      <Button type="submit" disabled={busy} loading={busy} loadingLabel="关闭中…">
        确认关闭需求
      </Button>
      <Button type="button" className="secondary" disabled={busy} onClick={() => {
        authority.release(); setOpen(false); setMessage(null); setRequestId(null);
      }}>取消</Button>
    </form>}
    {message ? <Alert tone={message.startsWith('需求已关闭') ? 'success' : 'danger'}>{message}</Alert> : null}
    <RequestIdDisplay requestId={requestId} />
    {authority.canRetry() ? <Button type="button" className="secondary" disabled={busy}
      onClick={() => { void execute(null); }}>重试原请求</Button> : null}
  </Card>;
}

function ReopenReservationForm({ item }: {
  item: StaffReservationSchedulePage['items'][number];
}): React.JSX.Element {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function reopen(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '');
    setBusy(true); setMessage(null);
    try {
      await staffApi.reopenReservation(client, item.reservation_id, {
        expected_version: item.version,
        reason,
      });
      setMessage('已重开为待人工审核，请到工作台任务队列处理。');
      await client.invalidateQueries({ queryKey: staffWorkbenchKeys.productsRoot });
    } catch (error) {
      setMessage(errorMessage(error));
    } finally { setBusy(false); }
  }
  return <div className="reopen-reservation">
    {open ? <form onSubmit={reopen}>
      <TextInput
        id={`reopen-reason-${item.reservation_id}`}
        name="reason"
        placeholder="重开原因（买家可见流程留痕）"
        required
        maxLength={500}
      />
      <Button type="submit" className="secondary" disabled={busy} loading={busy}>
        确认重开
      </Button>
      <Button type="button" className="secondary" disabled={busy} onClick={() => setOpen(false)}>
        取消
      </Button>
    </form> : <Button className="secondary" onClick={() => setOpen(true)}>
      重开人工复核
    </Button>}
    {message ? <p className="hint">{message}</p> : null}
  </div>;
}

function ScheduleChangeForm({ demandId, page }: {
  demandId: string; page: StaffReservationSchedulePage;
}): React.JSX.Element {
  const client = useQueryClient();
  const authority = useMemo(() => new StaffMutationAuthority<
    Awaited<ReturnType<typeof staffApi.confirmDemandSchedule>>
  >(), []);
  const [preview, setPreview] = useState<DemandSchedulePreview|null>(null);
  const [proposal, setProposal] = useState<Record<string, unknown>|null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string|null>(null);
  const [requestId, setRequestId] = useState<string|null>(null);
  async function submitPreview(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); authority.release(); setBusy(true); setMessage(null);
    setPreview(null); setProposal(null);
    const data = new FormData(event.currentTarget);
    const body = {
      expected_version: page.demand.demand_version,
      first_order_date: String(data.get('first_order_date') ?? ''),
      order_interval_days: Number(data.get('interval')),
      orders_per_run: Number(data.get('per_run')),
      reason: String(data.get('reason') ?? ''),
    };
    try {
      const response = await staffApi.previewDemandSchedule(client, demandId, body);
      setPreview(response.data.preview); setProposal(body); setRequestId(response.requestId);
    } catch (error) {
      setRequestId(isFrontendApiError(error) ? error.requestId : null);
      setMessage(errorMessage(error));
    } finally { setBusy(false); }
  }
  async function confirm(): Promise<void> {
    const retryOriginal = authority.canRetry();
    if (!retryOriginal && (!preview || !proposal)) return;
    setBusy(true); setMessage(null);
    try {
      const response = retryOriginal
        ? await authority.retry()
        : await authority.execute({ action: 'confirm-demand-schedule',
          path: `/api/staff/demand-batches/${encodeURIComponent(demandId)}/schedule/confirm`,
          body: { ...proposal!, preview_hash: preview!.preview_hash } },
        ({ body }, key) => staffApi.confirmDemandSchedule(client, demandId, body, key));
      setRequestId(response.requestId); setMessage('排期新版本已确认，历史版本保持不变。');
      setPreview(null); setProposal(null);
      await client.invalidateQueries({ queryKey: staffWorkbenchKeys.productsRoot });
    } catch (error) {
      setRequestId(isFrontendApiError(error) ? error.requestId : null);
      setMessage(errorMessage(error));
      if (isFrontendApiError(error)
        && (error.code === 'VERSION_CONFLICT'
          || error.code === 'SCHEDULE_PREVIEW_STALE')) {
        setPreview(null); setProposal(null);
      }
    } finally { setBusy(false); }
  }
  const schedule = page.demand.schedule;
  return <Card className="schedule-change-form"><h2>{schedule ? '调整需求排期' : '补齐需求排期'}</h2>
    <p>先由服务端预览受影响人数和前后日期，再明确确认。预计日期不会创建或覆盖订单资料。</p>
    <form onSubmit={(event) => { void submitPreview(event); }} onChange={() => {
      if (busy) return;
      authority.release(); setPreview(null); setProposal(null); setMessage(null); setRequestId(null);
    }}>
      <fieldset disabled={busy}>
        <div className="schedule-form-grid">
          <FormField label="首个下单日期" htmlFor="schedule-first-date"><TextInput id="schedule-first-date"
          name="first_order_date" type="date" required
          defaultValue={schedule?.first_order_date ?? beijingToday()} /></FormField>
          <FormField label="每隔 N 个自然日" htmlFor="schedule-interval"><TextInput id="schedule-interval"
          name="interval" type="number" min={1} max={36500} required
          defaultValue={schedule?.order_interval_days ?? 1} /></FormField>
          <FormField label="每次 M 单" htmlFor="schedule-per-run"><TextInput id="schedule-per-run"
          name="per_run" type="number" min={1} max={100000} required
          defaultValue={schedule?.orders_per_run ?? 1} /></FormField>
        </div>
        <FormField label="修改原因" htmlFor="schedule-reason"><textarea id="schedule-reason"
        name="reason" required maxLength={1000} /></FormField>
        <CadenceExamples />
        <Button type="submit" loading={busy} loadingLabel="正在预览">服务端预览影响</Button>
      </fieldset>
    </form>
    {preview ? <Alert tone="warning"><h3>请确认影响</h3>
      <p>有效预约 {preview.effective_reservation_count} 人，其中 {preview.affected_reservation_count} 人的预计日期会变化。</p>
      <p>首单：{preview.before_first_order_date ?? '尚未配置'} → {preview.first_order_date}</p>
      <p>最后理论名额：{preview.before_theoretical_last_order_date ?? '尚未配置'} → {preview.theoretical_last_order_date}</p>
      <p>现有下单截止：{preview.order_deadline_date}（北京时间）</p>
      <Button disabled={busy} onClick={() => { void confirm(); }}>确认新增排期版本</Button>
    </Alert> : null}
    {message ? <Alert tone={message.startsWith('排期新版本') ? 'success' : 'danger'}>{message}</Alert> : null}
    <RequestIdDisplay requestId={requestId} />
    {authority.canRetry() ? <Button type="button" className="secondary"
      disabled={busy} onClick={() => { void confirm(); }}>重试原请求</Button> : null}
  </Card>;
}

function CadenceExamples(): React.JSX.Element {
  return <p className="cadence-examples">示例：每隔 1 天、每次 1 单＝每天一单；每隔 1 天、每次 2 单＝每天两单；每隔 2 天、每次 1 单＝每两天一单。</p>;
}

function PermissionMessage(): React.JSX.Element {
  return <main className="product-scheduling-workspace"><EmptyState title="当前角色无权查看产品排期"
    description="后端会按实时权限、个人禁用和 Buyer/Seller 数据范围重新校验。" /></main>;
}

function QueryError({ error, retry }: { error: unknown; retry: () => void }): React.JSX.Element {
  return <Alert tone="danger"><p>{errorMessage(error)}</p>
    <RequestIdDisplay requestId={isFrontendApiError(error) ? error.requestId : null} />
    <Button className="secondary" onClick={retry}>重试</Button></Alert>;
}

function errorMessage(error: unknown): string {
  if (!isFrontendApiError(error)) return '服务暂时不可用，请稍后重试。';
  if (error.code === 'VERSION_CONFLICT') return '数据已变化，请刷新后重新预览。';
  if (error.code === 'SCHEDULE_PREVIEW_STALE') return '预约队列或排期已变化，请重新预览。';
  if (error.code === 'SCHEDULE_WINDOW_CONFLICT') return '最后一个理论名额晚于下单截止日，请调整日期或节奏。';
  if (error.code === 'FORBIDDEN') return '当前身份没有该操作权限。';
  if (error.code === 'NOT_FOUND') return '资源不存在，或已不在您的有效数据范围内。';
  if (error.code === 'DEMAND_BATCH_NOT_PUBLISHED') return '需求状态已变化，请刷新后重试。';
  if (error.code === 'IDEMPOTENCY_CONFLICT') return '原请求标识已对应其他内容，请刷新后重新发起。';
  if (error.code === 'REQUEST_IN_PROGRESS') return '原请求仍在处理中，请稍后重试原请求。';
  return '操作未完成，请核对输入后重试。';
}

function cadenceLabel(value: { order_interval_days: number; orders_per_run: number }|null): string {
  return value ? `每隔 ${value.order_interval_days} 个自然日，每次 ${value.orders_per_run} 单`
    : '尚未配置排期';
}

function reservationStatus(value: string): string {
  return ({ PENDING_REVIEW: '待审核', APPROVED: '已批准', REJECTED: '已拒绝',
    CANCELLED: '已取消', EXPIRED: '已过期' } as Record<string, string>)[value] ?? value;
}

function demandStatus(value: string): string {
  return ({ SUBMITTED: '待发布', PUBLISHED: '已发布', REJECTED: '已拒绝',
    WITHDRAWN: '已撤回', CLOSED: '已关闭' } as Record<string, string>)[value] ?? value;
}

function emptyToNull(value: FormDataEntryValue|null): string|null {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function beijingToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value['year']}-${value['month']}-${value['day']}`;
}

/**
 * Stage 7.5 batch 2: product primary contact. One responsible member per
 * product; setting/clearing goes through the existing
 * POST /api/staff/products/:id/primary-contact (idempotency key, expected
 * version, reason; the server enforces same-organization ACTIVE members).
 */
function PrimaryContactCard({
  product,
}: {
  product: {
    product_id: string;
    aggregate_version: number;
    primary_contact_member_id?: string | null | undefined;
    primary_contact_member_name?: string | null | undefined;
  };
}): React.JSX.Element {
  const session = useCurrentStaffSession();
  const client = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const canManage = (session.role.code === 'owner' || session.role.code === 'seller_ops')
    && session.permissions.includes('SELLER_MANAGE');
  const mutationSchema = z.object({
    product: z.object({
      product_id: z.string(),
      primary_contact_member_id: z.string().nullable(),
      primary_contact_member_name: z.string().nullable(),
      version: z.number().int().positive(),
    }).strict(),
    replayed: z.boolean(),
  }).strict();
  const setContact = useMutation({
    mutationFn: (request: { body: unknown; key: string }) =>
      identityApiRequest('staff', client, {
        path: `/api/staff/products/${encodeURIComponent(product.product_id)}/primary-contact`,
        method: 'POST',
        schema: mutationSchema,
        body: request.body,
        headers: operationHeaders({ key: request.key, body: request.body }),
      }),
    onSuccess: (response) => {
      setMessage(response.data.replayed ? '重复请求：联系人保持不变。' : '产品主要对接人已更新。');
      void client.invalidateQueries({
        queryKey: staffWorkbenchKeys.product(session.authorization_version, product.product_id),
      });
    },
    onError: (error) => {
      setMessage(
        `更新未完成${isFrontendApiError(error) ? `（${error.code}）` : ''}：请确认成员属于本卖家组织且为有效成员。`,
      );
    },
  });
  return (
    <Card>
      <p className="eyebrow">业务对接人</p>
      <h2>产品主要对接人</h2>
      <p>
        {product.primary_contact_member_name
          ? `${product.primary_contact_member_name}（成员 ID ${product.primary_contact_member_id}）`
          : '未设置；本组织全部有效成员仍可查看本产品。'}
      </p>
      {canManage ? (
        <form
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const raw = String(data.get('member_id') ?? '').trim();
            setContact.mutate({
              body: {
                primary_contact_member_id: raw === '' ? null : raw,
                expected_version: product.aggregate_version,
                reason: String(data.get('reason') ?? ''),
              },
              key: crypto.randomUUID(),
            });
          }}
        >
          <FormField label="成员 ID（留空即清除）" htmlFor="primary-contact-member">
            <input id="primary-contact-member" name="member_id" defaultValue={product.primary_contact_member_id ?? ''} />
          </FormField>
          <FormField label="变更原因" htmlFor="primary-contact-reason">
            <input id="primary-contact-reason" name="reason" minLength={3} required />
          </FormField>
          <Button type="submit" loading={setContact.isPending}>
            {product.primary_contact_member_id ? '转移 / 清除主要对接人' : '设置主要对接人'}
          </Button>
        </form>
      ) : null}
      {message ? (
        <Alert tone={setContact.isSuccess ? 'success' : 'info'}>{message}</Alert>
      ) : null}
    </Card>
  );
}
