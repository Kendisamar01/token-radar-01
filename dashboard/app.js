(function () {
  "use strict";
  var D = window.RADAR;
  if (!D) return;
  var app = document.getElementById("app");
  var state = { q: "", category: "all", tab: "pre", sort: "implied", dir: -1, slug: null };
  function usd(n) {
    if (n == null || !isFinite(n)) return "n/a";
    if (Math.abs(n) >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
    if (Math.abs(n) >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
    if (Math.abs(n) >= 1e3) return "$" + Math.round(n / 1e3) + "K";
    return "$" + Math.round(n).toLocaleString("en-US");
  }
  function pct(n) { return n == null ? "n/a" : (n > 0 ? "+" : "") + n.toFixed(2) + "%"; }
  function age(n) { return n == null ? "unknown" : n >= 365 ? (n / 365).toFixed(1) + "y" : n + "d"; }
  function el(tag, attrs) {
    var n = document.createElement(tag), i;
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      if (k === "text") n.textContent = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else if (k === "class") n.className = attrs[k];
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    });
    for (i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) n.appendChild(x); });
      else if (typeof c === "string") n.appendChild(document.createTextNode(c));
      else n.appendChild(c);
    }
    return n;
  }
  function chain(p) { return p.chains && p.chains[0] ? p.chains[0] : "its main chain"; }
  function capital(p) { return p.tvl_usd >= 5e9 ? 250 : p.tvl_usd >= 1e9 ? 150 : p.tvl_usd >= 1e8 ? 100 : 50; }
  function action(p) {
    var c = (p.category || "").toLowerCase(), a = capital(p), ch = chain(p);
    if (c.includes("lend") || c.includes("cdp")) return "Supply $" + a + " of USDC to " + p.name + " on " + ch + " and keep the position open";
    if (c.includes("dex") || c.includes("yield")) return "Provide $" + a + " of liquidity in " + p.name + "'s main pool on " + ch + " and retain LP receipts";
    if (c.includes("bridge")) return "Bridge $" + a + " of USDC to " + ch + " through " + p.name + " and use it once";
    if (c.includes("staking") || c.includes("restak")) return "Stake $" + a + " of a native asset through " + p.name + " and retain the liquid receipt";
    if (c.includes("perpetual") || c.includes("derivative")) return "Deposit $" + a + " of USDC as margin on " + p.name + " and open one small hedge";
    if (c.includes("rwa")) return "Mint $" + a + " of " + p.name + "'s yield asset on " + ch + " and hold the receipt";
    if (c.includes("prediction")) return "Fund $" + a + " and place one small market position on " + p.name;
    return "Deposit $" + a + " of USDC into " + p.name + " on " + ch + " and keep the position open";
  }
  function steps(p) {
    var c = capital(p), hold = p.age_days == null ? 30 : p.age_days < 180 ? 60 : p.age_days < 365 ? 45 : 30;
    return [
      "Use a fresh wallet holding only the farm funds and keep the seed phrase offline. Cost: under $3 of network gas. Time: 5 minutes.",
      action(p) + ". Cost: $" + c + " of capital and about $" + (c >= 150 ? 8 : 4) + " of gas. Time: 15 minutes.",
      "Repeat one qualifying deposit, borrow, swap or vote in each weekly snapshot. Cost: about $2 of gas per week. Time: 10 minutes per week.",
      "Hold the position for at least " + hold + " days and verify its receipt after every snapshot. Cost: $" + c + " remains committed. Time: " + hold + " days.",
      "Open " + p.name + "'s official points or rewards page and verify the destination before a claim. Cost: no fee to check; never pay to claim. Time: 10 minutes.",
      "Record the wallet, chain, transaction hash, dates and points in a local farm log. Cost: no capital beyond the transaction. Time: 5 minutes."
    ];
  }
  function filtered() {
    var q = state.q.trim().toLowerCase();
    return D.rows.filter(function (r) {
      if (state.category !== "all" && r.category !== state.category) return false;
      if (!q) return true;
      return (r.name + " " + r.slug + " " + (r.category || "") + " " + (r.chains || []).join(" ")).toLowerCase().includes(q);
    });
  }
  function sorted(list) {
    var k = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (k === "name") { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (k === "tvl") { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (k === "growth") { av = a.change_7d == null ? -Infinity : a.change_7d; bv = b.change_7d == null ? -Infinity : b.change_7d; }
      else if (k === "age") { av = a.age_days == null ? Infinity : a.age_days; bv = b.age_days == null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }
  function header() {
    return el("header", { "class": "top" },
      el("div", { "class": "brand" }, el("span", { "class": "beacon" }), el("span", { text: "LAUNCH SIGNAL" })),
      el("div", { "class": "topright" }, el("span", { text: "SNAPSHOT " + D.as_of }), el("span", { text: "DEFILLAMA INDEX" }), el("span", { text: D.model_version.toUpperCase() })));
  }
  function hero() {
    return el("section", { "class": "hero" },
      el("div", null, el("h1", { text: "Pre-token opportunity radar" }), el("p", { text: "Launch candidates ranked by implied value from TVL, seven-day growth and time with no token. Tokens already trading and products of traded assets sit below candidates. A model estimate, not a promise." })),
      el("div", { "class": "metrics" },
        el("div", { "class": "metric" }, el("b", { text: String(D.watchlist_size) }), el("span", { text: "Watchlist" })),
        el("div", { "class": "metric" }, el("b", { text: String(D.board_size) }), el("span", { text: "Scored" })),
        el("div", { "class": "metric" }, el("b", { text: String(D.early_size) }), el("span", { text: "Below floor" }))));
  }
  function toolbar() {
    var cats = Array.from(new Set(D.rows.map(function (r) { return r.category || "Other"; }))).sort();
    var q = el("input", { type: "search", id: "search", "aria-label": "Search protocols", placeholder: "Name, slug or chain", value: state.q });
    q.oninput = function () { state.q = q.value; render(); };
    var cat = el("select", { id: "category", "aria-label": "Filter category" }, el("option", { value: "all", text: "All categories" }));
    cats.forEach(function (c) { cat.appendChild(el("option", { value: c, text: c, selected: c === state.category ? "selected" : null })); });
    cat.onchange = function () { state.category = cat.value; render(); };
    var pre = el("button", { type: "button", text: "Pre-token", "class": state.tab === "pre" ? "active" : "", onclick: function () { state.tab = "pre"; render(); } });
    var live = el("button", { type: "button", text: "Live token", "class": state.tab === "live" ? "active" : "", onclick: function () { state.tab = "live"; render(); } });
    return el("div", { "class": "toolbar" },
      el("div", { "class": "field" }, el("label", { for: "search", text: "Search" }), q),
      el("div", { "class": "field" }, el("label", { for: "category", text: "Category" }), cat),
      el("div", { "class": "tabs" }, pre, live),
      el("span", { "class": "count", text: state.tab === "pre" ? filtered().length + " of " + D.board_size + " rows" : D.live_size + " live protocols" }));
  }
  function sh(key, text) {
    return el("th", null, el("button", { type: "button", text: text + (state.sort === key ? (state.dir < 0 ? "  v" : "  ^") : ""), onclick: function () {
      if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render();
    } }));
  }
  function boardTable() {
    var list = sorted(filtered()), tbody = el("tbody");
    var max = list.length ? list[0].implied_value_usd : 1;
    if (!list.length) return el("div", { "class": "panel empty" }, el("h2", { text: "No protocols match" }), el("p", { text: "Clear the search or choose another category." }));
    list.forEach(function (r) {
      var tr = el("tr", { tabindex: "0", onclick: function () { openDetail(r.slug); }, onkeydown: function (e) { if (e.key === "Enter" || e.key === " ") openDetail(r.slug); } },
        el("td", { "class": "num", text: String(r.rank) }),
        el("td", null, el("span", { "class": "name", text: r.name }), el("span", { "class": "sub", text: (r.category || "Other") + " · " + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(", ") : "chain unknown") })),
        el("td", { "class": "num", text: usd(r.tvl_usd) }),
        el("td", { "class": "num " + (r.change_7d > 0 ? "pos" : r.change_7d < 0 ? "neg" : ""), text: pct(r.change_7d) }),
        el("td", { "class": "num", text: age(r.age_days) }),
        el("td", null, el("div", { "class": "value" }, el("span", { "class": "bar" }, el("i", { style: "width:" + Math.max(3, Math.round(r.implied_value_usd / max * 100)) + "%" })), el("span", { "class": "num", text: usd(r.implied_value_usd) }))),
        el("td", null, el("span", { "class": "sub", text: r.launch_candidate ? "Launch candidate · no token recorded" : "Token or product on record" }))
      );
      tbody.appendChild(tr);
    });
    return el("div", { "class": "panel" }, el("div", { "class": "tablewrap" },
      el("table", null, el("thead", null, el("tr", null, sh("implied", "Rank"), sh("name", "Protocol"), sh("tvl", "TVL"), sh("growth", "7d"), sh("age", "Age"), sh("implied", "Implied value"), el("th", null, "Status"))), tbody)));
  }
  function liveTable() {
    var tbody = el("tbody");
    D.live.forEach(function (r) {
      tbody.appendChild(el("tr", null, el("td", { "class": "name", text: r.name }), el("td", { "class": "sub", text: r.category || "Other" }), el("td", { "class": "num", text: usd(r.tvl_usd) }), el("td", { "class": "num", text: usd(r.mcap_usd) }), el("td", { "class": "num " + (r.change_7d > 0 ? "pos" : r.change_7d < 0 ? "neg" : ""), text: pct(r.change_7d) })));
    });
    return el("div", { "class": "panel" }, el("div", { "class": "tablewrap" }, el("table", null, el("thead", null, el("tr", null, el("th", null, "Protocol"), el("th", null, "Category"), el("th", null, "TVL"), el("th", null, "Market cap"), el("th", null, "7d"))), tbody)));
  }
  function modelStrip() {
    var m = D.model;
    return el("section", { "class": "modelstrip" },
      el("div", null, el("b", { text: "Value model" }), el("span", { text: "TVL^" + m.tvl_weight + " x " + m.value_scale + ", no hardcoded names" })),
      el("div", null, el("b", { text: "Growth" }), el("span", { text: "7-day change clamped " + m.growth_floor + "% to +" + m.growth_cap + "%, weight " + m.growth_weight })),
      el("div", null, el("b", { text: "Tenure" }), el("span", { text: "no-token years " + (m.age_floor + "–1.00") + " to " + m.age_cap_days + "d, plus " + m.tenure_bonus + " freshness" })),
      el("div", null, el("b", { text: "Candidates" }), el("span", { text: "CEX, bridge, staking and wrapped products rank below; category/chain factors" })));
  }
  function openDetail(slug) {
    state.slug = slug;
    var r = D.rows.find(function (x) { return x.slug === slug; });
    if (!r) return;
    var drawer = el("aside", { "class": "drawer", "aria-label": "Protocol detail" },
      el("div", { "class": "drawerhead" }, el("div", null, el("span", { "class": "sub", text: "#" + r.rank + " · " + (r.category || "Other") }), el("h2", { text: r.name })),
        el("button", { "class": "close", type: "button", "aria-label": "Close detail", text: "Close", onclick: function () { state.slug = null; render(); } })),
      el("div", { "class": "section" }, el("h3", { text: "Snapshot" }),
        el("div", { "class": "equation" }, el("div", null, el("span", { text: "TVL" }), el("b", { text: usd(r.tvl_usd) })), el("div", null, el("span", { text: "7-day growth" }), el("b", { text: pct(r.change_7d) })), el("div", null, el("span", { text: "Age on record" }), el("b", { text: age(r.age_days) })), el("div", null, el("span", { text: "Chains" }), el("b", { text: (r.chains || []).join(", ") || "Unknown" })), el("div", null, el("span", { text: "Implied value" }), el("b", { text: usd(r.implied_value_usd) })))),
      el("div", { "class": "section" }, el("h3", { text: "Farm plan" }),
        el("ol", { "class": "steps" }, steps(r).map(function (s) { var cut = s.indexOf(" Cost:"); return el("li", null, el("b", { text: cut >= 0 ? s.slice(0, cut) : s }), el("span", { "class": "cost", text: cut >= 0 ? s.slice(cut + 1) : "" })); }))));
    render(drawer);
  }
  function render(drawer) {
    app.innerHTML = "";
    app.appendChild(el("div", { "class": "shell" }, header(), hero(), toolbar(), state.tab === "pre" ? boardTable() : liveTable(), modelStrip()));
    if (drawer) app.appendChild(drawer);
  }
  var hash = window.location.hash.slice(1);
  if (hash) hash.split("&").forEach(function (part) {
    var pair = part.split("="), key = pair[0], val = decodeURIComponent(pair.slice(1).join("="));
    if (key === "category") state.category = val;
    if (key === "q") state.q = val;
    if (key === "slug") state.slug = val;
  });
  if (state.slug) openDetail(state.slug); else render();
})();
