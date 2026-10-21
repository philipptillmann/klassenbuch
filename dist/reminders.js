// Timetable is decrypted only in the browser. With approved background Push,
// only computed UTC timestamps are sent to the server.
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
  function occurrences(data,date,config) {
    const day=(date.getDay()+6)%7;
    const slots=data.slots.filter(slot=>slot.day===day && data.courses.some(c=>c.id===slot.course));
    if(!slots.length)return [];
    return (config.mode==='daily'?[{id:'daily',time:config.time,duration:0}]:slots).map(slot=>{
      const [hour,minute]=slot.time.split(':').map(Number);
      const at=new Date(date.getFullYear(),date.getMonth(),date.getDate(),hour,minute);
      if(config.mode==='after')at.setMinutes(at.getMinutes()+(Number(slot.duration)||45)+config.delay);
      return {id:`${dateKey(date)}:${slot.id}:${at.getTime()}:${config.mode}`,at:at.getTime()};
    });
  }
  function due(data, now = new Date(), since = now.getTime()-60000) {
    const config=settings(data.reminders);
    if(!config.enabled)return [];
    const lower=Math.max(since,now.getTime()-5*60000),result=[];
    for(const offset of [-1,0]){
      const date=new Date(now.getFullYear(),now.getMonth(),now.getDate()+offset);
      result.push(...occurrences(data,date,config).filter(item=>item.at>lower && item.at<=now.getTime()));
    }
    return result;
  }
  function upcoming(data, now = new Date(), days = 365) {
    const config=settings(data.reminders);
    if(!config.enabled)return [];
    const times=new Set();
    for(let offset=-1;offset<=days;offset++){
      const date=new Date(now.getFullYear(),now.getMonth(),now.getDate()+offset);
      for(const item of occurrences(data,date,config))if(item.at>=now.getTime()-60000)times.add(Math.floor(item.at/1000));
    }
    return [...times].sort((a,b)=>a-b);
  }
  return {settings,validate,due,upcoming};
})();
