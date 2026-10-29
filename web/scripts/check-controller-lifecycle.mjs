import assert from 'node:assert/strict';
import {ControllerLink} from '../controller/link.js';
import {ScreenLock} from '../controller/screen-lock.js';

globalThis.location={origin:'https://anka.example',host:'anka.example',protocol:'https:'};
globalThis.document={hidden:false,addEventListener(){},removeEventListener(){}};
const timers=new Set();let next=0;
globalThis.setInterval=()=>{const id=++next;timers.add(id);return id;};
globalThis.clearInterval=id=>timers.delete(id);
class Socket {
  static OPEN=1;
  constructor(url){this.url=String(url);this.readyState=1;this.bufferedAmount=0;this.frames=[];Socket.latest=this;}
  send(frame){this.frames.push(JSON.parse(frame));}
  close(){this.readyState=3;}
  bound(){this.onmessage({data:JSON.stringify({type:'bound',deviceId:'dev-test',resumeToken:'private-resume'})});}
}
globalThis.WebSocket=Socket;
const states=[],link=new ControllerLink({status:(online,text)=>states.push({online,text})});
link.connect('https://anka.example/v1/device/join?bindKey=test&token=test');Socket.latest.bound();
assert.equal(link.online,true);link.held('fire',true);
link.connect('https://user:password@anka.example/v1/device/join');
assert.equal(link.online,true);assert.equal(states.at(-1).online,true,'invalid pasted URL must not misreport an existing connection');
const old=Socket.latest;link.close();assert.equal(timers.size,0);
link.resume();assert.equal(timers.size,2);assert.match(Socket.latest.url,/\/v1\/device\/reconnect/);
assert.equal(link.controls.buttons.fire,false);Socket.latest.bound();assert.equal(link.online,true);
old.onclose();assert.equal(link.online,true,'old socket closure cannot stop a restored page');
link.close();link.connect('ws://anka.example/v1/device/join');
assert.match(states.at(-1).text,/WSS/);link.close();

// Recoverable protocol/network errors retain the device credential and pose.
link.connect('https://anka.example/v1/device/join?bindKey=test&token=test');Socket.latest.bound();
link.pose({id:1,q:[1,0,0,0],gain:1});link.turnBy(90);link.input();
assert.equal(Socket.latest.frames.at(-1).turn,90);
assert.equal(Socket.latest.frames.at(-1).turnTotal,90);
link.turnBy(0);assert.equal(link.turnDirty,false,'unchanged angle does not schedule another turn update');
const settledCount=Socket.latest.frames.length;link.tick();
assert.equal(Socket.latest.frames.length,settledCount,'stationary turn waits for the normal keepalive instead of spamming input');
link.reset();assert.equal(link.turn,90,'input release preserves completed rotation');
link.turnBy(450);link.input();
assert.equal(Socket.latest.frames.at(-1).turn,-180);
assert.equal(Socket.latest.frames.at(-1).turnTotal,540,'fast swipes keep full turns instead of aliasing to the opposite direction');
link.reset();assert.equal(link.turnTotal,540,'release preserves complete turn total');
assert.equal(Socket.latest.frames.at(-1).pose.id,1);
Socket.latest.onmessage({data:JSON.stringify({type:'error',code:'invalid_message'})});
assert.ok(link.session);assert.equal(link.stopped,false);
link.reset();assert.equal(link.currentPose.id,1);
Socket.latest.onmessage({data:JSON.stringify({type:'closed',code:'binding_revoked'})});
assert.equal(link.session,null);assert.equal(link.stopped,true);link.close();

// A long outage exceeds the former eight-attempt cap, without losing the session.
const nativeTimeout=setTimeout,nativeClear=clearTimeout;let retryCallback;
globalThis.setTimeout=callback=>{retryCallback=callback;return 1;};globalThis.clearTimeout=()=>{};
link.connect('https://anka.example/v1/device/join?bindKey=test&token=test');Socket.latest.bound();
for(let attempt=0;attempt<12;attempt++){
 Socket.latest.readyState=3;Socket.latest.onclose();assert.ok(link.session);assert.ok(retryCallback);retryCallback();
}
assert.ok(link.session);Socket.latest.bound();assert.equal(link.online,true);link.close();
globalThis.setTimeout=nativeTimeout;globalThis.clearTimeout=nativeClear;

let requested=0,resolveWake,released=0;
Object.defineProperty(globalThis,'navigator',{value:{wakeLock:{request:()=>{requested++;return new Promise(resolve=>{resolveWake=resolve;});}}},configurable:true});
const lock=new ScreenLock();lock.set(true);lock.acquire();
assert.equal(requested,1,'concurrent visibility/status changes must share one pending request');
lock.set(false);resolveWake({release:async()=>{released++;},addEventListener(){}});
await new Promise(resolve=>setImmediate(resolve));assert.equal(released,1);assert.equal(lock.lock,null);
lock.close();assert.equal(timers.size,0);
console.log('PASS cached-page reconnect, neutral recovery, stale callbacks, TLS URL validation, and wake-lock lifecycle');
