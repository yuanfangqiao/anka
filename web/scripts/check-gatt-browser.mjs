/** Actual Chrome Web Bluetooth + physical Mosaico + isolated real Anka/game. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.ANKA_PLAYWRIGHT_MODULE||'playwright');
const base=process.env.ANKA_CONTROLLER_QA_URL||'http://127.0.0.1:18773';
const gateway=process.env.ANKA_IRIS_GATEWAY,device=process.env.ANKA_IRIS_DEVICE;
if(!gateway||!device)throw Error('Set ANKA_IRIS_GATEWAY and ANKA_IRIS_DEVICE');
const folder=new URL('../../.screenshots/controller/',import.meta.url).pathname;await mkdir(folder,{recursive:true});
const browser=await chromium.launch({headless:false,channel:'chrome',args:['--use-angle=swiftshader','--enable-webgl','--enable-unsafe-swiftshader','--disable-background-timer-throttling']});
const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage(),errors=[];
let runtime;
page.on('pageerror',e=>errors.push(e.message));
page.on('websocket',socket=>{if(socket.url().includes('/api/devices/'))runtime=new URL(socket.url()).searchParams.get('runtime');});
const raw=async(service,method,payload=Buffer.alloc(0))=>{
 const r=await fetch(`${gateway}/v2/devices/${device}/rpc/raw`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({service_id:service,method_id:method,payload_hex:payload.toString('hex'),deadline_ms:2000})});
 const result=await r.json();assert.ok(r.ok,JSON.stringify(result));return result;
};
const state=async()=>JSON.parse(Buffer.from((await raw(0x1300,1)).payload_base64,'base64'));
const pointer=async(event,x,y,slot=0,calibration=false)=>{const b=Buffer.alloc(12);b[0]=event;b[1]=slot;b.writeInt16LE(x,2);b.writeInt16LE(y,4);b.writeUInt32LE(Date.now()>>>0,8);await raw(calibration?0x1300:0x1001,calibration?7:1,b);};
function game(){const app=document.querySelector('#app').__vue_app__,seen=new Set();function find(v){if(!v||typeof v!=='object'||seen.has(v))return;seen.add(v);if(v.component?.props?.game)return v.component.props.game;let g=find(v.component?.subTree);if(g)return g;if(Array.isArray(v.children))for(const c of v.children){g=find(c);if(g)return g;}}window.__gattGame=find(app._container._vnode);if(!window.__gattGame)throw Error('Game missing');window.__gattGame.invulnerable=1000;}
try{
 assert.equal((await context.request.post(base+'/api/auth/login',{data:{username:'controller-qa',password:'controller-local-only'}})).status(),200);
 await context.addInitScript(()=>localStorage.setItem('anka-desert-strike-settings-v1',JSON.stringify({quality:'low',muted:true,perspective:'first'})));
 await page.goto(base+'/play/anka-outpost-strike');await page.getByRole('button',{name:'选择模式：主线闯关',exact:true}).click({timeout:45000});await page.getByRole('button',{name:'开始任务',exact:true}).click();await page.locator('.battle-hud').waitFor();await page.evaluate(game);
 await page.getByRole('button',{name:'手柄设备接入',exact:true}).click();assert.equal(await page.locator('.controller-qr').count(),0,'BLE page must not require a QR');
 const connect=page.getByRole('button',{name:'连接蓝牙手柄',exact:true});await connect.waitFor();await connect.click();
 console.log('WAITING_FOR_NATIVE_BLUETOOTH_CHOOSER');
 await page.getByRole('button',{name:'手柄已连接',exact:true}).waitFor({timeout:180000});console.log('BROWSER_GATT_BOUND');
 for(const [slot,y]of [[0,128],[1,352]])await pointer(0,240,y,slot,true);
 for(let i=0;i<30;i++){if((await state()).calibration.phase==='RELEASE')break;await page.waitForTimeout(100);}
 assert.equal((await state()).calibration.phase,'RELEASE');for(const [slot,y]of [[0,128],[1,352]])await pointer(2,240,y,slot,true);
 await page.waitForTimeout(900);
 const before=await page.evaluate(()=>({p:window.__gattGame.player.group.position.toArray(),yaw:window.__gattGame.lookYaw}));
 await pointer(0,240,240);await pointer(1,340,240);await page.waitForTimeout(600);await pointer(2,340,240);
 const after=await page.evaluate(()=>window.__gattGame.player.group.position.toArray());assert.ok(Math.hypot(after[0]-before.p[0],after[2]-before.p[2])>.1,'physical BLE moves real game');
 await pointer(0,380,80);await pointer(1,380,308);await pointer(2,380,308);
 await page.waitForFunction(yaw=>Math.abs(window.__gattGame.lookYaw-yaw+Math.PI)<.03,before.yaw);
 await page.getByRole('button',{name:'手柄已连接',exact:true}).click();await page.getByText('蓝牙JSON调试',{exact:true}).click();await page.getByRole('button',{name:'发送蓝牙测试命令'}).click();
 await page.screenshot({path:folder+'2026-10-30-gatt-desktop.png'});await page.setViewportSize({width:390,height:844});await page.screenshot({path:folder+'2026-10-30-gatt-mobile.png'});
 assert.deepEqual(errors,[]);const report={realChromeWebBluetooth:true,realDevice:true,realGame:true,move:true,turn180:true,feedbackCommand:true,pageErrors:errors,method:'USB supplied touch; direct binding without QR, actual radio and browser Bluetooth chooser'};
 await writeFile('tmp/gatt-real-browser.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch(error){console.error('GATT_BROWSER_FAILED',error.message);console.error((await page.locator('body').innerText()).slice(-1400));await page.screenshot({path:folder+'gatt-failed.png'});throw error;}
finally{if(runtime)await context.request.post(base+'/api/devices/user/anka-outpost-strike/unbind',{headers:{Origin:base},data:{runtime}}).catch(()=>{});await browser.close();}
