/** Real game + real authority, simulated Web Bluetooth characteristics. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {installRadio} from './fixtures/gatt-radio.mjs';
const {chromium}=await import(process.env.ANKA_PLAYWRIGHT_MODULE||'playwright');
const base=process.env.ANKA_CONTROLLER_QA_URL||'http://127.0.0.1:18773',dir=new URL('../../.screenshots/controller/',import.meta.url).pathname;
await mkdir(dir,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome',args:['--use-angle=swiftshader','--enable-webgl','--enable-unsafe-swiftshader','--disable-background-timer-throttling']});
const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage(),errors=[],messages=[];let runtime;
page.on('pageerror',e=>errors.push(e.message));page.on('websocket',ws=>{if(ws.url().includes('/api/devices/')){runtime=new URL(ws.url()).searchParams.get('runtime');ws.on('framesent',e=>messages.push(JSON.parse(e.payload).type));}});
function game(){const app=document.querySelector('#app').__vue_app__,seen=new Set();function find(v){if(!v||typeof v!=='object'||seen.has(v))return;seen.add(v);if(v.component?.props?.game)return v.component.props.game;let g=find(v.component?.subTree);if(g)return g;if(Array.isArray(v.children))for(const c of v.children){g=find(c);if(g)return g;}}window.__gattGame=find(app._container._vnode);window.__gattGame.invulnerable=1000;}
try{
 assert.equal((await context.request.post(base+'/api/auth/login',{data:{username:'controller-qa',password:'controller-local-only'}})).status(),200);
 await context.addInitScript(installRadio);await context.addInitScript(()=>localStorage.setItem('anka-desert-strike-settings-v1',JSON.stringify({quality:'low',muted:true,perspective:'first'})));
 await page.goto(base+'/play/anka-outpost-strike');await page.getByRole('button',{name:'选择模式：主线闯关',exact:true}).click({timeout:45000});await page.getByRole('button',{name:'开始任务',exact:true}).click();await page.locator('.battle-hud').waitFor();await page.evaluate(game);
 await page.getByRole('button',{name:'手柄设备接入',exact:true}).click();assert.equal(await page.locator('.controller-qr').count(),0);
 await page.screenshot({path:dir+'2026-10-30-gatt-entry-desktop.png'});await page.getByRole('button',{name:'连接蓝牙手柄',exact:true}).click();await page.getByRole('button',{name:'手柄已连接',exact:true}).waitFor();await page.waitForTimeout(700);
 const initial=await page.evaluate(()=>({p:window.__gattGame.player.group.position.toArray(),yaw:window.__gattGame.lookYaw,ammo:window.__gattGame.state.ammo}));
 await page.evaluate(()=>{window.__gattRadio.state.move=[1,0];});await page.waitForTimeout(500);
 const moved=await page.evaluate(()=>window.__gattGame.player.group.position.toArray());assert.ok(Math.hypot(moved[0]-initial.p[0],moved[2]-initial.p[2])>.1);
 await page.evaluate(()=>{window.__gattRadio.state.move=[0,0];window.__gattRadio.state.turn=180;});await page.waitForFunction(yaw=>Math.abs(window.__gattGame.lookYaw-yaw+Math.PI)<.02,initial.yaw);
 await page.evaluate(()=>{window.__gattRadio.state.buttons=1;});await page.waitForTimeout(250);await page.evaluate(()=>{window.__gattRadio.state.buttons=0;});assert.ok(await page.evaluate(()=>window.__gattGame.state.ammo)<initial.ammo);
 assert.ok(await page.evaluate(()=>window.__gattRadio.state.outputs.length)>0,'real firing feedback reaches GATT output');
 await page.evaluate(()=>{window.__gattRadio.state.move=[1,0];});await page.waitForTimeout(100);await page.evaluate(()=>{window.__gattRadio.state.move=[0,0];window.__gattRadio.drop();});await page.waitForTimeout(200);
 assert.equal(await page.evaluate(()=>Math.hypot(window.__gattGame.touchMove.x,window.__gattGame.touchMove.y)),0);await page.getByRole('button',{name:'手柄已连接',exact:true}).waitFor({timeout:15000});await page.waitForTimeout(300);
 assert.ok(Math.abs(await page.evaluate(()=>window.__gattGame.lookYaw)-(initial.yaw-Math.PI))<.02,'reconnect cannot replay turn');
 await page.getByRole('button',{name:'手柄已连接',exact:true}).click();await page.getByText('蓝牙JSON调试',{exact:true}).click();await page.getByRole('button',{name:'发送蓝牙测试命令'}).click();await page.waitForTimeout(100);
 assert.ok(!(await page.locator('.controller-modal pre').innerText()).includes('resumeToken'));
 await page.screenshot({path:dir+'2026-10-30-gatt-debug-desktop.png'});await page.setViewportSize({width:390,height:844});await page.screenshot({path:dir+'2026-10-30-gatt-debug-mobile.png'});
 await page.getByRole('button',{name:'解除绑定，更换设备'}).click();await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>Math.hypot(window.__gattGame.touchMove.x,window.__gattGame.touchMove.y)),0);
 assert.ok(!messages.some(t=>['input','action','feedback'].includes(t)),'BLE data does not relay over receiver socket');assert.deepEqual(errors,[]);
 const report={realGame:true,realAuthority:true,radio:'simulated Web Bluetooth characteristics',qrRequired:false,movement:true,turn180:true,firing:true,feedback:true,reconnect:true,headingPreserved:true,revoke:true,debugJson:true,noServerInputRelay:true,pageErrors:errors.length};await writeFile('tmp/gatt-browser-integration.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch(error){await page.screenshot({path:dir+'gatt-integration-failed.png'});console.error((await page.locator('body').innerText()).slice(-1300));throw error;}
finally{if(runtime)await context.request.post(base+'/api/devices/user/anka-outpost-strike/unbind',{headers:{Origin:base},data:{runtime}}).catch(()=>{});await browser.close();}
