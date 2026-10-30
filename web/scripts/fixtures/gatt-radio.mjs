/** Software radio double for game integration; never reported as physical BLE. */
export function installRadio(){
 const serviceId='9f924000-6db5-4e64-a7c3-31891b2a0000';
 const state={move:[0,0],turn:0,q:[1,0,0,0],buttons:0,outputs:[],seq:0,packet:0,id:'',token:'',hidden:false};
 const device=new EventTarget();let input,control,output,timer;
 const emit=(characteristic,bytes)=>{const b=new Uint8Array(bytes.length+8),v=new DataView(b.buffer);b[0]=0xa7;b[1]=1;v.setUint16(2,++state.packet,true);v.setUint16(6,bytes.length,true);b.set(bytes,8);Object.defineProperty(characteristic,'value',{configurable:true,value:new DataView(b.buffer)});characteristic.dispatchEvent(new Event('characteristicvaluechanged'));};
 class Characteristic extends EventTarget{
  constructor(kind){super();this.kind=kind;}
  async startNotifications(){return this;}
  async readValue(){return new DataView(new TextEncoder().encode(JSON.stringify({type:'pairing',bootId:'0123456789abcdef',pairingKey:state.id?'':'0123456789abcdef0123456789abcdef',deviceId:state.id})).buffer);}
  async writeValueWithResponse(chunk){
   const v=new DataView(chunk.buffer,chunk.byteOffset,chunk.byteLength),offset=v.getUint16(4,true),total=v.getUint16(6,true);
   if(!offset)this.bytes=new Uint8Array(total);this.bytes.set(chunk.subarray(8),offset);if(offset+chunk.length-8!==total)return;
   let seq;
   if(this.kind==='control'){const value=JSON.parse(new TextDecoder().decode(this.bytes));seq=value.seq;
    if(value.type==='bound'){state.id=value.deviceId;state.token=value.resumeToken;}
    if(value.type==='revoke')state.revoked=true;
   }else{state.outputs.push(Array.from(this.bytes));seq=new DataView(this.bytes.buffer).getUint32(2,true);}
   queueMicrotask(()=>emit(control,new TextEncoder().encode(JSON.stringify({type:'control_ack',seq,status:'applied'}))));
  }
 }
 const snapshot=()=>{if(!device.gatt.connected||!state.id||state.revoked)return;const b=new Uint8Array(44),v=new DataView(b.buffer);b[0]=1;b[1]=1;v.setUint32(2,++state.seq,true);v.setFloat32(6,state.move[0],true);v.setFloat32(10,state.move[1],true);v.setFloat64(14,state.turn,true);v.setUint32(22,1,true);state.q.forEach((x,i)=>v.setFloat32(26+i*4,x,true));b[42]=state.buttons;b[43]=1;emit(input,b);};
 device.gatt={connected:false,async connect(){this.connected=true;input=new Characteristic('input');control=new Characteristic('control');output=new Characteristic('output');clearInterval(timer);timer=setInterval(snapshot,17);return {getPrimaryService:async()=>({getCharacteristic:async uuid=>uuid===serviceId.replace('4000','4001')?input:uuid===serviceId.replace('4000','4002')?output:control})};},disconnect(){this.connected=false;clearInterval(timer);}};
 Object.defineProperty(navigator,'bluetooth',{configurable:true,value:{requestDevice:async()=>device}});
 window.__gattRadio={state,drop(){device.gatt.disconnect();device.dispatchEvent(new Event('gattserverdisconnected'));},action(index){emit(input,new Uint8Array([1,2,...new Uint8Array(new Uint32Array([++state.seq]).buffer),index]));}};
}
