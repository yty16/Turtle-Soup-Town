/* =============================================================
 * 海龟汤小镇 —— 互动游戏逻辑
 * 纯前端，无依赖，可离线运行。
 * ============================================================= */
(function () {
  "use strict";

  // 隐藏署名令牌（配置用途，非明文展示）
  var _token = "eXR5MTY="; // base64

  var SAVE_KEY = "turtle_soup_save_v1";

  var ANS = {
    yes: { t: "是", cls: "yes" },
    no: { t: "否", cls: "no" },
    both: { t: "是也不是", cls: "both" },
    irrelevant: { t: "不重要", cls: "irrelevant" }
  };

  function loadSave() {
    try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function persist() { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); }

  var save = loadSave();
  if (!save.progress) save.progress = {};
  if (!save.custom) save.custom = [];
  if (!save.favorites) save.favorites = [];

  // 规范化所有进度条目，兼容旧版本（提问次数限制功能之前）留下的缺字段数据
  function normalizeProgressEntry(p) {
    if (!p || typeof p !== "object") p = {};
    if (!Array.isArray(p.asked)) p.asked = [];
    if (!Array.isArray(p.answered)) p.answered = [];
    if (!Array.isArray(p.guesses)) p.guesses = [];
    if (typeof p.hintsUsed !== "number" || p.hintsUsed < 0) p.hintsUsed = 0;
    if (typeof p.revealed !== "boolean") p.revealed = false;
    if (typeof p.status !== "string") p.status = "playing";
    // 旧数据里 asked 可能不是 {q,a} 结构，统一清洗成对象
    p.asked = p.asked.map(function (x) {
      if (x && typeof x === "object") return x;
      return { q: "" + (x == null ? "" : x), a: "irrelevant", guide: false, note: "" };
    }).filter(function (x) { return x && x.q; });
    return p;
  }
  function normalizeProgress() {
    var prog = save.progress || {};
    Object.keys(prog).forEach(function (id) { prog[id] = normalizeProgressEntry(prog[id]); });
  }
  normalizeProgress();
  persist();

  function allSoups() { return (window.SOUPS || []).concat(save.custom); }
  function getSoup(id) { return allSoups().filter(function (s) { return s.id === id; })[0]; }
  function libraryActive() { return document.getElementById("view-library").classList.contains("active"); }
  function isFav(id) { return (save.favorites || []).indexOf(id) !== -1; }
  function toggleFav(id) {
    var arr = save.favorites;
    var i = arr.indexOf(id);
    if (i === -1) { arr.push(id); toast("已加入收藏 ★"); }
    else { arr.splice(i, 1); toast("已取消收藏"); }
    persist();
    refreshHome();
    if (libraryActive()) renderLibrary();
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function toast(msg) {
    var t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove("show"); }, 1800);
  }

  /* ---------------- 导航 ---------------- */
  var VIEWS = { home: "view-home", library: "view-library", game: "view-game", add: "view-add", about: "view-about" };
  function showView(name) {
    // 离开游戏页时，清掉直达汤的 hash（避免刷新后仍停在已退出的汤）
    if (name !== "game" && location.hash && location.hash.indexOf("#soup=") === 0) {
      history.replaceState(null, "", location.pathname + location.search);
    }
    Object.keys(VIEWS).forEach(function (k) {
      document.getElementById(VIEWS[k]).classList.remove("active");
    });
    document.getElementById(VIEWS[name]).classList.add("active");
    document.querySelectorAll("[data-view]").forEach(function (a) {
      a.classList.toggle("active", a.dataset.view === name);
    });
    if (name === "home") refreshHome();
    if (name === "library") renderLibrary();
    if (name === "about") document.getElementById("about-version").textContent = (window.META || {}).version || "";
    window.scrollTo(0, 0);
  }

  document.querySelectorAll("[data-view]").forEach(function (el) {
    el.addEventListener("click", function (e) { e.preventDefault(); showView(el.dataset.view); });
  });

  /* ---------------- 首页 ---------------- */
  function refreshHome() {
    document.getElementById("stat-total").textContent = allSoups().length;
    var cleared = 0;
    Object.keys(save.progress).forEach(function (k) {
      if (save.progress[k].status === "cleared") cleared++;
    });
    document.getElementById("stat-cleared").textContent = cleared;
    document.getElementById("stat-custom").textContent = save.custom.length;
    document.getElementById("stat-fav").textContent = (save.favorites || []).length;
  }

  document.getElementById("btn-random").addEventListener("click", function () {
    var list = allSoups();
    if (!list.length) { toast("暂无汤可玩"); return; }
    var s = list[Math.floor(Math.random() * list.length)];
    startGame(s.id);
  });

  /* ---------------- 汤库 ---------------- */
  var libFilter = { diff: "all", kind: "all", tag: "all", status: "all", fav: false, q: "" };

  function kindClass(k) {
    if (k === "红汤") return "k-red";
    if (k === "黑汤") return "k-black";
    if (k === "白汤") return "k-white";
    if (k === "本格汤") return "k-ben";
    if (k === "变格汤") return "k-bian";
    return "";
  }
  function kindBadges(s) {
    return (s.kind || []).map(function (k) {
      return '<span class="tag ' + kindClass(k) + '">' + esc(k) + "</span>";
    }).join("");
  }

  // 计算一锅汤的游玩状态类别：none / playing / cleared / timeout / revealed
  function statusOf(soup) {
    var p = save.progress[soup.id];
    if (!p) return "none";
    if (p.status === "cleared") return "cleared";
    if (p.status === "timeout") return "timeout";
    if (p.status === "revealed") return "revealed";
    if (p.asked && p.asked.length) return "playing";
    return "none";
  }
  function statusText(cat) {
    if (cat === "cleared") return "✅ 已通关";
    if (cat === "timeout") return "⏰ 超时通关";
    if (cat === "revealed") return "👁 已揭示";
    if (cat === "playing") return "🟡 进行中";
    return "⚪ 未开始";
  }

  function renderTags() {
    var tags = {};
    allSoups().forEach(function (s) {
      (s.tags || []).forEach(function (t) {
        t = String(t).replace(/[\s\u3000\u200b\u200c\u200d\ufeff]/g, "").trim();
        if (t) tags[t] = 1;
      });
    });
    var box = document.getElementById("tag-filters");
    var html = '<span class="chip" data-tag="all">全部标签</span>';
    Object.keys(tags).sort().forEach(function (t) { html += '<span class="chip" data-tag="' + esc(t) + '">' + esc(t) + "</span>"; });
    box.innerHTML = html;
    box.querySelectorAll(".chip").forEach(function (c) {
      if (c.dataset.tag === libFilter.tag) c.classList.add("active");
      c.addEventListener("click", function () {
        box.querySelectorAll(".chip").forEach(function (x) { x.classList.remove("active"); });
        c.classList.add("active");
        libFilter.tag = c.dataset.tag;
        renderLibrary();
      });
    });
  }

  function renderLibrary() {
    renderTags();
    var grid = document.getElementById("soup-grid");
    var q = libFilter.q.trim().toLowerCase();
    var list = allSoups().filter(function (s) {
      if (libFilter.diff !== "all" && String(s.difficulty) !== libFilter.diff) return false;
      if (libFilter.kind !== "all" && (s.kind || []).indexOf(libFilter.kind) === -1) return false;
      if (libFilter.tag !== "all" && !(s.tags || []).some(function (t) { return String(t).trim() === libFilter.tag; })) return false;
      if (libFilter.status !== "all" && statusOf(s) !== libFilter.status) return false;
      if (libFilter.fav && save.favorites.indexOf(s.id) === -1) return false;
      if (q && s.title.toLowerCase().indexOf(q) === -1 && s.surface.toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    if (!list.length) { grid.innerHTML = '<p style="color:var(--ink-soft)">没有匹配的汤，换个条件试试～</p>'; return; }
    grid.innerHTML = list.map(function (s) {
      var st = statusText(statusOf(s));
      var isCustom = s.id.indexOf("custom_") === 0;
      var faved = isFav(s.id);
      var actions = isCustom ?
        '<div class="soup-actions"><button class="btn ghost small" data-act="edit">✏️ 编辑</button>' +
        '<button class="btn ghost small" data-act="del">🗑 删除</button></div>' : "";
      return '<div class="card soup-card' + (faved ? " faved" : "") + '" data-id="' + s.id + '">' +
        '<div class="card-top"><h3>' + esc(s.title) + (isCustom ? ' <span class="tag k-ben">私房</span>' : "") + '</h3>' +
        '<div class="card-tools">' +
          '<button class="icon-btn fav-btn" data-fav-btn="' + s.id + '" title="收藏 / 取消收藏">' + (faved ? "★" : "☆") + "</button>" +
          '<button class="icon-btn share-btn" data-share-btn="' + s.id + '" title="分享">分享</button>' +
        "</div></div>" +
        '<div class="meta"><span class="diff">' + "★".repeat(s.difficulty || 1) + "</span> · 难度 " + (s.difficulty || 1) + ' · <span class="status-badge">' + st + "</span></div>" +
        '<div class="surface">' + esc(s.surface) + "</div>" +
        '<div style="margin-top:8px">' + kindBadges(s) + (s.tags || []).map(function (t) { return '<span class="tag">' + esc(t) + "</span>"; }).join("") + "</div>" +
        actions +
        "</div>";
    }).join("");
    grid.querySelectorAll(".soup-card").forEach(function (c) {
      c.addEventListener("click", function () { startGame(c.dataset.id); });
      c.querySelectorAll("[data-act]").forEach(function (b) {
        b.addEventListener("click", function (e) {
          e.stopPropagation();
          if (b.dataset.act === "edit") editSoup(c.dataset.id);
          else if (b.dataset.act === "del") deleteSoup(c.dataset.id);
        });
      });
      c.querySelectorAll("[data-fav-btn]").forEach(function (b) {
        b.addEventListener("click", function (e) {
          e.stopPropagation();
          toggleFav(b.dataset.favBtn);
        });
      });
      c.querySelectorAll("[data-share-btn]").forEach(function (b) {
        b.addEventListener("click", function (e) {
          e.stopPropagation();
          openShare(b.dataset.shareBtn);
        });
      });
    });
  }

  document.getElementById("search-input").addEventListener("input", function (e) {
    libFilter.q = e.target.value; renderLibrary();
  });
  document.querySelectorAll(".chip[data-diff]").forEach(function (c) {
    c.addEventListener("click", function () {
      document.querySelectorAll(".chip[data-diff]").forEach(function (x) { x.classList.remove("active"); });
      c.classList.add("active");
      libFilter.diff = c.dataset.diff;
      renderLibrary();
    });
  });
  document.querySelectorAll("#kind-filters .chip[data-kind]").forEach(function (c) {
    c.addEventListener("click", function () {
      document.querySelectorAll("#kind-filters .chip").forEach(function (x) { x.classList.remove("active"); });
      c.classList.add("active");
      libFilter.kind = c.dataset.kind;
      renderLibrary();
    });
  });

  var kindHelpBtn = document.getElementById("kind-help-btn");
  var kindHelpPanel = document.getElementById("kind-help-panel");
  if (kindHelpBtn && kindHelpPanel) {
    kindHelpBtn.addEventListener("click", function () {
      var open = !kindHelpPanel.hasAttribute("hidden");
      if (open) { kindHelpPanel.setAttribute("hidden", ""); }
      else { kindHelpPanel.removeAttribute("hidden"); }
    });
  }

  // 游玩状态筛选
  document.querySelectorAll("#status-filters .chip[data-status]").forEach(function (c) {
    c.addEventListener("click", function () {
      document.querySelectorAll("#status-filters .chip").forEach(function (x) { x.classList.remove("active"); });
      c.classList.add("active");
      libFilter.status = c.dataset.status;
      renderLibrary();
    });
  });

  // 只看收藏筛选
  var favChip = document.querySelector("#fav-filters [data-fav]");
  if (favChip) {
    favChip.addEventListener("click", function () {
      var on = !favChip.classList.contains("active");
      favChip.classList.toggle("active", on);
      libFilter.fav = on;
      renderLibrary();
    });
  }

  /* ---------------- 游戏 ---------------- */
  function isRestricted(soup) {
    var k = soup.kind || [];
    return k.indexOf("红汤") >= 0 || k.indexOf("黑汤") >= 0;
  }

  var pendingWarnId = null;

  function startGame(id) {
    var soup = getSoup(id);
    if (!soup) { toast("找不到这锅汤"); return; }
    // 红汤 / 黑汤：每次打开前都需确认适龄提示
    if (isRestricted(soup)) {
      openWarn(id);
      return;
    }
    proceedGame(id);
  }

  function proceedGame(id) {
    var soup = getSoup(id);
    if (!soup) { toast("找不到这锅汤"); return; }
    if (!save.progress[id]) {
      save.progress[id] = { status: "playing", asked: [], answered: [], hintsUsed: 0, guesses: [], revealed: false };
    } else {
      save.progress[id] = normalizeProgressEntry(save.progress[id]);
    }
    // 写入直达链接 hash（不刷新页面）；离开游戏页时会被清掉
    if (("" + location.hash) !== "#soup=" + encodeURIComponent(id)) {
      location.hash = "soup=" + encodeURIComponent(id);
    }
    showView("game");
    renderGame(soup);
  }

  function openWarn(id) {
    pendingWarnId = id;
    var ov = document.getElementById("warn-overlay");
    if (ov) ov.removeAttribute("hidden");
  }
  function closeWarn() {
    var ov = document.getElementById("warn-overlay");
    if (ov) ov.setAttribute("hidden", "");
    pendingWarnId = null;
  }
  (function bindWarn() {
    var ov = document.getElementById("warn-overlay");
    if (!ov) return;
    document.getElementById("warn-cancel").addEventListener("click", function () {
      closeWarn();
      toast("已取消进入");
    });
    document.getElementById("warn-confirm").addEventListener("click", function () {
      var id = pendingWarnId;
      closeWarn();
      if (!id) return;
      proceedGame(id);
    });
    // 点击遮罩或按 Esc 视为取消（不进入）
    ov.addEventListener("click", function (e) { if (e.target === ov) closeWarn(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !ov.hasAttribute("hidden")) closeWarn();
    });
  })();

  function guardLimit(soup) {
    var p = save.progress[soup.id];
    if (p.limit && p.asked.length >= p.limit) {
      appendHost({
        a: "irrelevant",
        guide: true,
        note: "提问次数已用完（共 " + p.limit + " 次），你已超时。仍可点「🔍 揭示汤底」查看真相，但会记为超时通关，不算成功通关。"
      });
      return false;
    }
    return true;
  }

  function updateLimLeft(soup) {
    var p = save.progress[soup.id];
    var el = document.getElementById("lim-left");
    if (!el) return;
    var input = document.getElementById("ask-input");
    var send = document.getElementById("ask-send");
    var inspireBtns = document.querySelectorAll("#inspire-area .q-btn");
    var notice = document.getElementById("timeout-notice");
    if (p.limit) {
      var left = Math.max(0, p.limit - (p.asked || []).length);
      el.textContent = "还能问 " + left + " 次";
      var done = left <= 0;
      if (input) { input.disabled = done; input.style.opacity = done ? ".5" : "1"; }
      if (send) send.disabled = done;
      inspireBtns.forEach(function (b) { if (!b.disabled || b.style.opacity !== ".5") b.disabled = done; });
      // 超时的常驻提示（提问仍可用「揭示汤底」，但不算成功通关）
      if (done && notice && p.status !== "timeout") {
        notice.hidden = false;
        notice.innerHTML = "⏰ 提问次数已用完，你已<b>超时</b>。仍可点「🔍 揭示汤底」查看真相，但会记为<b>超时通关</b>，不算成功通关。";
      } else if (notice && !done) {
        notice.hidden = true;
      }
    } else {
      el.textContent = "🔓 不限制";
      if (input) { input.disabled = false; input.style.opacity = "1"; }
      if (send) send.disabled = false;
      if (notice) notice.hidden = true;
      // 还原已问过的灵感按钮状态（由 restore 负责禁用）
      inspireBtns.forEach(function (b) {
        var askedSet = {};
        (p.asked || []).forEach(function (x) { askedSet[x.q] = 1; });
        if (askedSet[b.textContent]) { b.disabled = true; b.style.opacity = ".5"; }
        else { b.disabled = false; b.style.opacity = "1"; }
      });
    }
  }

  function renderGame(soup) {
    var p = save.progress[soup.id];
    // 新开的汤（尚未提问过）默认采用该汤自己的建议提问次数；已开始过的旧进度保留原设定
    if (p.limit === undefined && (!p.asked || !p.asked.length)) {
      p.limit = suggestLimit(soup);
    }
    var box = document.getElementById("game-content");
    var hintLeft = (soup.hints || []).length - p.hintsUsed;
    box.innerHTML =
      '<div class="card game-head"><button class="btn ghost small" id="g-back">← 返回汤库</button>' +
      '<button class="btn ghost small" id="g-fav">' + (isFav(soup.id) ? "★ 已收藏" : "☆ 收藏") + '</button>' +
      '<button class="btn ghost small" id="g-share">🔗 分享</button>' +
      "<h2>" + esc(soup.title) + '</h2><span class="diff">' + "★".repeat(soup.difficulty || 1) + " 难度" + (soup.difficulty || 1) + "</span>" + kindBadges(soup) + "</div>" +
      '<div class="card">' +
        '<div class="surface-box">' + esc(soup.surface) + "</div>" +
        '<div class="limit-set">' +
          '<label class="lbl"><input type="checkbox" id="lim-on" ' + (p.limit ? "checked" : "") + '/> 🎯 限定提问次数</label>' +
          '<input type="number" id="lim-num" min="1" max="999" value="' + (p.limit || 20) + '" ' + (p.limit ? "" : "disabled style=\"opacity:.5\"" ) + ' /> <span class="unit">次</span>' +
          '<span class="lim-left" id="lim-left">' + (p.limit ? ("还能问 " + Math.max(0, p.limit - p.asked.length) + " 次") : "🔓 不限制") + "</span>" +
        "</div>" +
        '<div class="timeout-notice" id="timeout-notice" hidden></div>' +
        '<div class="key-progress" id="key-progress" hidden></div>' +
        '<div class="chat" id="chat"></div>' +
        '<div class="ask-row"><input id="ask-input" placeholder="向主持人提问（尽量用能用是/否回答的问题）…" /><button class="btn" id="ask-send">提问</button></div>' +
        '<div class="actions">' +
          '<button class="btn ghost small" id="btn-hint">💡 要个提示 (<span id="hint-left">' + hintLeft + "</span>)</button>" +
          '<button class="btn ghost small" id="btn-guess">📝 记一下我的推理</button>' +
          '<button class="btn accent small" id="btn-reveal">🔍 揭示汤底</button>' +
        "</div>" +
        '<div class="clear-banner" id="clear-banner" hidden></div>' +
        '<div id="hint-area"></div>' +
        '<div class="inspire" id="inspire-area"></div>' +
        '<div class="guess-box hidden" id="guess-area"><textarea id="guess-input" placeholder="写下你推理出的完整故事…"></textarea><button class="btn small" id="guess-save">保存推理</button><div class="guess-list" id="guess-list"></div></div>' +
        '<div class="bottom-box hidden" id="bottom-area"></div>' +
      "</div>";

    document.getElementById("g-back").addEventListener("click", function () { showView("library"); });

    document.getElementById("g-fav").addEventListener("click", function () {
      toggleFav(soup.id);
      document.getElementById("g-fav").textContent = isFav(soup.id) ? "★ 已收藏" : "☆ 收藏";
      refreshHome();
    });
    document.getElementById("g-share").addEventListener("click", function () { openShare(soup.id); });

    var chat = document.getElementById("chat");
    var input = document.getElementById("ask-input");

    function send() {
      var v = input.value.trim();
      if (!v) return;
      if (!guardLimit(soup)) return;
      input.value = "";
      ask(soup, v);
      updateLimLeft(soup);
    }
    document.getElementById("ask-send").addEventListener("click", send);
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") send(); });

    // 提示
    document.getElementById("btn-hint").addEventListener("click", function () {
      if (p.hintsUsed >= (soup.hints || []).length) { toast("没有更多提示啦"); return; }
      var h = soup.hints[p.hintsUsed];
      p.hintsUsed++;
      persist();
      var area = document.getElementById("hint-area");
      var div = document.createElement("div");
      div.className = "hint-box";
      div.innerHTML = '<span class="h">💡 提示 ' + p.hintsUsed + "</span><p class=\"hi\">" + esc(h) + "</p>";
      area.appendChild(div);
      document.getElementById("hint-left").textContent = (soup.hints || []).length - p.hintsUsed;
      scrollChat();
    });

    // 记推理
    document.getElementById("btn-guess").addEventListener("click", function () {
      document.getElementById("guess-area").classList.toggle("hidden");
    });
    document.getElementById("guess-save").addEventListener("click", function () {
      var g = document.getElementById("guess-input").value.trim();
      if (!g) { toast("先写点什么吧"); return; }
      p.guesses.push(g);
      persist();
      document.getElementById("guess-input").value = "";
      renderGuesses();
      toast("已记录你的推理");
    });

    // 揭示（手动看答案，不算成功通关；若提问次数已用完则记为超时通关）
    document.getElementById("btn-reveal").addEventListener("click", function () {
      if (!confirm("确定要揭示汤底吗？这会影响推理乐趣哦。")) return;
      p.revealed = true;
      var exhausted = p.limit && p.asked.length >= p.limit;
      p.status = exhausted ? "timeout" : "revealed";
      persist();
      showBottom(soup);
      if (exhausted) {
        var notice = document.getElementById("timeout-notice");
        if (notice) {
          notice.hidden = false;
          notice.innerHTML = "⏰ <b>超时通关</b>：提问次数已用完，你选择查看了汤底。这次不算成功通关哦。";
        }
      }
    });

    // 限定提问次数
    var limOn = document.getElementById("lim-on");
    var limNum = document.getElementById("lim-num");
    var limLeft = document.getElementById("lim-left");
    function syncLimit() {
      if (limOn.checked) {
        var n = parseInt(limNum.value, 10);
        if (isNaN(n) || n < 1) { n = 1; limNum.value = "1"; }
        p.limit = n;
        limNum.disabled = false; limNum.style.opacity = "1";
      } else {
        p.limit = null;
        limNum.disabled = true; limNum.style.opacity = ".5";
      }
      persist();
      updateLimLeft(soup);
    }
    limOn.addEventListener("change", syncLimit);
    limNum.addEventListener("input", syncLimit);
    updateLimLeft(soup);

    // 灵感提问
    renderInspire(soup);

    // 恢复进度
    restore(soup);
  }

  function scrollChat() {
    var chat = document.getElementById("chat");
    if (chat) chat.scrollTop = chat.scrollHeight;
  }

  function appendUser(text) {
    var chat = document.getElementById("chat");
    var d = document.createElement("div");
    d.className = "msg user";
    d.textContent = text;
    chat.appendChild(d);
    scrollChat();
  }

  function appendHost(entry) {
    var chat = document.getElementById("chat");
    var d = document.createElement("div");
    d.className = "msg host";
    var ans = ANS[entry.a] || ANS.irrelevant;
    // 主持人只回答标准词，备注仅用于引导语（不剧透汤底）
    d.innerHTML = '<span class="ans ' + ans.cls + '">' + ans.t + "</span>" +
      (entry.guide && entry.note ? '<span class="note">' + esc(entry.note) + "</span>" : "");
    chat.appendChild(d);
    scrollChat();
  }

  function ask(soup, text) {
    appendUser(text);
    var p = save.progress[soup.id];
    var lower = text.toLowerCase();
    var hit = null, hitIdx = -1;
    (soup.qa || []).forEach(function (e, idx) {
      if (hit) return;
      (e.k || []).forEach(function (kw) {
        if (hit) return;
        if (lower.indexOf(kw.toLowerCase()) !== -1) { hit = e; hitIdx = idx; }
      });
    });
    if (hit) {
      appendHost(hit);
      p.asked.push({ q: text, a: hit.a });
      if (p.answered.indexOf(hitIdx) === -1) p.answered.push(hitIdx);
    } else {
      appendHost({
        a: "irrelevant",
        guide: true,
        note: "主持人的回答只能是：是 / 否 / 是也不是 / 不重要。这个问题我暂时无法判定，换个更具体的角度试试，或点下方的「灵感提问」破冰。"
      });
      // 未命中的提问同样计数并保存（刷新后可还原）
      p.asked.push({ q: text, a: "irrelevant", guide: true });
    }
    p.status = "playing";
    persist();
    checkClear(soup);
  }

  // 中性万能灵感模板：扫描该汤 surface/bottom/qa，按 pos/neg/def 判定 yes/no/不重要
  // 只把「汤面 + 汤底 + 答"是"的问句」作为正向信号，「答"否"的问句」作为负向信号，
  // 避免被反问/假设句（如"他是被谋杀的吗？否"）带偏造成误判。
  function detectUniversal(soup, t) {
    var yesQ = (soup.qa || []).filter(function (e) { return e.a === "yes"; })
      .map(function (e) { return e.q; }).join(" ");
    var noQ = (soup.qa || []).filter(function (e) { return e.a === "no"; })
      .map(function (e) { return e.q; }).join(" ");
    var posHay = (soup.surface || "") + " " + (soup.bottom || "") + " " + yesQ;
    var negHay = (soup.surface || "") + " " + (soup.bottom || "") + " " + noQ;
    var pos = (t.pos || []).some(function (k) { return posHay.indexOf(k) !== -1; });
    var neg = (t.neg || []).some(function (k) { return negHay.indexOf(k) !== -1; });
    if (pos && !neg) return "yes";
    if (neg && !pos) return "no";
    return t.def || "irrelevant";
  }

  function renderInspire(soup) {
    var area = document.getElementById("inspire-area");
    // 所有汤共用中性万能模板，不剧透任何一锅的具体情节
    var pool = (window.UNIVERSAL_INSPIRE || []);
    var list = pool.map(function (t) { return { q: t.q, a: detectUniversal(soup, t) }; });
    if (!list.length) { area.innerHTML = ""; return; }
    var html = '<div class="label">💭 灵感提问（点一下直接向主持人发问，万能中性破冰）：</div><div class="questions">';
    list.forEach(function (item, i) {
      html += '<button class="q-btn" data-i="' + i + '">' + esc(item.q) + "</button>";
    });
    html += "</div>";
    area.innerHTML = html;
    area.querySelectorAll(".q-btn").forEach(function (b) {
      b.addEventListener("click", function () {
        if (!guardLimit(soup)) return;
        var item = list[Number(b.dataset.i)];
        appendUser(item.q);
        appendHost({ a: item.a });
        var p = save.progress[soup.id];
        // src=inspire：灵感提问不计入核心真相推理进度
        p.asked.push({ q: item.q, a: item.a, src: "inspire" });
        persist();
        updateLimLeft(soup);
        checkClear(soup);
        b.disabled = true; b.style.opacity = ".5";
      });
    });
  }

  function renderGuesses() {
    var p = save.progress[currentId];
    var list = document.getElementById("guess-list");
    if (!list) return;
    var arr = (p && p.guesses) || [];
    list.innerHTML = arr.map(function (g) { return '<div class="g">' + esc(g) + "</div>"; }).join("");
  }

  function showBottom(soup) {
    var area = document.getElementById("bottom-area");
    area.classList.remove("hidden");
    area.innerHTML = "<h3>🍲 汤底（完整真相）</h3><div class=\"text\">" + esc(soup.bottom) + "</div>";
    var rb = document.getElementById("btn-reveal");
    if (rb) rb.disabled = true;
  }

  function showClearBanner(text) {
    var el = document.getElementById("clear-banner");
    if (!el) return;
    el.textContent = text;
    el.removeAttribute("hidden");
  }

  // 取一道汤的「关键情节」解锁词分组。优先用该汤自带 keys（数量随汤实际 2~4 不等），
  // 其次用 SOUP_KEYS，最后回退为每条预设问答的关键词。
  function getKeys(soup) {
    if (soup.keys && soup.keys.length) return soup.keys;
    var k = (window.SOUP_KEYS && window.SOUP_KEYS[soup.id]) || null;
    if (k && k.length) return k;
    return (soup.qa || []).map(function (e) { return (e.k && e.k.length) ? e.k : [e.q]; });
  }

  // 一道汤的「建议提问次数」：优先用该汤自带 limit（每汤各不相同），否则按难度与汤种派生。
  function suggestLimit(soup) {
    if (soup.limit) return soup.limit;
    var d = soup.difficulty || 2;
    var base = 6 + d * 2; // 8 / 10 / 12 / 14 / 16
    var k = soup.kind || [];
    if (k.indexOf("红汤") >= 0 || k.indexOf("变格汤") >= 0) base += 2;
    return Math.max(6, Math.min(20, base));
  }

  // 计算关键情节推理进度：玩家「自己输入」的提问文本命中某组任一关键词
  // 即解锁该情节；灵感提问（src=inspire）只提供线索，不计入推理进度
  function computeClear(soup) {
    var p = save.progress[soup.id] || { asked: [] };
    var keys = getKeys(soup);
    if (!keys.length) return { done: false, total: 0, got: 0 };
    var texts = (p.asked || [])
      .filter(function (x) { return !x.src; })
      .map(function (x) { return (x.q || "").toLowerCase(); });
    var got = 0;
    keys.forEach(function (group) {
      var unlocked = group.some(function (kw) {
        kw = (kw || "").toLowerCase();
        return texts.some(function (t) { return t.indexOf(kw) !== -1; });
      });
      if (unlocked) got++;
    });
    return { done: got >= keys.length, total: keys.length, got: got };
  }

  function updateKeyProgress(soup) {
    var el = document.getElementById("key-progress");
    if (!el) return;
    var r = computeClear(soup);
    if (!r.total) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = "核心真相 <b>" + r.got + " / " + r.total + "</b> 已推理" +
      (r.done ? " · 已通关" : "（推理出全部关键情节即可自动揭晓汤底）");
  }

  // 当玩家推理出全部关键情节时，通关并自动揭晓汤底
  function checkClear(soup) {
    var r = computeClear(soup);
    if (r.done) {
      var p = save.progress[soup.id];
      if (!p.revealed) {
        p.revealed = true; p.status = "cleared"; persist();
        showBottom(soup);
      }
      showClearBanner("🎉 通关成功！你已推理出全部 " + r.total + " 个关键情节，汤底已自动揭晓。");
    }
    updateKeyProgress(soup);
    return r;
  }

  function restore(soup) {
    currentId = soup.id;
    var p = save.progress[soup.id];
    // 已问答
    (p.asked || []).forEach(function (item) {
      appendUser(item.q);
      appendHost({ a: item.a, guide: item.guide, note: item.note });
    });
    // 已用提示
    var ha = document.getElementById("hint-area");
    for (var i = 0; i < p.hintsUsed; i++) {
      var div = document.createElement("div");
      div.className = "hint-box";
      div.innerHTML = '<span class="h">💡 提示 ' + (i + 1) + '</span><p class="hi">' + esc((soup.hints || [])[i] || "") + "</p>";
      ha.appendChild(div);
    }
    // 推理
    renderGuesses();
    // 已揭示
    if (p.revealed) {
      showBottom(soup);
      if (p.status === "cleared") {
        showClearBanner("🎉 通关成功！你已推理出全部 " + computeClear(soup).total + " 个关键情节，汤底已自动揭晓。");
      } else if (p.status === "timeout") {
        var tnotice = document.getElementById("timeout-notice");
        if (tnotice) {
          tnotice.hidden = false;
          tnotice.innerHTML = "⏰ <b>超时通关</b>：提问次数已用完，你查看了汤底。这次不算成功通关。";
        }
      }
    }
    // 禁用已点过的灵感
    if (p.asked) {
      var askedSet = {};
      p.asked.forEach(function (x) { askedSet[x.q] = 1; });
      document.querySelectorAll("#inspire-area .q-btn").forEach(function (b) {
        if (askedSet[b.textContent]) { b.disabled = true; b.style.opacity = ".5"; }
      });
    }
    updateLimLeft(soup);
    updateKeyProgress(soup);
  }

  var currentId = null;

  /* ---------------- 添加汤 ---------------- */
  function parseLines(str) {
    return (str || "").split(/\n/).map(function (s) { return s.trim(); }).filter(Boolean);
  }
  function parseTags(str) {
    return (str || "").split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean);
  }
  function parseQA(str) {
    var out = [];
    parseLines(str).forEach(function (line) {
      var parts = line.split("|").map(function (s) { return s.trim(); });
      if (parts.length < 3) return;
      var a = parts[2];
      if (!ANS[a]) a = "irrelevant";
      out.push({
        q: parts[0],
        k: parts[1].split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean),
        a: a,
        note: parts[3] || ""
      });
    });
    return out;
  }

  var editingId = null;

  function clearSoupForm() {
    document.getElementById("f-title").value = "";
    document.getElementById("f-surface").value = "";
    document.getElementById("f-bottom").value = "";
    document.getElementById("f-tags").value = "";
    document.getElementById("f-hints").value = "";
    document.getElementById("f-qa").value = "";
    document.getElementById("f-diff").value = "2";
    document.querySelectorAll("#f-kinds input").forEach(function (cb) { cb.checked = (cb.value === "本格汤"); });
  }

  function editSoup(id) {
    var s = getSoup(id);
    if (!s) return;
    editingId = id;
    document.getElementById("f-title").value = s.title || "";
    document.getElementById("f-surface").value = s.surface || "";
    document.getElementById("f-bottom").value = s.bottom || "";
    document.getElementById("f-diff").value = String(s.difficulty || 2);
    document.querySelectorAll("#f-kinds input").forEach(function (cb) {
      cb.checked = (s.kind || []).indexOf(cb.value) !== -1;
    });
    document.getElementById("f-tags").value = (s.tags || []).join(", ");
    document.getElementById("f-hints").value = (s.hints || []).join("\n");
    document.getElementById("f-qa").value = (s.qa || []).map(function (e) {
      return [e.q, (e.k || []).join(","), e.a, e.note || ""].join(" | ");
    }).join("\n");
    document.getElementById("btn-save-soup").textContent = "保存修改";
    showView("add");
    window.scrollTo(0, 0);
  }

  function deleteSoup(id) {
    var s = getSoup(id);
    if (!s) return;
    if (!confirm("确定删除私房汤《" + (s.title || "") + "》吗？此操作不可撤销。")) return;
    save.custom = save.custom.filter(function (x) { return x.id !== id; });
    delete save.progress[id];
    if (editingId === id) { editingId = null; document.getElementById("btn-save-soup").textContent = "保存这锅汤"; }
    persist();
    toast("已删除");
    renderLibrary();
  }

  document.getElementById("btn-save-soup").addEventListener("click", function () {
    var title = document.getElementById("f-title").value.trim();
    var surface = document.getElementById("f-surface").value.trim();
    var bottom = document.getElementById("f-bottom").value.trim();
    if (!title || !surface || !bottom) { toast("汤名、汤面、汤底都要填哦"); return; }
    var kinds = [];
    document.querySelectorAll("#f-kinds input:checked").forEach(function (c) { kinds.push(c.value); });
    if (!kinds.length) kinds = ["本格汤"];
    var soup = {
      id: editingId || ("custom_" + Date.now()),
      title: title,
      surface: surface,
      bottom: bottom,
      difficulty: Number(document.getElementById("f-diff").value) || 2,
      kind: kinds,
      tags: parseTags(document.getElementById("f-tags").value),
      hints: parseLines(document.getElementById("f-hints").value),
      qa: parseQA(document.getElementById("f-qa").value)
    };
    if (editingId) {
      var idx = -1;
      save.custom.forEach(function (x, i) { if (x.id === editingId) idx = i; });
      if (idx !== -1) save.custom[idx] = soup;
      editingId = null;
      document.getElementById("btn-save-soup").textContent = "保存这锅汤";
      persist();
      toast("已更新私房汤 🐢");
    } else {
      save.custom.push(soup);
      persist();
      toast("已保存你的私房汤 🐢");
    }
    clearSoupForm();
    showView("library");
  });

  // 进入“添加汤”时，若处于编辑态则复位
  document.querySelector('[data-view="add"]').addEventListener("click", function () {
    if (editingId) {
      editingId = null;
      document.getElementById("btn-save-soup").textContent = "保存这锅汤";
    }
  });

  document.getElementById("btn-export").addEventListener("click", function () {
    var data = { app: "turtle_soup", version: (window.META || {}).version || "", custom: save.custom };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = "turtle_soup_data.json"; a.click();
    URL.revokeObjectURL(url);
    toast("已导出全部数据");
  });

  document.getElementById("btn-import").addEventListener("click", function () {
    document.getElementById("import-file").click();
  });
  document.getElementById("import-file").addEventListener("change", function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        var arr = data.custom || [];
        var added = 0;
        arr.forEach(function (c) {
          if (!c || !c.id || !c.title || !c.surface || !c.bottom) return;
          var exist = save.custom.filter(function (x) { return x.id === c.id; })[0];
          if (exist) { Object.assign(exist, c); } else { save.custom.push(c); }
          added++;
        });
        persist();
        toast("已导入 " + added + " 锅汤");
        showView("library");
      } catch (err) { toast("导入失败：文件格式不对"); }
    };
    reader.readAsText(file);
    e.target.value = "";
  });

  /* ---------------- 收藏 / 分享 ---------------- */
  var currentShareId = null;

  // 生成某锅汤的直达链接（基于当前页面地址 + #soup=<id>）
  function shareUrl(id) {
    return (location.origin + location.pathname) + "#soup=" + encodeURIComponent(id);
  }

  function openShare(id) {
    currentShareId = id;
    var overlay = document.getElementById("share-overlay");
    if (!overlay) return;
    var linkInput = document.getElementById("share-link");
    if (linkInput) linkInput.value = shareUrl(id);
    setShareDefault();
    overlay.removeAttribute("hidden");
    genShareText();
  }
  function closeShare() {
    var overlay = document.getElementById("share-overlay");
    if (overlay) overlay.setAttribute("hidden", "");
  }
  function setShareDefault() {
    var defs = { surface: true, qa: true, status: true, hints: false, guesses: false, bottom: false };
    document.querySelectorAll("#share-overlay [data-share]").forEach(function (cb) {
      cb.checked = !!defs[cb.dataset.share];
    });
  }
  function genShareText() {
    var soup = getSoup(currentShareId);
    var ta = document.getElementById("share-text");
    if (!soup || !ta) return;
    var p = save.progress[currentShareId] || {};
    var opts = {};
    document.querySelectorAll("#share-overlay [data-share]").forEach(function (cb) { opts[cb.dataset.share] = cb.checked; });
    var L = [];
    L.push("【海龟汤小镇 · 分享】");
    L.push("🍲 汤名：" + soup.title);
    if (opts.surface) {
      L.push("");
      L.push("📖 汤面：");
      L.push(soup.surface);
    }
    if (opts.qa) {
      L.push("");
      L.push("💬 我的提问与回答：");
      if (p.asked && p.asked.length) {
        p.asked.forEach(function (x) {
          L.push("· Q：" + x.q);
          L.push("  A：" + (ANS[x.a] || ANS.irrelevant).t + (x.note ? "（" + x.note + "）" : ""));
        });
      } else {
        L.push("（暂无提问记录）");
      }
    }
    if (opts.hints) {
      L.push("");
      L.push("💡 已用过的提示：");
      if (p.hintsUsed > 0) {
        for (var i = 0; i < (p.hintsUsed || 0); i++) L.push((i + 1) + ". " + ((soup.hints || [])[i] || ""));
      } else {
        L.push("（暂无使用提示）");
      }
    }
    if (opts.guesses) {
      L.push("");
      L.push("📝 我的推理：");
      if (p.guesses && p.guesses.length) {
        p.guesses.forEach(function (g) { L.push("· " + g); });
      } else {
        L.push("（暂无推理记录）");
      }
    }
    if (opts.status) {
      L.push("");
      L.push("📊 当前进度：" + statusText(statusOf(soup)));
      var r = computeClear(soup);
      if (r.total) L.push("核心真相 " + r.got + " / " + r.total + " 已推理");
    }
    if (opts.bottom) {
      L.push("");
      L.push("🥣 汤底（剧透）：");
      L.push(soup.bottom);
    }
    // 直达链接：无论勾选了什么，都附上这锅汤的跳转链接
    L.push("");
    L.push("🔗 直达这锅汤：" + shareUrl(currentShareId));
    ta.value = L.join("\n");
  }

  function copyText(txt) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(function () { toast("已复制分享文本"); }, function () { fallbackCopy(); });
    } else { fallbackCopy(); }
  }
  function fallbackCopy() {
    var ta = document.getElementById("share-text");
    ta.removeAttribute("readonly");
    ta.focus(); ta.select();
    try { document.execCommand("copy"); toast("已复制分享文本"); }
    catch (e) { toast("复制失败，请手动选择文本复制"); }
    ta.setAttribute("readonly", "");
    try { window.getSelection().removeAllRanges(); } catch (e) {}
  }

  (function bindShareModal() {
    var overlay = document.getElementById("share-overlay");
    if (!overlay) return;
    document.getElementById("share-close").addEventListener("click", closeShare);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) closeShare(); });
    overlay.querySelectorAll("[data-share]").forEach(function (cb) {
      cb.addEventListener("change", genShareText);
    });
    document.getElementById("share-copy").addEventListener("click", function () {
      copyText(document.getElementById("share-text").value);
    });
    var copyLinkBtn = document.getElementById("share-copy-link");
    if (copyLinkBtn) {
      copyLinkBtn.addEventListener("click", function () {
        var inp = document.getElementById("share-link");
        if (inp) copyText(inp.value);
      });
    }
    document.getElementById("share-download").addEventListener("click", function () {
      var soup = getSoup(currentShareId);
      var blob = new Blob([document.getElementById("share-text").value], { type: "text/plain;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url; a.download = "海龟汤分享_" + (soup ? soup.title : "soup") + ".txt";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast("已下载分享文本");
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !overlay.hasAttribute("hidden")) closeShare();
    });
  })();

  /* ---------------- 启动 ---------------- */
  refreshHome();
  var bootHash = "" + location.hash;
  if (bootHash.indexOf("#soup=") === 0) {
    var sid = decodeURIComponent(bootHash.slice(6));
    if (getSoup(sid)) {
      startGame(sid);
    } else {
      showView("home");
    }
  } else {
    showView("home");
  }
})();
