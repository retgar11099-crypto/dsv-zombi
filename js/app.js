'use strict';

/* ===================== Хранилище ===================== */
const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch (e) {}
  }
};

const K_USERS = 'dsv_users';
const K_SESSION = 'dsv_session';
const K_TEAMS = 'dsv_teams';
const K_INVITE = 'dsv_pending_invite';

const ADMIN_NICK = 'Faranatic';
const ADMIN_PASS = 'ret345464';

const COLORS = [
  '#4cd137', '#2ecc71', '#00d2d3', '#3498db', '#54a0ff', '#a55eea',
  '#e84118', '#ff6b6b', '#fbc531', '#f39c12', '#ecf0f1', '#95a5a6'
];

const state = {
  user: null,
  teams: [],
  inviteToken: store.get(K_INVITE, null),
  pendingAccept: null,
  createColor: COLORS[0]
};

/* ===================== Утилиты ===================== */
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function uid() {
  return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function makeToken() {
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

function roleOf(user) {
  if (!user) return 'player';
  if (user.role) return user.role;
  return (user.nick && user.nick.toLowerCase() === ADMIN_NICK.toLowerCase()) ? 'founder' : 'player';
}
function isFounder() {
  return !!state.user && (state.user.role === 'founder' ||
    state.user.nick.toLowerCase() === ADMIN_NICK.toLowerCase());
}
function isAdmin() {
  return !!state.user && (state.user.role === 'admin' || state.user.role === 'founder' || isFounder());
}

function saveTeams() { store.set(K_TEAMS, state.teams); }
function getTeam(id) { return state.teams.find(t => t.id === id) || null; }
function teamOfUser(nick) {
  if (!nick) return null;
  return state.teams.find(t => t.members.some(m => m.toLowerCase() === nick.toLowerCase())) || null;
}
function sameNick(a, b) {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}
function isMember(team, nick) {
  return !!nick && team.members.some(m => m.toLowerCase() === nick.toLowerCase());
}
function isLeaderOf(team, nick) { return sameNick(team.leader, nick); }
function isDeputyOf(team, nick) { return sameNick(team.deputy, nick); }
function isPrivilegedNick(nick) {
  const r = roleOf(findUser(nick));
  return r === 'founder' || r === 'admin';
}

// Приглашать и исключать: основатель, админ, глава или зам
function canManageTeam(team) {
  if (!state.user || !team) return false;
  if (isAdmin()) return true;
  const me = state.user.nick;
  return isLeaderOf(team, me) || isDeputyOf(team, me);
}
// Менять название и цвет: основатель, админ или глава
function canEditTeam(team) {
  if (!state.user || !team) return false;
  if (isAdmin()) return true;
  return isLeaderOf(team, state.user.nick);
}
// Назначать главу может только основатель или админ
function canAppointLeader() { return isAdmin(); }
// Назначать зама: основатель, админ или глава отряда
function canAppointDeputy(team) {
  if (!state.user || !team) return false;
  if (isAdmin()) return true;
  return isLeaderOf(team, state.user.nick);
}

function toast(msg, type) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast' + (type === 'err' ? ' err' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 2600);
}

function copyText(text, msg) {
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      toast(msg);
    } catch (e) {
      toast('Не удалось скопировать', 'err');
    }
    ta.remove();
  };
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => toast(msg)).catch(fallback);
  } else {
    fallback();
  }
}

/* ===================== Пользователи ===================== */
function users() { return store.get(K_USERS, []); }

function ensureAdmin() {
  const list = users();
  const idx = list.findIndex(u => u.nick.toLowerCase() === ADMIN_NICK.toLowerCase());
  if (idx === -1) {
    list.push({ nick: ADMIN_NICK, pass: ADMIN_PASS, role: 'founder' });
  } else {
    list[idx].role = 'founder';
    if (!list[idx].pass) list[idx].pass = ADMIN_PASS;
  }
  store.set(K_USERS, list);
}

function findUser(nick) {
  return users().find(u => u.nick.toLowerCase() === String(nick).toLowerCase()) || null;
}

function afterAuth() {
  closeModal($('#modal-auth'));
  renderAll();
  toast('С возвращением, ' + state.user.nick + '!');
  if (state.pendingAccept) {
    const token = state.pendingAccept;
    state.pendingAccept = null;
    acceptInvite(token);
  }
}

/* ===================== Модальные окна ===================== */
function syncBodyScroll() {
  document.body.style.overflow = document.querySelector('.modal:not(.hidden)') ? 'hidden' : '';
}

function openModal(el) {
  el.classList.remove('hidden');
  syncBodyScroll();
}

function closeModal(el) {
  if (!el) return;
  el.classList.add('hidden');
  syncBodyScroll();
}

function formModal(opts) {
  const { title, fields, submitText, onSubmit } = opts;
  const overlay = document.createElement('div');
  overlay.className = 'modal';
  overlay.dataset.dynamic = '1';

  const inputsHtml = fields.map(f => {
    if (f.type === 'swatches') {
      return `<div class="field"><span>${esc(f.label)}</span><div class="swatches" data-swatches="${esc(f.name)}"></div></div>`;
    }
    if (f.type === 'textarea') {
      return `<label class="field"><span>${esc(f.label)}</span><textarea name="${esc(f.name)}" maxlength="${f.maxlength || 120}" placeholder="${esc(f.placeholder || '')}">${esc(f.value || '')}</textarea></label>`;
    }
    return `<label class="field"><span>${esc(f.label)}</span><input name="${esc(f.name)}" maxlength="${f.maxlength || 24}" placeholder="${esc(f.placeholder || '')}" value="${esc(f.value || '')}" ${f.required === false ? '' : 'required'}></label>`;
  }).join('');

  overlay.innerHTML =
    `<div class="modal__box">` +
    `<button class="modal__close" type="button" aria-label="Закрыть">&times;</button>` +
    `<h2 class="modal__title">${esc(title)}</h2>` +
    `<form>${inputsHtml}<div class="form-error"></div>` +
    `<button class="btn btn--primary btn--block">${esc(submitText || 'Сохранить')}</button></form>` +
    `</div>`;

  document.body.appendChild(overlay);

  const picks = {};
  fields.filter(f => f.type === 'swatches').forEach(f => {
    picks[f.name] = f.value || COLORS[0];
    buildSwatches($(`[data-swatches="${f.name}"]`, overlay), picks[f.name], c => { picks[f.name] = c; });
  });

  const errorEl = $('.form-error', overlay);
  $('form', overlay).addEventListener('submit', e => {
    e.preventDefault();
    const values = {};
    fields.forEach(f => {
      if (f.type === 'swatches') values[f.name] = picks[f.name];
      else {
        const input = $(`[name="${f.name}"]`, overlay);
        values[f.name] = input ? input.value.trim() : '';
      }
    });
    const err = onSubmit(values);
    if (err) { errorEl.textContent = err; return; }
    overlay.remove();
    syncBodyScroll();
  });

  overlay.addEventListener('click', e => {
    if (e.target === overlay || e.target.closest('[data-close-modal]')) {
      overlay.remove();
      syncBodyScroll();
    }
  });

  syncBodyScroll();
  const first = $('input, textarea', overlay);
  if (first) first.focus();
  return overlay;
}

function buildSwatches(container, current, onPick) {
  container.innerHTML = '';
  COLORS.forEach(c => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch' + (c === current ? ' active' : '');
    b.style.background = c;
    b.title = c;
    b.addEventListener('click', () => {
      $$('.swatch', container).forEach(s => s.classList.remove('active'));
      b.classList.add('active');
      onPick(c);
    });
    container.appendChild(b);
  });
}

/* ===================== Роутер ===================== */
function showView(id) {
  $$('.view').forEach(v => v.classList.add('hidden'));
  const view = $('#view-' + id);
  if (view) view.classList.remove('hidden');
}

function setActiveNav(href) {
  $$('[data-navlink]').forEach(a => a.classList.toggle('active', a.getAttribute('href') === href));
}

function route() {
  const hash = location.hash || '#/home';

  if (hash.indexOf('#/invite/') === 0) {
    state.inviteToken = decodeURIComponent(hash.slice('#/invite/'.length));
    store.set(K_INVITE, state.inviteToken);
    showView('teams');
    setActiveNav('#/teams');
    renderTeams();
    renderInviteBanner();
    window.scrollTo(0, 0);
    return;
  }

  if (hash.indexOf('#/') !== 0) {
    showView('home');
    setActiveNav('#/home');
    const el = document.getElementById(hash.slice(1));
    if (el) el.scrollIntoView({ behavior: 'smooth' });
    return;
  }

  if (hash.indexOf('#/team/') === 0) {
    const id = hash.slice('#/team/'.length);
    const team = getTeam(id);
    if (!team) {
      toast('Команда не найдена', 'err');
      location.hash = '#/teams';
      return;
    }
    showView('team');
    setActiveNav('#/teams');
    renderTeamDetail(team);
    window.scrollTo(0, 0);
    return;
  }

  if (hash === '#/admin') {
    if (!isFounder()) {
      toast('Раздел доступен только основателю', 'err');
      location.hash = '#/home';
      return;
    }
    showView('admin');
    setActiveNav('#/admin');
    renderAdmin();
    window.scrollTo(0, 0);
    return;
  }

  if (hash === '#/teams') {
    showView('teams');
    setActiveNav('#/teams');
    renderTeams();
    renderInviteBanner();
    window.scrollTo(0, 0);
    return;
  }

  showView('home');
  setActiveNav('#/home');
  renderInviteBanner();
  if (hash !== '#/home') window.scrollTo(0, 0);
}

/* ===================== Шапка ===================== */
function renderNav() {
  const navAdmin = $('#nav-admin');
  if (navAdmin) navAdmin.classList.toggle('hidden', !isFounder());
}

function renderHeader() {
  const box = $('#header-auth');
  if (!state.user) {
    box.innerHTML =
      `<button class="btn btn--small btn--ghost" type="button" data-act="open-login">Вход</button>` +
      `<button class="btn btn--small btn--primary" type="button" data-act="open-register">Регистрация</button>`;
    return;
  }
  const team = teamOfUser(state.user.nick);
  const color = team ? team.color : '';
  const badge = isFounder()
    ? ' <span class="badge">основатель</span>'
    : (isAdmin() ? ' <span class="badge">админ</span>' : '');
  box.innerHTML =
    `<div class="userchip">` +
    `<div class="avatar"${color ? ` style="background:${color}"` : ''}>${esc(state.user.nick[0].toUpperCase())}</div>` +
    `<div><span class="userchip__nick">${esc(state.user.nick)}${badge}</span>` +
    `<span class="userchip__team">${team ? 'Отряд: ' + esc(team.name) : 'Без отряда'}</span></div>` +
    `</div>` +
    `<button class="btn btn--small btn--ghost" type="button" data-act="logout">Выйти</button>`;
}

/* ===================== Список команд ===================== */
function renderTeams() {
  const actions = $('#teams-actions');
  actions.innerHTML = isAdmin()
    ? `<button class="btn btn--primary" type="button" data-act="create-team">Создать команду</button>`
    : `<span class="hint">Создавать команды может только основатель или админ</span>`;

  const list = $('#teams-list');
  if (!state.teams.length) {
    list.innerHTML =
      `<div class="empty">` +
      `<h2>Команд пока нет</h2>` +
      `<p>Ни один отряд ещё не создан. Выжившие пока собираются поодиночке.</p>` +
      (isAdmin()
        ? `<button class="btn btn--primary" type="button" data-act="create-team">Создать первую команду</button>`
        : `<p class="hint" style="margin-top:12px">Создавать команды может только основатель или админ.</p>`) +
      `</div>`;
    return;
  }

  list.innerHTML = state.teams.map(t => {
    const leaderHtml = t.leader
      ? `<b>${esc(t.leader)}</b>`
      : `<span class="tag-noleader">нет главы</span>`;
    return (
      `<article class="team-card" style="--tc:${t.color}">` +
      `<div class="team-card__stripe"></div>` +
      `<div class="team-card__body">` +
      `<div class="team-card__name">${esc(t.name)}</div>` +
      `<div class="team-card__desc">${t.desc ? esc(t.desc) : 'Описание не задано.'}</div>` +
      `<div class="team-card__meta">` +
      `<span>Участников: <b>${t.members.length}</b></span>` +
      `<span>Глава: ${leaderHtml}</span>` +
      `</div>` +
      `<a class="btn btn--small btn--ghost" href="#/team/${t.id}">Открыть</a>` +
      `</div></article>`
    );
  }).join('');
}

/* ===================== Страница команды ===================== */
function inviteUrl(team) {
  return location.href.split('#')[0] + '#/invite/' + team.invite;
}

function renderTeamDetail(team) {
  const me = state.user ? state.user.nick : null;
  const member = isMember(team, me);
  const leader = team.leader;
  const deputy = team.deputy;

  const chips = [];
  if (leader) chips.push(`<span class="chip chip--leader">Глава: ${esc(leader)}</span>`);
  else chips.push(`<span class="chip">Глава не назначен</span>`);
  if (deputy) chips.push(`<span class="chip chip--deputy">Заместитель: ${esc(deputy)}</span>`);
  if (member) chips.push(`<span class="chip chip--you">Вы в этом отряде</span>`);
  if (isAdmin()) chips.push(`<span class="chip chip--admin">${isFounder() ? 'Основатель' : 'Администратор'}</span>`);

  const membersHtml = team.members.map(n => {
    const isLeader = isLeaderOf(team, n);
    const isDeputy = isDeputyOf(team, n);
    const isMe = sameNick(me, n);
    let btns = '';

    if (canAppointLeader() && !isLeader) {
      btns += `<button class="btn btn--small btn--ghost" type="button" data-act="make-leader" data-nick="${esc(n)}">Сделать главой</button>`;
    }
    if (canAppointDeputy(team) && !isLeader && !isMe) {
      btns += isDeputy
        ? `<button class="btn btn--small btn--ghost" type="button" data-act="remove-deputy" data-nick="${esc(n)}">Снять зама</button>`
        : `<button class="btn btn--small btn--ghost" type="button" data-act="make-deputy" data-nick="${esc(n)}">Сделать замом</button>`;
    }
    if (canManageTeam(team) && !isLeader && !isMe && (!isPrivilegedNick(n) || isAdmin())) {
      btns += `<button class="btn btn--small btn--danger" type="button" data-act="kick" data-nick="${esc(n)}">Исключить</button>`;
    }

    const roleLabel = isLeader ? 'Глава' : (isDeputy ? 'Заместитель' : 'Боец');
    const roleClass = isLeader ? ' leader' : (isDeputy ? ' deputy' : '');

    return (
      `<div class="member${isLeader ? ' member--leader' : ''}">` +
      `<div class="avatar" style="background:${team.color}">${esc(n[0].toUpperCase())}</div>` +
      `<div class="member__info">` +
      `<span class="member__nick">${esc(n)}${isMe ? ' <span class="muted">(вы)</span>' : ''}</span>` +
      `<span class="member__role${roleClass}">${roleLabel}</span>` +
      `</div>` +
      `<div class="member__actions">${btns}</div>` +
      `</div>`
    );
  }).join('') || `<div class="empty"><h2>Пока пусто</h2><p>В отряде нет участников.</p></div>`;

  let panels = '';

  if (canEditTeam(team)) {
    panels +=
      `<div class="panel">` +
      `<h3>Управление отрядом</h3>` +
      `<p class="panel__sub">Название и цвет видны всем в общем списке команд.</p>` +
      `<div class="panel__row">` +
      `<button class="btn btn--small btn--ghost" type="button" data-act="rename">Сменить название</button>` +
      `<button class="btn btn--small btn--ghost" type="button" data-act="recolor">Сменить цвет</button>` +
      `</div></div>`;
  }

  if (canManageTeam(team)) {
    panels +=
      `<div class="panel">` +
      `<h3>Ссылка-приглашение</h3>` +
      `<p class="panel__sub">Глава и зам могут приглашать новых участников. Отправь другу ссылку — он откроет её и нажмёт «Принять».</p>` +
      (team.invite
        ? `<div class="invite-box"><input readonly value="${esc(inviteUrl(team))}"></div>` +
          `<div class="panel__row">` +
          `<button class="btn btn--small btn--ghost" type="button" data-act="copy-invite">Копировать</button>` +
          `<button class="btn btn--small btn--ghost" type="button" data-act="regen-invite">Обновить ссылку</button>` +
          `</div>`
        : `<button class="btn btn--small btn--primary" type="button" data-act="regen-invite">Создать ссылку</button>`) +
      `</div>`;
  }

  if (member || isAdmin()) {
    panels += votePanelHtml(team, me, member);
  }

  if (member) {
    panels +=
      `<div class="panel">` +
      `<h3>Покинуть отряд</h3>` +
      `<p class="panel__sub">Ты сможешь вернуться только по новой ссылке-приглашению.</p>` +
      `<button class="btn btn--danger btn--small" type="button" data-act="leave">Покинуть команду</button>` +
      `</div>`;
  } else if (!me) {
    panels +=
      `<div class="panel">` +
      `<h3>Как вступить</h3>` +
      `<p class="panel__sub">Войди в аккаунт и открой ссылку-приглашение от главы отряда.</p>` +
      `<button class="btn btn--small btn--primary" type="button" data-act="open-login">Войти</button>` +
      `</div>`;
  } else {
    panels +=
      `<div class="panel">` +
      `<h3>Как вступить</h3>` +
      `<p class="panel__sub">Попроси главу отряда прислать тебе ссылку-приглашение и открой её.</p>` +
      `</div>`;
  }

  $('#team-detail').innerHTML =
    `<div class="team-hero" style="--tc:${team.color}">` +
    `<div>` +
    `<div class="team-hero__label">Отряд · ${team.members.length} участников</div>` +
    `<h1>${esc(team.name)}</h1>` +
    `<p class="team-hero__desc">${team.desc ? esc(team.desc) : 'Описание не задано.'}</p>` +
    `</div>` +
    `<div class="team-hero__badges">${chips.join('')}` +
    `<a class="btn btn--small btn--ghost" href="#/teams">Все команды</a>` +
    `</div></div>` +
    `<div class="team-layout">` +
    `<div><h2 class="block-title">Состав</h2><div class="members">${membersHtml}</div></div>` +
    `<div>${panels}</div>` +
    `</div>`;
}

function voteCounts(team) {
  const v = team.vote;
  const votes = v && v.votes ? v.votes : {};
  return team.members.map(n => {
    const count = Object.keys(votes).filter(voter => sameNick(votes[voter], n)).length;
    return { nick: n, count: count };
  });
}

function votePanelHtml(team, me, member) {
  const v = team.vote;
  let h = `<div class="panel"><h3>Голосование за главу</h3>`;

  if (!v || !v.open) {
    h +=
      `<p class="panel__sub">Основатель или админ запускает голосование, а участники выбирают нового главу отряда.</p>`;
    if (isAdmin()) {
      h += `<button class="btn btn--small btn--primary" type="button" data-act="start-vote">Начать голосование</button>`;
    } else if (member) {
      h += `<p class="hint">Голосование пока не начато. Его запускает основатель или админ.</p>`;
    }
  } else {
    const results = voteCounts(team);
    const max = Math.max(0, ...results.map(r => r.count));
    const leaders = results.filter(r => r.count === max && max > 0);
    h += `<p class="panel__sub">Отдай голос за участника, который, по-твоему, должен вести отряд.</p>`;
    h += `<div class="members">`;
    results.forEach(r => {
      const myVote = member && v.votes[me] && sameNick(v.votes[me], r.nick);
      const isLeader = isLeaderOf(team, r.nick);
      const extra = (myVote ? ' · ваш голос' : '') + (isLeader ? ' · текущий глава' : '');
      h +=
        `<div class="member">` +
        `<div class="avatar" style="background:${team.color}">${esc(r.nick[0].toUpperCase())}</div>` +
        `<div class="member__info">` +
        `<span class="member__nick">${esc(r.nick)}</span>` +
        `<span class="member__role">Голосов: ${r.count}${extra}</span>` +
        `</div>` +
        ((member && !myVote)
          ? `<div class="member__actions"><button class="btn btn--small btn--ghost" type="button" data-act="vote" data-nick="${esc(r.nick)}">Голосовать</button></div>`
          : '') +
        `</div>`;
    });
    h += `</div>`;

    if (isAdmin()) {
      h += `<div class="panel__row">`;
      if (leaders.length === 1) {
        h += `<button class="btn btn--small btn--primary" type="button" data-act="apply-vote">Назначить главой: ${esc(leaders[0].nick)}</button>`;
      } else {
        h += `<span class="hint">${max === 0 ? 'Пока нет голосов.' : 'Ничья — назначь главу вручную в составе.'}</span>`;
      }
      h += `<button class="btn btn--small btn--ghost" type="button" data-act="cancel-vote">Отменить голосование</button>`;
      h += `</div>`;
    }
  }

  h += `</div>`;
  return h;
}

/* ===================== Приглашение ===================== */
function renderInviteBanner() {
  const el = $('#invite-banner');
  const token = state.inviteToken;
  if (!token) {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }

  const team = state.teams.find(t => t.invite === token);
  let body;

  if (!team) {
    body =
      `<div><b>Ссылка-приглашение недействительна.</b> Возможно, глава обновил её.</div>` +
      `<div class="invite-banner__actions">` +
      `<button class="btn btn--small btn--ghost" type="button" data-act="decline-invite">Закрыть</button></div>`;
  } else if (!state.user) {
    body =
      `<div>Приглашение в отряд <b style="color:${team.color}">«${esc(team.name)}»</b>. Войди в аккаунт, чтобы принять его.</div>` +
      `<div class="invite-banner__actions">` +
      `<button class="btn btn--small btn--primary" type="button" data-act="invite-login">Войти</button>` +
      `<button class="btn btn--small btn--ghost" type="button" data-act="decline-invite">Отклонить</button></div>`;
  } else if (isMember(team, state.user.nick)) {
    body =
      `<div>Ты уже состоишь в отряде <b style="color:${team.color}">«${esc(team.name)}»</b>.</div>` +
      `<div class="invite-banner__actions">` +
      `<a class="btn btn--small btn--primary" href="#/team/${team.id}">Открыть отряд</a>` +
      `<button class="btn btn--small btn--ghost" type="button" data-act="decline-invite">Закрыть</button></div>`;
  } else {
    body =
      `<div>Приглашение в отряд <b style="color:${team.color}">«${esc(team.name)}»</b>${team.leader ? ` от ${esc(team.leader)}` : ''}.</div>` +
      `<div class="invite-banner__actions">` +
      `<button class="btn btn--small btn--primary" type="button" data-act="accept-invite">Принять</button>` +
      `<button class="btn btn--small btn--ghost" type="button" data-act="decline-invite">Отклонить</button></div>`;
  }

  el.innerHTML = `<div class="container invite-banner__inner">${body}</div>`;
  el.classList.remove('hidden');
}

function clearInvite() {
  state.inviteToken = null;
  state.pendingAccept = null;
  store.remove(K_INVITE);
  renderInviteBanner();
}

function acceptInvite(token) {
  if (!state.user) {
    state.pendingAccept = token;
    openAuth('login');
    return;
  }
  const team = state.teams.find(t => t.invite === token);
  if (!team) {
    toast('Ссылка-приглашение недействительна', 'err');
    clearInvite();
    return;
  }
  if (isMember(team, state.user.nick)) {
    toast('Ты уже в этом отряде');
    clearInvite();
    location.hash = '#/team/' + team.id;
    return;
  }
  team.members.push(state.user.nick);
  saveTeams();
  clearInvite();
  toast('Ты вступил в отряд «' + team.name + '»');
  location.hash = '#/team/' + team.id;
}

/* ===================== Действия с командами ===================== */
function openCreateModal() {
  if (!isAdmin()) {
    toast('Команды создаёт только основатель или админ', 'err');
    return;
  }
  const modal = $('#modal-create');
  $('#err-create').textContent = '';
  $('#form-create').reset();
  state.createColor = COLORS[0];
  buildSwatches($('#create-swatches'), state.createColor, c => { state.createColor = c; });
  openModal(modal);
}

function renameTeam(team) {
  if (!canEditTeam(team)) { toast('Недостаточно прав', 'err'); return; }
  formModal({
    title: 'Сменить название',
    fields: [{ name: 'name', label: 'Название команды', maxlength: 24, value: team.name }],
    submitText: 'Сохранить',
    onSubmit(v) {
      const name = v.name.trim();
      if (name.length < 2) return 'Название слишком короткое (минимум 2 символа).';
      team.name = name;
      saveTeams();
      renderAll();
      toast('Название обновлено');
      return null;
    }
  });
}

function recolorTeam(team) {
  if (!canEditTeam(team)) { toast('Недостаточно прав', 'err'); return; }
  formModal({
    title: 'Сменить цвет',
    fields: [{ name: 'color', label: 'Цвет отряда', type: 'swatches', value: team.color }],
    submitText: 'Сохранить',
    onSubmit(v) {
      team.color = v.color;
      saveTeams();
      renderAll();
      toast('Цвет обновлён');
      return null;
    }
  });
}

function makeLeader(team, nick) {
  if (!canAppointLeader()) { toast('Назначать главу может только основатель или админ', 'err'); return; }
  if (!isMember(team, nick)) { toast('Игрока нет в отряде', 'err'); return; }
  team.leader = nick;
  if (sameNick(team.deputy, nick)) team.deputy = null;
  saveTeams();
  renderAll();
  toast('Теперь глава отряда — ' + nick);
}

function makeDeputy(team, nick) {
  if (!canAppointDeputy(team)) { toast('Недостаточно прав', 'err'); return; }
  if (!isMember(team, nick)) { toast('Игрока нет в отряде', 'err'); return; }
  if (isLeaderOf(team, nick)) { toast('Глава не может быть замом', 'err'); return; }
  team.deputy = nick;
  saveTeams();
  renderAll();
  toast('Заместитель главы — ' + nick);
}

function removeDeputy(team, nick) {
  if (!canAppointDeputy(team)) { toast('Недостаточно прав', 'err'); return; }
  if (!isDeputyOf(team, nick)) return;
  team.deputy = null;
  saveTeams();
  renderAll();
  toast('Заместитель снят: ' + nick);
}

function kickMember(team, nick) {
  if (!canManageTeam(team)) { toast('Недостаточно прав', 'err'); return; }
  if (isLeaderOf(team, nick)) { toast('Сначала назначь другого главу', 'err'); return; }
  if (isPrivilegedNick(nick) && !isAdmin()) { toast('Нельзя исключить админа или основателя', 'err'); return; }
  if (state.user && sameNick(nick, state.user.nick)) { toast('Чтобы выйти, нажми «Покинуть команду»', 'err'); return; }
  team.members = team.members.filter(m => !sameNick(m, nick));
  if (isDeputyOf(team, nick)) team.deputy = null;
  saveTeams();
  renderAll();
  toast(nick + ' исключён из отряда');
}

function leaveTeam(team) {
  if (!state.user || !isMember(team, state.user.nick)) return;
  const nick = state.user.nick;
  team.members = team.members.filter(m => !sameNick(m, nick));
  if (isLeaderOf(team, nick)) team.leader = null;
  if (isDeputyOf(team, nick)) team.deputy = null;
  if (team.vote && team.vote.votes) delete team.vote.votes[nick];
  saveTeams();
  toast('Ты покинул отряд «' + team.name + '»');
  location.hash = '#/teams';
  renderAll();
}

/* ===================== Голосование за главу ===================== */
function startVote(team) {
  if (!isAdmin()) { toast('Голосование запускает основатель или админ', 'err'); return; }
  if (team.members.length < 2) { toast('Нужно минимум 2 участника', 'err'); return; }
  team.vote = { open: true, votes: {} };
  saveTeams();
  renderAll();
  toast('Голосование за главу запущено');
}

function castVote(team, candidate) {
  if (!state.user || !isMember(team, state.user.nick)) { toast('Голосовать могут только участники отряда', 'err'); return; }
  if (!team.vote || !team.vote.open) { toast('Голосование не активно', 'err'); return; }
  if (!isMember(team, candidate)) { toast('Такого участника нет в отряде', 'err'); return; }
  team.vote.votes[state.user.nick] = candidate;
  saveTeams();
  renderAll();
  toast('Голос отдан: ' + candidate);
}

function cancelVote(team) {
  if (!isAdmin()) return;
  team.vote = null;
  saveTeams();
  renderAll();
  toast('Голосование отменено');
}

function applyVote(team) {
  if (!isAdmin()) return;
  if (!team.vote) return;
  const results = voteCounts(team);
  const max = Math.max(0, ...results.map(r => r.count));
  const winners = results.filter(r => r.count === max && max > 0);
  if (winners.length !== 1) { toast('Нет однозначного победителя', 'err'); return; }
  team.leader = winners[0].nick;
  if (sameNick(team.deputy, winners[0].nick)) team.deputy = null;
  team.vote = null;
  saveTeams();
  renderAll();
  toast('Глава по итогам голосования — ' + winners[0].nick);
}

/* ===================== Админы (только основатель) ===================== */
function promoteToAdmin(nick) {
  if (!isFounder()) { toast('Только основатель может выдавать админку', 'err'); return; }
  const list = users();
  const u = list.find(x => sameNick(x.nick, nick));
  if (!u || roleOf(u) === 'founder') return;
  u.role = 'admin';
  store.set(K_USERS, list);
  if (state.user && sameNick(state.user.nick, nick)) state.user.role = 'admin';
  renderAll();
  toast(nick + ' теперь админ');
}

function demoteFromAdmin(nick) {
  if (!isFounder()) { toast('Только основатель может снимать админку', 'err'); return; }
  const list = users();
  const u = list.find(x => sameNick(x.nick, nick));
  if (!u || roleOf(u) === 'founder') return;
  u.role = 'player';
  store.set(K_USERS, list);
  if (state.user && sameNick(state.user.nick, nick)) state.user.role = 'player';
  renderAll();
  toast(nick + ' больше не админ');
}

function renderAdmin() {
  const box = $('#admin-detail');
  if (!box || !isFounder()) return;
  const list = users();
  box.innerHTML =
    `<div class="page-head"><div>` +
    `<h1 class="page-title">Админы</h1>` +
    `<p class="section__lead">Основатель выдаёт и снимает права админа. Админы создают отряды и назначают главу.</p>` +
    `</div></div>` +
    `<div class="admin-list">` +
    list.map(u => {
      const role = roleOf(u);
      const roleLabel = role === 'founder' ? 'Основатель' : (role === 'admin' ? 'Админ' : 'Игрок');
      let btn;
      if (role === 'admin') btn = `<button class="btn btn--small btn--danger" type="button" data-act="demote-admin" data-nick="${esc(u.nick)}">Снять админа</button>`;
      else if (role === 'player') btn = `<button class="btn btn--small btn--ghost" type="button" data-act="promote-admin" data-nick="${esc(u.nick)}">Сделать админом</button>`;
      else btn = `<span class="badge">основатель</span>`;
      return `<div class="admin-row">` +
        `<div class="avatar"${role === 'founder' ? ' style="background:var(--amber)"' : ''}>${esc(u.nick[0].toUpperCase())}</div>` +
        `<div class="member__info"><span class="member__nick">${esc(u.nick)}</span>` +
        `<span class="admin-row__role ${role}">${roleLabel}</span></div>` +
        `<div class="member__actions">${btn}</div>` +
        `</div>`;
    }).join('') +
    `</div>`;
}

/* ===================== Auth ===================== */
function switchAuthTab(tab) {
  $$('[data-authtab]').forEach(b => b.classList.toggle('active', b.dataset.authtab === tab));
  $('#form-login').classList.toggle('hidden', tab !== 'login');
  $('#form-register').classList.toggle('hidden', tab !== 'register');
  $('#err-login').textContent = '';
  $('#err-register').textContent = '';
}

function openAuth(tab) {
  switchAuthTab(tab || 'login');
  openModal($('#modal-auth'));
}

/* ===================== Рендер всего ===================== */
function renderAll() {
  renderHeader();
  renderNav();
  renderInviteBanner();
  const teamsVisible = !$('#view-teams').classList.contains('hidden');
  const teamVisible = !$('#view-team').classList.contains('hidden');
  const adminVisible = !$('#view-admin').classList.contains('hidden');
  if (teamsVisible) renderTeams();
  if (adminVisible) renderAdmin();
  if (teamVisible) {
    const hash = location.hash;
    if (hash.indexOf('#/team/') === 0) {
      const team = getTeam(hash.slice('#/team/'.length));
      if (team) renderTeamDetail(team);
      else renderTeams();
    }
  }
}

/* ===================== Инициализация ===================== */
function init() {
  ensureAdmin();
  state.teams = store.get(K_TEAMS, []);
  if (!Array.isArray(state.teams)) state.teams = [];

  const sessionNick = store.get(K_SESSION, null);
  if (sessionNick) {
    const u = findUser(sessionNick);
    if (u) state.user = { nick: u.nick, role: roleOf(u) };
    else if (sessionNick.toLowerCase() === ADMIN_NICK.toLowerCase()) state.user = { nick: ADMIN_NICK, role: 'founder' };
    else store.remove(K_SESSION);
  }

  window.addEventListener('hashchange', route);

  document.addEventListener('click', e => {
    const closer = e.target.closest('[data-close-modal]');
    if (closer) {
      const modal = closer.closest('.modal');
      if (modal && modal.dataset.dynamic) modal.remove();
      else closeModal(modal);
      syncBodyScroll();
      return;
    }

    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const hash = location.hash;
    const currentTeam = hash.indexOf('#/team/') === 0 ? getTeam(hash.slice('#/team/'.length)) : null;

    switch (act) {
      case 'open-login': openAuth('login'); break;
      case 'open-register': openAuth('register'); break;
      case 'invite-login': openAuth('login'); break;
      case 'logout':
        store.remove(K_SESSION);
        state.user = null;
        renderAll();
        toast('Ты вышел из аккаунта');
        break;
      case 'create-team': openCreateModal(); break;
      case 'rename': if (currentTeam && canEditTeam(currentTeam)) renameTeam(currentTeam); break;
      case 'recolor': if (currentTeam && canEditTeam(currentTeam)) recolorTeam(currentTeam); break;
      case 'make-leader': if (currentTeam) makeLeader(currentTeam, btn.dataset.nick); break;
      case 'make-deputy': if (currentTeam) makeDeputy(currentTeam, btn.dataset.nick); break;
      case 'remove-deputy': if (currentTeam) removeDeputy(currentTeam, btn.dataset.nick); break;
      case 'kick': if (currentTeam) kickMember(currentTeam, btn.dataset.nick); break;
      case 'leave': if (currentTeam) leaveTeam(currentTeam); break;
      case 'start-vote': if (currentTeam) startVote(currentTeam); break;
      case 'vote': if (currentTeam) castVote(currentTeam, btn.dataset.nick); break;
      case 'apply-vote': if (currentTeam) applyVote(currentTeam); break;
      case 'cancel-vote': if (currentTeam) cancelVote(currentTeam); break;
      case 'promote-admin': promoteToAdmin(btn.dataset.nick); break;
      case 'demote-admin': demoteFromAdmin(btn.dataset.nick); break;
      case 'copy-invite':
        if (currentTeam && currentTeam.invite) copyText(inviteUrl(currentTeam), 'Ссылка скопирована');
        break;
      case 'regen-invite':
        if (currentTeam && canManageTeam(currentTeam)) {
          currentTeam.invite = makeToken();
          saveTeams();
          renderTeamDetail(currentTeam);
          copyText(inviteUrl(currentTeam), 'Новая ссылка создана и скопирована');
        }
        break;
      case 'accept-invite': acceptInvite(state.inviteToken); break;
      case 'decline-invite':
        clearInvite();
        if (location.hash.indexOf('#/invite/') === 0) location.hash = '#/home';
        else route();
        toast('Приглашение отклонено');
        break;
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const dyn = $$('.modal[data-dynamic]');
    if (dyn.length) {
      dyn[dyn.length - 1].remove();
      syncBodyScroll();
      return;
    }
    const open = document.querySelector('.modal:not(.hidden)');
    if (open) closeModal(open);
  });

  $$('.modal:not([data-dynamic])').forEach(modal => {
    modal.addEventListener('click', e => {
      if (e.target === modal) closeModal(modal);
    });
  });

  $$('[data-authtab]').forEach(b => b.addEventListener('click', () => switchAuthTab(b.dataset.authtab)));

  $('#form-login').addEventListener('submit', e => {
    e.preventDefault();
    const nick = e.target.nick.value.trim();
    const pass = e.target.pass.value;
    const err = $('#err-login');
    err.textContent = '';
    if (!nick || !pass) { err.textContent = 'Заполни ник и пароль.'; return; }

    const hardAdmin = nick.toLowerCase() === ADMIN_NICK.toLowerCase() && pass === ADMIN_PASS;
    const u = findUser(nick);
    if (!u || (u.pass !== pass && !hardAdmin)) {
      err.textContent = 'Неверный ник или пароль.';
      return;
    }
    state.user = { nick: u.nick, role: roleOf(u) };
    store.set(K_SESSION, u.nick);
    e.target.reset();
    afterAuth();
  });

  $('#form-register').addEventListener('submit', e => {
    e.preventDefault();
    const nick = e.target.nick.value.trim();
    const pass = e.target.pass.value;
    const pass2 = e.target.pass2.value;
    const err = $('#err-register');
    err.textContent = '';

    if (!/^[A-Za-z0-9_]{3,16}$/.test(nick)) {
      err.textContent = 'Ник: 3–16 символов, латиница, цифры и знак _.';
      return;
    }
    if (nick.toLowerCase() === ADMIN_NICK.toLowerCase()) {
      err.textContent = 'Этот ник зарезервирован.';
      return;
    }
    if (pass.length < 6) { err.textContent = 'Пароль должен быть от 6 символов.'; return; }
    if (pass !== pass2) { err.textContent = 'Пароли не совпадают.'; return; }
    if (findUser(nick)) { err.textContent = 'Такой ник уже занят.'; return; }

    const list = users();
    list.push({ nick: nick, pass: pass, role: 'player' });
    store.set(K_USERS, list);
    state.user = { nick: nick, role: 'player' };
    store.set(K_SESSION, nick);
    e.target.reset();
    closeModal($('#modal-auth'));
    renderAll();
    toast('Аккаунт создан, добро пожаловать!');
    if (state.pendingAccept) {
      const token = state.pendingAccept;
      state.pendingAccept = null;
      acceptInvite(token);
    }
  });

  $('#form-create').addEventListener('submit', e => {
    e.preventDefault();
    const err = $('#err-create');
    err.textContent = '';
    if (!isAdmin()) { err.textContent = 'Создавать команды может только администратор.'; return; }

    const name = e.target.name.value.trim();
    const desc = e.target.desc.value.trim();
    if (name.length < 2) { err.textContent = 'Введи название (минимум 2 символа).'; return; }

    const team = {
      id: uid(),
      name: name,
      desc: desc,
      color: state.createColor,
      leader: null,
      deputy: null,
      members: [state.user.nick],
      invite: null,
      vote: null
    };
    state.teams.push(team);
    saveTeams();
    closeModal($('#modal-create'));
    e.target.reset();
    toast('Команда «' + team.name + '» создана');
    location.hash = '#/team/' + team.id;
    renderAll();
  });

  $('#copy-ip').addEventListener('click', () => {
    copyText('DSV-Zom.minerent.io', 'IP сервера скопирован');
  });

  document.addEventListener('click', e => {
    const a = e.target.closest('a[href^="#"]:not([href^="#/"])');
    if (!a) return;
    const id = a.getAttribute('href').slice(1);
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    if (location.hash === a.getAttribute('href')) {
      el.scrollIntoView({ behavior: 'smooth' });
    } else {
      location.hash = a.getAttribute('href');
    }
  });

  renderAll();
  route();
}

init();
