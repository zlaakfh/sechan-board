/* 세찬 × 클피 워크스페이스 — app.js */
(function () {
  "use strict";

  var STORE_KEY = "sechan-board-state-v1";
  var FALLBACK_PIN = "4827";
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
  function loadState() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return initState();
      var s = JSON.parse(raw);
      if (!s || !Array.isArray(s.categories)) return initState();
      var seed = clone(window.SEED);
      var ids = {};
      s.categories.forEach(function (c) { ids[c.id] = true; });
      seed.categories.forEach(function (c) { if (!ids[c.id]) s.categories.push(c); });
      if (!s.pin) s.pin = defaultPin();
      // 기본 PIN을 바꿨을 때, 사용자가 직접 바꾼 적 없는 기기는 새 기본값을 따른다.
      if (!s.pinCustom && s.pin !== defaultPin()) s.pin = defaultPin();
      if (!Array.isArray(s.deadlines)) s.deadlines = seed.deadlines;
      s.categories.forEach(function (c) {
        c.todos = c.todos || [];
        c.checklist = c.checklist || [];
        c.progress = c.progress || [];
        c.memos = c.memos || [];
        c.report = c.report || {};
      });
      return s;
    } catch (e) {
      return initState();
    }
  }
  function initState() {
    var s = { pin: defaultPin(), categories: clone(window.SEED.categories), deadlines: clone(window.SEED.deadlines) };
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) {}
    return s;
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
  }
  var state = loadState();
  save();

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
        '<div class="detail-col">' + sectionReport(cat) + sectionProgress(cat) + '</div>' +
        '<div class="detail-col">' + sectionTodos(cat) + sectionChecklist(cat) + sectionMemos(cat) + '</div>' +
      '</div>';
    $("detail-view").innerHTML = html;

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
})();
