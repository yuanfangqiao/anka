// Shared by the standalone preview and Anka's Vite plugin-file server.
import fs from 'node:fs';
import path from 'node:path';
import {createGzip} from 'node:zlib';
import {pipeline} from 'node:stream';

export const assetMime={'.glb':'model/gltf-binary','.gltf':'model/gltf+json','.wasm':'application/wasm',
 '.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json',
 '.html':'text/html','.htm':'text/html','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png',
 '.jpg':'image/jpeg','.jpeg':'image/jpeg','.woff2':'font/woff2','.woff':'font/woff',
 '.ttf':'font/ttf','.ico':'image/x-icon','.webmanifest':'application/manifest+json','.map':'application/json'};
export function encodingQuality(header,encoding){
 const values=new Map();
 for(const part of String(header||'').toLowerCase().split(',')){
  const [name,...params]=part.trim().split(';');if(!name)continue;
  const q=params.find(p=>p.trim().startsWith('q='));
  const value=q?Number(q.trim().slice(2)):1;
  values.set(name,Number.isFinite(value)&&value>=0&&value<=1?value:0);
 }
 return values.get(encoding)??(encoding==='identity'?(values.get('*')===0?0:1):(values.get('*')??0));
}
export const isHashedAsset=file=>/\/dist\/assets\/[^/]+-[\w-]{8}\.[\w]+$/.test(file.replaceAll(path.sep,'/'));

export function sendAsset(req,res,file,{development=true,immutable=isHashedAsset(file)}={}){
 const original=fs.statSync(file),ext=path.extname(file).toLowerCase();
 const compressible=/\.(?:glb|gltf|wasm|js|mjs|css|json|svg|html)$/.test(file);
 const accept=req.headers['accept-encoding']||'';
 let encoding='',selected=file,dynamic=false;
 // Byte ranges refer to the original representation.
 if(!req.headers.range&&compressible){
  const choices=['br','gzip'].filter(e=>encodingQuality(accept,e)>0)
   .sort((a,b)=>encodingQuality(accept,b)-encodingQuality(accept,a));
  for(const e of choices){
   const candidate=file+(e==='br'?'.br':'.gz');
   if(fs.existsSync(candidate)&&fs.statSync(candidate).mtimeMs>=original.mtimeMs){selected=candidate;encoding=e;break;}
  }
  if(!encoding&&original.size>=1024&&encodingQuality(accept,'gzip')>0){encoding='gzip';dynamic=true;}
 }
 if(!encoding&&encodingQuality(accept,'identity')===0){res.statusCode=406;res.end();return;}
 const stat=fs.statSync(selected);
 const etag=`W/"${original.size.toString(16)}-${original.mtimeMs.toString(16)}-${encoding||'identity'}"`;
 res.setHeader('Content-Type',assetMime[ext]||res.getHeader('Content-Type')||'application/octet-stream');
 res.setHeader('Cache-Control',immutable?'private, max-age=31536000, immutable':development?'no-store, must-revalidate':'no-cache');
 res.setHeader('Vary','Accept-Encoding');res.setHeader('ETag',etag);
 res.setHeader('Last-Modified',original.mtime.toUTCString());
 if(encoding)res.setHeader('Content-Encoding',encoding);
 if(!req.headers.range&&req.headers['if-none-match']?.split(',').map(s=>s.trim()).includes(etag)){
  res.statusCode=304;res.end();return;
 }
 let start=0,end=stat.size-1;
 if(req.headers.range){
  const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
  if(match){
   if(match[1]){start=Number(match[1]);if(match[2])end=Math.min(end,Number(match[2]));}
   else if(match[2])start=Math.max(0,stat.size-Number(match[2]));
   if(start>end||start>=stat.size){res.statusCode=416;res.setHeader('Content-Range',`bytes */${stat.size}`);res.end();return;}
   res.statusCode=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${stat.size}`);
  }
 }
 if(!dynamic)res.setHeader('Content-Length',Math.max(0,end-start+1));
 if(!encoding)res.setHeader('Accept-Ranges','bytes');
 if(req.method==='HEAD'||stat.size===0){res.end();return;}
 const source=fs.createReadStream(selected,{start,end});
 const done=error=>{if(error&&!res.destroyed)res.destroy(error);};
 if(dynamic)pipeline(source,createGzip({level:6}),res,done);else pipeline(source,res,done);
}
