/* ===========================================================
   LIFE GRID — life-in-weeks map, GitHub style
   Time flows top -> bottom (one row per year of life).
   Click a week -> open its 7 days -> record what you did.
   More completed tasks => brighter day => brighter week.
   Data persists in localStorage. No backend.
   =========================================================== */

(() => {
  "use strict";

  const STORAGE_KEY = "lifegrid.v1";
  const MS_DAY = 86400000;
  const MS_WEEK = MS_DAY * 7;

  // ---- default state ----
  const defaultState = () => ({
    settings: {
      birthDate: null,          // "YYYY-MM-DD"
      lifeExpectancy: 90,
    },
    // days keyed by ISO date "YYYY-MM-DD" -> { tasks: [{id, text, done}] }
    days: {},
    ui: { zoom: 1 },
  });

  let state = load();

  // ---- persistence ----
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      return Object.assign(defaultState(), parsed, {
        settings: Object.assign(defaultState().settings, parsed.settings || {}),
        ui: Object.assign(defaultState().ui, parsed.ui || {}),
        days: parsed.days || {},
      });
    } catch {
      return defaultState();
    }
  }
  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  // ---- date helpers ----
  function isoDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  function parseISO(s) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  function addDays(d, n) { return new Date(d.getTime() + n * MS_DAY); }
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

  const MONTHS = ["янв","фев","мар","апр","май","июн","июл","авг","сен","окт","ноя","дек"];
  const DOW = ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"];

  function fmtRange(start, end) {
    const s = `${start.getDate()} ${MONTHS[start.getMonth()]}`;
    const e = `${end.getDate()} ${MONTHS[end.getMonth()]} ${end.getFullYear()}`;
    return `${s} — ${e}`;
  }

  // ---- task level mapping (GitHub-like 0..4) ----
  function dayTasks(iso) {
    const rec = state.days[iso];
    return rec && rec.tasks ? rec.tasks : [];
  }
  function dayDoneCount(iso) {
    return dayTasks(iso).filter(t => t.done).length;
  }
  // level for a single day, based on completed tasks
  function dayLevel(iso) {
    const n = dayDoneCount(iso);
    if (n <= 0) return 0;
    if (n <= 2) return 1;
    if (n <= 4) return 2;
    if (n <= 6) return 3;
    return 4;
  }
  // level for a week = brightness from total completed tasks across its 7 days
  function weekLevel(weekStart) {
    let total = 0, any = false;
    for (let i = 0; i < 7; i++) {
      const iso = isoDate(addDays(weekStart, i));
      const n = dayDoneCount(iso);
      if (dayTasks(iso).length) any = true;
      total += n;
    }
    if (total <= 0) return any ? 0 : 0;
    if (total <= 4) return 1;
    if (total <= 9) return 2;
    if (total <= 16) return 3;
    return 4;
  }

  // ===========================================================
  //  ELEMENTS
  // ===========================================================
  const el = {
    gridInner: document.getElementById("gridInner"),
    gridScroll: document.getElementById("gridScroll"),
    gridSubtitle: document.getElementById("gridSubtitle"),
    stats: document.getElementById("stats"),
    lifeFill: document.getElementById("lifeFill"),
    lifeProgressText: document.getElementById("lifeProgressText"),
    lifeRemainingText: document.getElementById("lifeRemainingText"),

    detailEmpty: document.getElementById("detailEmpty"),
    detailBody: document.getElementById("detailBody"),
    weekTitle: document.getElementById("weekTitle"),
    weekRange: document.getElementById("weekRange"),
    dayTabs: document.getElementById("dayTabs"),
    dayTitle: document.getElementById("dayTitle"),
    dayCount: document.getElementById("dayCount"),
    taskList: document.getElementById("taskList"),
    taskForm: document.getElementById("taskForm"),
    taskInput: document.getElementById("taskInput"),
    weekPrev: document.getElementById("weekPrev"),
    weekNext: document.getElementById("weekNext"),

    zoomIn: document.getElementById("zoomIn"),
    zoomOut: document.getElementById("zoomOut"),
    zoomLabel: document.getElementById("zoomLabel"),
    jumpTodayBtn: document.getElementById("jumpTodayBtn"),

    settingsBtn: document.getElementById("settingsBtn"),
    settingsModal: document.getElementById("settingsModal"),
    settingsClose: document.getElementById("settingsClose"),
    birthDate: document.getElementById("birthDate"),
    lifeExpectancy: document.getElementById("lifeExpectancy"),
    lifeExpVal: document.getElementById("lifeExpVal"),
    exportBtn: document.getElementById("exportBtn"),
    importBtn: document.getElementById("importBtn"),
    importFile: document.getElementById("importFile"),
    resetBtn: document.getElementById("resetBtn"),

    tooltip: document.getElementById("tooltip"),
  };

  // ===========================================================
  //  SELECTION STATE
  // ===========================================================
  let selected = { weekStart: null, dayIso: null }; // dates

  // Grid model, computed from birthDate + lifeExpectancy
  let model = null;
  function buildModel() {
    const bd = state.settings.birthDate ? parseISO(state.settings.birthDate) : null;
    const years = state.settings.lifeExpectancy;
    // week 0 starts at birth date (or default Jan 1 2000 if unset)
    const origin = bd ? startOfDay(bd) : new Date(2000, 0, 1);
    const totalWeeks = Math.round((years * 52.1775)); // avg weeks/year
    model = { origin, years, totalWeeks, weeksPerRow: 52, hasBirth: !!bd };
    return model;
  }

  function weekStartByIndex(i) {
    return addDays(model.origin, i * 7);
  }
  function todayWeekIndex() {
    const now = startOfDay(new Date());
    const diff = Math.floor((now - model.origin) / MS_WEEK);
    return diff;
  }

  // ===========================================================
  //  RENDER: GRID
  // ===========================================================
  function renderGrid() {
    buildModel();
    document.documentElement.style.setProperty("--zoom", state.ui.zoom);

    const frag = document.createDocumentFragment();
    const now = startOfDay(new Date());
    const curWeekIdx = model.hasBirth ? todayWeekIndex() : -1;
    const cols = model.weeksPerRow;
    const rows = model.years;

    for (let year = 0; year < rows; year++) {
      const row = document.createElement("div");
      row.className = "grid-row" + (year % 10 === 0 ? " decade" : "");

      const label = document.createElement("span");
      label.className = "year-label";
      label.textContent = year % 5 === 0 ? String(year) : "";
      row.appendChild(label);

      for (let c = 0; c < cols; c++) {
        const idx = year * cols + c;
        const cell = document.createElement("div");
        cell.className = "week";
        const ws = weekStartByIndex(idx);
        cell.dataset.idx = idx;

        const lv = weekLevel(ws);
        if (lv) cell.dataset.lv = lv;

        // future / today marking only meaningful when birth date set
        if (model.hasBirth) {
          if (idx > curWeekIdx) cell.classList.add("future");
          if (idx === curWeekIdx) cell.classList.add("today");
        }
        row.appendChild(cell);
      }
      frag.appendChild(row);
    }
    el.gridInner.innerHTML = "";
    el.gridInner.appendChild(frag);
    restoreSelectionHighlight();
  }

  function restoreSelectionHighlight() {
    if (!selected.weekStart) return;
    const selIdx = Math.round((selected.weekStart - model.origin) / MS_WEEK);
    const cell = el.gridInner.querySelector(`.week[data-idx="${selIdx}"]`);
    if (cell) cell.classList.add("selected");
  }

  // ===========================================================
  //  RENDER: STATS + PROGRESS
  // ===========================================================
  function renderStats() {
    const box = el.stats;
    if (!model.hasBirth) {
      el.gridSubtitle.textContent = "Укажите дату рождения в настройках ⚙, чтобы привязать сетку к вашей жизни.";
      box.innerHTML = statCard("—", "", "Дней прожито")
        + statCard("—", "", "Недель прожито")
        + statCard(String(model.years), "", "Лет всего")
        + statCard("0%", "", "Прожито жизни");
      el.lifeFill.style.width = "0%";
      el.lifeProgressText.textContent = "Дата рождения не указана";
      el.lifeRemainingText.textContent = "";
      return;
    }
    el.gridSubtitle.textContent = "Каждая ячейка — одна неделя. Время течёт сверху вниз.";

    const now = startOfDay(new Date());
    const daysLived = Math.max(0, Math.floor((now - model.origin) / MS_DAY));
    const weeksLived = Math.max(0, Math.floor((now - model.origin) / MS_WEEK));
    const yearsLived = daysLived / 365.25;
    const totalDays = model.years * 365.25;
    const pct = Math.min(100, (daysLived / totalDays) * 100);

    box.innerHTML =
      statCard(daysLived.toLocaleString("ru"), "", "Дней прожито")
      + statCard(weeksLived.toLocaleString("ru"), `из ${model.totalWeeks.toLocaleString("ru")}`, "Недель прожито")
      + statCard(yearsLived.toFixed(1), "лет", "Возраст")
      + statCard(pct.toFixed(1) + "%", "", "Прожито жизни", true);

    el.lifeFill.style.width = pct.toFixed(2) + "%";
    el.lifeProgressText.textContent = `Прожито ${pct.toFixed(1)}% отведённого времени`;
    const weeksLeft = Math.max(0, model.totalWeeks - weeksLived);
    el.lifeRemainingText.textContent = `≈ ${weeksLeft.toLocaleString("ru")} недель впереди`;
  }
  function statCard(num, small, lbl, accent) {
    return `<div class="stat">
      <div class="num${accent ? " accent" : ""}">${num}${small ? ` <small>${small}</small>` : ""}</div>
      <div class="lbl">${lbl}</div>
    </div>`;
  }

  // ===========================================================
  //  RENDER: DETAIL (week -> days -> tasks)
  // ===========================================================
  function selectWeek(weekStart, keepDay) {
    selected.weekStart = startOfDay(weekStart);
    if (!keepDay) {
      // default to today if it falls inside the week, else first day
      const today = startOfDay(new Date());
      const offset = Math.floor((today - selected.weekStart) / MS_DAY);
      selected.dayIso = (offset >= 0 && offset < 7)
        ? isoDate(today)
        : isoDate(selected.weekStart);
    }
    el.detailEmpty.classList.add("hidden");
    el.detailBody.classList.remove("hidden");
    renderDetail();

    // highlight in grid
    el.gridInner.querySelectorAll(".week.selected").forEach(w => w.classList.remove("selected"));
    restoreSelectionHighlight();
  }

  function renderDetail() {
    const ws = selected.weekStart;
    const we = addDays(ws, 6);

    // week number since birth (1-based) if birth set
    let title = "Неделя";
    if (model.hasBirth) {
      const wi = Math.round((ws - model.origin) / MS_WEEK) + 1;
      const ageYears = Math.floor((wi - 1) / 52);
      title = `Неделя ${wi} · возраст ${ageYears}`;
    }
    el.weekTitle.textContent = title;
    el.weekRange.textContent = fmtRange(ws, we);

    // day tabs
    const today = isoDate(startOfDay(new Date()));
    el.dayTabs.innerHTML = "";
    for (let i = 0; i < 7; i++) {
      const d = addDays(ws, i);
      const iso = isoDate(d);
      const lv = dayLevel(iso);
      const tab = document.createElement("button");
      tab.className = "daytab"
        + (iso === selected.dayIso ? " active" : "")
        + (iso === today ? " is-today" : "")
        + (model.hasBirth && d > startOfDay(new Date()) ? " future" : "");
      tab.innerHTML = `
        <div class="dow">${DOW[i]}</div>
        <div class="dom">${d.getDate()}</div>
        <div class="dot"${lv ? ` data-lv="${lv}"` : ""}></div>`;
      tab.addEventListener("click", () => {
        selected.dayIso = iso;
        renderDetail();
      });
      el.dayTabs.appendChild(tab);
    }

    renderTasks();
  }

  function renderTasks() {
    const iso = selected.dayIso;
    const d = parseISO(iso);
    el.dayTitle.textContent = `${DOW[(d.getDay() + 6) % 7]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

    const tasks = dayTasks(iso);
    const done = tasks.filter(t => t.done).length;
    el.dayCount.textContent = `${done}/${tasks.length} задач`;

    el.taskList.innerHTML = "";
    tasks.forEach(t => {
      const li = document.createElement("li");
      li.className = "task" + (t.done ? " done" : "");
      li.innerHTML = `
        <span class="check" title="Отметить">${t.done ? "✓" : ""}</span>
        <span class="txt"></span>
        <button class="del" title="Удалить">✕</button>`;
      li.querySelector(".txt").textContent = t.text;
      li.querySelector(".check").addEventListener("click", () => {
        t.done = !t.done;
        commitDayChange(iso);
      });
      li.querySelector(".del").addEventListener("click", () => {
        const rec = state.days[iso];
        rec.tasks = rec.tasks.filter(x => x.id !== t.id);
        commitDayChange(iso);
      });
      el.taskList.appendChild(li);
    });
  }

  function ensureDay(iso) {
    if (!state.days[iso]) state.days[iso] = { tasks: [] };
    return state.days[iso];
  }

  function commitDayChange(iso) {
    // clean up empty day records
    const rec = state.days[iso];
    if (rec && rec.tasks.length === 0) delete state.days[iso];
    save();
    renderTasks();
    // update the specific week cell + day tab brightness live
    updateWeekCell(selected.weekStart);
    // refresh day tab dot
    renderDetail();
  }

  function updateWeekCell(weekStart) {
    const idx = Math.round((weekStart - model.origin) / MS_WEEK);
    const cell = el.gridInner.querySelector(`.week[data-idx="${idx}"]`);
    if (!cell) return;
    const lv = weekLevel(weekStart);
    if (lv) cell.dataset.lv = lv; else delete cell.dataset.lv;
  }

  // ===========================================================
  //  EVENTS
  // ===========================================================
  // grid click (event delegation)
  el.gridInner.addEventListener("click", (e) => {
    const cell = e.target.closest(".week");
    if (!cell) return;
    if (cell.classList.contains("future")) return;
    const idx = Number(cell.dataset.idx);
    selectWeek(weekStartByIndex(idx));
  });

  // grid tooltip
  el.gridInner.addEventListener("mousemove", (e) => {
    const cell = e.target.closest(".week");
    if (!cell) { el.tooltip.classList.add("hidden"); return; }
    const idx = Number(cell.dataset.idx);
    const ws = weekStartByIndex(idx);
    const we = addDays(ws, 6);
    let total = 0;
    for (let i = 0; i < 7; i++) total += dayDoneCount(isoDate(addDays(ws, i)));
    const wi = model.hasBirth ? Math.round((ws - model.origin) / MS_WEEK) + 1 : idx + 1;
    el.tooltip.innerHTML = `Неделя ${wi} · <b>${total}</b> задач<br>${fmtRange(ws, we)}`;
    el.tooltip.style.left = e.clientX + "px";
    el.tooltip.style.top = e.clientY + "px";
    el.tooltip.classList.remove("hidden");
  });
  el.gridInner.addEventListener("mouseleave", () => el.tooltip.classList.add("hidden"));

  // add task
  el.taskForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = el.taskInput.value.trim();
    if (!text) return;
    const iso = selected.dayIso;
    const rec = ensureDay(iso);
    rec.tasks.push({ id: Date.now() + "-" + Math.random().toString(36).slice(2, 7), text, done: true });
    el.taskInput.value = "";
    save();
    renderTasks();
    updateWeekCell(selected.weekStart);
    renderDetail();
  });

  // week nav
  el.weekPrev.addEventListener("click", () => selectWeek(addDays(selected.weekStart, -7)));
  el.weekNext.addEventListener("click", () => selectWeek(addDays(selected.weekStart, 7)));

  // zoom
  function setZoom(z) {
    state.ui.zoom = Math.min(2, Math.max(0.6, Math.round(z * 10) / 10));
    el.zoomLabel.textContent = Math.round(state.ui.zoom * 100) + "%";
    document.documentElement.style.setProperty("--zoom", state.ui.zoom);
    save();
  }
  el.zoomIn.addEventListener("click", () => setZoom(state.ui.zoom + 0.1));
  el.zoomOut.addEventListener("click", () => setZoom(state.ui.zoom - 0.1));

  // jump to today
  el.jumpTodayBtn.addEventListener("click", () => {
    if (!model.hasBirth) { openSettings(); return; }
    const idx = todayWeekIndex();
    if (idx < 0) return;
    selectWeek(weekStartByIndex(idx));
    const cell = el.gridInner.querySelector(`.week[data-idx="${idx}"]`);
    if (cell) cell.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  // ---- settings modal ----
  function openSettings() {
    el.birthDate.value = state.settings.birthDate || "";
    el.lifeExpectancy.value = state.settings.lifeExpectancy;
    el.lifeExpVal.textContent = state.settings.lifeExpectancy;
    el.settingsModal.classList.remove("hidden");
  }
  function closeSettings() { el.settingsModal.classList.add("hidden"); }

  el.settingsBtn.addEventListener("click", openSettings);
  el.settingsClose.addEventListener("click", closeSettings);
  el.settingsModal.addEventListener("click", (e) => {
    if (e.target === el.settingsModal) closeSettings();
  });
  el.lifeExpectancy.addEventListener("input", () => {
    el.lifeExpVal.textContent = el.lifeExpectancy.value;
  });
  el.lifeExpectancy.addEventListener("change", () => {
    state.settings.lifeExpectancy = Number(el.lifeExpectancy.value);
    save(); renderAll();
  });
  el.birthDate.addEventListener("change", () => {
    state.settings.birthDate = el.birthDate.value || null;
    save(); renderAll();
  });

  // export / import / reset
  el.exportBtn.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lifegrid-${isoDate(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
  el.importBtn.addEventListener("click", () => el.importFile.click());
  el.importFile.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result);
        state = Object.assign(defaultState(), imported);
        save(); renderAll(); closeSettings();
      } catch { alert("Не удалось прочитать файл."); }
    };
    reader.readAsText(file);
    e.target.value = "";
  });
  el.resetBtn.addEventListener("click", () => {
    if (!confirm("Удалить все данные и настройки? Это действие необратимо.")) return;
    state = defaultState();
    selected = { weekStart: null, dayIso: null };
    save();
    el.detailBody.classList.add("hidden");
    el.detailEmpty.classList.remove("hidden");
    renderAll(); closeSettings();
  });

  // esc closes modal
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeSettings();
  });

  // ===========================================================
  //  INIT
  // ===========================================================
  function renderAll() {
    renderGrid();
    renderStats();
    if (selected.weekStart) selectWeek(selected.weekStart, true);
  }

  function init() {
    setZoom(state.ui.zoom);
    renderAll();
    // scroll to current week on load if birth date exists
    if (model.hasBirth) {
      const idx = todayWeekIndex();
      const cell = el.gridInner.querySelector(`.week[data-idx="${idx}"]`);
      if (cell) cell.scrollIntoView({ block: "center" });
    }
    if (!state.settings.birthDate) openSettings();
  }

  init();
})();
