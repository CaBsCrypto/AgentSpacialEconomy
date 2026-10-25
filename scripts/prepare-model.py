"""Produce exact lossless gzip transfer and update measured fallback byte counts."""
import gzip,re,hashlib
from pathlib import Path
root=Path(__file__).resolve().parents[1];p=root/'dist/assets/one16.glb';raw=p.read_bytes();compressed=gzip.compress(raw,compresslevel=9,mtime=0);p.with_suffix('.glb.gz').write_bytes(compressed)
version=hashlib.sha256(raw).hexdigest()[:12]
m=root/'dist/model-transfer.mjs';s=m.read_text();s=re.sub(r'one16\.glb\.gz\?v=[^\'\"]+',f'one16.glb.gz?v={version}',s);s=re.sub(r'one16\.glb\?v=[^\'\"]+',f'one16.glb?v={version}',s);s=re.sub(r'\(compressed\?\d+:\d+\)',f'(compressed?{len(compressed)}:{len(raw)})',s);s=re.sub(r'onProgress\(\{loaded:0,total:\d+\}\)',f'onProgress({{loaded:0,total:{len(raw)}}})',s);m.write_text(s)
print({'original':len(raw),'gzip':len(compressed),'sha256':hashlib.sha256(raw).hexdigest()})
