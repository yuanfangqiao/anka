/** Anka GATT v1: little endian frames, bounded per-characteristic reassembly. */
export const SERVICE='9f924000-6db5-4e64-a7c3-31891b2a0000';
export const INPUT=SERVICE.replace('4000','4001'),OUTPUT=SERVICE.replace('4000','4002'),CONTROL=SERVICE.replace('4000','4003');
export const ACTIONS=['reload','next_weapon','grenade','shield','jump','heal','roll','interact','toggle_crouch'];
export const EVENTS=['shot','damage','reload_complete','death','win'];
export function fragments(bytes,id,capacity=20){
 if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>2048||capacity<=8)throw Error('无效蓝牙帧');
 const chunks=[];
 for(let offset=0;offset<bytes.length;offset+=capacity-8){
  const part=bytes.slice(offset,offset+capacity-8),chunk=new Uint8Array(8+part.length),v=new DataView(chunk.buffer);
  chunk[0]=0xa7;chunk[1]=1;v.setUint16(2,id,true);v.setUint16(4,offset,true);v.setUint16(6,bytes.length,true);chunk.set(part,8);chunks.push(chunk);
 }return chunks;
}
export class Assembly{
 push(value,now=performance.now()){
  const p=new Uint8Array(value.buffer,value.byteOffset,value.byteLength),v=new DataView(p.buffer,p.byteOffset,p.byteLength);
  if(p.length<=8||p[0]!==0xa7||p[1]!==1)throw Error('无效蓝牙分帧');
  const id=v.getUint16(2,true),offset=v.getUint16(4,true),total=v.getUint16(6,true);
  if(total<1||total>2048||offset+p.length-8>total)throw Error('蓝牙帧长度越界');
  if(offset===0){this.bytes=new Uint8Array(total);this.id=id;this.used=0;}
  if(this.id!==id||this.bytes?.length!==total||offset!==this.used||(offset&&now-this.at>250)){this.bytes=null;throw Error('蓝牙分帧不完整或已超时');}
  this.bytes.set(p.subarray(8),offset);this.used+=p.length-8;this.at=now;
  return this.used===total?this.bytes:null;
 }
}
export function decodeInput(bytes){
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(bytes.length<6||bytes[0]!==1)throw Error('不支持的蓝牙协议');
 const seq=v.getUint32(2,true);if(!seq)throw Error('无效蓝牙序号');
 if(bytes[1]===2&&bytes.length===7&&ACTIONS[bytes[6]])return {type:'action',seq,action:ACTIONS[bytes[6]]};
 if(bytes[1]!==1||bytes.length!==44||bytes[42]>3||bytes[43]>1)throw Error('无效蓝牙输入');
 const x=v.getFloat32(6,true),y=v.getFloat32(10,true),turnTotal=v.getFloat64(14,true);
 if(![x,y,turnTotal].every(Number.isFinite)||Math.hypot(x,y)>1.0001||Math.abs(turnTotal)>1e9)throw Error('蓝牙输入数值越界');
 const frame={type:'input',seq,move:{x,y},look:{yaw:0,pitch:0},buttons:{fire:!!(bytes[42]&1),aim:!!(bytes[42]&2)},turn:((turnTotal+180)%360+360)%360-180,turnTotal};
 if(bytes[43]){
  const id=v.getUint32(22,true),q=Array.from({length:4},(_,i)=>v.getFloat32(26+i*4,true)),norm=Math.hypot(...q);
  if(!id||!q.every(Number.isFinite)||Math.abs(norm-1)>.01)throw Error('无效蓝牙姿态');
  frame.pose={id,q:q.map(x=>x/norm),gain:1};
 }return frame;
}
export function encodeOutput(frame,seq){
 if(!['feedback','leds'].includes(frame.type)||!Number.isFinite(frame.durationMs??40)||!Number.isFinite(frame.strength??.3))throw Error('无效蓝牙输出');
 const leds=frame.type==='leds',bytes=new Uint8Array(leds?26:10),v=new DataView(bytes.buffer);
 bytes[0]=1;bytes[1]=leds?4:3;v.setUint32(2,seq,true);
 if(leds){
  if(!Array.isArray(frame.rgb)||frame.rgb.length!==18||!frame.rgb.every(x=>Number.isInteger(x)&&x>=0&&x<=255))throw Error('LED需要6组RGB');
  v.setUint16(6,Math.min(2000,Math.max(0,frame.durationMs??500)),true);bytes.set(frame.rgb,8);
 }else{
  const index=EVENTS.indexOf(frame.event);if(index<0)throw Error('未知反馈事件');
  bytes[6]=index;bytes[7]=Math.round(Math.max(0,Math.min(1,frame.strength??.3))*255);
  v.setUint16(8,Math.min(150,Math.max(0,frame.durationMs??40)),true);
 }return bytes;
}
