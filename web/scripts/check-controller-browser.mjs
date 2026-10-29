/** Real Anka + game + anonymous mobile controller. No mocked WS transport. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.ANKA_PLAYWRIGHT_MODULE||'playwright');
const base=process.env.ANKA_CONTROLLER_QA_URL||'http://127.0.0.1:18772';
const screenshots=new URL('../../.screenshots/controller/',import.meta.url).pathname;
await mkdir(screenshots,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome',args:[
 '--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader',
 '--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
const errors=[],frames=[],sentActions=[],sentPoses=[],sensors=process.env.ANKA_CONTROLLER_SENSOR_QA==='1';
let host,phone,receiverRuntime;
function engineInPage(){
 const app=document.querySelector('#app').__vue_app__,seen=new Set();
 function find(v){if(!v||typeof v!=='object'||seen.has(v))return null;seen.add(v);
  if(v.component?.props?.game)return v.component.props.game;
  let found=find(v.component?.subTree);if(found)return found;
  if(Array.isArray(v.children))for(const child of v.children){found=find(child);if(found)return found;}
  return null;
 }
 const g=find(app._container._vnode);if(!g)throw Error('Game instance missing from controller component');
 window.__controllerQAGame=g;
 return {p:g.player.group.position.toArray(),yaw:g.lookYaw,ammo:g.state.ammo,phase:g.state.phase};
}
try{
 const owner=await browser.newContext({viewport:{width:1440,height:900}});
 const device=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await owner.addInitScript(()=>localStorage.setItem('anka-desert-strike-settings-v1',JSON.stringify({quality:'low',muted:true,perspective:'first'})));
 if(sensors)await device.addInitScript(()=>{window.__haptics=[];navigator.vibrate=value=>{window.__haptics.push(value);return true;};});
 const login=await owner.request.post(base+'/api/auth/login',{data:{username:'controller-qa',password:'controller-local-only'}});
 assert.equal(login.status(),200,await login.text());
 host=await owner.newPage();phone=await device.newPage();
 host.on('console',msg=>{if(msg.type()==='error'||msg.type()==='warning')console.error('host console',msg.text().slice(0,600));});
 host.on('response',r=>{if(r.url().includes('/api/devices/'))console.error('device API',r.status());});
 host.on('websocket',ws=>{if(ws.url().includes('/api/devices/'))receiverRuntime=new URL(ws.url()).searchParams.get('runtime');if(ws.url().includes('/api/devices/'))ws.on('framereceived',e=>{try{const f=JSON.parse(e.payload);if(['error','closed'].includes(f.type))console.error('receiver',f.code,f.message);}catch{}});});
 for(const page of [host,phone])page.on('pageerror',e=>errors.push(e.message));
 phone.on('websocket',ws=>ws.on('framesent',e=>{try{const f=JSON.parse(String(e.payload));if(f.pose)sentPoses.push(f.pose);if(f.type==='action')sentActions.push(f.action);}catch{}}));
 phone.on('websocket',ws=>ws.on('framereceived',e=>{try{const f=JSON.parse(String(e.payload));delete f.resumeToken;frames.push(f);}catch{}}));
 await host.goto(base+'/play/anka-outpost-strike');
 await host.getByRole('button',{name:'选择模式：主线闯关',exact:true}).click({timeout:45000});
 await host.getByRole('button',{name:'开始任务',exact:true}).click();
 await host.locator('.battle-hud').waitFor();
 await host.evaluate(engineInPage);
 await host.evaluate(()=>{window.__controllerQAGame.invulnerable=100;});
 await host.getByRole('button',{name:'手柄设备接入',exact:true}).click();
 await host.locator('.controller-qr').waitFor();
 const wsUrl=await host.getByLabel('手柄WebSocket地址').inputValue();
 assert.ok(wsUrl.includes('/v1/device/join?bindKey='));
 const phoneUrl=new URL(wsUrl.replace(/^ws/,'http'));if(sensors)phoneUrl.hostname='127.0.0.1';
 await phone.goto(phoneUrl.href);
 await phone.locator('#controller.online').waitFor();
 if(await phone.locator('#setup[open]').count())await phone.getByRole('button',{name:'返回手柄',exact:true}).click();
 await host.locator('.controller-overlay').waitFor({state:'hidden'});
 await host.waitForTimeout(1200);
 const initial=await host.evaluate(engineInPage);
 await host.evaluate(()=>{window.__controllerQAGame.invulnerable=100;});
 assert.equal(initial.phase,'playing');
 assert.equal(await phone.locator('.function').count(),9);
 assert.equal(await phone.locator('[data-held]').count(),2);
 const text=await phone.locator('#controller').innerText();
 for(const forbidden of ['ANKA','前线对决','已连接','生命','弹药'])assert.ok(!text.includes(forbidden),forbidden);
 const color=await phone.locator('.jump').evaluate(e=>getComputedStyle(e).borderTopColor);
 assert.equal(color,'rgb(115, 255, 131)');
 assert.ok(!new URL(phone.url()).searchParams.has('token'),'credentials removed from address bar');
 await phone.screenshot({path:screenshots+'2026-10-28-mobile-connected.png'});
 await host.screenshot({path:screenshots+'2026-10-28-game-controller.png'});
 // Only a center-origin drag moves; the original function taps stay intact.
 const tile=await phone.locator('[data-action=jump]').boundingBox();
 const before=await host.evaluate(()=>({p:window.__controllerQAGame.player.group.position.toArray(),grenades:window.__controllerQAGame.state.grenades}));
 await phone.mouse.move(tile.x+tile.width/2,tile.y+tile.height/2);
 await phone.mouse.down();await phone.mouse.move(tile.x+tile.width/2-55,tile.y+tile.height/2-45,{steps:8});
 await phone.waitForTimeout(700);await phone.mouse.up();await phone.waitForTimeout(80);
 const after=await host.evaluate(()=>({p:window.__controllerQAGame.player.group.position.toArray(),grenades:window.__controllerQAGame.state.grenades}));
 assert.ok(Math.hypot(after.p[0]-before.p[0],after.p[2]-before.p[2])>.1,'real game must move');
 assert.equal(after.grenades,before.grenades,'drag must not click grenade');
 const stopped=after.p;await phone.waitForTimeout(250);
 const settled=await host.evaluate(()=>window.__controllerQAGame.player.group.position.toArray());
 assert.ok(Math.hypot(settled[0]-stopped[0],settled[2]-stopped[2])<.15,'release stops movement');
 // Half a cell activates once; one further cell is 180 degrees, including reversals.
 const top=await phone.locator('[data-action=reload]').boundingBox(),next=await phone.locator('[data-action=next_weapon]').boundingBox();
 const stride=next.x-top.x,tx=top.x+top.width/2,ty=top.y+top.height/2;
 const heading=await host.evaluate(()=>window.__controllerQAGame.lookYaw),actionCount=sentActions.length;
 await phone.mouse.move(tx,ty);await phone.mouse.down();await phone.mouse.move(tx+stride*.4,ty,{steps:8});await phone.mouse.up();await phone.waitForTimeout(150);
 assert.ok(Math.abs(await host.evaluate(()=>window.__controllerQAGame.lookYaw)-heading)<.01,'less than half a cell does not turn');
 await phone.mouse.move(tx,ty);await phone.mouse.down();await phone.mouse.move(tx+stride*1.5,ty,{steps:12});
 await host.waitForFunction(target=>Math.abs(window.__controllerQAGame.lookYaw-target)<.02,heading-Math.PI,{timeout:5000});
 await phone.mouse.move(tx+stride*.5,ty,{steps:8});
 await host.waitForFunction(target=>Math.abs(window.__controllerQAGame.lookYaw-target)<.02,heading,{timeout:5000});
 await phone.mouse.move(tx+stride*(.5+1/3),ty,{steps:5});
 await host.waitForFunction(target=>Math.abs(window.__controllerQAGame.lookYaw-target)<.02,heading-Math.PI/3,{timeout:5000});
 await phone.mouse.move(tx+stride*(.5-1/3),ty,{steps:5});
 await host.waitForFunction(target=>Math.abs(window.__controllerQAGame.lookYaw-target)<.02,heading+Math.PI/3,{timeout:5000});
 await phone.mouse.move(tx+stride*1.5,ty,{steps:8});
 await host.waitForFunction(target=>Math.abs(window.__controllerQAGame.lookYaw-target)<.02,heading-Math.PI,{timeout:5000});
 await phone.locator('.turn-guide.active').waitFor();await phone.screenshot({path:screenshots+'2026-10-29-top-row-turn-mobile.png'});
 await phone.waitForTimeout(180);assert.ok(Math.abs(await host.evaluate(()=>window.__controllerQAGame.lookYaw)-(heading-Math.PI))<.02,'stationary finger does not keep turning');
 await phone.mouse.up();await phone.waitForTimeout(150);
 assert.ok(Math.abs(await host.evaluate(()=>window.__controllerQAGame.lookYaw)-(heading-Math.PI))<.02,'release retains body heading');
 const right=await phone.locator('[data-action=grenade]').boundingBox(),rx=right.x+right.width/2;
 await phone.mouse.move(rx,ty);await phone.mouse.down();await phone.mouse.move(rx-stride*1.5,ty,{steps:12});await phone.mouse.up();
 await host.waitForFunction(target=>Math.abs(window.__controllerQAGame.lookYaw-target)<.02,heading,{timeout:5000});
 await phone.mouse.move(tx,ty);await phone.mouse.down();await phone.mouse.move(tx+stride*2,ty);await phone.mouse.up();
 await host.waitForFunction(target=>Math.abs(window.__controllerQAGame.lookYaw-target)<.02,heading-Math.PI*1.5,{timeout:5000});
 await phone.mouse.move(rx,ty);await phone.mouse.down();await phone.mouse.move(rx-stride*2,ty);await phone.mouse.up();
 await host.waitForFunction(target=>Math.abs(window.__controllerQAGame.lookYaw-target)<.02,heading,{timeout:5000});
 assert.equal(sentActions.length,actionCount,'top row swipes cannot execute reload/weapon/grenade');
 await phone.locator('[data-action=jump]').tap();
 await phone.waitForTimeout(120);
 assert.ok(frames.some(f=>f.type==='ack'&&f.status==='applied'),'real engine returns applied action');
 if(sensors){
  await phone.locator('#settings').click();await phone.locator('#motion').click();
  const orient=alpha=>phone.evaluate(alpha=>{clearInterval(window.__orientationQA);const send=()=>window.dispatchEvent(new DeviceOrientationEvent('deviceorientation',{alpha,beta:60,gamma:0}));send();window.__orientationQA=setInterval(send,16);},alpha);
  await orient(0);await phone.waitForTimeout(150);
  const reference=await host.evaluate(()=>window.__controllerQAGame.lookYaw);
  await orient(30);await host.waitForFunction(reference=>Math.abs(window.__controllerQAGame.lookYaw-reference)>.3,reference,{timeout:5000});
  console.log('sensor-diagnostic',JSON.stringify({reference,poses:sentPoses.slice(-3),changed:sentPoses.filter(p=>Math.abs(p.q[2])>.1).length,phone:await phone.evaluate(()=>({secure:isSecureContext,notice:document.querySelector('#notice').textContent,dialog:document.querySelector('#setup').open})),game:await host.evaluate(()=>{const g=window.__controllerQAGame,i=g.deviceInput;return {yaw:g.lookYaw,pose:i.pose,anchor:i.poseView.anchor,suspended:i.suspended,armed:i.armed};})}));
  assert.ok(Math.abs(await host.evaluate(()=>window.__controllerQAGame.lookYaw)-reference)>.3,'phone orientation reaches real game');
  await phone.mouse.move(tx,ty);await phone.mouse.down();await phone.mouse.move(tx+stride*1.5,ty,{steps:10});await phone.mouse.up();
  await host.waitForFunction(target=>Math.abs(window.__controllerQAGame.lookYaw-target)<.02,reference-Math.PI/6-Math.PI,{timeout:5000});
  await orient(0);await host.waitForFunction(target=>Math.abs(window.__controllerQAGame.lookYaw-target)<.02,reference-Math.PI,{timeout:5000});
  const keepHeading=await host.evaluate(()=>window.__controllerQAGame.lookYaw);
  assert.ok(Math.abs(keepHeading-(reference-Math.PI))<.02,'gyro returning to reference keeps screen turn');
  await phone.mouse.move(rx,ty);await phone.mouse.down();await phone.mouse.move(rx-stride*1.5,ty,{steps:10});await phone.mouse.up();
  await host.waitForFunction(target=>Math.abs(window.__controllerQAGame.lookYaw-target)<.02,reference,{timeout:5000});
  await host.evaluate(()=>{window.__controllerQAGame.state.hp-=5;});await phone.waitForFunction(()=>window.__haptics.includes(100),null,{timeout:5000});
  assert.ok((await phone.evaluate(()=>window.__haptics)).includes(100),'real damage feedback calls supported browser haptics');
 }
 const ammo=await host.evaluate(()=>window.__controllerQAGame.state.ammo);
 const fire=await phone.locator('[data-held=fire]').boundingBox();
 await phone.mouse.move(fire.x+fire.width/2,fire.y+fire.height/2);await phone.mouse.down();
 await phone.waitForTimeout(350);await phone.mouse.up();await phone.waitForTimeout(100);
 assert.ok(await host.evaluate(()=>window.__controllerQAGame.state.ammo)<ammo,'held fire consumes real ammo');
 // Restore a nonzero manual heading before cached-page reconnect.
 await phone.mouse.move(tx,ty);await phone.mouse.down();await phone.mouse.move(tx+stride*1.5,ty,{steps:10});await phone.mouse.up();
 await host.waitForFunction(target=>Math.abs(window.__controllerQAGame.lookYaw-target)<.02,heading-Math.PI,{timeout:5000});
 const resumeHeading=await host.evaluate(()=>window.__controllerQAGame.lookYaw);
 // Exercise the cached-page lifecycle handlers over real HTTP/WS transport.
 const boundBefore=frames.filter(f=>f.type==='bound').length;
 await phone.evaluate(()=>{
  window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));
  window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));
 });
 await phone.locator('#controller.online').waitFor();
 if(await phone.locator('#setup[open]').count())await phone.getByRole('button',{name:'返回手柄',exact:true}).click();
 await phone.waitForTimeout(120);
 assert.ok(frames.filter(f=>f.type==='bound').length>boundBefore,'cached-page resume reconnects the real device session');
 assert.equal(await host.evaluate(()=>window.__controllerQAGame.heldFire),false,'resume starts neutral');
 assert.ok(Math.abs(await host.evaluate(()=>window.__controllerQAGame.lookYaw)-resumeHeading)<.02,'resume preserves completed manual turn without applying it twice');
 await phone.setViewportSize({width:1440,height:900});
 await phone.screenshot({path:screenshots+'2026-10-28-desktop-controller.png'});
 await phone.goto('about:blank');await host.waitForTimeout(300);
 assert.equal(await host.evaluate(()=>window.__controllerQAGame.heldFire),false);
 assert.deepEqual(await host.evaluate(()=>window.__controllerQAGame.touchMove),{x:0,y:0});
 assert.deepEqual(errors,[]);
 const report={game:'real production build',transport:'real authenticated WSS-compatible JSON',
  sensorInjection:sensors?'orientation round trip and damage haptic API passed':'not requested',pairing:'automatic',anonymousController:true,movement:'passed',tapVsDrag:'passed',topRowTurn:'half-cell activation/180 per cell/60 per third/repeated reversal/fast 270/hold/release passed',jump:'passed',
  firing:'passed',pageLifecycleReconnect:'passed (injected lifecycle events)',disconnectRelease:'passed',mobile:'390x844',desktop:'1440x900',hudRemoved:true,pageErrors:0};
 await writeFile(screenshots+'browser-report.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
}catch(error){
 for(const [name,page]of[['game',host],['controller',phone]])if(page){
  await page.screenshot({path:screenshots+'failed-'+name+'.png'}).catch(()=>{});
  console.error(name,(await page.locator('body').innerText()).slice(0,1200));
 }
 console.error('pageErrors',errors,'messages',frames.map(f=>f.type+':'+(f.code||'')));
 throw error;
}finally{if(host&&receiverRuntime)await host.request.post(base+'/api/devices/user/anka-outpost-strike/unbind',{headers:{Origin:base},data:{runtime:receiverRuntime}}).catch(()=>{});await browser.close();}
