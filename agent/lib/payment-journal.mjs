// Append-only local journal keyed by logical run, independent of --out.
// Pending, partial or ambiguous entries require reconciliation and never authorize another payment.
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
export const paymentJournalPath=(directory,runId)=>join(directory,createHash("sha256").update("stellar:testnet\0"+runId).digest("hex")+".jsonl");
export async function readPaymentJournal(file) {
 try {
  const text=await readFile(file,"utf8");
  if(!text.endsWith("\n"))throw new Error("partial journal");
  const entries=text.trim().split("\n").map(line=>JSON.parse(line));
  return entries.at(-1);
 }catch(e){if(e.code==="ENOENT")return null;throw new Error("Payment journal is unreadable; reconcile it before retrying.");}
}
export async function beginPaymentJournal(file,state) {
 await mkdir(dirname(file),{recursive:true});
 try{await writeFile(file,JSON.stringify({status:"pending",state})+"\n",{flag:"wx",flush:true});}
 catch(e){if(e.code==="EEXIST")throw new Error("This run already has a payment attempt; reconcile its journal before retrying.");throw e;}
}
export async function savePaymentJournal(file,status,state) {
 await appendFile(file,JSON.stringify({status,state})+"\n",{flush:true});
}
