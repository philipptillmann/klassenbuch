// Runs without an open/unlocked window. No password, vault token or data key.
self.addEventListener('push',event=>{
  // Always use generic content. No decrypted user data is needed or cached.
  event.waitUntil(self.registration.showNotification('Klassenbuch · Erinnerung',{
    body:'Zeit, die Mitarbeit der letzten Unterrichtsstunde einzutragen.',
    tag:'klassenbuch-reminder',icon:'icon-192.png',badge:'icon-192.png'
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const windows=await clients.matchAll({type:'window',includeUncontrolled:true});
    for(const window of windows)if(new URL(window.url).origin===self.location.origin){await window.focus();return;}
    await clients.openWindow('./');
  })());
});
