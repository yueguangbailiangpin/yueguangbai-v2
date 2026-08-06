import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { isFrontendApiError } from '../../api/errors';
import { Alert, Button, Card, FormField, PageHeader, RequestIdDisplay, TextInput } from '../../ui/primitives';
import { buyerApi } from '../api/client';
import { identifierSchema } from '../contracts/runtime';
import { buyerQueryKeys } from '../queries/keys';
import { BuyerLoading, BuyerQueryError } from '../shared/BuyerStates';
import { useFileUpload } from '../shared/useFileUpload';

export function BuyerReviewFormPage(): React.JSX.Element {
  const [search] = useSearchParams();
  const rawId = search.get('formal_order_id');
  const formalOrderId = identifierSchema.safeParse(rawId).success ? rawId! : '';
  const client = useQueryClient();
  const navigate = useNavigate();
  const files = useRef<readonly File[]>([]);
  const [uploader, upload] = useFileUpload();
  const [message, setMessage] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const eligible = useQuery({
    queryKey: buyerQueryKeys.reviewEligible(),
    queryFn: ({ signal }) => buyerApi.reviewEligible(client, 'limit=100', signal).then((r) => r.data),
    enabled: formalOrderId.length > 0,
  });
  const current = eligible.data?.items.find((item) => item.order.formal_order_id === formalOrderId);
  const mutation = useMutation({
    mutationFn: (body: unknown) => buyerApi.submitReview(client, body, crypto.randomUUID()),
    onSuccess: async (result) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: buyerQueryKeys.reviewEligible() }),
        client.invalidateQueries({ queryKey: buyerQueryKeys.reviews() }),
      ]);
      navigate(`/buyer/reviews/${result.data.review.review_case_id}`, { replace: true });
    },
    onError: (error) => {
      setRequestId(isFrontendApiError(error) ? error.requestId : null);
      setMessage('评论资料提交未完成，请检查后重试。');
    },
  });
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    setMessage(null);
    if (!current?.allowed_actions.includes('SUBMIT') || files.current.length < 1 || files.current.length > 3) {
      setMessage('请选择 1–3 个文件。'); return;
    }
    await uploader.start('buyerReviewEvidence', files.current);
    const manifest = uploader.getSnapshot().manifest;
    if (!manifest || manifest.files.length < 1 || manifest.files.length > 3) {
      setMessage('文件上传未完成，请重新选择。'); return;
    }
    const values = new FormData(form);
    const reviewUrl = String(values.get('review_url') ?? '').trim();
    mutation.mutate({
      formal_order_id: formalOrderId,
      expected_version: 0,
      review_type: current.order.review_type,
      review_url: reviewUrl || null,
      evidence_files: manifest.files.map((file) => ({
        file_object_id: file.file_object_id,
        expected_file_version: file.file_version,
      })),
      buyer_note: String(values.get('buyer_note') ?? '').trim() || null,
    });
  }
  if (!formalOrderId) return <BuyerQueryError error={null} title="无法打开评论提交页面" />;
  if (eligible.isPending) return <BuyerLoading label="正在确认评论资格" />;
  if (eligible.isError) return <BuyerQueryError error={eligible.error} />;
  if (!current?.allowed_actions.includes('SUBMIT')) return <BuyerQueryError error={null} title="无法打开评论提交页面" />;
  return <section className="buyer-page"><PageHeader eyebrow="评论" title="提交评论资料" description={current.order.product_name} />
    <Card><dl className="buyer-facts"><div><dt>评论类型</dt><dd>{current.order.review_type}</dd></div><div><dt>Amazon 订单号</dt><dd>{current.order.amazon_order_number}</dd></div></dl>
      <form className="buyer-form" onSubmit={(event) => { void submit(event); }}>
        <FormField label="评论链接（可选）" htmlFor="review-url"><TextInput name="review_url" type="url" /></FormField>
        <FormField label="评论证据" htmlFor="review-files" description="请选择 1–3 个图片或 PDF 文件" required>
          <TextInput name="review_files" type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" required
            onChange={(event) => { files.current = Array.from(event.currentTarget.files ?? []).slice(0, 4); }} />
        </FormField>
        <FormField label="备注（可选）" htmlFor="review-note"><TextInput name="buyer_note" maxLength={1000} /></FormField>
        {message ? <Alert tone="danger">{message}</Alert> : null}<RequestIdDisplay requestId={requestId} />
        <Button type="submit" loading={mutation.isPending || !upload.canStartNewOperation}>提交评论资料</Button>
      </form></Card>
  </section>;
}
