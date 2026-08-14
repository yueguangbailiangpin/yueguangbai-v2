// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup,fireEvent,render,screen } from '@testing-library/react';
import { afterEach,describe,expect,it,vi } from 'vitest';
import { AdvancePrincipalCard,AdvanceReversalCard } from './StaffOperatingIntegrityTools';

afterEach(cleanup);

describe('Advance V1 Staff controls',()=>{
  it('shows the snapshot amount read-only and submits no client amount',()=>{
    const onPrepare=vi.fn();
    render(<AdvancePrincipalCard
      authoritativeAmountCnyFen="48840"
      disabled={false}
      disabledReason={null}
      busy={false}
      uploadState="VERIFIED"
      onFile={vi.fn()}
      onPrepare={onPrepare}
    />);
    expect(screen.getByText('本次全额付款：¥488.40 CNY')).toBeVisible();
    expect(screen.queryByLabelText(/实际支付金额/u)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'准备记录全额提前本金'}));
    expect(onPrepare).toHaveBeenCalledOnce();
    expect(onPrepare.mock.calls[0]?.[0]).toMatchObject({payment_channel:'WECHAT',note:null});
    expect(onPrepare.mock.calls[0]?.[0]).not.toHaveProperty('amount_cny_fen');
    expect(onPrepare.mock.calls[0]?.[0]).toHaveProperty('paid_at');
  });

  it('offers only an entire reversal reason, not a reversal amount',()=>{
    const onSubmit=vi.fn();
    render(<AdvanceReversalCard busy={false} onSubmit={onSubmit}/>);
    expect(screen.queryByLabelText(/冲正金额/u)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('整笔冲正原因'),{target:{value:'付款凭证录入错误'}});
    fireEvent.click(screen.getByRole('button',{name:'整笔冲正'}));
    expect(onSubmit).toHaveBeenCalledWith('付款凭证录入错误');
  });
});
