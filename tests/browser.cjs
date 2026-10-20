// Optional real-browser regression test, synthetic data in an isolated context.
// Start server.py first. Requires Playwright and Chromium; no production data.
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox']});
  try {
    const context = await browser.newContext({viewport: process.env.MOBILE ? {width:390,height:844} : {width:1440,height:1000}});
    if (process.env.HTTP_FALLBACK) await context.addInitScript(() => Object.defineProperty(crypto, 'subtle', {value: undefined}));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(process.env.TEST_URL || 'http://127.0.0.1:8765');
    await page.locator('#password').fill('Klassenbuch Testpasswort 2026');
    await page.locator('#confirm').fill('Klassenbuch Testpasswort 2026');
    await page.getByRole('button',{name:'Geschütztes Klassenbuch anlegen'}).click();
    await page.getByRole('button',{name:'Neuer Kurs'}).click();
    await page.getByLabel('Klasse / Kurs').fill('Testkurs 8');
    await page.getByLabel('Fach',{exact:true}).fill('Testfach');
    await page.getByLabel('Schülerinnen & Schüler').fill('Testkind A\nTestkind B\nTestkind C');
    await page.getByRole('button',{name:'Speichern',exact:true}).click();
    await page.getByRole('button',{name:'Stunde bewerten',exact:false}).click();
    await page.getByLabel('Stunde / Thema').fill('Synthetische Teststunde');
    await page.getByRole('button',{name:'Karten starten'}).click();
    await page.getByLabel('Kommentar (optional)').fill('Kommentar <script>synthetisch</script>');
    await page.getByRole('button',{name:'Bewertung ++',exact:true}).click();
    await page.getByLabel('Kommentar (optional)').fill('Fehlt im Test');
    await page.getByRole('button',{name:'Abwesend vermerken',exact:true}).click();
    await page.getByRole('button',{name:'Ohne Eintrag überspringen'}).click();
    await page.getByRole('button',{name:'Stunde verschlüsselt speichern'}).click();
    await page.locator('[data-nav="Jahresbilanz"]').click();
    await page.locator('.lesson-history > summary').click();
    assert.equal(await page.locator('.lesson-history .note').first().textContent(),'Kommentar <script>synthetisch</script>');
    let row = page.locator('.lesson-history tr').filter({hasText:'Testkind A'});
    await row.getByRole('button',{name:'Bewertung bearbeiten'}).click();
    await page.getByLabel('Bewertung / Anwesenheit').selectOption('-1');
    await page.getByLabel('Kommentar (optional)').fill('Korrigierter Kommentar');
    await page.getByRole('button',{name:'Speichern',exact:true}).click();
    assert.equal(await page.evaluate(()=>data.lessons[0].ratings[0].value),-1);
    assert.equal(await page.evaluate(()=>data.lessons[0].absences[0].status),'open');
    await page.locator('[data-nav="Fehlzeiten"]').click();
    await page.getByRole('button',{name:'Status ändern'}).click();
    await page.getByLabel('Status',{exact:true}).selectOption('excused');
    await page.getByRole('button',{name:'Speichern',exact:true}).click();
    assert.equal(await page.locator('.open-absences').getByText('Keine Fehlzeiten in dieser Gruppe.').count(),1);
    assert.equal(await page.evaluate(()=>data.lessons[0].absences[0].status),'excused');
    // Historical comments/absence records survive removing a child from the roster.
    await page.locator('[data-nav="Klassen & Kurse"]').click();
    await page.locator('[data-edit]').click();
    await page.getByLabel('Schülerinnen & Schüler').fill('Testkind A\nTestkind C');
    await page.getByRole('button',{name:'Speichern',exact:true}).click();
    await page.locator('[data-nav="Jahresbilanz"]').click();
    await page.locator('.lesson-history > summary').click();
    row = page.locator('.lesson-history tr').filter({hasText:'Testkind B'});
    await row.getByRole('button',{name:'Bewertung bearbeiten'}).click();
    await page.getByLabel('Bewertung / Anwesenheit').selectOption('unexcused');
    await page.getByRole('button',{name:'Speichern',exact:true}).click();
    assert.equal(await page.evaluate(()=>data.lessons[0].absences[0].status),'unexcused');
    // Full-lesson editing can add a previously skipped student's result.
    await page.locator('.lesson-history > summary').click();
    await page.getByRole('button',{name:'Stunde bearbeiten',exact:true}).click();
    await page.getByLabel('Stunde / Thema').fill('Korrigierte Teststunde');
    const childC = page.locator('.edit-student').filter({hasText:'Testkind C'});
    await childC.locator('select').selectOption('1');
    await childC.locator('textarea').fill('Nachgetragen');
    await page.getByRole('button',{name:'Speichern',exact:true}).click();
    assert.equal(await page.evaluate(()=>data.lessons[0].ratings.length),2);
    // Tests use 1–6; summary grades have their own highlighted area.
    await page.locator('[data-nav="Noteneinträge"]').click();
    await page.getByRole('button',{name:'Noteneintrag',exact:false}).first().click();
    await page.getByLabel('Titel / Anlass').fill('Synthetischer Test');
    await page.locator('.edit-student').filter({hasText:'Testkind A'}).locator('select').selectOption('2');
    await page.getByRole('button',{name:'Speichern',exact:true}).click();
    await page.getByRole('button',{name:'Bilanznote eintragen'}).click();
    await page.getByLabel('Eintragsart').selectOption('semester1');
    await page.getByLabel('Titel / Anlass').fill('Bilanz 1. Halbjahr');
    await page.locator('.edit-student').filter({hasText:'Testkind A'}).locator('select').selectOption('1');
    await page.getByRole('button',{name:'Speichern',exact:true}).click();
    assert.equal(await page.locator('.summary-section .summary-card').count(),1);
    assert.equal(await page.evaluate(()=>Records.gradeMean(data,data.courses[0].id,data.courses[0].students[0].id)),'2,00');
    await page.locator('.summary-section').getByRole('button',{name:'Note bearbeiten',exact:true}).click();
    await page.getByLabel('Schulnote',{exact:true}).selectOption('3');
    await page.getByRole('button',{name:'Speichern',exact:true}).click();
    assert.equal(await page.locator('.summary-card .grade-number').textContent(),'3');
    // Reload and decrypt through the actual UI. No extra plaintext stores.
    await page.reload();
    await page.locator('#password').fill('Klassenbuch Testpasswort 2026');
    await page.getByRole('button',{name:'Klassenbuch entsperren'}).click();
    await page.locator('[data-nav="Jahresbilanz"]').click();
    assert.equal(await page.evaluate(()=>data.lessons[0].title),'Korrigierte Teststunde');
    assert.equal(await page.evaluate(()=>data.assessments.length),2);
    assert.equal(await page.locator('.summary-card .grade-number').textContent(),'3');
    assert.deepEqual(await page.evaluate(()=>Object.keys(localStorage)),['stundenbuch.v1']);
    assert.equal(await page.evaluate(()=>localStorage.getItem('stundenbuch.v1').includes('Korrigierter Kommentar')),false);
    if (process.env.BROWSER_SCREENSHOT) await page.screenshot({path: process.env.BROWSER_SCREENSHOT, fullPage:true});
    // Lock closes and clears open edit dialogs so comments are no longer visible.
    await page.locator('.summary-section').getByRole('button',{name:'Note bearbeiten',exact:true}).click();
    await page.evaluate(()=>lock());
    assert.equal(await page.locator('#modal').innerHTML(),'');
    assert.equal(await page.locator('#modal').evaluate(d=>d.open),false);
    // A pre-feedback encrypted backup still opens, without inventing past absences.
    await page.evaluate(async () => {
      const legacy={year:'2025/26',courses:[{id:'legacy-course',name:'Legacy Test',subject:'Testfach',students:[{id:'legacy-child',name:'Testkind Alt'}]}],slots:[],lessons:[{id:'legacy-lesson',course:'legacy-course',date:'2026-01-20',title:'Alte Teststunde',ratings:[{student:'legacy-child',name:'Testkind Alt',value:2}]}]};
      const s=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
      const k=await derive('Klassenbuch Testpasswort 2026',s);
      const ciphertext=await encrypt(k,iv,new TextEncoder().encode(JSON.stringify(legacy)));
      localStorage.setItem(STORE,JSON.stringify({v:1,salt:b64(s),iv:b64(iv),cipher:b64(ciphertext)}));
    });
    await page.reload();
    await page.locator('#password').fill('Klassenbuch Testpasswort 2026');
    await page.getByRole('button',{name:'Klassenbuch entsperren'}).click();
    await page.locator('[data-nav="Jahresbilanz"]').click();
    assert.equal(await page.evaluate(()=>data.assessments.length),0);
    assert.equal(await page.evaluate(()=>data.lessons[0].absences.length),0);
    assert.equal(await page.evaluate(()=>data.lessons[0].ratings[0].value),2);
    assert.deepEqual(errors,[]);
    console.log('PASS: real-browser creation, comments, editing, absent vs skipped, excuse status, historical children, school grades, highlighted summaries, reload and lock');
    await context.close();
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1});
