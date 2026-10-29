/** Capabilities stay explicit: iOS Safari has no general Vibration API. */
export class HapticFeedback{
 constructor({onStatus=()=>{}}={}){this.onStatus=onStatus;this.enabled=true;this.supported=typeof navigator.vibrate==='function';this.report();}
 report(){this.onStatus(this.supported?'此浏览器支持震动，首次触控后可接收命中反馈':'此浏览器未开放网页震动；命中会用灯光闪烁提示');}
 play(frame){
  if(!this.enabled||!this.supported||document.hidden)return false;
  const duration=Math.min(150,Math.max(0,frame.durationMs??40));
  if(duration<=0||frame.strength===0)return false;
  try{const ok=navigator.vibrate(frame.event==='death'?[duration,40,duration]:duration);if(!ok)this.onStatus('浏览器尚未允许震动，请先点击手柄后重试');return !!ok;}
  catch{this.onStatus('当前浏览器阻止了网页震动');return false;}
 }
}
