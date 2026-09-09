(() => {
  "use strict";

  const ACTION_TIME = 18;   // seconds — pressure mode (bomber / guardian pick)
  const ACCUSE_TIME = 15;   // seconds — pressure mode (accusation)

  const ARABIC_DIGITS = ["٠","١","٢","٣","٤","٥","٦","٧","٨","٩"];
  function toArabicNumerals(n) {
    return String(n).replace(/[0-9]/g, (d) => ARABIC_DIGITS[+d]);
  }

  // ============================================================
  //  CARD LIBRARY — every player draws a DIFFERENT card each round
  //  kind: "victim"  → only matters if the bomb lands on them
  //        "active"  → they take a secret action on their turn
  //        "intel"   → they secretly learn something on their turn
  // ============================================================

  const CARDS = {
    heart:     { icon: "🫀", title: "القلب",           kind: "victim", short: "تنجو تلقائيًا إن استُهدفت" },
    double:    { icon: "🔍", title: "الشك المزدوج",     kind: "victim", short: "تتهم شخصين بدل واحد" },
    hourglass: { icon: "⏳", title: "الساعة الرملية",   kind: "victim", short: "فرصة تخمين ثانية" },
    compass:   { icon: "🧭", title: "البوصلة",          kind: "victim", short: "يُحذف اسم بريء من القائمة" },
    scissors:  { icon: "✂️", title: "المقص",            kind: "victim", short: "تُقصّ بعض الأسماء البريئة" },
    mask:      { icon: "🎭", title: "القناع",           kind: "victim", short: "إن أخطأت، يخرج المتَّهم بدلك" },
    scale:     { icon: "⚖️", title: "الميزان",          kind: "victim", short: "إن أخطأت، لا يخرج أحد" },
    mirror:    { icon: "🪞", title: "المرآة",           kind: "victim", short: "ترتد القنبلة إلى شخص آخر" },
    guardian:  { icon: "🛡️", title: "الحارس",           kind: "active", short: "تحمي شخصًا تختاره سرًّا" },
    saboteur:  { icon: "🔥", title: "المُشعِل",          kind: "active", short: "تُشعل الشك حول شخص تختاره" },
    smoke:     { icon: "🌫️", title: "الدخان",           kind: "active", short: "تُخفي اسمًا عن قوائم المشتبهين" },
    insider:   { icon: "🕵️", title: "عين خفية",         kind: "intel",  short: "همسٌ عن أحدهم — قد يصدق وقد يكذب" },
    bell:      { icon: "🔔", title: "الجرس",            kind: "intel",  short: "رنّةٌ عن جهة الخائن — قد تخدعك" },
    key:       { icon: "🗝️", title: "المفتاح",          kind: "intel",  short: "قائمةٌ مختصرة قد تُخفي الخائن" },
  };

  // intel is powerful, so it only enters the deck once the group is big enough
  // to absorb it — otherwise a single hint would end the round instantly
  const INTEL_UNLOCK = { insider: 6, bell: 5, key: 8, smoke: 6 };
  const LIE_CHANCE = 0.3; // every intel card can be wrong — nothing is ever certain

  function deckForSize(n) {
    return Object.keys(CARDS).filter((k) => !INTEL_UNLOCK[k] || n >= INTEL_UNLOCK[k]);
  }

  const CARD_KEYS = Object.keys(CARDS);

  function cardsNoteText(n) {
    const deck = deckForSize(n);
    if (n > deck.length) {
      return `كل لاعب يسحب بطاقة مختلفة. لديك ${toArabicNumerals(n)} لاعبين و${toArabicNumerals(deck.length)} بطاقة متاحة، لذا ستتكرر بعض البطاقات.`;
    }
    const locked = CARD_KEYS.length - deck.length;
    const base = `كل لاعب يسحب بطاقة مختلفة تمامًا — ${toArabicNumerals(deck.length)} بطاقة متاحة لهذا العدد.`;
    return locked > 0
      ? base + ` ${toArabicNumerals(locked)} بطاقة استخبارية تُفتح مع ازدياد عدد اللاعبين.`
      : base + " كل البطاقات مفتوحة، بما فيها الاستخبارية.";
  }

  // ---------------- audio + haptics (no external assets) ----------------

  let muted = false;
  let audioCtx = null;
  function getCtx() {
    if (muted) return null;
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) { /* unsupported */ }
    }
    return audioCtx;
  }

  function beep({ freq = 440, freqEnd = null, duration = 0.15, type = "sine", volume = 0.2, when = 0 }) {
    const ctx = getCtx();
    if (!ctx) return;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), t0 + duration);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.03);
  }

  const sound = {
    tick(urgent) { beep({ freq: urgent ? 1050 : 720, duration: 0.06, type: "square", volume: urgent ? 0.16 : 0.07 }); },
    seal() { beep({ freq: 140, freqEnd: 55, duration: 0.22, type: "sine", volume: 0.22 }); },
    open() {
      beep({ freq: 600, duration: 0.12, type: "triangle", volume: 0.14 });
      beep({ freq: 920, duration: 0.16, type: "triangle", volume: 0.12, when: 0.06 });
    },
    boom() {
      beep({ freq: 170, freqEnd: 35, duration: 0.55, type: "sawtooth", volume: 0.28 });
      beep({ freq: 95, freqEnd: 28, duration: 0.6, type: "square", volume: 0.2, when: 0.02 });
    },
    success() {
      beep({ freq: 520, duration: 0.12, type: "triangle", volume: 0.2 });
      beep({ freq: 780, duration: 0.2, type: "triangle", volume: 0.2, when: 0.12 });
    },
    fail() {
      beep({ freq: 230, freqEnd: 85, duration: 0.4, type: "sawtooth", volume: 0.22 });
    },
  };

  function vibrate(pattern) {
    if (navigator.vibrate) {
      try { navigator.vibrate(pattern); } catch (e) { /* ignore */ }
    }
  }

  // ---------------- state ----------------

  function freshGame(keepPlayers, keepStats) {
    return {
      players: keepPlayers ? [...keepPlayers] : [],
      order: [],
      bomberId: null,
      victimId: null,
      originalVictimId: null,
      cards: {},                // playerId -> card key (unique per player)
      guardianProtections: {},  // guardianId -> protectedId
      saboteurMarks: {},        // saboteurId -> markedId
      smokeScreens: {},         // smokePlayerId -> hiddenId
      intel: {},                // playerId -> precomputed secret info
      savingGuardianId: null,
      outcomeType: null,        // heart-save | guardian-save | mirror-* | normal
      mirrorFrom: null,
      currentTurn: 0,
      accusedIds: [],
      secondChanceUsed: false,
      phase: "setup",
      pressureMode: false,
      timedOutAccuser: false,
      stats: keepStats ? keepStats : { rounds: 0, traitorWins: 0, civilianWins: 0, saves: 0 },
    };
  }

  let game = freshGame();
  let activeTimerCtl = null;

  function uid() { return Math.random().toString(36).slice(2, 10); }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function playerById(id) { return game.players.find((p) => p.id === id); }
  function nameOf(id) { const p = playerById(id); return p ? p.name : "—"; }

  function clearTimers() {
    if (activeTimerCtl) { activeTimerCtl.clear(); activeTimerCtl = null; }
  }

  function assignRoles() {
    const ids = game.players.map((p) => p.id);

    // the bomber is a random player — and the turn order is shuffled separately,
    // so the first person to open a file gives nothing away
    game.bomberId = ids[Math.floor(Math.random() * ids.length)];

    // deal a DIFFERENT card to every player (cycles only if players outnumber the deck)
    const deck = shuffle(deckForSize(ids.length));
    const shuffledPlayers = shuffle(ids);
    game.cards = {};
    shuffledPlayers.forEach((pid, i) => {
      game.cards[pid] = deck[i % deck.length];
    });

    game.guardianProtections = {};
    game.saboteurMarks = {};
    game.smokeScreens = {};
    game.intel = {};
    game.savingGuardianId = null;

    // precompute the secret information for intel cards — each can lie
    Object.keys(game.cards).forEach((pid) => {
      const key = game.cards[pid];
      const lies = Math.random() < LIE_CHANCE;
      if (key === "insider") {
        const others = game.players.filter((p) => p.id !== pid);
        const target = others[Math.floor(Math.random() * others.length)];
        const truth = target.id === game.bomberId;
        game.intel[pid] = { type: "insider", targetName: target.name, isBomber: lies ? !truth : truth, lies };
      } else if (key === "bell") {
        const myIdx = game.players.findIndex((p) => p.id === pid);
        const bomberIdx = game.players.findIndex((p) => p.id === game.bomberId);
        const truth = bomberIdx < myIdx;
        game.intel[pid] = { type: "bell", before: lies ? !truth : truth, lies, self: pid === game.bomberId };
      } else if (key === "key") {
        const size = Math.max(3, Math.ceil(game.players.length / 2));
        const innocents = game.players.filter((p) => p.id !== game.bomberId);
        let names;
        if (lies) {
          // a false list: the bomber's name is deliberately left out
          names = shuffle(innocents).slice(0, size).map((p) => p.name);
        } else {
          const fillers = shuffle(innocents).slice(0, Math.max(0, size - 1)).map((p) => p.name);
          names = shuffle([...fillers, nameOf(game.bomberId)]);
        }
        game.intel[pid] = { type: "key", names, lies, self: pid === game.bomberId };
      }
    });
  }

  // ---------------- screen helpers ----------------

  const screens = {};
  document.querySelectorAll(".screen").forEach((el) => (screens[el.id] = el));

  function showScreen(id) {
    Object.values(screens).forEach((el) => el.classList.remove("active"));
    const target = screens[id];
    target.classList.add("active");
    const stage = target.querySelector(".stage") || target.querySelector(".splash-stage");
    if (stage) {
      stage.style.animation = "none";
      void stage.offsetWidth;
      stage.style.animation = "";
    }
    window.scrollTo({ top: 0 });
  }

  // NOTE: Arabic is a joined script — wrapping each character in its own element
  // breaks the cursive connections. We stagger by WORD so shaping stays intact.
  function revealLetters(el, text, stagger = 0.09) {
    el.innerHTML = "";
    const words = String(text).split(/\s+/).filter(Boolean);
    words.forEach((word, i) => {
      const span = document.createElement("span");
      span.className = "word";
      span.textContent = word;
      span.style.animationDelay = i * stagger + "s";
      el.appendChild(span);
      if (i < words.length - 1) el.appendChild(document.createTextNode(" "));
    });
  }

  // ---------------- countdown ring ----------------

  function startCountdown(containerEl, totalSeconds, { caption = "", onTimeout } = {}) {
    containerEl.classList.remove("hidden", "urgent");
    const r = 34;
    const circumference = 2 * Math.PI * r;
    containerEl.innerHTML = `
      <svg width="84" height="84" viewBox="0 0 84 84">
        <circle class="ring-bg" cx="42" cy="42" r="${r}"></circle>
        <circle class="ring-fg" cx="42" cy="42" r="${r}" stroke-dasharray="${circumference}" stroke-dashoffset="0"></circle>
        <text x="42" y="47" text-anchor="middle" class="ring-number">${totalSeconds}</text>
      </svg>
      <span class="ring-caption">${caption}</span>
    `;
    const ringFg = containerEl.querySelector(".ring-fg");
    const ringNumber = containerEl.querySelector(".ring-number");
    const startedAt = performance.now();
    let lastSecond = totalSeconds;
    let done = false;
    let rafId = null;

    function frame(now) {
      if (done) return;
      const elapsed = (now - startedAt) / 1000;
      const remaining = Math.max(0, totalSeconds - elapsed);
      ringFg.setAttribute("stroke-dashoffset", String(circumference * (1 - remaining / totalSeconds)));

      const secondsLeft = Math.ceil(remaining);
      if (secondsLeft !== lastSecond) {
        lastSecond = secondsLeft;
        ringNumber.textContent = toArabicNumerals(secondsLeft);
        if (secondsLeft <= 5 && secondsLeft > 0) {
          containerEl.classList.add("urgent");
          sound.tick(true);
          vibrate(35);
        } else if (secondsLeft > 0) {
          sound.tick(false);
        }
      }

      if (remaining <= 0.001) {
        done = true;
        containerEl.classList.add("hidden");
        containerEl.classList.remove("urgent");
        vibrate([70, 40, 70]);
        if (onTimeout) onTimeout();
        return;
      }
      rafId = requestAnimationFrame(frame);
    }
    rafId = requestAnimationFrame(frame);

    return {
      clear() {
        done = true;
        if (rafId) cancelAnimationFrame(rafId);
        containerEl.classList.add("hidden");
        containerEl.classList.remove("urgent");
      },
    };
  }

  // ---------------- turn dots ----------------

  function renderTurnDots() {
    ["turn-dots-pass", "turn-dots-reveal"].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.innerHTML = "";
      game.order.forEach((_, idx) => {
        const dot = document.createElement("span");
        dot.className = "turn-dot" +
          (idx < game.currentTurn ? " done" : idx === game.currentTurn ? " current" : "");
        el.appendChild(dot);
      });
    });
  }

  // ---------------- scoreboard ----------------

  function renderScoreboard() {
    const s = game.stats;
    document.getElementById("scoreboard-mini").classList.toggle("hidden", s.rounds === 0);
    document.getElementById("sb-traitor").textContent = toArabicNumerals(s.traitorWins);
    document.getElementById("sb-civilian").textContent = toArabicNumerals(s.civilianWins);
    document.getElementById("sb-saves").textContent = toArabicNumerals(s.saves);
    document.getElementById("sb-round").textContent = toArabicNumerals(s.rounds + 1);
    document.getElementById("sb-traitor-2").textContent = toArabicNumerals(s.traitorWins);
    document.getElementById("sb-civilian-2").textContent = toArabicNumerals(s.civilianWins);
    document.getElementById("sb-saves-2").textContent = toArabicNumerals(s.saves);
    document.getElementById("sb-round-2").textContent = toArabicNumerals(s.rounds);
  }

  // ---------------- SETUP SCREEN ----------------

  const form = document.getElementById("form-add-player");
  const input = document.getElementById("input-name");
  const list = document.getElementById("player-list");
  const hint = document.getElementById("player-hint");
  const btnStart = document.getElementById("btn-start");
  const btnRulesToggle = document.getElementById("btn-rules-toggle");
  const rulesBox = document.getElementById("rules-box");
  const togglePressure = document.getElementById("toggle-pressure");
  const cardsNote = document.getElementById("cards-note");

  btnRulesToggle.addEventListener("click", () => {
    rulesBox.classList.toggle("hidden");
    btnRulesToggle.textContent = rulesBox.classList.contains("hidden") ? "كيف تُلعب؟" : "إخفاء الشرح";
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) return;
    if (game.players.some((p) => p.name === name)) {
      input.value = "";
      input.placeholder = "هذا الاسم موجود بالفعل — جرّب اسمًا آخر";
      return;
    }
    game.players.push({ id: uid(), name });
    input.value = "";
    renderPlayerList();
  });

  function renderPlayerList() {
    list.innerHTML = "";
    game.players.forEach((p, idx) => {
      const li = document.createElement("li");
      li.innerHTML = `
        <span class="row-name">${escapeHtml(p.name)}</span>
        <span class="row-index">${toArabicNumerals(idx + 1)}</span>
        <button class="row-remove" type="button" aria-label="حذف ${escapeHtml(p.name)}">×</button>
      `;
      li.querySelector(".row-remove").addEventListener("click", () => {
        game.players = game.players.filter((pl) => pl.id !== p.id);
        renderPlayerList();
      });
      list.appendChild(li);
    });

    const count = game.players.length;
    btnStart.disabled = count < 3;
    hint.textContent =
      count === 0 ? "أضِف ٣ أسماء على الأقل لفتح الملف."
      : count < 3 ? `أضِف ${toArabicNumerals(3 - count)} اسمًا آخر على الأقل.`
      : `${toArabicNumerals(count)} أشخاص جاهزون. يمكنك بدء اللعبة أو إضافة المزيد.`;

    cardsNote.textContent = count >= 3 ? cardsNoteText(count) : "";
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  btnStart.addEventListener("click", startGame);

  function startGame() {
    game.pressureMode = togglePressure.checked;
    assignRoles();
    game.order = shuffle(game.players.map((p) => p.id)); // fully random — bomber is not first
    game.victimId = null;
    game.originalVictimId = null;
    game.outcomeType = null;
    game.mirrorFrom = null;
    game.currentTurn = 0;
    game.accusedIds = [];
    game.secondChanceUsed = false;
    game.timedOutAccuser = false;
    game.phase = "pass";
    renderPass();
  }

  // ---------------- PASS SCREEN ----------------

  const passTurnCounter = document.getElementById("pass-turn-counter");
  const passName = document.getElementById("pass-name");

  function renderPass() {
    clearTimers();
    const p = playerById(game.order[game.currentTurn]);
    passTurnCounter.textContent = `الدور ${toArabicNumerals(game.currentTurn + 1)} من ${toArabicNumerals(game.order.length)}`;
    passName.textContent = p.name;
    renderTurnDots();
    showScreen("screen-pass");
  }

  document.getElementById("btn-reveal").addEventListener("click", renderReveal);

  // ---------------- REVEAL SCREEN ----------------

  const fileStamp = document.getElementById("file-stamp");
  const fileTitle = document.getElementById("file-title");
  const fileBody = document.getElementById("file-body");
  const targetPicker = document.getElementById("target-picker");
  const btnDoneTurn = document.getElementById("btn-done-turn");
  const sealCover = document.getElementById("seal-cover");
  const fileCardInner = document.getElementById("file-card-inner");
  const actionTimerEl = document.getElementById("action-timer");
  const specialCardPanel = document.getElementById("special-card-panel");
  const specialCardIcon = document.getElementById("special-card-icon");
  const specialCardTitle = document.getElementById("special-card-title");
  const specialCardDesc = document.getElementById("special-card-desc");

  function buildSingleSelectPicker(containerEl, candidates, onPick) {
    containerEl.innerHTML = "";
    candidates.forEach((p) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "target-btn";
      btn.textContent = p.name;
      btn.dataset.pid = p.id;
      btn.addEventListener("click", () => {
        clearTimers();
        [...containerEl.children].forEach((c) => { c.classList.remove("selected"); c.disabled = true; });
        btn.classList.add("selected");
        vibrate(25);
        onPick(p.id);
      });
      containerEl.appendChild(btn);
    });
  }

  function cardDescriptionFor(pid, isBomber) {
    const key = game.cards[pid];
    const info = game.intel[pid];
    switch (key) {
      case "heart":
        return isBomber ? "بطاقتك بلا أثر ما دمت أنت من يرمي القنبلة." : "إن رُميت عليك القنبلة، ينجو قلبك بك تلقائيًا دون أي تخمين.";
      case "double":
        return isBomber ? "بطاقتك بلا أثر ما دمت أنت من يرمي القنبلة." : "إن أصابتك القنبلة، تتّهم شخصين بدل واحد — يكفي أن يكون أحدهما الخائن لتفوز.";
      case "hourglass":
        return isBomber ? "بطاقتك بلا أثر ما دمت أنت من يرمي القنبلة." : "إن أصابتك القنبلة وأخطأت أول تخمين، تُمنح فرصة ثانية أخيرة.";
      case "compass":
        return isBomber ? "بطاقتك بلا أثر ما دمت أنت من يرمي القنبلة." : "إن أصابتك القنبلة، يُحذف اسم بريء واحد من قائمة المشتبهين قبل أن تختار.";
      case "scissors":
        return isBomber ? "بطاقتك بلا أثر ما دمت أنت من يرمي القنبلة." : "إن أصابتك القنبلة، يُقصّ ثلث الأسماء البريئة من القائمة — على ألا تقلّ القائمة عن ثلاثة.";
      case "mask":
        return isBomber ? "بطاقتك بلا أثر ما دمت أنت من يرمي القنبلة." : "إن أصابتك القنبلة وأخطأت التخمين، يخرج من اتهمته بدلًا عنك — القناع يحميك.";
      case "scale":
        return isBomber ? "بطاقتك بلا أثر ما دمت أنت من يرمي القنبلة." : "إن أصابتك القنبلة وأخطأت التخمين، لا يخرج أحد — الميزان يُلغي الجولة.";
      case "mirror":
        return isBomber ? "بطاقتك بلا أثر ما دمت أنت من يرمي القنبلة." : "إن أصابتك القنبلة، ترتدّ عنك إلى شخص آخر عشوائيًا — وقد ترتدّ إلى الخائن نفسه!";
      case "guardian":
        return "اختر شخصًا واحدًا تحميه هذه الجولة سرًّا. إن كانت القنبلة موجّهة إليه، ينجو بفضلك.";
      case "saboteur":
        return "اختر شخصًا لتُشعل الشك حوله — سيُعلَن اسمه للجميع كـ«مشتبه به» بعد انفجار القنبلة، بريئًا كان أو خائنًا.";
      case "smoke":
        return "اختر شخصًا تُخفيه خلف دخانك — لن يظهر اسمه في قائمة المشتبهين أمام الضحية، فينجو من الاتهام تمامًا.";
      case "insider":
        if (!info) return "";
        return `همسٌ في أذنك: ${info.targetName} ${info.isBomber ? "هو من يحمل القنبلة 💣" : "بريءٌ 🕊️"} — لكن احذر، فعينك الخفية تكذب أحيانًا.`;
      case "bell":
        if (!info) return "";
        if (info.self) return "جرسك يرنّ عليك أنت — فأنت الخائن، وبطاقتك بلا فائدة هذه الجولة.";
        return `جرسك يهمس: الخائن مسجَّل ${info.before ? "قبلك" : "بعدك"} في قائمة الأسماء — والجرس لا يصدق دائمًا.`;
      case "key":
        if (!info) return "";
        if (info.self) return "مفتاحك يشير إليك أنت — فأنت الخائن، وبطاقتك بلا فائدة هذه الجولة.";
        return `مفتاحك يفتح هذه الأبواب، وقد يكون الخائن خلف أحدها — وقد لا يكون: ${info.names.join(" · ")}`;
      default:
        return "";
    }
  }

  function renderReveal() {
    clearTimers();
    const currentId = game.order[game.currentTurn];
    const isBomber = currentId === game.bomberId;
    const key = game.cards[currentId];
    const card = CARDS[key];

    sealCover.classList.remove("breaking", "opened");
    fileCardInner.classList.remove("visible");
    actionTimerEl.classList.add("hidden");
    targetPicker.innerHTML = "";
    targetPicker.classList.add("hidden");
    specialCardPanel.classList.add("hidden");
    btnDoneTurn.disabled = true;

    if (isBomber) {
      fileStamp.className = "file-stamp stamp-bomb";
      fileTitle.className = "file-title is-bomb";
      fileTitle.textContent = "لديك القنبلة 💣";
      fileBody.textContent = "اختر بصمت من سترميها عليه. لن يعرف أحد اختيارك حتى تنتهي كل الأدوار.";
      targetPicker.classList.remove("hidden");
      buildSingleSelectPicker(targetPicker, game.players.filter((p) => p.id !== currentId), (pid) => {
        game.victimId = pid;
        btnDoneTurn.disabled = false;
      });
    } else if (key === "guardian" || key === "saboteur" || key === "smoke") {
      fileStamp.className = "file-stamp";
      fileTitle.className = "file-title is-special";
      fileTitle.textContent = `${card.icon} ${card.title}`;
      fileBody.textContent = "أنت بريء — لكن بيدك تحرّك سرّي هذه الجولة.";
      targetPicker.classList.remove("hidden");
      buildSingleSelectPicker(targetPicker, game.players.filter((p) => p.id !== currentId), (pid) => {
        if (key === "guardian") game.guardianProtections[currentId] = pid;
        else if (key === "smoke") game.smokeScreens[currentId] = pid;
        else game.saboteurMarks[currentId] = pid;
        btnDoneTurn.disabled = false;
      });
    } else {
      fileStamp.className = "file-stamp";
      fileTitle.className = "file-title";
      fileTitle.textContent = "أنت بريء 🕊️";
      fileBody.textContent = "لا قنبلة في ملفّك. أغلقه ومرّر الهاتف دون أن تُظهر أي رد فعل.";
    }

    specialCardPanel.classList.remove("hidden");
    specialCardIcon.textContent = card.icon;
    specialCardTitle.textContent = card.title;
    specialCardDesc.textContent = cardDescriptionFor(currentId, isBomber);

    renderTurnDots();
    showScreen("screen-reveal");
  }

  document.getElementById("btn-break-seal").addEventListener("click", () => {
    sound.seal();
    vibrate(20);
    sealCover.classList.add("breaking");
    setTimeout(() => {
      sealCover.classList.add("opened");
      fileCardInner.classList.add("visible");
      sound.open();

      const currentId = game.order[game.currentTurn];
      const isBomber = currentId === game.bomberId;
      const key = game.cards[currentId];
      const needsPick = isBomber || key === "guardian" || key === "saboteur" || key === "smoke";

      if (needsPick && game.pressureMode) {
        activeTimerCtl = startCountdown(actionTimerEl, ACTION_TIME, {
          caption: isBomber ? "لاختيار الهدف" : "لاختيار الشخص",
          onTimeout: () => {
            const remaining = [...targetPicker.children].filter((b) => !b.disabled);
            if (!remaining.length) return;
            remaining[Math.floor(Math.random() * remaining.length)].click();
          },
        });
      } else if (!needsPick) {
        btnDoneTurn.disabled = false;
      }
    }, 480);
  });

  btnDoneTurn.addEventListener("click", () => {
    clearTimers();
    game.currentTurn += 1;
    if (game.currentTurn < game.order.length) {
      game.phase = "pass";
      renderPass();
    } else {
      game.phase = "round-end";
      showScreen("screen-round-end");
    }
  });

  // ---------------- ROUND END -> VICTIM REVEAL ----------------

  function resolveFate() {
    game.originalVictimId = game.victimId;
    game.mirrorFrom = null;

    const victimCard = game.cards[game.victimId];

    if (victimCard === "heart") { game.outcomeType = "heart-save"; return; }

    const savingEntry = Object.entries(game.guardianProtections)
      .find(([, protectedId]) => protectedId === game.victimId);
    if (savingEntry) {
      game.outcomeType = "guardian-save";
      game.savingGuardianId = savingEntry[0];
      return;
    }

    if (victimCard === "mirror") {
      const pool = game.players.filter((p) => p.id !== game.victimId);
      const bounced = pool[Math.floor(Math.random() * pool.length)];
      game.mirrorFrom = game.victimId;
      game.victimId = bounced.id;
      if (bounced.id === game.bomberId) { game.outcomeType = "mirror-backfire"; return; }
      // the new victim's own protections still apply
      if (game.cards[bounced.id] === "heart") { game.outcomeType = "heart-save"; return; }
      const secondSave = Object.entries(game.guardianProtections)
        .find(([, protectedId]) => protectedId === bounced.id);
      if (secondSave) {
        game.outcomeType = "guardian-save";
        game.savingGuardianId = secondSave[0];
        return;
      }
      game.outcomeType = "normal";
      return;
    }

    game.outcomeType = "normal";
  }

  document.getElementById("btn-to-victim").addEventListener("click", () => {
    resolveFate();
    sound.boom();
    vibrate([120, 60, 120, 60, 200]);

    const marks = Object.values(game.saboteurMarks).map(nameOf);
    const suffix = marks.length ? ` · 🔥 الشك مُشتعل حول: ${marks.join(" و")}` : "";

    document.getElementById("blast-eyebrow").textContent = game.mirrorFrom
      ? `🪞 ارتدّت القنبلة عن ${nameOf(game.mirrorFrom)}`
      : "انفجرت القنبلة";
    document.getElementById("victim-reveal-sub").textContent =
      (game.outcomeType === "normal"
        ? "والآن، على الضحية وحده أن يعرف من فعل هذا — قبل أن يخسر مكانه في اللعبة."
        : "لكن قبل أن يُعرف مصيره، لنكتشف ما حدث فعلًا.") + suffix;
    document.getElementById("btn-to-victim-pass").textContent =
      game.outcomeType === "normal" ? "مرّر الهاتف إلى الضحية" : "تابع";

    const blastIcon = document.getElementById("blast-icon");
    blastIcon.style.animation = "none";
    void blastIcon.offsetWidth;
    blastIcon.style.animation = "";
    revealLetters(document.getElementById("victim-name-display"), nameOf(game.victimId));
    game.phase = "victim-reveal";
    showScreen("screen-victim-reveal");
  });

  document.getElementById("btn-to-victim-pass").addEventListener("click", () => {
    if (game.outcomeType === "normal") renderAccusation();
    else renderResult();
  });

  // ---------------- ACCUSATION ----------------

  const accusationName = document.getElementById("accusation-name");
  const accusationPicker = document.getElementById("accusation-picker");
  const accusationTimerEl = document.getElementById("accusation-timer");
  const accusationHint = document.getElementById("accusation-hint");
  const accusationPickerHint = document.getElementById("accusation-picker-hint");
  const accusationCardBadge = document.getElementById("accusation-card-badge");
  const accusationFeedback = document.getElementById("accusation-feedback");

  function renderAccusation() {
    clearTimers();
    const victimCard = game.cards[game.victimId];
    const card = CARDS[victimCard];
    accusationName.textContent = nameOf(game.victimId);
    accusationFeedback.classList.add("hidden");
    game.secondChanceUsed = false;

    // who can be accused
    let suspects = game.players.filter((p) => p.id !== game.victimId);
    let trimmedNote = "";

    // the smoke card hides a name from the list entirely — even the bomber's
    const hidden = Object.values(game.smokeScreens).filter((id) => id !== game.victimId);
    if (hidden.length) {
      const before = suspects.length;
      const filtered = suspects.filter((p) => !hidden.includes(p.id));
      if (filtered.length >= 2) {
        suspects = filtered;
        if (before !== suspects.length) trimmedNote = "🌫️ دخانٌ ما أخفى اسمًا عن قائمتك.";
      }
    }

    const MIN_SUSPECTS = 3;
    if (victimCard === "compass" || victimCard === "scissors") {
      const innocents = suspects.filter((p) => p.id !== game.bomberId);
      const wanted = victimCard === "compass" ? 1 : Math.floor(innocents.length / 3);
      const allowed = Math.max(0, suspects.length - MIN_SUSPECTS);
      const removeCount = Math.min(wanted, innocents.length, allowed);
      if (removeCount > 0) {
        const removed = shuffle(innocents).slice(0, removeCount).map((p) => p.id);
        suspects = suspects.filter((p) => !removed.includes(p.id));
        const label = victimCard === "compass"
          ? `🧭 بوصلتك حذفت ${toArabicNumerals(removeCount)} اسمًا بريئًا.`
          : `✂️ مقصّك قصّ ${toArabicNumerals(removeCount)} اسمًا بريئًا.`;
        trimmedNote = trimmedNote ? `${trimmedNote}  ·  ${label}` : label;
      }
    }

    const isDouble = victimCard === "double";
    const required = isDouble ? Math.min(2, suspects.length) : 1;

    accusationCardBadge.classList.remove("hidden");
    accusationCardBadge.textContent = `${card.icon} بطاقتك: ${card.title} — ${card.short}` + (trimmedNote ? `  ·  ${trimmedNote}` : "");

    accusationHint.textContent = isDouble
      ? "اختر شخصين تشتبه بهما. يكفي أن يكون أحدهما الخائن لتفوز."
      : "اختر اسمًا واحدًا. اختيار خاطئ يعني خروجك من اللعبة.";

    accusationPickerHint.classList.toggle("hidden", !isDouble);
    accusationPicker.innerHTML = "";
    const picked = [];

    function updateHint() {
      if (isDouble) accusationPickerHint.textContent =
        `اخترت ${toArabicNumerals(picked.length)} من ${toArabicNumerals(required)}`;
    }
    updateHint();

    shuffle(suspects).forEach((p) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "target-btn";
      btn.textContent = p.name;
      btn.dataset.pid = p.id;
      btn.addEventListener("click", () => {
        if (btn.classList.contains("selected")) {
          btn.classList.remove("selected");
          picked.splice(picked.indexOf(p.id), 1);
          updateHint();
          return;
        }
        if (picked.length >= required) return;
        btn.classList.add("selected");
        picked.push(p.id);
        vibrate(25);
        updateHint();
        if (picked.length === required) submitAccusation([...picked], false);
      });
      accusationPicker.appendChild(btn);
    });

    function submitAccusation(ids, isTimeout) {
      clearTimers();
      const correct = ids.includes(game.bomberId);

      // the hourglass buys one extra guess before the verdict lands
      if (!correct && victimCard === "hourglass" && !game.secondChanceUsed) {
        game.secondChanceUsed = true;
        sound.fail();
        vibrate([100, 50, 100]);
        accusationFeedback.textContent = "⏳ تخمين خاطئ — لكن ساعتك الرملية تمنحك فرصة أخيرة!";
        accusationFeedback.classList.remove("hidden");
        ids.forEach((id) => {
          const b = [...accusationPicker.children].find((c) => c.dataset.pid === id);
          if (b) { b.disabled = true; b.classList.remove("selected"); b.classList.add("wrong"); }
        });
        picked.length = 0;
        updateHint();
        if (game.pressureMode) startAccusationTimer("الفرصة الأخيرة");
        return;
      }

      [...accusationPicker.children].forEach((c) => { if (!c.classList.contains("selected")) c.disabled = true; });
      game.accusedIds = ids;
      game.timedOutAccuser = isTimeout;
      renderResult();
    }

    function startAccusationTimer(caption) {
      activeTimerCtl = startCountdown(accusationTimerEl, ACCUSE_TIME, {
        caption: caption || "لاتخاذ القرار",
        onTimeout: () => {
          const need = required - picked.length;
          if (need <= 0) return;
          const avail = [...accusationPicker.children]
            .filter((b) => !b.disabled && !b.classList.contains("selected"));
          shuffle(avail).slice(0, need).forEach((b) => {
            b.classList.add("selected");
            picked.push(b.dataset.pid);
          });
          sound.fail();
          submitAccusation([...picked], true);
        },
      });
    }

    game.phase = "accusation";
    showScreen("screen-accusation");
    if (game.pressureMode) startAccusationTimer();
  }

  // ---------------- RESULT ----------------

  const resultMark = document.getElementById("result-mark");
  const resultHeading = document.getElementById("result-heading");
  const resultSub = document.getElementById("result-sub");

  function renderResult() {
    clearTimers();
    const bomberName = nameOf(game.bomberId);
    const victimName = nameOf(game.victimId);
    game.stats.rounds += 1;

    const finish = (mark, ok, heading, sub) => {
      resultMark.textContent = mark;
      ok ? sound.success() : sound.fail();
      vibrate(ok ? [60, 40, 60] : [150]);
      revealLetters(resultHeading, heading);
      resultSub.textContent = sub;
    };

    if (game.outcomeType === "heart-save") {
      game.stats.saves += 1;
      finish("🫀", true, "نجا الضحية!",
        `رُميت القنبلة على ${victimName}، لكن بطاقة القلب أنقذته تلقائيًا. الخائن (${bomberName}) يبقى مجهولًا هذه الجولة.`);
    } else if (game.outcomeType === "guardian-save") {
      game.stats.saves += 1;
      finish("🛡️", true, "الحارس أنقذ الموقف!",
        `${nameOf(game.savingGuardianId)} اختار حماية ${victimName} دون أن يعرف — وكانت القنبلة موجّهة إليه فعلًا! الخائن (${bomberName}) يبقى مجهولًا هذه الجولة.`);
    } else if (game.outcomeType === "mirror-backfire") {
      game.stats.civilianWins += 1;
      finish("🪞", true, "ارتدّت عليه!",
        `مرآة ${nameOf(game.mirrorFrom)} ردّت القنبلة إلى راميها — ${bomberName} فجّر نفسه بنفسه، وانكشف الخائن دون تخمين واحد.`);
    } else {
      const correct = game.accusedIds.includes(game.bomberId);
      const victimCard = game.cards[game.victimId];
      const accusedNames = game.accusedIds.map(nameOf).join(" و");

      if (correct) {
        game.stats.civilianWins += 1;
        finish("🎯", true, "التخمين صحيح",
          victimCard === "double"
            ? `${victimName} اشتبه بشخصين، وكان أحدهما فعلًا الخائن — ${bomberName}. الشك المزدوج نجح، والخائن يخرج من اللعبة.`
            : `${victimName} كشف الخائن. ${bomberName} كان يحمل القنبلة، وهو من يخرج من اللعبة.`);
      } else if (victimCard === "mask") {
        game.stats.traitorWins += 1;
        finish("🎭", false, "القناع أنقذه",
          `أخطأ ${victimName} واتّهم ${accusedNames}، لكن قناعه قلب الطاولة: ${accusedNames} يخرج بدلًا عنه. الخائن الحقيقي (${bomberName}) نجا بجلده.`);
      } else if (victimCard === "scale") {
        game.stats.traitorWins += 1;
        finish("⚖️", false, "الميزان ألغى الجولة",
          `أخطأ ${victimName} في تخمينه، لكن ميزانه منع خروج أي أحد. الخائن الحقيقي كان ${bomberName} — ونجا هذه المرة.`);
      } else {
        game.stats.traitorWins += 1;
        finish("💀", false, "تخمين خاطئ",
          game.timedOutAccuser
            ? `انتهى الوقت قبل أن يقرر ${victimName}. الخائن الحقيقي كان ${bomberName}، و${victimName} هو من يخرج من اللعبة.`
            : `${victimName} اتّهم ${accusedNames} خطأً. الخائن الحقيقي كان ${bomberName}، و${victimName} هو من يخرج من اللعبة.`);
      }
    }

    renderScoreboard();
    game.phase = "result";
    showScreen("screen-result");
  }

  // ---------------- REPLAY / RESET ----------------

  document.getElementById("btn-replay-same").addEventListener("click", () => {
    game = freshGame(game.players, game.stats);
    startGame();
  });

  document.getElementById("btn-new-game").addEventListener("click", resetToSetup);

  function resetToSetup() {
    clearTimers();
    game = freshGame();
    renderPlayerList();
    renderScoreboard();
    showScreen("screen-setup");
  }

  // ---------------- splash / app chrome ----------------

  const topbar = document.getElementById("topbar");
  const btnMute = document.getElementById("btn-mute");
  const muteIcon = document.getElementById("mute-icon");

  document.getElementById("btn-enter").addEventListener("click", () => {
    topbar.classList.add("visible");
    document.body.classList.add("chrome-visible");
    showScreen("screen-setup");
  });

  btnMute.addEventListener("click", () => {
    muted = !muted;
    muteIcon.textContent = muted ? "🔇" : "🔊";
    btnMute.setAttribute("aria-label", muted ? "تفعيل الصوت" : "كتم الصوت");
    if (!muted) beep({ freq: 700, duration: 0.06, type: "sine", volume: 0.1 });
  });

  // ---------------- background video ----------------

  (function setupPlateVideo() {
    const vid = document.getElementById("plate-video");
    if (!vid) return;
    const stageBg = document.querySelector(".stage-bg");

    // if the clip can't load, fall back to the CSS-only lit scene
    vid.addEventListener("error", () => stageBg && stageBg.classList.add("no-video"));
    const source = vid.querySelector("source");
    if (source) source.addEventListener("error", () => stageBg && stageBg.classList.add("no-video"));

    // some mobile browsers block autoplay until the first interaction
    const tryPlay = () => { const p = vid.play(); if (p && p.catch) p.catch(() => {}); };
    tryPlay();
    document.addEventListener("pointerdown", tryPlay, { once: true });
  })();

  // ---------------- ambient dust particles ----------------

  function generateEmbers() {
    const container = document.getElementById("embers");
    const count = window.innerWidth < 480 ? 12 : 18;
    for (let i = 0; i < count; i++) {
      const p = document.createElement("span");
      p.className = "ember-particle";
      p.style.setProperty("--size", (1.2 + Math.random() * 1.6).toFixed(1) + "px");
      const dur = 14 + Math.random() * 12;
      p.style.setProperty("--dur", dur.toFixed(1) + "s");
      p.style.setProperty("--delay", "-" + (Math.random() * dur).toFixed(1) + "s");
      p.style.setProperty("--drift", ((Math.random() - 0.5) * 60).toFixed(0) + "px");
      p.style.left = Math.random() * 100 + "%";
      container.appendChild(p);
    }
  }

  // ---------------- boot ----------------

  renderPlayerList();
  renderScoreboard();
  generateEmbers();
  showScreen("screen-splash");
})();
