import test from 'node:test';
import assert from 'node:assert/strict';
import {getInitialPassportRect} from '../dist/passport-presentation.mjs';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} differs from ${b}`);

test('portrait mobile uses sixty percent width with the exact supplied cover aspect and center',()=>{
 const rect=getInitialPassportRect(390,844);near(rect.width,234);near(rect.height,234*1123/861);near(rect.x+rect.width/2,195);near(rect.y+rect.height/2,844*.45);
});

test('desktop cover caps at 280px and short landscape screens limit it by available height',()=>{
 const desktop=getInitialPassportRect(1440,900);assert.equal(desktop.width,280);near(desktop.x+desktop.width/2,720);near(desktop.y+desktop.height/2,405);
 const landscape=getInitialPassportRect(844,390);near(landscape.width,390*.48);near(landscape.height/landscape.width,1123/861);assert.ok(landscape.x>0&&landscape.y>0);assert.ok(landscape.x+landscape.width<844&&landscape.y+landscape.height<390);
});

test('collapsed or invalid viewport dimensions produce finite empty bounds',()=>{
 for(const [width,height] of [[0,0],[390,0],[0,844],[-10,500],[390,NaN],[Infinity,844]]){
  const rect=getInitialPassportRect(width,height);assert.equal(rect.width,0);assert.equal(rect.height,0);assert.ok(Object.values(rect).every(Number.isFinite));
 }
});
