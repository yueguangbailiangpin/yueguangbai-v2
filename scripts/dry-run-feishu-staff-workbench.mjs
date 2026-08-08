const staffCount=8;
const dailyOrders=200;
const actionableRate=0.25;
const summaries=Math.ceil(dailyOrders*actionableRate);
const outboundUpserts=summaries;
const callbackBudget=Math.ceil(summaries*0.1);
if(staffCount>8||dailyOrders>200||outboundUpserts>50||callbackBudget>5) throw new Error('local feishu workbench capacity model exceeds frozen ceiling');
console.log(JSON.stringify({mode:'LOCAL_NO_NETWORK',staff_count:staffCount,daily_orders:dailyOrders,actionable_summaries:summaries,outbound_upserts:outboundUpserts,callback_budget:callbackBudget,transport:'anonymous_fake_responses_only',production_adapter:'locally_contract_tested',runtime_default:'HARD_DISABLED',production_status:'NO_GO',time_basis:'UTC_MS',display_timezone:'Asia/Shanghai'},null,2));
