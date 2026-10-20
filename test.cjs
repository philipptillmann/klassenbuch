const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const crypto=require('node:crypto').webcrypto;
const el={innerHTML:'',querySelector:()=>el,style:{},value:'',addEventListener(){}};
let stored={}, remoteEnvelope=null, revision=0;
async function fetchMock(path, options={}) {
 if(path==='/api/vault/status') return {ok:true,json:async()=>({exists:!!remoteEnvelope,salt:remoteEnvelope?.salt,revision})};
 if(options.method==='POST'||options.method==='PUT') {
  remoteEnvelope=JSON.parse(options.body).envelope; revision++;
  return {ok:true,json:async()=>({revision})};
 }
 return {ok:true,json:async()=>({envelope:remoteEnvelope,revision})};
}
const ctx={fetch:fetchMock,getRemote:()=>JSON.stringify(remoteEnvelope),crypto,TextEncoder,TextDecoder,btoa,atob,location:{protocol:'http:',hostname:'server'},document:{querySelector:()=>el,addEventListener(){}},localStorage:{getItem:k=>stored[k],setItem:()=>{throw Error("Unexpected local storage write")}},setTimeout,clearTimeout,console};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname+'/dist/sjcl.js','utf8'),ctx);
vm.runInContext(fs.readFileSync(__dirname+'/dist/records.js','utf8'),ctx);
vm.runInContext(fs.readFileSync(__dirname+'/dist/app.js','utf8').replace(/gate\(\);\s*$/,''),ctx);
vm.runInContext(`(async()=>{
 salt=crypto.getRandomValues(new Uint8Array(16));
 const password='Sicheres Testpasswort mit Umlauten äöü';
 key=await derive(password,salt); authToken=await deriveAuth(password,salt);
 data={year:'2026/27',courses:[{id:'c',name:'8a',students:[{id:'s',name:'Geheimer Name'}]}],slots:[],lessons:[{course:'c',ratings:[{student:'s',value:2,comment:'Vertraulicher Kommentar'},{student:'s',value:-1}],absences:[{student:'absent',name:'Testkind fehlt',status:'open'}]}],assessments:[{id:'grade',course:'c',kind:'test',date:'2026-10-20',title:'Testeintrag',grades:[{student:'s',grade:2,comment:'Geschützte Schulnote'}]}]};
 await save();const raw=getRemote(),v=JSON.parse(raw);
 if(['Geheimer Name','Vertraulicher Kommentar','Testkind fehlt','Geschützte Schulnote'].some(text=>raw.includes(text)))throw Error('Klartext gespeichert');
 const plain=JSON.parse(new TextDecoder().decode(await decrypt(key,un64(v.iv),un64(v.cipher))));
 if(plain.courses[0].students[0].name!=='Geheimer Name')throw Error('Roundtrip');
 if(avg('s','c')!=='0,50')throw Error('Schnitt');
 const fallbackKey=sjcl.misc.pbkdf2(password,bits(salt),600000,256);
 const authDomain=new TextEncoder().encode('klassenbuch-server-auth-v1:');
 const authSalt=new Uint8Array(authDomain.length+salt.length);authSalt.set(authDomain);authSalt.set(salt,authDomain.length);
 if(authToken!==b64(bytes(sjcl.misc.pbkdf2(password,bits(authSalt),600000,256))))throw Error('Auth compatibility');
 const fallbackPlain=await decrypt(fallbackKey,un64(v.iv),un64(v.cipher));
 if(new TextDecoder().decode(fallbackPlain)!==JSON.stringify(data))throw Error('WebCrypto -> HTTP');
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const fallbackCipher=await encrypt(fallbackKey,iv,fallbackPlain);
 const nativePlain=await decrypt(key,iv,fallbackCipher);
 if(b64(nativePlain)!==b64(fallbackPlain))throw Error('HTTP -> WebCrypto');
 const wrong=await derive('Falsch',salt);
 for(const k of [wrong,sjcl.misc.pbkdf2('Falsch',bits(salt),600000,256)]){
  let rejected=false;try{await decrypt(k,un64(v.iv),un64(v.cipher))}catch{rejected=true}
  if(!rejected)throw Error('Falsches Passwort akzeptiert');
 }
 const tampered=un64(v.cipher);tampered[0]^=1;
 for(const k of [key,fallbackKey]){
  let rejected=false;try{await decrypt(k,un64(v.iv),tampered)}catch{rejected=true}
  if(!rejected)throw Error('Manipulation akzeptiert');
 }
 // Large school-year backups must not overflow the JS argument stack.
 const large=crypto.getRandomValues(new Uint8Array(65536));
 if(b64(un64(b64(large)))!==b64(large))throw Error('Base64');
 const first=JSON.parse(getRemote());await save();
 if(first.iv===JSON.parse(getRemote()).iv)throw Error('IV wiederverwendet');
 if(authToken===b64(bytes(fallbackKey)))throw Error('Auth token equals encryption key');
 // HTTP entry screen must render without SubtleCrypto or randomUUID.
 crypto={getRandomValues:crypto.getRandomValues.bind(crypto)};
 await gate();
 if(!document.querySelector('#app').innerHTML.includes('HTTP-Verbindung'))throw Error('HTTP-Hinweis fehlt');
 console.log('PASS: encryption, legacy format, HTTP/native interoperability, wrong passwords, tampering, IV, average, HTTP entry');
})()`,ctx).catch(e=>{console.error(e);process.exitCode=1});
