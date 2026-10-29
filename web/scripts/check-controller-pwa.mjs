/** A previously installed Anka SW must not replace/cache the controller page. */
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.ANKA_PLAYWRIGHT_MODULE||'playwright');
const base=process.env.ANKA_CONTROLLER_QA_URL||'http://127.0.0.1:18772';
const browser=await chromium.launch({headless:true,channel:'chrome'});
try{
 const context=await browser.newContext();
 assert.equal((await context.request.post(base+'/api/auth/login',{data:{username:'controller-qa',password:'controller-local-only'}})).status(),200);
 const page=await context.newPage();await page.goto(base+'/',{waitUntil:'networkidle'});
 await page.waitForFunction(async()=>!!(await navigator.serviceWorker.getRegistration('/')),null,{timeout:20000});
 await page.evaluate(()=>navigator.serviceWorker.ready);
 const manifest=await context.request.get(base+'/manifest.webmanifest');assert.equal(manifest.status(),200);
 assert.ok((await manifest.json()).name);
 await page.goto(base+'/controller?debug=1');
 assert.equal(await page.title(),'Anka 手柄');assert.equal(await page.locator('#controller').count(),1);
 const cached=await page.evaluate(async()=>{
  const cacheNames=await caches.keys();
  for(const name of cacheNames){const cache=await caches.open(name);for(const req of await cache.keys())if(/\/(controller|v1\/device|api\/devices)(\/|\?|$)/.test(new URL(req.url).pathname))return req.url;}
  return null;
 });
 assert.equal(cached,null,'device pages/credentials must not enter PWA cache');
 assert.equal(await page.evaluate(async()=>!!(await navigator.serviceWorker.getRegistration('/')).active),true);
 console.log('PASS PWA: registered active SW, readable manifest, standalone controller navigation, no device cache.');
}finally{await browser.close();}
