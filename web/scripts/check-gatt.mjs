import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {Assembly,fragments,decodeInput,encodeOutput} from '../controller/gatt-codec.js';
import {GattGamepad} from '../controller/gatt-client.js';
const temporary=mkdtempSync(tmpdir()+'/anka-gatt-');
let bytes;
try{
 execFileSync('cc',['-std=c11','-Wall','-Wextra','-Idevice/anka-gatt-gamepad/main','device/anka-gatt-gamepad/tests/wire.c','device/anka-gatt-gamepad/main/wire.c','-o',temporary+'/wire'],{cwd:new URL('../../',import.meta.url)});
 bytes=new Uint8Array(Buffer.from(execFileSync(temporary+'/wire',{encoding:'utf8'}).trim(),'hex'));
}finally{rmSync(temporary,{recursive:true,force:true});}
const expected=decodeInput(bytes);assert.equal(expected.seq,77);assert.equal(expected.turnTotal,765);
assert.equal(expected.turn,45);assert.deepEqual(expected.pose,{id:3,q:[1,0,0,0],gain:1});assert.equal(expected.buttons.fire,true);
for(const capacity of [20,182,244]){
 const assembly=new Assembly();let received;
 for(const chunk of fragments(bytes,99,capacity))received=assembly.push(new DataView(chunk.buffer),20);
 assert.deepEqual(received,bytes);
}
assert.throws(()=>decodeInput(bytes.slice(1)));const invalid=bytes.slice();invalid[43]=3;assert.throws(()=>decodeInput(invalid));
const broken=new Assembly(),parts=fragments(bytes,3);assert.equal(broken.push(new DataView(parts[0].buffer),0),null);
assert.throws(()=>broken.push(new DataView(parts[2].buffer),1));
assert.equal(encodeOutput({type:'feedback',event:'damage',strength:.5,durationMs:100},3).length,10);
globalThis.isSecureContext=true;globalThis.document={hidden:false,addEventListener(){},removeEventListener(){}};
class Characteristic extends EventTarget{
 constructor(kind){super();this.kind=kind;this.assembly=new Assembly();}
 async startNotifications(){return this;}
 async readValue(){return new DataView(new TextEncoder().encode(JSON.stringify({pairingKey:'abcdefghijklmnop',bootId:'boot1'})).buffer);}
 async writeValueWithResponse(chunk){
  const body=this.assembly.push(new DataView(chunk.buffer,chunk.byteOffset,chunk.length));if(!body)return;
  let seq;if(this.kind==='control'){const command=JSON.parse(new TextDecoder().decode(body));seq=command.seq;commands.push(command);}else{seq=new DataView(body.buffer).getUint32(2,true);outputs.push(body);}
  queueMicrotask(()=>notify(control,new TextEncoder().encode(JSON.stringify({type:'control_ack',seq,status:'applied'}))));
 }
}
function notify(characteristic,body){for(const part of fragments(body,++packet)){Object.defineProperty(characteristic,'value',{value:new DataView(part.buffer),configurable:true});characteristic.dispatchEvent(new Event('characteristicvaluechanged'));}}
const input=new Characteristic('input'),output=new Characteristic('output'),control=new Characteristic('control'),commands=[],outputs=[],frames=[],statuses=[];
let packet=0,leaseActive=true,leases=0;
const device=new EventTarget();device.gatt={connected:false,connect:async()=>{device.gatt.connected=true;return {getPrimaryService:async()=>({getCharacteristic:async uuid=>uuid.includes('4001')?input:uuid.includes('4002')?output:control})};},disconnect(){device.gatt.connected=false;}};
Object.defineProperty(globalThis,'navigator',{value:{bluetooth:{requestDevice:async()=>device}},configurable:true});
const client=new GattGamepad({authorize:async frame=>{if(frame.type==='gatt_lease')leases++;return {deviceId:'dev1',resumeToken:'private-device-resume',leaseMs:1500,active:leaseActive};},onFrame:frame=>frames.push(frame),status:value=>statuses.push(value)});
await client.connect();assert.equal(commands[0].type,'bound');assert.equal(statuses.at(-1).connected,true);
notify(input,bytes);assert.equal(frames.at(-1).turnTotal,765);const count=frames.length;notify(input,bytes);assert.equal(frames.length,count,'duplicate input cannot execute again');
await client.feedback({type:'feedback',event:'damage',durationMs:100});assert.equal(outputs.length,1);
leaseActive=false;await client.renew();const next=bytes.slice();new DataView(next.buffer).setUint32(2,78,true);notify(input,next);assert.equal(frames.length,count,'inactive authority blocks local input');
leaseActive=true;await client.renew();client.leaseUntil=0;new DataView(next.buffer).setUint32(2,79,true);notify(input,next);assert.equal(frames.length,count,'expired authority cannot forward input');
client.leaseUntil=performance.now()+1000;client.lastSeq=0xfffffff0;new DataView(next.buffer).setUint32(2,1,true);notify(input,next);assert.equal(frames.at(-1).seq,1,'uint32 wrap accepts new frames');
assert.throws(()=>encodeOutput({type:'feedback',event:'damage',strength:NaN},9));
client.close();assert.equal(device.gatt.connected,false);assert.equal(frames.at(-1).type,'release');client.dispose();
assert.ok(leases>=2);
console.log('PASS shared C/JS wire, MTU20/182/244, malformed/partial frames, complete pose/turn, simulated characteristic adapter, bind, lease, duplicate guard, feedback acknowledgement and release.');
