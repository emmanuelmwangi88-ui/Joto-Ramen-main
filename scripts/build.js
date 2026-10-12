// Runs on Vercel before each deploy. If Supabase values are set as environment variables
// (Vercel > Project > Settings > Environment Variables, or the Supabase integration), it writes public/config.js from them.
// Otherwise it leaves the committed public/config.js untouched, so the site always has a working config.
const fs = require('fs'), path = require('path');
const env = process.env;
const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const file = path.join(__dirname, '..', 'public', 'config.js');
try {
  if (url && key && /^https:\/\/[a-z0-9-]+\.supabase\.co/.test(url) && !/service_role/i.test(key)) {
    fs.writeFileSync(file, '// Written by scripts/build.js from environment variables. Public values only.\nwindow.JOTO_CONFIG = ' + JSON.stringify({ SUPABASE_URL: url, SUPABASE_ANON_KEY: key }, null, 2) + ';\n');
    console.log('public/config.js written from environment variables (' + url + ')');
  } else {
    console.log('No Supabase environment variables found: using the committed public/config.js');
  }
} catch (e) { console.log('Could not write config.js, keeping the committed one:', e.message); }
