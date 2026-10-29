import {axis,basis,deviceQuaternion,inverse,multiply,relative,rotate,OrientationFusion} from './pose.js';
/** Publish complete reference-relative poses, never per-packet gyro increments. */
export class MotionLook {
 constructor({onPose,aiming=()=>false,onStatus=()=>{}}){
  Object.assign(this,{onPose,aiming,onStatus,enabled:false,desired:false,sensitivity:1,adsOnly:false,epoch:0});
  this.motion=e=>this.readMotion(e);this.orientation=e=>this.readOrientation(e);this.resetReference();
 }
 resetReference(){this.reference=null;this.frame=null;this.source='';this.lastOrientation=0;this.angle=null;this.active=false;this.fusion=new OrientationFusion();}
 async start(){
  if(!globalThis.isSecureContext)throw Error('当前HTTP局域网地址不能开启体感，请用可信HTTPS地址扫码接入；触控仍可使用。');
  const requests=[globalThis.DeviceMotionEvent,globalThis.DeviceOrientationEvent]
   .filter(api=>typeof api?.requestPermission==='function').map(api=>api.requestPermission());
  if((await Promise.all(requests)).some(v=>v!=='granted'))throw Error('未获得运动与方向权限，请允许后重试。');
  this.suspend();this.resetReference();this.desired=true;this.resume();
  this.onStatus('请按游戏握姿拿好设备，正在等待方向数据');
  clearTimeout(this.timer);this.timer=setTimeout(()=>{if(!this.reference)this.onStatus('未收到方向数据，请检查浏览器传感器权限；可切换触控观察。');},3000);
 }
 accept(q,up,source){
  const angle=screen.orientation?.angle??globalThis.orientation??0;
  if(this.angle!==angle){this.angle=angle;this.reference=null;}
  const active=!this.adsOnly||this.aiming();
  if(!active){this.active=false;return;}
  if(!this.reference||source!==this.source||(this.adsOnly&&!this.active)){
   this.reference=q;this.frame=basis(up);this.source=source;this.epoch++;this.onStatus('体感已启用');
  }
  this.active=true;this.onPose({id:this.epoch,q:relative(this.reference,q,this.frame),gain:this.sensitivity});
 }
 readOrientation(event){
  if(!this.enabled||![event.alpha,event.beta,event.gamma].every(Number.isFinite))return;
  this.lastOrientation=performance.now();
  const angle=(screen.orientation?.angle??globalThis.orientation??0)*Math.PI/180;
  const q=multiply(deviceQuaternion(event.alpha,event.beta,event.gamma),axis(2,-angle));
  this.accept(q,rotate(inverse(q),[0,0,1]),'orientation');
 }
 readMotion(event){
  const r=event.rotationRate,a=event.accelerationIncludingGravity;
  if(!this.enabled||!r||!a||![r.alpha,r.beta,r.gamma,a.x,a.y,a.z].every(Number.isFinite))return;
  const now=performance.now(),q=this.fusion.read([r.beta,r.gamma,r.alpha],[a.x,a.y,a.z],now);
  if(!q||this.source==='orientation'||now-this.lastOrientation<350)return;
  const angle=(screen.orientation?.angle??globalThis.orientation??0)*Math.PI/180,screenRotation=axis(2,-angle);
  this.accept(multiply(q,screenRotation),rotate(inverse(screenRotation),[a.x,a.y,a.z]),'motion-fallback');
 }
 // Input release/reconnection must not change the calibrated pose reference.
 reset(){this.fusion.last=null;}
 suspend(){window.removeEventListener('devicemotion',this.motion);window.removeEventListener('deviceorientation',this.orientation);this.enabled=false;clearTimeout(this.timer);}
 resume(){if(!this.desired||this.enabled)return;this.enabled=true;this.fusion=new OrientationFusion();this.lastOrientation=0;
  window.addEventListener('devicemotion',this.motion);window.addEventListener('deviceorientation',this.orientation);}
 stop(){this.suspend();this.desired=false;this.resetReference();}
}
