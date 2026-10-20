/* Alerts for the admin panel: one short beep per event, a single short buzz on phones,
   and at most one system notification. Nothing repeats and the page title does not flash. */
(function () {
  var ctx = null, baseTitle = document.title;
  function pref() { try { return localStorage.getItem('joto_sound') !== '0'; } catch (e) { return true; } }
  var A = window.Alerts = {
    soundOn: pref(),
    setSound: function (on) { A.soundOn = !!on; try { localStorage.setItem('joto_sound', on ? '1' : '0'); } catch (e) {} if (on) A.unlock(); },
    /* browsers only allow audio after a tap/click: call from any click handler */
    unlock: function () {
      try {
        var C = window.AudioContext || window.webkitAudioContext; if (!C) return;
        if (!ctx) ctx = new C();
        if (ctx.state === 'suspended') ctx.resume();
      } catch (e) {}
    },
    /* one soft beep */
    chime: function () {
      if (!A.soundOn) return; A.unlock(); if (!ctx) return;
      try {
        var o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
        o.type = 'sine'; o.frequency.value = 880;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.28, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.25);
      } catch (e) {}
    },
    vibrate: function () { try { if (navigator.vibrate) navigator.vibrate(120); } catch (e) {} },
    permission: function () { return ('Notification' in window) ? Notification.permission : 'unsupported'; },
    askPermission: function () { try { if ('Notification' in window && Notification.permission === 'default') return Notification.requestPermission(); } catch (e) {} return Promise.resolve(A.permission()); },
    /* a silent system notification (the beep above is the only sound) */
    notify: function (title, body, tag, url) {
      try {
        if (!('Notification' in window) || Notification.permission !== 'granted') return;
        var opts = { body: body, tag: tag || 'joto', silent: true, icon: 'images/brand/icon-192.png', badge: 'images/brand/icon-192.png', data: { url: url || location.pathname } };
        if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
          navigator.serviceWorker.getRegistration().then(function (reg) { if (reg && reg.showNotification) reg.showNotification(title, opts); else new Notification(title, opts); }).catch(function () { try { new Notification(title, opts); } catch (e) {} });
        } else { new Notification(title, opts); }
      } catch (e) {}
    },
    stopFlash: function () {},
    setBaseTitle: function (t) { baseTitle = t; },
    /* something needs attention: one beep, one buzz, one silent notification */
    alert: function (opts) { A.chime(); A.vibrate(); if (document.hidden) A.notify(opts.title, opts.body, opts.tag, opts.url); },
    startReminder: function () {}, stopReminder: function () {}
  };
  document.addEventListener('click', function once() { A.unlock(); }, { once: true, capture: true });
})();
