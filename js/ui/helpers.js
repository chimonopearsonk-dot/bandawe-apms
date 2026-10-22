/** Escape untrusted strings before inserting into innerHTML. */
export function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function debounce(fn, wait = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

export function fmtDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return ''; }
}
/** Convert "tiwonge mhone" / "TIWONGE MHONE" / "o'brien banda" → "Tiwonge Mhone" / "O'Brien Banda" */
export function titleCase(str) {
  if (!str) return '';
  return String(str)
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/(^|[\s\-'’])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
}
/**
 * Wires up a show/hide toggle button for a password input.
 * @param {string} inputId
 * @param {string} toggleId
 * @param {string} iconId
 */
export function wirePasswordToggle(inputId, toggleId, iconId) {
  const input  = document.getElementById(inputId);
  const toggle = document.getElementById(toggleId);
  const icon   = document.getElementById(iconId);
  if (!input || !toggle || !icon) return;

  toggle.addEventListener('click', () => {
    const isPw = input.type === 'password';
    input.type = isPw ? 'text' : 'password';
    icon.className = isPw ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
  });
}