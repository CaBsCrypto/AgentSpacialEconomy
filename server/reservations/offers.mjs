import { fail,hexId } from '../identity/common.mjs';
import { requireCapability } from './config.mjs';
export function createOfferService({db,config,chain,projects,now=Date.now}) {
  async function row(id) { return (await db.query('SELECT o.*,s.data AS snapshot FROM reservation_offers o JOIN reservation_snapshots s ON s.id=o.snapshot_id WHERE o.id=$1 AND o.project_id=$2 AND o.published_at IS NOT NULL',[id,config.projectId])).rows[0]; }
  async function card(value) {
    let read;
    try { read=await chain.getOffer(value.id); } catch { read={state:'UNCERTAIN'}; }
    const matches=read.id===value.id && read.projectId===config.projectId && read.spaceId===value.snapshot.spaceId && read.host===config.hostAddress;
    const contradictsFinal=value.state==='RESERVED'&&(read.state!=='RESERVED'||read.holder!==value.holder);
    const state=contradictsFinal?'UNCERTAIN':matches&&['AVAILABLE','RESERVED'].includes(read.state)?read.state:read.state==='UNAVAILABLE'?'UNAVAILABLE':'UNCERTAIN';
    if (matches&&state==='RESERVED') await db.query("UPDATE reservation_offers SET state='RESERVED',holder=$2 WHERE id=$1 AND (state<>'RESERVED' OR holder=$2)",[value.id,read.holder]);
    return {id:value.id,snapshot:value.snapshot,state,holder:state==='RESERVED'?read.holder:null,publishedAt:new Date(value.published_at).toISOString()};
  }
  async function get(id) {
    requireCapability(config,'offerReading',now()); hexId(id); const value=await row(id);
    if (!value) fail(404,'OFFER_NOT_FOUND','The published offer was not found.'); return card(value);
  }
  async function list() {
    requireCapability(config,'offerReading',now());
    const values=(await db.query('SELECT o.*,s.data AS snapshot FROM reservation_offers o JOIN reservation_snapshots s ON s.id=o.snapshot_id WHERE o.project_id=$1 AND o.published_at IS NOT NULL ORDER BY o.published_at DESC,o.id DESC LIMIT 20',[config.projectId])).rows;
    const result=[]; for(const value of values) result.push(await card(value)); return result;
  }
  async function media(id) {
    requireCapability(config,'mediaRead',now()); hexId(id); const value=await row(id);
    if (!value?.snapshot.map?.mediaId) fail(404,'MEDIA_NOT_FOUND','The published offer has no image.');
    const stored=(await db.query("SELECT * FROM reservation_media WHERE id=$1 AND project_id=$2 AND state='READY'",[value.snapshot.map.mediaId,config.projectId])).rows[0];
    return projects.readStored(stored);
  }
  return {get,list,media};
}
