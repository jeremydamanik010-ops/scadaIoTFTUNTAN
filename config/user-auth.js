// Stateless user-auth client created per login request.
const { createClient } = require('@supabase/supabase-js');
function createUserAuthClient() {
  const url = process.env.SUPABASE_URL;
  // Use PUBLIC anon/publishable key; never use the service role for user logins.
  const key = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_ANON_KEY / SUPABASE_PUBLISHABLE_KEY wajib diatur untuk login');
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
  });
}
module.exports = { createUserAuthClient };
