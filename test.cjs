const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const crypto=require('node:crypto').webcrypto;
const el={innerHTML:'',querySelector:()=>el,style:{},value:'',addEventListener(){}};
let stored={};
const ctx={crypto,TextEncoder,TextDecoder,btoa,atob,location:{protocol:'http:',hostname:'server'},document:{querySelector:()=>el,addEventListener(){}},localStorage:{getItem:k=>stored[k],setItem:(k,v)=>stored[k]=v},setTimeout,clearTimeout,console};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname+'/dist/sjcl.js','utf8'),ctx);
vm.runInContext(fs.readFileSync(__dirname+'/dist/app.js','utf8').replace(/gate\(\);\s*$/,''),ctx);
vm.runInContext(`(async()=>{
 salt=crypto.getRandomValues(new Uint8Array(16));
 const password='Sicheres Testpasswort mit Umlauten äöü';
 key=await derive(password,salt);
 data={year:'2026/27',courses:[{id:'c',name:'8a',students:[{id:'s',name:'Geheimer Name'}]}],slots:[],lessons:[{course:'c',ratings:[{student:'s',value:2},{student:'s',value:-1}]}]};
 await save();const raw=localStorage.getItem(STORE),v=JSON.parse(raw);
 if(raw.includes('Geheimer Name'))throw Error('Klartext gespeichert');
 const plain=JSON.parse(new TextDecoder().decode(await decrypt(key,un64(v.iv),un64(v.cipher))));
 if(plain.courses[0].students[0].name!=='Geheimer Name')throw Error('Roundtrip');
 if(avg('s','c')!=='0,50')throw Error('Schnitt');
 const fallbackKey=sjcl.misc.pbkdf2(password,bits(salt),600000,256);
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
 const first=JSON.parse(localStorage.getItem(STORE));await save();
 if(first.iv===JSON.parse(localStorage.getItem(STORE)).iv)throw Error('IV wiederverwendet');
 // HTTP entry screen must render without SubtleCrypto or randomUUID.
 crypto={getRandomValues:crypto.getRandomValues.bind(crypto)};
 gate();
 if(!document.querySelector('#app').innerHTML.includes('HTTP-Verbindung'))throw Error('HTTP-Hinweis fehlt');
 console.log('PASS: encryption, legacy format, HTTP/native interoperability, wrong passwords, tampering, IV, average, HTTP entry');
})()`,ctx).catch(e=>{console.error(e);process.exitCode=1});
