// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import '../../test/msw/lifecycle';
import { apiUrl } from '../../test/msw/handlers';
import { renderWithMsw } from '../../test/msw/render';
import { server } from '../../test/msw/server';
import { StaffSessionBoundary } from '../../auth/staff/StaffSessionBoundary';
import type { StaffAuthApiAdapter, StaffSession } from '../../auth/staff/staff-auth-api';
import { AcquisitionWorkbench } from './AcquisitionWorkbench';

afterEach(cleanup);

describe('Staff acquisition workbench', () => {
  it('shows the pre-sales Buyer form without client channel authority', async () => {
    let requestBody: Record<string,unknown>|null = null;
    server.use(
      http.get(apiUrl('/api/staff/acquisition/leads'), () => HttpResponse.json({
        data: { items: [], next_cursor: null }, meta: { request_id: 'leads' },
      })),
      http.get(apiUrl('/api/staff/acquisition/funnel'), () => HttpResponse.json({
        data: { funnel: funnel() }, meta: { request_id: 'funnel' },
      })),
      http.post(apiUrl('/api/staff/acquisition/leads'), async ({ request }) => {
        requestBody = await request.json() as Record<string,unknown>;
        return HttpResponse.json({ data: { lead: lead(), replayed: false }, meta: { request_id: 'create' } }, { status: 201 });
      }),
    );
    const user=userEvent.setup();
    renderWithMsw(<StaffSessionBoundary adapter={adapter(session('pre_sales', ['ACQUISITION_BUYER_LEAD']))}>
      <AcquisitionWorkbench />
    </StaffSessionBoundary>, { route:'/staff/acquisition' });
    expect(await screen.findByRole('heading',{name:'添加微信后登记'})).toBeVisible();
    expect(screen.queryByRole('option',{name:'卖家线索'})).not.toBeInTheDocument();
    expect(screen.queryByLabelText('渠道')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('微信号'),'private_wx');
    await user.click(screen.getByRole('button',{name:'登记线索'}));
    await waitFor(() => expect(requestBody).not.toBeNull());
    expect(requestBody).toEqual({ lead_type:'BUYER',wechat_id:'private_wx',display_name:null,note:null });
    expect(requestBody).not.toHaveProperty('channel_id');
  });

  it('hides every registration control from buyer_refund', async () => {
    renderWithMsw(<StaffSessionBoundary adapter={adapter(session('buyer_refund', []))}>
      <AcquisitionWorkbench />
    </StaffSessionBoundary>, { route:'/staff/acquisition' });
    expect(await screen.findByText('当前角色不参与获客登记')).toBeVisible();
    expect(screen.queryByLabelText('微信号')).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'登记线索'})).not.toBeInTheDocument();
  });

  it('shows owner consultation correction history with Beijing labels', async () => {
    let disableBody: Record<string,unknown>|null=null;
    let revokeBody: Record<string,unknown>|null=null;
    server.use(
      http.get(apiUrl('/api/staff/acquisition/leads'), () => HttpResponse.json({ data:{items:[],next_cursor:null},meta:{request_id:'leads'} })),
      http.get(apiUrl('/api/staff/acquisition/funnel'), () => HttpResponse.json({ data:{funnel:funnel()},meta:{request_id:'funnel'} })),
      http.get(apiUrl('/api/staff/acquisition/channels'), () => HttpResponse.json({ data:{channels:[channel()]},meta:{request_id:'channels'} })),
      http.get(apiUrl('/api/staff/acquisition/channel-assignments'), () => HttpResponse.json({ data:{assignments:[assignment()]},meta:{request_id:'assignments'} })),
      http.get(apiUrl('/api/staff/acquisition/consultations'), () => HttpResponse.json({ data:{consultations:[consultation()]},meta:{request_id:'consultations'} })),
      http.get(apiUrl('/api/staff/acquisition/consultations/consultation-1/history'), () => HttpResponse.json({ data:{history:[{
        event_id:'event-1',event_type:'CORRECTED',previous_count:12,next_count:11,
        previous_version:1,next_version:2,actor_staff_id:'owner-1',reason:'去除重复',created_at:1780000000000,
      }]},meta:{request_id:'history'} })),
      http.post(apiUrl('/api/staff/acquisition/channels/channel-1/disable'), async ({request})=>{
        disableBody=await request.json() as Record<string,unknown>;
        return HttpResponse.json({data:{channel:{...channel(),status:'DISABLED',version:2},replayed:false},meta:{request_id:'disable'}});
      }),
      http.post(apiUrl('/api/staff/acquisition/channel-assignments/assignment-1/revoke'), async ({request})=>{
        revokeBody=await request.json() as Record<string,unknown>;
        return HttpResponse.json({data:{assignment:{...assignment(),status:'REVOKED',version:2},replayed:false},meta:{request_id:'revoke'}});
      }),
    );
    const user=userEvent.setup();
    renderWithMsw(<StaffSessionBoundary adapter={adapter(session('owner', [
      'ACQUISITION_ADMIN','ACQUISITION_BUYER_LEAD','ACQUISITION_SELLER_LEAD','FINANCIAL_VIEW',
    ]))}><AcquisitionWorkbench /></StaffSessionBoundary>, { route:'/staff/acquisition' });
    expect(await screen.findByRole('heading',{name:'总管理员配置'})).toBeVisible();
    expect(screen.getByText(/业务日期（北京时间）/u)).toBeVisible();
    await user.click(await screen.findByText('查看更正历史'));
    expect(screen.getByText(/12 → 11/u)).toBeVisible();
    expect(screen.getByText(/去除重复/u)).toBeVisible();
    await user.type(screen.getByLabelText('停用原因'),'账号停用');
    await user.click(screen.getByRole('button',{name:'停用渠道'}));
    await waitFor(()=>expect(disableBody).toEqual({expected_version:1,reason:'账号停用'}));
    await user.type(screen.getByLabelText('撤销原因'),'员工渠道调整');
    await user.click(screen.getByRole('button',{name:'撤销有效期'}));
    await waitFor(()=>expect(revokeBody).toEqual({expected_version:1,reason:'员工渠道调整'}));
  });
});

function adapter(value: StaffSession): StaffAuthApiAdapter {
  return {
    readSession: async()=>({data:{session:value},requestId:'session'}),
    loginStart: async()=>({data:{provider:'FEISHU',authorization_url:'https://example.test',expires_at:1},requestId:'login'}),
    logout: async()=>({data:{logged_out:true,all_devices_logged_out:false},requestId:'logout'}),
    logoutAll: async()=>({data:{logged_out:true,all_devices_logged_out:true,session_version:2},requestId:'logout-all'}),
  };
}
function session(role: 'owner'|'pre_sales'|'buyer_refund', permissions: string[]): StaffSession {
  const roleValue: StaffSession['role'] = role === 'owner'
    ? {code:'owner',display_name:'总管理员'}
    : role === 'pre_sales'
      ? {code:'pre_sales',display_name:'售前'}
      : {code:'buyer_refund',display_name:'买家返款'};
  return { staff_id:'staff-1',display_name:'测试员工',role:roleValue,
    permissions,data_scope:{type:role==='owner'?'GLOBAL':'ASSIGNED_BUYERS',buyerCustomerIds:[],sellerOrganizationIds:[],teamIds:[]},
    authorization_version:1,session_version:1,expires_at:Date.now()+100000 };
}
function channel(){return {channel_id:'channel-1',code:'XHS_A',channel_type:'XIAOHONGSHU',display_name:'小红书 A',status:'ACTIVE',version:1,created_at:1,updated_at:1};}
function assignment(){return {assignment_id:'assignment-1',staff_id:'staff-pre',lead_type:'BUYER',channel_id:'channel-1',channel_name:'小红书 A',effective_from:1,effective_until:null,status:'ACTIVE',version:1};}
function consultation(){return {consultation_id:'consultation-1',channel_id:'channel-1',lead_type:'BUYER',business_date:'2026-08-01',person_count:11,version:2,updated_by_staff_id:'owner-1',updated_at:1780000000000};}
function lead(){return {lead_id:'lead-1',lead_type:'BUYER',wechat_masked:'pr***wx',display_name:'路由买家',note:null,origin_channel_id:'channel-1',origin_channel_name:'小红书 A',origin_staff_id:'staff-1',current_owner_staff_id:'staff-1',status:'ACTIVE',version:1,created_business_date:'2026-08-08',latest_followup_at:1780000000000,retention_due_at:1811536000000,retention_hold_reason:null,registered:false,reservation_submitted:false,no_participation:true,formal_order_count:0,seller_cooperation:false,created_at:1780000000000,updated_at:1780000000000};}
function funnel(){return {from_date:'2026-08-01',to_date:'2026-08-08',data_as_of:1780000000000,buyer:{consultation_count:10,wechat_added_count:1,registered_count:0,reservation_submitted_count:0,no_participation_count:1,formal_order_count:0,projected_gross_profit_cny_fen:null,completed_gross_profit_cny_fen:null},seller:null};}
