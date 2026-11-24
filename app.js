/* 세찬 × 클피 워크스페이스 — app.js */
(function () {
  "use strict";

  var STORE_KEY = "sechan-board-state-v1";
  var FALLBACK_PIN = "0823";
  function defaultPin() { return (window.SEED && window.SEED.pin) || FALLBACK_PIN; }

  var STATUS = {
    active: { label: "진행중", cls: "active" },
    waiting: { label: "대기·보관", cls: "waiting" },
    done: { label: "완료", cls: "done" }
  };
  var FILTERS = [
    { id: "all", label: "전체" },
    { id: "urgent", label: "긴급" },
    { id: "active", label: "진행중" },
    { id: "waiting", label: "대기·보관" },
    { id: "done", label: "완료" }
  ];
  var WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];

  var ui = { filter: "all", unlocked: false, view: "home", catId: null };
  var pinBuffer = "";
  var toastTimer = null;

  /* ---------- helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function parseDate(s) { return new Date(s + "T00:00:00"); }
  function shortDate(s) { var d = parseDate(s); return (d.getMonth() + 1) + "/" + d.getDate(); }
  function dday(dateStr) {
    var t = new Date(); t.setHours(0, 0, 0, 0);
    var d = parseDate(dateStr);
    var diff = Math.round((d - t) / 86400000);
    if (diff === 0) return { text: "D-DAY", cls: "today", diff: diff };
    if (diff > 0) return { text: "D-" + diff, cls: diff <= 3 ? "soon" : "", diff: diff };
    return { text: "D+" + Math.abs(diff), cls: "past", diff: diff };
  }
  function stamp(date) {
    var d = date || new Date();
    return (d.getMonth() + 1) + "/" + d.getDate() + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function fullStamp(date) {
    var d = date || new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
      " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  /* ---------- state ---------- */
  function normalize(s) {
    if (!s || !Array.isArray(s.categories)) return null;
    var seed = clone(window.SEED);
    var ids = {};
    s.categories.forEach(function (c) { ids[c.id] = true; });
    seed.categories.forEach(function (c) { if (!ids[c.id]) s.categories.push(c); });
    if (!s.pin) s.pin = defaultPin();
    // 기본 PIN을 바꿨을 때, 사용자가 직접 바꾼 적 없는 기기는 새 기본값을 따른다.
    if (!s.pinCustom && s.pin !== defaultPin()) s.pin = defaultPin();
    if (!Array.isArray(s.deadlines)) s.deadlines = seed.deadlines;
    if (!s.stockCharts || typeof s.stockCharts !== "object") s.stockCharts = clone(seed.stockCharts || {});
    s.categories.forEach(function (c) {
      c.todos = c.todos || [];
      c.checklist = c.checklist || [];
      c.progress = c.progress || [];
      c.memos = c.memos || [];
      c.report = c.report || {};
    });
    // 기본 데이터가 갱신되면, 사용자가 남긴 체크·메모는 그대로 두고 새 항목만 더한다.
    if (Number(s.seedVersion || 0) < Number(window.SEED.version || 1)) {
      mergeSeed(s);
      s.seedVersion = window.SEED.version;
    }
    return s;
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return initWithSeed();
      return normalize(JSON.parse(raw)) || initWithSeed();
    } catch (e) {
      return initWithSeed();
    }
  }

  function mergeList(dst, src) {
    var seen = {};
    dst.forEach(function (it) { seen[it.text] = true; });
    (src || []).forEach(function (it) {
      if (!seen[it.text]) { dst.push(clone(it)); seen[it.text] = true; }
    });
  }

  function mergeSeed(s) {
    var seed = window.SEED;
    (seed.categories || []).forEach(function (sc) {
      var target = null;
      for (var i = 0; i < s.categories.length; i++) {
        if (s.categories[i].id === sc.id) target = s.categories[i];
      }
      if (!target) { s.categories.push(clone(sc)); return; }
      if (sc.report) target.report = clone(sc.report);
      if (sc.summary != null) target.summary = sc.summary;
      if (sc.title) target.title = sc.title;
      if (sc.emoji) target.emoji = sc.emoji;
      mergeList(target.todos, sc.todos);
      mergeList(target.checklist, sc.checklist);
      mergeList(target.progress, sc.progress);
      mergeList(target.memos, sc.memos);
    });
    if (seed.deadlines) s.deadlines = clone(seed.deadlines);
    // 종목별 시세: 서버에 이미 있는 기록은 그대로 두고, 새 종목·새 날짜만 더한다.
    if (seed.stockCharts) {
      s.stockCharts = s.stockCharts || {};
      Object.keys(seed.stockCharts).forEach(function (k) {
        var ss = seed.stockCharts[k], t = s.stockCharts[k];
        if (!t) { s.stockCharts[k] = clone(ss); return; }
        if (!Array.isArray(t.points)) t.points = [];
        var seen = {};
        t.points.forEach(function (p) { if (p && p.date) seen[p.date] = true; });
        (ss.points || []).forEach(function (p) {
          if (p && p.date && !seen[p.date]) { t.points.push(clone(p)); seen[p.date] = true; }
        });
        if (t.label == null) t.label = ss.label;
        if (t.sub == null) t.sub = ss.sub;
        if (t.unit == null) t.unit = ss.unit;
        if (t.avgPrice == null && ss.avgPrice != null) t.avgPrice = ss.avgPrice;
      });
    }
  }

  function initWithSeed() {
    var s = {
      pin: defaultPin(),
      seedVersion: window.SEED.version,
      categories: clone(window.SEED.categories),
      deadlines: clone(window.SEED.deadlines)
    };
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) {}
    return s;
  }
  function save() {
    state.savedAt = new Date().toISOString();
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
    markDirty();
  }
  var state = loadState();
  // 초기화 저장은 '수정'이 아니므로 savedAt·dirty를 건드리지 않는다.
  // (건드리면 이 기기의 오래된 사본이 서버보다 최신으로 보여 서버 데이터를 덮어쓴다.)
  var bootSavedAt = state.savedAt || null;
  state.seedVersion = window.SEED.version;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}

  /* ---------- 원격 저장소 (Supabase) ---------- */
  var CFG = window.SUPABASE_CONFIG || null;
  var remoteReady = false;   // 최초 원격 로드가 끝났는지
  var remoteKnownTs = 0;     // 마지막으로 확인·저장한 원격 updated_at(ms)
  var remoteBusy = false;    // 저장 요청 진행 중
  var pushTimer = null;
  var pollTimer = null;
  var lastEditAt = 0;        // 마지막 로컬 수정 시각
  var BADGE = {
    idle: "동기화됨",
    loading: "불러오는 중…",
    saving: "동기화 중…",
    ready: "동기화됨",
    offline: "오프라인 저장"
  };

  function remoteOn() { return !!(CFG && CFG.url && CFG.anonKey); }
  function apiUrl(query) {
    return CFG.url.replace(/\/+$/, "") + "/rest/v1/" + (CFG.table || "board_state") + (query || "");
  }
  function apiHeaders(extra) {
    var h = { apikey: CFG.anonKey, Authorization: "Bearer " + CFG.anonKey, "Content-Type": "application/json" };
    if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
    return h;
  }
  function setBadge(status) {
    var el = $("sync-badge");
    if (!el) return;
    if (!remoteOn()) { el.hidden = true; return; }
    el.hidden = false;
    el.setAttribute("data-state", status);
    el.textContent = BADGE[status] || BADGE.idle;
  }

  function fetchRemote() {
    var q = "?id=eq." + encodeURIComponent(CFG.rowId || "main") + "&select=data,updated_at";
    return fetch(apiUrl(q), { headers: apiHeaders(), cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  function applyRemote(payload) {
    var s = normalize(payload && payload.data);
    if (!s) return false;
    state = s;
    state.seedVersion = window.SEED.version;
    state.savedAt = payload.updated_at || new Date().toISOString();
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
    if (ui.unlocked) route();
    return true;
  }

  function pullRemote(initial) {
    if (!remoteOn()) return Promise.resolve(false);
    if (initial) setBadge("loading");
    return fetchRemote().then(function (rows) {
      if (!rows || !rows.length) {
        remoteReady = true;
        if (initial) { setBadge("ready"); pushRemote(); }
        return false;
      }
      var row = rows[0];
      var ts = Date.parse(row.updated_at) || 0;
      var localTs = Date.parse(bootSavedAt || 0) || 0;
      remoteReady = true;
      // 첫 로드에 이 기기의 수정본이 서버보다 더 최근이면 서버로 올린다.
      if (initial && localTs > ts + 2000) { pushRemote(); setBadge("saving"); return false; }
      var changed = ts > remoteKnownTs + 400;
      remoteKnownTs = ts;
      var applied = false;
      if (changed && (initial || Date.now() - lastEditAt > 3000)) applied = applyRemote(row);
      if (initial || applied) setBadge("ready");
      return applied;
    }).catch(function () {
      remoteReady = true;
      setBadge("offline");
      pendingPush = false;
      return false;
    }).then(function (res) {
      if (pendingPush) { pendingPush = false; pushRemote(); }
      return res;
    });
  }

  var pendingPush = false;
  function pushRemote() {
    if (!remoteOn() || !remoteReady) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(doPush, 400);
  }

  function doPush() {
    if (!remoteOn()) return;
    if (!remoteReady) { pendingPush = true; return; }
    if (remoteBusy) { clearTimeout(pushTimer); pushTimer = setTimeout(doPush, 500); return; }
    remoteBusy = true;
    setBadge("saving");
    var ts = new Date().toISOString();
    var body = JSON.stringify({ id: (CFG.rowId || "main"), data: state, updated_at: ts });
    fetch(apiUrl(""), {
      method: "POST",
      headers: apiHeaders({ Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: body
    }).then(function (r) {
      remoteBusy = false;
      if (!r.ok) throw new Error("HTTP " + r.status);
      remoteKnownTs = Date.parse(ts);
      setBadge("ready");
    }).catch(function () {
      remoteBusy = false;
      setBadge("offline");
    });
  }

  function markDirty() {
    lastEditAt = Date.now();
    pushRemote();
  }

  function startPolling() {
    if (!remoteOn()) return;
    clearInterval(pollTimer);
    pollTimer = setInterval(function () {
      if (document.hidden || remoteBusy) return;
      if (Date.now() - lastEditAt < 4000) return;
      pullRemote(false);
    }, 12000);
    function refresh() {
      if (document.hidden || remoteBusy) return;
      if (Date.now() - lastEditAt < 4000) return;
      pullRemote(false);
    }
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
  }

  /* ---------- derived ---------- */
  function progressOf(cat) {
    var list = (cat.todos && cat.todos.length) ? cat.todos : (cat.checklist || []);
    var total = list.length;
    var done = list.filter(function (i) { return i.done; }).length;
    return { total: total, done: done, pct: total ? Math.round((done / total) * 100) : 0 };
  }
  function nextDeadlineFor(catId) {
    var list = state.deadlines
      .filter(function (d) { return d.cat === catId && dday(d.date).diff >= 0; })
      .sort(function (a, b) { return a.date.localeCompare(b.date); });
    return list[0] || null;
  }
  function matchesFilter(cat, f) {
    if (f === "all") return true;
    if (f === "urgent") return !!cat.urgent && cat.status !== "done";
    return cat.status === f;
  }
  function currentCat() {
    for (var i = 0; i < state.categories.length; i++) {
      if (state.categories[i].id === ui.catId) return state.categories[i];
    }
    return null;
  }

  /* ---------- toast ---------- */
  function toast(msg) {
    var t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    requestAnimationFrame(function () { t.classList.add("show"); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      t.classList.remove("show");
      setTimeout(function () { t.hidden = true; }, 220);
    }, 1900);
  }

  /* ---------- lock screen ---------- */
  function updateDots() {
    var dots = $("pin-dots").children;
    for (var i = 0; i < dots.length; i++) {
      dots[i].className = i < pinBuffer.length ? "on" : "";
    }
  }
  function showLock() {
    pinBuffer = "";
    updateDots();
    $("lock-error").textContent = "";
    $("lock-screen").hidden = false;
    $("app").hidden = true;
  }
  function pressKey(key) {
    $("lock-error").textContent = "";
    if (key === "clear") { pinBuffer = ""; updateDots(); return; }
    if (key === "back") { pinBuffer = pinBuffer.slice(0, -1); updateDots(); return; }
    if (!/^\d$/.test(key) || pinBuffer.length >= 4) return;
    pinBuffer += key;
    updateDots();
    if (pinBuffer.length === 4) setTimeout(tryUnlock, 110);
  }
  function tryUnlock() {
    if (pinBuffer === state.pin) {
      ui.unlocked = true;
      $("lock-screen").hidden = true;
      $("app").hidden = false;
      route();
    } else {
      var lock = $("lock-screen");
      lock.classList.add("shake");
      $("lock-error").textContent = "PIN이 맞지 않아요. 다시 입력해 주세요.";
      setTimeout(function () { lock.classList.remove("shake"); }, 400);
      pinBuffer = "";
      updateDots();
    }
  }

  /* ---------- home ---------- */
  function renderToday() {
    var d = new Date();
    $("today-label").textContent = d.getFullYear() + "년 " + (d.getMonth() + 1) + "월 " + d.getDate() + "일 " + WEEKDAY[d.getDay()] + "요일";
  }

  function renderDeadlines() {
    var items = state.deadlines
      .map(function (d) { return { date: d.date, label: d.label, cat: d.cat, dd: dday(d.date) }; })
      .filter(function (d) { return d.dd.diff >= -2; })
      .sort(function (a, b) { return a.date.localeCompare(b.date); });
    var shown = items.slice(0, 6);
    var html = '<div class="deadlines-head"><h2>⏰ 가까운 마감</h2><span>' + items.length + '건</span></div>';
    if (!shown.length) {
      html += '<p class="muted-empty">표시할 마감이 없습니다.</p>';
    } else {
      html += '<ul class="deadline-list">';
      shown.forEach(function (d) {
        html += '<li><button type="button" class="deadline" data-cat="' + esc(d.cat || "") + '">' +
          '<span class="dl-date">' + shortDate(d.date) + '</span>' +
          '<span class="dl-label">' + esc(d.label) + '</span>' +
          '<span class="dl-badge ' + d.dd.cls + '">' + d.dd.text + '</span>' +
          '</button></li>';
      });
      html += '</ul>';
    }
    $("deadlines").innerHTML = html;
  }

  function renderFilters() {
    var counts = { all: state.categories.length, urgent: 0, active: 0, waiting: 0, done: 0 };
    state.categories.forEach(function (c) {
      if (c.urgent && c.status !== "done") counts.urgent++;
      if (counts[c.status] != null) counts[c.status]++;
    });
    var html = "";
    FILTERS.forEach(function (f) {
      html += '<button type="button" class="chip' + (ui.filter === f.id ? " on" : "") + '" data-filter="' + f.id + '" role="tab" aria-selected="' + (ui.filter === f.id) + '">' +
        f.label + '<span class="chip-count">' + counts[f.id] + '</span></button>';
    });
    $("filters").innerHTML = html;
  }

  function cardHTML(cat) {
    var p = progressOf(cat);
    var st = STATUS[cat.status] || STATUS.active;
    var due = nextDeadlineFor(cat.id);
    var tags = '<span class="tag ' + st.cls + '">' + st.label + '</span>';
    if (cat.urgent && cat.status !== "done") tags += '<span class="tag urgent">긴급</span>';
    var footLeft = p.total ? "할 일 " + p.done + "/" + p.total : "할 일 없음";
    var footRight = due
      ? '<span class="card-due">' + shortDate(due.date) + " · " + dday(due.date).text + "</span>"
      : "메모 " + (cat.memos ? cat.memos.length : 0) + "개";
    return '<button type="button" class="card" data-cat="' + esc(cat.id) + '">' +
      '<div class="card-top">' +
        '<span class="card-emoji">' + esc(cat.emoji || "📁") + '</span>' +
        '<div class="card-heading"><h3>' + esc(cat.title) + '</h3><div class="card-tags">' + tags + '</div></div>' +
      '</div>' +
      '<p class="card-summary">' + esc(cat.summary || "") + '</p>' +
      '<div class="card-progress">' +
        '<div class="card-progress-top"><span>진행률</span><strong>' + p.pct + '%</strong></div>' +
        '<div class="bar"><i style="width:' + p.pct + '%"></i></div>' +
      '</div>' +
      '<div class="card-foot"><span>' + footLeft + '</span>' + footRight + '</div>' +
    '</button>';
  }

  function renderHome() {
    setView("home");
    renderToday();
    renderDeadlines();
    renderFilters();
    var list = state.categories.filter(function (c) { return matchesFilter(c, ui.filter); });
    var host = $("cards");
    if (!list.length) {
      host.innerHTML = '<p class="empty">이 필터에 해당하는 카테고리가 없습니다.<br>오른쪽 위 <strong>+ 새 카테고리</strong>로 추가할 수 있어요.</p>';
    } else {
      host.innerHTML = list.map(cardHTML).join("");
    }
  }

  /* ---------- detail ---------- */
  function sectionReport(cat) {
    var r = cat.report || {};
    var html = '<section class="section"><div class="section-head"><h2>📊 보고</h2></div>';
    if (r.intro) html += '<p class="section-sub" style="margin-top:0">' + esc(r.intro) + '</p>';
    if (r.table && r.table.rows && r.table.rows.length) {
      html += '<div class="table-scroll" style="margin-top:12px"><table class="report-table"><thead><tr>';
      (r.table.columns || []).forEach(function (c) { html += '<th>' + esc(c) + '</th>'; });
      html += '</tr></thead><tbody>';
      r.table.rows.forEach(function (row) {
        html += '<tr>' + row.map(function (cell) { return '<td>' + esc(cell) + '</td>'; }).join('') + '</tr>';
      });
      html += '</tbody></table></div>';
    }
    (r.notes || []).forEach(function (n) { html += '<p class="section-note">' + esc(n) + '</p>'; });
    if (r.links && r.links.length) {
      html += '<div class="link-row">';
      r.links.forEach(function (l) {
        html += '<a class="link-chip" href="' + esc(l.url) + '" target="_blank" rel="noopener noreferrer"><span>' + esc(l.label) + '</span> ↗</a>';
      });
      html += '</div>';
    }
    html += '</section>';
    return html;
  }

  function sectionProgress(cat) {
    var items = cat.progress || [];
    var html = '<section class="section"><div class="section-head"><h2>🚩 진행상황</h2><span class="muted">' + items.length + '단계</span></div>';
    if (!items.length) {
      html += '<p class="muted-empty">아직 기록이 없습니다. 아래 입력창에서 [진행상황]을 골라 추가해 보세요.</p>';
    } else {
      html += '<ul class="timeline">';
      items.forEach(function (it) {
        html += '<li><div class="tl-date">' + esc(it.date) + '</div><div class="tl-text">' + esc(it.text) + '</div></li>';
      });
      html += '</ul>';
    }
    html += '</section>';
    return html;
  }

  function checkListHTML(items, kind, idPrefix) {
    if (!items.length) return '<p class="muted-empty">아직 항목이 없습니다. 아래 입력창에서 추가해 보세요.</p>';
    var html = '<ul class="check-list">';
    items.forEach(function (it, i) {
      var id = idPrefix + "-" + i;
      html += '<li class="check-item' + (it.done ? " done" : "") + '">' +
        '<input type="checkbox" id="' + id + '" data-kind="' + kind + '" data-idx="' + i + '"' + (it.done ? " checked" : "") + '>' +
        '<label for="' + id + '">' + esc(it.text) + '</label>' +
        '</li>';
    });
    html += '</ul>';
    return html;
  }

  function sectionTodos(cat) {
    var p = progressOf(cat);
    var same = (cat.todos && cat.todos.length) || !(cat.checklist && cat.checklist.length);
    var note = same ? "" : '<span class="muted">체크리스트 기준</span>';
    return '<section class="section"><div class="section-head"><h2>📝 할 일</h2>' + note + '</div>' +
      '<div class="todo-head"><div class="bar"><i style="width:' + p.pct + '%"></i></div><span class="pct">' + p.pct + '%</span></div>' +
      checkListHTML(cat.todos || [], "todos", "todo") +
      '</section>';
  }

  function sectionChecklist(cat) {
    var items = cat.checklist || [];
    var done = items.filter(function (i) { return i.done; }).length;
    return '<section class="section"><div class="section-head"><h2>✅ 체크리스트</h2><span class="muted">' + done + "/" + items.length + '</span></div>' +
      checkListHTML(items, "checklist", "check") +
      '</section>';
  }

  function sectionMemos(cat) {
    var items = cat.memos || [];
    var html = '<section class="section"><div class="section-head"><h2>💬 메모</h2><span class="muted">' + items.length + '개</span></div>';
    if (!items.length) {
      html += '<p class="muted-empty">아직 메모가 없습니다.</p>';
    } else {
      html += '<ul class="memo-list">';
      items.forEach(function (m) {
        var when = "";
        try { when = m.at ? fullStamp(new Date(m.at)) : ""; } catch (e) {}
        html += '<li class="memo"><p>' + esc(m.text) + '</p>' + (when ? '<time>' + esc(when) + '</time>' : '') + '</li>';
      });
      html += '</ul>';
    }
    html += '</section>';
    return html;
  }

  /* ---------- 주가 · 수익률 그래프 ---------- */
  var chartUi = { key: null, mode: "price" };

  function num(n) {
    if (n == null || isNaN(n)) return "—";
    return Number(n).toLocaleString("ko-KR");
  }
  function signed(r, digits) {
    if (r == null || !isFinite(r)) return "—";
    return (r > 0 ? "+" : "") + (r * 100).toFixed(digits == null ? 1 : digits) + "%";
  }
  function mdLabel(iso) {
    var m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? (+m[2]) + "/" + (+m[3]) : String(iso || "");
  }
  function isoDate(iso) {
    var m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? new Date(+m[1], (+m[2]) - 1, +m[3]) : null;
  }
  function chartState() {
    var all = state.stockCharts || {};
    var keys = Object.keys(all).filter(function (k) {
      return all[k] && Array.isArray(all[k].points);
    });
    if (!keys.length) return null;
    // 서버(JSONB)는 키 순서를 보장하지 않으므로 order → 라벨 순으로 정렬한다.
    keys.sort(function (a, b) {
      var oa = typeof all[a].order === "number" ? all[a].order : 999;
      var ob = typeof all[b].order === "number" ? all[b].order : 999;
      if (oa !== ob) return oa - ob;
      return String(all[a].label || a).localeCompare(String(all[b].label || b), "ko");
    });
    if (!chartUi.key || keys.indexOf(chartUi.key) < 0) chartUi.key = keys[0];
    return { keys: keys, key: chartUi.key, s: all[chartUi.key] };
  }
  function chartPoints(s) {
    var byDate = {};
    (s.points || []).forEach(function (p) {
      if (p && p.date && typeof p.price === "number" && isFinite(p.price)) byDate[String(p.date)] = p.price;
    });
    return Object.keys(byDate).sort().map(function (d) { return { date: d, price: byDate[d] }; });
  }

  function sectionCharts(cat) {
    if (!cat.hasCharts) return "";
    var c = chartState();
    var html = '<section class="section"><div class="section-head"><h2>📈 주가 · 수익률 추이</h2><span class="muted">매일 1포인트 기록</span></div>';
    if (!c) return html + '<p class="muted-empty">아직 기록된 시세가 없습니다.</p></section>';
    html += '<div class="stock-tabs" id="stock-tabs" role="tablist" aria-label="종목 선택">';
    c.keys.forEach(function (k) {
      var s = state.stockCharts[k];
      var on = k === c.key;
      html += '<button type="button" class="stock-tab' + (on ? " on" : "") + '" role="tab" aria-selected="' + (on ? "true" : "false") + '" data-stock="' + esc(k) + '">' +
        '<span class="st-name">' + esc(s.label || k) + '</span>' +
        '<span class="st-avg">' + (s.avgPrice ? '평단 ' + num(s.avgPrice) + '원' : '평단 미기록') + '</span>' +
        '</button>';
    });
    html += '</div><div id="stock-chart"></div>' +
      '<p class="stock-note">국내 ETF·금은 한국거래소 정규장 종가, 엔비디아·테슬라는 토스증권 원화 환산 시세입니다. 클피가 브리핑할 때마다 하루치를 이어 붙입니다.</p></section>';
    return html;
  }

  function drawChart() {
    var host = $("stock-chart");
    if (!host) return;
    var c = chartState();
    if (!c) { host.innerHTML = ""; return; }
    var s = c.s;
    var pts = chartPoints(s);
    var avg = (typeof s.avgPrice === "number" && s.avgPrice > 0) ? s.avgPrice : null;
    var last = pts.length ? pts[pts.length - 1] : null;
    var prev = pts.length > 1 ? pts[pts.length - 2] : null;
    var mode = (chartUi.mode === "return" && avg) ? "return" : "price";
    var ret = (avg && last) ? last.price / avg - 1 : null;
    var chg = (prev && last) ? last.price / prev.price - 1 : null;

    var head = '<div class="chart-head"><div class="ss-main">' +
      '<span class="ss-label">' + (mode === "return" ? "평단 대비 수익률" : "현재가") + '</span>' +
      (last
        ? '<strong>' + (mode === "return" ? signed(ret) : num(last.price) + "원") + '</strong>' +
          '<span class="ss-date">' + mdLabel(last.date) + ' 기록 · ' + esc(s.sub || "") + '</span>'
        : '<strong>—</strong>') +
      '</div><div class="chart-toggle" role="tablist" aria-label="그래프 기준">' +
        '<button type="button" data-mode="price" class="' + (mode === "price" ? "on" : "") + '">가격</button>' +
        '<button type="button" data-mode="return"' + (avg ? ' class="' + (mode === "return" ? "on" : "") + '"' : ' disabled title="평단을 기록하면 열립니다"') + '>수익률</button>' +
      '</div></div>';

    var summary = '<div class="ss-grid">' +
      '<div><span>평단</span><strong>' + (avg ? num(avg) + "원" : "미기록") + '</strong></div>' +
      (ret != null ? '<div><span>평단 대비</span><strong class="' + (ret >= 0 ? "up" : "down") + '">' + signed(ret) + '</strong></div>' : '') +
      (chg != null ? '<div><span>직전 기록(' + mdLabel(prev.date) + ') 대비</span><strong class="' + (chg >= 0 ? "up" : "down") + '">' + signed(chg) + '</strong></div>' : '') +
      '<div><span>기록</span><strong>' + pts.length + '일</strong></div>' +
      '</div>';

    if (!pts.length) {
      host.innerHTML = head + summary + '<p class="muted-empty">아직 시세 기록이 없습니다. 다음 브리핑부터 하루치씩 쌓입니다.</p>';
      return;
    }

    var W = Math.max(240, Math.round(host.clientWidth || 320));
    var H = 200, padL = 56, padR = 12, padT = 16, padB = 22;
    var iw = W - padL - padR, ih = H - padT - padB;
    var vals = pts.map(function (p) { return mode === "return" ? p.price / avg - 1 : p.price; });
    if (mode === "price" && avg) vals.push(avg);
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
    if (mode === "return") {
      var m = Math.max(Math.abs(mn), Math.abs(mx), 0.01) * 1.25;
      mn = -m; mx = m;
    } else {
      var span = mx - mn;
      if (!isFinite(span) || span < mx * 0.004) { mn -= (mx * 0.03 || 1); mx += (mx * 0.03 || 1); }
      else { mn -= span * 0.14; mx += span * 0.14; }
    }
    function X(i) { return pts.length === 1 ? padL + iw / 2 : padL + (i / (pts.length - 1)) * iw; }
    function Y(v) { return padT + ih - ((v - mn) / (mx - mn)) * ih; }
    function valAt(p) { return mode === "return" ? p.price / avg - 1 : p.price; }

    var grid = "", axis = "";
    for (var t = 0; t <= 4; t++) {
      var gv = mx - (mx - mn) * (t / 4);
      var gy = Y(gv);
      grid += '<line x1="' + padL + '" y1="' + gy.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + gy.toFixed(1) + '"/>';
      axis += '<text x="' + (padL - 7) + '" y="' + (gy + 3.2).toFixed(1) + '" text-anchor="end">' +
        (mode === "return" ? signed(gv, 1) : num(Math.round(gv))) + '</text>';
    }

    var avgLine = "";
    if (avg) {
      var ay = Y(mode === "return" ? 0 : avg);
      avgLine = '<line class="chart-avg" x1="' + padL + '" y1="' + ay.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + ay.toFixed(1) + '"/>' +
        '<text class="chart-avg-label" x="' + (W - padR) + '" y="' + (ay - 5).toFixed(1) + '" text-anchor="end">평단 ' + num(avg) + '원</text>';
    }

    var path = "", dots = "";
    pts.forEach(function (p, i) {
      var px = X(i), py = Y(valAt(p));
      path += (i ? "L" : "M") + px.toFixed(1) + " " + py.toFixed(1);
      dots += '<circle class="chart-dot' + (i === pts.length - 1 ? " last" : "") + '" cx="' + px.toFixed(1) + '" cy="' + py.toFixed(1) + '" r="' + (i === pts.length - 1 ? 4 : 2.6) + '"/>';
    });
    var area = "";
    if (pts.length > 1) {
      area = '<path class="chart-area" d="' + path +
        'L' + X(pts.length - 1).toFixed(1) + ' ' + (padT + ih) +
        'L' + X(0).toFixed(1) + ' ' + (padT + ih) + 'Z"/>';
    }

    var xi = [0];
    if (pts.length > 2) xi.push(Math.floor((pts.length - 1) / 2));
    if (pts.length > 1) xi.push(pts.length - 1);
    xi = xi.filter(function (v, i2, arr) { return arr.indexOf(v) === i2; });
    var xlabels = "";
    xi.forEach(function (i) {
      var anchor = pts.length === 1 ? "middle" : (i === 0 ? "start" : (i === pts.length - 1 ? "end" : "middle"));
      xlabels += '<text x="' + X(i).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="' + anchor + '">' + mdLabel(pts[i].date) + '</text>';
    });

    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" preserveAspectRatio="none" role="img" aria-label="' +
        esc((s.label || "") + " " + (mode === "return" ? "수익률" : "가격") + " 추이") + '">' +
      '<g class="chart-grid">' + grid + '</g>' +
      area +
      avgLine +
      '<path class="chart-line" d="' + path + '"/>' +
      dots +
      '<g class="chart-axis">' + axis + xlabels + '</g>' +
      '<line class="chart-guide" id="chart-guide" x1="0" y1="' + padT + '" x2="0" y2="' + (padT + ih) + '"/>' +
      '<circle class="chart-focus" id="chart-focus" r="4.5" cx="0" cy="0" opacity="0"/>' +
      '</svg>';

    host.innerHTML = head + summary +
      '<div class="chart-wrap" id="chart-wrap">' + svg + '<div class="chart-tip" id="chart-tip"></div></div>' +
      (pts.length === 1 ? '<p class="stock-note">첫 기록입니다. 내일 기록이 더해지면 선으로 이어집니다.</p>' : '');

    var wrap = $("chart-wrap");
    var svgEl = wrap ? wrap.querySelector("svg") : null;
    if (!svgEl) return;
    var tip = $("chart-tip"), guide = $("chart-guide"), focus = $("chart-focus");
    function hideTip() {
      if (guide) guide.classList.remove("on");
      if (focus) focus.setAttribute("opacity", "0");
      if (tip) tip.classList.remove("on");
    }
    function showTip(i) {
      var p = pts[i], px = X(i), py = Y(valAt(p));
      if (guide) { guide.setAttribute("x1", px); guide.setAttribute("x2", px); guide.classList.add("on"); }
      if (focus) { focus.setAttribute("cx", px); focus.setAttribute("cy", py); focus.setAttribute("opacity", "1"); }
      if (!tip) return;
      tip.innerHTML = '<b>' + mdLabel(p.date) + '</b> ' + num(p.price) + '원' +
        (avg ? ' · ' + signed(p.price / avg - 1) : '');
      tip.style.left = Math.max(18, Math.min(82, (px / W) * 100)) + '%';
      tip.style.top = Math.max(22, py) + 'px';
      tip.classList.add("on");
    }
    function pick(ev) {
      var r = svgEl.getBoundingClientRect();
      if (!r.width) return;
      var px = (ev.clientX - r.left) * (W / r.width);
      var best = 0, bd = Infinity;
      for (var i = 0; i < pts.length; i++) {
        var dd = Math.abs(X(i) - px);
        if (dd < bd) { bd = dd; best = i; }
      }
      showTip(best);
    }
    svgEl.addEventListener("pointermove", pick);
    svgEl.addEventListener("pointerdown", pick);
    svgEl.addEventListener("pointerleave", hideTip);
    svgEl.addEventListener("pointercancel", hideTip);
  }

  /* ---------- 날짜별 브리핑 아카이브 ---------- */
  function archiveTagClass(tag) {
    if (/긴급|속보/.test(tag)) return " urgent";
    if (/주식|브리핑/.test(tag)) return " stock";
    if (/아침|뉴스/.test(tag)) return " morning";
    return "";
  }
  function archiveGroups(cat) {
    var items = (cat.progress || []).map(function (it) {
      var d = String(it.date || "").trim();
      var time = String(it.time || "").trim();
      var iso = "";
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) iso = d;
      else {
        var m = d.match(/^(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
        if (m) {
          iso = new Date().getFullYear() + "-" + pad(+m[1]) + "-" + pad(+m[2]);
          if (!time && m[3]) time = pad(+m[3]) + ":" + m[4];
        }
      }
      return { iso: iso || d, time: time, tag: it.tag || "기록", text: it.text || "" };
    });
    items.sort(function (a, b) {
      if (a.iso !== b.iso) return a.iso < b.iso ? 1 : -1;
      if (a.time === b.time) return 0;
      return a.time < b.time ? 1 : -1;
    });
    var groups = [];
    items.forEach(function (it) {
      var g = groups[groups.length - 1];
      if (!g || g.iso !== it.iso) { g = { iso: it.iso, items: [] }; groups.push(g); }
      g.items.push(it);
    });
    return groups;
  }
  function sectionArchive(cat) {
    var total = (cat.progress || []).length;
    var html = '<section class="section"><div class="section-head"><h2>🗂️ 날짜별 브리핑 · 긴급속보</h2><span class="muted">' + total + '건</span></div>';
    if (!total) return html + '<p class="muted-empty">아직 쌓인 브리핑이 없습니다.</p></section>';
    html += '<div class="archive">';
    archiveGroups(cat).forEach(function (g) {
      var d = isoDate(g.iso);
      var label = d ? (d.getMonth() + 1) + "월 " + d.getDate() + "일" : g.iso;
      var wd = d ? "(" + WEEKDAY[d.getDay()] + ")" : "";
      html += '<div class="archive-day"><div class="archive-day-head">' +
        '<span class="archive-date">' + esc(label) + '</span>' +
        '<span class="archive-wd">' + esc(wd) + '</span>' +
        '<span class="archive-count">' + g.items.length + '건</span></div><ul class="archive-items">';
      g.items.forEach(function (it) {
        var tc = archiveTagClass(it.tag);
        html += '<li class="archive-item' + (tc === " urgent" ? " is-urgent" : "") + '">' +
          '<div class="archive-meta">' + (it.time ? '<span class="archive-time">' + esc(it.time) + '</span>' : '') +
          '<span class="archive-tag' + tc + '">' + esc(it.tag) + '</span></div>' +
          '<p class="archive-text">' + esc(it.text) + '</p></li>';
      });
      html += '</ul></div>';
    });
    html += '</div></section>';
    return html;
  }

  function renderDetail() {
    var cat = currentCat();
    if (!cat) { location.hash = "#/"; return; }
    setView("detail");
    var opts = "";
    Object.keys(STATUS).forEach(function (k) {
      opts += '<option value="' + k + '"' + (cat.status === k ? " selected" : "") + '>' + STATUS[k].label + '</option>';
    });
    var html = '<div class="detail-head">' +
      '<button type="button" class="back-btn" id="btn-back" aria-label="목록으로">←</button>' +
      '<div class="detail-title"><h1>' + esc(cat.emoji || "📁") + ' ' + esc(cat.title) + '</h1><p>' + esc(cat.summary || "") + '</p></div>' +
      '<div class="detail-status"><select class="status-select" id="detail-status" aria-label="상태 변경">' + opts + '</select></div>' +
      '</div>' +
      '<div class="detail-wrap">' +
        '<div class="detail-col">' + sectionReport(cat) + sectionCharts(cat) +
          (cat.archive ? sectionArchive(cat) : sectionProgress(cat)) + '</div>' +
        '<div class="detail-col">' + sectionTodos(cat) + sectionChecklist(cat) + sectionMemos(cat) + '</div>' +
      '</div>';
    $("detail-view").innerHTML = html;
    drawChart();

    $("btn-back").addEventListener("click", goBack);
    $("detail-status").addEventListener("change", function (e) {
      cat.status = e.target.value;
      save();
      toast("상태를 '" + (STATUS[cat.status] ? STATUS[cat.status].label : cat.status) + "'로 바꿨어요");
    });
    var boxes = $("detail-view").querySelectorAll('input[type="checkbox"][data-kind]');
    Array.prototype.forEach.call(boxes, function (box) {
      box.addEventListener("change", function () {
        var kind = box.getAttribute("data-kind");
        var idx = parseInt(box.getAttribute("data-idx"), 10);
        var list = cat[kind] || [];
        if (list[idx]) {
          list[idx].done = box.checked;
          save();
          renderDetail();
        }
      });
    });
  }

  /* ---------- navigation ---------- */
  function setView(v) {
    var changed = ui.view !== v;
    ui.view = v;
    $("home-view").hidden = v !== "home";
    $("detail-view").hidden = v !== "detail";
    $("composer").hidden = v !== "detail";
    $("app").classList.toggle("in-detail", v === "detail");
    if (changed) window.scrollTo(0, 0);
  }
  function openCat(id) {
    if (!id) return;
    location.hash = "#/c/" + encodeURIComponent(id);
  }
  function goBack() {
    if (location.hash && location.hash !== "#/") {
      location.hash = "#/";
    } else {
      renderHome();
    }
  }
  function route() {
    if (!ui.unlocked) { showLock(); return; }
    var m = (location.hash || "").match(/^#\/c\/([^/?]+)/);
    if (m) {
      ui.catId = decodeURIComponent(m[1]);
      renderDetail();
    } else {
      ui.catId = null;
      renderHome();
    }
  }

  /* ---------- composer ---------- */
  function addEntry(kind, raw) {
    var cat = currentCat();
    var text = (raw || "").trim();
    if (!cat || !text) return;
    if (kind === "memo") {
      cat.memos.unshift({ text: text, at: new Date().toISOString() });
    } else if (kind === "todo") {
      cat.todos.push({ text: text, done: false });
    } else if (kind === "check") {
      cat.checklist.push({ text: text, done: false });
    } else {
      cat.progress.push({ date: stamp(), text: text });
    }
    save();
    renderDetail();
    toast("추가했어요");
  }

  /* ---------- modals ---------- */
  function openModal(id) { $(id).hidden = false; }
  function closeModal(id) { $(id).hidden = true; }
  function closeAllModals() {
    closeModal("pin-modal");
    closeModal("cat-modal");
  }

  function savePin() {
    var cur = $("pin-current").value.trim();
    var next = $("pin-new").value.trim();
    var again = $("pin-confirm").value.trim();
    var err = $("pin-error");
    if (cur !== state.pin) { err.textContent = "현재 PIN이 맞지 않습니다."; return; }
    if (!/^\d{4}$/.test(next)) { err.textContent = "새 PIN은 숫자 4자리로 정해 주세요."; return; }
    if (next !== again) { err.textContent = "새 PIN 확인이 일치하지 않습니다."; return; }
    state.pin = next;
    state.pinCustom = true;
    save();
    err.textContent = "";
    $("pin-current").value = "";
    $("pin-new").value = "";
    $("pin-confirm").value = "";
    closeModal("pin-modal");
    toast("PIN을 바꿨어요");
  }

  function createCategory() {
    var emoji = ($("cat-emoji").value || "").trim() || "📁";
    var name = ($("cat-name").value || "").trim();
    var desc = ($("cat-desc").value || "").trim();
    var status = $("cat-status").value;
    var urgent = $("cat-urgent").checked;
    var err = $("cat-error");
    if (!name) { err.textContent = "카테고리 이름을 입력해 주세요."; return; }
    var id = "c" + Date.now().toString(36);
    state.categories.push({
      id: id,
      emoji: emoji,
      title: name,
      status: status,
      urgent: urgent,
      summary: desc,
      report: { intro: desc, table: null, notes: [], links: [] },
      progress: [],
      checklist: [],
      todos: [],
      memos: []
    });
    save();
    err.textContent = "";
    $("cat-name").value = "";
    $("cat-desc").value = "";
    $("cat-emoji").value = "📁";
    $("cat-urgent").checked = false;
    $("cat-status").value = "active";
    closeModal("cat-modal");
    toast("카테고리를 만들었어요");
    openCat(id);
  }

  /* ---------- init ---------- */
  function bind() {
    $("keypad").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-key]");
      if (b) pressKey(b.getAttribute("data-key"));
    });
    document.addEventListener("keydown", function (e) {
      if (!$("lock-screen").hidden) {
        if (/^\d$/.test(e.key)) pressKey(e.key);
        else if (e.key === "Backspace") { e.preventDefault(); pressKey("back"); }
        return;
      }
      if (e.key === "Escape") {
        if (!$("pin-modal").hidden) closeModal("pin-modal");
        else if (!$("cat-modal").hidden) closeModal("cat-modal");
        else if (ui.view === "detail") goBack();
      }
    });

    $("btn-lock").addEventListener("click", function () {
      ui.unlocked = false;
      location.hash = "#/";
      showLock();
    });
    $("btn-pin").addEventListener("click", function () {
      $("pin-error").textContent = "";
      $("pin-current").value = "";
      $("pin-new").value = "";
      $("pin-confirm").value = "";
      openModal("pin-modal");
      setTimeout(function () { $("pin-current").focus(); }, 50);
    });
    $("btn-new-cat").addEventListener("click", function () {
      $("cat-error").textContent = "";
      openModal("cat-modal");
      setTimeout(function () { $("cat-name").focus(); }, 50);
    });
    $("pin-save").addEventListener("click", savePin);
    $("cat-save").addEventListener("click", createCategory);

    Array.prototype.forEach.call(document.querySelectorAll("[data-close]"), function (b) {
      b.addEventListener("click", function () { closeModal(b.getAttribute("data-close")); });
    });
    Array.prototype.forEach.call(document.querySelectorAll(".modal"), function (m) {
      m.addEventListener("click", function (e) { if (e.target === m) m.hidden = true; });
    });

    $("filters").addEventListener("click", function (e) {
      var b = e.target.closest("[data-filter]");
      if (!b) return;
      ui.filter = b.getAttribute("data-filter");
      renderHome();
    });
    $("deadlines").addEventListener("click", function (e) {
      var b = e.target.closest("[data-cat]");
      if (b) openCat(b.getAttribute("data-cat"));
    });
    $("cards").addEventListener("click", function (e) {
      var b = e.target.closest("[data-cat]");
      if (b) openCat(b.getAttribute("data-cat"));
    });

    // 종목 탭·가격/수익률 토글 (상세 화면은 다시 그려져도 이 컨테이너는 유지됨)
    $("detail-view").addEventListener("click", function (e) {
      var tab = e.target.closest("[data-stock]");
      if (tab) {
        chartUi.key = tab.getAttribute("data-stock");
        chartUi.mode = "price";
        var box = $("stock-tabs");
        if (box) Array.prototype.forEach.call(box.querySelectorAll("[data-stock]"), function (b) {
          var on = b === tab;
          b.classList.toggle("on", on);
          b.setAttribute("aria-selected", on ? "true" : "false");
          if (on && b.scrollIntoView) b.scrollIntoView({ block: "nearest", inline: "nearest" });
        });
        drawChart();
        return;
      }
      var modeBtn = e.target.closest("[data-mode]");
      if (modeBtn && !modeBtn.disabled) {
        chartUi.mode = modeBtn.getAttribute("data-mode");
        drawChart();
      }
    });

    var chartResizeTimer = null;
    window.addEventListener("resize", function () {
      clearTimeout(chartResizeTimer);
      chartResizeTimer = setTimeout(function () { drawChart(); }, 160);
    });

    // iOS PWA: 화면 키보드가 올라온 만큼만 하단 입력창을 띄운다.
    function syncKeyboardGap() {
      var vv = window.visualViewport;
      if (!vv) return;
      var gap = window.innerHeight - vv.height - vv.offsetTop;
      document.documentElement.style.setProperty("--kb", gap > 80 ? Math.round(gap) + "px" : "0px");
    }
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", syncKeyboardGap);
      window.visualViewport.addEventListener("scroll", syncKeyboardGap);
      syncKeyboardGap();
    }

    $("composer").addEventListener("submit", function (e) {
      e.preventDefault();
      var input = $("composer-input");
      addEntry($("composer-type").value, input.value);
      input.value = "";
      input.focus();
    });

    window.addEventListener("hashchange", route);
  }

  bind();
  showLock();
  if (remoteOn()) {
    setBadge("loading");
    pullRemote(true).then(startPolling);
  } else {
    setBadge("idle");
  }
})();
