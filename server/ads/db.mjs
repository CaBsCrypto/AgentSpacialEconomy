import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AdsError } from './common.mjs';
export function createDatabase({connectionString=process.env.ADS_DATABASE_URL,pool:supplied}={}){
 let pool=supplied;
 const get=async()=>{if(!pool){if(!connectionString)throw new AdsError(503,'database_unconfigured','Advertising storage is not configured.');const {Pool}=await import('pg');pool=new Pool({connectionString,max:8,connectionTimeoutMillis:5000});}return pool;};
 return {
  async query(sql,params){return(await get()).query(sql,params);},
  async transaction(work){const tx=await(await get()).connect();try{await tx.query('BEGIN');const result=await work(tx);await tx.query('COMMIT');return result;}catch(e){await tx.query('ROLLBACK');throw e;}finally{tx.release();}},
  async close(){if(pool)await pool.end();}
 };
}
export async function migrate(db,directory=fileURLToPath(new URL('../../migrations/',import.meta.url))){
 await db.transaction(async tx=>{
  await tx.query("SELECT pg_advisory_xact_lock(hashtext('ads-migrations'))");
  await tx.query('CREATE TABLE IF NOT EXISTS ads_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');
  for(const name of(await readdir(directory)).filter(n=>/^\d+.*\.sql$/.test(n)).sort()){
   if((await tx.query('SELECT name FROM ads_migrations WHERE name=$1',[name])).rowCount)continue;
   await tx.query(await readFile(path.join(directory,name),'utf8'));await tx.query('INSERT INTO ads_migrations(name) VALUES($1)',[name]);
  }
 });
}
