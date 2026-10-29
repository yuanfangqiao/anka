/** A half-cell activation gate, followed by continuous finger-follow rotation. */
export class TurnGuide {
 constructor(pad){
  this.pad=pad;this.svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  this.svg.classList.add('turn-guide');this.svg.setAttribute('aria-hidden','true');
  this.svg.innerHTML='<path class="gate"/><path class="travel"/><path class="tick"/><circle r="15"/><path class="arrow"/>';
  pad.append(this.svg);this.hide();
 }
 hide(){this.svg.style.display='none';this.pad.classList.remove('turning');}
 show(value,cell){
  const rect=this.pad.getBoundingClientRect(),x=value.x-rect.left,y=value.y-rect.top,cx=value.currentX-rect.left,cy=value.currentY-rect.top;
  const end=(value.gateX??value.x+value.sign*cell*.5)-rect.left;
  this.svg.style.display='block';this.svg.setAttribute('viewBox',`0 0 ${rect.width} ${rect.height}`);
  this.svg.classList.toggle('active',value.active);this.pad.classList.add('turning');
  const paths=this.svg.querySelectorAll('path');
  paths[0].setAttribute('d',`M${x},${y}H${end}`);paths[1].setAttribute('d',`M${x},${y}L${cx},${cy}`);
  paths[2].setAttribute('d',`M${end},${y-13}V${y+13}`);
  const circle=this.svg.querySelector('circle');circle.setAttribute('cx',cx);circle.setAttribute('cy',cy);
  const sign=value.sign;
  paths[3].setAttribute('d',`M${cx-8*sign},${cy+3}A9,9 0 1,${sign>0?1:0} ${cx+8*sign},${cy-2}m${-5*sign},-3l${5*sign},3l${-4*sign},4`);
 }
}
