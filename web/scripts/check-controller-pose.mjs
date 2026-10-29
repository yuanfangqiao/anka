import assert from 'node:assert/strict';
import {MotionLook} from '../controller/motion.js';
import {HapticFeedback} from '../controller/haptics.js';
import {axis,basis,identity,multiply,relative,OrientationFusion} from '../controller/pose.js';
globalThis.window={addEventListener(){},removeEventListener(){}};
globalThis.screen={orientation:{angle:0}};globalThis.document={hidden:false};
globalThis.isSecureContext=false;
const poses=[],statuses=[],motion=new MotionLook({onPose:p=>poses.push(p),onStatus:s=>statuses.push(s)});
await assert.rejects(()=>motion.start(),/HTTPS/);
globalThis.isSecureContext=true;let permissions=0;
globalThis.DeviceMotionEvent=globalThis.DeviceOrientationEvent={requestPermission:async()=>{permissions++;return 'granted';}};
await motion.start();assert.equal(permissions,2);
for(const alpha of [0,30,180,359,0])motion.readOrientation({alpha,beta:60,gamma:0});
assert.ok(Math.abs(poses.at(-1).q[0])>.999999,'returning to initial orientation must restore pose');
assert.ok(Math.abs(poses[1].q[2])>.1,'yaw must reach JSON pose');
const epoch=poses.at(-1).id;
// A low-frequency/stationary orientation stream must not be replaced by fallback and re-zeroed.
motion.lastOrientation=-10000;motion.readMotion({rotationRate:{alpha:0,beta:0,gamma:0},accelerationIncludingGravity:{x:0,y:1,z:0}});
assert.equal(poses.at(-1).id,epoch);motion.reset();motion.readOrientation({alpha:30,beta:60,gamma:0});assert.equal(poses.at(-1).id,epoch,'release must preserve reference');
screen.orientation.angle=90;motion.readOrientation({alpha:30,beta:60,gamma:0});assert.ok(poses.at(-1).id>epoch);
motion.stop();
for(const up of [[0,1,0],[1,0,0],[0,0,1],[0,0,-1]]){
 const frame=basis(up),ref=multiply(axis(0,.3),axis(1,.4));
 assert.ok(Math.abs(relative(ref,ref,frame)[0])>.999999);
 const fusion=new OrientationFusion();fusion.read([0,0,0],up,0);
 for(let i=1;i<=800;i++)fusion.read(up.map(v=>v*90),up,i*5);
 assert.ok(Math.abs(fusion.q[0])>.99999);
}
let values=[];Object.defineProperty(globalThis,'navigator',{value:{vibrate:v=>{values.push(v);return true;}},configurable:true});
const h=new HapticFeedback();assert.ok(h.play({durationMs:80}));assert.deepEqual(values,[80]);
document.hidden=true;assert.equal(h.play({durationMs:80}),false);document.hidden=false;
Object.defineProperty(globalThis,'navigator',{value:{},configurable:true});
const unsupported=new HapticFeedback({onStatus:s=>statuses.push(s)});assert.equal(unsupported.play({}),false);assert.match(statuses.at(-1),/未开放网页震动/);
console.log('PASS secure-context permission, absolute phone pose round trips, release reference, screen rotation, six-axis fallback and haptic capability detection');
