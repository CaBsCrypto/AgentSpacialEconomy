import test from 'node:test';import assert from 'node:assert/strict';
import {bindPassportGestures} from '../dist/passport-gestures.mjs';
class Surface extends EventTarget{
 captures=[];released=[];captureFails=false;
 setPointerCapture(id){if(this.captureFails)throw Error('unsupported capture');this.captures.push(id);}
 releasePointerCapture(id){this.released.push(id);}
 pointer(type,id=1,x=30,y=40){const event=new Event(type,{cancelable:true});Object.assign(event,{pointerId:id,clientX:x,clientY:y,button:0});this.dispatchEvent(event);return event;}
}
function setup(){const surface=new Surface(),drag=[],pinch=[],taps=[];let applied=0,paused=false;
 const cleanup=bindPassportGestures(surface,{transform:{drag:(...args)=>drag.push(args),pinch:ratio=>pinch.push(ratio)},onTap:event=>taps.push(event),onTransform:()=>applied++,isPaused:()=>paused});
 return{surface,drag,pinch,taps,cleanup,get applied(){return applied;},pause(value){paused=value;}};
}

test('a single tap activates once and a subsequent lost capture does not activate again',()=>{
 const {surface,taps,cleanup}=setup();const down=surface.pointer('pointerdown');surface.pointer('pointerup');surface.pointer('lostpointercapture');
 assert.equal(down.defaultPrevented,true);assert.equal(taps.length,1);assert.equal(taps[0].type,'pointerup');assert.deepEqual(surface.captures,[1]);cleanup();
});

test('dragging rotates and never opens the book even if the pointer returns to its start',()=>{
 const state=setup(),{surface}=state;surface.pointer('pointerdown');surface.pointer('pointermove',1,45,40);surface.pointer('pointermove',1,30,40);surface.pointer('pointerup');
 assert.deepEqual(state.drag,[[15,0],[-15,0]]);assert.equal(state.applied,2);assert.equal(state.taps.length,0);state.cleanup();
});

test('stationary two-finger gestures cannot become a tap when the last finger is lifted',()=>{
 const state=setup(),{surface}=state;
 surface.pointer('pointerdown',1,10,20);surface.pointer('pointerdown',2,30,20);surface.pointer('pointerup',2,30,20);surface.pointer('pointerup',1,10,20);
 assert.equal(state.taps.length,0);assert.equal(state.applied,0);
 surface.pointer('pointerdown');surface.pointer('pointerup');assert.equal(state.taps.length,1,'a fresh single touch is allowed');state.cleanup();
});

test('pinching applies scale and lifting one finger never converts the remaining sequence into a tap',()=>{
 const state=setup(),{surface}=state;
 surface.pointer('pointerdown',1,10,20);surface.pointer('pointerdown',2,30,20);surface.pointer('pointermove',2,50,20);surface.pointer('pointerup',2,50,20);surface.pointer('pointerup',1,10,20);
 assert.deepEqual(state.pinch,[2]);assert.equal(state.applied,1);assert.equal(state.taps.length,0);state.cleanup();
});

test('pointer cancellation and lost capture do not open the Passport',()=>{
 for(const event of ['pointercancel','lostpointercapture']){const state=setup(),{surface}=state;surface.pointer('pointerdown');surface.pointer(event);surface.pointer('pointerup');assert.equal(state.taps.length,0,event);state.cleanup();}
});

test('tap classification includes release displacement when no move event was delivered',()=>{
 const state=setup(),{surface}=state;surface.pointer('pointerdown',1,0,0);surface.pointer('pointerup',1,15,0);assert.equal(state.taps.length,0);state.cleanup();
});

test('paused interaction ignores starts and cancels a gesture that was already in progress',()=>{
 const state=setup(),{surface}=state;state.pause(true);surface.pointer('pointerdown');surface.pointer('pointermove',1,45,40);surface.pointer('pointerup');assert.equal(state.applied,0);assert.equal(state.taps.length,0);
 state.pause(false);surface.pointer('pointerdown');state.pause(true);surface.pointer('pointermove',1,45,40);state.pause(false);surface.pointer('pointerup',1,45,40);assert.equal(state.applied,0);assert.equal(state.taps.length,0);state.cleanup();
});

test('cleanup releases active pointers and removes all behavior, including repeated cleanup',()=>{
 const state=setup(),{surface}=state;surface.pointer('pointerdown');state.cleanup();state.cleanup();
 surface.pointer('pointermove',1,45,40);surface.pointer('pointerup');surface.pointer('pointerdown');surface.pointer('pointerup');
 assert.equal(state.taps.length,0);assert.equal(state.applied,0);assert.deepEqual(surface.released,[1]);
});

test('a browser that refuses pointer capture still supports a tap without throwing',()=>{
 const state=setup(),{surface}=state;surface.captureFails=true;assert.doesNotThrow(()=>{surface.pointer('pointerdown');surface.pointer('pointerup');});assert.equal(state.taps.length,1);state.cleanup();
});
