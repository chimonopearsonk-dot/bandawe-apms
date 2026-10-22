/**
 * Supabase client — single instance shared across the app.
 * The anon key is safe to expose; Row Level Security enforces access.
 *
 * NOTE: We alias the global SDK to avoid a name collision with our export.
 */

const SUPABASE_URL = 'https://lcjnmdsbcmkbkfcjtdaw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxjam5tZHNiY21rYmtmY2p0ZGF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE4MTQ0MDcsImV4cCI6MjEwNzM5MDQwN30.VaIurU0OlpzCuWerEFDuy57zl43SomaukPtFF2FcmEE';

const supabaseSDK = window.supabase;

if (!supabaseSDK || typeof supabaseSDK.createClient !== 'function') {
  console.error('[supabase] SDK not loaded. Check the script tag in index.html.');
}

const supabaseClient = supabaseSDK.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storageKey: 'bandawe_auth_session',
    storage: window.sessionStorage,  // ← ADD THIS LINE
  },
});

/**
 * Ensure the current user is signed in before any write.
 */
export async function requireAuth() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) throw new Error('Not authenticated. Please sign in again.');
  return session;
}

/**
 * Get the current user's EMIS code (or null).
 */
export async function getCurrentEmis() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return null;
  return user.user_metadata?.emis || null;
}

export const supabase = supabaseClient;
