/* NEXUS maintenance guard — единый для всех сайтов сети.
   Подключение на сайте:
     <script>window.NEXUS_SITE = 'slug';</script>
     <script src="./nexus-guard.js"></script>
   Слаг из таблицы nexus_sites (SQL, раздел 14).
   Показывает заглушку «тех работы» всем, кроме основателя/админа. */
(function () {
  var SLUG = window.NEXUS_SITE || '';
  if (!SLUG) return;

  var URL = 'https://tgleohmsmwqlvndxfykv.supabase.co';
  var KEY = 'sb_publishable_vOM4373bRXKYAnUeEdTIDA_5gDXE98F';
  var REF = 'tgleohmsmwqlvndxfykv';
  var TOKEN_KEY = 'sb-' + REF + '-auth-token';
  var EMAIL_DOMAIN = 'players.dsv-zombi.local';

  var overlay = null;

  function getSession() {
    try { var raw = localStorage.getItem(TOKEN_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }

  function isFounder(sess) {
    if (!sess || !sess.access_token) return Promise.resolve(false);
    var uid = (sess.user && (sess.user.id || sess.user.sub));
    if (!uid) return Promise.resolve(false);
    return fetch(URL + '/rest/v1/profiles?id=eq.' + uid + '&select=role,nick', {
      headers: { apikey: KEY, Authorization: 'Bearer ' + sess.access_token }, cache: 'no-store'
    }).then(function (r) { return r.ok ? r.json() : []; }).then(function (rows) {
      var p = rows && rows[0];
      if (!p) return false;
      return p.role === 'founder' || p.role === 'admin' || String(p.nick || '').toLowerCase() === 'faranatic';
    }).catch(function () { return false; });
  }

  var CSS =
    '.nxs-maint{position:fixed;inset:0;z-index:2147483600;background:#000;overflow:hidden;display:flex;align-items:center;justify-content:center;font-family:system-ui,"Segoe UI",sans-serif}' +
    '.nxs-rain{position:absolute;inset:0;z-index:0;--c:#09f;background-color:#000;' +
    'background-image:radial-gradient(4px 100px at 0px 235px,var(--c),#0000),radial-gradient(4px 100px at 300px 235px,var(--c),#0000),radial-gradient(1.5px 1.5px at 150px 117.5px,var(--c) 100%,#0000 150%),radial-gradient(4px 100px at 0px 252px,var(--c),#0000),radial-gradient(4px 100px at 300px 252px,var(--c),#0000),radial-gradient(1.5px 1.5px at 150px 126px,var(--c) 100%,#0000 150%),radial-gradient(4px 100px at 0px 150px,var(--c),#0000),radial-gradient(4px 100px at 300px 150px,var(--c),#0000),radial-gradient(1.5px 1.5px at 150px 75px,var(--c) 100%,#0000 150%),radial-gradient(4px 100px at 0px 253px,var(--c),#0000),radial-gradient(4px 100px at 300px 253px,var(--c),#0000),radial-gradient(1.5px 1.5px at 150px 126.5px,var(--c) 100%,#0000 150%),radial-gradient(4px 100px at 0px 204px,var(--c),#0000),radial-gradient(4px 100px at 300px 204px,var(--c),#0000),radial-gradient(1.5px 1.5px at 150px 102px,var(--c) 100%,#0000 150%),radial-gradient(4px 100px at 0px 134px,var(--c),#0000),radial-gradient(4px 100px at 300px 134px,var(--c),#0000),radial-gradient(1.5px 1.5px at 150px 67px,var(--c) 100%,#0000 150%),radial-gradient(4px 100px at 0px 179px,var(--c),#0000),radial-gradient(4px 100px at 300px 179px,var(--c),#0000),radial-gradient(1.5px 1.5px at 150px 89.5px,var(--c) 100%,#0000 150%),radial-gradient(4px 100px at 0px 299px,var(--c),#0000),radial-gradient(4px 100px at 300px 299px,var(--c),#0000),radial-gradient(1.5px 1.5px at 150px 149.5px,var(--c) 100%,#0000 150%),radial-gradient(4px 100px at 0px 215px,var(--c),#0000),radial-gradient(4px 100px at 300px 215px,var(--c),#0000),radial-gradient(1.5px 1.5px at 150px 107.5px,var(--c) 100%,#0000 150%),radial-gradient(4px 100px at 0px 281px,var(--c),#0000),radial-gradient(4px 100px at 300px 281px,var(--c),#0000),radial-gradient(1.5px 1.5px at 150px 140.5px,var(--c) 100%,#0000 150%),radial-gradient(4px 100px at 0px 158px,var(--c),#0000),radial-gradient(4px 100px at 300px 158px,var(--c),#0000),radial-gradient(1.5px 1.5px at 150px 79px,var(--c) 100%,#0000 150%),radial-gradient(4px 100px at 0px 210px,var(--c),#0000),radial-gradient(4px 100px at 300px 210px,var(--c),#0000),radial-gradient(1.5px 1.5px at 150px 105px,var(--c) 100%,#0000 150%);' +
    'background-size:300px 235px,300px 235px,300px 235px,300px 252px,300px 252px,300px 252px,300px 150px,300px 150px,300px 150px,300px 253px,300px 253px,300px 253px,300px 204px,300px 204px,300px 204px,300px 134px,300px 134px,300px 134px,300px 179px,300px 179px,300px 179px,300px 299px,300px 299px,300px 299px,300px 215px,300px 215px,300px 215px,300px 281px,300px 281px,300px 281px,300px 158px,300px 158px,300px 158px,300px 210px,300px 210px,300px 210px;animation:nxs-fall 150s linear infinite}' +
    '.nxs-rain::after{content:"";position:absolute;inset:0;z-index:1;background-image:radial-gradient(circle at 50% 50%,#0000 0,#0000 2px,hsl(0 0 4%) 2px);background-size:8px 8px;--f:blur(1em) brightness(6);animation:nxs-hue 10s linear infinite}' +
    '@keyframes nxs-fall{0%{background-position:0px 220px,3px 220px,151.5px 337.5px,25px 24px,28px 24px,176.5px 150px,50px 16px,53px 16px,201.5px 91px,75px 224px,78px 224px,226.5px 350.5px,100px 19px,103px 19px,251.5px 121px,125px 120px,128px 120px,276.5px 187px,150px 31px,153px 31px,301.5px 120.5px,175px 235px,178px 235px,326.5px 384.5px,200px 121px,203px 121px,351.5px 228.5px,225px 224px,228px 224px,376.5px 364.5px,250px 26px,253px 26px,401.5px 105px,275px 75px,278px 75px,426.5px 180px}to{background-position:0px 6800px,3px 6800px,151.5px 6917.5px,25px 13632px,28px 13632px,176.5px 13758px,50px 5416px,53px 5416px,201.5px 5491px,75px 17175px,78px 17175px,226.5px 17301.5px,100px 5119px,103px 5119px,251.5px 5221px,125px 8428px,128px 8428px,276.5px 8495px,150px 9876px,153px 9876px,301.5px 9965.5px,175px 13391px,178px 13391px,326.5px 13540.5px,200px 14741px,203px 14741px,351.5px 15695px,225px 1424px,228px 1424px,376.5px 1559.5px,250px 5416px,253px 5416px,401.5px 5491px,275px 17175px,278px 17175px,426.5px 17301.5px}}' +
    '@keyframes nxs-hue{0%{backdrop-filter:var(--f) hue-rotate(0deg)}to{backdrop-filter:var(--f) hue-rotate(360deg)}}' +
    '.nxs-inner{position:relative;z-index:3;text-align:center;max-width:640px;padding:30px}' +
    '.nxs-eyebrow{color:#77d4e0;font-family:ui-monospace,monospace;font-size:10px;letter-spacing:.26em;text-transform:uppercase;margin:0 0 10px}' +
    '.nxs-inner h1{color:#edf1fb;font-size:clamp(32px,8vw,60px);font-weight:800;letter-spacing:-.02em;margin:0 0 14px}' +
    '.nxs-text{color:#9fb0d0;font-size:16px;line-height:1.7;margin:0 0 22px}' +
    '.nxs-form{display:flex;flex-direction:column;gap:10px;max-width:320px;margin:0 auto}' +
    '.nxs-in{background:rgba(10,15,28,.72);border:1px solid #253048;border-radius:10px;padding:11px 13px;color:#e6ecfb;font-size:14px}' +
    '.nxs-in:focus{outline:none;border-color:#77d4e0}' +
    '.nxs-btn{background:rgba(119,212,224,.12);color:#77d4e0;border:1px solid rgba(119,212,224,.5);border-radius:999px;padding:11px;font-family:ui-monospace,monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;cursor:pointer}' +
    '.nxs-btn:hover{background:rgba(119,212,224,.22)}' +
    '.nxs-err{color:#e06060;font-size:13px;min-height:18px;margin:12px 0 0}';

  function show() {
    if (overlay) return;
    var style = document.createElement('style');
    style.id = 'nxs-style';
    style.textContent = CSS;
    document.head.appendChild(style);

    overlay = document.createElement('div');
    overlay.className = 'nxs-maint';
    overlay.innerHTML =
      '<div class="nxs-rain"></div>' +
      '<div class="nxs-inner">' +
      '<p class="nxs-eyebrow">СИСТЕМНОЕ СООБЩЕНИЕ // 503</p>' +
      '<h1>ТЕХНИЧЕСКИЕ РАБОТЫ</h1>' +
      '<p class="nxs-text">Сайт на технических работах. Мы обновляем узлы — скоро всё заработает.</p>' +
      '<form class="nxs-form"><input class="nxs-in" placeholder="Позывной или email" autocomplete="username"><input class="nxs-in" type="password" placeholder="Пароль" autocomplete="current-password"><button class="nxs-btn" type="submit">Войти как основатель</button></form>' +
      '<p class="nxs-err"></p>' +
      '</div>';
    document.body.appendChild(overlay);

    var form = overlay.querySelector('.nxs-form');
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var errEl = overlay.querySelector('.nxs-err');
      var nk = form.querySelectorAll('input')[0].value.trim();
      var pw = form.querySelectorAll('input')[1].value;
      var email = nk.indexOf('@') >= 0 ? nk : (nk.toLowerCase() + '@' + EMAIL_DOMAIN);
      errEl.textContent = '...';
      fetch(URL + '/auth/v1/token?grant_type=password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: KEY },
        body: JSON.stringify({ email: email, password: pw })
      }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (!res.ok || !res.j || !res.j.access_token) { errEl.textContent = 'Неверный логин или пароль.'; return null; }
          return isFounder(res.j).then(function (ok) {
            if (ok) { try { localStorage.setItem(TOKEN_KEY, JSON.stringify(res.j)); } catch (e) {} remove(); }
            else { errEl.textContent = 'Этот аккаунт не является основателем.'; }
          });
        }).catch(function () { if (overlay) errEl.textContent = 'Ошибка сети.'; });
    });
  }

  function remove() {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
    var s = document.getElementById('nxs-style');
    if (s && s.parentNode) s.parentNode.removeChild(s);
  }

  function check() {
    fetch(URL + '/rest/v1/nexus_sites?slug=eq.' + encodeURIComponent(SLUG) + '&select=maintenance', {
      headers: { apikey: KEY, Authorization: 'Bearer ' + KEY }, cache: 'no-store'
    })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) {
        var site = rows && rows[0];
        if (!site || !site.maintenance) { remove(); return; }
        isFounder(getSession()).then(function (ok) { if (ok) remove(); else show(); });
      })
      .catch(function () {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', check); else check();
  setInterval(check, 60000);
})();
