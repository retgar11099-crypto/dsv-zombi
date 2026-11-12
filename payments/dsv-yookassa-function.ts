// Supabase Edge Function: dsv-yookassa
// Создаёт счёт в ЮKassa для заявки на донат и обрабатывает уведомления о платежах.
//
// Секреты (Supabase Dashboard → Project → Settings → Edge Functions → Secrets):
//   YOOKASSA_SHOP_ID    — ID магазина из личного кабинета ЮKassa
//   YOOKASSA_SECRET_KEY — секретный ключ (тестовый или боевой)
//   SUPABASE_URL        — уже есть по умолчанию (можно не задавать)
//   SERVICE_ROLE_KEY    — сервисный ключ Supabase (ТОЛЬКО на сервере!)
//   SITE_URL            — https://protocold7.ru/dsv-zombi  (куда возвращать игрока)
//
// Деплой: supabase functions deploy dsv-yookassa --no-verify-jwt
// или через веб-редактор Edge Functions с включённым «Verify JWT: off»
// (вызов идёт с anon-ключом из браузера, защита строится на проверке заказа и подписи ЮKassa).

const SHOP_ID = Deno.env.get("YOOKASSA_SHOP_ID") || "";
const SECRET = Deno.env.get("YOOKASSA_SECRET_KEY") || "";
const SITE_URL = (Deno.env.get("SITE_URL") || "https://protocold7.ru/dsv-zombi").replace(/\/$/, "");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("VITE_SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const API = "https://yookassa.ru/v3";
const ORDERS_TABLE = "dsv_donate_orders";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, idempotence-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

function authHeader() {
  return "Basic " + btoa(`${SHOP_ID}:${SECRET}`);
}

function db() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("SUPABASE_URL / SERVICE_ROLE_KEY не настроены");
  return {
    url: `${SUPABASE_URL}/rest/v1/${ORDERS_TABLE}`,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    }
  };
}

// ------- md5 для подписи уведомлений ЮKassa -------
function md5(input: string): string {
  // упрощённая реализация MD5 (без внешних зависимостей)
  const rotateLeft = (lValue: number, iShiftBits: number) => (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits));
  const addUnsigned = (lX: number, lY: number) => {
    const lX4 = lX & 0x40000000, lY4 = lY & 0x40000000;
    const lX8 = lX & 0x80000000, lY8 = lY & 0x80000000;
    const lResult = (lX & 0x3fffffff) + (lY & 0x3fffffff);
    if (lX4 & lY4) return lResult ^ 0x80000000 ^ lX8 ^ lY8;
    if (lX4 | lY4) return (lResult & 0x40000000) ? lResult ^ 0xc0000000 ^ lX8 ^ lY8 : lResult ^ 0x40000000 ^ lX8 ^ lY8;
    return lResult ^ lX8 ^ lY8;
  };
  const F = (x: number, y: number, z: number) => (x & y) | (~x & z);
  const G = (x: number, y: number, z: number) => (x & z) | (y & ~z);
  const H = (x: number, y: number, z: number) => x ^ y ^ z;
  const I = (x: number, y: number, z: number) => y ^ (x | ~z);
  const FF = (a: number, b: number, c: number, d: number, x: number, s: number, ac: number) => {
    a = addUnsigned(a, addUnsigned(addUnsigned(F(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  };
  const GG = (a: number, b: number, c: number, d: number, x: number, s: number, ac: number) => {
    a = addUnsigned(a, addUnsigned(addUnsigned(G(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  };
  const HH = (a: number, b: number, c: number, d: number, x: number, s: number, ac: number) => {
    a = addUnsigned(a, addUnsigned(addUnsigned(H(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  };
  const II = (a: number, b: number, c: number, d: number, x: number, s: number, ac: number) => {
    a = addUnsigned(a, addUnsigned(addUnsigned(I(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  };
  const convertToWordArray = (str: string) => {
    const lWordCount = ((str.length - ((str.length + 8) % 64)) / 64) * 16 + 16;
    const lWords: number[] = new Array(lWordCount - 1);
    let byteCount = 0, cw = 0;
    for (let i = 0; i < str.length; i++) {
      const wordOffset = i & 3;
      if (wordOffset === 0) cw = i + 16;
      byteCount |= str.charCodeAt(i) << (wordOffset * 8);
      if (wordOffset === 3) {
        lWords[cw - i - 1] = byteCount;
        byteCount = 0;
      }
    }
    const rest = (((str.length - ((str.length + 8) % 64)) / 64) * 16 + 8) - str.length - 1;
    if (byteCount || rest < 4) {
      const wordOffset = (str.length & 3) * 8;
      byteCount |= 0x80 << wordOffset;
      if ((str.length & 3) === 3) lWords[lWordCount - 1 - (str.length - (str.length & ~3))] = byteCount;
      else lWords.push(byteCount);
    }
    while (lWords.length < lWordCount - 1) lWords.push(0);
    lWords[lWordCount - 1] = str.length * 8;
    return lWords;
  };
  const S11 = 7, S12 = 12, S13 = 17, S14 = 22, S21 = 5, S22 = 9, S23 = 14, S24 = 20;
  const S31 = 4, S32 = 11, S33 = 16, S34 = 23, S41 = 6, S42 = 10, S43 = 15, S44 = 21;
  const x = convertToWordArray(input);
  let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476;
  for (let k = 0; k < x.length; k += 16) {
    const AA = a, BB = b, CC = c, DD = d;
    a = FF(a, b, c, d, x[k], S11, 0xd76aa478); d = FF(d, a, b, c, x[k + 1], S12, 0xe8c7b756);
    c = FF(c, d, a, b, x[k + 2], S13, 0x242070db); b = FF(b, c, d, a, x[k + 3], S14, 0xc1bdceee);
    a = FF(a, b, c, d, x[k + 4], S11, 0xf57c0faf); d = FF(d, a, b, c, x[k + 5], S12, 0x4787c62a);
    c = FF(c, d, a, b, x[k + 6], S13, 0xa8304613); b = FF(b, c, d, a, x[k + 7], S14, 0xfd469501);
    a = FF(a, b, c, d, x[k + 8], S11, 0x698098d8); d = FF(d, a, b, c, x[k + 9], S12, 0x8b44f7af);
    c = FF(c, d, a, b, x[k + 10], S13, 0xffff5bb1); b = FF(b, c, d, a, x[k + 11], S14, 0x895cd7be);
    a = FF(a, b, c, d, x[k + 12], S11, 0x6b901122); d = FF(d, a, b, c, x[k + 13], S12, 0xfd987193);
    c = FF(c, d, a, b, x[k + 14], S13, 0xa679438e); b = FF(b, c, d, a, x[k + 15], S14, 0x49b40821);
    a = GG(a, b, c, d, x[k + 1], S21, 0xf61e2562); d = GG(d, a, b, c, x[k + 6], S22, 0xc040b340);
    c = GG(c, d, a, b, x[k + 11], S23, 0x265e5a51); b = GG(b, c, d, a, x[k], S24, 0xe9b6c7aa);
    a = GG(a, b, c, d, x[k + 5], S21, 0xd62f105d); d = GG(d, a, b, c, x[k + 10], S22, 0x2441453);
    c = GG(c, d, a, b, x[k + 15], S23, 0xd8a1e681); b = GG(b, c, d, a, x[k + 4], S24, 0xe7d3fbc8);
    a = GG(a, b, c, d, x[k + 9], S21, 0x21e1cde6); d = GG(d, a, b, c, x[k + 14], S22, 0xc33707d6);
    c = GG(c, d, a, b, x[k + 3], S23, 0xf4d50d87); b = GG(b, c, d, a, x[k + 8], S24, 0x455a14ed);
    a = GG(a, b, c, d, x[k + 13], S21, 0xa9e3e905); d = GG(d, a, b, c, x[k + 2], S22, 0xfcefa3f8);
    c = GG(c, d, a, b, x[k + 7], S23, 0x676f02d9); b = GG(b, c, d, a, x[k + 12], S24, 0x8d2a4c8a);
    a = HH(a, b, c, d, x[k + 5], S31, 0xfffa3942); d = HH(d, a, b, c, x[k + 8], S32, 0x8771f681);
    c = HH(c, d, a, b, x[k + 11], S33, 0x6d9d6122); b = HH(b, c, d, a, x[k + 14], S34, 0xfde5380c);
    a = HH(a, b, c, d, x[k + 1], S31, 0xa4beea44); d = HH(d, a, b, c, x[k + 4], S32, 0x4bdecfa9);
    c = HH(c, d, a, b, x[k + 7], S33, 0xf6bb4b60); b = HH(b, c, d, a, x[k + 10], S34, 0xbebfbc70);
    a = HH(a, b, c, d, x[k + 13], S31, 0x289b7ec6); d = HH(d, a, b, c, x[k], S32, 0xeaa127fa);
    c = HH(c, d, a, b, x[k + 3], S33, 0xd4ef3085); b = HH(b, c, d, a, x[k + 6], S34, 0x4881d05);
    a = HH(a, b, c, d, x[k + 9], S31, 0xd9d4d039); d = HH(d, a, b, c, x[k + 12], S32, 0xe6db99e5);
    c = HH(c, d, a, b, x[k + 15], S33, 0x1fa27cf8); b = HH(b, c, d, a, x[k + 2], S34, 0xc4ac5665);
    a = II(a, b, c, d, x[k], S41, 0xf4292244); d = II(d, a, b, c, x[k + 7], S42, 0x432aff97);
    c = II(c, d, a, b, x[k + 14], S43, 0xab9423a7); b = II(b, c, d, a, x[k + 5], S44, 0xfc93a039);
    a = II(a, b, c, d, x[k + 12], S41, 0x650b23c6); d = II(d, a, b, c, x[k + 3], S42, 0x7f328212);
    c = II(c, d, a, b, x[k + 10], S43, 0x4c0be1b7); b = II(b, c, d, a, x[k + 1], S44, 0x21a5c159);
    a = II(a, b, c, d, x[k + 8], S41, 0xbdd1b2b4); d = II(d, a, b, c, x[k + 15], S42, 0xa5beefea);
    c = II(c, d, a, b, x[k + 6], S43, 0x4deef87c); b = II(b, c, d, a, x[k + 13], S44, 0xf576e2b8);
    a = II(a, b, c, d, x[k + 4], S41, 0x2ad0e2f0); d = II(d, a, b, c, x[k + 11], S42, 0x9e1d144a);
    c = II(c, d, a, b, x[k + 2], S43, 0x2e4b2d33); b = II(b, c, d, a, x[k + 9], S44, 0x9d5c4d73);
    a = addUnsigned(a, AA); b = addUnsigned(b, BB); c = addUnsigned(c, CC); d = addUnsigned(d, DD);
  }
  const toHex = (n: number) => {
    let s = "";
    for (let i = 0; i < 4; i++) s += ("0" + ((n >> (i * 8)) & 0xff).toString(16)).slice(-2);
    return s;
  };
  return (toHex(a) + toHex(b) + toHex(c) + toHex(d)).toLowerCase();
}

async function createPayment(order: Record<string, unknown>) {
  const amount = Number(order.price) || 0;
  if (amount < 1) throw new Error("Некорректная сумма");
  const code = String(order.id).replace(/-/g, "").slice(0, 8).toUpperCase();
  const body = {
    amount: { value: amount.toFixed(2), currency: "RUB" },
    capture: true,
    confirmation: { type: "redirect", return_url: `${SITE_URL}/#/donate` },
    description: `DSV-Zombi: ${String(order.reward_title || "донат")} (заявка ${code})`,
    metadata: { order_id: String(order.id), buyer_nick: String(order.buyer_nick || "") }
    // Чек по НПД формируешь сам в «Мой налог»: ЮKassa за самозанятого его не отправляет.
  };
  const res = await fetch(`${API}/payments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader(),
      "Idempotence-Key": `dsv-${String(order.id)}`
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`ЮKassa ${res.status}: ${await res.text()}`);
  return await res.json();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let payload: Record<string, unknown> = {};
  const raw = await req.text();
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = {}; }

  // ---------- уведомление от ЮKassa ----------
  const isNotification = !!payload.object || !!payload.event;
  if (isNotification && payload.object) {
    const signature = req.headers.get("Authorization")?.replace(/^Basic /, "") || "";
    const expected = btoa(md5(`${SECRET}${raw}${SECRET}`));
    if (signature && signature !== expected) return json({ error: "bad signature" }, 400);

    const payment = payload.object as Record<string, unknown>;
    const meta = (payment.metadata || {}) as Record<string, string>;
    const orderId = meta.order_id;
    const event = String(payload.event || "");
    if (!orderId) return json({ ok: true, ignored: "no order id" });

    let status: string | null = null;
    if (event === "payment.succeeded" || payment.status === "succeeded") status = "paid";
    else if (event === "payment.canceled" || payment.status === "canceled") status = "canceled";
    if (!status) return json({ ok: true, ignored: event });

    const d = db();
    const res = await fetch(`${d.url}?id=eq.${orderId}`, {
      method: "PATCH",
      headers: d.headers,
      body: JSON.stringify({
        status,
        updated_at: new Date().toISOString(),
        paid_at: status === "paid" ? new Date().toISOString() : null,
        payment_id: String(payment.id || "")
      })
    });
    return json({ ok: res.ok, status }, res.ok ? 200 : 500);
  }

  // ---------- запрос с сайта: создать платёж ----------
  const orderId = String((payload as Record<string, unknown>).order_id || "");
  if (!orderId || !SHOP_ID || !SECRET) return json({ error: "не настроен ЮKassa" }, 400);

  const d = db();
  const found = await fetch(`${d.url}?id=eq.${orderId}&select=*`, { headers: d.headers });
  const rows = await found.json();
  if (!Array.isArray(rows) || !rows.length) return json({ error: "заявка не найдена" }, 404);
  const order = rows[0];
  if (order.status !== "new") return json({ error: "заявка уже не ожидает оплаты" }, 409);

  try {
    const payment = await createPayment(order);
    const confirmUrl = (payment.confirmation && (payment.confirmation as Record<string, string>).confirmation_url) || null;
    await fetch(`${d.url}?id=eq.${orderId}`, {
      method: "PATCH",
      headers: d.headers,
      body: JSON.stringify({ payment_id: String(payment.id), payment_url: confirmUrl })
    });
    return json({ ok: true, payment_url: confirmUrl, payment_id: payment.id });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 502);
  }
});
