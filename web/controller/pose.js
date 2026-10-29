export const identity=()=>[1,0,0,0];
export const inverse=([w,x,y,z])=>[w,-x,-y,-z];
export function unit(q){const n=Math.hypot(...q);return n>1e-9?q.map(v=>v/n):identity();}
export function multiply([a,b,c,d],[w,x,y,z]){
 return [a*w-b*x-c*y-d*z,a*x+b*w+c*z-d*y,a*y-b*z+c*w+d*x,a*z+b*y-c*x+d*w];
}
export function rotate(q,v){return multiply(multiply(q,[0,...v]),inverse(q)).slice(1);}
export function axis(index,radians){const q=identity();q[0]=Math.cos(radians/2);q[index+1]=Math.sin(radians/2);return q;}
export function basis(gravity){
 const n=Math.hypot(...gravity),u=n>.1?gravity.map(v=>v/n):[0,1,0],p=Math.hypot(u[0],u[1]);
 let r=p>.15?[u[1]/p,-u[0]/p,0]:[1-u[0]*u[0],-u[0]*u[1],-u[0]*u[2]];
 const length=Math.hypot(...r);r=r.map(v=>v/length);
 const f=[r[1]*u[2]-r[2]*u[1],r[2]*u[0]-r[0]*u[2],r[0]*u[1]-r[1]*u[0]];
 const m=[[r[0],u[0],f[0]],[r[1],u[1],f[1]],[r[2],u[2],f[2]]],q=identity(),trace=m[0][0]+m[1][1]+m[2][2];
 if(trace>0){const s=Math.sqrt(trace+1)*2;q[0]=s/4;q[1]=(m[2][1]-m[1][2])/s;q[2]=(m[0][2]-m[2][0])/s;q[3]=(m[1][0]-m[0][1])/s;}
 else{
  let i=m[1][1]>m[0][0]?1:0;if(m[2][2]>m[i][i])i=2;const j=(i+1)%3,k=(i+2)%3,s=Math.sqrt(1+m[i][i]-m[j][j]-m[k][k])*2;
  q[0]=(m[k][j]-m[j][k])/s;q[i+1]=s/4;q[j+1]=(m[i][j]+m[j][i])/s;q[k+1]=(m[i][k]+m[k][i])/s;
 }
 return unit(q);
}
export function relative(reference,current,frame){return unit(multiply(multiply(inverse(frame),multiply(inverse(reference),current)),frame));}
export function deviceQuaternion(alpha,beta,gamma){
 const rad=Math.PI/180;return unit(multiply(multiply(axis(2,alpha*rad),axis(0,beta*rad)),axis(1,gamma*rad)));
}
/** Six-axis fallback. Heading is relative; accelerometer corrects inclination only. */
export class OrientationFusion{
 constructor(){this.q=identity();this.last=null;this.gravity=null;}
 read(gyro,accel,now){
  const n=Math.hypot(...accel);if(!this.gravity){if(n<.1)return null;this.gravity=accel.map(v=>v/n);this.last=now;return this.q;}
  const dt=(now-this.last)/1000;this.last=now;if(dt<=0||dt>.1)return this.q;
  const rate=gyro.map(v=>v*Math.PI/180);
  if((n>7.8&&n<11.8)||(n>.8&&n<1.2)){
   const a=accel.map(v=>v/n),p=rotate(inverse(this.q),this.gravity);
   const e=[a[1]*p[2]-a[2]*p[1],a[2]*p[0]-a[0]*p[2],a[0]*p[1]-a[1]*p[0]];
   for(let i=0;i<3;i++)rate[i]+=1.5*e[i];
  }
  const speed=Math.hypot(...rate);if(speed>1e-8){const h=speed*dt/2,s=Math.sin(h)/speed;this.q=unit(multiply(this.q,[Math.cos(h),...rate.map(v=>v*s)]));}
  return this.q;
 }
}
