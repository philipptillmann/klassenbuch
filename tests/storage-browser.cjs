// Server persistence, migration and backup tests. All data/server files temporary.
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {startServer} = require('./browser_helpers.cjs');
(async () => {
  const backend = await startServer();
  const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox']});
  try {
    const options={ignoreHTTPSErrors:!!process.env.TEST_HTTPS,viewport:process.env.MOBILE?{width:390,height:844}:{width:1440,height:1000},acceptDownloads:true};
    const first=await browser.newContext(options), second=await browser.newContext(options);
    if(process.env.HTTP_FALLBACK) for(const ctx of [first]) await ctx.addInitScript(()=>Object.defineProperty(crypto,'subtle',{value:undefined}));
    const page=await first.newPage(), other=await second.newPage();
    const errors=[],writes=[];
    for(const p of [page,other]){
      p.on('pageerror',e=>errors.push(e.message));
      p.on('request',r=>{if(['POST','PUT'].includes(r.method()) && r.url().endsWith('/api/vault'))writes.push(r.postData());});
    }
    const password='Synthetic migration password 2026';
    await page.goto(backend.url);
    // A pre-server-format browser vault is migrated without changing its key.
    const legacy=await page.evaluate(async password=>{
      const old={year:'2025/26',courses:[{id:'legacy',name:'Synthetic legacy course',subject:'Test',students:[{id:'child',name:'Synthetic child'}]}],slots:[],lessons:[{id:'lesson',course:'legacy',date:'2026-01-20',title:'Synthetic lesson',ratings:[{student:'child',name:'Synthetic child',value:2}]}]};
      const s=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),k=await derive(password,s);
      const ciphertext=await encrypt(k,iv,new TextEncoder().encode(JSON.stringify(old)));
      const envelope={v:1,salt:b64(s),iv:b64(iv),cipher:b64(ciphertext)};
      localStorage.setItem(STORE,JSON.stringify(envelope));return envelope;
    },password);
    await page.reload();
    await page.getByLabel('Einrichtungsschlüssel vom Server').fill(backend.setup());
    await page.getByLabel('Passwort',{exact:true}).fill('Wrong password long enough');
    await page.getByRole('button',{name:'Browserdaten auf Server übernehmen'}).click();
    await page.locator('#error').filter({hasText:'Einrichtung fehlgeschlagen'}).waitFor();
    assert.equal(await page.evaluate(()=>!!localStorage.getItem(STORE)),true);
    assert.equal(await page.evaluate(async()=> (await api('/api/vault/status')).exists),false);
    await page.getByLabel('Passwort',{exact:true}).fill(password);
    await page.getByRole('button',{name:'Browserdaten auf Server übernehmen'}).click();
    await page.locator('[data-nav="Jahresbilanz"]').click();
    assert.deepEqual(await page.evaluate(()=>Object.keys(localStorage)),[]);
    assert.equal(await page.evaluate(()=>data.lessons[0].ratings[0].value),2);
    assert.equal(await page.evaluate(()=>data.lessons[0].absences.length),0);
    assert.equal(await page.evaluate(()=>lastEnvelope.salt),legacy.salt);
    // Another clean device needs only the password, never the setup key.
    await other.goto(backend.url);
    await other.getByLabel('Passwort',{exact:true}).fill('Wrong password long enough');
    await other.getByRole('button',{name:'Klassenbuch entsperren'}).click();
    await other.locator('#error').filter({hasText:'Entsperren fehlgeschlagen'}).waitFor();
    await other.getByLabel('Passwort',{exact:true}).fill(password);
    await other.getByRole('button',{name:'Klassenbuch entsperren'}).click();
    await other.locator('[data-nav="Jahresbilanz"]').click();
    assert.equal(await other.evaluate(()=>data.courses[0].name),'Synthetic legacy course');
    assert.deepEqual(await other.evaluate(()=>Object.keys(localStorage)),[]);
    // A stale writer is blocked instead of erasing a change from the first tab.
    await page.evaluate(()=>mutate(()=>data.year='2027/28'));
    const conflict=await other.evaluate(async()=>{try{await mutate(()=>data.year='2099/00');return ''}catch(e){return e.message}});
    assert.match(conflict,/Neuere Daten/);
    assert.equal(await other.evaluate(()=>data.year),'2025/26');
    await other.reload();await other.getByLabel('Passwort',{exact:true}).fill(password);
    await other.getByRole('button',{name:'Klassenbuch entsperren'}).click();
    await other.locator('[data-nav="Jahresbilanz"]').click();
    assert.equal(await other.evaluate(()=>data.year),'2027/28');
    // Network failures roll back the attempted edit and do not create local stores.
    await second.route('**/api/vault',route=>route.abort());
    const offline=await other.evaluate(async()=>{try{await mutate(()=>data.year='2099/00');return ''}catch(e){return e.message}});
    assert.match(offline,/nicht erreichbar/);
    assert.equal(await other.evaluate(()=>data.year),'2027/28');
    assert.deepEqual(await other.evaluate(()=>Object.keys(localStorage)),[]);
    await second.unroute('**/api/vault');
    // A failed form submission can be retried after connectivity returns.
    await page.locator('[data-nav="Klassen & Kurse"]').click();
    await page.locator('[data-edit]').click();
    await page.getByLabel('Fach',{exact:true}).fill('Synthetic updated subject');
    await first.route('**/api/vault',route=>route.abort());
    await page.getByRole('button',{name:'Speichern',exact:true}).click();
    await page.locator('#toast').filter({hasText:'nicht erreichbar'}).waitFor();
    assert.equal(await page.evaluate(()=>data.courses[0].subject),'Test');
    await page.waitForFunction(()=>!document.querySelector('#modal [type="submit"]').disabled);
    await first.unroute('**/api/vault');
    await page.getByRole('button',{name:'Speichern',exact:true}).click();
    await page.locator('#modal').waitFor({state:'hidden'});
    assert.equal(await page.evaluate(()=>data.courses[0].subject),'Synthetic updated subject');
    // Export the server ciphertext and verify it is a compatible portable backup.
    await page.locator('[data-nav="Datenschutz"]').click();
    const downloaded=page.waitForEvent('download');
    await page.locator('#export').click();
    const download=await downloaded;
    const exported=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
    assert.equal(await page.evaluate(async({envelope,password})=>(await openEnvelope(envelope,password)).contents.year,{envelope:exported,password}),'2027/28');
    // A backup with a different password is re-encrypted with the server key.
    const backup=await page.evaluate(async()=>{
      const s=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),k=await derive('Other backup password 2026',s);
      const ciphertext=await encrypt(k,iv,new TextEncoder().encode(JSON.stringify({year:'2030/31',courses:[],slots:[],lessons:[]})));
      return {v:1,salt:b64(s),iv:b64(iv),cipher:b64(ciphertext)};
    });
    const dialogHandler=dialog=>dialog.accept(dialog.type()==='prompt'?'Other backup password 2026':undefined);
    page.on('dialog',dialogHandler);
    const chooserPromise=page.waitForEvent('filechooser');await page.locator('#import').click();
    const chooser=await chooserPromise;await chooser.setFiles({name:'synthetic-backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
    await page.locator('#toast').filter({hasText:'Backup auf dem Server gespeichert'}).waitFor();
    page.off('dialog',dialogHandler);
    await page.evaluate(()=>lock());
    await page.getByLabel('Passwort',{exact:true}).fill(password);
    await page.getByRole('button',{name:'Klassenbuch entsperren'}).click();
    await page.locator('[data-nav="Jahresbilanz"]').click();
    assert.equal(await page.evaluate(()=>data.year),'2030/31');
    for(const body of writes){
      assert.deepEqual(Object.keys(JSON.parse(body)),['envelope','reminderTimes']);
      assert.ok(JSON.parse(body).reminderTimes.every(Number.isInteger));
      for(const secret of [password,'Synthetic child','Synthetic lesson','Synthetic legacy course'])assert.equal(body.includes(secret),false);
    }
    const disk=fs.readFileSync(path.join(backend.directory,'vault.sqlite3'));
    for(const secret of [password,'Synthetic child','Synthetic lesson','Synthetic legacy course'])assert.equal(disk.includes(Buffer.from(secret)),false);
    assert.deepEqual(errors,[]);
    console.log('PASS: browser migration, independent device, wrong password, revision conflict, offline rollback, portable backup, restore with distinct password and ciphertext-only storage');
  } finally {await browser.close();await backend.stop();}
})().catch(e=>{console.error(e);process.exitCode=1});
