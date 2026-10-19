// PBKDF2 fallback for HTTP LAN origins without SubtleCrypto. No cached passwords.
importScripts('sjcl.js');
onmessage = ({data}) => {
  try {
    const key = sjcl.misc.pbkdf2(data.password, sjcl.codec.base64.toBits(data.salt), 600000, 256);
    postMessage({key});
  } catch { postMessage({error: 'Passwortableitung fehlgeschlagen'}); }
  close();
};
