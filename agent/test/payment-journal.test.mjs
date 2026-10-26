import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {paymentJournalPath,readPaymentJournal,beginPaymentJournal,savePaymentJournal} from "../lib/payment-journal.mjs";
test("journal locks a logical run once, independent of output file, and preserves ambiguous attempts",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"ad-journal-test-"));
 try{
  const file=paymentJournalPath(dir,"run");const state={runId:"run",rows:[]};
  assert.equal(await readPaymentJournal(file),null);
  await beginPaymentJournal(file,state); assert.equal((await readPaymentJournal(file)).status,"pending");
  await assert.rejects(beginPaymentJournal(paymentJournalPath(dir,"run"),{...state,out:"different.json"}),/already/);
  await savePaymentJournal(file,"unknown",{...state,reason:"timeout"});
  assert.equal((await readPaymentJournal(file)).status,"unknown");
  await assert.rejects(beginPaymentJournal(file,state),/already/);
  await savePaymentJournal(file,"settled",{...state,rows:[{tx:"a".repeat(64)}]});
  assert.equal((await readPaymentJournal(file)).status,"settled");
 }finally{await rm(dir,{recursive:true,force:true});}
});
