// Synthetic provider subscription; actual browser push event via Chromium CDP.
// Transport encryption/signing is separately verified against pywebpush in Python.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {startServer}=require('./browser_helpers.cjs');
const assert=require('node:assert/strict'),path=require('node:path');
const {execFileSync}=require('node:child_process');
(async()=>{
 const backend=await startServer();
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox',...(process.env.TEST_HTTPS?['--ignore-certificate-errors']:[])]});
 try{
  const context=await browser.newContext({ignoreHTTPSErrors:!!process.env.TEST_HTTPS,viewport:process.env.MOBILE?{width:390,height:844}:{width:1440,height:1000}});
  await context.grantPermissions(['notifications'],{origin:backend.url});
  await context.addInitScript(()=>{
   let sub=null;
   const value={endpoint:'https://updates.push.services.mozilla.com/wpush/v2/synthetic-browser',keys:{p256dh:btoa('\x04'+'A'.repeat(64)).replace(/=/g,''),auth:btoa('B'.repeat(16)).replace(/=/g,'')}};
   PushManager.prototype.getSubscription=async()=>sub;
   PushManager.prototype.subscribe=async options=>{
    if(!options.userVisibleOnly || options.applicationServerKey.length!==65)throw Error('VAPID subscription options');
    sub={endpoint:value.endpoint,toJSON:()=>value,unsubscribe:async()=>{sub=null;return true;}};return sub;
   };
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const cdp=await context.newCDPSession(page);let registrationId;
  cdp.on('ServiceWorker.workerRegistrationUpdated',({registrations})=>{for(const r of registrations)if(r.scopeURL===backend.url+'/')registrationId=r.registrationId;});
  await cdp.send('ServiceWorker.enable');
  await page.goto(backend.url);await page.getByLabel('Einrichtungsschlüssel vom Server').fill(backend.setup());
  await page.locator('#password').fill('Synthetic background password 2026');await page.locator('#confirm').fill('Synthetic background password 2026');
  await page.getByRole('button',{name:'Geschütztes Klassenbuch anlegen'}).click();await page.locator('[data-nav="Erinnerungen"]').waitFor();
  await page.evaluate(()=>mutate(()=>{
   const start=new Date();start.setMinutes(start.getMinutes()+10);
   data.courses=[{id:'private-course',name:'Must stay encrypted',subject:'Private subject',students:[]}];
   data.slots=[{id:'private-slot',course:'private-course',day:(start.getDay()+6)%7,time:String(start.getHours()).padStart(2,'0')+':'+String(start.getMinutes()).padStart(2,'0'),duration:45}];
  }));
  await page.locator('[data-nav="Erinnerungen"]').click();
  await page.getByRole('button',{name:'Hintergrund-Push aktivieren',exact:true}).click();
  await page.getByText('Hintergrund-Push auf diesem Gerät: Angemeldet',{exact:true}).waitFor();
  await page.getByLabel('Erinnerungen',{exact:true}).selectOption('true');await page.getByRole('button',{name:'Erinnerungen speichern'}).click();
  await page.locator('#toast').filter({hasText:'Erinnerungen gespeichert'}).waitFor();
  assert.equal(await page.evaluate(()=>reminderInterval),null);
  const query=sql=>JSON.parse(execFileSync(process.env.PYTHON_BIN || 'python3',['-c','import sqlite3,json,sys; db=sqlite3.connect(sys.argv[1]); print(json.dumps(db.execute(sys.argv[2]).fetchall()))',path.join(backend.directory,'vault.sqlite3'),sql],{encoding:'utf8'}));
  assert.equal(query('SELECT COUNT(*) FROM push_devices')[0][0],1);
  assert.ok(query('SELECT COUNT(*) FROM push_jobs')[0][0]>0);
  const times=JSON.parse(query('SELECT times FROM push_plan')[0][0]);assert.ok(times.every(Number.isInteger));
  // Server key never resides in a worker; notification works after browser lock.
  await page.evaluate(()=>lock());assert.equal(await page.evaluate(()=>key),null);
  assert.ok(registrationId);
  await cdp.send('ServiceWorker.deliverPushMessage',{origin:backend.url,registrationId,data:''});
  await page.waitForFunction(async()=>{const r=await navigator.serviceWorker.ready;return (await r.getNotifications()).length===1;});
  const body=await page.evaluate(async()=>{const r=await navigator.serviceWorker.ready;const n=(await r.getNotifications())[0];const text=n.body;n.close();return text;});
  assert.equal(body,'Zeit, die Mitarbeit der letzten Unterrichtsstunde einzutragen.');
  // Close every app window. A blank controller target lets CDP wake the worker.
  const control=await context.newPage();await page.close();
  const controlCdp=await context.newCDPSession(control);await controlCdp.send('ServiceWorker.enable');
  await controlCdp.send('ServiceWorker.deliverPushMessage',{origin:backend.url,registrationId,data:''});
  await control.goto(backend.url);
  await control.waitForFunction(async()=>{const r=await navigator.serviceWorker.ready;return (await r.getNotifications()).length===1;});
  assert.equal(await control.evaluate(()=>key),undefined);
  await control.locator('#password').fill('Synthetic background password 2026');await control.getByRole('button',{name:'Klassenbuch entsperren'}).click();
  await control.locator('[data-nav="Erinnerungen"]').click();
  // Mock renewed provider subscription to exercise persisted-device recovery.
  await control.getByRole('button',{name:'Hintergrund-Push aktivieren',exact:true}).click();
  await control.getByText('Hintergrund-Push auf diesem Gerät: Angemeldet',{exact:true}).waitFor();
  await control.getByRole('button',{name:'Dieses Gerät abmelden'}).click();
  await control.getByText('Hintergrund-Push auf diesem Gerät: Nicht angemeldet',{exact:true}).waitFor();
  assert.equal(query('SELECT COUNT(*) FROM push_devices')[0][0],0);assert.equal(query('SELECT COUNT(*) FROM push_jobs')[0][0],0);
  assert.deepEqual(await control.evaluate(()=>Object.keys(localStorage)),[]);assert.deepEqual(errors,[]);
  console.log('PASS: authenticated subscription, timestamp-only plan, no local duplicate timer, real worker push while locked and with app window closed, unsubscribe cleanup');
 }finally{await browser.close();await backend.stop();}
})().catch(e=>{console.error(e);process.exitCode=1});
