import fs from 'node:fs/promises';
import {CANONICAL_ORIGIN,canonicalBootstrapScript} from '../dist/site-origin.mjs';
import {platformCanonicalPath} from '../dist/platform-routing.mjs';
const root=new URL('../dist/',import.meta.url);
for(const filename of await fs.readdir(root)) {
 if(!filename.endsWith('.html'))continue;
 const file=new URL(filename,root);
 let html=await fs.readFile(file,'utf8');
 html=html.replace(/<script\b[^>]*data-one16-canonical[^>]*>[\s\S]*?<\/script>/g,'').replace(/<link\b[^>]*rel="canonical"[^>]*>/g,'');
 const guard=`<script data-one16-canonical>${canonicalBootstrapScript()}</script><link rel="canonical" href="${CANONICAL_ORIGIN}${platformCanonicalPath(filename)}">`;
 html=html.replace(/<head(?:\s[^>]*)?>/i,head=>head+guard);
 if(filename==='index.html')html=html.replace(/entry\.mjs\?v=[^"']+/g,'entry.mjs?v=hackmeridian-unify-2');
 await fs.writeFile(file,html);
}
console.log('Canonical HTML entries prepared for '+CANONICAL_ORIGIN);
