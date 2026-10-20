// Notification display/click handling only. No keys, timetable or user data.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows=await clients.matchAll({type:'window',includeUncontrolled:true});
    for (const window of windows) if (new URL(window.url).origin===self.location.origin) {await window.focus();return;}
    await clients.openWindow('./');
  })());
});
