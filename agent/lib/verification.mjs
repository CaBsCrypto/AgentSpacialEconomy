/** A green live-run CI requires fresh, unique transaction receipts for every expected paid step. */
export function requireSettlementReport(report,{runId,services=['venue-feed','screen-card']}={}){
 if(!runId||report?.runId!==runId)throw Error('Settlement report does not belong to this fresh run.');
 const rows=services.map(service=>{
  const row=report.rows?.find(r=>r.service===service&&r.status==='settled');
  if(!row||typeof row.tx!=='string'||!/^[a-f0-9]{64}$/i.test(row.tx))throw Error('Expected confirmed settlement is missing for '+service+'. Zero payments or HTTP success alone cannot pass CI.');
  return row;
 });
 if(new Set(rows.map(r=>r.tx)).size!==rows.length)throw Error('A transaction cannot satisfy several paid steps.');
 return rows;
}
