// Synthetic data, isolated server: CSV, double signs and local notifications.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {startServer}=require('./browser_helpers.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs');
const {execFileSync}=require('node:child_process');
(async()=>{
  const backend=await startServer();
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox',...(process.env.TEST_HTTPS?['--ignore-certificate-errors']:[])]});
  try{
    const context=await browser.newContext({ignoreHTTPSErrors:!!process.env.TEST_HTTPS,viewport:process.env.MOBILE?{width:390,height:844}:{width:1440,height:1000},acceptDownloads:true});
    await context.grantPermissions(['notifications'],{origin:backend.url});
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(backend.url);
    assert.equal(await page.locator('link[rel=manifest]').getAttribute('href'),'manifest.webmanifest');
    await page.locator('.brand-icon').first().evaluate(img=>img.decode());
    await page.getByLabel('Einrichtungsschlüssel vom Server').fill(backend.setup());
    await page.locator('#password').fill('Synthetic review password 2026');await page.locator('#confirm').fill('Synthetic review password 2026');
    await page.getByRole('button',{name:'Geschütztes Klassenbuch anlegen'}).click();
    await page.locator('[data-nav="Jahresbilanz"]').waitFor();
    await page.evaluate(()=>mutate(()=>{
      data.courses=[{id:'c',name:'Synthetischer Kurs',subject:'Testfach',students:[{id:'s',name:'=1+1'}]}];
      data.lessons=[{id:'l',course:'c',title:'Teststunde',date:'2026-10-19',ratings:[{student:'s',name:'=1+1',value:-2,comment:'Zeile 1; "Zitat"\nZeile 2'}],absences:[]}];
    }));
    await page.locator('[data-nav="Jahresbilanz"]').click();await page.locator('.lesson-history > summary').click();
    assert.ok((await page.locator('.lesson-history').textContent()).includes('− −'));
    await page.locator('#add-from-balance').click();await page.getByLabel('Stunde / Thema').fill('Weitere Teststunde');
    await page.getByRole('button',{name:'Karten starten'}).click();
    assert.equal(await page.getByRole('button',{name:'Bewertung + +',exact:true}).textContent(),'+ +');
    assert.equal(await page.getByRole('button',{name:'Bewertung − −',exact:true}).textContent(),'− −');
    await page.getByRole('button',{name:'Bewertung + +',exact:true}).click();await page.getByRole('button',{name:'Stunde verschlüsselt speichern'}).click();await page.locator('#finish').waitFor({state:'detached'});
    await page.locator('[data-nav="Datenschutz"]').click();
    page.once('dialog',d=>d.accept());
    const downloadPromise=page.waitForEvent('download');await page.locator('#export-csv').click();const download=await downloadPromise;
    const raw=fs.readFileSync(await download.path());assert.equal(raw.subarray(0,3).toString('hex'),'efbbbf');
    const parsed=JSON.parse(execFileSync('python3',['-c',"import csv,sys,json; print(json.dumps(list(csv.DictReader(sys.stdin,delimiter=';')),ensure_ascii=False))"],{input:raw.toString('utf8').replace(/^\uFEFF/,'')}));
    assert.equal(parsed.length,3);assert.ok(parsed.every(row=>row['Schüler']=="'=1+1"));
    assert.equal(parsed[1].Kommentar,'Zeile 1; "Zitat"\nZeile 2');assert.equal(parsed[1].Punkte,'-2');
    // Use the real timetable duration control and encrypted reminder settings.
    await page.locator('[data-nav="Stundenplan"]').click();await page.getByRole('button',{name:'Stunde hinzufügen'}).click();
    await page.getByLabel('Wochentag').selectOption('0');await page.getByLabel('Beginn').fill('09:00');await page.getByLabel('Dauer in Minuten').fill('60');
    await page.getByRole('button',{name:'Hinzufügen',exact:true}).click();await page.locator('#modal').waitFor({state:'hidden'});
    assert.equal(await page.evaluate(()=>data.slots[0].duration),60);
    await page.locator('[data-nav="Erinnerungen"]').click();
    await page.getByLabel('Erinnerungen',{exact:true}).selectOption('true');await page.getByLabel('Nach Stundenende').selectOption('10');
    await page.getByRole('button',{name:'Erinnerungen speichern'}).click();await page.locator('#toast').filter({hasText:'Erinnerungen gespeichert'}).waitFor();
    assert.equal(await page.evaluate(()=>data.reminders.delay),10);
    // Trigger the real scheduler at a synthetic due instant; no OS clock change.
    const count=await page.evaluate(async()=>{
      stopReminders();reminderLastCheck=new Date(2026,9,19,10,9,59).getTime();
      await checkReminders(new Date(2026,9,19,10,10));
      const registration=await navigator.serviceWorker.getRegistration();if(!registration)throw Error('Kein Benachrichtigungsdienst: '+document.querySelector('#toast').textContent);
      return (await registration.getNotifications()).length;
    });
    assert.equal(count,1);
    const duplicate=await page.evaluate(async()=>{await checkReminders(new Date(2026,9,19,10,10,20));return reminderSeen.size});assert.equal(duplicate,1);
    await page.evaluate(async()=>{const registration=await navigator.serviceWorker.getRegistration();if(!registration)throw Error('Kein Benachrichtigungsdienst: '+document.querySelector('#toast').textContent);for(const n of await registration.getNotifications())n.close();await lock();});
    assert.equal(await page.evaluate(()=>reminderInterval),null);
    await page.locator('#password').fill('Synthetic review password 2026');await page.getByRole('button',{name:'Klassenbuch entsperren'}).click();await page.locator('[data-nav="Erinnerungen"]').click();
    assert.equal(await page.getByLabel('Nach Stundenende').inputValue(),'10');assert.equal(await page.getByLabel('Erinnerungen',{exact:true}).inputValue(),'true');
    assert.deepEqual(await page.evaluate(()=>Object.keys(localStorage)),[]);assert.deepEqual(errors,[]);
    console.log('PASS: CSV download parsed by Python, formula-safe names, spaced signs, duration, encrypted reminder settings, real service-worker notification, duplicate suppression and lock');
  }finally{await browser.close();await backend.stop();}
})().catch(error=>{console.error(error);process.exitCode=1});
