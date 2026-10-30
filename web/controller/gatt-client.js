import {SERVICE,INPUT,OUTPUT,CONTROL,Assembly,fragments,decodeInput,encodeOutput} from './gatt-codec.js';
const terminal=new Set(['binding_revoked','game_unavailable','invalid_token','pair_expired','pair_used','player_already_bound','wrong_principal']);
const pairingError=message=>Object.assign(Error(message),{fatal:true});
/** BLE data plane; authorize() uses the current player's authenticated control socket. */
export class GattGamepad{
 constructor({authorize,onFrame,status=()=>{},active=()=>true,debug=()=>{}}){
  Object.assign(this,{authorize,onFrame,status,active,debug,epoch:0,seq:0,packet:0,closed:true,leaseUntil:0,lastInput:0,queue:Promise.resolve(),acks:new Map()});
  this.visibility=()=>{if(document.hidden){this.onFrame({type:'release'});this.leaseUntil=0;}this.renew().catch(()=>{});};
  document.addEventListener('visibilitychange',this.visibility);
 }
 static supported(){return !!globalThis.isSecureContext&&!!navigator.bluetooth?.requestDevice;}
 async connect(){
  if(!GattGamepad.supported())throw Error('蓝牙直连需要电脑Chrome/Edge及可信HTTPS或localhost');
  // requestDevice is called before the first await, preserving user activation.
  const selected=navigator.bluetooth.requestDevice({filters:[{services:[SERVICE]}]});
  this.close();this.closed=false;const epoch=++this.epoch;
  this.device=await selected;if(epoch!==this.epoch)return;
  this.disconnected=()=>this.lost();this.device.addEventListener('gattserverdisconnected',this.disconnected);
  try{await this.attach(epoch);}catch(error){this.failed(error);throw error;}
 }
 async attach(epoch){
  this.status({connected:false,message:'正在连接蓝牙手柄…'});
  const server=await this.device.gatt.connect(),service=await server.getPrimaryService(SERVICE);
  if(epoch!==this.epoch)return;
  this.input=await service.getCharacteristic(INPUT);this.output=await service.getCharacteristic(OUTPUT);this.control=await service.getCharacteristic(CONTROL);
  const inputAssembly=new Assembly(),controlAssembly=new Assembly();this.lastSeq=0;
  this.inputListener=e=>{try{
   const bytes=inputAssembly.push(e.target.value);if(!bytes)return;
   const frame=decodeInput(bytes);if(this.lastSeq&&((frame.seq-this.lastSeq)>>>0)>=0x80000000||frame.seq===this.lastSeq)return;this.lastSeq=frame.seq;
   if(performance.now()-(this.lastDebug||0)>100){this.lastDebug=performance.now();this.debug({direction:'←',frame});}
   if(this.authorized()&&this.leaseActive&&this.active()&&!document.hidden){this.lastInput=performance.now();this.onFrame(frame);}
  }catch(error){this.onFrame({type:'release'});this.status({connected:false,message:error.message});}};
  this.controlListener=e=>{try{
   const bytes=controlAssembly.push(e.target.value);if(!bytes)return;
   const frame=JSON.parse(new TextDecoder().decode(bytes));
   if(frame.type==='control_ack'){const ack=this.acks.get(frame.seq);if(ack){this.acks.delete(frame.seq);clearTimeout(ack.timer);frame.status==='applied'?ack.resolve(frame):ack.reject(Error('设备拒绝控制命令'));}}
  }catch{this.onFrame({type:'release'});}};
  this.input.addEventListener('characteristicvaluechanged',this.inputListener);this.control.addEventListener('characteristicvaluechanged',this.controlListener);
  await this.input.startNotifications();await this.control.startNotifications();
  let info;
  for(let i=0;i<120&&epoch===this.epoch;i++){
   info=JSON.parse(new TextDecoder().decode(await this.control.readValue()));
   if(info.pairingKey||info.url||info.deviceId)break;
   await new Promise(resolve=>setTimeout(resolve,500));
  }
  if(epoch!==this.epoch)return;
  if(!info?.pairingKey&&!info?.url&&!info?.deviceId)throw Error('设备未就绪，请重新打开蓝牙手柄应用');
  if(info.deviceId&&!this.session)throw pairingError('设备已绑定，请回原页面重连或重启手柄应用');
  const url=info.url?new URL(info.url):null;
  if(url&&(!['http:','https:','ws:','wss:'].includes(url.protocol)||url.username||url.password||url.hash||url.pathname!=='/v1/device/join'))throw Error('设备二维码无效');
  // The QR may advertise a LAN origin while the host uses localhost. Backend checks the exact receiver.
  if(this.session&&this.session.bootId!==info.bootId)throw pairingError('设备已重启，请解除原绑定再连接');
  const request=this.session?{type:'gatt_resume',deviceId:this.session.deviceId,token:this.session.token}:
   info.pairingKey?{type:'gatt_bind'}:{type:'gatt_bind',bindKey:url.searchParams.get('bindKey'),token:url.searchParams.get('token')};
  const reply=await this.authorize(request);if(epoch!==this.epoch)return;
  this.session={deviceId:reply.deviceId,token:reply.resumeToken||this.session?.token,bootId:info.bootId};
  this.leaseUntil=performance.now()+reply.leaseMs;this.leaseActive=reply.active;
  await this.command({type:info.deviceId===this.session.deviceId?'lease':'bound',token:info.pairingKey||url?.searchParams.get('token'),resumeToken:this.session.token,deviceId:this.session.deviceId,leaseMs:reply.leaseMs,active:reply.active});
  if(epoch!==this.epoch||this.closed)return;
  this.boundBoot=info.bootId;
  this.status({connected:true,deviceId:reply.deviceId,transport:'gatt',message:'蓝牙已绑定，请完成设备A+B握姿校准'});
  clearInterval(this.timer);this.timer=setInterval(()=>this.renew().catch(error=>this.failLease(error)),500);
  this.retries=0;
 }
 authorized(){return !this.closed&&this.device?.gatt.connected&&performance.now()<this.leaseUntil;}
 async renew(){
  if(this.closed||!this.session||!this.device?.gatt.connected||this.renewing)return;
  this.renewing=true;const epoch=this.epoch;
  try{
   let reply;
   try{reply=await this.authorize({type:'gatt_lease'});}catch(error){
    if(!['wrong_principal','invalid_token'].includes(error.code))throw error;
    reply=await this.authorize({type:'gatt_resume',deviceId:this.session.deviceId,token:this.session.token});
   }
   if(epoch!==this.epoch||this.closed)return;
   this.leaseUntil=performance.now()+reply.leaseMs;this.leaseActive=reply.active;
   await this.command({type:'lease',resumeToken:this.session.token,leaseMs:reply.leaseMs,active:reply.active&&this.active()&&!document.hidden});
  }finally{this.renewing=false;}
 }
 failLease(error){this.leaseUntil=0;this.onFrame({type:'release'});if(terminal.has(error.code)||error.fatal)this.close();this.status({connected:false,message:error.message});}
 failed(error){if(terminal.has(error.code)||error.fatal){this.close();this.status({connected:false,message:error.message});}else this.lost();}
 write(characteristic,bytes){
  const epoch=this.epoch,id=++this.packet;
  this.queue=this.queue.catch(()=>{}).then(async()=>{
   if(epoch!==this.epoch||!this.device?.gatt.connected)throw Error('蓝牙已断开');
   for(const chunk of fragments(bytes,id)){if(epoch!==this.epoch)throw Error('蓝牙连接已更换');await characteristic.writeValueWithResponse(chunk);}
  });return this.queue;
 }
 command(value){
  const seq=++this.seq,bytes=new TextEncoder().encode(JSON.stringify({...value,seq}));
  return this.acknowledged(seq,()=>this.write(this.control,bytes));
 }
 acknowledged(seq,write){
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{this.acks.delete(seq);reject(Error('蓝牙命令确认超时'));},2000);
   this.acks.set(seq,{resolve,reject,timer});write().catch(error=>{clearTimeout(timer);this.acks.delete(seq);reject(error);});
  });
 }
 feedback(frame){
  if(!this.authorized())return Promise.resolve();
  this.debug({direction:'→',frame});
  const seq=++this.seq;return this.acknowledged(seq,()=>this.write(this.output,encodeOutput(frame,seq)));
 }
 lost(){
  if(this.closed)return;
  this.leaseUntil=0;clearInterval(this.timer);this.onFrame({type:'release'});this.cleanupCharacteristics();
  for(const ack of this.acks.values()){clearTimeout(ack.timer);ack.reject(Error('蓝牙已断开'));}this.acks.clear();
  this.authorize({type:'gatt_detach'}).catch(()=>{});
  this.status({connected:false,message:'蓝牙断开，正在重连'});
  if(!this.closed){clearTimeout(this.retry);const epoch=this.epoch;
   this.retry=setTimeout(()=>this.attach(epoch).catch(error=>this.failed(error)),Math.min(5000,400*2**Math.min(4,this.retries=(this.retries||0)+1)));}
 }
 cleanupCharacteristics(){
  this.input?.removeEventListener('characteristicvaluechanged',this.inputListener);
  this.control?.removeEventListener('characteristicvaluechanged',this.controlListener);
 }
 async revoke(message='设备授权已解除'){
  this.leaseUntil=0;this.onFrame({type:'release'});
  if(this.device?.gatt.connected&&this.control&&this.session)await this.command({type:'revoke',resumeToken:this.session.token}).catch(()=>{});
  this.close();this.session=null;this.boundBoot=null;this.status({connected:false,deviceId:'',message});
 }
 close(){
  this.closed=true;this.epoch++;clearInterval(this.timer);clearTimeout(this.retry);this.leaseUntil=0;
  this.onFrame({type:'release'});this.cleanupCharacteristics();
  if(this.device){this.device.removeEventListener('gattserverdisconnected',this.disconnected);this.device.gatt.disconnect();}
  for(const ack of this.acks.values()){clearTimeout(ack.timer);ack.reject(Error('蓝牙已关闭'));}this.acks.clear();
 }
 dispose(){this.close();document.removeEventListener('visibilitychange',this.visibility);}
}
