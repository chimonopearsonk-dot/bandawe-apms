/**
 * File → rows importer. Supports .csv, .txt, .xlsx, .xls, .json.
 * Returns an array of plain objects (header → value).
 */
import { loadVendor } from '../core/vendor-loader.js';
export const ImportService = {
  /**
   * @param {File} file
   * @returns {Promise<Array<Object>>}
   */
  async parse(file) {
    if (!file) throw new Error('No file provided.');
    const name = file.name.toLowerCase();

    if (name.endsWith('.json')) return this._parseJson(file);
    if (name.endsWith('.csv') || name.endsWith('.txt')) return this._parseText(file);
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) return this._parseXlsx(file);

    throw new Error('Unsupported file type. Use .csv, .txt, .xlsx, .xls, or .json.');
  },

  _parseJson(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = e => {
        try {
          const data = JSON.parse(e.target.result);
          if (!Array.isArray(data)) return reject(new Error('JSON must be an array of objects.'));
          resolve(data);
        } catch (err) { reject(new Error('Invalid JSON file.')); }
      };
      r.onerror = () => reject(new Error('Failed to read JSON file.'));
      r.readAsText(file);
    });
  },

  _parseText(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = e => {
        try {
          const text = e.target.result;
          const lines = text.split(/\r\n|\n/).filter(l => l.trim() !== '');
          if (lines.length < 2) return resolve([]);

          const headers = splitCsvLine(lines[0]);
          const rows = [];
          for (let i = 1; i < lines.length; i++) {
            const vals = splitCsvLine(lines[i]);
            const obj = {};
            headers.forEach((h, idx) => { obj[h] = vals[idx] ?? ''; });
            rows.push(obj);
          }
          resolve(rows);
        } catch (err) { reject(new Error('Failed to parse CSV/TXT.')); }
      };
      r.onerror = () => reject(new Error('Failed to read file.'));
      r.readAsText(file);
    });
  },

  async _parseXlsx(file) {
    const XLSX = await loadVendor('vendor/xlsx.full.min.js', 'XLSX');
    const data = new Uint8Array(await file.arrayBuffer());
    const workbook = XLSX.read(data, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) throw new Error('The workbook has no worksheets.');
    return XLSX.utils.sheet_to_json(sheet, { defval: '' });
  },
};

/** Split a single CSV line, honouring quoted fields with commas. */
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      out.push(cur); cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map(v => v.replace(/^\uFEFF/, '').replace(/^["']|["']$/g, '').trim());
}