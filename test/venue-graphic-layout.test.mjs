import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url),manifest=JSON.parse(fs.readFileSync(new URL('model/textures/manifest.json',root)));
const intersects=(a,b,pad=0)=>a[0]<b[2]+pad&&a[2]>b[0]-pad&&a[1]<b[3]+pad&&a[3]>b[1]-pad;

test('check-in repeats leave every principal identity and date slot clear',()=>{
 const {reserved,repeatMarks,repeatClearancePx}=manifest.graphics['checkin-backdrop'].layout;
 assert.deepEqual(reserved.map(item=>item.id),['made-to-move','event-identity','event-date']);
 assert(repeatMarks.length>15);
 const graphic=manifest.graphics['checkin-backdrop'],title=reserved.find(slot=>slot.id==='made-to-move');
 assert(title.box[3]/graphic.height<=.64,'Made to Move drops behind the frontal counter');
 assert.equal(title.text.text,'Made to\nMove');
 const b=title.text.bounds;
 assert(b[0]>=title.box[0]+20&&b[1]>=title.box[1]+16&&b[2]<=title.box[2]-20&&b[3]<=title.box[3]-16,'title crowds its reserved margins');
 for(const mark of repeatMarks)for(const slot of reserved)
  assert(!intersects(mark.box,slot.box,repeatClearancePx),`${mark.kind} overlaps ${slot.id}`);
});

test('five skills sheets have labeled stickers with only their public category contents',()=>{
 const graphics=manifest.graphics['skills-board'],{groups,groupCount}=graphics.layout;
 assert.equal(groupCount,5);assert.equal(groups.length,5);
 assert.deepEqual(groups.map(g=>g.label),['LOOKING FOR TEAM','DATA','DESIGN','FRONT END','BACK END']);
 for(const group of groups){
  assert(group.stickers.length>0);
  assert(group.normalizedSheet.every(v=>v>=0&&v<=1));
  for(const sticker of group.stickers){
   assert.equal(sticker.label,group.label);
   assert.equal(sticker.text.text.replaceAll('\n',' '),group.label);
   const [x0,y0,x1,y1]=sticker.text.bounds,[cx0,cy0,cx1,cy1]=sticker.circle;
   assert(x0>=cx0&&y0>=cy0&&x1<=cx1&&y1<=cy1,'sticker text leaves its yellow circle');
  }
 }
});

test('all eight tabletop arts retain metric aspect, transparent corners and a clear hardware zone',()=>{
 const keys=Object.keys(manifest.graphics).filter(key=>manifest.graphics[key].layout.support==='tabletop');
 assert.equal(keys.length,8);
 for(const key of keys){
  const graphic=manifest.graphics[key];assert.equal(graphic.width,2048);assert.equal(graphic.height,712);assert.equal(graphic.alphaMode,'MASK');
  assert(Math.abs(graphic.width/graphic.height/(1.84/.64)-1)<.005);
  for(const wordmark of graphic.layout.wordmarks){
   assert(!intersects(wordmark.text.bounds,graphic.layout.hardwareReserved));
   assert(wordmark.text.fontSize>=145,'wordmark was shrunk to a tiny caption');
   const b=wordmark.text.bounds,box=wordmark.box;
   const widthFill=(b[2]-b[0])/(box[2]-box[0]),heightFill=(b[3]-b[1])/(box[3]-box[1]);
   assert(Math.max(widthFill,heightFill)>=.97,'wordmark leaves avoidable empty space in both dimensions');
   assert(b[0]>=box[0]&&b[1]>=box[1]&&b[2]<=box[2]&&b[3]<=box[3],'wordmark exceeds its safe print area');
  }
 }
 const script=`from PIL import Image\nimport json,sys\nfrom pathlib import Path\np=Path(sys.argv[1]);out={}\nfor k in sys.argv[2:]:\n im=Image.open(p/(k+'.png'));a=im.getchannel('A');out[k]={'mode':im.mode,'size':im.size,'alpha':a.getextrema(),'corner':a.getpixel((0,0))}\nprint(json.dumps(out))`;
 const info=JSON.parse(execFileSync('python',['-c',script,fileURLToPath(new URL('model/textures/graphics/',root)),...keys],{encoding:'utf8'}));
 for(const image of Object.values(info)){assert.equal(image.mode,'RGBA');assert.deepEqual(image.size,[2048,712]);assert.deepEqual(image.alpha,[0,255]);assert.equal(image.corner,0);}
});
