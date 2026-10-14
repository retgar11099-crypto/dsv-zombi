(function () {
  try {
    if (window.__NEXUS_BAR__) return;
    window.__NEXUS_BAR__ = true;

    var HUB = 'https://protocold7.ru/';
    var self = location.hostname.replace(/^www\./, '');
    if (self === 'protocold7.ru') return;

    var SUPABASE_URL = 'https://tgleohmsmwqlvndxfykv.supabase.co';
    var ANON = 'sb_publishable_vOM4373bRXKYAnUeEdTIDA_5gDXE98F';
    var HIDDEN = { redlauncher: 1, hub: 1 };

    var FALLBACK = [
      { slug: 'barotrauma', title: 'Barotrauma', url: 'https://retgar11099-crypto.github.io/barotrauma/' },
      { slug: 'skyhold', title: 'SkyHold', url: 'https://retgar11099-crypto.github.io/skyhold/' },
      { slug: 'project-zomboid', title: 'Project Mantani', url: 'https://retgar11099-crypto.github.io/project-zomboid/' },
      { slug: 'dsv-zombi', title: 'DSV-Zombi', url: 'https://retgar11099-crypto.github.io/dsv-zombi/' },
      { slug: 'gihten', title: 'Gihten', url: 'https://lich.protocold7.ru/' },
      { slug: 'watchgrid', title: 'WATCH_GRID', url: 'https://watch.protocold7.ru/' },
    ];

    var mount = document.createElement('div');
    mount.id = 'nexus-network-bar';
    mount.setAttribute('aria-hidden', 'false');
    var root = mount.attachShadow ? mount.attachShadow({ mode: 'open' }) : mount;

    var css = ''
      + ':host{all:initial}'
      + '*{box-sizing:border-box;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}'
      + '.wrap{position:fixed;left:14px;bottom:14px;z-index:2147483000;color:#e7ecf5}'
      + '.btn{display:flex;align-items:center;gap:8px;padding:8px 12px;border:1px solid #2a3654;border-radius:999px;background:rgba(10,14,24,.86);backdrop-filter:blur(8px);color:#e7ecf5;font:600 11px/1 ui-monospace,monospace;letter-spacing:.12em;cursor:pointer;user-select:none}'
      + '.btn:hover{border-color:#e0a86a;color:#e0a86a}'
      + '.dot{width:7px;height:7px;border-radius:50%;background:#77d4e0;box-shadow:0 0 8px #77d4e0}'
      + '.panel{position:absolute;left:0;bottom:44px;width:250px;padding:10px;border:1px solid #2a3654;border-radius:14px;background:rgba(10,14,24,.94);backdrop-filter:blur(10px);box-shadow:0 18px 40px rgba(0,0,0,.5);display:none}'
      + '.panel.open{display:block}'
      + '.head{display:flex;align-items:center;justify-content:space-between;padding:2px 4px 8px;border-bottom:1px solid #1d2740;margin-bottom:6px}'
      + '.head b{font:700 10px/1 ui-monospace,monospace;letter-spacing:.22em;color:#9aa7bd}'
      + '.head span{font:600 9px/1 ui-monospace,monospace;color:#e0a86a}'
      + 'a.item{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 9px;border-radius:9px;color:#cdd6e6;text-decoration:none;font:500 12px/1.2 ui-monospace,monospace}'
      + 'a.item:hover{background:#151d31;color:#fff}'
      + 'a.item.cur{background:#151d31;color:#77d4e0}'
      + 'a.item.cur::after{content:"●";font-size:8px}'
      + '.maint{color:#6d7688;text-decoration:line-through}'
      + '.tag{font:600 8px/1 ui-monospace,monospace;color:#f0a13b;border:1px solid #4a3a17;border-radius:5px;padding:2px 4px}'
      + '.back{display:block;margin-top:8px;padding:9px;border:1px solid #2a3654;border-radius:9px;text-align:center;color:#e0a86a;text-decoration:none;font:700 11px/1 ui-monospace,monospace;letter-spacing:.1em}'
      + '.back:hover{background:#e0a86a;color:#0a0e18}';

    var wrap = document.createElement('div');
    wrap.className = 'wrap';
    wrap.innerHTML = ''
      + '<style>' + css + '</style>'
      + '<div class="panel" id="panel">'
      +   '<div class="head"><b>СЕТЬ NEXUS</b><span id="count"></span></div>'
      +   '<div id="list"></div>'
      +   '<a class="back" href="' + HUB + '">← ВЕРНУТЬСЯ В ХАБ</a>'
      + '</div>'
      + '<div class="btn" id="btn" role="button" tabindex="0"><span class="dot"></span> NEXUS</div>';
    root.appendChild(wrap);

    var btn = wrap.querySelector('#btn');
    var panel = wrap.querySelector('#panel');
    var list = wrap.querySelector('#list');
    var count = wrap.querySelector('#count');

    function toggle() {
      panel.classList.toggle('open');
    }
    btn.addEventListener('click', toggle);
    btn.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });

    function normalizeUrl(u) {
      try { var x = new URL(u); return { host: x.hostname.replace(/^www\./, ''), path: x.pathname }; } catch (e) { return null; }
    }
    function isCurrent(site) {
      var n = normalizeUrl(site.url);
      if (!n) return false;
      if (n.host !== self) return false;
      var p = location.pathname;
      if (n.host.indexOf('github.io') !== -1) return p.indexOf(n.path) === 0;
      return true;
    }

    function render(sites) {
      var items = sites.filter(function (s) { return !HIDDEN[s.slug]; });
      count.textContent = items.length + ' САЙТОВ';
      list.innerHTML = '';
      items.forEach(function (s) {
        var a = document.createElement('a');
        a.className = 'item' + (isCurrent(s) ? ' cur' : '') + (s.maintenance ? ' maint' : '');
        a.href = s.url;
        var name = document.createElement('span');
        name.textContent = s.title;
        a.appendChild(name);
        if (s.maintenance) {
          var t = document.createElement('span');
          t.className = 'tag';
          t.textContent = 'ТЕХ.РАБОТЫ';
          a.appendChild(t);
        }
        list.appendChild(a);
      });
    }

    render(FALLBACK);
    document.body.appendChild(mount);

    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', SUPABASE_URL + '/rest/v1/nexus_sites?select=slug,title,url,maintenance,sort&order=sort', true);
      xhr.setRequestHeader('apikey', ANON);
      xhr.setRequestHeader('Authorization', 'Bearer ' + ANON);
      xhr.onload = function () {
        try {
          if (xhr.status >= 200 && xhr.status < 300) {
            var data = JSON.parse(xhr.responseText);
            if (data && data.length) render(data);
          }
        } catch (e) {}
      };
      xhr.send();
    } catch (e) {}
  } catch (e) {}
})();
