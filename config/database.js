// Supabase privileged server client. Never expose this client or key in public/.
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
if (!url || !key) {
  throw new Error('SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY (atau SUPABASE_KEY lama) wajib tersedia');
}
// Do not let signInWithPassword() mutate the admin client session.
const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
});
module.exports = supabase;
