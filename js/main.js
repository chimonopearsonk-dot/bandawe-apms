import { AppState } from './core/state.js';
import { Storage } from './services/storage.js';
import { AuthService } from './services/auth.service.js';
import { Controller } from './ui/controller.js';
import { Toast } from './ui/toast.js';
import { Events, EVT } from './core/events.js';
import { wirePasswordToggle } from './ui/helpers.js';

/* ---------- Service Worker (offline support) ---------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('[sw] registered, scope:', reg.scope))
      .catch(err => console.warn('[sw] registration failed:', err));
  });
}
/* ---------- Offline queue auto-flush on reconnect ---------- */
window.addEventListener('online', async () => {
  try {
    const { OfflineQueue } = await import('./services/offline-queue.js');
    if (OfflineQueue.count() > 0) {
      console.log('[offline] back online — flushing', OfflineQueue.count(), 'queued ops');
      const result = await OfflineQueue.flush();
      console.log('[offline] flushed:', result);
      if (result.ok > 0) {
        const { Toast } = await import('./ui/toast.js');
        Toast.show(`Synced ${result.ok} pending change${result.ok > 1 ? 's' : ''}.`, 'success');
      }
    }
  } catch (err) {
    console.error('[offline] flush failed:', err);
  }
});

window.addEventListener('offline', async () => {
  const { Toast } = await import('./ui/toast.js');
  Toast.show('You are offline. Changes will sync when you reconnect.', 'info');
});

/* ---------- Expose on window for inline onclick handlers ---------- */
window.UIController = Controller;
window.Toast = Toast;
window.__APP_BOOTED__ = false;

/* ---------- Session-state sync ---------- */
Events.on(EVT.SESSION_CHANGED, () => Controller.syncHeaderState());
Events.on(EVT.OFFLINE_QUEUE_CHANGED, async (payload) => {
  const badge = document.getElementById('offlineQueueBadge');
  const count = document.getElementById('offlineQueueCount');
  if (!badge || !count) return;
  const n = payload?.count ?? 0;
  count.textContent = n;
  badge.classList.toggle('hidden', n === 0);
  badge.classList.toggle('flex', n > 0);
});

// Also show the badge on load if there's already a queue
(async () => {
  try {
    const { OfflineQueue } = await import('./services/offline-queue.js');
    const n = OfflineQueue.count();
    const badge = document.getElementById('offlineQueueBadge');
    const count = document.getElementById('offlineQueueCount');
    if (count && badge && n > 0) {
      count.textContent = n;
      badge.classList.remove('hidden');
      badge.classList.add('flex');
    }
  } catch {}
})();

/* ---------- Wire everything on DOM ready ---------- */
async function boot() {
  try {
    // 1. Restore any existing Supabase session FIRST
    let restoredSession = null;
    try {
      await Storage.loadPublic();
      restoredSession = await AuthService.restoreSession();
      if (restoredSession) {
        await Storage.loadAll();
      }
    } catch (err) {
      console.warn('[main] initial load skipped:', err.message);
    }

    // 2. Initialise UI now that state is correct
    Controller.init();
    window.__APP_BOOTED__ = true;

    // 3. If we restored a session, jump straight to dashboard
        // 3. If we restored a session:
    //    - Superadmin → keep on landing (they can open console from the header)
    //    - School → jump to dashboard
    if (restoredSession) {
      Controller.syncHeaderState();
      if (!restoredSession.isSuperadmin) {
        Controller.showView('dashboard');
      }
    }

    /* ----- Landing search ----- */
    document.getElementById('schoolSearchInput')?.addEventListener('input', e => {
      Controller.renderSchoolsTable(e.target.value);
    });

    /* ----- School login password visibility ----- */
    const toggle = document.getElementById('togglePasswordBtn');
    const pw = document.getElementById('password');
    const eye = document.getElementById('eyeIcon');
    const loginIcon = document.getElementById('portalLoginIcon');
    toggle?.addEventListener('click', () => {
      const isPw = pw.type === 'password';
      pw.type = isPw ? 'text' : 'password';
      if (eye) eye.className = isPw ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
      if (loginIcon) loginIcon.className = isPw
        ? 'fa-solid fa-lock-open text-2xl text-gold-400 transition-all duration-300'
        : 'fa-solid fa-shield-halved text-2xl text-gold-400 transition-all duration-300';
    });

    /* ----- Generic password toggles ----- */
    wirePasswordToggle('adminPasskey',    'adminPasskeyToggle',    'adminPasskeyIcon');
    wirePasswordToggle('newPassword',     'newPasswordToggle',     'newPasswordIcon');
    wirePasswordToggle('confirmPassword', 'confirmPasswordToggle', 'confirmPasswordIcon');

    /* ----- School Portal login ----- */
    document.getElementById('loginForm')?.addEventListener('submit', async e => {
      e.preventDefault();
      const emis = document.getElementById('emisCode').value;
      const pass = document.getElementById('password').value;

      const res = await AuthService.login(emis, pass);
      if (!res.success) return Toast.show(res.message, 'error');

      // Load school-scoped data from Supabase
      try {
        await Storage.loadAll();
      } catch (err) {
        console.error('[login] load failed:', err);
      }

      Controller.syncHeaderState();
      Toast.show(`Welcome back, ${res.session.name}!`, 'success');
      Controller.showView('dashboard');
    });
    
        /* ----- Superadmin login ----- */
    document.getElementById('adminLoginForm')?.addEventListener('submit', async e => {
      e.preventDefault();
      const pass = document.getElementById('adminPasskey').value;

      const { supabase } = await import('./core/supabase.js');
      const { error } = await supabase.auth.signInWithPassword({
        email: 'superadmin@bandawe.zone',
        password: pass,
      });

      if (error) {
        console.error('[admin login] signInWithPassword error:', error);
        return Toast.show('Invalid superadmin passkey. ' + error.message, 'error');
      }

      // Verify via RPC
      const { data: isSuper, error: rpcErr } = await supabase.rpc('am_i_superadmin');
      if (rpcErr) {
        await supabase.auth.signOut();
        return Toast.show('Verification failed: ' + rpcErr.message, 'error');
      }
      if (!isSuper) {
        await supabase.auth.signOut();
        return Toast.show('This account is not a superadmin.', 'error');
      }

      // Load data for the console — but DO NOT create a school session
      await Storage.loadAll();
      try { await Storage.loadAllLearnersForAdmin(); } catch (err) { console.warn(err); }

      // Keep the session in Supabase only, not in AppState.currentSession
      // This means the header stays in "logged out" mode, and Dashboard/Settings buttons stay hidden
      AppState.currentSession = null;
      await Storage.setSession(null);

      // Clear the passkey field
      document.getElementById('adminPasskey').value = '';

      Controller.closeModal('adminLoginModal');
      Controller.showAdminConsole();
      Toast.show('Superadmin Console Authenticated.', 'success');
    });
    /* ----- Logout ----- */
    document.getElementById('logoutBtn')?.addEventListener('click', async () => {
      await AuthService.logout();
      // Clear login form fields
      const emisEl = document.getElementById('emisCode');
      const pwEl = document.getElementById('password');
      const adminPwEl = document.getElementById('adminPasskey');
      if (emisEl) emisEl.value = '';
      if (pwEl) pwEl.value = '';
      if (adminPwEl) adminPwEl.value = '';
      Controller.showView('landing');
      Toast.show('Logged out.', 'info');
    });

    /* ----- First-login password change (via Supabase) ----- */
    document.getElementById('firstLoginForm')?.addEventListener('submit', async e => {
      e.preventDefault();
      const p1 = document.getElementById('newPassword').value;
      const p2 = document.getElementById('confirmPassword').value;
      if (p1 !== p2) return Toast.show('Passwords do not match.', 'error');
      if (p1.length < 6) return Toast.show('Password must be at least 6 characters.', 'error');

      try {
        await AuthService.changePassword(p1);
        Controller.closeModal('firstLoginModal');
        Controller.showView('dashboard');
        Toast.show('Password updated.', 'success');
      } catch (err) {
        Toast.show('Failed: ' + err.message, 'error');
      }
    });

    /* ----- Registration request ----- */
    document.getElementById('registerForm')?.addEventListener('submit', async e => {
      e.preventDefault();
      const emis = document.getElementById('regEmis').value.trim().toUpperCase();
      const name = document.getElementById('regSchoolName').value.trim();
      const contactPerson = document.getElementById('regContactPerson').value.trim();
      const phone = document.getElementById('regPhone').value.trim();
      const email = document.getElementById('regEmail').value.trim();

      const { supabase } = await import('./core/supabase.js');
      const { error } = await supabase.from('pending_schools').insert({
        emis, name, contact_person: contactPerson, phone, email,
        zone: 'Bandawe',
      });

      if (error) {
        Toast.show('Registration failed: ' + error.message, 'error');
        return;
      }

      e.target.reset();
      Controller.closeModal('registerModal');
      Toast.show('Registration request submitted. Await Superadmin approval.', 'success');
    });

    /* ----- Forgot password ----- */
    document.getElementById('forgotPasswordLink')?.addEventListener('click', e => {
      e.preventDefault();
      Controller.showModal('recoveryModal');
    });
    document.getElementById('recoveryForm')?.addEventListener('submit', async e => {
      e.preventDefault();
      const emisInput = e.target.querySelector('input[type="text"]');
      const emis = (emisInput?.value || '').trim().toUpperCase();
      if (!emis) return Toast.show('Please enter your EMIS code.', 'error');

      try {
        const { supabase } = await import('./core/supabase.js');
        const { error } = await supabase.from('password_requests').insert({
          emis,
          requested_at: new Date().toISOString(),
        });
        if (error) throw error;

        Controller.closeModal('recoveryModal');
        e.target.reset();
        Toast.show('Recovery request sent to Superadmin.', 'success');
      } catch (err) {
        Toast.show('Failed: ' + err.message, 'error');
      }
    });

    if (!navigator.onLine) {
      const { Toast } = await import('./ui/toast.js');
      Toast.show('You are offline. Some features will be limited until you reconnect.', 'info');
    }

  } catch (err) {
    console.error('[main] boot error:', err);
    document.body.insertAdjacentHTML('afterbegin',
      `<div style="background:#7f1d1d;color:#fff;padding:12px;font:12px monospace">
        Boot error: ${err.message}. Open DevTools → Console for stack trace.
      </div>`);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}