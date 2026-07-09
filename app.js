/* ===========================================================
   LIFE GRID — full dashboard logic
   Life map by weeks flows TOP -> BOTTOM.
   Click a day -> record tasks. More done tasks => brighter cell.
   Everything persists in localStorage. No backend.
   =========================================================== */

(() => {
  "use strict";

  const KEY = "lifegrid.v2";
  const MS_DAY = 86400000, MS_WEEK = MS_DAY * 7;

  const MONTHS = ["Янв","Фев","Мар","Апр","Май","Июн","Июл","Авг","Сен","Окт","Ноя","Дек"];
  const MONTHS_FULL = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];
  const DOW = ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"];

  // ---------- state ----------
  const defaults = () => ({
    settings: { birthDate: null, lifeExpectancy: 90, userName: "", consciousAge: 8 },
    days: {},          // "YYYY-MM-DD": { tasks:[{id,text,done,time}] }
    notes: "",
    goals: [],         // [{id,text,done}]
    ui: { zoom: 1, scope: "year", view: "grid", gridYear: null, timerPreset: 25 },
  });

  let state = load();
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaults();
      const p = JSON.parse(raw), d = defaults();
      return {
        settings: Object.assign(d.settings, p.settings || {}),
        days: p.days || {},
        notes: p.notes || "",
        goals: p.goals || [],
        ui: Object.assign(d.ui, p.ui || {}),
      };
    } catch { return defaults(); }
  }
  const save = () => localStorage.setItem(KEY, JSON.stringify(state));

  // ---------- date utils ----------
  const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const parse = s => { const [y,m,d] = s.split("-").map(Number); return new Date(y,m-1,d); };
  const addDays = (d,n) => new Date(d.getTime()+n*MS_DAY);
  const sod = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dowMon = d => (d.getDay()+6)%7;         // Monday=0
  const startOfWeek = d => addDays(sod(d), -dowMon(d));
  const today = () => sod(new Date());

  // ---------- task levels ----------
  const dayTasks = k => (state.days[k] && state.days[k].tasks) || [];
  const doneCount = k => dayTasks(k).filter(t => t.done).length;
  function dayLevel(k) {
    const n = doneCount(k);
    if (n <= 0) return 0;
    if (n <= 2) return 1;
    if (n <= 4) return 2;
    if (n <= 6) return 3;
    return 4;
  }
  function weekLevel(weekStart) {
    let tot = 0;
    for (let i=0;i<7;i++) tot += doneCount(iso(addDays(weekStart,i)));
    if (tot<=0) return 0;
    if (tot<=4) return 1;
    if (tot<=9) return 2;
    if (tot<=16) return 3;
    return 4;
  }

  // ---------- model ----------
  let M = {};
  function model() {
    const bd = state.settings.birthDate ? parse(state.settings.birthDate) : null;
    const years = state.settings.lifeExpectancy;
    const origin = bd ? sod(bd) : new Date(2000,0,1);
    M = {
      bd, origin, years, hasBirth: !!bd,
      totalWeeks: Math.round(years * 52.1775),
      totalDays: Math.round(years * 365.25),
    };
    return M;
  }

  // ---------- selection ----------
  let sel = { dayIso: iso(today()) };

  // ---------- element refs ----------
  const $ = id => document.getElementById(id);

  // ===========================================================
  //  GREETING + STATS
  // ===========================================================
  function renderGreeting() {
    const h = new Date().getHours();
    let g = "Доброй ночи";
    if (h >= 5 && h < 12) g = "Доброе утро";
    else if (h >= 12 && h < 18) g = "Добрый день";
    else if (h >= 18 && h < 23) g = "Добрый вечер";
    const name = state.settings.userName ? `, ${state.settings.userName}` : "";
    $("greetTitle").textContent = `${g}${name}!`;

    if (!M.hasBirth) { $("greetDays").textContent = "—"; return; }
    const daysLived = Math.max(0, Math.floor((today() - M.origin)/MS_DAY));
    $("greetDays").textContent = daysLived.toLocaleString("ru");
  }

  function renderStats() {
    const box = $("statgrid");
    if (!M.hasBirth) {
      box.innerHTML = ["Дней прожито","Недель","Месяцев","Лет"]
        .map(l => statCard("📅","—","",l)).join("");
      return;
    }
    const dl = Math.max(0, Math.floor((today()-M.origin)/MS_DAY));
    const wl = Math.max(0, Math.floor((today()-M.origin)/MS_WEEK));
    const ml = Math.max(0, Math.round(dl/30.44));
    const yl = dl/365.25;
    const totalMonths = Math.round(M.years*12);
    box.innerHTML =
      statCard("📅", dl.toLocaleString("ru"), `${yl.toFixed(2)} лет`, "Дней прожито") +
      statCard("🌊", wl.toLocaleString("ru"), `из ${M.totalWeeks.toLocaleString("ru")}`, "Недель") +
      statCard("🗓", ml.toLocaleString("ru"), `из ~${totalMonths.toLocaleString("ru")}`, "Месяцев") +
      statCard("📈", Math.floor(yl), `из ~${M.years}`, "Лет");
  }
  function statCard(ic, value, sub, label) {
    return `<div class="statcard">
      <div class="statcard-top"><span class="label">${label}</span><span class="ic">${ic}</span></div>
      <div class="value">${value}</div>
      <div class="sub">${sub}</div>
    </div>`;
  }

  // ===========================================================
  //  MAIN LIFE GRID  (top -> bottom)
  // ===========================================================
  function renderGrid() {
    document.documentElement.style.setProperty("--zoom", state.ui.zoom);
    $("zoomLabel").textContent = Math.round(state.ui.zoom*100) + "%";
    const wrap = $("lifegridWrap");
    wrap.innerHTML = "";
    if (state.ui.scope === "life") wrap.appendChild(buildLifeGrid());
    else wrap.appendChild(buildYearGrid());
    restoreSelected();
  }

  // ---- ANNUAL VIEW: weeks flow top->bottom, 7 weekday columns ----
  function buildYearGrid() {
    const now = today();
    // year window: current year of life if birth set, else current calendar year Jan..Dec
    let start;
    if (state.ui.gridYear != null && M.hasBirth) {
      start = startOfWeek(addDays(M.origin, state.ui.gridYear * 365.25 | 0));
    } else {
      start = startOfWeek(new Date(now.getFullYear(), now.getMonth() < 6 ? now.getMonth()-6 : now.getMonth()-6, 1));
      // default: last ~52 weeks ending near today, aligned so today sits in view
      start = startOfWeek(addDays(now, -51*7));
    }

    const root = document.createElement("div");
    root.className = "vgrid";

    // weekday header (Пн..Вс)
    const head = document.createElement("div");
    head.className = "vgrid-head";
    DOW.forEach(d => { const s = document.createElement("span"); s.textContent = d; head.appendChild(s); });
    root.appendChild(head);

    const body = document.createElement("div");
    body.className = "vgrid-body";
    const monthsCol = document.createElement("div");
    monthsCol.className = "vgrid-months";
    const rows = document.createElement("div");
    rows.className = "vgrid-rows";

    let lastMonth = -1;
    for (let w = 0; w < 53; w++) {
      const weekStart = addDays(start, w*7);
      // month label: show when the week's Monday enters a new month
      const ml = document.createElement("div");
      ml.className = "month-label";
      if (weekStart.getMonth() !== lastMonth) { ml.textContent = MONTHS[weekStart.getMonth()]; lastMonth = weekStart.getMonth(); }
      monthsCol.appendChild(ml);

      const row = document.createElement("div");
      row.className = "vrow";
      for (let dcol = 0; dcol < 7; dcol++) {
        const d = addDays(weekStart, dcol);
        row.appendChild(makeCell(d, now));
      }
      rows.appendChild(row);
    }
    body.appendChild(monthsCol);
    body.appendChild(rows);
    root.appendChild(body);
    return root;
  }

  // ---- FULL LIFE: rows = years (top->bottom), cols = weeks ----
  function buildLifeGrid() {
    const now = today();
    const curWeek = M.hasBirth ? Math.floor((now - M.origin)/MS_WEEK) : -1;
    const consciousWeeks = Math.round((state.settings.consciousAge || 0) * 52.1775);
    const root = document.createElement("div");
    root.className = "wgrid";
    const cols = 52;
    for (let y = 0; y < M.years; y++) {
      const row = document.createElement("div");
      row.className = "wrow" + (y % 10 === 0 ? " decade" : "");
      const yr = document.createElement("span");
      yr.className = "yr";
      yr.textContent = y % 5 === 0 ? String(y) : "";
      row.appendChild(yr);
      for (let c = 0; c < cols; c++) {
        const idx = y*cols + c;
        const ws = addDays(M.origin, idx*7);
        const cell = document.createElement("div");
        cell.className = "cell";
        cell.dataset.week = idx;
        cell.dataset.date = iso(ws);
        const lv = weekLevel(ws);
        if (lv) cell.dataset.lv = lv;
        if (M.hasBirth) {
          if (idx > curWeek) {
            cell.classList.add("future");           // ещё не прожито
          } else if (!lv) {
            // прожитая неделя без задач: покажем как «прожито»,
            // а детство (до осознанного возраста) — приглушённо
            cell.classList.add(idx < consciousWeeks ? "childhood" : "lived");
          }
          if (idx < consciousWeeks) cell.classList.add("child-band");
          if (idx === curWeek) cell.classList.add("today");
        } else if (!lv) {
          cell.classList.add("lived");
        }
        row.appendChild(cell);
      }
      root.appendChild(row);
    }
    return root;
  }

  function makeCell(d, now) {
    const k = iso(d);
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.dataset.date = k;
    const lv = dayLevel(k);
    if (lv) cell.dataset.lv = lv;
    if (M.hasBirth && d > now) cell.classList.add("future");
    if (M.hasBirth && d < M.origin) cell.classList.add("future");
    if (+d === +now) cell.classList.add("today");
    return cell;
  }

  function restoreSelected() {
    if (state.ui.scope === "life") return;
    const c = $("lifegridWrap").querySelector(`.cell[data-date="${sel.dayIso}"]`);
    if (c) c.classList.add("selected");
  }

  // ===========================================================
  //  TASKS (selected day)
  // ===========================================================
  function selectDay(k) {
    sel.dayIso = k;
    $("lifegridWrap").querySelectorAll(".cell.selected").forEach(c => c.classList.remove("selected"));
    restoreSelected();
    renderTasks();
  }

  function renderTasks() {
    const k = sel.dayIso, d = parse(k), isToday = k === iso(today());
    $("tasksTitle").textContent = isToday ? "Что вы сделали сегодня?"
      : `Что вы сделали — ${d.getDate()} ${MONTHS_FULL[d.getMonth()]} ${d.getFullYear()}?`;
    $("tasksSubtitle").textContent = isToday
      ? "Добавьте задачи по одной. Нет выбора — только ваши слова."
      : `${DOW[dowMon(d)]}, выбранный день. Записывайте, что делали.`;

    const tasks = dayTasks(k).slice().sort(byTime);
    $("tasksBadge").textContent = `${tasks.length} ${plural(tasks.length,"задача","задачи","задач")}`;

    const list = $("taskList");
    list.innerHTML = "";
    tasks.forEach(t => {
      const li = document.createElement("li");
      li.className = "task" + (t.done ? " done" : "");
      li.innerHTML = `<input type="time" class="time-edit" value="${t.time||""}" title="Время (необязательно) — можно изменить">
        <span class="check" title="Отметить выполнение">${t.done?"✓":""}</span>
        <span class="txt" contenteditable="true" spellcheck="false" title="Нажмите, чтобы изменить"></span>
        <button class="del" title="Удалить">✕</button>`;
      li.querySelector(".txt").textContent = t.text;
      li.querySelector(".check").onclick = () => { t.done = !t.done; commit(); };
      li.querySelector(".del").onclick = () => {
        state.days[k].tasks = dayTasks(k).filter(x=>x.id!==t.id); commit();
      };
      const te = li.querySelector(".time-edit");
      te.onchange = () => { t.time = te.value; save(); renderTasks(); };
      const tx = li.querySelector(".txt");
      tx.onblur = () => { const v = tx.textContent.trim(); if (v) t.text = v; else tx.textContent = t.text; save(); };
      tx.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); tx.blur(); } };
      list.appendChild(li);
    });
  }
  function byTime(a, b) {
    if (a.time && b.time) return a.time.localeCompare(b.time);
    if (a.time) return -1; if (b.time) return 1; return 0;
  }

  function commit() {
    const k = sel.dayIso;
    if (state.days[k] && state.days[k].tasks.length === 0) delete state.days[k];
    save();
    renderTasks();
    // live-update grid cell(s)
    updateCellFor(k);
    renderRightbar();
    renderStreakCard();
  }
  function updateCellFor(k) {
    if (state.ui.scope === "life") {
      const ws = startOfWeek(parse(k));
      const idx = Math.round((ws - M.origin)/MS_WEEK);
      const c = $("lifegridWrap").querySelector(`.cell[data-week="${idx}"]`);
      if (c) { const lv = weekLevel(ws); if (lv) c.dataset.lv = lv; else delete c.dataset.lv; }
    } else {
      const c = $("lifegridWrap").querySelector(`.cell[data-date="${k}"]`);
      if (c) { const lv = dayLevel(k); if (lv) c.dataset.lv = lv; else delete c.dataset.lv; }
    }
  }

  function addTask(text, time) {
    const k = sel.dayIso;
    if (!state.days[k]) state.days[k] = { tasks: [] };
    state.days[k].tasks.push({ id: uid(), text, done: true, time: time || "" });
    save(); renderTasks(); updateCellFor(k); renderRightbar(); renderStreakCard();
  }

  // ===========================================================
  //  LIFE OVER TIME (whole life horizontal heatmap)
  // ===========================================================
  function renderOvertime() {
    const wrap = $("overtime");
    wrap.innerHTML = "";
    const now = today();
    const startYear = M.hasBirth ? M.origin.getFullYear() : now.getFullYear()-25;
    const endYear = M.hasBirth ? M.origin.getFullYear() + M.years : now.getFullYear();
    const years = Math.min(95, endYear - startYear + 1);

    const grid = document.createElement("div");
    grid.className = "ot-grid";
    // 7 rows (weekdays), columns = weeks across all years, but we compress to ~ every year one column-block
    // simpler: show 3 label rows (Пн/Ср/Пт) and one cell per week of life
    const rowsToShow = [0,2,4]; // Пн, Ср, Пт
    const labels = ["Пн","Ср","Пт"];
    const weeksTotal = years * 52;

    rowsToShow.forEach((wd, ri) => {
      const row = document.createElement("div");
      row.className = "ot-row";
      const lbl = document.createElement("span");
      lbl.className = "ot-lbl"; lbl.textContent = labels[ri];
      row.appendChild(lbl);
      for (let w = 0; w < weeksTotal; w++) {
        const base = M.hasBirth ? M.origin : new Date(startYear,0,1);
        const day = addDays(startOfWeek(base), w*7 + wd);
        const cell = document.createElement("div");
        cell.className = "ot-cell";
        const lv = dayLevel(iso(day));
        if (lv) cell.dataset.lv = lv;
        cell.dataset.date = iso(day);
        row.appendChild(cell);
      }
      grid.appendChild(row);
    });
    wrap.appendChild(grid);

    // year axis
    const axis = document.createElement("div");
    axis.className = "ot-axis";
    axis.style.width = (weeksTotal*15) + "px";
    for (let y = 0; y <= years; y += 5) {
      const s = document.createElement("span");
      s.textContent = startYear + y;
      s.style.width = (52*15*5) + "px";
      axis.appendChild(s);
    }
    wrap.appendChild(axis);
  }

  // ===========================================================
  //  RIGHT SIDEBAR
  // ===========================================================
  function renderRightbar() {
    renderRing();
    renderAgeList();
    renderMilestones();
    renderStreakList();
    $("expVal").textContent = state.settings.lifeExpectancy;
    $("expRange").value = state.settings.lifeExpectancy;
  }

  function renderRing() {
    if (!M.hasBirth) { $("ringPct").textContent = "—"; $("ringNote").textContent = "Укажите дату рождения"; $("ringFg").style.strokeDashoffset = 327; return; }
    const dl = Math.max(0, (today()-M.origin)/MS_DAY);
    const pct = Math.min(100, (dl / M.totalDays) * 100);
    $("ringPct").textContent = pct.toFixed(1) + "%";
    const C = 2*Math.PI*52;
    $("ringFg").style.strokeDasharray = C;
    $("ringFg").style.strokeDashoffset = C * (1 - pct/100);
    const yearsLeft = Math.max(0, M.years - dl/365.25);
    $("ringNote").textContent = `Впереди ещё ~${Math.round(yearsLeft)} лет`;
  }

  function renderAgeList() {
    const box = $("ageList");
    box.innerHTML = "";
    const decades = M.years <= 90 ? 9 : Math.ceil(M.years/10);
    const dl = M.hasBirth ? Math.max(0,(today()-M.origin)/MS_DAY) : 0;
    for (let i=0;i<decades;i++) {
      const from = i*10, to = from+10;
      const decDays = Math.min(Math.max(dl - from*365.25, 0), 10*365.25);
      const pct = M.totalDays ? (decDays / M.totalDays * 100) : 0;
      const barPct = Math.min(100, decDays/(10*365.25)*100);
      const row = document.createElement("div");
      row.className = "agerow";
      row.innerHTML = `<span class="muted">${from}–${to}</span>
        <span class="abar"><i style="width:${barPct.toFixed(1)}%"></i></span>
        <span class="apct">${pct.toFixed(1)}%</span>`;
      box.appendChild(row);
    }
  }

  function renderMilestones() {
    const box = $("milestones");
    box.innerHTML = "";
    if (!M.hasBirth) { box.innerHTML = `<p class="empty-note">Укажите дату рождения в настройках.</p>`; return; }
    const dl = Math.floor((today()-M.origin)/MS_DAY);
    const items = [
      { ic:"🎯", title:"10 000 дней", day: 10000 },
      { ic:"🎂", title:"30 лет жизни", day: Math.round(30*365.25) },
      { ic:"⏳", title:"50% жизни", day: Math.round(M.totalDays*0.5) },
      { ic:"🏁", title:"100% жизни", day: M.totalDays },
    ];
    items.forEach(it => {
      const left = it.day - dl;
      let sub;
      if (left <= 0) sub = "достигнуто ✓";
      else if (left > 700) sub = `через ~${(left/365.25).toFixed(0)} ${plural(Math.round(left/365.25),"год","года","лет")}`;
      else sub = `через ${left.toLocaleString("ru")} ${plural(left,"день","дня","дней")}`;
      const el = document.createElement("div");
      el.className = "milestone";
      el.innerHTML = `<div class="mic">${it.ic}</div>
        <div><div class="mtitle">${it.title}</div><div class="msub">${sub}</div></div>`;
      box.appendChild(el);
    });
  }

  // ---------- streaks ----------
  function computeStreaks() {
    const keys = Object.keys(state.days).filter(k => doneCount(k) > 0).sort();
    if (!keys.length) return { current: 0, year: 0, all: 0, spark: [] };
    const set = new Set(keys);
    // current streak ending today (or yesterday)
    let current = 0;
    let d = today();
    if (!set.has(iso(d))) d = addDays(d,-1);
    while (set.has(iso(d))) { current++; d = addDays(d,-1); }
    // longest all-time & this year
    let all = 0, run = 0, prev = null, yearBest = 0, yearRun = 0;
    const curYear = today().getFullYear();
    keys.forEach(k => {
      const cur = parse(k);
      if (prev && (cur - prev) === MS_DAY) run++; else run = 1;
      all = Math.max(all, run);
      if (cur.getFullYear() === curYear) { yearRun = (prev && (cur-prev)===MS_DAY && prev.getFullYear()===curYear) ? yearRun+1 : 1; yearBest = Math.max(yearBest, yearRun); }
      prev = cur;
    });
    // last 7 days spark (done counts)
    const spark = [];
    for (let i=6;i>=0;i--) spark.push(doneCount(iso(addDays(today(),-i))));
    return { current, year: yearBest, all, spark };
  }

  function renderStreakCard() {
    const s = computeStreaks();
    $("streakNum").innerHTML = `<b id="sideStreak">${s.current}</b> ${plural(s.current,"день","дня","дней")}`;
    $("streakMsg").textContent = s.current > 0 ? "Ты на верном пути!" : "Начните свою серию сегодня!";
    const spark = $("streakSpark");
    spark.innerHTML = "";
    const max = Math.max(1, ...s.spark);
    s.spark.forEach((v,i) => {
      const b = document.createElement("div");
      b.className = "bar" + (v>=5 ? " hot" : "");
      b.style.height = Math.max(4, (v/max)*40) + "px";
      b.title = `${DOW[dowMon(addDays(today(),-(6-i)))]}: ${v}`;
      spark.appendChild(b);
    });
  }
  function renderStreakList() {
    const s = computeStreaks();
    $("streakList").innerHTML = `
      <div class="streakrow"><span class="muted">Текущая</span><span class="sval">${s.current} ${plural(s.current,"день","дня","дней")}</span></div>
      <div class="streakrow"><span class="muted">В этом году</span><span class="sval">${s.year} ${plural(s.year,"день","дня","дней")}</span></div>
      <div class="streakrow"><span class="muted">За всё время</span><span class="sval">${s.all} ${plural(s.all,"день","дня","дней")}</span></div>`;
  }

  // ===========================================================
  //  OTHER VIEWS
  // ===========================================================
  function switchView(view) {
    state.ui.view = view; save();
    document.querySelectorAll(".nav-item[data-view]").forEach(n => n.classList.toggle("active", n.dataset.view === view));
    const gridView = document.querySelector('.view[data-view="grid"]');
    const other = $("otherView");
    if (view === "grid") { gridView.classList.remove("hidden"); other.classList.add("hidden"); return; }
    gridView.classList.add("hidden"); other.classList.remove("hidden");
    other.innerHTML = renderOtherView(view);
    wireOtherView(view);
  }

  function renderOtherView(view) {
    switch (view) {
      case "stats": return statsHTML();
      case "milestones": return milestonesHTML();
      case "goals": return goalsHTML();
      case "notes": return notesHTML();
      case "timeline": return timelineHTML();
      case "patterns": return patternsHTML();
      case "compare": return comparePlaceholder();
      default: return `<div class="card"><p class="empty-note">Раздел в разработке.</p></div>`;
    }
  }

  function statsHTML() {
    const totalTasks = Object.values(state.days).reduce((a,d)=>a+d.tasks.filter(t=>t.done).length,0);
    const activeDays = Object.keys(state.days).filter(k=>doneCount(k)>0).length;
    const avg = activeDays ? (totalTasks/activeDays).toFixed(1) : "0";
    const s = computeStreaks();
    return `<div class="view-head"><h1>Статистика</h1><p class="muted">Итоги вашей активности.</p></div>
      <div class="statgrid">
        ${statCard("✅", totalTasks.toLocaleString("ru"), "выполнено всего", "Задачи")}
        ${statCard("📆", activeDays.toLocaleString("ru"), "с задачами", "Активные дни")}
        ${statCard("Ø", avg, "в среднем/день", "Продуктивность")}
        ${statCard("🔥", s.all, "рекорд", "Лучшая серия")}
      </div>`;
  }
  function milestonesHTML() {
    return `<div class="view-head"><h1>Вехи</h1><p class="muted">Ключевые рубежи вашей жизни.</p></div>
      <div class="card"><div class="milestones" id="msFull"></div></div>`;
  }
  function goalsHTML() {
    const items = state.goals.map(g => `
      <li class="task ${g.done?"done":""}" data-id="${g.id}">
        <span class="check">${g.done?"✓":""}</span>
        <span class="txt"></span>
        <button class="del">✕</button>
      </li>`).join("");
    return `<div class="view-head"><h1>Цели</h1><p class="muted">Чего вы хотите достичь.</p></div>
      <div class="card">
        <form class="goal-add" id="goalAdd"><input id="goalInput" placeholder="Новая цель…" maxlength="120"><button class="btn primary">Добавить</button></form>
        <ul class="tasklist" id="goalList">${items}</ul>
      </div>`;
  }
  function notesHTML() {
    return `<div class="view-head"><h1>Заметки</h1><p class="muted">Свободное пространство для мыслей. Сохраняется автоматически.</p></div>
      <div class="card"><textarea class="notes-area" id="notesArea" placeholder="Пишите здесь…"></textarea></div>`;
  }
  function timelineHTML() {
    const keys = Object.keys(state.days).filter(k=>dayTasks(k).length).sort().reverse().slice(0,60);
    if (!keys.length) return `<div class="view-head"><h1>Таймлайн</h1></div><div class="card"><p class="empty-note">Пока нет записей. Добавьте задачи в сетке.</p></div>`;
    const body = keys.map(k => {
      const d = parse(k);
      const items = dayTasks(k).map(t => `<li class="task ${t.done?"done":""}"><span class="time">${t.time||""}</span><span class="check">${t.done?"✓":""}</span><span class="txt">${escapeHtml(t.text)}</span></li>`).join("");
      return `<div class="timeline-day"><h4>${d.getDate()} ${MONTHS_FULL[d.getMonth()]} ${d.getFullYear()} · ${DOW[dowMon(d)]}</h4><ul class="tasklist">${items}</ul></div>`;
    }).join("");
    return `<div class="view-head"><h1>Таймлайн</h1><p class="muted">Хронология ваших дней.</p></div><div class="card">${body}</div>`;
  }
  function patternsHTML() {
    // by weekday productivity
    const byDow = [0,0,0,0,0,0,0], cntDow = [0,0,0,0,0,0,0];
    Object.keys(state.days).forEach(k => { const n = doneCount(k); if (n){ const wd = dowMon(parse(k)); byDow[wd]+=n; cntDow[wd]++; } });
    const max = Math.max(1, ...byDow);
    const rows = DOW.map((d,i)=>`<div class="agerow"><span class="muted">${d}</span><span class="abar"><i style="width:${(byDow[i]/max*100).toFixed(0)}%"></i></span><span class="apct">${byDow[i]}</span></div>`).join("");
    return `<div class="view-head"><h1>Паттерны</h1><p class="muted">Ваша продуктивность по дням недели.</p></div>
      <div class="card"><div class="agelist">${rows}</div></div>`;
  }
  function comparePlaceholder() {
    return `<div class="view-head"><h1>Сравнение</h1><p class="muted">Сравнивайте периоды вашей жизни.</p></div>
      <div class="card"><p class="empty-note">Раздел в разработке — здесь появится сравнение недель, месяцев и лет.</p></div>`;
  }

  function wireOtherView(view) {
    if (view === "milestones") { const box = $("msFull"); if (box) { const tmp=$("milestones"); renderMilestones(); box.innerHTML = document.getElementById("milestones").innerHTML; } }
    if (view === "notes") {
      const ta = $("notesArea"); ta.value = state.notes;
      ta.oninput = () => { state.notes = ta.value; save(); };
    }
    if (view === "goals") {
      $("goalAdd").onsubmit = e => { e.preventDefault(); const v = $("goalInput").value.trim(); if(!v) return; state.goals.push({id:uid(),text:v,done:false}); save(); switchView("goals"); };
      $("goalList").querySelectorAll(".task").forEach(li => {
        const id = li.dataset.id, g = state.goals.find(x=>x.id===id);
        li.querySelector(".txt").textContent = g.text;
        li.querySelector(".check").onclick = () => { g.done=!g.done; save(); switchView("goals"); };
        li.querySelector(".del").onclick = () => { state.goals = state.goals.filter(x=>x.id!==id); save(); switchView("goals"); };
      });
    }
  }

  // ===========================================================
  //  REST TIMER
  // ===========================================================
  let timer = { remaining: 25*60, running: false, int: null };
  function fmtTimer(s){ return `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`; }
  function renderTimer(){ $("timerDisplay").textContent = fmtTimer(timer.remaining); }
  function setPreset(min){
    state.ui.timerPreset = min; save();
    timer.remaining = min*60; stopTimer(); renderTimer();
    document.querySelectorAll("#restPresets button").forEach(b => b.classList.toggle("active", +b.dataset.min === min));
  }
  function startTimer(){
    if (timer.running) return;
    timer.running = true;
    timer.int = setInterval(() => {
      timer.remaining--;
      if (timer.remaining <= 0) { timer.remaining = 0; stopTimer(); renderTimer(); toast("⏰ Перерыв окончен!"); return; }
      renderTimer();
    }, 1000);
  }
  function stopTimer(){ timer.running = false; if (timer.int) clearInterval(timer.int); timer.int = null; }

  // ===========================================================
  //  SETTINGS / MODAL
  // ===========================================================
  function openSettings() {
    $("birthDate").value = state.settings.birthDate || "";
    $("expRangeModal").value = state.settings.lifeExpectancy;
    $("expValModal").textContent = state.settings.lifeExpectancy;
    $("userName").value = state.settings.userName || "";
    $("consciousRange").value = state.settings.consciousAge;
    $("consciousVal").textContent = state.settings.consciousAge;
    $("settingsModal").classList.remove("hidden");
  }
  const closeSettings = () => $("settingsModal").classList.add("hidden");

  // ===========================================================
  //  HELPERS
  // ===========================================================
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,6);
  function plural(n, one, few, many) {
    const m10 = n%10, m100 = n%100;
    if (m10===1 && m100!==11) return one;
    if (m10>=2 && m10<=4 && (m100<10||m100>=20)) return few;
    return many;
  }
  function escapeHtml(s){ return s.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
  let toastT;
  function toast(msg){ const t = $("toast"); t.textContent = msg; t.classList.remove("hidden"); clearTimeout(toastT); toastT = setTimeout(()=>t.classList.add("hidden"), 2600); }

  // brand mark dots
  function buildBrand(){
    const bm = $("brandMark");
    const pat = [1,0,1, 0,1,0, 1,0,1];
    bm.innerHTML = "";
    for (let i=0;i<9;i++){ const s = document.createElement("span"); s.style.background = pat[i] ? "var(--lv4)" : "var(--lv2)"; bm.appendChild(s); }
  }

  // ===========================================================
  //  EVENTS
  // ===========================================================
  function wire() {
    // grid click / tooltip
    const wrap = $("lifegridWrap");
    wrap.addEventListener("click", e => {
      const c = e.target.closest(".cell");
      if (!c || c.classList.contains("future") || c.classList.contains("blank")) return;
      if (state.ui.scope === "life") { // clicking a week -> select its representative day (start)
        selectDay(c.dataset.date);
        // switch focus: keep in life view but show tasks for week-start day
        window.scrollTo({ top: document.querySelector('.card:nth-of-type(2)') ? 0 : 0 });
      } else {
        selectDay(c.dataset.date);
      }
    });
    wrap.addEventListener("mousemove", e => {
      const c = e.target.closest(".cell");
      const tip = $("tooltip");
      if (!c || c.classList.contains("blank")) { tip.classList.add("hidden"); return; }
      const k = c.dataset.date, d = parse(k);
      let txt;
      if (state.ui.scope === "life") {
        const ws = startOfWeek(d); let tot=0; for(let i=0;i<7;i++) tot+=doneCount(iso(addDays(ws,i)));
        const wi = M.hasBirth ? Math.round((ws-M.origin)/MS_WEEK)+1 : 0;
        let tag = "";
        if (M.hasBirth) {
          if (c.classList.contains("future")) tag = " · ещё впереди";
          else if (c.classList.contains("child-band")) tag = " · детство";
          else tag = " · прожито";
        }
        txt = `Неделя ${wi}${tag} · <b>${tot}</b> задач<br>${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
      } else {
        txt = `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} · <b>${doneCount(k)}</b> задач`;
      }
      tip.innerHTML = txt;
      tip.style.left = e.clientX + "px"; tip.style.top = e.clientY + "px";
      tip.classList.remove("hidden");
    });
    wrap.addEventListener("mouseleave", () => $("tooltip").classList.add("hidden"));

    // overtime tooltip
    $("overtime").addEventListener("mousemove", e => {
      const c = e.target.closest(".ot-cell"); const tip = $("tooltip");
      if (!c) { tip.classList.add("hidden"); return; }
      const d = parse(c.dataset.date);
      tip.innerHTML = `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} · <b>${doneCount(c.dataset.date)}</b> задач`;
      tip.style.left = e.clientX+"px"; tip.style.top = e.clientY+"px"; tip.classList.remove("hidden");
    });
    $("overtime").addEventListener("mouseleave", () => $("tooltip").classList.add("hidden"));

    // task form
    $("taskForm").addEventListener("submit", e => {
      e.preventDefault();
      const v = $("taskInput").value.trim(); if (!v) return;
      const tm = $("taskTime") ? $("taskTime").value : "";
      addTask(v, tm);
      $("taskInput").value = ""; if ($("taskTime")) $("taskTime").value = "";
    });

    // scope / range
    $("scope").addEventListener("change", e => { state.ui.scope = e.target.value; save(); renderGrid(); scrollToCurrent(); });
    $("rangeSelect").addEventListener("change", renderStats);
    $("timeGranularity").addEventListener("change", renderOvertime);

    // zoom
    $("zoomIn").onclick = () => setZoom(state.ui.zoom+0.1);
    $("zoomOut").onclick = () => setZoom(state.ui.zoom-0.1);

    // today
    $("todayBtn").onclick = () => {
      if (!M.hasBirth) { openSettings(); return; }
      if (state.ui.scope !== "year") { state.ui.scope="year"; $("scope").value="year"; save(); renderGrid(); }
      selectDay(iso(today()));
      const c = $("lifegridWrap").querySelector(".cell.today"); if (c) c.scrollIntoView({behavior:"smooth",block:"center"});
    };
    $("addTaskQuick").onclick = () => { switchView("grid"); $("taskInput").focus(); };
    $("calBtn").onclick = () => { state.ui.scope = state.ui.scope==="life"?"year":"life"; $("scope").value = state.ui.scope; save(); renderGrid(); scrollToCurrent(); };

    // nav
    document.querySelectorAll(".nav-item[data-view]").forEach(n => n.onclick = () => switchView(n.dataset.view));
    $("openSettings").onclick = openSettings;
    $("exportNav").onclick = doExport;
    $("aboutNav").onclick = () => toast("LIFE GRID · карта вашей жизни. Данные хранятся локально.");
    $("allStatsBtn").onclick = () => switchView("stats");

    // menu toggle (mobile)
    $("menuToggle").onclick = () => $("sidebar").classList.toggle("open");

    // rest timer
    $("timerStart").onclick = startTimer;
    $("timerPause").onclick = stopTimer;
    $("timerPlus").onclick = () => { timer.remaining += 60; renderTimer(); };
    $("timerMinus").onclick = () => { timer.remaining = Math.max(0, timer.remaining-60); renderTimer(); };
    document.querySelectorAll("#restPresets button").forEach(b => b.onclick = () => setPreset(+b.dataset.min));

    // expectancy (right sidebar)
    $("expRange").addEventListener("input", e => { $("expVal").textContent = e.target.value; });
    $("expRange").addEventListener("change", e => { state.settings.lifeExpectancy = +e.target.value; save(); renderAll(); });
    $("editExp").onclick = openSettings;

    // settings modal
    $("settingsClose").onclick = closeSettings;
    $("settingsModal").addEventListener("click", e => { if (e.target === $("settingsModal")) closeSettings(); });
    $("birthDate").addEventListener("change", e => { state.settings.birthDate = e.target.value || null; save(); renderAll(); });
    $("expRangeModal").addEventListener("input", e => { $("expValModal").textContent = e.target.value; });
    $("expRangeModal").addEventListener("change", e => { state.settings.lifeExpectancy = +e.target.value; save(); renderAll(); });
    $("userName").addEventListener("change", e => { state.settings.userName = e.target.value.trim(); save(); renderGreeting(); updateAvatar(); });
    $("consciousRange").addEventListener("input", e => { $("consciousVal").textContent = e.target.value; });
    $("consciousRange").addEventListener("change", e => { state.settings.consciousAge = +e.target.value; save(); renderGrid(); });
    $("avatar").onclick = openSettings;

    // export/import/reset
    $("exportBtn").onclick = doExport;
    $("importBtn").onclick = () => $("importFile").click();
    $("importFile").addEventListener("change", e => {
      const f = e.target.files[0]; if(!f) return;
      const r = new FileReader();
      r.onload = () => { try { state = Object.assign(defaults(), JSON.parse(r.result)); save(); location.reload(); } catch { toast("Не удалось прочитать файл."); } };
      r.readAsText(f); e.target.value = "";
    });
    $("resetBtn").onclick = () => { if(confirm("Удалить все данные и настройки?")) { localStorage.removeItem(KEY); location.reload(); } };

    $("howCount").onclick = () => toast("Каждая выполненная задача повышает яркость дня: 0 → 1–2 → 3–4 → 5–6 → 7+.");

    document.addEventListener("keydown", e => { if (e.key === "Escape") closeSettings(); });
  }

  function scrollToCurrent() {
    if (!M.hasBirth) return;
    const c = $("lifegridWrap").querySelector(".cell.today");
    if (c) c.scrollIntoView({ block: "center" });
  }
  function setZoom(z) {
    state.ui.zoom = Math.min(2, Math.max(0.6, Math.round(z*10)/10));
    document.documentElement.style.setProperty("--zoom", state.ui.zoom);
    $("zoomLabel").textContent = Math.round(state.ui.zoom*100)+"%";
    save();
  }
  function doExport() {
    const blob = new Blob([JSON.stringify(state,null,2)], {type:"application/json"});
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `lifegrid-${iso(new Date())}.json`; a.click(); URL.revokeObjectURL(a.href);
    toast("Данные экспортированы.");
  }
  function updateAvatar(){ $("avatar").textContent = (state.settings.userName||"U").trim().charAt(0).toUpperCase() || "U"; }

  // ===========================================================
  //  RENDER ALL / INIT
  // ===========================================================
  function renderAll() {
    model();
    renderGreeting();
    renderStats();
    renderGrid();
    renderTasks();
    renderOvertime();
    renderRightbar();
    renderStreakCard();
    updateAvatar();
    $("scope").value = state.ui.scope;
  }

  function init() {
    buildBrand();
    model();
    renderTimer(); setPreset(state.ui.timerPreset || 25);
    wire();
    renderAll();
    switchView(state.ui.view || "grid");
    if (M.hasBirth && state.ui.scope === "year") {
      const c = $("lifegridWrap").querySelector(".cell.today");
      if (c) c.scrollIntoView({ block: "center" });
    }
    if (!state.settings.birthDate) openSettings();
  }

  init();
})();
