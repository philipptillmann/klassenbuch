const $=s=>document.querySelector(s),id=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join(''),esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let data,key,salt,view='Übersicht',selectedCourse='',absenceCourse='',busy=false,session=null,queue=Promise.resolve(),timer;const STORE='stundenbuch.v1',days=['Montag','Dienstag','Mittwoch','Donnerstag','Freitag'],symbols=['− −','−','0','+','+ +'];
const b64=a=>{let s='';for(let i=0;i<a.length;i+=8192)s+=String.fromCharCode(...a.subarray(i,i+8192));return btoa(s)},un64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const bits = bytes => sjcl.codec.base64.toBits(b64(bytes));
const bytes = words => un64(sjcl.codec.base64.fromBits(words));
async function derive(p,s){
 if(crypto.subtle){let m=await crypto.subtle.importKey('raw',new TextEncoder().encode(p),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt:s,iterations:600000,hash:'SHA-256'},m,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])}
 return new Promise((resolve,reject)=>{const worker=new Worker('crypto-worker.js');worker.onmessage=e=>{worker.terminate();e.data.error?reject(Error(e.data.error)):resolve(e.data.key)};worker.onerror=()=>{worker.terminate();reject(Error('Passwortableitung fehlgeschlagen'))};worker.postMessage({password:p,salt:b64(s)})});
}
async function encrypt(k,iv,plain){return Array.isArray(k)?bytes(sjcl.mode.gcm.encrypt(new sjcl.cipher.aes(k),bits(plain),bits(iv),[],128)):new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},k,plain))}
async function decrypt(k,iv,cipher){return Array.isArray(k)?bytes(sjcl.mode.gcm.decrypt(new sjcl.cipher.aes(k),bits(cipher),bits(iv),[],128)):new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv},k,cipher))}
// Only ciphertext crosses the network. Password and decryption key stay in RAM.
let serverState = { exists: false, revision: 0 }, authToken = null, setupToken = '', lastEnvelope = null;
async function api(path, options = {}) {
  let response;
  try { response = await fetch(path, { ...options, cache: 'no-store', credentials: 'omit' }); }
  catch { throw Error('Server nicht erreichbar. Änderung wurde nicht gespeichert.'); }
  let value;
  try { value = await response.json(); } catch { throw Error('Ungültige Serverantwort. Reverse-Proxy und Update prüfen.'); }
  if (!response.ok) throw Error(value.error || `Serverfehler (${response.status})`);
  return value;
}
async function deriveAuth(password, saltBytes) {
  const domain = new TextEncoder().encode('klassenbuch-server-auth-v1:');
  const authSalt = new Uint8Array(domain.length + saltBytes.length);
  authSalt.set(domain); authSalt.set(saltBytes, domain.length);
  if (!crypto.subtle) return b64(bytes(await derive(password, authSalt)));
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return b64(new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt:authSalt,iterations:600000,hash:'SHA-256'}, material, 256)));
}
function headers() { return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` }; }
async function readVault() { return api('/api/vault', { headers: headers() }); }
async function persist(envelope) {
  const creating = !serverState.exists;
  const result = await api('/api/vault', {
    method: creating ? 'POST' : 'PUT',
    headers: { ...headers(), ...(creating ? { 'X-Setup-Token': setupToken } : { 'If-Match': String(serverState.revision) }) },
    body: JSON.stringify({ envelope }),
  });
  serverState = { exists: true, salt: envelope.salt, revision: result.revision };
  lastEnvelope = envelope;
  setupToken = '';
}
function save() {
  const snapshot = JSON.stringify(data), k = key, s = salt;
  const job = queue.then(async () => {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await encrypt(k, iv, new TextEncoder().encode(snapshot));
    await persist({ v: 1, salt: b64(s), iv: b64(iv), cipher: b64(cipher) });
  });
  queue = job.catch(() => {});
  return job;
}
function toast(text) {
  $('#toast').textContent = text; $('#toast').style.display = 'block';
  setTimeout(() => $('#toast').style.display = 'none', 5000);
}
function localLegacy() { try { return localStorage.getItem(STORE); } catch { return null; } }
function downloadEnvelope(raw, name = 'klassenbuch-backup') {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([raw], {type:'application/json'}));
  link.download = name + '-' + new Date().toISOString().slice(0,10) + '.json';
  link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
async function openEnvelope(envelope, password) {
  if (envelope.v !== 1 || !envelope.salt || !envelope.iv || !envelope.cipher) throw Error('Ungültiges Backup');
  const newSalt = un64(envelope.salt), newKey = await derive(password, newSalt);
  const contents = Records.normalize(JSON.parse(new TextDecoder().decode(await decrypt(newKey, un64(envelope.iv), un64(envelope.cipher)))));
  return { key: newKey, salt: newSalt, contents };
}
async function gate() {
  if (location.protocol !== 'https:' && !['localhost','127.0.0.1','[::1]'].includes(location.hostname)) {
    $('#app').innerHTML = '<section class="lock panel"><h1>HTTPS erforderlich</h1><p class="error">HTTP-Verbindung: Bitte öffne Klassenbuch über deine HTTPS-Adresse. Der Serverzugriff ist hier zum Schutz deiner Zugangsdaten gesperrt.</p></section>';
    if (localLegacy()) { const button = document.createElement('button'); button.textContent = 'Bisherige Browserdaten als Backup sichern'; button.onclick = () => downloadEnvelope(localLegacy(), 'klassenbuch-browser-backup'); $('#app section').append(button); }
    return;
  }
  $('#app').innerHTML = '<section class="lock panel"><h1>Klassenbuch</h1><p>Verbindung zum geschützten Serverspeicher …</p></section>';
  try { serverState = await api('/api/vault/status'); }
  catch (error) {
    $('#app').innerHTML = `<section class="lock panel"><h1>Server nicht erreichbar</h1><p class="error">${esc(error.message)}</p><button id="retry">Erneut versuchen</button></section>`;
    $('#retry').onclick = gate; return;
  }
  const exists = serverState.exists, legacy = localLegacy(), migrating = !exists && !!legacy;
  $('#app').innerHTML = `<section class="lock panel"><div class="brand"><span class="logo">▤</span> Klassenbuch<span style="color:#91a285">.</span></div><span class="eyebrow">Verschlüsselt auf deinem Server</span>
    <h1>${exists ? 'Schön, dass du da bist.' : migrating ? 'Dein Klassenbuch zieht um.' : 'Klassenbuch einrichten.'}</h1>
    <p>${exists ? 'Entsperre dein Klassenbuch mit deinem Passwort – auf jedem deiner Geräte.' : migrating ? 'Deine bisherigen Browserdaten werden nach dem Entsperren verschlüsselt auf den Server übertragen.' : 'Lege ein Passwort fest. Deine Daten werden im Browser verschlüsselt und auf deinem Server gespeichert.'}</p>
    <form id="unlock">${!exists ? '<label for="setup">Einrichtungsschlüssel vom Server</label><input id="setup" type="password" required autocomplete="off"><small>Auf dem Server: sudo cat /var/lib/klassenbuch/setup-token</small>' : ''}
    <label for="password">Passwort ${exists || migrating ? '' : 'festlegen'}</label><input id="password" type="password" autocomplete="${exists || migrating ? 'current-password' : 'new-password'}" minlength="12" required placeholder="Mindestens 12 Zeichen">
    ${exists || migrating ? '' : '<label for="confirm">Passwort wiederholen</label><input id="confirm" type="password" minlength="12" required autocomplete="new-password">'}
    <p id="error" class="error" role="alert"></p><button class="primary" type="submit">${exists ? 'Klassenbuch entsperren' : migrating ? 'Browserdaten auf Server übernehmen' : 'Geschütztes Klassenbuch anlegen'} →</button></form>
    <small>Nur dein Passwort entschlüsselt die Daten. Passwort und Entschlüsselungsschlüssel werden nicht an den Server übertragen. Ohne Passwort gibt es keine Wiederherstellung.</small>
    ${!exists ? '<button id="restore">Verschlüsseltes Backup importieren</button>' : ''}${legacy ? '<button id="legacy-backup">Bisherige Browserdaten als Backup sichern</button>' : ''}</section>`;
  if ($('#legacy-backup')) $('#legacy-backup').onclick = () => downloadEnvelope(legacy, 'klassenbuch-browser-backup');
  if ($('#restore')) $('#restore').onclick = () => {
    setupToken = $('#setup').value.trim();
    if (!setupToken) { $('#error').textContent = 'Bitte zuerst den Einrichtungsschlüssel eintragen.'; return; }
    importBackup();
  };
  $('#unlock').onsubmit = async event => {
    event.preventDefault(); if (busy) return; busy = true;
    const button = $('#unlock button'); button.disabled = true;
    const password = $('#password').value;
    try {
      if (exists) {
        authToken = await deriveAuth(password, un64(serverState.salt));
        const remote = await readVault();
        const opened = await openEnvelope(remote.envelope, password);
        key = opened.key; salt = opened.salt; data = opened.contents;
        serverState.revision = remote.revision; lastEnvelope = remote.envelope;
      } else {
        setupToken = $('#setup').value.trim();
        if (migrating) {
          const envelope = JSON.parse(legacy), opened = await openEnvelope(envelope, password);
          key = opened.key; salt = opened.salt; data = opened.contents;
          authToken = await deriveAuth(password, salt);
          await persist(envelope);
          // Verify the server copy before removing the legacy browser copy.
          const verified = await readVault();
          if (JSON.stringify(verified.envelope) !== JSON.stringify(envelope)) throw Error('Übertragung konnte nicht geprüft werden. Browserdaten bleiben erhalten.');
          if (localLegacy() === legacy) localStorage.removeItem(STORE);
        } else {
          if (password !== $('#confirm').value) throw Error('Die Passwörter stimmen nicht überein.');
          salt = crypto.getRandomValues(new Uint8Array(16)); key = await derive(password, salt);
          authToken = await deriveAuth(password, salt);
          data = {year:'2026/27',courses:[],slots:[],lessons:[],assessments:[]};
          await save();
        }
      }
      $('#password').value = ''; resetTimer(); render();
    } catch (error) {
      key = null; salt = null; authToken = null; data = null;
      $('#error').textContent = exists ? `Entsperren fehlgeschlagen. Passwort und Verbindung prüfen. ${error.message}` : `Einrichtung fehlgeschlagen: ${error.message}`;
    } finally { busy = false; button.disabled = false; }
  };
}
function resetTimer() { clearTimeout(timer); if (key) timer = setTimeout(lock, 300000); }
async function lock() {
  stopReminders(); $('#modal').close(); $('#modal').innerHTML = ''; await queue;
  key = null; salt = null; authToken = null; setupToken = ''; lastEnvelope = null; data = null; session = null;
  clearTimeout(timer); await gate();
}
['pointerdown','keydown'].forEach(event => document.addEventListener(event, resetTimer));

const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const actions = (label = 'Speichern') => `<div class="actions"><button type="button" data-close>Abbrechen</button><button class="primary" type="submit">${label}</button></div>`;
const noteHTML = text => text ? `<span class="note">${esc(text)}</span>` : '<span class="muted">–</span>';
function avg(student, course) { return Records.mean(Records.ratings(data, course, student).map(r => r.value)); }
function courseName(cid) { const c = data.courses.find(c => c.id === cid); return c ? `${c.name} · ${c.subject}` : 'Ehemaliger Kurs'; }
function currentCourse() {
  if (!data.courses.some(c => c.id === selectedCourse)) selectedCourse = data.courses[0]?.id || '';
  return data.courses.find(c => c.id === selectedCourse);
}
function courseSelect(cid = selectedCourse) {
  return data.courses.map(c => `<option value="${esc(c.id)}" ${c.id === cid ? 'selected' : ''}>${esc(c.name)} · ${esc(c.subject)}</option>`).join('');
}
function discardSession() { return !session || confirm('Diese ungespeicherte Stunde verwerfen?'); }
function render() {
  Records.normalize(data);
  const menu = [['Übersicht', '◫'], ['Klassen & Kurse', '▦'], ['Stundenplan', '▤'], ['Jahresbilanz', '↗'], ['Noteneinträge', '▥'], ['Fehlzeiten', '◷'], ['Erinnerungen', '◴'], ['Datenschutz', '♧']];
  $('#app').innerHTML = `<aside><div class="brand"><span class="logo">▤</span> Klassenbuch<span style="color:#91a285">.</span></div>
    <nav>${menu.map(([name, icon]) => `<button data-nav="${name}" class="${view === name ? 'active' : ''}"><span>${icon}</span>${name}</button>`).join('')}</nav>
    <footer><span class="badge">● Verschlüsselt auf dem Server</span><p>Dein Unterricht. Deine Daten.</p><button id="lock" class="textbtn">↪ Klassenbuch sperren</button></footer></aside>
    <main><header class="top"><span>Mein Arbeitsraum <span class="muted"> / ${esc(view)}</span></span><div class="row"><span class="badge">Schuljahr ${esc(data.year)}</span><button class="textbtn" id="lockTop">♧ Sperren</button></div></header><div id="content"></div></main>`;
  document.querySelectorAll('[data-nav]').forEach(b => b.onclick = () => {
    if (!discardSession()) return;
    view = b.dataset.nav; session = null; render();
  });
  $('#lock').onclick = $('#lockTop').onclick = () => { if (discardSession()) lock(); };
  startReminders();
  if (session) { rating(); return; }
  ({ 'Übersicht': overview, 'Klassen & Kurse': coursesView, 'Stundenplan': schedule, 'Jahresbilanz': balance, 'Noteneinträge': assessmentsView, 'Fehlzeiten': absencesView, 'Erinnerungen': remindersView, 'Datenschutz': privacy }[view] || overview)();
}
function overview() {
  const total = data.courses.reduce((n, c) => n + c.students.length, 0);
  const open = Records.absences(data).filter(a => a.status === 'open').length;
  $('#content').innerHTML = `<div class="row"><div><span class="eyebrow">Mit Überblick in den Schultag</span><h1>Hallo, schönen Unterricht.</h1><p>Ein kleiner Moment nach der Stunde. Ein klares Bild fürs ganze Jahr.</p></div><button class="primary" id="start">＋ Stunde bewerten</button></div>
    <div class="grid"><div class="panel stat"><div><small>MEINE KURSE</small><strong>${data.courses.length}</strong></div><small>Gemeinsam lernen</small></div><div class="panel stat"><div><small>SCHÜLERINNEN & SCHÜLER</small><strong>${total}</strong></div><small>Kurseinträge insgesamt</small></div><div class="panel stat"><div><small>ERFASSTE STUNDEN</small><strong>${data.lessons.length}</strong></div><small>In diesem Schuljahr</small></div></div>
    <div class="split"><section class="panel"><div class="row"><h2>Deine Klassen & Kurse</h2><button class="textbtn" id="add">＋ Neuer Kurs</button></div>${coursesHTML()}</section>
    <section><div class="hero"><span class="eyebrow">Wenige Klicks. Viel Überblick.</span><h2>Die Stunde ist vorbei.<br>Dein Eindruck bleibt.</h2><p>Gehe Karte für Karte durch deinen Kurs und halte die Mitarbeit direkt fest.</p><button class="primary" id="quick">Bewertung starten →</button></div>
    <div class="panel spaced"><h3>${open} offene Fehlzeiten</h3><p>Abwesenheiten nachträglich als entschuldigt oder unentschuldigt markieren.</p><button id="openabsences" class="textbtn">Fehlzeiten ansehen →</button></div></section></div>`;
  $('#add').onclick = () => courseForm();
  $('#start').onclick = $('#quick').onclick = () => startForm();
  $('#openabsences').onclick = () => { view = 'Fehlzeiten'; render(); };
  bindCourses();
}
function coursesView() {
  $('#content').innerHTML = `<div class="row"><div><span class="eyebrow">Organisation</span><h1>Klassen & Kurse</h1><p>Alle Lerngruppen. Jeder Schüler im Blick.</p></div><button class="primary" id="add">＋ Kurs anlegen</button></div><section class="panel">${coursesHTML(true)}</section>`;
  $('#add').onclick = () => courseForm(); bindCourses();
}
function coursesHTML(edit = false) {
  return data.courses.length ? data.courses.map(c => `<div class="course"><div class="row"><div class="icon">${esc(c.name.slice(0, 2))}</div><div><h3>${esc(c.name)}</h3><small>${esc(c.subject)} · ${c.students.length} Schüler · ${data.lessons.filter(l => l.course === c.id).length} Stunden</small></div></div><div><button data-rate="${esc(c.id)}" class="textbtn">Bewerten →</button>${edit ? `<button data-edit="${esc(c.id)}" class="textbtn">Bearbeiten</button>` : ''}</div></div>`).join('') : '<div class="empty">▦<h3>Hier beginnt dein Schuljahr.</h3><p>Lege deinen ersten Kurs mit seinen Schülerinnen und Schülern an.</p></div>';
}
function bindCourses() {
  document.querySelectorAll('[data-rate]').forEach(b => b.onclick = () => startForm(b.dataset.rate));
  document.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => courseForm(b.dataset.edit));
}
function modal(html, submit, wide = false) {
  const dialog = $('#modal');
  dialog.classList.toggle('wide', wide);
  dialog.innerHTML = html;
  dialog.showModal();
  dialog.querySelector('[data-close]').onclick = () => dialog.close();
  const form = dialog.querySelector('form');
  form.onsubmit = async e => {
    e.preventDefault();
    const button = form.querySelector('[type="submit"]');
    if (button.disabled) return;
    button.disabled = true;
    try { await submit(new FormData(form)); dialog.close(); }
    catch (err) { toast(err.message); }
    finally { button.disabled = false; }
  };
}
async function mutate(fn) {
  const previous = structuredClone(data), previousSession = structuredClone(session);
  try { fn(); await save(); }
  catch (error) { data = previous; session = previousSession; toast(error.message); throw error; }
  render();
}
function courseForm(cid) {
  const course = data.courses.find(c => c.id === cid);
  modal(`<h2>${course ? 'Kurs bearbeiten' : 'Neuer Kurs'}</h2><form><label for="course-name">Klasse / Kurs</label><input id="course-name" name="name" required value="${esc(course?.name || '')}" placeholder="z. B. 8a"><label for="subject">Fach</label><input id="subject" name="subject" required value="${esc(course?.subject || '')}" placeholder="z. B. Deutsch"><label for="students">Schülerinnen & Schüler – ein Name pro Zeile</label><textarea id="students" name="students" rows="7" required>${esc(course?.students.map(s => s.name).join('\n') || '')}</textarea><small>Unveränderte Namen behalten ihren Verlauf. Entfernte Namen bleiben in vergangenen Einträgen gespeichert.</small>${actions()}</form>`, async f => {
    const names = f.get('students').split('\n').map(n => n.trim()).filter(Boolean);
    if (!names.length || new Set(names).size !== names.length) throw Error('Bitte mindestens einen eindeutigen Namen verwenden.');
    await mutate(() => {
      const current = data.courses.find(c => c.id === cid);
      const students = names.map(name => current?.students.find(s => s.name === name) || { id: id(), name });
      if (current) Object.assign(current, { name: f.get('name').trim(), subject: f.get('subject').trim(), students });
      else data.courses.push({ id: id(), name: f.get('name').trim(), subject: f.get('subject').trim(), students });
    });
  });
}
function schedule() {
  $('#content').innerHTML = `<div class="row"><div><span class="eyebrow">Deine Woche</span><h1>Stundenplan</h1><p>Ein fester Platz für jeden Kurs.</p></div><button class="primary" id="addslot">＋ Stunde hinzufügen</button></div><div class="week">${days.map((day, i) => `<section class="day"><h3>${day}</h3>${data.slots.filter(s => s.day === i).sort((a, b) => a.time.localeCompare(b.time)).map(s => `<div class="panel"><strong>${esc(s.time)}</strong><p>${esc(courseName(s.course))}</p><small>${esc(s.room)} · ${esc(s.duration || 45)} Min.</small><button class="textbtn" data-del-slot="${esc(s.id)}" aria-label="Stunde entfernen">×</button></div>`).join('') || '<p>Keine Stunden</p>'}</section>`).join('')}</div>`;
  $('#addslot').onclick = slotForm;
  document.querySelectorAll('[data-del-slot]').forEach(b => b.onclick = () => mutate(() => data.slots = data.slots.filter(s => s.id !== b.dataset.delSlot)).catch(() => {}));
}
function slotForm() {
  if (!data.courses.length) { courseForm(); return; }
  modal(`<h2>Stunde hinzufügen</h2><form><label for="slot-course">Kurs</label><select id="slot-course" name="course">${courseSelect()}</select><label for="day">Wochentag</label><select id="day" name="day">${days.map((d, i) => `<option value="${i}">${d}</option>`).join('')}</select><label for="time">Beginn</label><input id="time" name="time" type="time" required value="08:00"><label for="duration">Dauer in Minuten</label><input id="duration" name="duration" type="number" min="5" max="300" value="45" required><label for="room">Raum</label><input id="room" name="room" placeholder="z. B. B 204">${actions('Hinzufügen')}</form>`, f => mutate(() => data.slots.push({ id: id(), course: f.get('course'), day: Number(f.get('day')), time: f.get('time'), duration: Number(f.get('duration')), room: f.get('room') })));
}
function privacy() {
  $('#content').innerHTML = `<span class="eyebrow">Dein geschützter Arbeitsraum</span><h1>Daten & Sicherheit</h1><div class="panel"><h2>Nur mit deinem Passwort lesbar</h2><p>Klassen, Namen, Stundenplan, Bewertungen, Kommentare, Fehlzeiten und Schulnoten werden im Browser gemeinsam mit AES-256-GCM verschlüsselt und auf deinem Server gespeichert. Der Schlüssel wird mit PBKDF2-SHA-256 (600.000 Iterationen) aus deinem Passwort abgeleitet und nur während der Sitzung im Arbeitsspeicher gehalten.</p><p>Deine Daten liegen verschlüsselt auf deinem Server und lassen sich auf anderen Geräten mit demselben Passwort öffnen. Änderungen anderer Geräte werden beim erneuten Entsperren geladen. Ein paralleles Speichern veralteter Daten wird blockiert. Nutze die App auf einem vertrauenswürdigen Gerät und sichere regelmäßig ein Backup.</p><button class="primary" id="export">↓ Verschlüsseltes Backup</button> <button id="import">Backup wiederherstellen</button><h3>Unverschlüsselter CSV-Export</h3><p>Schülerliste, Mitarbeit, Kommentare, Fehlzeiten und Schulnoten als lesbare Tabelle. Diese Datei ist nicht passwortgeschützt.</p><button id="export-csv">↓ Unverschlüsselte CSV exportieren</button><h3>Schuljahr</h3><p>Die Bezeichnung gilt für den gesamten aktuellen Datenbestand. Eine Änderung filtert oder archiviert keine Bewertungen. Für ein neues Schuljahr zuerst ein Backup sichern. Ein anderer Browser verwendet dasselbe Server-Klassenbuch.</p><form id="yearform"><label for="year">Bezeichnung des Schuljahres</label><input id="year" value="${esc(data.year)}" required><button type="submit" class="spaced">Bezeichnung speichern</button></form></div>`;
  $('#export').onclick = exportBackup; $('#import').onclick = importBackup; $('#export-csv').onclick = exportCsv;
  if (localLegacy()) { const button = document.createElement('button'); button.textContent = 'Bisherige Browserdaten als Backup sichern'; button.onclick = () => downloadEnvelope(localLegacy(), 'klassenbuch-browser-backup'); $('#import').after(button); }
  $('#yearform').onsubmit = e => { e.preventDefault(); const year = $('#year').value; mutate(() => data.year = year).catch(() => {}); };
}
function startForm(cid) {
  if (!data.courses.length) { courseForm(); return; }
  modal(`<h2>Stunde bewerten</h2><form><label for="lesson-course">Kurs</label><select id="lesson-course" name="course">${courseSelect(cid)}</select><label for="lesson-date">Datum</label><input id="lesson-date" name="date" type="date" value="${today()}" required><label for="lesson-title">Stunde / Thema</label><input id="lesson-title" name="title" required placeholder="z. B. 3. Stunde · Gedichtanalyse">${actions('Karten starten →')}</form>`, f => {
    const course = data.courses.find(c => c.id === f.get('course'));
    selectedCourse = course.id;
    session = { id: id(), course: course.id, date: f.get('date'), title: f.get('title').trim(), roster: structuredClone(course.students), ratings: [], absences: [], index: 0 };
    render();
  });
}
function rating() {
  const roster = session.roster, student = roster[session.index];
  const present = session.ratings.length, absent = session.absences.length;
  $('#content').innerHTML = `<div class="row"><div><span class="eyebrow">Mitarbeit festhalten</span><h1>${esc(courseName(session.course))}</h1><p>${esc(session.date)} · ${esc(session.title)}</p></div><button id="cancel">Abbrechen</button></div>
    <section class="cards"><div class="row"><span>${session.index} von ${roster.length} bearbeitet</span><small>Eine Karte. Ein Eindruck.</small></div><div class="progress"><i style="width:${roster.length ? session.index / roster.length * 100 : 100}%"></i></div>
    ${student ? `<div class="student"><div class="avatar">${esc(student.name.split(' ').map(n => n[0]).slice(0, 2).join(''))}</div><h1>${esc(student.name)}</h1><p>Wie war die Mitarbeit in dieser Stunde?</p><label for="card-comment">Kommentar (optional)</label><textarea id="card-comment" rows="2" maxlength="4000" placeholder="z. B. Gute Argumente in der Diskussion">${esc(Records.comment(session, student.id))}</textarea></div>
      <div class="ratings">${[2, 1, 0, -1, -2].map(v => `<button data-value="${v}" aria-label="Bewertung ${symbols[v + 2]}">${symbols[v + 2]}</button>`).join('')}</div><div class="row spaced"><button id="absent">Abwesend vermerken</button><button class="textbtn" id="skip">Ohne Eintrag überspringen →</button></div>` :
      `<div class="student"><div class="avatar">✓</div><h1>Alles im Blick.</h1><p>${present} Bewertungen · ${absent} Abwesenheiten · ${roster.length - present - absent} übersprungen</p><button class="primary" id="finish">Stunde verschlüsselt speichern</button></div>`}
    <button class="textbtn spaced" id="back" ${session.index ? '' : 'disabled'}>← Vorherige Karte</button><p><small>+ + = 2 · + = 1 · 0 = 0 · − = −1 · − − = −2<br>Abwesende und übersprungene Schüler fließen nicht in den Schnitt ein.<br>Abwesenheiten werden zunächst als „Offen“ gespeichert.</small></p></section>`;
  $('#cancel').onclick = () => { if (discardSession()) { session = null; render(); } };
  $('#back').onclick = () => { session.index--; rating(); };
  const advance = outcome => {
    Records.setResult(session, student, outcome, $('#card-comment').value);
    session.index++; rating();
  };
  if (student) {
    document.querySelectorAll('[data-value]').forEach(b => b.onclick = () => advance(b.dataset.value));
    $('#absent').onclick = () => advance('open');
    $('#skip').onclick = () => advance('skip');
  } else {
    $('#finish').onclick = async () => {
      const button = $('#finish'); button.disabled = true;
      try {
        const lesson = structuredClone(session); delete lesson.index;
        await mutate(() => { data.lessons.push(lesson); session = null; });
        toast('Stunde gespeichert');
      } catch { button.disabled = false; }
    };
  }
}
function outcomeOptions(value) {
  return [['skip', 'Ohne Eintrag'], ...[2, 1, 0, -1, -2].map(v => [String(v), symbols[v + 2]]), ...Object.entries(Records.attendance).map(([k, label]) => [k, `Abwesend · ${label}`])]
    .map(([key, label]) => `<option value="${key}" ${key === value ? 'selected' : ''}>${label}</option>`).join('');
}
function lessonForm(lessonId, studentId) {
  const lesson = data.lessons.find(l => l.id === lessonId);
  const students = Records.roster(data, lesson.course, lesson).filter(s => !studentId || s.id === studentId);
  modal(`<h2>${studentId ? 'Bewertung bearbeiten' : 'Stunde bearbeiten'}</h2><p>${esc(courseName(lesson.course))}</p><form>
    ${studentId ? `<p>${esc(lesson.date)} · ${esc(lesson.title)}</p>` : `<div class="form-grid"><div><label for="edit-date">Datum</label><input id="edit-date" name="date" type="date" value="${esc(lesson.date)}" required></div><div><label for="edit-title">Stunde / Thema</label><input id="edit-title" name="title" value="${esc(lesson.title)}" required></div></div>`}
    <p><small>„Ohne Eintrag“ entfernt Bewertung und Fehlzeit. Abwesenheiten zählen nicht zum Mitarbeitsschnitt.</small></p>
    ${students.map((s, i) => `<section class="edit-student"><h3>${esc(s.name)}</h3><label for="outcome-${i}">Bewertung / Anwesenheit</label><select id="outcome-${i}" name="outcome${i}">${outcomeOptions(Records.result(lesson, s.id))}</select><label for="comment-${i}">Kommentar (optional)</label><textarea id="comment-${i}" name="comment${i}" rows="2" maxlength="4000">${esc(Records.comment(lesson, s.id))}</textarea></section>`).join('')}
    ${actions()}</form>`, async f => {
    const draft = structuredClone(lesson);
    if (!studentId) { draft.date = f.get('date'); draft.title = f.get('title').trim(); }
    students.forEach((s, i) => Records.setResult(draft, s, f.get(`outcome${i}`), f.get(`comment${i}`)));
    draft.roster = Records.roster(data, lesson.course, lesson);
    await mutate(() => data.lessons[data.lessons.findIndex(l => l.id === lessonId)] = draft);
    toast('Bewertung aktualisiert');
  }, !studentId);
}
function absencesView() {
  const entries = Records.absences(data, absenceCourse);
  $('#content').innerHTML = `<span class="eyebrow">Anwesenheit im Blick</span><h1>Fehlzeiten</h1><p>Alle erfassten Fehlstunden, nach Kind gruppiert. Offene Entschuldigungen stehen zuerst.</p>
    <label for="absence-course">Kurs filtern</label><select id="absence-course" class="course-filter"><option value="">Alle Kurse</option>${courseSelect(absenceCourse)}</select>
    <div class="grid"><div class="panel stat"><small>OFFEN</small><strong>${entries.filter(e => e.status === 'open').length}</strong></div><div class="panel stat"><small>ENTSCHULDIGT</small><strong>${entries.filter(e => e.status === 'excused').length}</strong></div><div class="panel stat"><small>UNENTSCHULDIGT</small><strong>${entries.filter(e => e.status === 'unexcused').length}</strong></div></div>
    ${absenceGroup('Offene Entschuldigungen', entries.filter(e => e.status === 'open'), true)}
    ${absenceGroup('Geklärte Fehlzeiten', entries.filter(e => e.status !== 'open'), false)}
    <p><small>Eine erfasste Unterrichtseinheit zählt als eine Fehlstunde. Früher übersprungene Karten werden nicht automatisch als Abwesenheit interpretiert.</small></p>`;
  $('#absence-course').value = absenceCourse;
  $('#absence-course').onchange = e => { absenceCourse = e.target.value; absencesView(); };
  document.querySelectorAll('[data-absence-edit]').forEach(b => b.onclick = () => absenceForm(b.dataset.absenceEdit, b.dataset.student));
}
function absenceGroup(title, entries, open) {
  const groups = new Map();
  for (const e of entries) { if (!groups.has(e.student)) groups.set(e.student, []); groups.get(e.student).push(e); }
  return `<section class="panel spaced ${open ? 'open-absences' : ''}"><h2>${title} <span class="badge">${entries.length}</span></h2>${[...groups.values()].sort((a, b) => a[0].name.localeCompare(b[0].name, 'de')).map(list => `<details ${open ? 'open' : ''}><summary>${esc(list[0].name)} <small>· ${list.length} Fehlstunden</small></summary><div class="table-scroll"><table><thead><tr><th>Datum / Stunde</th><th>Kurs</th><th>Status</th><th>Kommentar</th><th>Aktion</th></tr></thead><tbody>${list.map(e => `<tr><td>${esc(e.lesson.date)}<br><small>${esc(e.lesson.title)}</small></td><td>${esc(courseName(e.lesson.course))}</td><td><span class="status ${esc(e.status)}">${Records.attendance[e.status]}</span></td><td>${noteHTML(e.comment)}</td><td><button class="textbtn" data-absence-edit="${esc(e.lesson.id)}" data-student="${esc(e.student)}">Status ändern</button></td></tr>`).join('')}</tbody></table></div></details>`).join('') || '<p>Keine Fehlzeiten in dieser Gruppe.</p>'}</section>`;
}
function absenceForm(lessonId, studentId) {
  const lesson = data.lessons.find(l => l.id === lessonId), entry = lesson.absences.find(a => a.student === studentId);
  modal(`<h2>Fehlzeit bearbeiten</h2><p>${esc(entry.name)} · ${esc(courseName(lesson.course))}<br>${esc(lesson.date)} · ${esc(lesson.title)}</p><form><label for="absence-status">Status</label><select id="absence-status" name="status">${Object.entries(Records.attendance).map(([value, label]) => `<option value="${value}" ${entry.status === value ? 'selected' : ''}>${label}</option>`).join('')}</select><label for="absence-comment">Kommentar (optional)</label><textarea id="absence-comment" name="comment" rows="3" maxlength="4000">${esc(entry.comment || '')}</textarea>${actions()}</form>`, f => mutate(() => Records.setResult(data.lessons.find(l => l.id === lessonId), { id: entry.student, name: entry.name }, f.get('status'), f.get('comment'))));
}
function gradeOptions(value) {
  return `<option value="">Keine Note</option>${[1, 2, 3, 4, 5, 6].map(v => `<option value="${v}" ${v === value ? 'selected' : ''}>${v}</option>`).join('')}`;
}
function assessmentForm(recordId, studentId, initialKind = 'test') {
  if (!data.courses.length) { courseForm(); return; }
  const record = data.assessments.find(a => a.id === recordId);
  const courseId = record?.course || currentCourse().id;
  let students = Records.roster(data, courseId, record).filter(s => !studentId || s.id === studentId);
  modal(`<h2>${record ? 'Noteneintrag bearbeiten' : 'Neuer Noteneintrag'}</h2><form>
    <label for="assessment-course">Kurs</label><select id="assessment-course" name="course" ${record ? 'disabled' : ''}>${courseSelect(courseId)}</select>
    ${studentId ? `<p>${esc(record.date)} · ${esc(record.title)}<br>${Records.kinds[record.kind]}</p>` : `<label for="assessment-kind">Eintragsart</label><select id="assessment-kind" name="kind">${Object.entries(Records.kinds).map(([kind, label]) => `<option value="${kind}" ${kind === (record?.kind || initialKind) ? 'selected' : ''}>${label}</option>`).join('')}</select>
    <div class="form-grid"><div><label for="assessment-date">Datum</label><input id="assessment-date" name="date" type="date" required value="${esc(record?.date || today())}"></div><div><label for="assessment-title">Titel / Anlass</label><input id="assessment-title" name="title" required value="${esc(record?.title || '')}" placeholder="z. B. Vokabeltest oder Halbjahreszeugnis"></div></div>`}
    <p><small>Schulnoten von 1 bis 6. Ohne Note entsteht kein Eintrag für dieses Kind. Vorläufige und Halbjahresnoten werden separat hervorgehoben und nicht mit Tests gemittelt.</small></p>
    <div id="grade-fields"></div>${actions()}</form>`, async f => {
    const course = record?.course || f.get('course');
    const grades = studentId ? record.grades.filter(g => g.student !== studentId).map(g => ({ ...g })) : [];
    students.forEach((s, i) => {
      if (f.get(`grade${i}`) !== '') grades.push({ student: s.id, name: s.name, grade: Number(f.get(`grade${i}`)), comment: f.get(`gradecomment${i}`) });
    });
    const draft = Records.assessment({
      id: record?.id || id(), course,
      date: studentId ? record.date : f.get('date'),
      title: studentId ? record.title : f.get('title'),
      kind: studentId ? record.kind : f.get('kind'),
      roster: Records.roster(data, course, record), grades,
    });
    selectedCourse = course;
    await mutate(() => {
      if (record) data.assessments[data.assessments.findIndex(a => a.id === record.id)] = draft;
      else data.assessments.push(draft);
    });
    toast('Noteneintrag gespeichert');
  }, !studentId);
  function fields() {
    $('#grade-fields').innerHTML = students.map((s, i) => {
      const grade = record?.grades.find(g => g.student === s.id);
      return `<section class="edit-student"><h3>${esc(s.name)}</h3><div class="form-grid"><div><label for="grade-${i}">Schulnote</label><select id="grade-${i}" name="grade${i}">${gradeOptions(grade?.grade)}</select></div><div><label for="grade-comment-${i}">Kommentar (optional)</label><textarea id="grade-comment-${i}" name="gradecomment${i}" rows="2" maxlength="4000">${esc(grade?.comment || '')}</textarea></div></div></section>`;
    }).join('');
  }
  fields();
  if (!record) $('#assessment-course').onchange = e => { students = Records.roster(data, e.target.value); fields(); };
}
function assessmentCard(entry) {
  return `<article class="assessment-card ${Records.isSummary(entry) ? 'summary-card' : ''}"><div class="row"><div><span class="badge">${Records.kinds[entry.kind]}</span><h3>${esc(entry.title)}</h3><small>${esc(entry.date)} · ${esc(courseName(entry.course))}</small></div><div><button class="textbtn" data-assessment-edit="${esc(entry.id)}">Eintrag bearbeiten</button><button class="textbtn danger" data-assessment-delete="${esc(entry.id)}">Löschen</button></div></div>
    <div class="table-scroll"><table><thead><tr><th>Name</th><th>Schulnote</th><th>Kommentar</th><th>Aktion</th></tr></thead><tbody>${entry.grades.map(g => `<tr><td>${esc(g.name)}</td><td><strong class="grade-number">${esc(g.grade)}</strong></td><td>${noteHTML(g.comment)}</td><td><button class="textbtn" data-assessment-edit="${esc(entry.id)}" data-student="${esc(g.student)}">Note bearbeiten</button></td></tr>`).join('')}</tbody></table></div></article>`;
}
function summarySection(entries) {
  return `<section class="panel summary-section spaced"><div class="row"><div><span class="eyebrow">Gesondert ausgewiesen</span><h2>Vorläufige & Halbjahresnoten</h2></div><button class="primary" id="add-summary">＋ Bilanznote eintragen</button></div><p>Bewusst vom laufenden Notenverlauf getrennt. Diese Noten fließen nicht in den Test- oder Mitarbeitsschnitt ein.</p>${entries.filter(Records.isSummary).sort((a, b) => b.date.localeCompare(a.date)).map(assessmentCard).join('') || '<p>Noch keine vorläufigen oder Halbjahresnoten erfasst.</p>'}</section>`;
}
function bindAssessments() {
  if ($('#add-summary')) $('#add-summary').onclick = () => assessmentForm(null, null, 'provisional');
  document.querySelectorAll('[data-assessment-edit]').forEach(b => b.onclick = () => assessmentForm(b.dataset.assessmentEdit, b.dataset.student));
  document.querySelectorAll('[data-assessment-delete]').forEach(b => b.onclick = () => {
    if (confirm('Diesen Noteneintrag mit allen zugehörigen Schulnoten löschen?')) mutate(() => data.assessments = data.assessments.filter(a => a.id !== b.dataset.assessmentDelete)).catch(() => {});
  });
}
function assessmentsView() {
  const course = currentCourse();
  $('#content').innerHTML = `<div class="row"><div><span class="eyebrow">Mehr als Mitarbeit</span><h1>Noteneinträge</h1><p>Tests, weitere Leistungen und Bilanznoten als Schulnoten von 1 bis 6.</p></div><button class="primary" id="add-assessment">＋ Noteneintrag</button></div>
    <label for="assessment-filter">Kurs</label><select class="course-filter" id="assessment-filter">${courseSelect()}</select><div id="assessment-list"></div>`;
  $('#add-assessment').onclick = () => assessmentForm();
  $('#assessment-filter').onchange = e => { selectedCourse = e.target.value; assessmentsView(); };
  if (!course) { $('#assessment-list').innerHTML = '<div class="panel empty">Lege zuerst einen Kurs an.</div>'; return; }
  const entries = data.assessments.filter(a => a.course === course.id);
  $('#assessment-list').innerHTML = `${summarySection(entries)}<section class="panel spaced"><h2>Tests & weitere Leistungen</h2><p>Diese Schulnoten bleiben vom Mitarbeitsschnitt auf der Skala −2 bis +2 getrennt.</p>${entries.filter(a => !Records.isSummary(a)).sort((a, b) => b.date.localeCompare(a.date)).map(assessmentCard).join('') || '<p>Noch keine Tests oder weiteren Leistungen erfasst.</p>'}</section>`;
  bindAssessments();
}
function balance() {
  const course = currentCourse();
  $('#content').innerHTML = `<span class="eyebrow">Entwicklung sichtbar machen</span><h1>Jahresbilanz</h1><p>Alle Einträge im Schuljahr ${esc(data.year)}. Mitarbeit und Schulnoten werden getrennt ausgewertet.</p><label for="coursefilter">Kurs</label><select id="coursefilter" class="course-filter">${courseSelect()}</select><div id="results"></div>`;
  $('#coursefilter').onchange = e => { selectedCourse = e.target.value; balance(); };
  if (!course) { $('#results').innerHTML = '<div class="panel empty">Lege zuerst einen Kurs an.</div>'; return; }
  const lessons = data.lessons.filter(l => l.course === course.id), entries = data.assessments.filter(a => a.course === course.id);
  const students = new Map(course.students.map(s => [s.id, s.name]));
  for (const record of [...lessons, ...entries]) for (const student of Records.roster(data, course.id, record)) if (!students.has(student.id)) students.set(student.id, student.name);
  $('#results').innerHTML = `${summarySection(entries)}<section class="panel spaced"><h2>${esc(course.name)} · ${lessons.length} erfasste ${lessons.length === 1 ? 'Stunde' : 'Stunden'}</h2>
    <div class="table-scroll"><table class="balance-table"><thead><tr><th>Name</th><th>Bewertungen</th><th>+ + / + / 0 / − / − −</th><th>Mitarbeit Ø<br>−2 bis +2</th><th>Tests / weitere Leistungen Ø<br>1 bis 6</th><th>Fehlstunden</th></tr></thead><tbody>${[...students].map(([sid, name]) => {
      const r = Records.ratings(data, course.id, sid), a = Records.absences(data, course.id).filter(a => a.student === sid);
      return `<tr><td>${esc(name)}</td><td>${r.length}</td><td>${[2, 1, 0, -1, -2].map(v => r.filter(a => a.value === v).length).join(' / ')}</td><td><strong>${avg(sid, course.id)}</strong></td><td>${Records.gradeMean(data, course.id, sid)}</td><td>${a.length}${a.some(a => a.status === 'open') ? ` <span class="status open">${a.filter(a => a.status === 'open').length} offen</span>` : ''}</td></tr>`;
    }).join('')}</tbody></table></div><p><small>Arithmetische Schnitte; keine automatische Gesamtnote. Bilanznoten werden separat geführt.</small></p></section>
    <section class="panel spaced"><div class="row"><h2>Stundenverlauf & Kommentare</h2><button class="textbtn" id="add-from-balance">＋ Stunde bewerten</button></div>${lessons.slice().sort((a, b) => b.date.localeCompare(a.date)).map(lessonHTML).join('') || '<p>Noch keine Stunden erfasst.</p>'}</section>
    <section class="panel spaced"><div class="row"><h2>Tests & weitere Leistungen</h2><button class="textbtn" id="add-test">＋ Noteneintrag</button></div>${entries.filter(a => !Records.isSummary(a)).sort((a, b) => b.date.localeCompare(a.date)).map(assessmentCard).join('') || '<p>Noch keine Tests oder weiteren Leistungen erfasst.</p>'}</section>`;
  $('#add-from-balance').onclick = () => startForm(course.id);
  $('#add-test').onclick = () => assessmentForm();
  document.querySelectorAll('[data-lesson-edit]').forEach(b => b.onclick = () => lessonForm(b.dataset.lessonEdit, b.dataset.student));
  document.querySelectorAll('[data-delete]').forEach(b => b.onclick = () => {
    if (confirm('Diese Stunde mit ihren Bewertungen, Kommentaren und Fehlzeiten dauerhaft löschen?')) mutate(() => data.lessons = data.lessons.filter(l => l.id !== b.dataset.delete)).catch(() => {});
  });
  bindAssessments();
}
function lessonHTML(lesson) {
  const students = Records.roster(data, lesson.course, lesson);
  return `<details class="lesson-history"><summary>${esc(lesson.date)} · ${esc(lesson.title)} <small>(${lesson.ratings.length} Bewertungen · ${lesson.absences.length} Abwesenheiten)</small></summary><div class="row spaced"><button class="textbtn" data-lesson-edit="${esc(lesson.id)}">Stunde bearbeiten</button><button class="textbtn danger" data-delete="${esc(lesson.id)}">Stunde löschen</button></div><div class="table-scroll"><table><thead><tr><th>Name</th><th>Bewertung / Anwesenheit</th><th>Kommentar</th><th>Aktion</th></tr></thead><tbody>${students.map(s => {
    const value = Records.result(lesson, s.id);
    const label = value === 'skip' ? '<span class="muted">Ohne Eintrag</span>' : Object.hasOwn(Records.attendance, value) ? `<span class="status ${value}">Abwesend · ${Records.attendance[value]}</span>` : symbols[Number(value) + 2];
    return `<tr><td>${esc(s.name)}</td><td>${label}</td><td>${noteHTML(Records.comment(lesson, s.id))}</td><td><button class="textbtn" data-lesson-edit="${esc(lesson.id)}" data-student="${esc(s.id)}">Bewertung bearbeiten</button></td></tr>`;
  }).join('')}</tbody></table></div></details>`;
}

let reminderInterval=null,reminderLastCheck=0,reminderSeen=new Set(),reminderChecking=false;
function stopReminders() {
  if(reminderInterval) clearInterval(reminderInterval);
  reminderInterval=null;reminderLastCheck=0;reminderSeen.clear();
}
async function notification(text='Zeit, die Mitarbeit der letzten Unterrichtsstunde einzutragen.') {
  if(typeof Notification==='undefined' || Notification.permission!=='granted') throw Error('Browser-Benachrichtigungen sind nicht erlaubt.');
  if('serviceWorker' in navigator) {
    await navigator.serviceWorker.register('reminder-sw.js');
    const ready=await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('Benachrichtigungsdienst ist nicht bereit.')),5000))]);
    if(!key)return;
    await ready.showNotification('Klassenbuch · Erinnerung',{body:text,tag:'klassenbuch-reminder'});
  } else new Notification('Klassenbuch · Erinnerung',{body:text,tag:'klassenbuch-reminder'});
}
async function checkReminders(now=new Date()) {
  if(!key || !data || reminderChecking) return;
  reminderChecking=true;
  try {
    const due=Reminders.due(data,now,reminderLastCheck || now.getTime()-60000).filter(item=>!reminderSeen.has(item.id));
    reminderLastCheck=now.getTime();
    if(due.length) {
      await notification();
      due.forEach(item=>reminderSeen.add(item.id));
    }
  } catch(error) {toast('Erinnerung nicht angezeigt: '+error.message);}
  finally {reminderChecking=false;}
}
function startReminders() {
  if(!key || !Reminders.settings(data.reminders).enabled || typeof Notification==='undefined' || Notification.permission!=='granted') {
    stopReminders();return;
  }
  if(reminderInterval) return;
  reminderLastCheck=Date.now()-60000;
  reminderInterval=setInterval(()=>checkReminders(),30000);
  checkReminders();
}
function remindersView() {
  const config=Reminders.settings(data.reminders);
  const permission=typeof Notification==='undefined'?'unsupported':Notification.permission;
  const label={granted:'Erlaubt',denied:'Blockiert – bitte in den Browser-Einstellungen ändern',default:'Noch nicht erlaubt',unsupported:'Von diesem Browser nicht unterstützt'}[permission];
  $('#content').innerHTML=`<span class="eyebrow">Noten rechtzeitig festhalten</span><h1>Erinnerungen</h1>
    <section class="panel"><h2>Erinnerung anhand deines Stundenplans</h2><p>Benachrichtigungen funktionieren derzeit, solange Klassenbuch geöffnet und entsperrt bleibt. Bei geschlossener oder gesperrter App werden keine Erinnerungen ausgelöst. Browser und Betriebssystem können Hintergrund-Tabs verzögern.</p>
    <p>Benachrichtigungen auf diesem Gerät: <strong>${esc(label)}</strong></p><div class="row"><button id="allow-notifications" ${['denied','unsupported'].includes(permission)?'disabled':''}>Benachrichtigungen erlauben</button><button id="test-notification" ${permission!=='granted'?'disabled':''}>Testbenachrichtigung</button></div>
    <form id="reminder-form"><label for="reminder-enabled">Erinnerungen</label><select id="reminder-enabled" name="enabled"><option value="false" ${!config.enabled?'selected':''}>Aus</option><option value="true" ${config.enabled?'selected':''}>Ein</option></select>
    <label for="reminder-mode">Wann erinnern?</label><select id="reminder-mode" name="mode"><option value="after" ${config.mode==='after'?'selected':''}>Nach jeder Unterrichtsstunde</option><option value="daily" ${config.mode==='daily'?'selected':''}>Einmal täglich an Unterrichtstagen</option></select>
    <div class="form-grid"><div><label for="reminder-delay">Nach Stundenende</label><select id="reminder-delay" name="delay">${[0,5,10,15].map(n=>`<option value="${n}" ${config.delay===n?'selected':''}>${n} Minuten</option>`).join('')}</select></div><div><label for="reminder-time">Tägliche Uhrzeit</label><input id="reminder-time" name="time" type="time" value="${esc(config.time)}" required></div></div>
    <p><small>Das Stundenende ergibt sich aus Beginn + Dauer im Stundenplan (bisherige Stunden: 45 Minuten). Uhrzeiten gelten in der lokalen Zeitzone dieses Geräts. Verspätungen bis fünf Minuten werden nachgeholt, ältere Erinnerungen nicht. Gleichzeitige Stunden lösen eine gemeinsame Nachricht aus.</small></p><p><small>Die Einstellungen werden verschlüsselt auf dem Server gespeichert. Die Browser-Berechtigung muss auf jedem Gerät separat erteilt werden. Der Stundenplan und die Erinnerungstermine bleiben verschlüsselt; die Benachrichtigung nennt keine Schüler oder Kurse.</small></p>
    <button class="primary" type="submit">Erinnerungen speichern</button></form></section>`;
  $('#allow-notifications').onclick=async()=>{try{await Notification.requestPermission();startReminders();remindersView();}catch(error){toast(error.message);}};
  $('#test-notification').onclick=()=>notification('Test: Klassenbuch-Erinnerungen sind auf diesem Gerät erlaubt.').catch(error=>toast(error.message));
  $('#reminder-form').onsubmit=async event=>{
    event.preventDefault();const button=event.target.querySelector('[type="submit"]');button.disabled=true;
    try {
      const fields=new FormData(event.target);
      const next=Reminders.validate({enabled:fields.get('enabled')==='true',mode:fields.get('mode'),delay:Number(fields.get('delay')),time:fields.get('time')});
      if(next.enabled && permission!=='granted') throw Error('Bitte zuerst Benachrichtigungen auf diesem Gerät erlauben.');
      await mutate(()=>data.reminders=next);toast('Erinnerungen gespeichert');
    }catch(error){toast(error.message);button.disabled=false;}
  };
}

async function exportCsv() {
  if (!confirm('Diese CSV enthält Namen, Noten, Fehlzeiten und Kommentare unverschlüsselt. Nur an einem sicheren Ort speichern. Exportieren?')) return;
  try {
    await queue;
    const remote=await readVault();
    const latest=Records.normalize(JSON.parse(new TextDecoder().decode(await decrypt(key,un64(remote.envelope.iv),un64(remote.envelope.cipher)))));
    const link=document.createElement('a');
    link.href=URL.createObjectURL(new Blob([CsvExport.build(latest)],{type:'text/csv;charset=utf-8'}));
    link.download='klassenbuch-export-'+new Date().toISOString().slice(0,10)+'.csv';
    link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);
  } catch(error) {toast(error.message);}
}
async function exportBackup() {
  try { await queue; const remote = await readVault(); downloadEnvelope(JSON.stringify(remote.envelope)); }
  catch (error) { toast(error.message); }
}
function importBackup() {
  const input = document.createElement('input'); input.type = 'file'; input.accept = '.json';
  input.onchange = async () => {
    try {
      if (!input.files[0]) return;
      const envelope = JSON.parse(await input.files[0].text());
      const password = prompt('Passwort des Backups eingeben:'); if (!password) return;
      const opened = await openEnvelope(envelope, password);
      if (serverState.exists) {
        if (!key || !authToken) throw Error('Bitte zuerst das Server-Klassenbuch entsperren.');
        if (!confirm('Serverdaten durch das Backup ersetzen? Das Passwort des Server-Klassenbuchs bleibt unverändert.')) return;
        await mutate(() => data = opened.contents);
      } else {
        key = opened.key; salt = opened.salt; data = opened.contents;
        authToken = await deriveAuth(password, salt);
        await persist(envelope);
        resetTimer(); render();
      }
      toast('Backup auf dem Server gespeichert.');
    } catch (error) { toast('Import fehlgeschlagen: ' + error.message); }
  };
  input.click();
}
gate();
