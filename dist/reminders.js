// Scheduling uses only the decrypted in-memory timetable. No schedule is sent
// separately to the server or persisted unencrypted in a service worker.
const Reminders = (() => {
  const defaults = {enabled:false,mode:'after',delay:5,time:'16:00'};
  const dateKey = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  function settings(value) {
    return {...defaults,...value};
  }
  function validate(value) {
    if (typeof value.enabled !== 'boolean' || !['after','daily'].includes(value.mode) || ![0,5,10,15].includes(value.delay) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time)) throw Error('Ungültige Erinnerungseinstellungen');
    return {...value};
  }
  function due(data, now = new Date(), since = now.getTime()-60000) {
    const config=settings(data.reminders);
    if (!config.enabled) return [];
    const result=[], lower=Math.max(since,now.getTime()-5*60000);
    for (const offset of [-1,0]) {
      const date=new Date(now.getFullYear(),now.getMonth(),now.getDate()+offset);
      const day=(date.getDay()+6)%7;
      const slots=data.slots.filter(slot=>slot.day===day && data.courses.some(c=>c.id===slot.course));
      if (!slots.length) continue;
      const occurrences=config.mode==='daily'?[{id:'daily',time:config.time,duration:0}]:slots;
      for (const slot of occurrences) {
        const [hour,minute]=slot.time.split(':').map(Number);
        const at=new Date(date.getFullYear(),date.getMonth(),date.getDate(),hour,minute);
        if(config.mode==='after') at.setMinutes(at.getMinutes()+(slot.duration || 45)+config.delay);
        if(at.getTime()>lower && at.getTime()<=now.getTime()) result.push({id:`${dateKey(date)}:${slot.id}:${at.getTime()}:${config.mode}`,at:at.getTime()});
      }
    }
    return result;
  }
  return {settings,validate,due};
})();
