// Plain data operations shared by the UI and regression tests. Everything is
// persisted inside the existing encrypted envelope, never in a separate store.
const Records = (() => {
  const attendance = { open: 'Offen', excused: 'Entschuldigt', unexcused: 'Unentschuldigt' };
  const kinds = {
    test: 'Test / Klassenarbeit',
    other: 'Weitere Leistung',
    provisional: 'Vorläufige Note',
    semester1: 'Halbjahresnote · 1. Halbjahr',
    semester2: 'Halbjahresnote · 2. Halbjahr',
  };
  const isSummary = entry => ['provisional', 'semester1', 'semester2'].includes(entry.kind);

  function normalize(data) {
    if (!data || !Array.isArray(data.courses) || !Array.isArray(data.lessons) || !Array.isArray(data.slots)) {
      throw Error('Ungültiges Klassenbuch');
    }
    if (data.assessments === undefined) data.assessments = [];
    if (!Array.isArray(data.assessments)) throw Error('Ungültige Noteneinträge');
    for (const lesson of data.lessons) {
      if (!Array.isArray(lesson.ratings)) throw Error('Ungültige Stunde');
      // Legacy skipped cards do not prove an absence. Never infer absences.
      if (lesson.absences === undefined) lesson.absences = [];
      if (!Array.isArray(lesson.absences)) throw Error('Ungültige Fehlzeiten');
    }
    return data;
  }

  function roster(data, courseId, record) {
    const students = new Map();
    for (const student of data.courses.find(c => c.id === courseId)?.students || []) students.set(student.id, { ...student });
    for (const student of [...(record?.roster || []), ...(record?.ratings || []), ...(record?.absences || []), ...(record?.grades || [])]) {
      if (!students.has(student.student || student.id)) {
        const id = student.student || student.id;
        students.set(id, { id, name: student.name });
      }
    }
    return [...students.values()];
  }

  function result(lesson, studentId) {
    const rating = lesson.ratings.find(r => r.student === studentId);
    if (rating) return String(rating.value);
    return lesson.absences?.find(a => a.student === studentId)?.status || 'skip';
  }

  function comment(lesson, studentId) {
    return [...lesson.ratings, ...(lesson.absences || [])].find(r => r.student === studentId)?.comment || '';
  }

  function setResult(lesson, student, outcome, note = '') {
    if (outcome !== 'skip' && !Object.hasOwn(attendance, outcome) && !['-2', '-1', '0', '1', '2'].includes(outcome)) {
      throw Error('Ungültige Bewertung');
    }
    const entry = { student: student.id, name: student.name, comment: String(note).trim() };
    lesson.ratings = lesson.ratings.filter(r => r.student !== student.id);
    lesson.absences = (lesson.absences || []).filter(a => a.student !== student.id);
    if (Object.hasOwn(attendance, outcome)) lesson.absences.push({ ...entry, status: outcome });
    else if (outcome !== 'skip') lesson.ratings.push({ ...entry, value: Number(outcome) });
  }

  function ratings(data, course, student) {
    return data.lessons.filter(l => l.course === course).flatMap(l => l.ratings.filter(r => r.student === student));
  }

  function mean(values) {
    return values.length ? (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2).replace('.', ',') : '–';
  }

  function absences(data, course) {
    return data.lessons.filter(l => !course || l.course === course).flatMap(lesson => (lesson.absences || []).map(absence => ({ ...absence, lesson })))
      .sort((a, b) => b.lesson.date.localeCompare(a.lesson.date));
  }

  function assessment(input) {
    if (!Object.hasOwn(kinds, input.kind)) throw Error('Ungültige Eintragsart');
    if (!input.course || !/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !input.title.trim()) throw Error('Bitte Kurs, Datum und Titel angeben.');
    if (!input.grades.length) throw Error('Bitte mindestens eine Schulnote eintragen.');
    const seen = new Set();
    for (const grade of input.grades) {
      if (!Number.isInteger(grade.grade) || grade.grade < 1 || grade.grade > 6) throw Error('Schulnoten müssen ganze Zahlen von 1 bis 6 sein.');
      if (seen.has(grade.student)) throw Error('Doppelte Schülerbewertung');
      seen.add(grade.student);
    }
    return { ...input, title: input.title.trim(), grades: input.grades.map(g => ({ ...g, comment: (g.comment || '').trim() })) };
  }

  function gradeMean(data, course, student) {
    return mean(data.assessments.filter(a => a.course === course && !isSummary(a)).flatMap(a => a.grades.filter(g => g.student === student).map(g => g.grade)));
  }

  return { attendance, kinds, isSummary, normalize, roster, result, comment, setResult, ratings, mean, absences, assessment, gradeMean };
})();
