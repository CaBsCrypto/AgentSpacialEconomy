/** Optional source-artwork step: outline the licensed DM Sans font with a local Canvas tool.
 * node scripts/build-ads-entry-artwork.mjs <absolute @napi-rs/canvas directory>
 * Production build reads the resulting outlined SVG, not this authoring dependency.
 */
import {readFile,writeFile,realpath} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
const directory=process.argv[2];if(!directory)throw Error('Pass the local @napi-rs/canvas directory');
const require=createRequire(resolve(directory,'package.json'));
const {createCanvas,GlobalFonts,SvgExportFlag}=require('@napi-rs/canvas');
if(!GlobalFonts.registerFromPath(await realpath('media/fonts/DM-Sans.ttf'),'StageSans'))throw Error('Licensed DM Sans font could not be loaded');
const template=await readFile('media/ads-entry/main-stage-poster.template.svg','utf8');
const canvas=createCanvas(560,794,SvgExportFlag.ConvertTextToPaths),ctx=canvas.getContext('2d');
const plain=template.replace(/<text\b([^>]*)>([^<]*)<\/text>/g,(_whole,attrs,text)=>{
 const attr=name=>attrs.match(new RegExp('(?:^|\\s)'+name+'="([^"]*)"'))?.[1];
 ctx.font=(attr('font-weight')||'400')+' '+attr('font-size')+'px StageSans';ctx.fillStyle=attr('fill')||'#eef4f7';ctx.textAlign=attr('text-anchor')==='middle'?'center':'left';ctx.letterSpacing=(attr('letter-spacing')||0)+'px';
 ctx.fillText(text,Number(attr('x')),Number(attr('y')));return '';
});
const outlined=canvas.getContent().toString().replace(/^[\s\S]*?<svg[^>]*>/,'').replace(/<\/svg>\s*$/,'');
await writeFile('media/ads-entry/main-stage-poster.outlined.svg',plain.replace('</svg>',outlined+'</svg>'));
console.log('Outlined all poster lettering with licensed DM Sans; no font lookup at production build.');
