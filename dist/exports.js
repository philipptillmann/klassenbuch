// RFC 4180 quoting with German Excel delimiter and UTF-8 BOM.
const CsvExport = (() => {
  function cell(value) {
    let text = String(value ?? '');
    // Quoting alone does not prevent spreadsheet formula execution.
    if (typeof value !== 'number' && (/^\s*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text))) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }
  function build(data) {
    const rows = [['Schuljahr', 'Kurs', 'Fach', 'Datum', 'Eintragsart', 'Titel', 'Schüler', 'Schüler-ID', 'Bewertung', 'Punkte', 'Schulnote', 'Fehlzeitenstatus', 'Kommentar']];
    const course = id => data.courses.find(c => c.id === id) || {name:'Ehemaliger Kurs',subject:''};
    const append = (record, entry, kind, rating='', points='', grade='', status='') => {
      const c = course(record.course);
      rows.push([data.year,c.name,c.subject,record.date,kind,record.title,entry.name,entry.student,rating,points,grade,status,entry.comment || '']);
    };
    for (const c of data.courses) for (const student of c.students) {
      append({course:c.id,date:'',title:''},{student:student.id,name:student.name},'Schüler');
    }
    for (const lesson of data.lessons) {
      for (const r of lesson.ratings) append(lesson,r,'Mitarbeit',['− −','−','0','+','+ +'][r.value+2],r.value);
      for (const a of lesson.absences || []) append(lesson,a,'Abwesenheit','','','',Records.attendance[a.status] || a.status);
    }
    for (const record of data.assessments || []) for (const grade of record.grades) {
      append(record,grade,Records.kinds[record.kind] || record.kind,'','',grade.grade);
    }
    return '\uFEFF' + rows.map(row=>row.map(cell).join(';')).join('\r\n') + '\r\n';
  }
  return {build};
})();
