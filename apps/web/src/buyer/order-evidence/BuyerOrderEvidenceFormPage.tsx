import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Alert, Button, Card, FormField, PageHeader, RequestIdDisplay, TextInput } from '../../ui/primitives';
import { buyerApi } from '../api/client';
import { dateOnlySchema, identifierSchema } from '../contracts/runtime';
import { useBuyerMutation } from '../mutations/useBuyerMutation';
import { buyerQueryKeys } from '../queries/keys';
import { BuyerLoading, BuyerQueryError } from '../shared/BuyerStates';
import { BuyerMutationRecovery } from '../shared/BuyerMutationRecovery';
import { useFileUpload } from '../shared/useFileUpload';

export function BuyerOrderEvidenceFormPage(): React.JSX.Element {
  const [search] = useSearchParams();
  const rawReservationId = search.get('reservation_id');
  const reservationId = identifierSchema.safeParse(rawReservationId).success ? rawReservationId! : '';
  const client = useQueryClient();
  const navigate = useNavigate();
  const [uploader, upload] = useFileUpload();
  const selected = useRef<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const eligible = useQuery({
    queryKey: buyerQueryKeys.evidenceEligiblePage({ limit: 100, cursor: null }),
    queryFn: ({ signal }) => buyerApi.evidenceEligible(client, 'limit=100', signal).then((r) => r.data),
    enabled: reservationId.length > 0,
  });
  const instruction = useQuery({
    queryKey: buyerQueryKeys.instructionState(reservationId),
    queryFn: ({ signal }) => buyerApi.instructionState(client, reservationId, signal).then((r) => r.data.order_instruction),
    enabled: reservationId.length > 0,
  });
  const current = eligible.data?.items.find((item) => item.reservation_id === reservationId);
  const canSubmit = current?.allowed_actions.includes('SUBMIT') === true
    && instruction.data?.can_submit_evidence === true;
  const mutation = useBuyerMutation({
    operation: (body: unknown, key, signal) => buyerApi.submitEvidence(client, body, key, signal),
    onSuccess: async (result) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: buyerQueryKeys.evidenceEligibleRoot }),
        client.invalidateQueries({ queryKey: buyerQueryKeys.evidenceListRoot }),
      ]);
      navigate(`/buyer/order-materials/${result.data.order_evidence.submission_id}`, { replace: true });
    },
    onError: () => {
      setMessage('提交未完成，请检查页面事实后重试。');
    },
  });

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setMessage(null);
    setRequestId(null);
    if (!canSubmit) { setMessage('当前预约或指引状态不允许提交。'); return; }
    const values = new FormData(event.currentTarget);
    const orderNumber = String(values.get('amazon_order_number') ?? '').trim();
    const date = dateOnlySchema.safeParse(values.get('amazon_order_date'));
    const paid = Number(values.get('final_paid_jpy'));
    if (!/^\d{3}-\d{7}-\d{7}$/u.test(orderNumber)
      || !date.success || !Number.isSafeInteger(paid) || paid < 0
      || selected.current === null) {
      setMessage('请填写有效订单号、真实下单日期、整数金额，并选择一张截图。');
      return;
    }
    await uploader.start('buyerOrderEvidence', [selected.current]);
    const manifest = uploader.getSnapshot().manifest;
    if (uploader.getSnapshot().state !== 'VERIFIED' || !manifest || manifest.files.length !== 1) {
      setRequestId(uploader.getSnapshot().requestId);
      setMessage('截图上传未完成，请重新选择并重试。');
      return;
    }
    mutation.mutate({
      reservation_id: reservationId,
      expected_version: 0,
      amazon_order_number: orderNumber,
      amazon_order_date: date.data,
      final_paid_jpy: paid,
      file_object_ids: [manifest.files[0]!.file_object_id],
      buyer_note: String(values.get('buyer_note') ?? '').trim() || null,
    });
  }

  if (!reservationId) return <BuyerQueryError error={null} title="无法打开提交页面" />;
  if (eligible.isPending || instruction.isPending) return <BuyerLoading label="正在确认提交资格" />;
  if (eligible.isError) return <BuyerQueryError error={eligible.error} />;
  if (instruction.isError) return <BuyerQueryError error={instruction.error} />;
  if (!current || !canSubmit) return <BuyerQueryError error={null} title="无法打开提交页面" />;
  return <section className="buyer-page"><PageHeader eyebrow="订单资料" title="提交订单资料" description={current.product_name} />
    <Card><form className="buyer-form" onSubmit={(event) => { void submit(event); }}>
      <FormField label="Amazon 订单号" htmlFor="evidence-order-number" description="格式：123-1234567-1234567" required>
        <TextInput name="amazon_order_number" inputMode="numeric" placeholder="123-1234567-1234567" required />
      </FormField>
      <FormField label="Amazon 下单日期" htmlFor="evidence-order-date" description="按 Amazon 订单页面显示的日期填写" required>
        <TextInput name="amazon_order_date" type="date" required />
      </FormField>
      <FormField label="最终支付金额 JPY" htmlFor="evidence-paid" required>
        <TextInput name="final_paid_jpy" type="number" inputMode="numeric" min="0" step="1" required />
      </FormField>
      <FormField label="订单截图" htmlFor="evidence-file" description="必须且只能选择一张 JPG、PNG 或 WebP 图片" required>
        <TextInput name="evidence_file" type="file" accept="image/jpeg,image/png,image/webp" required
          onChange={(event) => { selected.current = event.currentTarget.files?.[0] ?? null; }} />
      </FormField>
      <FormField label="备注（可选）" htmlFor="evidence-note"><TextInput name="buyer_note" maxLength={1000} /></FormField>
      {message ? <Alert tone="danger">{message}</Alert> : null}<RequestIdDisplay requestId={requestId} />
      <BuyerMutationRecovery mutation={mutation} onRefresh={() => { void Promise.all([eligible.refetch(), instruction.refetch()]); }} />
      <Button type="submit" loading={mutation.isPending || !upload.canStartNewOperation}
        loadingLabel={upload.state === 'VERIFIED' ? '正在提交' : '正在上传截图'}>提交资料</Button>
    </form></Card>
  </section>;
}
