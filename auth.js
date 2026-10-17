/* Nourish demo accounts and login.
   Everything is stored in THIS browser only (localStorage). Passwords are salted and hashed
   with PBKDF2, but this is still a demo: real login needs a server and a database.

   Usage (in <head>):
     <script src="auth.js" data-protect data-menu></script>   protected page with account menu
     <script src="auth.js" data-menu></script>                public page with Log in / account menu
     <script src="auth.js" data-guest></script>               login page (skips ahead if already logged in)
     <script src="auth.js"></script>                          helpers only                              */
(function () {
  "use strict";
  var AK = "nourish-account", SK = "nourish-session", RK = "nourish-restaurant";
  var N = window.Nourish = {}, me = document.currentScript, opt = me ? me.dataset : {};

  function rd(store, k) { try { return JSON.parse(store.getItem(k)); } catch (e) { return null; } }
  function wr(store, k, v) { try { store.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function b64(buf) { var s = ""; new Uint8Array(buf).forEach(function (b) { s += String.fromCharCode(b); }); return btoa(s); }
  function unb64(s) { var b = atob(s), u = new Uint8Array(b.length), i; for (i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }

  /* ---- accounts (several restaurants can live in this browser) ---- */
  var ACCS = "nourish-accounts", DK = "nourish-dash:";
  function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
  function accs() { var l = rd(localStorage, ACCS); return Array.isArray(l) ? l : []; }
  function syncRK(a) {
    // keeps the dashboard header (name and plan) in sync
    wr(localStorage, RK, { rname: a.restaurant.name, cuisine: a.restaurant.cuisine, tables: a.restaurant.tables, plan: a.plan.name, owner: a.owner.name, email: a.email });
  }
  // one-time move from the old single-account storage
  (function migrate() {
    var old = rd(localStorage, AK); if (!old) return;
    var l = accs(), ex = l.filter(function (x) { return x.email === old.email; })[0], id = ex ? ex.id : (old.id || uid());
    if (!ex) { old.id = id; l.push(old); wr(localStorage, ACCS, l); }
    try {
      var legacy = localStorage.getItem("nourish-dash");
      if (legacy && !localStorage.getItem(DK + id)) localStorage.setItem(DK + id, legacy);
      localStorage.removeItem("nourish-dash"); localStorage.removeItem(AK);
    } catch (e) {}
  })();

  var PUB = { list: [], data: {} }; // public restaurant directory (readable by anyone), filled by N.loadPublic
  N.hasAccounts = function () { return accs().length > 0 || PUB.list.length > 0; };
  N.accountFor = function (email) {
    email = String(email || "").trim().toLowerCase();
    return accs().filter(function (a) { return String(a.email).toLowerCase() === email; })[0] || null;
  };
  function sessRaw() {
    var s = rd(sessionStorage, SK) || rd(localStorage, SK);
    if (!s || (s.exp && s.exp < Date.now())) return null;
    return s;
  }
  /* the account of whoever is logged in right now */
  N.account = function () { var s = sessRaw(); return s ? N.accountFor(s.email) : null; };
  N.saveAccount = function (a) {
    var l = accs(), i = -1, k;
    if (!a.id && N.uid) a.id = N.uid;
    if (!a.id) { var ex = N.accountFor(a.email); a.id = ex ? ex.id : uid(); }
    for (k = 0; k < l.length; k++) if (l[k].id === a.id) i = k;
    if (i < 0) l.push(a); else l[i] = a;
    var ok = wr(localStorage, ACCS, l);
    syncRK(a);
    if (DB && N.uid && a.id === N.uid) {
      DB.from("accounts").upsert({ id: a.id, email: a.email, owner: a.owner, restaurant: a.restaurant, plan: a.plan, cards: a.cards, invoices: a.invoices, prefs: a.prefs })
        .then(function (r) { if (r.error) syncFail(r.error); });
    }
    return ok;
  };
  N.deleteAccount = function () {
    var a = N.account(); if (!a) return Promise.resolve();
    var p = DB ? DB.rpc("delete_me") : Promise.resolve({});
    return Promise.resolve(p).then(function (r) {
      if (r && r.error) throw r.error;
      N.logout();
      try {
        wr(localStorage, ACCS, accs().filter(function (x) { return x.id !== a.id; }));
        localStorage.removeItem(DK + a.id); localStorage.removeItem(RK); sessionStorage.removeItem("nourish-signup");
      } catch (e) {}
    }).catch(function (e) { alert("We couldn't delete the account right now. Please try again."); throw e; });
  };

  /* ---- each restaurant has its own menu data ---- */
  N.slug = function (n) { return String(n || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "restaurant"; };
  N.dashKey = function () { var a = N.account(); return DK + (a ? a.id : "none"); };
  N.dashData = function (id) {
    var l = rd(localStorage, DK + id); if (l) return l;
    if (PUB.data[id]) return PUB.data[id];
    var p = PUB.list.filter(function (x) { return x.id === id; })[0];
    return p ? { dishes: new Array(p.count || 0) } : null;
  };
  N.restName = function (a) { var d = N.dashData(a.id); return (d && d.restaurant && d.restaurant.name) || a.restaurant.name; };
  N.restaurants = function () {
    var seen = {}, ids = {}, out = [];
    PUB.list.forEach(function (p) { ids[p.id] = 1; seen[p.slug] = 1; out.push(p); });
    accs().forEach(function (a) {
      if (ids[a.id]) return;
      var name = N.restName(a), base = N.slug(name), s = base, n = 2;
      while (seen[s]) s = base + "-" + n++;
      seen[s] = 1;
      out.push({ id: a.id, name: name, slug: s, cuisine: a.restaurant.cuisine, city: a.restaurant.city, count: 0 });
    });
    return out;
  };
  N.restaurantBySlug = function (s) { return N.restaurants().filter(function (r) { return r.slug === s; })[0] || null; };
  N.mySlug = function () {
    var a = N.account(); if (!a) return "";
    try { var st = localStorage.getItem("nourish-slug:" + a.id); if (st) return st; } catch (e) {}
    var m = N.restaurants().filter(function (r) { return r.id === a.id; })[0]; return m ? m.slug : "";
  };

  /* ---- session ---- */
  N.session = function () { var s = sessRaw(); return s && N.accountFor(s.email) ? s : null; };
  function clearSess() { try { sessionStorage.removeItem(SK); localStorage.removeItem(SK); } catch (e) {} }
  N.logout = function () {
    clearSess();
    try { if (DB) DB.auth.signOut({ scope: "local" }); } catch (e) {}
    try { Object.keys(localStorage).forEach(function (k) { if (/^sb-.*-auth-token/.test(k)) localStorage.removeItem(k); }); } catch (e) {}
  };
  N.login = function (email, remember) {
    clearSess();
    wr(remember ? localStorage : sessionStorage, SK, { email: email, exp: remember ? Date.now() + 30 * 864e5 : 0 });
    var a = N.accountFor(email); if (a) syncRK(a);
  };
  N.relogin = function (email) { N.login(email, !!rd(localStorage, SK)); };

  /* ---- passwords ---- */
  N.newSalt = function () { return b64(crypto.getRandomValues(new Uint8Array(16))); };
  N.hash = function (pw, salt) {
    if (!window.crypto || !crypto.subtle) return Promise.reject(new Error("no-subtle"));
    return crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"])
      .then(function (k) {
        return crypto.subtle.deriveBits({ name: "PBKDF2", salt: unb64(salt), iterations: 150000, hash: "SHA-256" }, k, 256);
      }).then(b64);
  };
  N.verify = function (pw, rec) { return N.hash(pw, rec.salt).then(function (h) { return h === rec.hash; }); };

  /* ---- small helpers ---- */
  N.initials = function (n) {
    var p = String(n || "").trim().split(/\s+/).filter(Boolean);
    return ((p[0] || "?")[0] + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
  };
  N.luhn = function (s) {
    var sum = 0, alt = false, i, n;
    for (i = s.length - 1; i >= 0; i--) { n = +s[i]; if (alt) { n *= 2; if (n > 9) n -= 9; } sum += n; alt = !alt; }
    return sum % 10 === 0;
  };
  N.brand = function (d) {
    if (/^4/.test(d)) return "Visa";
    if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(d)) return "Mastercard";
    if (/^3[47]/.test(d)) return "American Express";
    return "Card";
  };

  /* ---- Supabase sync: the database is the source of truth, localStorage above is a fast cache ---- */
  var DB = window.nourishDB, warned = false, pend = null, dtimer = null, dashLoaded = false;
  function syncFail(e) {
    try { console.warn("Nourish sync:", e); } catch (x) {}
    if (!warned) { warned = true; alert("We couldn't save to the cloud just now. Your changes are kept on this device and we'll retry. Please don't clear your browser data yet."); }
  }
  // Loads the logged-in owner's account and dashboard data from Supabase into the cache. Resolves true if an account exists.
  N.refresh = function () {
    if (!DB) return Promise.resolve(!!N.session());
    return DB.auth.getSession().then(function (r) {
      var se = r.data && r.data.session;
      if (!se) { clearSess(); N.uid = null; return false; }
      N.uid = se.user.id;
      return Promise.all([
        DB.from("accounts").select("*").eq("id", N.uid).maybeSingle(),
        DB.from("dash").select("data").eq("account_id", N.uid).maybeSingle(),
        DB.from("public_menus").select("slug").eq("account_id", N.uid).maybeSingle()
      ]).then(function (x) {
        if (x[0].error) throw x[0].error;
        var a = x[0].data; if (!a) return false;
        var l = accs().filter(function (y) { return y.id !== a.id; });
        l.push({ id: a.id, email: a.email, owner: a.owner, restaurant: a.restaurant, plan: a.plan, cards: a.cards, invoices: a.invoices, prefs: a.prefs });
        wr(localStorage, ACCS, l);
        var d = x[1].data, dirtyKey = "nourish-dirty:" + a.id, dirty = false;
        try { dirty = !!localStorage.getItem(dirtyKey); } catch (e) {}
        dashLoaded = !x[1].error;
        var loc = rd(localStorage, DK + a.id);
        if (dirty && loc) { pend = loc; }   // local changes that never reached the cloud win: never overwrite them
        else if (d && d.data && Object.keys(d.data).length) wr(localStorage, DK + a.id, d.data);
        if (x[2] && x[2].data && x[2].data.slug) { try { localStorage.setItem("nourish-slug:" + a.id, x[2].data.slug); } catch (e) {} }
        N.login(a.email, true);
        if (pend) sendDash();
        return true;
      });
    }).catch(function () { return !!N.session(); });
  };
  N.ready = N.refresh();
  function sendDash() {
    if (!pend || !DB || !N.uid || !dashLoaded) return;   // never write before we have seen the cloud copy
    var d = pend, me = N.uid; pend = null;
    Promise.resolve(DB.from("dash").upsert({ account_id: me, data: d, updated_at: new Date().toISOString() })).then(function (r) {
      if (r.error) {   // keep the changes marked as unsynced and try again shortly
        if (!pend) pend = d;
        syncFail(r.error); clearTimeout(dtimer); dtimer = setTimeout(sendDash, 10000); return;
      }
      try { localStorage.removeItem("nourish-dirty:" + me); } catch (e) {}
      publishMenu(d);
    }).catch(function (e) { if (!pend) pend = d; syncFail(e); clearTimeout(dtimer); dtimer = setTimeout(sendDash, 10000); });
  }
  // The public copy of the menu: only what diners need (no sales, stock or recipes).
  function publishMenu(d) {
    var a = N.account(); if (!DB || !N.uid || !a || !d) return;
    var ing = {}; (d.ingredients || []).forEach(function (i) { ing[i.id] = i; });
    var keep = ["id", "name", "desc", "price", "kcal", "p", "c", "f", "cat", "prep", "serves", "photo", "diet", "allergens", "opts", "available"];
    var dishes = (d.dishes || []).map(function (x) {
      var c = {}; keep.forEach(function (k) { if (x[k] !== undefined) c[k] = x[k]; });
      var short = (d.ingredients || []).length && (x.ing || []).some(function (r) { var i = ing[r.id]; return i && (i.qty <= 0 || i.qty < r.qty); });
      if (short) c.available = false;
      return c;
    });
    var pub = { restaurant: { name: (d.restaurant && d.restaurant.name) || a.restaurant.name, currency: (d.restaurant && d.restaurant.currency) || "MAD" },
      categories: d.categories || [], dishes: dishes, tables: d.tables || [],
      servers: (d.staff || []).filter(function (m) { return m.active !== false && m.position === "Server" && m.name; }).map(function (m) { return String(m.name).slice(0, 40); }) };
    var stored = null; try { stored = localStorage.getItem("nourish-slug:" + a.id); } catch (e) {}
    var base = N.slug(pub.restaurant.name); if (base === "demo") base = "demo-restaurant";
    function put(slug, retry) {
      return DB.from("public_menus").upsert({ account_id: N.uid, slug: slug, name: pub.restaurant.name, cuisine: a.restaurant.cuisine || "", city: a.restaurant.city || "",
        dish_count: dishes.length, data: pub, updated_at: new Date().toISOString() }).then(function (r) {
        if (r.error && r.error.code === "23505" && retry) return put(base + "-" + N.uid.slice(0, 4), false);
        if (r.error) { syncFail(r.error); return; }
        try { localStorage.setItem("nourish-slug:" + a.id, slug); } catch (e) {}
      });
    }
    put(stored || base, !stored);
  }
  N.saveDash = function (data, now) {
    if (!DB || !N.uid) return;
    try { localStorage.setItem("nourish-dirty:" + N.uid, "1"); } catch (e) {}   // cleared only after the cloud confirms
    pend = data; clearTimeout(dtimer);
    if (now) sendDash(); else dtimer = setTimeout(sendDash, 800);
  };
  window.addEventListener("pagehide", sendDash);
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") sendDash(); });
  N.reauth = function (pw) {
    var a = N.account(); if (!DB || !a) return Promise.resolve(false);
    return DB.auth.signInWithPassword({ email: a.email, password: pw }).then(function (r) { return !r.error; });
  };
  if (DB) DB.auth.onAuthStateChange(function (ev) { if (ev === "SIGNED_OUT") clearSess(); });

  /* ---- public menus, diner orders and tables (Supabase) ---- */
  N.cloud = !!DB;
  var wrapRpc = function (p) { return Promise.resolve(p).then(function (r) { if (r.error) throw r.error; return r.data; }); };
  // Anyone can read the list of restaurants and one restaurant's menu.
  N.loadPublic = function (slug) {
    if (!DB) return Promise.resolve();
    var p1 = Promise.resolve(DB.from("public_menus").select("account_id,slug,name,cuisine,city,dish_count").order("name")).then(function (r) {
      if (!r.error && r.data) PUB.list = r.data.map(function (x) { return { id: x.account_id, slug: x.slug, name: x.name, cuisine: x.cuisine, city: x.city, count: x.dish_count }; });
    });
    var p2 = (slug && slug !== "demo") ? Promise.resolve(DB.from("public_menus").select("account_id,data").eq("slug", slug).maybeSingle()).then(function (r) {
      if (r.error || !r.data) return;
      PUB.data[r.data.account_id] = r.data.data;
      return N.pullOcc(r.data.account_id);
    }) : Promise.resolve();
    return Promise.all([p1, p2]).catch(function () {});
  };
  // diner side: place an order (also claims the table), follow it, finish and rate it
  N.placeOrder = function (rid, token, order) { return wrapRpc(DB.rpc("place_order", { p_rid: rid, p_token: token, p_data: order })); };
  N.getOrder = function (id, token) { return wrapRpc(DB.rpc("get_order", { p_id: id, p_token: token })); };
  N.finishOrder = function (id, token, rating, comment) { return wrapRpc(DB.rpc("finish_order", { p_id: id, p_token: token, p_rating: rating || null, p_comment: comment || "" })); };
  N.pullOcc = function (rid) {
    return wrapRpc(DB.rpc("get_occupancy", { p_rid: rid })).then(function (d) { wr(localStorage, "nourish-occ:" + rid, d || {}); }).catch(function () {});
  };
  // owner side: load this restaurant's orders, ratings and taken tables into the cache
  N.pullOrders = function () {
    if (!DB || !N.uid) return Promise.resolve({});
    var me = N.uid, since = new Date(Date.now() - 3 * 864e5).toISOString();
    return Promise.all([
      DB.from("orders").select("*").eq("rid", me).gte("created_at", since).order("id"),
      DB.from("orders").select("id,rating,comment,finished_at,data").eq("rid", me).not("rating", "is", null).order("id", { ascending: false }).limit(300),
      DB.from("occupancy").select("table_no,token").eq("rid", me)
    ]).then(function (x) {
      if (x[0].error) throw x[0].error;
      var slug = N.mySlug(), changed = {};
      var mine = x[0].data.map(function (r) {
        var o = {}, k; for (k in r.data) o[k] = r.data[k];
        o.id = r.id; o.rid = r.rid; o.status = r.status; o.done = r.done; o.rating = r.rating; o.comment = r.comment;
        if (!o.r) o.r = slug;
        return o;
      });
      var all = rd(localStorage, "nourish-orders") || [];
      if (JSON.stringify(all.filter(function (o) { return o.rid === me; })) !== JSON.stringify(mine)) {
        changed.orders = true;
        wr(localStorage, "nourish-orders", all.filter(function (o) { return o.rid !== me; }).concat(mine));
      }
      if (!x[1].error) {
        var rs = (rd(localStorage, "nourish-ratings") || []).filter(function (r) { return r.rid !== me; }), mineR = [];
        x[1].data.forEach(function (r) { mineR.push({ id: r.id, r: slug, rid: me, table: r.data && r.data.table, stars: r.rating, comment: r.comment || "", at: r.finished_at ? Date.parse(r.finished_at) : Date.now() }); });
        var oldR = (rd(localStorage, "nourish-ratings") || []).filter(function (r) { return r.rid === me; });
        if (JSON.stringify(oldR) !== JSON.stringify(mineR)) { changed.orders = true; wr(localStorage, "nourish-ratings", rs.concat(mineR)); }
      }
      if (!x[2].error) {
        var oc = {}; x[2].data.forEach(function (r) { oc[r.table_no] = r.token; });
        var key = "nourish-occ:" + me;
        if (JSON.stringify(rd(localStorage, key) || {}) !== JSON.stringify(oc)) { changed.occ = true; wr(localStorage, key, oc); }
      }
      return changed;
    }).catch(function () { return {}; });
  };
  N.pushOrder = function (o) {
    if (!DB || !N.uid) return;
    var skip = { id: 1, rid: 1, status: 1, done: 1, rating: 1, comment: 1 }, d = {}, k;
    for (k in o) if (!skip[k]) d[k] = o[k];
    Promise.resolve(DB.from("orders").update({ status: o.status, data: d }).eq("id", o.id).eq("rid", N.uid)).then(function (r) { if (r.error) syncFail(r.error); });
  };
  N.freeTable = function (n) {
    if (!DB || !N.uid) return;
    Promise.resolve(DB.from("occupancy").delete().eq("rid", N.uid).eq("table_no", String(n))).then(function (r) { if (r.error) syncFail(r.error); });
  };

  /* ---- page guards ---- */
  if (opt.protect !== undefined && !N.session()) {
    document.documentElement.style.visibility = "hidden";
    location.replace("login.html");
    return;
  }
  if (opt.protect !== undefined) N.ready.then(function () { if (!N.session()) { document.documentElement.style.visibility = "hidden"; location.replace("login.html"); } });
  if (opt.guest !== undefined) N.ready.then(function () { if (N.session()) location.replace("dashboard.html"); });
  N.ready.then(function () { if (document.readyState !== "loading" && N.mount) N.mount(); });

  /* ---- account menu / login link ---- */
  function css() {
    if (document.getElementById("nourish-auth-css")) return;
    var st = document.createElement("style");
    st.id = "nourish-auth-css";
    st.textContent =
      ".acct{position:relative;margin-left:8px}" +
      ".acct-btn{width:40px;height:40px;border-radius:50%;border:2px solid var(--line);background:var(--leaf-t);color:var(--leaf);font:700 15px Figtree,system-ui,sans-serif;cursor:pointer;padding:0;overflow:hidden;display:grid;place-items:center}" +
      ".acct-btn img{width:100%;height:100%;object-fit:cover;display:block}" +
      ".acct-menu{position:absolute;right:0;top:48px;min-width:240px;background:var(--card);border:1px solid var(--line);border-radius:14px;box-shadow:0 14px 34px rgba(0,0,0,.18);padding:6px;z-index:60}" +
      ".acct-menu[hidden]{display:none}" +
      ".acct-who{padding:10px 12px;border-bottom:1px solid var(--line);margin-bottom:4px;display:grid;gap:2px}" +
      ".acct-who strong{color:var(--ink)}" +
      ".acct-who .acct-store{color:var(--leaf);font-weight:700;font-size:14px}" +
      ".acct-who span{color:var(--mute);font-size:13px;word-break:break-all}" +
      ".acct-menu a,.acct-menu button{display:block;width:100%;text-align:left;padding:10px 12px;border:0;background:none;border-radius:8px;color:var(--ink);font:inherit;text-decoration:none;cursor:pointer}" +
      ".acct-menu a:hover,.acct-menu button:hover,.acct-menu a:focus-visible,.acct-menu button:focus-visible{background:var(--leaf-t)}" +
      "@media (max-width:560px){header nav a[href='signup.html']{display:none}}";
    document.head.appendChild(st);
  }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  N.mount = function () {
    if (opt.menu === undefined) return;
    css();
    var old = document.querySelector(".acct"); if (old) old.remove();
    var a = N.session() && N.account(), nav = document.querySelector("header nav"), link = document.querySelector("[data-auth-link]");

    if (!a) {
      if (nav && !link) {
        link = el("a", "btn ghost", "Log in"); link.href = "login.html"; link.setAttribute("data-auth-link", "");
        nav.insertBefore(link, nav.querySelector("a.btn"));
      }
      return;
    }
    if (link) link.hidden = true;
    var wrap = document.querySelector("header .wrap"); if (!wrap) return;

    var box = el("div", "acct"), btn = el("button", "acct-btn");
    btn.type = "button"; btn.setAttribute("aria-haspopup", "menu"); btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-label", "Account menu for " + a.owner.name);
    if (a.owner.photo) { var img = new Image(); img.src = a.owner.photo; img.alt = ""; btn.appendChild(img); }
    else btn.textContent = N.initials(a.owner.name);

    var menu = el("div", "acct-menu"); menu.setAttribute("role", "menu"); menu.hidden = true;
    var who = el("div", "acct-who"); who.appendChild(el("strong", "", a.owner.name)); who.appendChild(el("span", "acct-store", "Restaurant: " + N.restName(a))); who.appendChild(el("span", "", a.email)); menu.appendChild(who);
    [["Dashboard", "dashboard.html"], ["Manage account", "account.html"]].forEach(function (i) {
      var l = el("a", "", i[0]); l.href = i[1]; l.setAttribute("role", "menuitem"); menu.appendChild(l);
    });
    var out = el("button", "", "Log out"); out.type = "button"; out.setAttribute("role", "menuitem");
    out.addEventListener("click", function () { N.logout(); location.href = "index.html"; });
    menu.appendChild(out);

    function close() { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); }
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var open = menu.hidden; menu.hidden = !open; btn.setAttribute("aria-expanded", String(open));
      if (open) menu.querySelector("a").focus();
    });
    document.addEventListener("click", function (e) { if (!box.contains(e.target)) close(); });
    box.addEventListener("keydown", function (e) { if (e.key === "Escape") { close(); btn.focus(); } });
    box.appendChild(btn); box.appendChild(menu); wrap.appendChild(box);
  };
  document.addEventListener("DOMContentLoaded", N.mount);
})();