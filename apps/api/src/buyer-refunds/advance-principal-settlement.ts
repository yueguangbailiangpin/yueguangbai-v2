import type { SqlDatabase,SqlStatement } from '@ygb/contracts';
import { hashCanonicalJson } from '@ygb/domain';
import { insertBuyerRefundEventStatement } from './buyer-refund-events';

interface AdvanceRow{
  id:string;amount_cny_fen:number;paid_at:number;china_business_date:string;payment_channel:'WECHAT'|'ALIPAY'|'BANK_TRANSFER'|'OTHER_MANUAL';
  note:string|null;actor_staff_id:string;reversed_cny_fen:number;
}

export async function prepareAdvancePrincipalSettlementStatements(
  database:SqlDatabase,
  input:{obligationId:string;formalOrderId:string;now:number},
):Promise<{statements:SqlStatement[];netPaidCnyFen:number;settlementCount:number}>{
  const rows=await database.prepare(`SELECT payment.id,payment.amount_cny_fen,payment.paid_at,payment.china_business_date,
      payment.payment_channel,payment.note,payment.actor_staff_id,
      COALESCE((SELECT SUM(reversal.amount_cny_fen) FROM buyer_advance_principal_entries reversal
        WHERE reversal.entry_type='REVERSAL' AND reversal.original_payment_entry_id=payment.id),0) AS reversed_cny_fen
    FROM buyer_advance_principal_entries payment
    WHERE payment.formal_order_id=? AND payment.entry_type='PAYMENT'
      AND NOT EXISTS(SELECT 1 FROM buyer_advance_principal_settlements settlement WHERE settlement.advance_payment_entry_id=payment.id)
    ORDER BY payment.paid_at,payment.created_at,payment.id`).bind(input.formalOrderId).all<AdvanceRow>();
  const statements:SqlStatement[]=[];let cumulative=0;let count=0;
  for(const row of rows.results){
    const net=Number(row.amount_cny_fen)-Number(row.reversed_cny_fen);if(net<=0)continue;
    if(!Number.isSafeInteger(net)||cumulative+net>Number.MAX_SAFE_INTEGER)throw new Error('advance_principal_amount_overflow');
    cumulative+=net;count+=1;
    const refundPaymentId=crypto.randomUUID();const settlementId=crypto.randomUUID();
    const key=`advance-settle:${row.id}`.slice(0,128);
    const requestHash=await hashCanonicalJson({action:'SETTLE_ADVANCE_PRINCIPAL',advance_payment_entry_id:row.id,obligation_id:input.obligationId,amount_cny_fen:net});
    statements.push(
      database.prepare(`INSERT INTO buyer_refund_payment_entries(
        id,obligation_id,entry_type,original_payment_entry_id,amount_cny_fen,paid_at,reversed_at,
        china_business_date,payment_channel,recorded_by_staff_id,public_note,internal_note,
        idempotency_key,request_hash,created_at
      ) VALUES(?,?,'PAYMENT',NULL,?,?,NULL,?,?,?,NULL,?,?,?,?)`).bind(
        refundPaymentId,input.obligationId,net,row.paid_at,row.china_business_date,row.payment_channel,row.actor_staff_id,
        `提前返本金自动抵扣${row.note?`：${row.note}`:''}`.slice(0,4000),key,requestHash,input.now),
      database.prepare(`INSERT INTO buyer_advance_principal_settlements(
        id,advance_payment_entry_id,buyer_refund_obligation_id,buyer_refund_payment_entry_id,settled_amount_cny_fen,settled_at
      ) VALUES(?,?,?,?,?,?)`).bind(settlementId,row.id,input.obligationId,refundPaymentId,net,input.now),
      insertBuyerRefundEventStatement(database,{
        obligationId:input.obligationId,paymentEntryId:refundPaymentId,eventType:'BUYER_REFUND_PAYMENT_RECORDED',
        actorType:'SYSTEM',actorId:'advance-principal-settlement',obligationVersion:1,amountCnyFen:net,
        netPaidAfterCnyFen:cumulative,metadata:{source:'ADVANCE_PRINCIPAL',advance_payment_entry_id:row.id},
        idempotencyKey:key,createdAt:input.now,
      }),
    );
  }
  return{statements,netPaidCnyFen:cumulative,settlementCount:count};
}
