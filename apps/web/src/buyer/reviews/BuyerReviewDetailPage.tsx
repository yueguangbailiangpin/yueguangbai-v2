import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import { BuyerReviewFileReadIntentAdapter } from '../../files/file-read-providers';
import { Alert, Button, Card, Dialog, FormField, PageHeader, StatusBadge, TextInput } from '../../ui/primitives';
import { buyerApi } from '../api/client';
import type { Review } from '../contracts/runtime';
import { useBuyerMutation } from '../mutations/useBuyerMutation';
import { buyerQueryKeys } from '../queries/keys';
import { formatCnyFen, formatDateOnly, formatShanghai } from '../shared/format';
import { BuyerLoading, BuyerQueryError } from '../shared/BuyerStates';
import { BuyerMutationRecovery } from '../shared/BuyerMutationRecovery';
import { ProtectedFileButton } from '../shared/ProtectedFileButton';
import { statusLabel, statusTone } from '../shared/status';
import { useFileUpload } from '../shared/useFileUpload';

export function BuyerReviewDetailPage(): React.JSX.Element {
  const { reviewCaseId = '' } = useParams();
  const client = useQueryClient();
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const query = useQuery({ queryKey: buyerQueryKeys.review(reviewCaseId),
    queryFn: ({ signal }) => buyerApi.review(client, reviewCaseId, signal).then((r) => r.data.review), enabled: reviewCaseId.length > 0 });
  const withdraw = useBuyerMutation({ operation: (body: { expected_version: number }, key, signal) => buyerApi.withdrawReview(client, reviewCaseId, body.expected_version, key, signal),
    onSuccess: async (result) => { client.setQueryData(buyerQueryKeys.review(reviewCaseId), result.data.review); await client.invalidateQueries({ queryKey: buyerQueryKeys.reviewsRoot }); setConfirmWithdraw(false); },
    onError: async () => {} });
  if (query.isPending) return <BuyerLoading />;
  if (query.isError) return <BuyerQueryError error={query.error} />;
  const item = query.data;
  return <section className="buyer-page"><PageHeader eyebrow="评论详情" title={item.order.product_name}>
    <StatusBadge tone={statusTone(item.status)}>{statusLabel(item.status)}</StatusBadge></PageHeader>
    {item.status === 'CHANGES_REQUESTED' && item.public_change_reason ? <Alert tone="warning">修改说明：{item.public_change_reason}</Alert> : null}
    {item.status === 'APPROVED' && item.buyer_refund_due ? <Alert tone="success">返款金额 {formatCnyFen(item.buyer_refund_due.amount_cny_fen)}</Alert> : null}
    <Card><dl className="buyer-facts"><div><dt>评论类型</dt><dd>{item.review_type}</dd></div>
      <div><dt>Amazon 订单号</dt><dd>{item.order.amazon_order_number}</dd></div><div><dt>Amazon 下单日期</dt><dd>{formatDateOnly(item.order.amazon_order_date)}</dd></div>
      <div><dt>证据版本</dt><dd>{item.current_evidence_version_no}</dd></div><div><dt>文件数量</dt><dd>{item.file_count}</dd></div>
      <div><dt>提交时间</dt><dd>{formatShanghai(item.submitted_at)}</dd></div><div><dt>更新时间</dt><dd>{formatShanghai(item.updated_at)}</dd></div>
      <div><dt>评论链接</dt><dd>{item.review_url ? <a href={item.review_url} target="_blank" rel="noreferrer">打开评论链接</a> : '未提供'}</dd></div></dl></Card>
    <Card><h2>证据文件</h2>{item.files.map((file) => <ReviewFile key={file.file_entity_link_id} reviewId={item.review_case_id} file={file} />)}</Card>
    {item.allowed_actions.includes('RESUBMIT') ? <ReviewResubmitForm review={item} onRefresh={() => { void query.refetch(); }} /> : null}
    {item.allowed_actions.includes('WITHDRAW') ? <Button className="danger" onClick={() => setConfirmWithdraw(true)}>撤回评论资料</Button> : null}
    <Dialog open={confirmWithdraw} title="撤回评论资料" description="撤回后当前资料不会继续审核。" busy={withdraw.isPending} onClose={() => setConfirmWithdraw(false)}>
      <BuyerMutationRecovery mutation={withdraw} onRefresh={() => { void query.refetch(); }} /><div className="entry-actions"><Button className="secondary" onClick={() => setConfirmWithdraw(false)}>取消</Button><Button className="danger" loading={withdraw.isPending} onClick={() => withdraw.mutate({ expected_version: item.version })}>确认撤回</Button></div>
    </Dialog>
  </section>;
}

type ReviewDetail = Awaited<ReturnType<typeof buyerApi.review>>['data']['review'];
function ReviewFile({ reviewId, file }: { reviewId: string; file: ReviewDetail['files'][number] }): React.JSX.Element {
  const provider = useMemo(() => new BuyerReviewFileReadIntentAdapter(reviewId, file.file_entity_link_id, file.file_object_id, file.version, file.allowed_actions), [reviewId, file]);
  return <article className="buyer-file-item"><div><strong>{file.client_file_name}</strong><p>{file.mime} · {file.byte_size} 字节</p></div><ProtectedFileButton provider={provider} /></article>;
}

function ReviewResubmitForm({ review, onRefresh }: { review: ReviewDetail; onRefresh: () => void }): React.JSX.Element {
  const client = useQueryClient(); const files = useRef<readonly File[]>([]); const [uploader, upload] = useFileUpload();
  const [message, setMessage] = useState<string | null>(null);
  const mutation = useBuyerMutation({ operation: (body: unknown, key, signal) => buyerApi.resubmitReview(client, review.review_case_id, body, key, signal),
    onSuccess: async (result) => { client.setQueryData(buyerQueryKeys.review(review.review_case_id), result.data.review); await client.invalidateQueries({ queryKey: buyerQueryKeys.reviewsRoot }); },
    onError: () => { setMessage('重新提交未完成，页面事实可能已经变化。'); } });
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); const form = event.currentTarget; if (files.current.length < 1 || files.current.length > 3) { setMessage('请选择 1–3 个文件。'); return; }
    await uploader.start('buyerReviewEvidence', files.current); const manifest = uploader.getSnapshot().manifest;
    if (!manifest || manifest.files.length < 1 || manifest.files.length > 3) { setMessage('文件上传未完成。'); return; }
    const values = new FormData(form); const reviewUrl = String(values.get('review_url') ?? '').trim();
    mutation.mutate({ expected_version: review.version, review_type: review.review_type, review_url: reviewUrl || null,
      evidence_files: manifest.files.map((file) => ({ file_object_id: file.file_object_id, expected_file_version: file.file_version })),
      buyer_note: String(values.get('buyer_note') ?? '').trim() || null });
  }
  return <Card><h2>按说明重新提交</h2><form className="buyer-form" onSubmit={(event) => { void submit(event); }}>
    <FormField label="评论链接（可选）" htmlFor="review-resubmit-url"><TextInput name="review_url" type="url" defaultValue={review.review_url ?? ''} /></FormField>
    <FormField label="新的评论证据" htmlFor="review-resubmit-files" description="必须选择 1–3 个文件" required><TextInput name="files" type="file" multiple required accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => { files.current = Array.from(event.currentTarget.files ?? []).slice(0, 4); }} /></FormField>
    <FormField label="备注（可选）" htmlFor="review-resubmit-note"><TextInput name="buyer_note" maxLength={1000} /></FormField>
    {message ? <Alert tone="danger">{message}</Alert> : null}
    <BuyerMutationRecovery mutation={mutation} onRefresh={onRefresh} />
    <Button type="submit" loading={mutation.isPending || !upload.canStartNewOperation}>重新提交</Button>
  </form></Card>;
}
