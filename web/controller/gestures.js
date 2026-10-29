/** The initial tile owns the whole gesture: center moves, top row turns. */
export class GesturePad {
  constructor({onMove,onAction,onTurn=()=>{},onDrag=()=>{},threshold=8,radius=90,cellWidth=120}) {
    Object.assign(this,{onMove,onAction,onTurn,onDrag,threshold,radius,cellWidth});
    this.points=new Map();this.owner=null;
  }
  down(id,x,y,action,now) {
    if(this.owner!==null)return;
    this.owner=id;
    this.points.set(id,{x,y,action,started:now,distance:0,vertical:0,dragging:false,angle:0,anchor:0,direction:1,active:false,blocked:false});
  }
  move(id,x,y) {
    const p=this.points.get(id);if(!p||this.owner!==id)return;
    const dx=x-p.x,dy=y-p.y;
    p.distance=Math.max(p.distance,Math.hypot(dx,dy));p.vertical=Math.max(p.vertical,Math.abs(dy));
    if(p.distance>=this.threshold)p.dragging=true;
    if(!p.dragging)return;
    if(p.action==='jump'){
      const scale=Math.max(this.radius,Math.hypot(dx,dy));
      this.onMove({x:dx/scale,y:-dy/scale});
      this.onDrag({kind:'move',x:p.x,y:p.y,dx:dx/scale,dy:dy/scale});return;
    }
    if(['reload','next_weapon','grenade'].includes(p.action)){
      if(p.vertical>this.cellWidth*.5)p.blocked=true;
      if(!p.blocked){
        const gate=this.cellWidth*.5;
        if(!p.active&&Math.abs(dx)>gate){p.active=true;p.anchor=Math.sign(dx)*gate;}
        const angle=p.active?(dx-p.anchor)*180/this.cellWidth:0,delta=angle-p.angle;
        p.direction=delta?Math.sign(delta):p.active?p.direction:dx<0?-1:1;
        this.onTurn(delta);p.angle=angle;
        this.onDrag({kind:'turn',x:p.x,y:p.y,currentX:x,currentY:y,dx,gateX:p.x+(p.active?p.anchor:Math.sign(dx)*gate),progress:p.active?1:Math.min(1,Math.abs(dx)/gate),active:p.active,sign:p.direction});return;
      }
    }
    this.onDrag({kind:'blocked'});
  }
  up(id,x,y,action,now) {
    const p=this.points.get(id);if(!p)return;
    this.move(id,x,y);
    if(!p.dragging&&p.distance<this.threshold&&now-p.started<=350&&action===p.action)this.onAction(p.action);
    this.cancel(id);
  }
  cancel(id) {
    if(this.owner!==id)return;
    this.owner=null;this.onMove({x:0,y:0});this.onDrag(null);this.points.delete(id);
  }
  reset(){this.points.clear();this.owner=null;this.onMove({x:0,y:0});this.onDrag(null);}
}
