import test from 'node:test';import assert from 'node:assert/strict';import {createEmbeddedPassport} from '../dist/embedded-passport.mjs';import {bindWorldPassport} from '../dist/world-passport.mjs';
class El extends EventTarget {open=false;showModal(){this.open=true}close(){this.open=false;this.dispatchEvent(new Event('close'))}}
class MessageRoot extends EventTarget {
 listeners=new Set();
 addEventListener(type,listener,...options){if(type==='message')this.listeners.add(listener);return super.addEventListener(type,listener,...options);}
 removeEventListener(type,listener,...options){if(type==='message')this.listeners.delete(listener);return super.removeEventListener(type,listener,...options);}
 send({origin='https://demo.example',source,data={type:'passport-return-world'}}){const event=new Event('message');Object.assign(event,{origin,source,data});this.dispatchEvent(event);}
}
function fixture(){const messages=[],frames=[],eventRoot=new MessageRoot(),documentRef={location:{origin:'https://demo.example'},defaultView:eventRoot,createElement(){const f={contentWindow:{postMessage:(...m)=>messages.push(m)},remove(){this.removed=true}};frames.push(f);return f;}};
 const host={ownerDocument:documentRef,replaceChildren(...c){this.children=c;}};return{messages,frames,eventRoot,documentRef,host};}

test('same-world panel mounts once, tears down on close, and remounts without changing visitor position',async()=>{
 const {messages,frames,host,eventRoot}=fixture();
 const embedded=createEmbeddedPassport(host),dialog=new El(),close=new El(),pose={x:3.2,z:-29.15,yaw:Math.PI},before={...pose};let panelLoads=0;
 const controller=bindWorldPassport({dialog,closeButton:close,clearInput(){},loadPanel:()=>panelLoads++,onOpen:embedded.mount,onClose:embedded.unmount});
 await controller.open();await controller.open();assert.equal(frames.length,1);assert.equal(frames[0].src,'./passport-ar.html?embedded=1&v=book2');assert.equal(frames[0].allow,'camera; xr-spatial-tracking; fullscreen');assert.equal(eventRoot.listeners.size,1);
 controller.close();assert.equal(frames[0].removed,true);assert.equal(host.children.length,0);assert.equal(eventRoot.listeners.size,0);assert.deepEqual(messages[0],[{type:'passport-pause'},'https://demo.example']);
 await controller.open();assert.equal(frames.length,2);assert.equal(panelLoads,1);assert.deepEqual(pose,before);controller.close();
});

test('the active same-origin frame can return to ONE16 while preserving the visitor pose',async()=>{
 const {host,eventRoot,frames,messages}=fixture(),dialog=new El(),close=new El(),pose={x:3.2,z:-29.15,yaw:Math.PI,pitch:.1},before={...pose};let controller;
 const embedded=createEmbeddedPassport(host,{onReturn:()=>controller.close()});
 controller=bindWorldPassport({dialog,closeButton:close,clearInput(){},loadPanel(){},onOpen:embedded.mount,onClose:embedded.unmount});
 await controller.open();assert.equal(dialog.open,true);eventRoot.send({source:frames[0].contentWindow});
 assert.equal(dialog.open,false);assert.equal(frames[0].removed,true);assert.equal(host.children.length,0);assert.equal(eventRoot.listeners.size,0);assert.deepEqual(pose,before);assert.deepEqual(messages[0],[{type:'passport-pause'},'https://demo.example']);
});

test('return messages reject incorrect origins, sources, message types and stale frames',()=>{
 const {host,eventRoot,frames}=fixture();let returns=0;const embedded=createEmbeddedPassport(host,{onReturn:()=>returns++}),first=embedded.mount();
 eventRoot.send({source:first.contentWindow,origin:'https://untrusted.example'});eventRoot.send({source:{}});eventRoot.send({source:first.contentWindow,data:{type:'other'}});eventRoot.send({source:first.contentWindow,data:null});assert.equal(returns,0);
 embedded.unmount();eventRoot.send({source:first.contentWindow});assert.equal(returns,0);
 const current=embedded.mount();eventRoot.send({source:first.contentWindow});assert.equal(returns,0,'a previous frame cannot close the current experience');
 eventRoot.send({source:current.contentWindow});assert.equal(returns,1);assert.equal(frames.length,2);embedded.unmount();
});

test('mount and cleanup are idempotent and support an explicitly injected message target',()=>{
 const {host,eventRoot,frames}=fixture(),customRoot=new MessageRoot();let returns=0;const embedded=createEmbeddedPassport(host,{eventRoot:customRoot,onReturn:()=>returns++});
 assert.equal(customRoot.listeners.size,0);const frame=embedded.mount();assert.equal(embedded.mount(),frame);assert.equal(frames.length,1);assert.equal(customRoot.listeners.size,1);assert.equal(eventRoot.listeners.size,0);
 eventRoot.send({source:frame.contentWindow});assert.equal(returns,0);customRoot.send({source:frame.contentWindow});assert.equal(returns,1);
 embedded.unmount();embedded.unmount();assert.equal(customRoot.listeners.size,0);customRoot.send({source:frame.contentWindow});assert.equal(returns,1);
});

test('fullscreen camera, first-frame and failure messages are accepted only from the active same-origin frame',()=>{
 const {host,eventRoot,messages}=fixture(),ready=[],camera=[],errors=[];
 const embedded=createEmbeddedPassport(host,{presentation:'fullscreen',onReady:payload=>ready.push(payload),onCameraReady:payload=>camera.push(payload),onError:payload=>errors.push(payload)});
 assert.equal(embedded.retry(),false);const frame=embedded.mount();assert.equal(frame.src,'./passport-ar.html?embedded=1&presentation=fullscreen&v=spatial2');assert.match(frame.className,/passport-embedded-fullscreen/);assert.equal(frame.allow,'camera; xr-spatial-tracking; fullscreen');
 const first={type:'passport-first-frame',elapsed:123},live={type:'passport-camera-ready'},failure={type:'passport-load-error',message:'offline'};
 for(const data of [first,live,failure]){eventRoot.send({source:{},data});eventRoot.send({source:frame.contentWindow,origin:'https://wrong.example',data});}assert.equal(ready.length+camera.length+errors.length,0);
 eventRoot.send({source:frame.contentWindow,data:live});eventRoot.send({source:frame.contentWindow,data:first});eventRoot.send({source:frame.contentWindow,data:failure});assert.deepEqual(camera,[live]);assert.deepEqual(ready,[first]);assert.deepEqual(errors,[failure]);
 assert.equal(embedded.retry(),true);assert.deepEqual(messages.at(-1),[{type:'passport-retry'},'https://demo.example']);
 embedded.unmount();eventRoot.send({source:frame.contentWindow,data:first});assert.equal(ready.length,1);assert.equal(embedded.retry(),false);
});
test('spatial capability and reading page updates reject foreign or stale frames',()=>{
 const {host,eventRoot}=fixture(),capabilities=[],pages=[];
 const embedded=createEmbeddedPassport(host,{onSpatialCapability:payload=>capabilities.push(payload),onReadingPage:payload=>pages.push(payload)}),frame=embedded.mount();
 const capability={type:'passport-spatial-capability',kind:'quick-look'},page={type:'passport-reading-page',page:2};
 for(const data of [capability,page]){eventRoot.send({source:{},data});eventRoot.send({source:frame.contentWindow,origin:'https://other.example',data});}assert.equal(capabilities.length+pages.length,0);
 eventRoot.send({source:frame.contentWindow,data:capability});eventRoot.send({source:frame.contentWindow,data:page});assert.deepEqual(capabilities,[capability]);assert.deepEqual(pages,[page]);embedded.unmount();embedded.mount();
 eventRoot.send({source:frame.contentWindow,data:capability});eventRoot.send({source:frame.contentWindow,data:page});assert.equal(capabilities.length,1);assert.equal(pages.length,1);embedded.unmount();
});