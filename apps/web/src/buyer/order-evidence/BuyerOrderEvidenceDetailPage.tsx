import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { BuyerOrderEvidenceFileReadIntentAdapter } from '../../files/file-read-providers';
import { Alert, Button, Card, Dialog, FormField, PageHeader, StatusBadge, TextInput } from '../../ui/primitives';
import { useParams } from 'react-router';
import { buyerApi } from '../api/client';
import { dateOnlySchema, type OrderEvidence } from '../contracts/runtime';
import { useBuyerMutation } from '../mutations/useBuyerMutation';
import { buyerQueryKeys } from '../queries/keys';
import { formatBps, formatDateOnly, formatJpy, formatShanghai, formatSignedJpyDifference, priceDifferenceDirection } from '../shared/format';
import { BuyerLoading, BuyerQueryError } from '../shared/BuyerStates';
import { BuyerMutationRecovery } from '../shared/BuyerMutationRecovery';
import { ProtectedFileButton } from '../shared/ProtectedFileButton';
import { statusLabel, statusTone } from '../shared/status';
import { useFileUpload } from '../shared/useFileUpload';

export function BuyerOrderEvidenceDetailPage(): React.JSX.Element {
  const { submissionId = '' } = useParams();
  const client = useQueryClient();
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const query = useQuery({
    queryKey: buyerQueryKeys.evidence(submissionId),
    queryFn: ({ signal }) => buyerApi.evidence(client, submissionId, signal).then((r) => r.data.order_evidence),
    enabled: submissionId.length > 0,
  });
  const withdraw = useBuyerMutation({
    operation: (body: { expected_version: number }, key, signal) => buyerApi.withdrawEvidence(client, submissionId, body.expected_version, key, signal),
    onSuccess: async (result) => {
      client.setQueryData(buyerQueryKeys.evidence(submissionId), result.data.order_evidence);
      await client.invalidateQueries({ queryKey: buyerQueryKeys.evidenceListRoot });
      setConfirmWithdraw(false);
    },
    onError: async () => {},
  });
  if (query.isPending) return <BuyerLoading />;
  if (query.isError) return <BuyerQueryError error={query.error} />;
  const item = query.data;
  return <section className="buyer-page"><PageHeader eyebrow="订单资料详情" title={item.reservation.product_name}>
    <StatusBadge tone={statusTone(item.status)}>{statusLabel(item.status)}</StatusBadge></PageHeader>
    {item.price_mismatch ? <Alert tone="warning">实际支付金额与参考金额不一致</Alert> : null}
    {item.status === 'CHANGES_REQUESTED' && item.public_change_reason
      ? <Alert tone="warning">修改说明：{item.public_change_reason}</Alert> : null}
    <Card><dl className="buyer-facts"><div><dt>Amazon 订单号</dt><dd className="copyable-fact">{item.amazon_order_number_display}
      <Button className="secondary compact-button" onClick={() => { void navigator.clipboard.writeText(item.amazon_order_number_display); }}>复制</Button></dd></div>
      <div><dt>Amazon 下单日期</dt><dd>{formatDateOnly(item.amazon_order_date)}</dd></div>
      <div><dt>最终支付</dt><dd>{formatJpy(item.final_paid_jpy)}</dd></div>
      <div><dt>金额差异</dt><dd>{formatSignedJpyDifference(item.price_difference_jpy)}（{priceDifferenceDirection(item.price_difference_jpy)}）</dd></div>
      <div><dt>自费比例</dt><dd>{formatBps(item.buyer_self_pay_bps)}</dd></div>
      <div><dt>自费金额</dt><dd>{formatJpy(item.buyer_self_pay_jpy)}</dd></div>
      <div><dt>可返本金</dt><dd>{formatJpy(item.buyer_refundable_principal_jpy)}</dd></div>
      <div><dt>资料版本</dt><dd>{item.version}（证据版本 {item.evidence_version_no}）</dd></div>
      <div><dt>提交时间</dt><dd>{formatShanghai(item.submitted_at)}</dd></div>
      <div><dt>更新时间</dt><dd>{formatShanghai(item.updated_at)}</dd></div>
      <div><dt>核验时间</dt><dd>{formatShanghai(item.verified_at)}</dd></div></dl></Card>
    <Card><h2>文件</h2><div className="buyer-file-list">{item.files.map((file) => <EvidenceFile
      key={file.file_object_id} submissionId={submissionId} file={file} />)}</div></Card>
    {item.allowed_actions.includes('RESUBMIT') ? <EvidenceResubmitForm evidence={item} onRefresh={() => { void query.refetch(); }} /> : null}
    {item.allowed_actions.includes('WITHDRAW') ? <Button className="danger" onClick={() => setConfirmWithdraw(true)}>撤回资料</Button> : null}
    <Dialog open={confirmWithdraw} title="撤回订单资料" description="撤回后当前资料将不能继续审核。"
      busy={withdraw.isPending} onClose={() => setConfirmWithdraw(false)}>
      <BuyerMutationRecovery mutation={withdraw} onRefresh={() => { void query.refetch(); }} />
      <div className="entry-actions"><Button className="secondary" onClick={() => setConfirmWithdraw(false)}>取消</Button>
        <Button className="danger" loading={withdraw.isPending} onClick={() => withdraw.mutate({ expected_version: item.version })}>确认撤回</Button></div>
    </Dialog>
  </section>;
}

function EvidenceFile({ submissionId, file }: {
  submissionId: string;
  file: OrderEvidence['files'][number];
}): React.JSX.Element {
  const provider = useMemo(() => file.file_entity_link_id && file.version
    ? new BuyerOrderEvidenceFileReadIntentAdapter(
        submissionId,
        file.file_entity_link_id,
        file.file_object_id,
        file.version,
        file.allowed_actions,
      )
    : null, [submissionId, file]);
  return <article className="buyer-file-item"><div><strong>{file.client_file_name}</strong>
    <p>{file.mime} · {file.byte_size} 字节 · {statusLabel(file.status)}</p></div>
    {provider ? <ProtectedFileButton provider={provider} /> : <p className="metadata-only-note">历史文件仅保留元数据，当前没有读取授权。</p>}
  </article>;
}

function EvidenceResubmitForm({ evidence, onRefresh }: { evidence: OrderEvidence; onRefresh: () => void }): React.JSX.Element {
  const client = useQueryClient();
  const [uploader, upload] = useFileUpload();
  const file = useRef<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const mutation = useBuyerMutation({
    operation: (body: unknown, key, signal) => buyerApi.resubmitEvidence(client, evidence.submission_id, body, key, signal),
    onSuccess: async (result) => {
      client.setQueryData(buyerQueryKeys.evidence(evidence.submission_id), result.data.order_evidence);
      await Promise.all([
        client.invalidateQueries({ queryKey: buyerQueryKeys.evidenceListRoot }),
        client.invalidateQueries({ queryKey: buyerQueryKeys.evidenceEligibleRoot }),
      ]);
    },
    onError: async () => { setMessage('重新提交未完成。'); },
  });
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const date = dateOnlySchema.safeParse(values.get('amazon_order_date'));
    const paid = Number(values.get('final_paid_jpy'));
    const order = String(values.get('amazon_order_number') ?? '').trim();
    if (!date.success || !/^\d{3}-\d{7}-\d{7}$/u.test(order)
      || !Number.isSafeInteger(paid) || paid < 0 || !file.current) {
      setMessage('请完整填写资料并选择一张新的截图。'); return;
    }
    await uploader.start('buyerOrderEvidence', [file.current]);
    const manifest = uploader.getSnapshot().manifest;
    if (!manifest || manifest.files.length !== 1) { setMessage('截图上传未完成。'); return; }
    mutation.mutate({
      expected_version: evidence.version,
      amazon_order_number: order,
      amazon_order_date: date.data,
      final_paid_jpy: paid,
      file_object_ids: [manifest.files[0]!.file_object_id],
      buyer_note: String(values.get('buyer_note') ?? '').trim() || null,
    });
  }
  return <Card><h2>按说明重新提交</h2><form className="buyer-form" onSubmit={(event) => { void submit(event); }}>
    <FormField label="Amazon 订单号" htmlFor="resubmit-order" required><TextInput name="amazon_order_number" defaultValue={evidence.amazon_order_number_display} required /></FormField>
    <FormField label="Amazon 下单日期" htmlFor="resubmit-date" required><TextInput name="amazon_order_date" type="date" defaultValue={evidence.amazon_order_date ?? ''} required /></FormField>
    <FormField label="最终支付金额 JPY" htmlFor="resubmit-paid" required><TextInput name="final_paid_jpy" type="number" min="0" step="1" defaultValue={evidence.final_paid_jpy} required /></FormField>
    <FormField label="新的订单截图" htmlFor="resubmit-file" description="必须且只能选择一张图片" required><TextInput name="file" type="file" accept="image/jpeg,image/png,image/webp" required onChange={(event) => { file.current = event.currentTarget.files?.[0] ?? null; }} /></FormField>
    <FormField label="备注（可选）" htmlFor="resubmit-note"><TextInput name="buyer_note" maxLength={1000} /></FormField>
    {message ? <Alert tone="danger">{message}</Alert> : null}
    <BuyerMutationRecovery mutation={mutation} onRefresh={onRefresh} />
    <Button type="submit" loading={mutation.isPending || !upload.canStartNewOperation}>重新提交</Button>
  </form></Card>;
}
