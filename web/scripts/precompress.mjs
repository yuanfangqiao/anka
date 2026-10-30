import fs from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import {gzip,brotliCompress,constants} from 'node:zlib';
const gz=promisify(gzip),br=promisify(brotliCompress);
const types=/\.(?:html|js|mjs|css|json|svg|glb|gltf|wasm)$/i;
export async function precompress(directory){
 const summary=[];
 async function walk(dir){
  for(const entry of await fs.readdir(dir,{withFileTypes:true})){
   const file=path.join(dir,entry.name);
   if(entry.isDirectory()){await walk(file);continue;}
   if(!types.test(file))continue;
   const bytes=await fs.readFile(file);if(bytes.length<1024)continue;
   const [gzipBytes,brotliBytes]=await Promise.all([gz(bytes,{level:9}),br(bytes,{params:{[constants.BROTLI_PARAM_QUALITY]:11}})]);
   for(const [suffix,compressed]of [['gz',gzipBytes],['br',brotliBytes]]){
    if(compressed.length<bytes.length*.98)await fs.writeFile(`${file}.${suffix}`,compressed);
   }
   summary.push({file:path.relative(directory,file),bytes:bytes.length,gzip:gzipBytes.length,brotli:brotliBytes.length});
  }
 }
 await walk(directory);return summary;
}
if(process.argv[1]&&path.resolve(process.argv[1])===import.meta.filename){
 if(!process.argv[2])throw Error('Usage: node scripts/precompress.mjs <dist directory>');
 console.log(JSON.stringify(await precompress(path.resolve(process.argv[2])),null,2));
}
