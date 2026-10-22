/**
 * GLOBAL CONFIGURATION
 * All dynamic lists live here. Nothing else in the codebase
 * should hard-code subjects, classes, zones, or months.
 */

export const SUBJECTS = [
  { code: 'ART',  short: 'Arts',      name: 'Arts and Life Skills' },
  { code: 'CHI',  short: 'Chichewa',  name: 'Chichewa' },
  { code: 'ENG',  short: 'English',   name: 'English' },
  { code: 'MATH', short: 'Maths',     name: 'Mathematics' },
  { code: 'SCI',  short: 'Science',   name: 'Primary Science' },
  { code: 'SST',  short: 'Soc/BK',    name: 'Social & BK/RE' },
];

export const CLASSES = [
  'Standard 1', 'Standard 2', 'Standard 3', 'Standard 4',
  'Standard 5', 'Standard 6', 'Standard 7', 'Standard 8',
];

/**
 * Assessment months — real month names, editable via admin settings later.
 * These are the CA (Continuous Assessment) columns for a term.
 */
export const ASSESSMENT_MONTHS = [
  { id: 'm1', label: 'February' },
  { id: 'm2', label: 'March' },
  { id: 'm3', label: 'April' },
];

export const GRADE_BANDS = [
  { min: 80, letter: 'A', status: 'Pass', color: 'text-emerald-700 bg-emerald-50' },
  { min: 70, letter: 'B', status: 'Pass', color: 'text-blue-700 bg-blue-50' },
  { min: 55, letter: 'C', status: 'Pass', color: 'text-indigo-700 bg-indigo-50' },
  { min: 40, letter: 'D', status: 'Pass', color: 'text-amber-700 bg-amber-50' },
  { min: 0,  letter: 'F', status: 'Fail', color: 'text-red-700 bg-red-50' },
];

export const DEFAULT_ZONES = [
  { code: 'BZ', name: 'Bandawe', emisPrefix: 'BZ-' },
];

export const ACADEMIC_DEFAULTS = {
  year: '2026',
  term: 'Term 1',
};

export const CA_MAX  = 100;    // per CA assessment per subject
export const EXAM_MAX = 100;  // per end-of-term exam per subject
export const MOCK_MAX = 100;  // per mock exam per subject

/**
 * Class abbreviation used to build LINs: "Standard 8" -> "STD8"
 */
export function classAbbrev(className) {
  const num = String(className).replace(/[^0-9]/g, '');
  return num ? `STD${num}` : 'STDX';
}

/**
 * Build a subject map {code: {...}} for quick lookup.
 */
export const SUBJECT_BY_CODE = SUBJECTS.reduce((acc, s) => {
  acc[s.code] = s; return acc;
}, {});
/**
 * Per-class exam structure. Editable later via Superadmin Academic Settings.
 *  - subjects: which subjects are administered in this class
 *  - maxPerSubject: score ceiling per subject
 *
 * The class total = subjects.length × maxPerSubject.
 * A learner who didn't sit a subject still contributes 0 — the total is
 * always out of the class-wide maximum, keeping rankings fair.
 */
export const CLASS_EXAM_SCHEMA = {
  'Standard 1': { subjects: ['ENG', 'MATH', 'CHI'],                       maxPerSubject: 50 },
  'Standard 2': { subjects: ['ENG', 'MATH', 'CHI'],                       maxPerSubject: 50 },
  'Standard 3': { subjects: ['ENG', 'MATH', 'SCI', 'CHI', 'SST'],         maxPerSubject: 100 },
  'Standard 4': { subjects: ['ENG', 'MATH', 'SCI', 'CHI', 'SST'],         maxPerSubject: 100 },
  'Standard 5': { subjects: ['ENG', 'MATH', 'SCI', 'SST', 'CHI', 'ART'],  maxPerSubject: 100 },
  'Standard 6': { subjects: ['ENG', 'MATH', 'SCI', 'SST', 'CHI', 'ART'],  maxPerSubject: 100 },
  'Standard 7': { subjects: ['ENG', 'MATH', 'SCI', 'SST', 'CHI', 'ART'],  maxPerSubject: 100 },
  'Standard 8': { subjects: ['ENG', 'MATH', 'SCI', 'SST', 'CHI', 'ART'],  maxPerSubject: 100 },
};

/**
 * Academic terms and their CA assessment months.
 * The CA grid auto-reads the currently active term from AppState.academicConfig.
 */
export const ACADEMIC_TERMS = {
  'Term 1': ['September', 'October', 'November'],
  'Term 2': ['January',   'February', 'March'],
  'Term 3': ['May',       'June',      'July'],
};