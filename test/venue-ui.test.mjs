import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Mesh, BoxGeometry, MeshStandardMaterial, Texture } from 'three';
import { createArcadeLighting, tuneVenueTextures, VENUE_RENDER_QUALITY } from '../dist/venue-ui.mjs';

test('arcade light variation stays slow and bounded, respects live reduced motion, and restores on disposal', () => {
  const root = new Group(), led = new MeshStandardMaterial({emissiveIntensity:2}), ordinary = new MeshStandardMaterial({emissiveIntensity:.4});
  led.name='Arcade LED cyan'; ordinary.name='Stage • warm uplight';
  root.add(new Mesh(new BoxGeometry(),[led,ordinary]),new Mesh(new BoxGeometry(),led));
  const reducedMotion={matches:false}, controller=createArcadeLighting(root,{reducedMotion});
  let previous=led.emissiveIntensity;
  for(let i=0;i<600;i++){
    controller.update(1/60);
    assert(led.emissiveIntensity>=1.88&&led.emissiveIntensity<=2.12);
    assert(Math.abs(led.emissiveIntensity-previous)<.003);
    previous=led.emissiveIntensity;
  }
  assert.equal(ordinary.emissiveIntensity,.4);
  reducedMotion.matches=true;controller.update(1/60);assert.equal(led.emissiveIntensity,2);
  reducedMotion.matches=false;controller.update(1000);assert(Number.isFinite(led.emissiveIntensity));
  controller.dispose();assert.equal(led.emissiveIntensity,2);
});

test('texture filtering caps are shared across material arrays without changing image or color space', () => {
  const root=new Group(), image={width:512,height:512}, map=new Texture(image), normalMap=new Texture(image);
  const material=new MeshStandardMaterial({map,normalMap}), before=map.colorSpace;
  root.add(new Mesh(new BoxGeometry(),[material,material]));
  tuneVenueTextures(root,{mobile:true});assert.equal(map.anisotropy,2);assert.equal(normalMap.anisotropy,2);
  tuneVenueTextures(root);assert.equal(map.anisotropy,4);assert.equal(normalMap.anisotropy,4);
  assert.equal(map.image,image);assert.equal(map.colorSpace,before);
  assert(Object.isFrozen(VENUE_RENDER_QUALITY));
});
