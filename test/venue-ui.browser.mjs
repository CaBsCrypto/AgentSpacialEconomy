/** Optional browser QA: node --test test/venue-ui.browser.mjs. Supply a local Playwright module/browser through the environment when they are not installed here. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require=createRequire(import.meta.url);
const { chromium }=require(process.env.VENUE_UI_PLAYWRIGHT_MODULE || 'playwright');
const root=fileURLToPath(new URL('../',import.meta.url));
const source=fs.readFileSync(path.join(root,'dist/index.html'),'utf8');
const layout=JSON.parse(source.match(/<script id="embeddedLayout"[^>]*>([\s\S]*?)<\/script>/)[1]);
const css=fs.readFileSync(path.join(root,'dist/style.css'),'utf8').replace(/@import[^;]+;/g,'');
const html=source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'').replace(/<img\b[^>]*>/gi,'');
const uiSource=fs.readFileSync(path.join(root,'dist/venue-ui.mjs'),'utf8');
const qaDirectory=process.env.VENUE_UI_QA_DIR;
if(qaDirectory)fs.mkdirSync(qaDirectory,{recursive:true});

test('venue controls fit desktop, portrait and landscape without overlapping the HUD',async t=>{
 const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
 try{
  for(const[w,h]of[[390,844],[844,390],[320,568],[1440,900]])await t.test(`${w} × ${h}`,async()=>{
   const page=await browser.newPage({viewport:{width:w,height:h}});
   await page.route('**/*',route=>route.abort());
   await page.setContent('<style>'+css+'</style>'+html);
   await page.evaluate(async({layout,uiSource})=>{
    document.documentElement.className='';
    document.querySelectorAll('#venueWelcome,#passportDirect').forEach(e=>e.hidden=true);
    const view=document.querySelector('#viewer');view.hidden=false;view.dataset.mode='walk';
    document.querySelectorAll('#helpPanel,#fallback,#overviewHotspots,#plan,#reviewTools,#overviewArHint').forEach(e=>e.hidden=true);
    document.querySelectorAll('#walkMinimap,.touch-controls,#reviewNames').forEach(e=>e.hidden=false);
    for(const zone of layout.zones){const b=document.createElement('button');b.textContent=zone.label;document.querySelector('#zones').append(b);}
    document.querySelector('#reviewNames').innerHTML='<details class="review-legend"><summary>Referencias 1, 4–25 · nombres</summary><ol>'+layout.zones.map(z=>'<li>'+z.label+'</li>').join('')+'</ol></details>';
    const module=await import('data:text/javascript;base64,'+btoa(unescape(encodeURIComponent(uiSource))));
    window.venueTestUI=module.mountVenueUI(document);window.venueTestUI.setMode('walk');
    document.querySelector('#room').textContent='Pasillo amarillo · arrastra para mirar';
   },{layout,uiSource});
   assert.equal(await page.locator('#reviewToggle').evaluate(e=>e.parentElement.id),'venueActions');
   assert(!(await page.locator('#venueActions').textContent()).includes('null'));
   async function noOverlap(ids){
    const pairs=await page.evaluate(ids=>{
     window.venueTestUI.refresh();
     const boxes=ids.map(id=>{const e=document.querySelector(id),r=e.getBoundingClientRect();return{id,x:r.x,y:r.y,w:r.width,h:r.height,visibility:getComputedStyle(e).visibility};}).filter(b=>b.w&&b.h&&b.visibility==='visible');
     return boxes.flatMap((a,i)=>boxes.slice(i+1).filter(b=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y).map(b=>[a.id,b.id]));
    },ids);assert.deepEqual(pairs,[]);
   }
   async function screenshot(name){if(qaDirectory)await page.screenshot({path:path.join(qaDirectory,`${name}-${w}x${h}.png`)});}
   await noOverlap(['#venueHud','#walkMinimap','.touch-controls']);
   await screenshot('walk');
   await page.click('#minimapToggle');
   assert.equal(await page.locator('#minimapToggle').getAttribute('aria-expanded'),h<=500?'true':'false');
   await page.click('#minimapToggle');
   await page.click('#toggleZones');
   const panel=await page.evaluate(()=>{
    const element=document.querySelector('#venuePlacesPanel'),rect=element.getBoundingClientRect();
    const buttons=[...document.querySelectorAll('#zones button')].map(e=>e.getBoundingClientRect());
    return{open:!element.hidden,blocks:window.venueTestUI.blocksNavigation,bottom:rect.bottom,
     expanded:document.querySelector('#toggleZones').getAttribute('aria-expanded'),
     overlap:buttons.some((r,i)=>i&&r.top<buttons[i-1].bottom-1),
     legendAfterZones:document.querySelector('#reviewNames').getBoundingClientRect().top>=document.querySelector('#zones').getBoundingClientRect().bottom};
   });
   assert(panel.open&&panel.blocks);assert.equal(panel.expanded,'true');assert(panel.bottom<=h+1);assert(!panel.overlap);assert(panel.legendAfterZones);
   await screenshot('places');
   await page.click('#closePlaces');
   assert.equal(await page.locator('#toggleZones').getAttribute('aria-expanded'),'false');
   assert.equal(await page.evaluate(()=>document.activeElement.id),'toggleZones');
   await page.click('#toggleZones');
   await page.evaluate(()=>window.venueTestUI.setMode('walk'));
   assert.equal(await page.evaluate(()=>document.activeElement.id),'toggleZones','selecting a place must restore focus before hiding the panel');
   await page.evaluate(()=>{
    document.querySelector('#viewer').dataset.mode='overview';
    document.querySelectorAll('#walkMinimap,.touch-controls').forEach(e=>e.hidden=true);
    document.querySelectorAll('#reviewTools,#overviewArHint').forEach(e=>e.hidden=false);
    document.querySelector('#room').textContent='Vista general · arrastra para desplazar y pellizca para acercar';
    window.venueTestUI.setMode('overview');
   });
   assert.equal(await page.locator('#overviewGuide').evaluate(e=>e.open),false);
   await noOverlap(['#venueHud','#overviewGuide']);
   await page.click('#overviewGuide>summary');
   await noOverlap(['#venueHud','#overviewGuide']);
   await screenshot('overview');
   assert.equal(await page.evaluate(()=>window.venueTestUI.closePanels()),true);
   assert.equal(await page.evaluate(()=>window.venueTestUI.closePanels()),false);
   const small=await page.evaluate(()=>[...document.querySelectorAll('#venueHud button,#overviewGuide>summary')].filter(e=>e.getBoundingClientRect().height).map(e=>({id:e.id,h:e.getBoundingClientRect().height})).filter(e=>e.h<44));
   assert.deepEqual(small,[]);
   await page.click('#toggleZones');
   await page.evaluate(()=>document.dispatchEvent(new CustomEvent('one16-failed')));
   assert.equal(await page.locator('#toggleZones').evaluate(e=>getComputedStyle(e).display),'none');
   assert.equal(await page.locator('#venuePlacesPanel').evaluate(e=>e.hidden),true);
   await page.evaluate(()=>document.dispatchEvent(new CustomEvent('one16-ready')));
   assert.equal(await page.locator('#toggleZones').evaluate(e=>getComputedStyle(e).display),'block');
   await page.evaluate(()=>document.querySelector('#viewer').classList.add('no-webgl'));
   assert.equal(await page.locator('#toggleZones').evaluate(e=>getComputedStyle(e).display),'none','the no-WebGL rule must take precedence over the compact HUD rule');
   await page.close();
  });
 }finally{await browser.close();}
});
