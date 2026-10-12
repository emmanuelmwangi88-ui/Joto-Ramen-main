/* Shared helpers: Supabase client, escaping, toast */
(function () {
  var cfg = window.JOTO_CONFIG || {};
  window.JOTO_READY = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
    cfg.SUPABASE_URL.indexOf('YOUR_') === -1 && window.supabase);
  window.sb = window.JOTO_READY
    ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)
    : null;

  window.esc = function (v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };
  window.money = function (n) { return 'KSh ' + Number(n || 0).toLocaleString('en-KE'); };
  window.capitalize = function (s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; };

  window.showToast = function (message, type) {
    var el = document.createElement('div');
    el.textContent = message;
    el.setAttribute('role', 'status');
    el.style.cssText = 'pointer-events:none;position:fixed;bottom:'+(window.innerWidth<1024?'150px':'20px')+';right:20px;left:20px;max-width:420px;margin-left:auto;padding:14px 20px;border-radius:10px;z-index:3000;color:#fff;font-weight:500;box-shadow:0 8px 24px rgba(0,0,0,.35);background:' +
      (type === 'success' ? '#16a34a' : type === 'error' ? '#dc2626' : '#3b82f6');
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 3800);
  };

  window.friendlyError = function (err) {
    var m = (err && err.message) || 'Something went wrong';
    return m.replace(/^.*?exception:?\s*/i, '');
  };
})();
