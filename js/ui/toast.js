import { escapeHtml } from './helpers.js';

export const Toast = {
  show(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const bg = {
      success: 'bg-emerald-800 text-white',
      error:   'bg-red-800 text-white',
      info:    'bg-navy-800 text-white',
    }[type] || 'bg-navy-800 text-white';

    const el = document.createElement('div');
    el.className = `px-4 py-3 rounded-lg shadow-xl text-xs font-semibold flex items-center space-x-2 pointer-events-auto border border-white/20 transition-all duration-300 ${bg}`;
    el.innerHTML = `<i class="fa-solid fa-circle-info"></i><span>${escapeHtml(message)}</span>`;

    container.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 300);
    }, 3500);
  },
};