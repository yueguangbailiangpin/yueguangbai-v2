import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Alert, Button, Card, FormField, PageHeader, RequestIdDisplay, Select, TextInput } from '../../ui/primitives';
import { useFileUpload } from '../../buyer/shared/useFileUpload';
import { BuyerMutationRecovery } from '../../buyer/shared/BuyerMutationRecovery';
import { useBuyerMutation } from '../../buyer/mutations/useBuyerMutation';
import { sellerApi } from '../api/client';
import { sellerQueryKeys } from '../queries/keys';
import { useSellerStoreContext } from '../routes/SellerLayout';

export function SellerProductApplicationFormPage(): React.JSX.Element {
  const client = useQueryClient(); const navigate = useNavigate(); const { storeId } = useSellerStoreContext();
  const [uploader, upload] = useFileUpload(); const files = useRef<File[]>([]); const uploadedSelection = useRef<readonly File[] | null>(null); const [message, setMessage] = useState<string | null>(null);
  const me = useQuery({ queryKey: sellerQueryKeys.me, queryFn: ({ signal }) => sellerApi.me(client, signal).then((r) => r.data.me) });
  const stores = useQuery({ queryKey: sellerQueryKeys.stores, queryFn: ({ signal }) => sellerApi.stores(client, signal).then((r) => r.data.items) });
  const mutation = useBuyerMutation({
    operation: (body: unknown, key, signal) => sellerApi.submitApplication(client, body, key, signal),
    onSuccess: async (result) => { await client.invalidateQueries({ queryKey: sellerQueryKeys.applications(storeId) }); navigate(`/seller/products/${result.data.application.id}`, { replace: true }); },
    onError: () => setMessage('提交未完成，请刷新页面事实后重试。'),
  });
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); setMessage(null);
    if (!me.data?.access.can_submit_product_applications) { setMessage('当前账号无权提交产品申请。'); return; }
    const data = new FormData(event.currentTarget); const asin = String(data.get('asin') ?? '').trim().toUpperCase();
    const keywords = String(data.get('keywords') ?? '').split(/[，,]/u).map((v) => v.trim()).filter(Boolean);
    const selectedStore = String(data.get('store_id') ?? '');
    if (!selectedStore || !/^[A-Z0-9]{10}$/u.test(asin) || !String(data.get('product_name') ?? '').trim() || files.current.length < 1 || files.current.length > 8) {
      setMessage('请填写店铺、10 位产品标识、中文名，且选择 1 至 8 张图片。'); return;
    }
    const selectedFiles = files.current; let snapshot = uploader.getSnapshot();
    if (snapshot.state !== 'VERIFIED' || uploadedSelection.current !== selectedFiles) {
      uploadedSelection.current = selectedFiles;
      await uploader.start('sellerProductApplicationImage', selectedFiles);
      snapshot = uploader.getSnapshot();
    }
    const manifest = snapshot.manifest;
    if (snapshot.state !== 'VERIFIED' || !manifest || manifest.files.length !== selectedFiles.length) { setMessage('图片上传未完成，请按提示恢复后继续。'); return; }
    mutation.mutate({ store_id: selectedStore, asin, product_name: String(data.get('product_name') ?? '').trim(), search_keywords: keywords,
      product_url: String(data.get('product_url') ?? '').trim() || null, buyer_visible_notes: String(data.get('buyer_visible_notes') ?? '').trim() || null,
      seller_notes: String(data.get('seller_notes') ?? '').trim() || null,
      image_files: manifest.files.map((file) => ({ file_object_id: file.file_object_id, expected_file_version: file.file_version })), });
  }
  const uploadBusy = ['VALIDATING', 'CREATING_INTENT', 'INTENT_READY', 'UPLOADING', 'COMPLETING'].includes(upload.state);
  return <section className="seller-page seller-submission-page"><PageHeader title="提交产品申请" eyebrow="商品资料" description="提交后进入审核；图片仅用于本次申请。" />
    <Card className="seller-form-card">{me.isPending || stores.isPending ? <p role="status">正在核验可提交范围</p> : me.isError || stores.isError ? <><Alert tone="danger">暂时无法读取店铺和权限，请刷新后重试。</Alert><Button className="secondary" onClick={() => { void Promise.all([me.refetch(), stores.refetch()]); }}>重新读取</Button></> : !me.data?.access.can_submit_product_applications ? <Alert tone="warning">当前账号无权提交产品申请。</Alert> : <form className="seller-form" onSubmit={(event) => { void submit(event); }}>
      <FormField label="店铺" htmlFor="application-store" required><Select name="store_id" defaultValue={storeId ?? ''} required><option value="">请选择店铺</option>{stores.data?.map((store) => <option key={store.id} value={store.id} disabled={store.status !== 'ACTIVE' || store.marketplace_status !== 'ACTIVE' || store.adapter_status !== 'AVAILABLE'}>{store.display_name}</option>)}</Select></FormField>
      <FormField label="产品标识" htmlFor="application-asin" description="请填写平台页面中的 10 位产品标识" required><TextInput name="asin" maxLength={10} required /></FormField>
      <FormField label="中文名" htmlFor="application-name" required><TextInput name="product_name" maxLength={200} required /></FormField>
      <FormField label="搜索词" htmlFor="application-keywords" description="多个搜索词用逗号分隔"><TextInput name="keywords" maxLength={1000} /></FormField>
      <FormField label="产品链接" htmlFor="application-url"><TextInput name="product_url" type="url" /></FormField>
      <FormField label="申请图片" htmlFor="application-images" description="1 至 8 张 JPG、PNG 或 WebP 图片，每张不超过 10 MiB" required><TextInput name="images" type="file" accept="image/jpeg,image/png,image/webp" multiple required onChange={(event) => { files.current = Array.from(event.currentTarget.files ?? []); uploadedSelection.current = null; setMessage(null); }} /></FormField>
      <FormField label="买家说明" htmlFor="application-buyer-notes"><TextInput name="buyer_visible_notes" maxLength={2000} /></FormField>
      <FormField label="备注" htmlFor="application-seller-notes"><TextInput name="seller_notes" maxLength={2000} /></FormField>
      {message ? <Alert tone="danger">{message}</Alert> : null}
      {upload.canRetry ? <Button type="button" className="secondary" onClick={() => { void uploader.retry(); }}>继续上传</Button> : null}
      {upload.restartRequired ? <Button type="button" className="secondary" onClick={() => { void uploader.restart(); }}>重新开始上传</Button> : null}
      {upload.requiresFileReselection ? <Alert tone="warning">请重新选择申请图片。</Alert> : null}
      {upload.state === 'FILE_COMPENSATION_REQUIRED' ? <Alert tone="danger">图片清理尚未完成，请联系工作人员并提供请求编号。</Alert> : null}
      <RequestIdDisplay requestId={upload.requestId} />
      <BuyerMutationRecovery mutation={mutation} onRefresh={() => { void Promise.all([me.refetch(), stores.refetch()]); }} />
      <Button className="seller-form-submit" type="submit" loading={mutation.isPending || uploadBusy} loadingLabel={mutation.isPending ? '正在提交' : '正在上传图片'}>提交申请</Button>
    </form>}</Card>
  </section>;
}

export function SellerDemandFormPage(): React.JSX.Element {
  const client = useQueryClient(); const navigate = useNavigate(); const { storeId } = useSellerStoreContext(); const [message, setMessage] = useState<string | null>(null);
  const me = useQuery({ queryKey: sellerQueryKeys.me, queryFn: ({ signal }) => sellerApi.me(client, signal).then((r) => r.data.me) });
  const products = useQuery({ queryKey: sellerQueryKeys.products(storeId), queryFn: ({ signal }) => sellerApi.products(client, storeId, signal).then((r) => r.data.items) });
  const mutation = useBuyerMutation({ operation: (body: unknown, key, signal) => sellerApi.submitDemand(client, body, key, signal), onSuccess: async () => { await client.invalidateQueries({ queryKey: sellerQueryKeys.demands(storeId) }); navigate('/seller/demands', { replace: true }); }, onError: () => setMessage('提交未完成，请刷新页面事实后重试。') });
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault(); setMessage(null); const data = new FormData(event.currentTarget);
    const openAt = beijingEpoch(String(data.get('open_at') ?? '')); const reservation = beijingEpoch(String(data.get('reservation_deadline') ?? '')); const order = beijingEpoch(String(data.get('order_deadline') ?? '')); const quantity = Number(data.get('target_quantity'));
    if (!me.data?.access.can_submit_demand_batches || !String(data.get('product_id') ?? '') || !Number.isSafeInteger(quantity) || quantity < 1 || openAt === null || reservation === null || order === null || !(openAt < reservation && reservation < order)) { setMessage('请填写通过的产品、正整数数量以及依次递增的北京时间。'); return; }
    mutation.mutate({ product_id: String(data.get('product_id')), task_type: String(data.get('task_type')), target_quantity: quantity, open_at: openAt, reservation_deadline: reservation, order_deadline: order, buyer_visible_notes: String(data.get('buyer_visible_notes') ?? '').trim() || null, seller_notes: String(data.get('seller_notes') ?? '').trim() || null });
  }
  return <section className="seller-page seller-submission-page"><PageHeader title="提交需求" eyebrow="数量计划" description="每次追加数量都会新建需求批次，不修改历史记录。" /><Card className="seller-form-card">{me.isPending || products.isPending ? <p role="status">正在核验可提交产品</p> : me.isError || products.isError ? <><Alert tone="danger">暂时无法读取产品和权限，请刷新后重试。</Alert><Button className="secondary" onClick={() => { void Promise.all([me.refetch(), products.refetch()]); }}>重新读取</Button></> : !me.data?.access.can_submit_demand_batches ? <Alert tone="warning">当前账号无权提交需求。</Alert> : <form className="seller-form" onSubmit={submit}>
    <FormField label="已通过产品" htmlFor="demand-product" required><Select name="product_id" required defaultValue=""><option value="">请选择产品</option>{products.data?.filter((product) => product.status === 'ACTIVE').map((product) => <option key={product.id} value={product.id}>{product.store.display_name} · {product.current_version.product_name}</option>)}</Select></FormField>
    <FormField label="任务类型" htmlFor="demand-type" required><Select name="task_type" defaultValue="TEXT"><option value="TEXT">文字评价</option><option value="RATING">评分评价</option><option value="IMAGE">图文评价</option><option value="VIDEO">视频评价</option></Select></FormField>
    <FormField label="目标数量" htmlFor="demand-quantity" required><TextInput name="target_quantity" type="number" min="1" step="1" required /></FormField>
    <FormField label="开放时间（北京时间）" htmlFor="demand-open" required><TextInput name="open_at" type="datetime-local" required /></FormField>
    <FormField label="预约截止时间（北京时间）" htmlFor="demand-reservation" required><TextInput name="reservation_deadline" type="datetime-local" required /></FormField>
    <FormField label="下单截止时间（北京时间）" htmlFor="demand-order" required><TextInput name="order_deadline" type="datetime-local" required /></FormField>
    <FormField label="买家说明" htmlFor="demand-buyer-notes"><TextInput name="buyer_visible_notes" maxLength={2000} /></FormField><FormField label="备注" htmlFor="demand-seller-notes"><TextInput name="seller_notes" maxLength={2000} /></FormField>
    {message ? <Alert tone="danger">{message}</Alert> : null}<BuyerMutationRecovery mutation={mutation} onRefresh={() => { void Promise.all([me.refetch(), products.refetch()]); }} /><Button className="seller-form-submit" type="submit" loading={mutation.isPending}>提交需求</Button>
  </form>}</Card></section>;
}

function beijingEpoch(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(value)) return null;
  const epoch = Date.parse(`${value}:00+08:00`);
  return Number.isSafeInteger(epoch) && epoch >= 0 ? epoch : null;
}
