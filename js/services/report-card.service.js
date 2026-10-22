import { AppState } from '../core/state.js';
import { SUBJECT_BY_CODE } from '../core/config.js';
import { LearnerService } from './learner.service.js';
import { MarksService } from './marks.service.js';
import { ImageStoreService, urlToDataUrl } from './image-store.service.js';
import { escapeHtml } from '../ui/helpers.js';

/**
 * Report card HTML generator — fully mobile-first.
 *
 * Mobile (< 640px):
 *   - Card fills 100vw, no outer padding
 *   - Signatures stack in 1 column
 *   - Fonts 13px, table padding tight
 *   - Card uses flexbox so signatures sit at bottom of screen
 *
 * Desktop (≥ 640px):
 *   - Card max 850px centred
 *   - Signatures in 3 columns
 *   - Fonts 14px
 */

const RUBRIC = [
  { min: 80, level: 4, remark: 'Excellent' },
  { min: 60, level: 3, remark: 'Good' },
  { min: 40, level: 2, remark: 'Average' },
  { min: 0,  level: 1, remark: 'Need Support' },
];

function rubric(percent) {
  return RUBRIC.find(r => percent >= r.min) || RUBRIC[RUBRIC.length - 1];
}

export const ReportCardService = {

  buildLearnerHtml(emis, lin, type = 'exam') {
    const session = AppState.currentSession;
    const school = AppState.schools.find(s => s.emis === emis);
    if (!session || !school) throw new Error('Missing school context.');

    const learner = LearnerService.findByLin(lin);
    if (!learner) throw new Error('Learner not found.');

    const schema = MarksService.schemaForClass(learner.class);
    if (!schema) throw new Error('No schema for class: ' + learner.class);

    const ranked = MarksService.rankClass(type, LearnerService.listBySchool(emis, learner.class), learner.class);
    const rankIdx = ranked.findIndex(r => r.learner.lin === lin);
    const computed = ranked[rankIdx]?.computed;
    const position = ranked[rankIdx]?.position || '—';
    const totalLearners = ranked.length;

    const remarks = this._remarksFor(emis, lin);
    const images = ImageStoreService.getSchoolImages(emis);
    const emblem = ImageStoreService.getEmblem();
    const nextOpening = AppState.nextOpening;

    const subjectRows = schema.subjects.map((sc, i) => {
      const subj = SUBJECT_BY_CODE[sc];
      const raw = AppState.marks[type]?.[lin]?.[sc];
      const score = typeof raw === 'number' ? raw : null;
      const pct = score !== null ? (score / schema.maxPerSubject) * 100 : null;
      const r = pct !== null ? rubric(pct) : null;
      return `
        <tr>
          <td class="cell subject">${escapeHtml(subj.name)}</td>
          <td class="cell center">${score !== null ? `${score} / ${schema.maxPerSubject}` : '—'}</td>
          <td class="cell center">${r ? r.level : '—'}</td>
          <td class="cell">${r ? r.remark : '—'}</td>
        </tr>`;
    }).join('');

    const avgText = computed ? `${computed.avgPercent}%` : '—';
    const gradeLetter = computed?.grade || '—';
    const status = computed?.status || '—';

    const headerLogoLeft = emblem
      ? `<img src="${emblem}" alt="Emblem" class="logo-left">`
      : `<div class="logo-placeholder">EMBLEM</div>`;

    const headerLogoRight = images.logo
      ? `<img src="${images.logo}" alt="School Logo" class="logo-right">`
      : `<div class="logo-placeholder">SCHOOL</div>`;

    const teacherSign = images.teacherSign
      ? `<img src="${images.teacherSign}" class="sign-img">`
      : `<div class="sign-line"></div>`;

    const headSign = images.headSign
      ? `<img src="${images.headSign}" class="sign-img">`
      : `<div class="sign-line"></div>`;

    const stamp = images.stamp
      ? `<img src="${images.stamp}" class="stamp-img">`
      : `<div class="stamp-line">School Stamp</div>`;

    const nextOpenLine = nextOpening?.date
      ? `<div class="next-open">Next Term Opens: <strong>${escapeHtml(nextOpening.date)}</strong>${nextOpening.note ? ' — ' + escapeHtml(nextOpening.note) : ''}</div>`
      : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Report Card — ${escapeHtml(learner.name)} (${escapeHtml(lin)})</title>
<style>
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
    margin: 0; padding: 0; background: #f1f5f9; color: #0f172a;
    font-size: 13px;
    -webkit-text-size-adjust: 100%;
  }
  .card {
    background: #fff;
    padding: 16px 12px;
    border: none;
    box-shadow: none;
    width: 100%;
    max-width: 100%;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
  }
  .card .content-grow { flex: 1; }

  @media (min-width: 640px) {
    body { padding: 24px; font-size: 14px; background: #f1f5f9; }
    .card {
      max-width: 850px;
      padding: 32px 40px;
      border: 1px solid #cbd5e1;
      box-shadow: 0 4px 12px rgba(0,0,0,0.05);
      min-height: auto;
      display: block;
      margin: 0 auto;
    }
  }

  .header-top {
    display: flex; justify-content: space-between; align-items: flex-start;
    margin-bottom: 12px; flex-wrap: wrap; gap: 8px;
  }
  .logo-left, .logo-right { max-height: 56px; max-width: 70px; object-fit: contain; }
  @media (min-width: 640px) {
    .logo-left, .logo-right { max-height: 72px; max-width: 90px; }
  }
  .logo-placeholder {
    width: 56px; height: 56px; border: 1px dashed #94a3b8; color: #94a3b8;
    display: flex; align-items: center; justify-content: center;
    font-size: 8px; text-align: center; letter-spacing: 0.5px;
  }
  @media (min-width: 640px) {
    .logo-placeholder { width: 72px; height: 72px; font-size: 9px; }
  }
  .title-block { text-align: center; flex: 1; padding: 0 8px; min-width: 180px; }
  .title-block h1 {
    margin: 0 0 4px; font-size: 14px; text-transform: uppercase;
    letter-spacing: 0.5px; color: #0f172a; word-break: break-word;
  }
  .title-block h2 { margin: 0 0 4px; font-size: 11px; font-weight: 600; color: #334155; }
  .title-block .period { font-size: 11px; font-weight: 700; color: #081c2e; letter-spacing: 0.5px; }
  @media (min-width: 640px) {
    .title-block h1 { font-size: 18px; }
    .title-block h2 { font-size: 13px; }
    .title-block .period { font-size: 12px; }
  }
  .divider { border: none; border-top: 2px solid #081c2e; margin: 12px 0 16px; }

  .particulars {
    display: grid; grid-template-columns: 1fr 1fr; gap: 6px;
    margin-bottom: 14px; font-size: 11px;
  }
  @media (min-width: 640px) {
    .particulars { grid-template-columns: 2fr 1fr 1fr 1fr; gap: 12px; margin-bottom: 20px; font-size: 12px; }
  }
  .particulars .field { background: #f8fafc; border: 1px solid #e2e8f0; padding: 6px 8px; }
  .particulars .lbl {
    display: block; font-size: 8px; text-transform: uppercase;
    color: #64748b; letter-spacing: 0.6px; margin-bottom: 2px; font-weight: 700;
  }
  .particulars .val { font-weight: 700; color: #0f172a; word-break: break-word; }

  .stats {
    display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px;
    margin-bottom: 14px; font-size: 10px;
  }
  @media (min-width: 640px) {
    .stats { grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 20px; font-size: 11px; }
  }
  .stat { background: #eff6ff; border: 1px solid #bfdbfe; padding: 6px 8px; text-align: center; }
  .stat .k {
    display: block; font-size: 8px; text-transform: uppercase;
    color: #1e40af; letter-spacing: 0.6px; font-weight: 700; margin-bottom: 2px;
  }
  .stat .v { font-size: 14px; font-weight: 900; color: #081c2e; }
  @media (min-width: 640px) {
    .stat .k { font-size: 9px; }
    .stat .v { font-size: 16px; }
  }

  table.results { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 14px; }
  table.results th, table.results td {
    border: 1px solid #cbd5e1;
    padding: 4px 6px;
    word-break: break-word;
  }
  table.results thead th {
    background: #081c2e; color: #fff; font-size: 10px;
    letter-spacing: 0.4px; text-transform: uppercase; font-weight: 700;
  }
  table.results tbody tr:nth-child(even) { background: #f8fafc; }
  .cell.subject { font-weight: 600; }
  .cell.center { text-align: center; font-family: 'Courier New', monospace; }
  @media (min-width: 640px) {
    table.results { font-size: 12px; margin-bottom: 20px; }
    table.results th, table.results td { padding: 6px 10px; }
    table.results thead th { font-size: 11px; }
  }

  .remarks { margin-bottom: 16px; font-size: 11px; }
  .remarks .block { margin-bottom: 8px; }
  .remarks .block-label {
    font-size: 9px; font-weight: 700; color: #334155;
    text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 3px;
  }
  .remarks .block-body {
    background: #f8fafc; border: 1px solid #e2e8f0; padding: 6px 8px; min-height: 32px;
    font-style: italic; color: #334155;
  }
  @media (min-width: 640px) {
    .remarks { margin-bottom: 24px; font-size: 12px; }
    .remarks .block { margin-bottom: 10px; }
    .remarks .block-body { padding: 8px 10px; min-height: 36px; }
  }

  .signatures {
    display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px;
    margin-top: 20px; text-align: center; align-items: end;
  }
  @media (min-width: 640px) {
    .signatures { gap: 24px; margin-top: 32px; }
  }
  .signatures .sig { font-size: 9px; }
  @media (min-width: 640px) {
    .signatures .sig { font-size: 10px; }
  }
  .signatures .sig-label {
    border-top: 1px solid #334155; padding-top: 3px; margin-top: 4px;
    font-weight: 700; color: #334155; letter-spacing: 0.3px; text-transform: uppercase;
  }
  .sign-img { max-height: 40px; max-width: 100px; object-fit: contain; display: block; margin: 0 auto; }
  @media (min-width: 640px) {
    .sign-img { max-height: 48px; max-width: 140px; }
  }
  .sign-line { height: 40px; }
  @media (min-width: 640px) { .sign-line { height: 48px; } }

  .stamp-img { max-height: 60px; max-width: 90px; object-fit: contain; display: block; margin: 0 auto; }
  @media (min-width: 640px) { .stamp-img { max-height: 80px; max-width: 120px; } }
  .stamp-line {
    height: 60px; border: 1px dashed #94a3b8; color: #94a3b8;
    display: flex; align-items: center; justify-content: center;
    font-size: 8px; letter-spacing: 0.5px; text-transform: uppercase;
  }
  @media (min-width: 640px) { .stamp-line { height: 80px; font-size: 9px; } }

  .next-open {
    margin-top: 16px; padding: 6px 10px; background: #fef3c7;
    border-left: 3px solid #f59e0b; font-size: 10px; color: #78350f;
  }
  @media (min-width: 640px) {
    .next-open { margin-top: 20px; padding: 8px 12px; font-size: 11px; }
  }

  @media print {
    body { background: #fff; padding: 0; }
    .card { box-shadow: none; border: none; max-width: none; min-height: auto; }
  }
</style>
</head>
<body>
  <div class="card">
    <div class="content-grow">

      <div class="header-top">
        ${headerLogoLeft}
        <div class="title-block">
          <h1>${escapeHtml(school.name)}</h1>
          <h2>Ministry of Education Science &amp; Technology</h2>
          <div class="period">Academic Year ${escapeHtml(AppState.academicConfig.year)} · ${escapeHtml(AppState.academicConfig.term)}</div>
          <div style="font-size:9px;color:#64748b;margin-top:3px;">EMIS: <strong>${escapeHtml(emis)}</strong> · ${escapeHtml(school.zone || 'Bandawe')} Zone</div>
        </div>
        ${headerLogoRight}
      </div>

      <hr class="divider">

      <div class="particulars">
        <div class="field"><span class="lbl">Learner Name</span><span class="val">${escapeHtml(learner.name)}</span></div>
        <div class="field"><span class="lbl">LIN</span><span class="val">${escapeHtml(learner.lin)}</span></div>
        <div class="field"><span class="lbl">Class</span><span class="val">${escapeHtml(learner.class)}</span></div>
        <div class="field"><span class="lbl">Class Position</span><span class="val">${position} of ${totalLearners}</span></div>
      </div>

      <div class="stats">
        <div class="stat"><span class="k">Total</span><span class="v">${computed ? `${computed.total} / ${computed.maxTotal}` : '—'}</span></div>
        <div class="stat"><span class="k">Average</span><span class="v">${avgText}</span></div>
        <div class="stat"><span class="k">Grade</span><span class="v">${gradeLetter}</span></div>
        <div class="stat"><span class="k">Status</span><span class="v">${status}</span></div>
      </div>

      <table class="results">
        <thead>
          <tr>
            <th style="text-align:left;width:40%;">Subject</th>
            <th style="text-align:center;width:20%;">Score</th>
            <th style="text-align:center;width:12%;">Level</th>
            <th style="text-align:left;width:28%;">Remark</th>
          </tr>
        </thead>
        <tbody>${subjectRows}</tbody>
      </table>

      <div class="remarks">
        <div class="block">
          <div class="block-label">Class Teacher's Remark</div>
          <div class="block-body">${escapeHtml(remarks.classTeacher || this._autoClassRemark(computed))}</div>
        </div>
        <div class="block">
          <div class="block-label">Head Teacher's Remark</div>
          <div class="block-body">${escapeHtml(remarks.headTeacher || this._autoHeadRemark(computed))}</div>
        </div>
      </div>

    </div>

    <div class="signatures">
      <div class="sig">
        ${teacherSign}
        <div class="sig-label">Class Teacher</div>
      </div>
      <div class="sig">
        ${stamp}
        <div class="sig-label">School Stamp</div>
      </div>
      <div class="sig">
        ${headSign}
        <div class="sig-label">Head Teacher</div>
      </div>
    </div>

    ${nextOpenLine}

  </div>
</body>
</html>`;
  },

  _remarksFor(emis, lin) {
    const y = AppState.academicConfig.year;
    const t = AppState.academicConfig.term;
    return AppState.remarks?.[emis]?.[lin]?.[y]?.[t] || {};
  },

  _autoClassRemark(computed) {
    if (!computed) return 'Assessment not yet recorded.';
    const p = computed.avgPercent;
    if (p >= 80) return 'An excellent term of consistent, focused work. Keep up the standard.';
    if (p >= 60) return 'A good effort this term. Continue practising the weaker subjects.';
    if (p >= 40) return 'An average performance. More time is needed on revision.';
    return 'Needs significant support. Recommend remedial attention.';
  },

  _autoHeadRemark(computed) {
    if (!computed) return 'Awaiting examination data.';
    const p = computed.avgPercent;
    if (p >= 80) return 'An outstanding learner demonstrating sustained academic commitment.';
    if (p >= 60) return 'A solid performance. Continue at this pace.';
    if (p >= 40) return 'Satisfactory progress. Encourage further engagement.';
    return 'Requires targeted academic intervention.';
  },

  async buildLearnerHtmlWithInlinedImages(emis, lin, type = 'exam') {
    const html = this.buildLearnerHtml(emis, lin, type);
    const urls = [...html.matchAll(/src="(https:\/\/[^"]+)"/g)].map(m => m[1]);
    if (!urls.length) return html;

    const map = {};
    await Promise.all(urls.map(async u => {
      const d = await urlToDataUrl(u);
      if (d) map[u] = d;
    }));

    let out = html;
    for (const [url, data] of Object.entries(map)) {
      out = out.split(`src="${url}"`).join(`src="${data}"`);
    }
    return out;
  },
};