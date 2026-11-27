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
    // 오답노트 기본 예시: 아직 없는 기기에는 시드에서 한 번 넣고, 이미 쌓인 기록·복습 체크는 그대로 둔다.
    seed.categories.forEach(function (sc) {
      if (!sc.wrongNotes) return;
      s.categories.forEach(function (c) {
        if (c.id !== sc.id) return;
        if (!c.wrongNotes || typeof c.wrongNotes !== "object") c.wrongNotes = { sentences: [], words: [] };
        mergeWrongNotes(c.wrongNotes, sc.wrongNotes);
      });
    });
    // 가계부 대시보드: 시드에 있고 이 기기에 없을 때만 채웠다(이미 받은 갱신본은 그대로).
    seed.categories.forEach(function (sc) {
      if (!sc.dashboard) return;
      s.categories.forEach(function (c) {
        if (c.id === sc.id && !c.dashboard) c.dashboard = clone(sc.dashboard);
      });
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

  // 오답노트는 id 기준으로 없는 항목만 더한다(복습 체크·이후 추가분은 보존).
  function mergeWrongNotes(dst, src) {
    if (!dst || typeof dst !== "object" || !src || typeof src !== "object") return;
    ["sentences", "words"].forEach(function (k) {
      if (!Array.isArray(dst[k])) dst[k] = [];
      var seen = {};
      dst[k].forEach(function (it) { if (it && it.id) seen[it.id] = true; });
      (src[k] || []).forEach(function (it) {
        if (!it || !it.id || seen[it.id]) return;
        dst[k].push(clone(it));
        seen[it.id] = true;
      });
    });
  }

  // 같은 항목인지 판별하는 키: id가 있으면 id, 없으면 text(+at).
  // 메모는 같은 문장을 다른 날 또 남길 수 있어 text만으로 묶으면 사라지므로 at을 함께 본다.
  function itemKey(it) {
    if (!it) return "";
    if (it.id) return "i:" + it.id;
    return "t:" + String(it.text == null ? "" : it.text) + "|" + String(it.at || "");
  }

  function mergeList(dst, src) {
    var seen = {};
    dst.forEach(function (it) { seen[itemKey(it)] = true; });
    (src || []).forEach(function (it) {
      var k = itemKey(it);
      if (!k || seen[k]) return;
      dst.push(clone(it));
      seen[k] = true;
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
      if (sc.wrongNotes) {
        if (!target.wrongNotes || typeof target.wrongNotes !== "object") target.wrongNotes = { sentences: [], words: [] };
        mergeWrongNotes(target.wrongNotes, sc.wrongNotes);
      }
      if (sc.dashboard && !target.dashboard) target.dashboard = clone(sc.dashboard);
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
        if (t.order == null && ss.order != null) t.order = ss.order;
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

  /* ---------- 메모 (대화형 말풍선) ----------
     재은 님 보드(제나 × 똘마니)와 같은 채팅형 메모 — 세찬님은 오른쪽 보라,
     클피는 왼쪽 시안 말풍선. who가 없는 예전 메모는 세찬님 글로 본다. */
  var MEMO_LIMIT = 20;
  var memoUi = { showAll: false, catId: null };

  function memoWho(m) {
    var w = String((m && m.who) || "").trim();
    return (w === "keulpi" || w === "클피") ? "keulpi" : "sechan";
  }
  function memoTime(m) {
    var t = m && m.at ? Date.parse(m.at) : NaN;
    return isNaN(t) ? null : t;
  }
  function clockLabel(t) {
    var d = new Date(t);
    var h = d.getHours();
    var ap = h < 12 ? "오전" : "오후";
    h = h % 12 || 12;
    return ap + " " + h + ":" + pad(d.getMinutes());
  }
  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
  function memoDayKey(d) { return "" + d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate(); }
  function memoDayLabel(d) {
    var now = new Date();
    var y = new Date(now.getTime());
    y.setDate(now.getDate() - 1);
    var md = (d.getMonth() + 1) + "월 " + d.getDate() + "일";
    var wd = "(" + WEEKDAY[d.getDay()] + ")";
    if (sameDay(d, now)) return "오늘 · " + md + " " + wd;
    if (sameDay(d, y)) return "어제 · " + md + " " + wd;
    return d.getFullYear() === now.getFullYear() ? md + " " + wd : d.getFullYear() + "년 " + md;
  }

  // 말풍선 안의 http(s)·www 주소를 새 탭 링크로 바꾼다.
  var MEMO_URL_RE = /(https?:\/\/[^\s<>"'`]+|www\.[^\s<>"'`]+)/g;
  function memoText(text) {
    var s = String(text == null ? "" : text);
    var out = "", last = 0, m;
    MEMO_URL_RE.lastIndex = 0;
    while ((m = MEMO_URL_RE.exec(s))) {
      var raw = m[0], tail = "";
      var tm = raw.match(/[)\]}.,;:!?'"]+$/);
      if (tm) { tail = tm[0]; raw = raw.slice(0, -tail.length); }
      out += esc(s.slice(last, m.index));
      if (raw.length > 6) {
        var href = /^https?:\/\//i.test(raw) ? raw : "https://" + raw;
        out += '<a class="memo-link" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(raw) + '</a>';
      } else {
        out += esc(raw);
      }
      out += esc(tail);
      last = m.index + m[0].length;
    }
    return out + esc(s.slice(last));
  }

  function memoListHTML(cat) {
    var items = (cat.memos || []).map(function (m, i) { return { m: m, i: i, t: memoTime(m) }; });
    if (!items.length) {
      return '<p class="muted-empty">아직 메모가 없습니다. 아래 입력창에서 💬 메모를 골라 첫 메모를 남겨 보세요.</p>';
    }
    // 채팅방처럼 시간 오름차순 — 시간이 없는 메모는 맨 위에 둔다.
    items.sort(function (a, b) {
      if (a.t == null && b.t == null) return a.i - b.i;
      if (a.t == null) return -1;
      if (b.t == null) return 1;
      if (a.t !== b.t) return a.t - b.t;
      return a.i - b.i;
    });
    var hidden = memoUi.showAll ? 0 : Math.max(0, items.length - MEMO_LIMIT);
    var shown = items.slice(hidden);
    var html = '<ol class="notes" aria-label="메모 대화">';
    if (hidden) {
      html += '<li class="notes-more"><button type="button" class="more-notes" data-memo-more>이전 메모 ' + hidden + '개 더 보기</button></li>';
    }
    var lastDay = "";
    shown.forEach(function (it) {
      var m = it.m;
      var me = memoWho(m) === "sechan";
      if (it.t != null) {
        var d = new Date(it.t);
        var k = memoDayKey(d);
        if (k !== lastDay) {
          html += '<li class="note-sep">' + esc(memoDayLabel(d)) + '</li>';
          lastDay = k;
        }
      }
      html += '<li class="note ' + (me ? "me" : "them") + '" data-memo-idx="' + it.i + '">' +
        (me ? "" : '<span class="memo-av" aria-hidden="true">클</span>') +
        '<div class="note-col"><p class="note-meta">' +
          '<span class="who">' + (me ? "세찬" : "클피") + '</span>' +
          (it.t != null ? '<time datetime="' + esc(m.at) + '">' + clockLabel(it.t) + '</time>' : "") +
          (me ? '<button type="button" class="note-del" data-memo-del="' + it.i + '" aria-label="메모 삭제">삭제</button>' : "") +
        '</p><div class="bubble">' + memoText(m.text) + '</div></div></li>';
    });
    return html + '</ol>';
  }

  function sectionMemos(cat) {
    var items = cat.memos || [];
    return '<section class="section" id="memo-section">' +
      '<div class="section-head"><h2>💬 메모</h2><span class="muted">' + items.length + '개</span></div>' +
      '<div id="memo-body">' + memoListHTML(cat) + '</div>' +
      '</section>';
  }

  // 메모만 다시 그린다(체크·다른 섹션과 화면 위치를 건드리지 않게).
  function refreshMemos(cat, scrollToNew) {
    if (!cat) return;
    var body = $("memo-body");
    var sec = $("memo-section");
    if (!body || !sec) return;
    body.innerHTML = memoListHTML(cat);
    var cnt = sec.querySelector(".section-head .muted");
    if (cnt) cnt.textContent = (cat.memos || []).length + "개";
    if (!scrollToNew) return;
    var notes = body.querySelectorAll(".note");
    var last = notes[notes.length - 1];
    if (last && last.scrollIntoView) last.scrollIntoView({ block: "nearest" });
  }

  /* ---------- 오답노트 (✍️ 틀린 문장 · 📖 단어장) ---------- */
  var noteUi = { tab: "sentences" };

  function wrongNotesOf(cat) {
    var w = (cat && cat.wrongNotes) || {};
    return {
      sentences: Array.isArray(w.sentences) ? w.sentences : [],
      words: Array.isArray(w.words) ? w.words : []
    };
  }
  function noteDone(list) {
    return list.filter(function (it) { return it.done; }).length;
  }
  function noteTabOf() {
    if (noteUi.tab !== "words") noteUi.tab = "sentences";
    return noteUi.tab;
  }
  function noteCountText(n) {
    return "문장 " + noteDone(n.sentences) + "/" + n.sentences.length +
      " · 단어 " + noteDone(n.words) + "/" + n.words.length;
  }
  function noteDate(it) {
    var d = String((it && it.date) || "");
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? mdLabel(d) : d;
  }
  function noteTabHTML(kind, label, list, current) {
    var on = kind === current;
    return '<button type="button" class="note-tab' + (on ? " on" : "") + '" role="tab" aria-selected="' +
      (on ? "true" : "false") + '" data-note="' + kind + '">' +
      '<span class="nt-label">' + label + '</span>' +
      '<span class="nt-count">' + noteDone(list) + "/" + list.length + '</span>' +
      '</button>';
  }
  function notePanelHTML(n, tab) {
    var list = tab === "words" ? n.words : n.sentences;
    if (!list.length) {
      return '<p class="muted-empty">' + (tab === "words"
        ? "아직 단어장이 비어 있어요. 연습에서 외울 단어가 나오면 클피가 여기에 추가합니다."
        : "아직 기록된 틀린 문장이 없어요. 연습이 끝나면 클피가 여기에 추가합니다.") + '</p>';
    }
    var html = '<ul class="note-list">';
    list.forEach(function (it, i) {
      var id = "wn-" + tab + "-" + i;
      var when = noteDate(it);
      html += '<li class="note-item' + (it.done ? " done" : "") + '">' +
        '<input type="checkbox" id="' + id + '" data-note-done="' + tab + '" data-idx="' + i + '" aria-label="복습 완료"' + (it.done ? " checked" : "") + '>' +
        '<div class="note-body">';
      if (tab === "words") {
        html += '<p class="note-word">' + esc(it.word) + '</p>' +
          (it.meaning ? '<p class="note-meaning">' + esc(it.meaning) + '</p>' : '') +
          (it.example ? '<p class="note-example">' + esc(it.example) + '</p>' : '');
      } else {
        html += '<p class="note-line"><span class="note-mark bad" aria-hidden="true">✕</span>' +
            '<span class="note-wrong">' + esc(it.wrong) + '</span></p>' +
          '<p class="note-line"><span class="note-mark good" aria-hidden="true">✓</span>' +
            '<span class="note-correct">' + esc(it.correct) + '</span></p>' +
          (it.tip ? '<p class="note-tip">' + esc(it.tip) + '</p>' : '');
      }
      html += '</div>' + (when ? '<span class="note-date">' + esc(when) + '</span>' : '') + '</li>';
    });
    html += '</ul>';
    return html;
  }

  function sectionWrongNotes(cat) {
    if (!(cat.id === "ielts" || cat.wrongNotes)) return "";
    var n = wrongNotesOf(cat);
    var tab = noteTabOf();
    return '<section class="section"><div class="section-head"><h2>🗂️ 오답노트</h2>' +
      '<span class="muted" id="note-count">' + noteCountText(n) + '</span></div>' +
      '<div class="note-tabs" id="note-tabs" role="tablist" aria-label="오답노트 종류">' +
        noteTabHTML("sentences", "✍️ 틀린 문장", n.sentences, tab) +
        noteTabHTML("words", "📖 단어장", n.words, tab) +
      '</div>' +
      '<div id="note-panel">' + notePanelHTML(n, tab) + '</div>' +
      '<p class="note-hint">연습이 끝나면 클피가 틀린 문장은 교정 문장으로, 단어는 뜻·예문까지 붙여 여기에 쌓습니다. 왼쪽 체크가 복습 완료 표시입니다.</p>' +
      '</section>';
  }

  function bindNoteBoxes(cat) {
    if (!cat) return;
    var boxes = $("detail-view").querySelectorAll('input[type="checkbox"][data-note-done]');
    Array.prototype.forEach.call(boxes, function (box) {
      box.addEventListener("change", function () {
        var kind = box.getAttribute("data-note-done");
        var idx = parseInt(box.getAttribute("data-idx"), 10);
        var list = (cat.wrongNotes || {})[kind] || [];
        if (!list[idx]) return;
        list[idx].done = box.checked;
        save();
        refreshNotes(cat);
      });
    });
  }

  function refreshNotes(cat) {
    var n = wrongNotesOf(cat);
    var tab = noteTabOf();
    var panel = $("note-panel");
    if (panel) panel.innerHTML = notePanelHTML(n, tab);
    var cnt = $("note-count");
    if (cnt) cnt.textContent = noteCountText(n);
    var tabs = $("note-tabs");
    if (tabs) Array.prototype.forEach.call(tabs.querySelectorAll("[data-note]"), function (b) {
      var kind = b.getAttribute("data-note");
      var on = kind === tab;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
      var c = b.querySelector(".nt-count");
      if (c) {
        var list = kind === "words" ? n.words : n.sentences;
        c.textContent = noteDone(list) + "/" + list.length;
      }
    });
    bindNoteBoxes(cat);
  }

  /* ---------- 가계부 대시보드 (spending.dashboard) ---------- */
  function dashOf(cat) {
    var d = cat && cat.dashboard;
    return (d && typeof d === "object") ? d : null;
  }
  function wonLabel(n) {
    return (n == null || !isFinite(n)) ? "—" : Number(n).toLocaleString("ko-KR") + "원";
  }
  function manShort(n) {
    if (n == null || !isFinite(n)) return "—";
    return (Math.round((n / 10000) * 10) / 10).toFixed(1).replace(/\.0$/, "");
  }
  function monthLabel(m) {
    if (!m) return "";
    if (m.label) return String(m.label);
    var x = String(m.month || "").match(/^(\d{4})-(\d{2})$/);
    return x ? ((+x[2]) + "월") : String(m.month || "");
  }

  function sectionDashboard(cat) {
    var d = dashOf(cat);
    if (!d) return "";
    var meta = d.period || (d.updatedAt ? d.updatedAt + " 갱신" : "");
    var html = '<section class="section dash"><div class="section-head"><h2>💸 가계부 대시보드</h2>' +
      (meta ? '<span class="muted">' + esc(meta) + '</span>' : '') + '</div>';

    if (Array.isArray(d.cards) && d.cards.length) {
      html += '<div class="dash-cards">';
      d.cards.forEach(function (c) {
        if (!c) return;
        html += '<div class="dash-card ' + esc(c.tone || "base") + '">' +
          '<span class="dc-label">' + esc(c.label || "") + '</span>' +
          '<strong class="dc-value">' + esc(c.display || wonLabel(c.value)) + '</strong>' +
          (c.delta ? '<span class="dc-delta">' + esc(c.delta) + '</span>' : '') +
          (c.note ? '<span class="dc-note">' + esc(c.note) + '</span>' : '') +
          '</div>';
      });
      html += '</div>';
    }

    if (Array.isArray(d.months) && d.months.length) {
      html += '<div class="dash-sub"><h3>' + esc(d.monthTitle || "월별 지출 추이") + '</h3>' +
        '<span class="dash-unit">단위: 만 원</span></div>' +
        '<div id="dash-month"></div>' +
        (d.monthNote ? '<p class="dash-note">' + esc(d.monthNote) + '</p>' : '');
    }

    if (Array.isArray(d.categories) && d.categories.length) {
      var total = d.categories.reduce(function (s, c) {
        return s + (c && isFinite(+c.value) ? +c.value : 0);
      }, 0);
      html += '<div class="dash-sub"><h3>' + esc(d.categoryTitle || "카테고리별 지출 비중") + '</h3>' +
        '<span class="dash-unit">합계 ' + manShort(total) + '만 원</span></div><div class="dash-cats">';
      d.categories.forEach(function (c) {
        if (!c) return;
        var v = isFinite(+c.value) ? +c.value : 0;
        var pct = total ? (v / total) * 100 : 0;
        var shown = c.pct != null && isFinite(+c.pct) ? +c.pct : Math.round(pct * 10) / 10;
        html += '<div class="dash-cat"><div class="dash-cat-top">' +
          '<span class="dc-name">' + esc((c.emoji ? c.emoji + " " : "") + (c.label || "")) + '</span>' +
          '<span class="dc-amt">' + wonLabel(v) + '</span>' +
          '<span class="dc-pct">' + shown.toFixed(1) + '%</span>' +
          '</div><div class="dash-cat-bar"><i style="width:' + Math.max(1, pct).toFixed(1) + '%"></i></div></div>';
      });
      html += '</div>' + (d.categoryNote ? '<p class="dash-note">' + esc(d.categoryNote) + '</p>' : '');
    }

    if (Array.isArray(d.groups) && d.groups.length) {
      html += '<div class="dash-sub"><h3>' + esc(d.groupTitle || "지출 성격별 3분류") + '</h3></div>' +
        '<div class="dash-groups">';
      d.groups.forEach(function (g) {
        if (!g) return;
        html += '<div class="dash-group ' + esc(g.tone || "") + '">' +
          '<div class="dg-head"><span class="dg-title">' + esc(g.title || "") + '</span>' +
          '<strong>' + wonLabel(g.total) + '</strong></div>' +
          (g.hint ? '<p class="dg-hint">' + esc(g.hint) + '</p>' : '') + '<ul>';
        (g.items || []).forEach(function (it) {
          if (!it) return;
          html += '<li' + (it.value == null ? ' class="no-val"' : '') + '>' +
            '<span>' + esc(it.label || "") + '</span>' +
            '<b>' + (it.value == null ? esc(it.note || "확인 중") : wonLabel(it.value)) + '</b></li>';
        });
        html += '</ul></div>';
      });
      html += '</div>' + (d.groupNote ? '<p class="dash-note">' + esc(d.groupNote) + '</p>' : '');
    }

    if (d.freshNote) html += '<p class="dash-note dash-fresh">' + esc(d.freshNote) + '</p>';
    return html + '</section>';
  }

  function drawDashMonth() {
    var host = $("dash-month");
    if (!host) return;
    var d = dashOf(currentCat());
    if (!d || !Array.isArray(d.months)) { host.innerHTML = ""; return; }
    var ms = d.months.filter(function (m) { return m && isFinite(+m.value); }).map(function (m) {
      return { label: monthLabel(m), value: +m.value };
    });
    if (!ms.length) { host.innerHTML = ""; return; }
    var budget = (d.budget && isFinite(+d.budget.value) && +d.budget.value > 0) ? +d.budget.value : null;
    var budgetMan = budget ? budget / 10000 : null;

    var W = Math.max(240, Math.round(host.clientWidth || 320));
    var H = 208, padL = 32, padR = 8, padT = 34, padB = 24;
    var iw = W - padL - padR, ih = H - padT - padB;
    var peak = Math.max.apply(null, ms.map(function (m) { return m.value / 10000; }).concat(budgetMan ? [budgetMan] : []));
    var step = peak > 300 ? 100 : 50;
    var top = Math.max(step, Math.ceil(peak / step) * step);
    function Y(v) { return padT + ih - (v / top) * ih; }

    var grid = "", axis = "";
    for (var t = 0; t <= top; t += step) {
      var gy = Y(t);
      grid += '<line x1="' + padL + '" y1="' + gy.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + gy.toFixed(1) + '"/>';
      axis += '<text x="' + (padL - 6) + '" y="' + (gy + 3.2).toFixed(1) + '" text-anchor="end">' + num(t) + '</text>';
    }

    var slot = iw / ms.length;
    var barW = Math.min(44, Math.max(10, slot * 0.56));
    var r = Math.min(5, barW / 2);
    var base = padT + ih;
    var bars = "", vals = "", xlabels = "";
    ms.forEach(function (m, i) {
      var v = m.value / 10000;
      var x = padL + slot * i + (slot - barW) / 2;
      var y = Y(v), last = i === ms.length - 1;
      var dd = 'M' + x.toFixed(1) + ' ' + base.toFixed(1) +
        'L' + x.toFixed(1) + ' ' + (y + r).toFixed(1) +
        'Q' + x.toFixed(1) + ' ' + y.toFixed(1) + ' ' + (x + r).toFixed(1) + ' ' + y.toFixed(1) +
        'L' + (x + barW - r).toFixed(1) + ' ' + y.toFixed(1) +
        'Q' + (x + barW).toFixed(1) + ' ' + y.toFixed(1) + ' ' + (x + barW).toFixed(1) + ' ' + (y + r).toFixed(1) +
        'L' + (x + barW).toFixed(1) + ' ' + base.toFixed(1) + 'Z';
      bars += '<path class="dash-bar' + (last ? " last" : "") + '" data-i="' + i + '" d="' + dd + '"/>';
      vals += '<text class="dash-bar-val' + (last ? " last" : "") + '" x="' + (x + barW / 2).toFixed(1) +
        '" y="' + (y - 5).toFixed(1) + '" text-anchor="middle">' + manShort(m.value) + '</text>';
      xlabels += '<text x="' + (x + barW / 2).toFixed(1) + '" y="' + (H - 7) + '" text-anchor="middle">' + esc(m.label) + '</text>';
    });

    var budgetSvg = "";
    if (budgetMan) {
      var by = Y(budgetMan);
      budgetSvg = '<line class="dash-budget" x1="' + padL + '" y1="' + by.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + by.toFixed(1) + '"/>' +
        '<line class="dash-budget" x1="' + padL + '" y1="12" x2="' + (padL + 16) + '" y2="12"/>' +
        '<text class="dash-budget-label" x="' + (padL + 22) + '" y="15" text-anchor="start">' +
        esc((d.budget.label || "예산") + " " + manShort(budget) + "만") + '</text>';
    }

    var aria = (d.monthTitle || "월별 지출 추이") + " — " + ms.map(function (m) {
      return m.label + " " + manShort(m.value) + "만 원";
    }).join(", ") + (budgetMan ? " / " + (d.budget.label || "예산") + " " + manShort(budget) + "만 원" : "");

    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" preserveAspectRatio="none" role="img" aria-label="' + esc(aria) + '">' +
      '<g class="chart-grid">' + grid + '</g>' +
      budgetSvg + bars + vals +
      '<g class="chart-axis">' + axis + xlabels + '</g>' +
      '</svg>';

    host.innerHTML = '<div class="chart-wrap" id="dash-month-wrap">' + svg +
      '<div class="chart-tip" id="dash-month-tip"></div></div>';

    var wrap = $("dash-month-wrap");
    var svgEl = wrap ? wrap.querySelector("svg") : null;
    var tip = $("dash-month-tip");
    if (!svgEl) return;
    var tipTimer = null;
    function setActive(idx) {
      Array.prototype.forEach.call(svgEl.querySelectorAll(".dash-bar"), function (b) {
        b.classList.toggle("on", +b.getAttribute("data-i") === idx);
      });
    }
    function hideTip() {
      clearTimeout(tipTimer);
      setActive(-1);
      if (tip) tip.classList.remove("on");
    }
    function showTip(idx, sticky) {
      var m = ms[idx];
      if (!m || !tip) return;
      var x = padL + slot * idx + slot / 2;
      var y = Y(m.value / 10000);
      setActive(idx);
      tip.innerHTML = '<b>' + esc(m.label) + '</b> ' + manShort(m.value) + '만 원' +
        '<span class="dash-tip-sub">' + wonLabel(m.value) + '</span>';
      tip.style.left = Math.max(14, Math.min(86, (x / W) * 100)) + '%';
      tip.style.top = Math.max(24, y) + 'px';
      tip.classList.add("on");
      clearTimeout(tipTimer);
      if (sticky) tipTimer = setTimeout(hideTip, 3600);
    }
    function pick(ev) {
      var rect = svgEl.getBoundingClientRect();
      if (!rect.width) return;
      var px = (ev.clientX - rect.left) * (W / rect.width);
      var idx = Math.floor((px - padL) / slot);
      if (idx < 0) idx = 0;
      if (idx > ms.length - 1) idx = ms.length - 1;
      showTip(idx, ev.pointerType !== "mouse");
    }
    svgEl.addEventListener("pointermove", function (ev) {
      if (ev.pointerType === "mouse" || ev.buttons) pick(ev);
    });
    svgEl.addEventListener("pointerdown", pick);
    svgEl.addEventListener("pointerleave", function (ev) {
      if (!ev.pointerType || ev.pointerType === "mouse") hideTip();
    });
    svgEl.addEventListener("pointercancel", hideTip);
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
    var u = s.unit || "원";
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
        ? '<strong>' + (mode === "return" ? signed(ret) : num(last.price) + u) + '</strong>' +
          '<span class="ss-date">' + mdLabel(last.date) + ' 기록 · ' + esc(s.sub || "") + '</span>'
        : '<strong>—</strong>') +
      '</div><div class="chart-toggle" role="tablist" aria-label="그래프 기준">' +
        '<button type="button" data-mode="price" class="' + (mode === "price" ? "on" : "") + '">가격</button>' +
        '<button type="button" data-mode="return"' + (avg ? ' class="' + (mode === "return" ? "on" : "") + '"' : ' disabled title="평단을 기록하면 열립니다"') + '>수익률</button>' +
      '</div></div>';

    var summary = '<div class="ss-grid">' +
      '<div><span>평단</span><strong>' + (avg ? num(avg) + u : "미기록") + '</strong></div>' +
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
      if (!isFinite(span) || span < mx * 0.004) {
        var d0 = Math.max(span, mx * 0.004) || 1;
        mn -= d0; mx += d0;
      }
      else { mn -= span * 0.14; mx += span * 0.14; }
    }
    function X(i) { return pts.length === 1 ? padL + iw / 2 : padL + (i / (pts.length - 1)) * iw; }
    function Y(v) { return padT + ih - ((v - mn) / (mx - mn)) * ih; }
    function valAt(p) { return mode === "return" ? p.price / avg - 1 : p.price; }

    var grid = "", axis = "";
    var rng = mx - mn;
    function axisFmt(v) {
      if (rng < 1) return v.toFixed(2);
      if (rng < 20) return v.toFixed(1);
      return num(Math.round(v));
    }
    for (var t = 0; t <= 4; t++) {
      var gv = mx - (mx - mn) * (t / 4);
      var gy = Y(gv);
      grid += '<line x1="' + padL + '" y1="' + gy.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + gy.toFixed(1) + '"/>';
      axis += '<text x="' + (padL - 7) + '" y="' + (gy + 3.2).toFixed(1) + '" text-anchor="end">' +
        (mode === "return" ? signed(gv, 1) : axisFmt(gv)) + '</text>';
    }

    var avgLine = "";
    if (avg) {
      var ay = Y(mode === "return" ? 0 : avg);
      avgLine = '<line class="chart-avg" x1="' + padL + '" y1="' + ay.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + ay.toFixed(1) + '"/>' +
        '<text class="chart-avg-label" x="' + (W - padR) + '" y="' + (ay - 5).toFixed(1) + '" text-anchor="end">평단 ' + num(avg) + u + '</text>';
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
      tip.innerHTML = '<b>' + mdLabel(p.date) + '</b> ' + num(p.price) + u +
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
    var title = cat.archiveTitle || "🗂️ 날짜별 브리핑 · 긴급속보";
    var html = '<section class="section"><div class="section-head"><h2>' + esc(title) + '</h2><span class="muted">' + total + '건</span></div>';
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
    if (memoUi.catId !== cat.id) { memoUi.showAll = false; memoUi.catId = cat.id; }
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
        '<div class="detail-col">' + sectionReport(cat) + sectionDashboard(cat) + sectionWrongNotes(cat) +
          sectionCharts(cat) +
          (cat.archive ? sectionArchive(cat) : sectionProgress(cat)) + '</div>' +
        '<div class="detail-col">' + sectionTodos(cat) + sectionChecklist(cat) + sectionMemos(cat) + '</div>' +
      '</div>';
    $("detail-view").innerHTML = html;
    drawChart();
    drawDashMonth();

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
    bindNoteBoxes(cat);
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
      var now = new Date();
      memoUi.showAll = true;   // 방금 남긴 메모가 항상 보이도록
      cat.memos.push({
        id: "m" + now.getTime().toString(36) + Math.random().toString(36).slice(2, 6),
        text: text,
        at: now.toISOString(),
        who: "sechan"
      });
    } else if (kind === "todo") {
      cat.todos.push({ text: text, done: false });
    } else if (kind === "check") {
      cat.checklist.push({ text: text, done: false });
    } else {
      cat.progress.push({ date: stamp(), text: text });
    }
    save();
    if (kind === "memo") refreshMemos(cat, true);
    else renderDetail();
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
      // 메모 삭제·이전 메모 펼치기
      var del = e.target.closest("[data-memo-del]");
      if (del) {
        var c0 = currentCat();
        var idx = parseInt(del.getAttribute("data-memo-del"), 10);
        if (c0 && c0.memos && c0.memos[idx]) {
          c0.memos.splice(idx, 1);
          save();
          refreshMemos(c0);
          toast("메모를 지웠어요");
        }
        return;
      }
      var more = e.target.closest("[data-memo-more]");
      if (more) {
        memoUi.showAll = true;
        refreshMemos(currentCat());
        return;
      }
      // 오답노트 탭 전환
      var noteTab = e.target.closest("[data-note]");
      if (noteTab) {
        noteUi.tab = noteTab.getAttribute("data-note");
        refreshNotes(currentCat());
        return;
      }
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
      chartResizeTimer = setTimeout(function () { drawChart(); drawDashMonth(); }, 160);
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

    $("composer-type").addEventListener("change", function () {
      var t = $("composer-type").value;
      $("composer-input").placeholder = t === "memo" ? "메모 남기기…" : "내용을 입력하고 추가를 눌러 주세요";
    });

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
