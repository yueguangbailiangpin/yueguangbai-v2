import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Alert, Button, Card, FormField, PageHeader, TextInput } from '../../ui/primitives';
import { buyerApi } from '../api/client';
import { identifierSchema } from '../contracts/runtime';
import { useBuyerMutation } from '../mutations/useBuyerMutation';
import { buyerQueryKeys } from '../queries/keys';
import { BuyerLoading, BuyerQueryError } from '../shared/BuyerStates';
import { FileDropZone } from '../../ui/FileDropZone';
import { BuyerMutationRecovery } from '../shared/BuyerMutationRecovery';
import { useFileUpload } from '../shared/useFileUpload';
import { BuyerJourney } from '../shared/BuyerJourney';
import { reviewTypeLabel } from '../shared/status';

export function BuyerReviewFormPage(): React.JSX.Element {
  const [search] = useSearchParams();
  const rawId = search.get('formal_order_id');
  const formalOrderId = identifierSchema.safeParse(rawId).success ? rawId! : '';
  const client = useQueryClient();
  const navigate = useNavigate();
  const files = useRef<readonly File[]>([]);
  const [uploader, upload] = useFileUpload();
  const [message, setMessage] = useState<string | null>(null);
  const eligible = useQuery({
    queryKey: buyerQueryKeys.reviewEligiblePage({ limit: 100, cursor: null }),
    queryFn: ({ signal }) =>
      buyerApi.reviewEligible(client, 'limit=100', signal).then((r) => r.data),
    enabled: formalOrderId.length > 0,
  });
  const current = eligible.data?.items.find((item) => item.order.formal_order_id === formalOrderId);
  const mutation = useBuyerMutation({
    operation: (body: unknown, key, signal) => buyerApi.submitReview(client, body, key, signal),
    onSuccess: async (result) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: buyerQueryKeys.reviewEligibleRoot }),
        client.invalidateQueries({ queryKey: buyerQueryKeys.reviewsRoot }),
      ]);
      navigate(`/buyer/reviews/${result.data.review.review_case_id}`, { replace: true });
    },
    onError: () => {
      setMessage('评论资料提交未完成，请检查后重试。');
    },
  });
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    setMessage(null);
    if (
      !current?.allowed_actions.includes('SUBMIT') ||
      files.current.length < 1 ||
      files.current.length > 3
    ) {
      setMessage('请选择 1–3 个文件。');
      return;
    }
    await uploader.start('buyerReviewEvidence', files.current);
    const manifest = uploader.getSnapshot().manifest;
    if (!manifest || manifest.files.length < 1 || manifest.files.length > 3) {
      setMessage('文件上传未完成，请重新选择。');
      return;
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
  if (!current?.allowed_actions.includes('SUBMIT'))
    return <BuyerQueryError error={null} title="无法打开评论提交页面" />;
  return (
    <section className="buyer-page buyer-flow-page buyer-form-page">
      <BuyerJourney current="reviews" />
      <PageHeader
        eyebrow="评论阶段"
        title="提交评论资料"
        description={current.order.product_name}
      />
      <Card className="buyer-action-panel">
        <div className="buyer-form-intro">
          <strong>准备评论资料</strong>
          <p>请提交 1–3 个已验证文件；评论链接可稍后补充。</p>
        </div>
        <dl className="buyer-facts">
          <div>
            <dt>评论类型</dt>
            <dd>{reviewTypeLabel(current.order.review_type)}</dd>
          </div>
          <div>
            <dt>Amazon 订单号</dt>
            <dd>{current.order.amazon_order_number}</dd>
          </div>
        </dl>
        <form
          className="buyer-form"
          onSubmit={(event) => {
            void submit(event);
          }}
        >
          <FormField label="评论链接（可选）" htmlFor="review-url">
            <TextInput name="review_url" type="url" />
          </FormField>
          <FormField
            label="评论证据"
            htmlFor="review-files"
            description="请选择 1–3 个图片或 PDF 文件"
            required
          >
            <FileDropZone
              id="review-files"
              multiple
              accept="image/jpeg,image/png,image/webp,application/pdf"
              required
              maximumFiles={3}
              maximumBytes={20 * 1024 * 1024}
              buttonLabel="选择评论证据"
              emptyLabel="尚未选择文件"
              onFilesChange={(selectedFiles) => {
                files.current = [...selectedFiles];
              }}
            />
          </FormField>
          <FormField label="备注（可选）" htmlFor="review-note">
            <TextInput name="buyer_note" maxLength={1000} />
          </FormField>
          {message ? <Alert tone="danger">{message}</Alert> : null}
          <BuyerMutationRecovery
            mutation={mutation}
            onRefresh={() => {
              void eligible.refetch();
            }}
          />
          <Button type="submit" loading={mutation.isPending || !upload.canStartNewOperation}>
            提交评论资料
          </Button>
        </form>
      </Card>
    </section>
  );
}
