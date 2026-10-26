import test from 'node:test';
import assert from 'node:assert/strict';
import {createPassportReading,bindPassportReading} from '../dist/passport-reading.mjs';
import {PASSPORT_CONTENT} from '../dist/passport-content.mjs';

test('reading progresses through two pages to completion, clamps, goes back and closes',()=>{
 const changes=[],reading=createPassportReading({onChange:page=>changes.push(page)});
 assert.equal(reading.page,0);assert.equal(reading.previous(),0);
 assert.equal(reading.next(),1);assert.equal(reading.next(),2);assert.equal(reading.next(),3);assert.equal(reading.next(),3);
 assert.equal(reading.previous(),2);assert.equal(reading.close(),0);assert.equal(reading.close(),0);
 assert.deepEqual(changes,[1,2,3,2,0]);
});

test('subscribers receive the current page immediately and unsubscribe cleanly',()=>{
 const reading=createPassportReading(),seen=[];reading.next();
 const unsubscribe=reading.subscribe(page=>seen.push(page));reading.next();reading.next();unsubscribe();reading.close();
 assert.deepEqual(seen,[1,2,3]);
});

class Element extends EventTarget{
 constructor(tag){super();this.tag=tag;this.children=[];this.dataset={};this.attributes={};this.hidden=false;this.open=false;}
 setAttribute(name,value){this.attributes[name]=value;}
 append(...children){for(const child of children){this.children.push(child);child.parent=this;}}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(node=>node!==this);}
 click(){this.dispatchEvent(new Event('click'));}
 find(className){if(this.className?.split(' ').includes(className))return this;for(const child of this.children){const found=child.find(className);if(found)return found;}}
}
const createHost=()=>{const host=new Element('div');host.ownerDocument={createElement:tag=>new Element(tag)};return host;};

test('discreet accessible arrows handle cover and both pages without large page buttons',()=>{
 const host=createHost(),reading=createPassportReading();bindPassportReading(host,reading);
 const root=host.find('passport-reading'),next=root.find('passport-reading-next'),previous=root.find('passport-reading-previous');
 assert.equal(root.find('passport-reading-close'),undefined);assert.equal(next.textContent,'›');assert.equal(next.attributes['aria-label'],'Abrir Passport');assert.equal(previous.hidden,true);
 next.click();assert.equal(reading.page,1);assert.equal(next.attributes['aria-label'],'Página siguiente');assert.equal(previous.hidden,false);assert.equal(previous.textContent,'‹');assert.equal(previous.attributes['aria-label'],'Página anterior');
 assert.deepEqual(root.find('passport-reading-navigation').children.filter(node=>!node.hidden),[previous,next]);
 previous.click();assert.equal(reading.page,0);assert.equal(previous.hidden,true);
 next.click();next.click();assert.equal(reading.page,2);assert.equal(next.attributes['aria-label'],'Finalizar lectura');
});

test('after page two, completion offers exactly the external CTA and return to ONE16',()=>{
 const host=createHost(),reading=createPassportReading();let returns=0;bindPassportReading(host,reading,{onReturn:()=>returns++});
 const root=host.find('passport-reading'),next=root.find('passport-reading-next'),cta=root.find('passport-reading-cta'),returnButton=root.find('passport-reading-return'),details=root.find('passport-reading-text');
 assert.equal(cta.hidden,true);assert.equal(returnButton.hidden,true);assert.equal(details.hidden,true);returnButton.click();assert.equal(returns,0);
 next.click();assert.equal(reading.page,1);assert.equal(cta.hidden,true);assert.equal(details.hidden,false);assert.equal(root.find('passport-reading-title').textContent,PASSPORT_CONTENT.pages[0].title);
 next.click();assert.equal(reading.page,2);assert.equal(cta.hidden,true);details.open=true;
 next.click();assert.equal(reading.page,3);assert.equal(cta.hidden,false);assert.equal(returnButton.hidden,false);assert.equal(details.hidden,true);assert.equal(details.open,false);
 assert.deepEqual(root.find('passport-reading-navigation').children.filter(node=>!node.hidden),[cta,returnButton]);assert.equal(root.find('passport-reading-progress').textContent,'Lectura completa');
 assert.equal(cta.href,'https://demo.stellarpassport.xyz/');assert.equal(cta.target,'_blank');assert.match(cta.rel,/noopener/);assert.match(cta.rel,/noreferrer/);
 returnButton.click();assert.equal(returns,1);reading.close();assert.equal(cta.hidden,true);assert.equal(returnButton.hidden,true);assert.equal(next.attributes['aria-label'],'Abrir Passport');
});

test('closing resets the accessible reader and disposing releases controls and subscription',()=>{
 const host=createHost(),reading=createPassportReading();let returns=0;
 const binding=bindPassportReading(host,reading,{onReturn:()=>returns++});
 const root=host.find('passport-reading'),next=root.find('passport-reading-next'),details=root.find('passport-reading-text'),returnButton=root.find('passport-reading-return');
 next.click();details.open=true;reading.close();assert.equal(reading.page,0);assert.equal(details.open,false);assert.equal(details.hidden,true);
 binding.dispose();binding.dispose();assert.equal(host.children.length,0);
 next.click();assert.equal(reading.page,0);reading.next();reading.next();reading.next();assert.equal(root.dataset.page,'0');returnButton.click();assert.equal(returns,0);
});

test('configured pages identify a demo rather than authenticated account details',()=>{
 assert.equal(PASSPORT_CONTENT.pages.length,2);assert.equal(PASSPORT_CONTENT.badge,'Demo beta · Testnet');
 assert.match(PASSPORT_CONTENT.note,/no muestra datos de una cuenta conectada/);
 assert.equal(PASSPORT_CONTENT.cta.label,'Abrir Stellar Passport');assert.equal(PASSPORT_CONTENT.cta.url,'https://demo.stellarpassport.xyz/');
});
