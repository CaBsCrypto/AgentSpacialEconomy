import test from 'node:test';
import assert from 'node:assert/strict';
import {readAdsConfig,publicAdsConfig} from '../server/ads/config.mjs';
test('missing operational configuration disables purchases while the approved pilot price is explicit',()=>{
 const c=readAdsConfig({}),p=publicAdsConfig(c);assert.equal(c.enabled,false);assert(c.missing.includes('payTo'));assert(!c.missing.some(key=>key.startsWith('pricing.')));assert.equal(p.offers[0].amountUnits,'50000000');assert.equal(p.offers[0].durationMs,300000);assert.deepEqual(p.plans,['TIME']);assert.equal(p.placements.find(p=>p.id==='venue_center_banner').purchasable,false);assert.equal(p.payTo,null);assert.equal(p.registry,'NOT_DEPLOYED');assert.equal(p.defaultStageUrl,'/assets/main-stage-default.mp4');assert.equal(p.pricing,undefined);
});
test('pubnet and lookalike asset are rejected before API initialization',()=>{
 assert.throws(()=>readAdsConfig({ADS_CONFIG_JSON:JSON.stringify({network:'stellar:pubnet'})}),/Testnet/);assert.throws(()=>readAdsConfig({ADS_CONFIG_JSON:JSON.stringify({asset:'COTHER'})}),/Testnet/);
});
test('public configuration cannot echo a pasted signing secret or private runtime credentials',()=>{
 const c=readAdsConfig({ADS_CONFIG_JSON:JSON.stringify({payTo:'S'+ 'A'.repeat(55)})}),p=JSON.stringify(publicAdsConfig(c));
 assert(!p.includes('S'+'A'.repeat(55)));assert(!p.includes('publisherKey'));assert(!p.includes('databaseUrl'));
});
