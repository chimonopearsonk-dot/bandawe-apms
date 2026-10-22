import { AppState } from '../core/state.js';
import { ImageStoreService } from '../services/image-store.service.js';
import { Events, EVT } from '../core/events.js';
import { escapeHtml } from './helpers.js';
import { Toast } from './toast.js';

export const SettingsUI = {
  init() {
    // Open / close modal
    document.getElementById('btnOpenSettings')?.addEventListener('click', () => {
      this.render();
      document.getElementById('schoolSettingsModal')?.classList.remove('hidden');
    });
    document.getElementById('btnCloseSettings')?.addEventListener('click', () => {
      document.getElementById('schoolSettingsModal')?.classList.add('hidden');
    });

    // Change password button
    document.getElementById('btnChangePassword')?.addEventListener('click', async () => {
      const p1 = prompt('Enter new password (min 6 characters):');
      if (!p1 || p1.length < 6) return;
      const p2 = prompt('Confirm new password:');
      if (p1 !== p2) return Toast.show('Passwords do not match.', 'error');
      try {
        const { AuthService } = await import('../services/auth.service.js');
        await AuthService.changePassword(p1);
        Toast.show('Password updated.', 'success');
      } catch (err) {
        Toast.show('Failed: ' + err.message, 'error');
      }
    });

    // ONE-TIME delegated listeners on document — catches inputs no matter when they render
    if (!window.__settingsDelegated__) {
      window.__settingsDelegated__ = true;

      document.addEventListener('change', e => {
        const inp = e.target;
        if (!inp.matches('#schoolSettingsModal input[type="file"][data-slot]')) return;
        this._handleUpload(inp.dataset.slot, inp.files?.[0]);
      });

      document.addEventListener('click', e => {
        const btn = e.target.closest('#schoolSettingsModal [data-action="clear-slot"]');
        if (!btn) return;
        this._handleClear(btn.dataset.slot);
      });
    }

    Events.on(EVT.IMAGES_CHANGED, () => {
      const m = document.getElementById('schoolSettingsModal');
      if (m && !m.classList.contains('hidden')) this.render();
    });
  },

  _renderSlot(key, dataUrl, label) {
    const slot = document.getElementById(`slot-${key}`);
    if (!slot) return;

    slot.innerHTML = `
      <div class="text-[11px] font-bold text-slate-700 mb-1">${escapeHtml(label)}</div>
      <div class="border border-slate-200 rounded bg-slate-50 flex items-center justify-center" style="height:90px;">
        ${dataUrl
          ? `<img src="${dataUrl}" class="max-h-full max-w-full object-contain" alt="${escapeHtml(label)}">`
          : `<span class="text-[10px] text-slate-400 italic">Not uploaded</span>`}
      </div>
      <div class="flex gap-2 mt-2">
        <label class="cursor-pointer bg-navy-800 hover:bg-navy-900 text-white text-[11px] font-bold px-2.5 py-1 rounded flex-1 text-center">
          <i class="fa-solid fa-upload mr-1"></i> Upload
          <input type="file" accept="image/*" data-slot="${key}" class="hidden">
        </label>
        <button data-action="clear-slot" data-slot="${key}"
          class="bg-red-100 hover:bg-red-200 text-red-700 text-[11px] font-bold px-2.5 py-1 rounded">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>`;
  },

  render() {
    const session = AppState.currentSession;
    if (!session) return;
    const imgs = ImageStoreService.getSchoolImages(session.emis);
    const emblem = ImageStoreService.getEmblem();

    document.getElementById('settingsSchoolName').textContent = session.name;
    document.getElementById('settingsEmis').textContent = session.emis;

    this._renderSlot('logo', imgs.logo, 'School Logo (optional)');
    this._renderSlot('headSign', imgs.headSign, 'Head Teacher Signature');
    this._renderSlot('teacherSign', imgs.teacherSign, 'Class Teacher Signature');
    this._renderSlot('stamp', imgs.stamp, 'School Stamp');

    // Emblem preview (read-only for school)
    const emblemSlot = document.getElementById('settingsEmblemPreview');
    if (emblemSlot) {
      emblemSlot.innerHTML = emblem
        ? `<img src="${emblem}" class="max-h-20 mx-auto border border-slate-200 rounded" alt="Emblem">`
        : `<div class="text-[10px] text-slate-400 italic text-center py-4 border border-dashed border-slate-300 rounded">No emblem uploaded yet.<br>(Superadmin provides this)</div>`;
    }
  },

  async _handleUpload(key, file) {
    if (!file) return;
    try {
      const session = AppState.currentSession;
      await ImageStoreService.setSchoolImageFromFile(session.emis, key, file);
      Toast.show(`${key} uploaded (${Math.round(file.size / 1024)} KB).`, 'success');
      this.render();
    } catch (err) {
      console.error('[settings] upload failed:', err);
      Toast.show(err.message, 'error');
    }
  },

  async _handleClear(key) {
    if (!confirm(`Remove this image (${key})?`)) return;
    const session = AppState.currentSession;
    await ImageStoreService.clearSchoolImage(session.emis, key);
    Toast.show('Image removed.', 'info');
    this.render();
  },
};