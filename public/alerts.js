/* Used by the admin panel: loud chime, vibration, system notification, flashing tab title. */
(function () {
  var ctx = null, flashTimer = null, baseTitle = document.title, reminder = null;
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
    tone: function (freq, start, dur, vol) {
      if (!ctx) return;
      var o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + start;
      o.type = 'triangle'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol || 0.5, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + dur + 0.05);
    },
    /* kind: 'order' (3 rising notes, twice), 'ready' (2 notes), 'request' (low double beep) */
    chime: function (kind) {
      if (!A.soundOn) return; A.unlock(); if (!ctx) return;
      var seq = kind === 'ready' ? [[880, 0], [1320, 0.18]] : kind === 'request' ? [[520, 0], [520, 0.22]] : [[784, 0], [988, 0.17], [1319, 0.34], [784, 0.9], [988, 1.07], [1319, 1.24]];
      seq.forEach(function (n) { A.tone(n[0], n[1], 0.32, 0.55); });
    },
    vibrate: function () { try { if (navigator.vibrate) navigator.vibrate([250, 120, 250, 120, 400]); } catch (e) {} },
    /* system notification (works while the app is open or in the background tab) */
    permission: function () { return ('Notification' in window) ? Notification.permission : 'unsupported'; },
    askPermission: function () { try { if ('Notification' in window && Notification.permission === 'default') return Notification.requestPermission(); } catch (e) {} return Promise.resolve(A.permission()); },
    notify: function (title, body, tag, url) {
      try {
        if (!('Notification' in window) || Notification.permission !== 'granted') return;
        var opts = { body: body, tag: tag || 'joto', renotify: true, icon: 'icon-192.png', badge: 'icon-192.png', vibrate: [250, 120, 250], data: { url: url || location.pathname } };
        if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
          navigator.serviceWorker.getRegistration().then(function (reg) { if (reg && reg.showNotification) reg.showNotification(title, opts); else new Notification(title, opts); }).catch(function () { try { new Notification(title, opts); } catch (e) {} });
        } else { new Notification(title, opts); }
      } catch (e) {}
    },
    flashTitle: function (text) {
      clearInterval(flashTimer); var on = false;
      flashTimer = setInterval(function () { document.title = on ? baseTitle : text; on = !on; }, 900);
    },
    stopFlash: function () { clearInterval(flashTimer); flashTimer = null; document.title = baseTitle; },
    setBaseTitle: function (t) { baseTitle = t; },
    /* full alert for something that needs attention now */
    alert: function (opts) {
      A.chime(opts.kind || 'order'); A.vibrate(); A.notify(opts.title, opts.body, opts.tag, opts.url);
      if (document.hidden) A.flashTitle('🔔 ' + opts.title);
    },
    /* repeat the chime every `ms` while shouldRing() is true, until stopReminder() */
    startReminder: function (shouldRing, kind, ms) { A.stopReminder(); reminder = setInterval(function () { if (shouldRing()) A.chime(kind); }, ms || 30000); },
    stopReminder: function () { clearInterval(reminder); reminder = null; }
  };
  document.addEventListener('visibilitychange', function () { if (!document.hidden) A.stopFlash(); });
  document.addEventListener('click', function once() { A.unlock(); }, { once: true, capture: true });
})();
