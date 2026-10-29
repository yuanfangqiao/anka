/** Two real players, plus a credential-only phone controlling the Share player. */
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.ANKA_PLAYWRIGHT_MODULE||'playwright');
const base=process.env.ANKA_CONTROLLER_QA_URL||'http://127.0.0.1:18772',app='anka-outpost-strike';
const browser=await chromium.launch({headless:true,channel:'chrome',args:['--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
function findGame(){
 const seen=new Set();function walk(v){if(!v||typeof v!=='object'||seen.has(v))return;seen.add(v);if(v.component?.props?.game)return v.component.props.game;
 let r=walk(v.component?.subTree);if(r)return r;if(Array.isArray(v.children))for(const c of v.children){r=walk(c);if(r)return r;}}
 window.__controllerQAGame=walk(document.querySelector('#app').__vue_app__._container._vnode);
 return window.__controllerQAGame.player.group.position.toArray();
}
try{
 const owner=await browser.newContext(),share=await browser.newContext(),device=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 for(const context of [owner,share])await context.addInitScript(()=>localStorage.setItem('anka-desert-strike-settings-v1',JSON.stringify({quality:'low',muted:true,perspective:'first'})));
 assert.equal((await owner.request.post(base+'/api/auth/login',{data:{username:'controller-qa',password:'controller-local-only'}})).status(),200);
 const created=await owner.request.post(base+'/api/rooms/'+app,{headers:{Origin:base},data:{name:'房主',map:'desert',character:'male'}});
 assert.equal(created.status(),200,await created.text());const {room,invite}=await created.json();
 const token=new URL(invite.url).hash.split('=')[1];
 const redeemed=await share.request.post(`${base}/api/rooms/${app}/${room.id}/redeem`,{headers:{Origin:base},data:{token,name:'访客'}});
 assert.equal(redeemed.status(),200,await redeemed.text());
 assert.equal((await share.request.get(base+'/api/settings')).status(),401,'Share cannot become User');
 const h=await owner.newPage(),g=await share.newPage(),phone=await device.newPage();
 const errors=[],sockets=[];for(const p of [h,g,phone])p.on('pageerror',e=>errors.push(e.message));g.on('websocket',ws=>sockets.push(ws.url()));
 await Promise.all([h.goto(`${base}/play/${app}/${room.id}`),g.goto(`${base}/play/${app}/${room.id}`)]);
 await Promise.all([h.getByRole('button',{name:'我准备好了',exact:true}).click({timeout:60000}),g.getByRole('button',{name:'我准备好了',exact:true}).click({timeout:60000})]);
 await h.getByRole('button',{name:'开始对战 →',exact:true}).click();
 await Promise.all([h.locator('.battle-hud').waitFor({timeout:60000}),g.locator('.battle-hud').waitFor({timeout:60000})]);
 const hostBefore=await h.evaluate(findGame),guestBefore=await g.evaluate(findGame);
 await g.getByRole('button',{name:'手柄设备接入',exact:true}).click();await g.locator('.controller-qr').waitFor();
 assert.ok(sockets.some(url=>url.includes('/api/devices/share/')),'guest must explicitly use Share receiver');
 const url=await g.getByLabel('手柄WebSocket地址').inputValue();await phone.goto(url.replace(/^ws/,'http'));await phone.locator('#controller.online').waitFor();
 if(await phone.locator('#setup[open]').count())await phone.getByRole('button',{name:'返回手柄',exact:true}).click();
 await g.locator('.controller-overlay').waitFor({state:'hidden'});await phone.waitForTimeout(300);
 const box=await phone.locator('[data-action=jump]').boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;
 await phone.mouse.move(x,y);await phone.mouse.down();await phone.mouse.move(x-55,y-45,{steps:8});await phone.waitForTimeout(650);await phone.mouse.up();await phone.waitForTimeout(100);
 const hostAfter=await h.evaluate(()=>window.__controllerQAGame.player.group.position.toArray()),guestAfter=await g.evaluate(()=>window.__controllerQAGame.player.group.position.toArray());
 assert.ok(Math.hypot(guestAfter[0]-guestBefore[0],guestAfter[2]-guestBefore[2])>.05,'device controls guest');
 assert.ok(Math.hypot(hostAfter[0]-hostBefore[0],hostAfter[2]-hostBefore[2])<.02,'device cannot move host');
 await phone.goto('about:blank');await g.waitForTimeout(250);assert.equal(await g.evaluate(()=>window.__controllerQAGame.heldFire),false);
 assert.deepEqual(errors,[]);console.log('PASS real Share controller: independent guest identity, anonymous phone, current-player movement, host unaffected, release.');
}finally{await browser.close();}
