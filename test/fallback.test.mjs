import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {withTimeout} from '../dist/load-timeout.mjs';
const html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
test('static tour and actual plan exist in HTML independent of JavaScript, fetch and WebGL',()=>{
 assert.match(html,/<a id="enter" href="#accessibleTour">/);assert.match(html,/<section id="accessibleTour"/);assert.match(html,/<div class="static-map"><svg/);
 const data=JSON.parse(html.match(/<script id="embeddedLayout" type="application\/json">(.*?)<\/script>/s)[1]);assert.ok(data.zones.length>=11);assert.ok(data.spawn);assert.ok(data.walkable.length);
 assert.match(html,/>Ver plano e imágenes sin WebGL</);assert.match(html,/id="showPlan"/);assert.match(html,/id="staticExit"/);
});
test('engine error propagates without waiting for timeout',async()=>{await assert.rejects(withTimeout(Promise.reject(Error('import failed')),100,'timeout'),/import failed/)});
test('never-resolving engine settles with honest timeout error',async()=>{await assert.rejects(withTimeout(new Promise(()=>{}),5,'motor demasiado lento'),/motor demasiado lento/)});
test('working engine returns result',async()=>assert.equal(await withTimeout(Promise.resolve('ready'),100,'timeout'),'ready'));
