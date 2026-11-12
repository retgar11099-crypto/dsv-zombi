'use strict';

/* =========================================================
   DSV-Zombi — ДОНАТ
   Витрина лотов для игроков + панель управления для основателя.
   Таблицы Supabase: dsv_donate_rewards, dsv_donate_orders, dsv_donate_settings
   ========================================================= */

(function () {
  const D = (window.DSV_DONATE = {});

  const T_REWARDS = 'dsv_donate_rewards';
  const T_ORDERS = 'dsv_donate_orders';
  const T_SETTINGS = 'dsv_donate_settings';

  let rewards = [];
  let orders = [];
  let settings = { requisites: '', note: '', sbp_qr: '', yookassa_enabled: 'false', yookassa_fn: 'dsv-yookassa' };
  let connected = false;
  let loadedOnce = false;

  const STATUS_LABEL = { new: 'Новая', paid: 'Оплачена', issued: 'Выдано', canceled: 'Отменена' };
  const STATUS_NEXT = { new: 'paid', paid: 'issued' };
  const DEFAULT_NOTE = 'Все донаты идут на хостинг и развитие сервера. После оплаты я проверяю платёж и выдаю привилегии вручную — обычно в течение суток.';

  /* ---------- helpers ---------- */
  function money(n) {
    const v = Math.max(0, Math.round(Number(n) || 0));
    return v.toLocaleString('ru-RU') + ' ₽';
  }
  function shortCode(id) {
    return String(id || '').replace(/-/g, '').slice(0, 8).toUpperCase();
  }
  function missing(err) {
    const m = (err && err.message) || '';
    return /does not exist|relation .* does not exist|Could not find the table|not found/i.test(m);
  }
  function reqLines(text) {
    return String(text || '')
      .split('\n')
      .map(function (l) { return l.trim(); })
      .filter(Boolean);
  }

  /* ---------- data ---------- */
  D.loadData = async function () {
    if (!sb) return;
    const rw = await sb.from(T_REWARDS).select('*').order('sort', { ascending: true });
    if (rw.error) {
      connected = false;
      if (missing(rw.error)) rewards = [];
      else { toast('Донат: не удалось загрузить лоты', 'err'); return; }
    } else {
      connected = true;
      rewards = rw.data || [];
    }

    let or = null;
    if (isFounder()) {
      or = await sb.from(T_ORDERS).select('*').order('created_at', { ascending: false }).limit(300);
    } else if (state.user) {
      or = await sb.from(T_ORDERS).select('*').eq('buyer_nick', state.user.nick).order('created_at', { ascending: false }).limit(60);
    }
    if (or && or.error && !missing(or.error)) toast('Донат: не удалось загрузить заявки', 'err');
    orders = (or && or.data) || [];

    const st = await sb.from(T_SETTINGS).select('key,value');
    if (!st.error && st.data) {
      st.data.forEach(function (row) { settings[row.key] = row.value || ''; });
    }
    loadedOnce = true;
    D.subscribe();
    renderNow();
  };

  let channel = null;
  D.subscribe = function () {
    if (!sb || channel || !connected) return;
    try {
      channel = sb
        .channel('dsv-donate')
        .on('postgres_changes', { event: '*', schema: 'public', table: T_REWARDS }, D.loadData)
        .on('postgres_changes', { event: '*', schema: 'public', table: T_ORDERS }, D.loadData)
        .subscribe();
    } catch (e) { /* realtime optional */ }
  };

  function renderNow() {
    const donateView = document.getElementById('view-donate');
    if (donateView && !donateView.classList.contains('hidden')) D.render();
    const adm = document.getElementById('donate-admin');
    if (adm) D.renderAdmin();
  }

  function onlineOn() { return settings.yookassa_enabled === 'true'; }
  function fnName() { return settings.yookassa_fn || 'dsv-yookassa'; }

  D.toggleOnline = async function () {
    if (!isFounder()) { toast('Только для основателя', 'err'); return; }
    const next = onlineOn() ? 'false' : 'true';
    const { error } = await sb.from(T_SETTINGS).upsert({ key: 'yookassa_enabled', value: next });
    if (error) { toast('Ошибка: ' + error.message, 'err'); return; }
    await D.loadData();
    toast(next === 'true' ? 'Онлайн-оплата включена' : 'Онлайн-оплата выключена');
  };

  D.payOnline = async function (orderId) {
    if (!sb || !sb.functions) { toast('Платёжный сервис недоступен', 'err'); return; }
    toast('Создаю счёт в ЮKassa…');
    try {
      const res = await sb.functions.invoke(fnName(), { body: { order_id: orderId } });
      const data = res && res.data;
      if (res.error || !data || !data.ok || !data.payment_url) {
        toast('ЮKassa: ' + ((data && data.error) || (res.error && res.error.message) || 'не удалось создать счёт'), 'err');
        return;
      }
      window.open(data.payment_url, '_blank', 'noopener');
      toast('Открой вкладку оплаты и подтверди платёж');
      await D.loadData();
    } catch (e) {
      toast('Ошибка платежа: ' + (e && e.message || e), 'err');
    }
  };

  /* ---------- public page ---------- */
  D.render = function () {
    const box = document.getElementById('donate-detail');
    if (!box) return;

    if (!loadedOnce) {
      box.innerHTML = '<div class="page-head"><h1 class="page-title">Донат</h1><p class="section__lead">Загрузка…</p></div>';
      return;
    }

    const visible = isFounder() ? rewards : rewards.filter(function (r) { return r.active; });
    const active = rewards.filter(function (r) { return r.active; });
    const collected = orders
      .filter(function (o) { return o.status === 'issued'; })
      .reduce(function (s, o) { return s + (Number(o.price) || 0); }, 0);
    const note = settings.note || DEFAULT_NOTE;

    let html =
      '<div class="donate-hero">' +
      '<h1 class="page-title">Поддержать DSV-Zombi</h1>' +
      '<p class="section__lead">' + esc(note) + '</p>' +
      '<div class="donate-stats">' +
      '<span class="donate-stat"><b>' + money(collected) + '</b><i>собрано</i></span>' +
      '<span class="donate-stat"><b>' + active.length + '</b><i>лотов доступно</i></span>' +
      '<span class="donate-stat"><b>' + orders.filter(function (o) { return o.status === 'new'; }).length + '</b><i>заявок ждут</i></span>' +
      '</div>' +
      '<p class="donate-reqslink"><a href="requisites.html">Реквизиты, что выдаётся и условия возврата</a></p>' +
      '</div>';

    if (!connected) {
      html +=
        '<div class="panel donate-off">' +
        '<h3>Донат пока не подключён</h3>' +
        '<p class="panel__sub">Таблицы пожертвований ещё не созданы. Основатель запустит их в базу, и здесь появятся лоты. Поддержать сервер уже сейчас можно напрямую в Discord.</p>' +
        '<div class="panel__row"><a class="btn btn--primary btn--small" href="https://discord.gg/RJvGhBAdmc" target="_blank" rel="noopener">Написать в Discord</a></div>' +
        '</div>';
      box.innerHTML = html;
      return;
    }

    if (!visible.length) {
      html += '<div class="empty"><h2>Лотов пока нет</h2><p>Как только основатель добавит привилегии, они появятся здесь.</p></div>';
    } else {
      html += '<div class="dg-grid">' + visible.map(cardHtml).join('') + '</div>';
    }

    if (state.user) {
      const mine = orders;
      html +=
        '<div class="panel" style="margin-top:34px">' +
        '<h3>Мои заявки</h3>' +
        (mine.length
          ? '<div class="dg-orders">' + mine.map(orderRowHtml).join('') + '</div>'
          : '<p class="panel__sub">Заявок нет. Выбери лот выше — после оплаты я проверю и выдам привилегии.</p>') +
        '</div>';
    } else if (visible.length) {
      html +=
        '<div class="panel" style="margin-top:34px">' +
        '<h3>Нужен аккаунт</h3>' +
        '<p class="panel__sub">Чтобы оформить заявку, войди: ник должен совпадать с игровым, иначе привилегии не привяжутся.</p>' +
        '<div class="panel__row"><button class="btn btn--small btn--primary" type="button" data-act="open-login">Войти</button></div>' +
        '</div>';
    }

    box.innerHTML = html;
  };

  function cardHtml(r) {
    const perks = Array.isArray(r.perks) ? r.perks.filter(Boolean) : [];
    const color = r.color || '#4cd137';
    return (
      '<article class="dg-card' + (r.active ? '' : ' dg-card--off') + '" style="--dg:' + esc(color) + '">' +
      (r.badge ? '<span class="dg-ribbon">' + esc(r.badge) + '</span>' : '') +
      (r.active ? '' : '<span class="dg-hidden-chip">скрыт</span>') +
      '<h3 class="dg-title">' + esc(r.title) + '</h3>' +
      '<div class="dg-price">' + money(r.price) + '</div>' +
      (r.description ? '<p class="dg-desc">' + esc(r.description) + '</p>' : '') +
      (perks.length ? '<ul class="dg-perks">' + perks.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>' : '') +
      '<button class="btn btn--small btn--primary dg-buy" type="button" data-act="donate-order" data-id="' + esc(r.id) + '">Поддержать</button>' +
      '</article>'
    );
  }

  function orderRowHtml(o) {
    return (
      '<div class="dg-order">' +
      '<span class="dg-order__main"><b>' + esc(o.reward_title) + '</b> · ' + money(o.price) + '</span>' +
      '<span class="chip dg-order__status dg-status--' + esc(o.status) + '">' + (STATUS_LABEL[o.status] || esc(o.status)) + '</span>' +
      '<span class="muted dg-order__code">код ' + esc(shortCode(o.id)) + '</span>' +
      '<span class="muted dg-order__date">' + esc(formatDate(o.created_at)) + '</span>' +
      '<button class="btn btn--small btn--ghost" type="button" data-act="donate-copy-code" data-code="' + esc(shortCode(o.id)) + '">Код</button>' +
      '</div>'
    );
  }

  /* ---------- order flow ---------- */
  D.openOrder = function (id) {
    const r = rewards.find(function (x) { return x.id === id; });
    if (!r) { toast('Лот не найден', 'err'); return; }
    if (!state.user) { toast('Сначала войди в аккаунт', 'err'); openAuth('login'); return; }

    formModal({
      title: 'Заявка: ' + r.title,
      fields: [
        { name: 'contact', label: 'Контакт (Discord или телефон)', maxlength: 80, placeholder: 'например Faranatic или +7 900 000-00-00' },
        { name: 'comment', label: 'Комментарий (необязательно)', type: 'textarea', maxlength: 300, placeholder: 'игровой ник, пожелания' }
      ],
      submitText: 'Создать заявку',
      async onSubmit(values) {
        const payload = {
          reward_id: r.id,
          reward_title: r.title,
          price: Math.max(1, Math.round(Number(r.price) || 1)),
          buyer_nick: state.user.nick,
          contact: values.contact,
          comment: values.comment,
          status: 'new'
        };
        const { data, error } = await sb.from(T_ORDERS).insert(payload).select('id').single();
        if (error) return 'Не удалось создать заявку: ' + error.message;
        await D.loadData();
        openPayModal(data.id, payload.price, r.title);
        return null;
      }
    });
  };

  function openPayModal(orderId, price, title) {
    const code = shortCode(orderId);
    const reqs = reqLines(settings.requisites);
    const online = onlineOn();
    const overlay = document.createElement('div');
    overlay.className = 'modal';
    overlay.dataset.dynamic = '1';
    overlay.innerHTML =
      '<div class="modal__box dg-pay">' +
      '<button class="modal__close" type="button" data-close-modal aria-label="Закрыть">&times;</button>' +
      '<h2 class="modal__title">Как оплатить</h2>' +
      '<p class="dg-pay__sum"><b>' + money(price) + '</b> — ' + esc(title) + '</p>' +
      '<p class="dg-pay__code">Код заявки: <code>' + esc(code) + '</code> — укажи его в комментарии платежа, так я быстрее всё проверю.</p>' +
      (settings.sbp_qr
        ? '<div class="dg-pay__qrbox"><img class="dg-pay__qr" src="' + esc(settings.sbp_qr) + '" alt="QR-код СБП"><a class="dg-pay__qrlink" href="' + esc(settings.sbp_qr) + '" download>Скачать QR</a></div>'
        : '') +
      (reqs.length
        ? '<div class="dg-pay__req">' + reqs.map(function (l) { return '<div class="dg-pay__line">' + esc(l) + '</div>'; }).join('') + '</div>'
        : '<p class="muted">Реквизиты ещё не настроены. Основатель допишет их в админ-панели, а пока напиши в Discord.</p>') +
      (settings.sbp_qr || reqs.length
        ? '<p class="dg-pay__howto">Открой приложение банка &rarr; «Оплата по QR» &rarr; отсканируйте код или приложи файл. В комментарии платежа укажи код заявки, чтобы я нашёл твой платёж.</p>'
        : '') +
      '<p class="dg-pay__note">' + esc(settings.note || DEFAULT_NOTE) + (online ? ' При онлайн-оплате чек пришлю ссылкой после зачисления.' : '') + '</p>' +
      '<p class="donate-reqslink"><a href="requisites.html" target="_blank" rel="noopener">Реквизиты и правила</a></p>' +
      (onlineOn()
        ? '<button class="btn btn--primary btn--block" type="button" data-act="donate-pay" data-id="' + esc(orderId) + '">Оплатить онлайн (карта, СБП, SberPay)</button>'
        : '') +
      '<button class="btn btn--primary btn--block" type="button" data-act="donate-copy-code" data-code="' + esc(code) + '">Скопировать код заявки</button>' +
      '</div>';
    document.body.appendChild(overlay);
    syncBodyScroll();
  }

  D.copyCode = function (code) {
    copyText(code, 'Код ' + code + ' скопирован');
  };

  /* ---------- founder: rewards CRUD ---------- */
  D.editReward = function (id) {
    if (!isFounder()) { toast('Только для основателя', 'err'); return; }
    const r = id ? rewards.find(function (x) { return x.id === id; }) : null;
    formModal({
      title: r ? 'Правка лота' : 'Новый лот',
      fields: [
        { name: 'title', label: 'Название', maxlength: 40, value: r ? r.title : '' },
        { name: 'price', label: 'Цена в рублях', maxlength: 7, value: r ? String(r.price) : '', placeholder: 'например 149' },
        { name: 'badge', label: 'Плашка (ХАЙП, VIP…)', maxlength: 16, required: false, value: r ? (r.badge || '') : '' },
        { name: 'description', label: 'Описание', type: 'textarea', maxlength: 300, value: r ? (r.description || '') : '' },
        { name: 'perks', label: 'Что получает игрок (по строке на пункт)', type: 'textarea', maxlength: 600, required: false, value: r && Array.isArray(r.perks) ? r.perks.join('\n') : '' },
        { name: 'color', label: 'Цвет карточки', type: 'swatches', value: r ? (r.color || COLORS[0]) : COLORS[0] }
      ],
      submitText: r ? 'Сохранить' : 'Создать лот',
      async onSubmit(v) {
        const price = Math.round(Number(v.price));
        if (!isFinite(price) || price < 1) return 'Цена должна быть числом от 1 рубля.';
        const perks = String(v.perks || '')
          .split('\n')
          .map(function (p) { return p.trim(); })
          .filter(Boolean)
          .slice(0, 12);
        const payload = {
          title: v.title,
          price: price,
          badge: v.badge || null,
          description: v.description || '',
          perks: perks,
          color: v.color
        };
        let error;
        if (r) {
          const res = await sb.from(T_REWARDS).update(payload).eq('id', r.id);
          error = res.error;
        } else {
          const maxSort = rewards.reduce(function (m, x) { return Math.max(m, Number(x.sort) || 0); }, 0);
          const res = await sb.from(T_REWARDS).insert(Object.assign({ active: true, sort: maxSort + 1 }, payload));
          error = res.error;
        }
        if (error) return 'Ошибка: ' + error.message;
        await D.loadData();
        toast(r ? 'Лот обновлён' : 'Лот создан');
        return null;
      }
    });
  };

  D.toggleReward = async function (id) {
    if (!isFounder()) return;
    const r = rewards.find(function (x) { return x.id === id; });
    if (!r) return;
    const { error } = await sb.from(T_REWARDS).update({ active: !r.active }).eq('id', id);
    if (error) { toast('Ошибка: ' + error.message, 'err'); return; }
    await D.loadData();
    toast(r.active ? 'Лот скрыт' : 'Лот опубликован');
  };

  D.deleteReward = async function (id) {
    if (!isFounder()) return;
    const r = rewards.find(function (x) { return x.id === id; });
    if (!r) return;
    if (!window.confirm('Удалить лот «' + r.title + '»? Заявки игроков останутся.')) return;
    const { error } = await sb.from(T_REWARDS).delete().eq('id', id);
    if (error) { toast('Ошибка: ' + error.message, 'err'); return; }
    await D.loadData();
    toast('Лот удалён');
  };

  /* ---------- founder: orders ---------- */
  D.setOrderStatus = async function (id, status) {
    if (!isFounder()) { toast('Только для основателя', 'err'); return; }
    if (!STATUS_LABEL[status]) return;
    const { error } = await sb.from(T_ORDERS).update({ status: status, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { toast('Ошибка: ' + error.message, 'err'); return; }
    await D.loadData();
    toast('Статус: ' + STATUS_LABEL[status]);
  };

  D.editSettings = function () {
    if (!isFounder()) { toast('Только для основателя', 'err'); return; }
    formModal({
      title: 'Приём платежей',
      fields: [
        { name: 'requisites', label: 'Реквизиты (каждая строка отдельно)', type: 'textarea', maxlength: 600, value: settings.requisites || '', placeholder: 'СБП: +7 900 000-00-00\nПолучатель: Иван И. И., самозанятый' },
        { name: 'sbp_qr', label: 'QR СБП: ссылка на картинку (или путь sbp-qr.png)', maxlength: 300, required: false, value: settings.sbp_qr || '', placeholder: 'sbp-qr.png' },
        { name: 'yookassa_fn', label: 'Имя платёжной функции (Edge Function)', maxlength: 60, required: false, value: settings.yookassa_fn || 'dsv-yookassa', placeholder: 'dsv-yookassa' },
        { name: 'note', label: 'Текст над лотами', type: 'textarea', maxlength: 400, value: settings.note || '', placeholder: 'Куда идут донаты и сколько ждать выдачи' }
      ],
      submitText: 'Сохранить',
      async onSubmit(v) {
        const rows = [
          { key: 'requisites', value: v.requisites },
          { key: 'note', value: v.note },
          { key: 'sbp_qr', value: v.sbp_qr || '' },
          { key: 'yookassa_fn', value: v.yookassa_fn || 'dsv-yookassa' }
        ];
        for (const row of rows) {
          const { error } = await sb.from(T_SETTINGS).upsert({ key: row.key, value: row.value });
          if (error) return 'Ошибка: ' + error.message;
        }
        await D.loadData();
        toast('Настройки сохранены');
        return null;
      }
    });
  };

  /* ---------- founder admin panel ---------- */
  D.renderAdmin = function () {
    const box = document.getElementById('donate-admin');
    if (!box) return;
    if (!loadedOnce) { box.innerHTML = ''; return; }

    if (!connected) {
      box.innerHTML =
        '<div class="panel"><h3>Донат</h3><p class="panel__sub">Таблицы не найдены. Выполни SQL-скрипт <code>dsv-donate.sql</code> в Supabase, и здесь появится управление лотами.</p></div>';
      return;
    }

    const all = rewards.slice().sort(function (a, b) { return (Number(a.sort) || 0) - (Number(b.sort) || 0); });
    const pending = orders.filter(function (o) { return o.status === 'new' || o.status === 'paid'; });
    const collected = orders.filter(function (o) { return o.status === 'issued'; }).reduce(function (s, o) { return s + (Number(o.price) || 0); }, 0);

    let html =
      '<div class="panel" style="margin-top:28px">' +
      '<h3>Донат: лоты</h3>' +
      '<p class="panel__sub">Собрано (выдано): <b>' + money(collected) + '</b> · ждут действий: <b>' + pending.length + '</b></p>' +
      '<div class="panel__row">' +
      '<button class="btn btn--small btn--primary" type="button" data-act="donate-reward-new">Создать лот</button>' +
      '<button class="btn btn--small btn--ghost" type="button" data-act="donate-settings">Приём платежей</button>' +
      '<button class="btn btn--small ' + (onlineOn() ? 'btn--danger' : 'btn--ghost') + '" type="button" data-act="donate-online-toggle">' + (onlineOn() ? 'Выключить ЮKassa' : 'Включить ЮKassa') + '</button>' +
      '</div>' +
      '<p class="panel__sub" style="margin-top:10px">Онлайн-оплата: <b>' + (onlineOn() ? 'включена (карты, СБП, SberPay, T-Pay, ЮMoney)' : 'выключена, платёж по реквизитам вручную') + '</b></p>';

    html += all.length
      ? '<div class="admin-list" style="margin-top:14px">' + all.map(adminRewardRow).join('') + '</div>'
      : '<p class="panel__sub" style="margin-top:14px">Лотов ещё нет.</p>';
    html += '</div>';

    html +=
      '<div class="panel" style="margin-top:18px">' +
      '<h3>Заявки на донат</h3>' +
      (orders.length
        ? '<div class="admin-list">' + orders.slice(0, 60).map(adminOrderRow).join('') + '</div>'
        : '<p class="panel__sub">Пока никто не оформлял заявку.</p>') +
      '</div>';

    box.innerHTML = html;
  };

  function adminRewardRow(r) {
    return (
      '<div class="admin-row dg-rew" style="--dg:' + esc(r.color || '#4cd137') + '">' +
      '<div class="member__info">' +
      '<span class="member__nick"><a class="nick-link" href="#/donate">' + esc(r.title) + '</a> · ' + money(r.price) + '</span>' +
      '<span class="admin-row__role">' + (r.active ? 'активен' : 'скрыт') + (r.badge ? ' · ' + esc(r.badge) : '') + '</span>' +
      '</div>' +
      '<div class="member__actions">' +
      '<button class="btn btn--small btn--ghost" type="button" data-act="donate-reward-edit" data-id="' + esc(r.id) + '">Править</button>' +
      '<button class="btn btn--small btn--ghost" type="button" data-act="donate-reward-toggle" data-id="' + esc(r.id) + '">' + (r.active ? 'Скрыть' : 'Показать') + '</button>' +
      '<button class="btn btn--small btn--danger" type="button" data-act="donate-reward-del" data-id="' + esc(r.id) + '">Удалить</button>' +
      '</div></div>'
    );
  }

  function adminOrderRow(o) {
    const next = STATUS_NEXT[o.status];
    return (
      '<div class="admin-row dg-ord">' +
      '<div class="member__info">' +
      '<span class="member__nick"><a class="nick-link" href="#/user/' + encodeURIComponent(o.buyer_nick || '') + '">' + esc(o.buyer_nick || '?') + '</a> · ' + esc(o.reward_title) + ' · ' + money(o.price) + '</span>' +
      '<span class="chip dg-status dg-status--' + esc(o.status) + '">' + (STATUS_LABEL[o.status] || esc(o.status)) + '</span>' +
      '<span class="admin-row__date">код ' + esc(shortCode(o.id)) + ' · ' + esc(formatDate(o.created_at)) + (o.contact ? ' · ' + esc(o.contact) : '') + '</span>' +
      (o.comment ? '<span class="muted">«' + esc(o.comment) + '»</span>' : '') +
      '</div>' +
      '<div class="member__actions">' +
      (next ? '<button class="btn btn--small btn--primary" type="button" data-act="donate-order-status" data-id="' + esc(o.id) + '" data-status="' + next + '">' + (next === 'paid' ? 'Оплата пришла' : 'Выдано игроку') + '</button>' : '') +
      (o.status !== 'canceled' && o.status !== 'issued' ? '<button class="btn btn--small btn--danger" type="button" data-act="donate-order-status" data-id="' + esc(o.id) + '" data-status="canceled">Отменить</button>' : '') +
      '<button class="btn btn--small btn--ghost" type="button" data-act="donate-copy-code" data-code="' + esc(shortCode(o.id)) + '">Код</button>' +
      '</div></div>'
    );
  }

  // self-boot: if the page opened directly on #/donate, paint as soon as DOM is ready
  function boot() {
    if (location.hash === '#/donate') {
      const box = document.getElementById('donate-detail');
      if (box && document.getElementById('view-donate') && !document.getElementById('view-donate').classList.contains('hidden') && !box.innerHTML) D.render();
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else setTimeout(boot, 0);

  D.stats = function () {
    return { rewards: rewards.length, orders: orders.length, connected: connected };
  };
})();
