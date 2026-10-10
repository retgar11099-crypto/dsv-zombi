'use strict';

/* =========================================================
   DSV-Zombi — клиент на Supabase (общая база данных)
   Настройки подключения лежат в js/config.js
   ========================================================= */

const CFG = window.DSV_CONFIG || {};
const SUPABASE_URL = (CFG.SUPABASE_URL || '').trim();
const SUPABASE_ANON_KEY = (CFG.SUPABASE_ANON_KEY || '').trim();
const EMAIL_DOMAIN = 'players.dsv-zombi.local';

const CONFIGURED = /^https?:\/\//i.test(SUPABASE_URL) && SUPABASE_ANON_KEY.length > 20;
let sb = null;
if (CONFIGURED && window.supabase) {
  try { sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY); }
  catch (e) { sb = null; }
}

const ADMIN_NICK = 'Faranatic';
const K_INVITE = 'dsv_pending_invite';

const COLORS = [
  '#4cd137', '#2ecc71', '#00d2d3', '#3498db', '#54a0ff', '#a55eea',
  '#e84118', '#ff6b6b', '#fbc531', '#f39c12', '#ecf0f1', '#95a5a6'
];

const state = {
  user: null,            // { id, nick, role }
  profiles: [],          // [{ id, nick, role }]
  rawTeams: [],          // строки из таблицы teams
  rawMembers: [],        // [{ team_id, nick }]
  rawVotes: [],          // [{ team_id, voter, candidate }]
  teams: [],             // собранные объекты для интерфейса
  inviteToken: localStorage.getItem(K_INVITE) || null,
  pendingAccept: null,
  createColor: COLORS[0],
  messages: [],
  chatTeamId: null,
  chatError: false,
  chatDraft: ''
};

/* ===================== Утилиты ===================== */
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function makeToken() {
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

function sameNick(a, b) {
  return !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (d.toDateString() === now.toDateString()) return hh + ':' + mm;
  return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + ' ' + hh + ':' + mm;
}

function teamColorFor(nick) {
  const t = state.teams.find(x => x.members.some(m => sameNick(m, nick)));
  return t ? t.color : '#4cd137';
}

function avatarHtml(profile, color, cls) {
  const nick = (profile && profile.nick) ? String(profile.nick) : '?';
  const av = (profile && profile.avatar) ? String(profile.avatar).trim() : '';
  const extra = cls ? ' ' + cls : '';
  if (/^https?:\/\//i.test(av)) {
    return `<div class="avatar avatar--img${extra}"><img src="${esc(av)}" alt="" loading="lazy"></div>`;
  }
  const style = color ? ` style="background:${esc(color)}"` : '';
  return `<div class="avatar${extra}"${style}>${esc(nick[0] ? nick[0].toUpperCase() : '?')}</div>`;
}

function roleRank(role) {
  return role === 'founder' ? 2 : (role === 'admin' ? 1 : 0);
}

function isFounder() {
  return !!state.user && (state.user.role === 'founder' ||
    state.user.nick.toLowerCase() === ADMIN_NICK.toLowerCase());
}
function isAdmin() {
  return !!state.user && (state.user.role === 'admin' || state.user.role === 'founder' || isFounder());
}
function findUser(nick) {
  return state.profiles.find(u => sameNick(u.nick, nick)) || null;
}
function roleOf(user) {
  if (!user) return 'player';
  return user.role || 'player';
}
function isPrivilegedNick(nick) {
  return roleRank(roleOf(findUser(nick))) >= 1;
}

function saveInviteToken(token) {
  state.inviteToken = token;
  if (token) localStorage.setItem(K_INVITE, token);
  else localStorage.removeItem(K_INVITE);
}

function toast(msg, type) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast' + (type === 'err' ? ' err' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 3200);
}

function copyText(text, msg) {
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast(msg); } catch (e) { toast('Не удалось скопировать', 'err'); }
    ta.remove();
  };
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => toast(msg)).catch(fallback);
  } else fallback();
}

/* ===================== Загрузка данных ===================== */
function rebuildTeams() {
  state.teams = state.rawTeams.map(t => {
    const members = state.rawMembers.filter(m => m.team_id === t.id).map(m => m.nick);
    const votes = {};
    state.rawVotes.filter(v => v.team_id === t.id).forEach(v => { votes[v.voter] = v.candidate; });
    return {
      id: t.id, name: t.name, desc: t.description || '', color: t.color || '#4cd137',
      leader: t.leader_nick || null, deputy: t.deputy_nick || null, invite: t.invite || null,
      members: members, vote: t.vote_open ? { open: true, votes: votes } : null
    };
  });
}

async function fetchProfiles() {
  let r = await sb.from('profiles').select('id,nick,role,created_at,avatar');
  if (r.error && /avatar/i.test(r.error.message || '')) {
    r = await sb.from('profiles').select('id,nick,role,created_at');
  }
  return r;
}

async function syncData() {
  if (!sb) return;
  const [p, t, m, v] = await Promise.all([
    fetchProfiles(),
    sb.from('teams').select('*'),
    sb.from('team_members').select('team_id,nick'),
    sb.from('votes').select('team_id,voter,candidate')
  ]);
  if (p.error || t.error || m.error || v.error) {
    toast('Не удалось загрузить данные', 'err');
    return;
  }
  state.profiles = p.data || [];
  state.rawTeams = t.data || [];
  state.rawMembers = m.data || [];
  state.rawVotes = v.data || [];

  if (state.user) {
    const me = state.profiles.find(x => x.id === state.user.id);
    if (me) { state.user.nick = me.nick; state.user.role = me.role; }
  }
  rebuildTeams();
  renderAll();
}

function getTeam(id) { return state.teams.find(t => t.id === id) || null; }
function teamOfUser(nick) {
  if (!nick) return null;
  return state.teams.find(t => t.members.some(m => sameNick(m, nick))) || null;
}
function isMember(team, nick) { return !!nick && team.members.some(m => sameNick(m, nick)); }
function isLeaderOf(team, nick) { return sameNick(team.leader, nick); }
function isDeputyOf(team, nick) { return sameNick(team.deputy, nick); }

function canManageTeam(team) {
  if (!state.user || !team) return false;
  if (isAdmin()) return true;
  const me = state.user.nick;
  return isLeaderOf(team, me) || isDeputyOf(team, me);
}
function canEditTeam(team) {
  if (!state.user || !team) return false;
  if (isAdmin()) return true;
  return isLeaderOf(team, state.user.nick);
}
function canAppointLeader() { return isAdmin(); }
function canAppointDeputy(team) {
  if (!state.user || !team) return false;
  if (isAdmin()) return true;
  return isLeaderOf(team, state.user.nick);
}

/* ===================== Модальные окна ===================== */
function syncBodyScroll() {
  document.body.style.overflow = document.querySelector('.modal:not(.hidden)') ? 'hidden' : '';
}
function openModal(el) { el.classList.remove('hidden'); syncBodyScroll(); }
function closeModal(el) { if (!el) return; el.classList.add('hidden'); syncBodyScroll(); }

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
    if (f.type === 'password') {
      return `<label class="field"><span>${esc(f.label)}</span><input type="password" name="${esc(f.name)}" maxlength="${f.maxlength || 64}" placeholder="${esc(f.placeholder || '')}" autocomplete="new-password" ${f.required === false ? '' : 'required'}></label>`;
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
  const btn = $('button[type]', $('form', overlay));
  $('form', overlay).addEventListener('submit', async e => {
    e.preventDefault();
    const values = {};
    fields.forEach(f => {
      if (f.type === 'swatches') values[f.name] = picks[f.name];
      else { const input = $(`[name="${f.name}"]`, overlay); values[f.name] = input ? input.value.trim() : ''; }
    });
    if (btn) btn.disabled = true;
    const err = await onSubmit(values);
    if (btn) btn.disabled = false;
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

  if (hash.indexOf('#/team/') !== 0) leaveChat();

  if (hash.indexOf('#/invite/') === 0) {
    saveInviteToken(decodeURIComponent(hash.slice('#/invite/'.length)));
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
    const team = getTeam(hash.slice('#/team/'.length));
    if (!team) { toast('Команда не найдена', 'err'); location.hash = '#/teams'; return; }
    showView('team');
    setActiveNav('#/teams');
    renderTeamDetail(team);
    window.scrollTo(0, 0);
    return;
  }

  if (hash.indexOf('#/user/') === 0) {
    showView('user');
    setActiveNav('');
    renderUserProfile(decodeURIComponent(hash.slice('#/user/'.length)));
    window.scrollTo(0, 0);
    return;
  }

  if (hash === '#/admin') {
    if (!isFounder()) { toast('Раздел доступен только основателю', 'err'); location.hash = '#/home'; return; }
    showView('admin');
    setActiveNav('#/admin');
    renderAdmin();
    window.scrollTo(0, 0);
    return;
  }

  if (hash === '#/account') {
    if (!state.user) { toast('Сначала войди в аккаунт', 'err'); location.hash = '#/home'; return; }
    showView('account');
    setActiveNav('#/account');
    renderAccount();
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
  if (!sb) {
    box.innerHTML = `<span class="hint">Supabase не настроен: заполни js/config.js</span>`;
    return;
  }
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
  const meProf = findUser(state.user.nick) || { nick: state.user.nick };
  box.innerHTML =
    `<div class="userchip">` +
    avatarHtml(meProf, color) +
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
    const leaderHtml = t.leader ? `<b>${esc(t.leader)}</b>` : `<span class="tag-noleader">нет главы</span>`;
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

    if (isAdmin() && isLeader) {
      btns += `<button class="btn btn--small btn--danger" type="button" data-act="demote-leader" data-nick="${esc(n)}">Снять с поста</button>`;
    }
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
      avatarHtml(findUser(n) || { nick: n }, team.color) +
      `<div class="member__info">` +
      `<span class="member__nick"><a class="nick-link" href="#/user/${encodeURIComponent(n)}">${esc(n)}</a>${isMe ? ' <span class="muted">(вы)</span>' : ''}</span>` +
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

  if (member || isAdmin()) panels += votePanelHtml(team, me, member);

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

  if (member || isAdmin()) {
    panels +=
      `<div class="panel chat-panel">` +
      `<h3>Чат отряда</h3>` +
      `<p class="panel__sub">Сообщения видят только участники отряда.</p>` +
      `<div class="chat-log" id="chat-log"></div>` +
      `<form class="chat-form" id="chat-form">` +
      `<input id="chat-input" name="msg" maxlength="300" placeholder="Написать отряду…" autocomplete="off" required>` +
      `<button class="btn btn--small btn--primary" type="submit">Отправить</button>` +
      `</form>` +
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

  if (member || isAdmin()) loadTeamChat(team);
}

function voteCounts(team) {
  const votes = team.vote && team.vote.votes ? team.vote.votes : {};
  return team.members.map(n => {
    const count = Object.keys(votes).filter(voter => sameNick(votes[voter], n)).length;
    return { nick: n, count: count };
  });
}

function votePanelHtml(team, me, member) {
  const v = team.vote;
  let h = `<div class="panel"><h3>Голосование за главу</h3>`;

  if (!v || !v.open) {
    h += `<p class="panel__sub">Основатель или админ запускает голосование, а участники выбирают нового главу отряда.</p>`;
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
        avatarHtml(findUser(r.nick) || { nick: r.nick }, team.color) +
        `<div class="member__info">` +
        `<span class="member__nick"><a class="nick-link" href="#/user/${encodeURIComponent(r.nick)}">${esc(r.nick)}</a></span>` +
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

/* ===================== Чат отряда ===================== */
let chatChannel = null;

function leaveChat() {
  if (chatChannel && sb) { try { sb.removeChannel(chatChannel); } catch (e) {} }
  chatChannel = null;
  state.chatTeamId = null;
  state.messages = [];
  state.chatDraft = '';
}

async function fetchMessages(teamId) {
  const { data, error } = await sb.from('team_messages')
    .select('id,team_id,nick,body,created_at')
    .eq('team_id', teamId).order('created_at', { ascending: true }).limit(300);
  if (error) { state.chatError = true; state.messages = []; return; }
  state.chatError = false;
  state.messages = data || [];
}

async function loadTeamChat(team) {
  const log = $('#chat-log');
  if (!log) return;
  if (state.chatTeamId !== team.id) {
    state.chatTeamId = team.id;
    state.messages = [];
    state.chatError = false;
    subscribeChat(team.id);
    await fetchMessages(team.id);
  }
  renderChatLog();
  const input = $('#chat-input');
  if (input && state.chatDraft) input.value = state.chatDraft;
}

function renderChatLog() {
  const log = $('#chat-log');
  if (!log) return;
  if (state.chatError) {
    log.innerHTML = `<div class="chat-empty">Чат ещё не настроен на сервере.<br>Нужно добавить таблицу <b>team_messages</b> в Supabase.</div>`;
    return;
  }
  if (!state.messages.length) {
    log.innerHTML = `<div class="chat-empty">Сообщений пока нет. Напиши первым!</div>`;
    return;
  }
  const me = state.user ? state.user.nick : null;
  log.innerHTML = state.messages.map(m => {
    const mine = sameNick(me, m.nick);
    const u = findUser(m.nick);
    return `<div class="chat-msg${mine ? ' chat-msg--mine' : ''}">` +
      avatarHtml(u || { nick: m.nick }, teamColorFor(m.nick)) +
      `<div class="chat-msg__body">` +
      `<div class="chat-msg__head"><a class="nick-link" href="#/user/${encodeURIComponent(m.nick)}">${esc(m.nick)}</a>` +
      `<span class="chat-msg__time">${esc(formatTime(m.created_at))}</span></div>` +
      `<div class="chat-msg__text">${esc(m.body)}</div>` +
      `</div></div>`;
  }).join('');
  log.scrollTop = log.scrollHeight;
}

function subscribeChat(teamId) {
  if (!sb) return;
  if (chatChannel) { try { sb.removeChannel(chatChannel); } catch (e) {} }
  chatChannel = sb.channel('dsv-chat-' + teamId)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'team_messages', filter: 'team_id=eq.' + teamId },
      () => { if (state.chatTeamId === teamId) fetchMessages(teamId).then(renderChatLog); })
    .subscribe();
}

async function sendChatMessage(body) {
  const text = (body || '').trim();
  if (!text || !state.user || !state.chatTeamId) return null;
  if (text.length > 300) return 'Сообщение слишком длинное (максимум 300 символов).';
  const { error } = await sb.from('team_messages').insert({
    team_id: state.chatTeamId, nick: state.user.nick, body: text
  });
  if (error) return 'Не удалось отправить. Возможно, чат ещё не настроен на сервере.';
  await fetchMessages(state.chatTeamId);
  renderChatLog();
  return null;
}

/* ===================== Приглашение ===================== */
function renderInviteBanner() {
  const el = $('#invite-banner');
  const token = state.inviteToken;
  if (!token) { el.classList.add('hidden'); el.innerHTML = ''; return; }

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
  state.pendingAccept = null;
  saveInviteToken(null);
  renderInviteBanner();
}

async function acceptInvite(token) {
  if (!state.user) { state.pendingAccept = token; openAuth('login'); return; }
  const team = state.teams.find(t => t.invite === token);
  if (!team) { toast('Ссылка-приглашение недействительна', 'err'); clearInvite(); return; }
  if (isMember(team, state.user.nick)) {
    toast('Ты уже в этом отряде'); clearInvite(); location.hash = '#/team/' + team.id; return;
  }
  const { error } = await sb.from('team_members').insert({ team_id: team.id, nick: state.user.nick });
  if (error) { toast('Не удалось вступить: ' + error.message, 'err'); return; }
  clearInvite();
  toast('Ты вступил в отряд «' + team.name + '»');
  location.hash = '#/team/' + team.id;
  await syncData();
}

/* ===================== Действия с командами ===================== */
function openCreateModal() {
  if (!isAdmin()) { toast('Команды создаёт только основатель или админ', 'err'); return; }
  const modal = $('#modal-create');
  $('#err-create').textContent = '';
  $('#form-create').reset();
  state.createColor = COLORS[0];
  buildSwatches($('#create-swatches'), state.createColor, c => { state.createColor = c; });
  openModal(modal);
}

async function createTeam(name, desc) {
  const { data, error } = await sb.from('teams')
    .insert({ name: name, description: desc, color: state.createColor, invite: null })
    .select().single();
  if (error) return 'Не удалось создать команду: ' + error.message;
  const { error: me } = await sb.from('team_members').insert({ team_id: data.id, nick: state.user.nick });
  if (me) return 'Команда создана, но не удалось добавить тебя: ' + me.message;
  await syncData();
  toast('Команда «' + name + '» создана');
  location.hash = '#/team/' + data.id;
  return null;
}

function renameTeam(team) {
  if (!canEditTeam(team)) { toast('Недостаточно прав', 'err'); return; }
  formModal({
    title: 'Сменить название',
    fields: [{ name: 'name', label: 'Название команды', maxlength: 24, value: team.name }],
    submitText: 'Сохранить',
    async onSubmit(v) {
      const name = v.name.trim();
      if (name.length < 2) return 'Название слишком короткое (минимум 2 символа).';
      const { error } = await sb.from('teams').update({ name: name }).eq('id', team.id);
      if (error) return 'Ошибка: ' + error.message;
      await syncData();
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
    async onSubmit(v) {
      const { error } = await sb.from('teams').update({ color: v.color }).eq('id', team.id);
      if (error) return 'Ошибка: ' + error.message;
      await syncData();
      toast('Цвет обновлён');
      return null;
    }
  });
}

async function makeLeader(team, nick) {
  if (!canAppointLeader()) { toast('Назначать главу может только основатель или админ', 'err'); return; }
  if (!isMember(team, nick)) { toast('Игрока нет в отряде', 'err'); return; }
  const patch = { leader_nick: nick };
  if (sameNick(team.deputy, nick)) patch.deputy_nick = null;
  const { error } = await sb.from('teams').update(patch).eq('id', team.id);
  if (error) { toast('Ошибка: ' + error.message, 'err'); return; }
  await syncData();
  toast('Теперь глава отряда — ' + nick);
}

async function demoteLeader(team, nick) {
  if (!isAdmin()) { toast('Снять с поста может только админ или основатель', 'err'); return; }
  if (!isLeaderOf(team, nick)) return;
  const { error } = await sb.from('teams').update({ leader_nick: null }).eq('id', team.id);
  if (error) { toast('Ошибка: ' + error.message, 'err'); return; }
  await syncData();
  toast(nick + ' снят с поста главы');
}

async function makeDeputy(team, nick) {
  if (!canAppointDeputy(team)) { toast('Недостаточно прав', 'err'); return; }
  if (!isMember(team, nick)) { toast('Игрока нет в отряде', 'err'); return; }
  if (isLeaderOf(team, nick)) { toast('Глава не может быть замом', 'err'); return; }
  const { error } = await sb.from('teams').update({ deputy_nick: nick }).eq('id', team.id);
  if (error) { toast('Ошибка: ' + error.message, 'err'); return; }
  await syncData();
  toast('Заместитель главы — ' + nick);
}

async function removeDeputy(team, nick) {
  if (!canAppointDeputy(team)) { toast('Недостаточно прав', 'err'); return; }
  if (!isDeputyOf(team, nick)) return;
  const { error } = await sb.from('teams').update({ deputy_nick: null }).eq('id', team.id);
  if (error) { toast('Ошибка: ' + error.message, 'err'); return; }
  await syncData();
  toast('Заместитель снят: ' + nick);
}

async function kickMember(team, nick) {
  if (!canManageTeam(team)) { toast('Недостаточно прав', 'err'); return; }
  if (isLeaderOf(team, nick)) { toast('Сначала назначь другого главу', 'err'); return; }
  if (isPrivilegedNick(nick) && !isAdmin()) { toast('Нельзя исключить админа или основателя', 'err'); return; }
  if (state.user && sameNick(nick, state.user.nick)) { toast('Чтобы выйти, нажми «Покинуть команду»', 'err'); return; }
  const { error } = await sb.from('team_members').delete().eq('team_id', team.id).eq('nick', nick);
  if (error) { toast('Ошибка: ' + error.message, 'err'); return; }
  if (isDeputyOf(team, nick)) await sb.from('teams').update({ deputy_nick: null }).eq('id', team.id);
  await syncData();
  toast(nick + ' исключён из отряда');
}

async function leaveTeam(team) {
  if (!state.user || !isMember(team, state.user.nick)) return;
  const nick = state.user.nick;
  await sb.from('team_members').delete().eq('team_id', team.id).eq('nick', nick);
  const patch = {};
  if (isLeaderOf(team, nick)) patch.leader_nick = null;
  if (isDeputyOf(team, nick)) patch.deputy_nick = null;
  if (Object.keys(patch).length) await sb.from('teams').update(patch).eq('id', team.id);
  await sb.from('votes').delete().eq('team_id', team.id).eq('voter', nick);
  toast('Ты покинул отряд «' + team.name + '»');
  location.hash = '#/teams';
  await syncData();
}

/* ===================== Голосование за главу ===================== */
async function startVote(team) {
  if (!isAdmin()) { toast('Голосование запускает основатель или админ', 'err'); return; }
  if (team.members.length < 2) { toast('Нужно минимум 2 участника', 'err'); return; }
  await sb.from('votes').delete().eq('team_id', team.id);
  const { error } = await sb.from('teams').update({ vote_open: true }).eq('id', team.id);
  if (error) { toast('Ошибка: ' + error.message, 'err'); return; }
  await syncData();
  toast('Голосование за главу запущено');
}

async function castVote(team, candidate) {
  if (!state.user || !isMember(team, state.user.nick)) { toast('Голосовать могут только участники отряда', 'err'); return; }
  if (!team.vote || !team.vote.open) { toast('Голосование не активно', 'err'); return; }
  if (!isMember(team, candidate)) { toast('Такого участника нет в отряде', 'err'); return; }
  const { error } = await sb.from('votes').upsert(
    { team_id: team.id, voter: state.user.nick, candidate: candidate },
    { onConflict: 'team_id,voter' }
  );
  if (error) { toast('Ошибка: ' + error.message, 'err'); return; }
  await syncData();
  toast('Голос отдан: ' + candidate);
}

async function cancelVote(team) {
  if (!isAdmin()) return;
  await sb.from('votes').delete().eq('team_id', team.id);
  await sb.from('teams').update({ vote_open: false }).eq('id', team.id);
  await syncData();
  toast('Голосование отменено');
}

async function applyVote(team) {
  if (!isAdmin()) return;
  if (!team.vote) return;
  const results = voteCounts(team);
  const max = Math.max(0, ...results.map(r => r.count));
  const winners = results.filter(r => r.count === max && max > 0);
  if (winners.length !== 1) { toast('Нет однозначного победителя', 'err'); return; }
  const patch = { leader_nick: winners[0].nick, vote_open: false };
  if (sameNick(team.deputy, winners[0].nick)) patch.deputy_nick = null;
  await sb.from('votes').delete().eq('team_id', team.id);
  const { error } = await sb.from('teams').update(patch).eq('id', team.id);
  if (error) { toast('Ошибка: ' + error.message, 'err'); return; }
  await syncData();
  toast('Глава по итогам голосования — ' + winners[0].nick);
}

/* ===================== Админы ===================== */
async function promoteToAdmin(nick) {
  if (!isFounder()) { toast('Только основатель может выдавать админку', 'err'); return; }
  const u = findUser(nick);
  if (!u || roleOf(u) === 'founder') return;
  const { error } = await sb.from('profiles').update({ role: 'admin' }).eq('id', u.id);
  if (error) { toast('Ошибка: ' + error.message, 'err'); return; }
  await syncData();
  toast(nick + ' теперь админ');
}

async function demoteFromAdmin(nick) {
  if (!isFounder()) { toast('Только основатель может снимать админку', 'err'); return; }
  const u = findUser(nick);
  if (!u || roleOf(u) === 'founder') return;
  const { error } = await sb.from('profiles').update({ role: 'player' }).eq('id', u.id);
  if (error) { toast('Ошибка: ' + error.message, 'err'); return; }
  await syncData();
  toast(nick + ' больше не админ');
}

function renderAdmin() {
  const box = $('#admin-detail');
  if (!box || !isFounder()) return;
  box.innerHTML =
    `<div class="page-head"><div>` +
    `<h1 class="page-title">Админы</h1>` +
    `<p class="section__lead">Основатель выдаёт и снимает права админа. Админы создают отряды и назначают главу.</p>` +
    `</div></div>` +
    `<div class="admin-list">` +
    state.profiles.slice().sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)).map(u => {
      const role = roleOf(u);
      const roleLabel = role === 'founder' ? 'Основатель' : (role === 'admin' ? 'Админ' : 'Игрок');
      let btn;
      if (role === 'admin') btn = `<button class="btn btn--small btn--danger" type="button" data-act="demote-admin" data-nick="${esc(u.nick)}">Снять админа</button>`;
      else if (role === 'player') btn = `<button class="btn btn--small btn--ghost" type="button" data-act="promote-admin" data-nick="${esc(u.nick)}">Сделать админом</button>`;
      else btn = `<span class="badge">основатель</span>`;
      return `<div class="admin-row">` +
        avatarHtml(u, role === 'founder' ? '#fbc531' : teamColorFor(u.nick)) +
        `<div class="member__info"><span class="member__nick"><a class="nick-link" href="#/user/${encodeURIComponent(u.nick)}">${esc(u.nick)}</a></span>` +
        `<span class="admin-row__role ${role}">${roleLabel}</span>` +
        `<span class="admin-row__date">Регистрация: ${esc(formatDate(u.created_at))}</span></div>` +
        `<div class="member__actions">${btn}</div>` +
        `</div>`;
    }).join('') +
    `</div>`;
}

/* ===================== Личный кабинет ===================== */
function renderAccount() {
  const box = $('#account-detail');
  const me = state.user;
  if (!box || !me) return;

  const profile = state.profiles.find(p => p.id === me.id) ||
    { id: me.id, nick: me.nick, role: me.role, created_at: null };
  const myNick = profile.nick;
  const role = roleOf(profile);
  const roleLabel = role === 'founder' ? 'Основатель' : (role === 'admin' ? 'Админ' : 'Игрок');
  const badge = role === 'founder'
    ? ' <span class="badge">основатель</span>'
    : (role === 'admin' ? ' <span class="badge">админ</span>' : '');

  const myTeams = state.teams.filter(t => t.members.some(m => sameNick(m, myNick)));
  const color = myTeams[0] ? myTeams[0].color : '#4cd137';

  const teamsHtml = myTeams.length
    ? myTeams.map(t => {
        let roleTxt = 'Боец';
        if (isLeaderOf(t, myNick)) roleTxt = 'Глава';
        else if (isDeputyOf(t, myNick)) roleTxt = 'Заместитель';
        return `<div class="account-team" style="--tc:${t.color}">` +
          `<div class="account-team__stripe"></div>` +
          `<div class="account-team__info">` +
          `<div class="account-team__name">${esc(t.name)}</div>` +
          `<div class="account-team__meta">Участников: ${t.members.length} · Ты — ${roleTxt}</div>` +
          `</div>` +
          `<a class="btn btn--small btn--ghost" href="#/team/${t.id}">Открыть</a>` +
          `</div>`;
      }).join('')
    : `<div class="empty">` +
      `<h2>Ты пока без отряда</h2>` +
      `<p>Найди команду в общем списке или прими ссылку-приглашение от главы.</p>` +
      `<a class="btn btn--primary" href="#/teams">К командам</a></div>`;

  box.innerHTML =
    `<div class="page-head">` +
    `<div><h1 class="page-title">Личный кабинет</h1>` +
    `<p class="section__lead">Профиль, отряды и безопасность аккаунта.</p></div>` +
    `<div class="page-actions"><a class="btn btn--small btn--ghost" href="#/user/${encodeURIComponent(myNick)}">Мой публичный профиль</a></div>` +
    `</div>` +
    `<div class="account-hero" style="--ac:${color}">` +
    avatarHtml(profile, color, 'avatar--lg') +
    `<div class="account-hero__info">` +
    `<div class="account-hero__nick">${esc(myNick)}${badge}</div>` +
    `<div class="account-hero__meta">${roleLabel} · Зарегистрирован: ${esc(formatDate(profile.created_at))}</div>` +
    `</div>` +
    `</div>` +
    `<div class="account-grid">` +
    `<div class="account-col">` +
    `<h2 class="block-title">Мои отряды</h2>` +
    `<div class="account-teams">${teamsHtml}</div>` +
    `</div>` +
    `<div class="account-col">` +
    `<h2 class="block-title">Аккаунт</h2>` +
    `<div class="panel">` +
    `<h3>Аватар</h3>` +
    `<p class="panel__sub">Загрузи картинку с компьютера — её увидят все игроки в списках и в профиле.</p>` +
    `<button class="btn btn--small btn--primary" type="button" data-act="change-avatar">Загрузить аватар</button>` +
    `</div>` +
    `<div class="panel">` +
    `<h3>Безопасность</h3>` +
    `<p class="panel__sub">Смени пароль от аккаунта DSV. Вход остаётся под твоим ником.</p>` +
    `<button class="btn btn--small btn--ghost" type="button" data-act="change-password">Сменить пароль</button>` +
    `</div>` +
    (isFounder()
      ? `<div class="panel"><h3>Права основателя</h3>` +
        `<p class="panel__sub">Тебе доступен раздел управления админами сети.</p>` +
        `<a class="btn btn--small btn--primary" href="#/admin">Открыть админов</a></div>`
      : '') +
    `</div>` +
    `</div>`;
}

function openChangePassword() {
  formModal({
    title: 'Сменить пароль',
    fields: [
      { name: 'pass', label: 'Новый пароль (минимум 6 символов)', type: 'password' },
      { name: 'pass2', label: 'Повтори новый пароль', type: 'password' }
    ],
    submitText: 'Обновить',
    async onSubmit(v) {
      if (String(v.pass || '').length < 6) return 'Пароль должен быть от 6 символов.';
      if (v.pass !== v.pass2) return 'Пароли не совпадают.';
      const { error } = await sb.auth.updateUser({ password: v.pass });
      if (error) return 'Ошибка: ' + error.message;
      toast('Пароль обновлён');
      return null;
    }
  });
}

/* ===================== Аватар ===================== */
async function uploadAvatar(file) {
  if (!sb || !state.user) return null;
  const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const path = state.user.id + '/' + Date.now() + '.' + ext;
  const { error } = await sb.storage.from('avatars').upload(path, file, {
    upsert: true, cacheControl: '3600', contentType: file.type || 'image/png'
  });
  if (error) { console.error(error); return null; }
  const { data } = sb.storage.from('avatars').getPublicUrl(path);
  return data ? data.publicUrl : null;
}

async function saveAvatarUrl(url) {
  if (!sb || !state.user) return 'Сначала войди в аккаунт.';
  const { error } = await sb.from('profiles').update({ avatar: url || null }).eq('id', state.user.id);
  if (error) return 'Ошибка: ' + error.message + ' (нужна колонка avatar на сервере)';
  const p = state.profiles.find(x => x.id === state.user.id);
  if (p) p.avatar = url || null;
  await syncData();
  toast(url ? 'Аватар обновлён' : 'Аватар удалён');
  return null;
}

function openAvatarModal() {
  if (!state.user) { toast('Сначала войди в аккаунт', 'err'); return; }
  const prof = findUser(state.user.nick) || { nick: state.user.nick };
  const color = teamColorFor(state.user.nick);
  const current = prof.avatar || '';
  const overlay = document.createElement('div');
  overlay.className = 'modal';
  overlay.dataset.dynamic = '1';
  overlay.innerHTML =
    `<div class="modal__box">` +
    `<button class="modal__close" type="button" data-close-modal aria-label="Закрыть">&times;</button>` +
    `<h2 class="modal__title">Аватар</h2>` +
    `<form>` +
    `<div class="avatar-preview" id="avatar-preview">${avatarHtml({ nick: state.user.nick, avatar: current }, color, 'avatar--xl')}</div>` +
    `<label class="field"><span>Картинка (PNG, JPG, WEBP, GIF — до 2 МБ)</span>` +
    `<input type="file" name="file" accept="image/png,image/jpeg,image/webp,image/gif"></label>` +
    `<div class="form-error"></div>` +
    `<div class="panel__row">` +
    `<button class="btn btn--primary" type="submit">Загрузить</button>` +
    (current ? `<button class="btn btn--small btn--danger" type="button" data-avatar-remove>Удалить аватар</button>` : '') +
    `</div></form></div>`;
  document.body.appendChild(overlay);

  const preview = $('#avatar-preview', overlay);
  const fileInput = $('input[name="file"]', overlay);
  fileInput.addEventListener('change', () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    preview.innerHTML = `<div class="avatar avatar--xl avatar--img"><img src="${url}" alt=""></div>`;
  });

  const rm = $('[data-avatar-remove]', overlay);
  if (rm) rm.addEventListener('click', async () => {
    const msg = await saveAvatarUrl('');
    if (msg) { $('.form-error', overlay).textContent = msg; return; }
    overlay.remove(); syncBodyScroll();
  });

  $('form', overlay).addEventListener('submit', async e => {
    e.preventDefault();
    const errEl = $('.form-error', overlay);
    errEl.textContent = '';
    const f = fileInput.files && fileInput.files[0];
    if (!f) { errEl.textContent = 'Выбери файл.'; return; }
    if (!/^image\//.test(f.type || '')) { errEl.textContent = 'Это не картинка.'; return; }
    if (f.size > 2 * 1024 * 1024) { errEl.textContent = 'Файл больше 2 МБ.'; return; }
    const btn = $('button[type="submit"]', overlay);
    if (btn) btn.disabled = true;
    errEl.textContent = 'Загружаем…';
    const url = await uploadAvatar(f);
    if (btn) btn.disabled = false;
    if (!url) { errEl.textContent = 'Не удалось загрузить. Нужен бакет «avatars» в Supabase.'; return; }
    const msg = await saveAvatarUrl(url);
    if (msg) { errEl.textContent = msg; return; }
    overlay.remove(); syncBodyScroll();
  });

  overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); syncBodyScroll(); } });
  syncBodyScroll();
}

/* ===================== Профиль игрока ===================== */
function renderUserProfile(nick) {
  const box = $('#user-detail');
  if (!box) return;
  const u = findUser(nick);
  if (!u) {
    box.innerHTML =
      `<div class="page-head"><div><h1 class="page-title">Профиль игрока</h1></div></div>` +
      `<div class="empty"><h2>Игрок не найден</h2>` +
      `<p>Аккаунта с ником «${esc(nick)}» нет.</p>` +
      `<a class="btn btn--ghost" href="#/teams">К командам</a></div>`;
    return;
  }
  const role = roleOf(u);
  const roleLabel = role === 'founder' ? 'Основатель' : (role === 'admin' ? 'Админ' : 'Игрок');
  const badge = role === 'founder'
    ? ' <span class="badge">основатель</span>'
    : (role === 'admin' ? ' <span class="badge">админ</span>' : '');
  const isMe = state.user && sameNick(state.user.nick, u.nick);
  const userTeams = state.teams.filter(t => t.members.some(m => sameNick(m, u.nick)));
  const color = userTeams[0] ? userTeams[0].color : '#4cd137';

  const teamsHtml = userTeams.length
    ? userTeams.map(t => {
        let roleTxt = 'Боец';
        if (isLeaderOf(t, u.nick)) roleTxt = 'Глава';
        else if (isDeputyOf(t, u.nick)) roleTxt = 'Заместитель';
        return `<div class="account-team" style="--tc:${t.color}">` +
          `<div class="account-team__stripe"></div>` +
          `<div class="account-team__info">` +
          `<div class="account-team__name">${esc(t.name)}</div>` +
          `<div class="account-team__meta">Участников: ${t.members.length} · Роль: ${roleTxt}</div>` +
          `</div>` +
          `<a class="btn btn--small btn--ghost" href="#/team/${t.id}">Открыть</a>` +
          `</div>`;
      }).join('')
    : `<div class="empty"><h2>Без отряда</h2>` +
      `<p>${esc(u.nick)} пока не состоит в отряде.</p></div>`;

  box.innerHTML =
    `<div class="page-head"><div>` +
    `<h1 class="page-title">Профиль игрока</h1>` +
    `<p class="section__lead"><a class="nick-link" href="#/teams">Команды</a> · профиль ${esc(u.nick)}</p></div>` +
    (isMe ? `<div class="page-actions"><a class="btn btn--small btn--ghost" href="#/account">Личный кабинет</a></div>` : '') +
    `</div>` +
    `<div class="account-hero" style="--ac:${color}">` +
    avatarHtml(u, color, 'avatar--lg') +
    `<div class="account-hero__info">` +
    `<div class="account-hero__nick">${esc(u.nick)}${badge}</div>` +
    `<div class="account-hero__meta">${roleLabel} · Зарегистрирован: ${esc(formatDate(u.created_at))}</div>` +
    `</div></div>` +
    `<h2 class="block-title">Отряды</h2>` +
    `<div class="account-teams">${teamsHtml}</div>`;
}

/* ===================== Auth ===================== */
function emailFor(nick) { return nick.toLowerCase() + '@' + EMAIL_DOMAIN; }

function switchAuthTab(tab) {
  $$('[data-authtab]').forEach(b => b.classList.toggle('active', b.dataset.authtab === tab));
  $('#form-login').classList.toggle('hidden', tab !== 'login');
  $('#form-register').classList.toggle('hidden', tab !== 'register');
  $('#err-login').textContent = '';
  $('#err-register').textContent = '';
}
function openAuth(tab) { switchAuthTab(tab || 'login'); openModal($('#modal-auth')); }

async function afterAuth() {
  closeModal($('#modal-auth'));
  renderAll();
  toast('С возвращением, ' + state.user.nick + '!');
  if (state.pendingAccept) {
    const token = state.pendingAccept;
    state.pendingAccept = null;
    await acceptInvite(token);
  }
}

/* ===================== Рендер всего ===================== */
function renderAll() {
  renderHeader();
  renderNav();
  renderInviteBanner();
  if (!$('#view-teams').classList.contains('hidden')) renderTeams();
  if (!$('#view-admin').classList.contains('hidden')) renderAdmin();
  if (!$('#view-account').classList.contains('hidden')) renderAccount();
  if (!$('#view-user').classList.contains('hidden')) {
    const h = location.hash;
    if (h.indexOf('#/user/') === 0) renderUserProfile(decodeURIComponent(h.slice('#/user/'.length)));
  }
  if (!$('#view-team').classList.contains('hidden')) {
    const hash = location.hash;
    if (hash.indexOf('#/team/') === 0) {
      const team = getTeam(hash.slice('#/team/'.length));
      if (team) renderTeamDetail(team); else renderTeams();
    }
  }
}

/* ===================== Инициализация ===================== */
function wireEvents() {
  window.addEventListener('hashchange', route);

  document.addEventListener('click', async e => {
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
        await sb.auth.signOut();
        state.user = null;
        renderAll();
        toast('Ты вышел из аккаунта');
        break;
      case 'create-team': openCreateModal(); break;
      case 'rename': if (currentTeam && canEditTeam(currentTeam)) renameTeam(currentTeam); break;
      case 'recolor': if (currentTeam && canEditTeam(currentTeam)) recolorTeam(currentTeam); break;
      case 'make-leader': if (currentTeam) await makeLeader(currentTeam, btn.dataset.nick); break;
      case 'demote-leader': if (currentTeam) await demoteLeader(currentTeam, btn.dataset.nick); break;
      case 'make-deputy': if (currentTeam) await makeDeputy(currentTeam, btn.dataset.nick); break;
      case 'remove-deputy': if (currentTeam) await removeDeputy(currentTeam, btn.dataset.nick); break;
      case 'kick': if (currentTeam) await kickMember(currentTeam, btn.dataset.nick); break;
      case 'leave': if (currentTeam) await leaveTeam(currentTeam); break;
      case 'start-vote': if (currentTeam) await startVote(currentTeam); break;
      case 'vote': if (currentTeam) await castVote(currentTeam, btn.dataset.nick); break;
      case 'apply-vote': if (currentTeam) await applyVote(currentTeam); break;
      case 'cancel-vote': if (currentTeam) await cancelVote(currentTeam); break;
      case 'promote-admin': await promoteToAdmin(btn.dataset.nick); break;
      case 'demote-admin': await demoteFromAdmin(btn.dataset.nick); break;
      case 'change-password': openChangePassword(); break;
      case 'change-avatar': openAvatarModal(); break;
      case 'copy-invite':
        if (currentTeam && currentTeam.invite) copyText(inviteUrl(currentTeam), 'Ссылка скопирована');
        break;
      case 'regen-invite':
        if (currentTeam && canManageTeam(currentTeam)) {
          const token = makeToken();
          const { error } = await sb.from('teams').update({ invite: token }).eq('id', currentTeam.id);
          if (error) { toast('Ошибка: ' + error.message, 'err'); break; }
          currentTeam.invite = token;
          renderTeamDetail(currentTeam);
          copyText(inviteUrl(currentTeam), 'Новая ссылка создана и скопирована');
        }
        break;
      case 'accept-invite': await acceptInvite(state.inviteToken); break;
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
    if (dyn.length) { dyn[dyn.length - 1].remove(); syncBodyScroll(); return; }
    const open = document.querySelector('.modal:not(.hidden)');
    if (open) closeModal(open);
  });

  $$('.modal:not([data-dynamic])').forEach(modal => {
    modal.addEventListener('click', e => { if (e.target === modal) closeModal(modal); });
  });

  $$('[data-authtab]').forEach(b => b.addEventListener('click', () => switchAuthTab(b.dataset.authtab)));

  $('#form-login').addEventListener('submit', async e => {
    e.preventDefault();
    const nick = e.target.nick.value.trim();
    const pass = e.target.pass.value;
    const err = $('#err-login');
    err.textContent = '';
    if (!nick || !pass) { err.textContent = 'Заполни ник и пароль.'; return; }
    err.textContent = 'Входим…';
    const { data, error } = await sb.auth.signInWithPassword({ email: emailFor(nick), password: pass });
    if (error) { err.textContent = 'Неверный ник или пароль.'; return; }
    let prof = null;
    const q = await sb.from('profiles').select('id,nick,role').eq('id', data.user.id).maybeSingle();
    prof = q.data;
    if (!prof) {
      const role = nick.toLowerCase() === ADMIN_NICK.toLowerCase() ? 'founder' : 'player';
      await sb.from('profiles').insert({ id: data.user.id, nick: nick, role: role });
      prof = { id: data.user.id, nick: nick, role: role };
    }
    state.user = { id: prof.id, nick: prof.nick, role: prof.role };
    e.target.reset();
    await syncData();
    await afterAuth();
  });

  $('#form-register').addEventListener('submit', async e => {
    e.preventDefault();
    const nick = e.target.nick.value.trim();
    const pass = e.target.pass.value;
    const pass2 = e.target.pass2.value;
    const err = $('#err-register');
    err.textContent = '';

    if (!/^[A-Za-z0-9_]{3,16}$/.test(nick)) { err.textContent = 'Ник: 3–16 символов, латиница, цифры и знак _.'; return; }
    if (pass.length < 6) { err.textContent = 'Пароль должен быть от 6 символов.'; return; }
    if (pass !== pass2) { err.textContent = 'Пароли не совпадают.'; return; }

    err.textContent = 'Создаём аккаунт…';
    const { data, error } = await sb.auth.signUp({ email: emailFor(nick), password: pass });
    if (error) {
      err.textContent = /already/i.test(error.message)
        ? 'Такой ник уже занят.'
        : 'Ошибка регистрации: ' + error.message;
      return;
    }
    if (!data.session) {
      err.textContent = 'Включено подтверждение почты в Supabase. Отключи его: Authentication → Providers → Email → Confirm email = off.';
      return;
    }
    const role = nick.toLowerCase() === ADMIN_NICK.toLowerCase() ? 'founder' : 'player';
    const { error: pe } = await sb.from('profiles').insert({ id: data.user.id, nick: nick, role: role });
    if (pe) { err.textContent = 'Не удалось сохранить профиль: ' + pe.message; return; }
    state.user = { id: data.user.id, nick: nick, role: role };
    e.target.reset();
    closeModal($('#modal-auth'));
    await syncData();
    toast('Аккаунт создан, добро пожаловать!');
    if (state.pendingAccept) { const token = state.pendingAccept; state.pendingAccept = null; await acceptInvite(token); }
  });

  $('#form-create').addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('#err-create');
    err.textContent = '';
    if (!isAdmin()) { err.textContent = 'Создавать команды может только основатель или админ.'; return; }
    const name = e.target.name.value.trim();
    const desc = e.target.desc.value.trim();
    if (name.length < 2) { err.textContent = 'Введи название (минимум 2 символа).'; return; }
    const box = $('#modal-create');
    const submitBtn = $('.btn--primary', $('form', box));
    if (submitBtn) submitBtn.disabled = true;
    const msg = await createTeam(name, desc);
    if (submitBtn) submitBtn.disabled = false;
    if (msg) { err.textContent = msg; return; }
    closeModal(box);
    e.target.reset();
  });

  document.addEventListener('submit', async e => {
    if (!e.target || e.target.id !== 'chat-form') return;
    e.preventDefault();
    const input = $('input', e.target);
    const body = input ? input.value : '';
    if (input) input.value = '';
    state.chatDraft = '';
    const err = await sendChatMessage(body);
    if (err) { toast(err, 'err'); if (input) input.value = body; }
  });

  document.addEventListener('input', e => {
    if (e.target && e.target.id === 'chat-input') state.chatDraft = e.target.value;
  });

  $('#copy-ip').addEventListener('click', () => copyText('DSV-Zom.minerent.io', 'IP сервера скопирован'));

  document.addEventListener('click', e => {
    const a = e.target.closest('a[href^="#"]:not([href^="#/"])');
    if (!a) return;
    const id = a.getAttribute('href').slice(1);
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    if (location.hash === a.getAttribute('href')) el.scrollIntoView({ behavior: 'smooth' });
    else location.hash = a.getAttribute('href');
  });
}

async function init() {
  wireEvents();

  if (!sb) {
    renderHeader();
    toast('Заполни js/config.js (URL и anon key Supabase)', 'err');
    return;
  }

  const sess = await sb.auth.getSession();
  if (sess.data && sess.data.session) {
    const uid = sess.data.session.user.id;
    const q = await sb.from('profiles').select('id,nick,role').eq('id', uid).maybeSingle();
    if (q.data) state.user = { id: q.data.id, nick: q.data.nick, role: q.data.role };
  }

  sb.channel('dsv-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, () => { syncData(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => { syncData(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'team_members' }, () => { syncData(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'votes' }, () => { syncData(); })
    .subscribe();

  await syncData();
  route();
}

init();
