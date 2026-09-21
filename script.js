/* ============================================================
   MATRO SWISS — Application logic
   ============================================================ */
(function () {
  "use strict";

  const STORAGE_KEY = "matroSwiss.users";
  const SESSION_KEY = "matroSwiss.session";

  const BANK_LABELS = {
    EBL: "Eastern Bank Limited",
    BRAC: "BRAC Bank",
    CITY: "The City Bank",
    DBBL: "Dutch-Bangla Bank",
    ISLAMI: "Islami Bank Bangladesh",
    SONALI: "Sonali Bank",
    BKASH: "bKash",
    NAGAD: "Nagad",
  };
  const BANK_ABBR = {
    EBL: "EBL",
    BRAC: "BRAC",
    CITY: "CBL",
    DBBL: "DBBL",
    ISLAMI: "IBBL",
    SONALI: "SBL",
    BKASH: "bK",
    NAGAD: "Ng",
  };

  const BILL_CATALOG = [
    { id: "desco", label: "Electricity", provider: "DESCO", icon: "bolt" },
    { id: "titas", label: "Gas", provider: "Titas Gas", icon: "flame" },
    { id: "wasa", label: "Water", provider: "Dhaka WASA", icon: "drop" },
    { id: "internet", label: "Internet", provider: "Link3 Broadband", icon: "wifi" },
    { id: "recharge", label: "Mobile top-up", provider: "Any operator", icon: "phone" },
    { id: "tv", label: "Cable TV", provider: "Zeon Cable", icon: "tv" },
    { id: "edu", label: "Tuition", provider: "University fee", icon: "book" },
    { id: "insurance", label: "Insurance", provider: "Delta Life", icon: "shield" },
  ];

  /* ------------------------------------------------------------
     Sound engine (Web Audio API — no external asset needed)
  ------------------------------------------------------------ */
 const Sound = (() => {
  let ctx;
  function ensureCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }
  function click() {
    try {
      const ac = ensureCtx();
      const t0 = ac.currentTime;

      // Noise burst for mechanical texture (sharp snap)
      const bufferSize = ac.sampleRate * 0.015; // 15ms noise
      const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      const noise = ac.createBufferSource();
      noise.buffer = buffer;

      const noiseFilter = ac.createBiquadFilter();
      noiseFilter.type = "highpass";
      noiseFilter.frequency.setValueAtTime(1000, t0);

      const noiseGain = ac.createGain();
      noiseGain.gain.setValueAtTime(0.08, t0);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.015);

      noise.connect(noiseFilter).connect(noiseGain).connect(ac.destination);
      noise.start(t0);

      // Tonal click (sharp square/triangle pulse for mechanical crispness)
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = "triangle"; // Less harsh than square, more solid than sine
      
      // Sharp frequency drop for physical switch click
      osc.frequency.setValueAtTime(800, t0);
      osc.frequency.exponentialRampToValueAtTime(120, t0 + 0.025);

      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.03);

      osc.connect(gain).connect(ac.destination);
      osc.start(t0);
      osc.stop(t0 + 0.035);
    } catch (e) { /* audio unavailable — fail silently */ }
  }
  
  function success() {
    try {
      const ac = ensureCtx();
      const t0 = ac.currentTime;
      [660, 880, 1180].forEach((freq, i) => {
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = "sine";
        const start = t0 + i * 0.08;
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.12, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
        osc.connect(gain).connect(ac.destination);
        osc.start(start);
        osc.stop(start + 0.25);
      });
    } catch (e) { /* no-op */ }
  }

  return { click, success };
})();

document.addEventListener("click", (e) => {
  if (e.target.closest(".sound-click")) Sound.click();
});
  /* ------------------------------------------------------------
     Data layer (localStorage)
  ------------------------------------------------------------ */
  function loadUsers() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }
  function saveUsers(users) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(users));
  }
  function getSession() {
    return localStorage.getItem(SESSION_KEY);
  }
  function setSession(accountNumber) {
    if (accountNumber) localStorage.setItem(SESSION_KEY, accountNumber);
    else localStorage.removeItem(SESSION_KEY);
  }

  function pad(n) { return n.toString().padStart(2, "0"); }
  function isoNow() { return new Date().toISOString(); }
  function fmtDate(iso) {
    const d = new Date(iso);
    return `${pad(d.getDate())} ${d.toLocaleString("en-US", { month: "short" })} ${d.getFullYear()}`;
  }
  function fmtMoney(n) {
    const sign = n < 0 ? "-" : "";
    const val = Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${sign}৳ ${val}`;
  }
  function randDigits(len) {
    let s = "";
    for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 10);
    return s;
  }
  function formatCardNumber(num) {
    return num.replace(/(.{4})/g, "$1 ").trim();
  }
  function maskedCardNumber(num) {
    return "•••• •••• •••• " + num.slice(-4);
  }
  function initials(name) {
    return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
  }

  function seedDemoUser() {
    const now = new Date();
    const daysAgo = (n) => new Date(now.getTime() - n * 86400000).toISOString();
    return {
      accountNumber: "1000234567",
      pin: "1234",
      name: "Imam Hossain",
      mobile: "01867105020",
      savings: 1250430.5,
      checking: 340580.75,
      card: {
        number: "4061550023341009",
        expiry: "09/32",
        cvv: "482",
        tier: "BLACK",
        frozen: false,
        limit: 200000,
      },
      transactions: [
        { id: "t1", date: daysAgo(0.3), desc: "Salary — Bengal Textiles Ltd.", type: "deposit", status: "success", amount: 185000 },
        { id: "t2", date: daysAgo(1), desc: "Transfer to BRAC Bank · Imam Hossain", type: "transfer", status: "success", amount: -25000 },
        { id: "t3", date: daysAgo(2), desc: "DESCO — Electricity bill", type: "bill", status: "success", amount: -3420 },
        { id: "t4", date: daysAgo(3), desc: "bKash top-up", type: "transfer", status: "success", amount: -5000 },
        { id: "t5", date: daysAgo(5), desc: "ATM withdrawal — Gulshan Ave", type: "withdrawal", status: "success", amount: -10000 },
        { id: "t6", date: daysAgo(6), desc: "Transfer to DBBL · Nadia Chowdhury", type: "transfer", status: "pending", amount: -42000 },
        { id: "t7", date: daysAgo(9), desc: "Titas Gas bill", type: "bill", status: "success", amount: -1180 },
        { id: "t8", date: daysAgo(14), desc: "Freelance payment received", type: "deposit", status: "success", amount: 62000 },
      ],
    };
  }

  function initStore() {
    let users = loadUsers();
    if (!users) {
      users = { "1000234567": seedDemoUser() };
      saveUsers(users);
    }
    return users;
  }

  let users = initStore();
  let currentAccount = getSession();

  function currentUser() {
    return currentAccount ? users[currentAccount] : null;
  }
  function persistCurrentUser() {
    saveUsers(users);
  }

  /* ------------------------------------------------------------
     Toast helper
  ------------------------------------------------------------ */
  const toastEl = document.getElementById("toast");
  let toastTimer;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("is-active");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("is-active"), 2600);
  }

  /* ------------------------------------------------------------
     AUTH
  ------------------------------------------------------------ */
  const viewAuth = document.getElementById("view-auth");
  const appEl = document.getElementById("app");

  document.querySelectorAll(".auth-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".auth-tab").forEach((t) => t.classList.remove("is-active"));
      document.querySelectorAll(".auth-form").forEach((f) => f.classList.remove("is-active"));
      tab.classList.add("is-active");
      document.getElementById(`form-${tab.dataset.tab}`).classList.add("is-active");
    });
  });

  document.getElementById("form-login").addEventListener("submit", (e) => {
    e.preventDefault();
    const acc = document.getElementById("login-account").value.replace(/\s+/g, "");
    const pin = document.getElementById("login-pin").value.trim();
    const errorEl = document.getElementById("login-error");
    const user = users[acc];
    if (!user || user.pin !== pin) {
      errorEl.textContent = "Account number or PIN is incorrect.";
      return;
    }
    errorEl.textContent = "";
    logIn(acc);
  });

  document.getElementById("btn-demo").addEventListener("click", () => {
    document.getElementById("login-account").value = "1000234567";
    document.getElementById("login-pin").value = "1234";
    logIn("1000234567");
  });

  document.getElementById("form-register").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = document.getElementById("reg-name").value.trim();
    const mobile = document.getElementById("reg-mobile").value.trim();
    const pin = document.getElementById("reg-pin").value.trim();
    const deposit = parseFloat(document.getElementById("reg-deposit").value) || 0;
    const errorEl = document.getElementById("register-error");

    if (!name || !mobile || pin.length < 4) {
      errorEl.textContent = "Please complete all fields — PIN must be at least 4 digits.";
      return;
    }
    errorEl.textContent = "";

    const accountNumber = "10" + randDigits(8);
    const newUser = {
      accountNumber,
      pin,
      name,
      mobile,
      savings: deposit,
      checking: 0,
      card: {
        number: "4061" + randDigits(12),
        expiry: `${pad((new Date().getMonth() + 1))}/${(new Date().getFullYear() + 4).toString().slice(-2)}`,
        cvv: randDigits(3),
        tier: "RED",
        frozen: false,
        limit: 100000,
      },
      transactions: deposit > 0 ? [{
        id: "t" + Date.now(), date: isoNow(), desc: "Opening deposit", type: "deposit", status: "success", amount: deposit,
      }] : [],
    };
    users[accountNumber] = newUser;
    persistCurrentUser();
    showToast(`Vault created. Your account number is ${accountNumber}.`);
    logIn(accountNumber);
  });

  function logIn(accountNumber) {
    currentAccount = accountNumber;
    setSession(accountNumber);
    viewAuth.classList.add("hidden");
    appEl.classList.remove("hidden");
    renderAll();
    navigateTo("dashboard");
  }

  document.getElementById("btn-logout").addEventListener("click", () => {
    currentAccount = null;
    setSession(null);
    appEl.classList.add("hidden");
    viewAuth.classList.remove("hidden");
    document.getElementById("form-login").reset();
  });

  /* ------------------------------------------------------------
     ROUTING
  ------------------------------------------------------------ */
  const titles = {
    dashboard: ["Dashboard", "Good to see you again"],
    accounts: ["Accounts", "A full view of your holdings"],
    transfer: ["Transfer", "Move money, securely and instantly"],
    history: ["History", "Every transaction, accounted for"],
    cards: ["Cards", "Manage your Matro Swiss instruments"],
    bills: ["Bill pay", "Settle utilities without leaving home"],
  };

  function navigateTo(viewName) {
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("is-active"));
    document.getElementById(`view-${viewName}`).classList.add("is-active");
    document.querySelectorAll(".nav-item").forEach((n) => n.classList.toggle("is-active", n.dataset.view === viewName));
    const [title, sub] = titles[viewName];
    document.getElementById("view-title").textContent = title;
    document.getElementById("view-subtitle").textContent = sub;
    closeMobileNav();
    if (viewName === "history") renderHistory();
    if (viewName === "cards") renderCards();
    if (viewName === "accounts") renderAccounts();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  document.querySelectorAll(".nav-item[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => navigateTo(btn.dataset.view));
  });
  document.querySelectorAll("[data-goto]").forEach((btn) => {
    btn.addEventListener("click", () => navigateTo(btn.dataset.goto));
  });

  /* Mobile nav */
  const sidebarEl = document.querySelector(".sidebar");
  const scrimEl = document.getElementById("mobile-nav-scrim");
  document.getElementById("btn-mobile-nav").addEventListener("click", () => {
    sidebarEl.classList.add("is-open");
    scrimEl.classList.add("is-active");
  });
  scrimEl.addEventListener("click", closeMobileNav);
  function closeMobileNav() {
    sidebarEl.classList.remove("is-open");
    scrimEl.classList.remove("is-active");
  }

  /* ------------------------------------------------------------
     RENDER: shared header + dashboard
  ------------------------------------------------------------ */
  let balanceVisible = true;

  function renderAll() {
    const user = currentUser();
    if (!user) return;

    document.getElementById("topbar-name").textContent = user.name;
    document.getElementById("topbar-account").textContent = "Acc. " + formatCardNumber(user.accountNumber).trim();
    document.getElementById("topbar-avatar").textContent = initials(user.name);

    renderDashboard();
    renderAccounts();
    renderCards();
    renderHistory();
    renderBillsGrid();
  }

  function renderDashboard() {
    const user = currentUser();
    const total = user.savings + user.checking;

    document.getElementById("dash-total-balance").textContent = fmtMoney(total);
    document.getElementById("dash-savings").textContent = fmtMoney(user.savings);
    document.getElementById("dash-checking").textContent = fmtMoney(user.checking);

    document.getElementById("card-number").textContent = maskedCardNumber(user.card.number);
    document.getElementById("card-name").textContent = user.name.toUpperCase();
    document.getElementById("card-expiry").textContent = user.card.expiry;
    document.getElementById("card-cvv").textContent = user.card.cvv;
    document.querySelector(".matro-card-tier").textContent = user.card.tier;

    renderRecentTx();
  }

  document.getElementById("btn-toggle-balance").addEventListener("click", () => {
    balanceVisible = !balanceVisible;
    const el = document.getElementById("dash-total-balance");
    el.classList.toggle("is-hidden", !balanceVisible);
    document.getElementById("eye-icon").innerHTML = balanceVisible
      ? '<path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12Z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="1.6"/>'
      : '<path d="M3 3l18 18M10.6 10.6a2.6 2.6 0 0 0 3.6 3.6M6.6 6.9C4.4 8.3 2 12 2 12s3.8 6.5 10 6.5c1.7 0 3.2-.4 4.5-1.1M17.5 15.6C19.7 14 22 12 22 12S18.2 5.5 12 5.5c-.7 0-1.4.06-2 .18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>';
  });

  document.getElementById("matro-card").addEventListener("click", function () {
    this.classList.toggle("is-flipped");
  });

  function txIcon(type) {
    switch (type) {
      case "deposit": return '<svg viewBox="0 0 24 24"><path d="M12 19V5m0 0-6 6m6-6 6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      case "withdrawal": return '<svg viewBox="0 0 24 24"><path d="M12 5v14m0 0 6-6m-6 6-6-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      case "bill": return '<svg viewBox="0 0 24 24"><path d="M6 3.5h12v17l-2.5-1.6L13 20.5l-2.5-1.6L8 20.5l-2-1.5v-15.5Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
      default: return '<svg viewBox="0 0 24 24"><path d="M4 8h13m0 0-4-4m4 4-4 4M20 16H7m0 0 4 4m-4-4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }
  }

  function renderRecentTx() {
    const user = currentUser();
    const list = document.getElementById("dash-recent-tx");
    const items = [...user.transactions].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
    if (!items.length) {
      list.innerHTML = '<div class="empty-state">No activity yet. Your transactions will appear here.</div>';
      return;
    }
    list.innerHTML = items.map(rowHtml).join("");
  }

  function rowHtml(tx) {
    const isPositive = tx.amount > 0;
    const statusBadge = tx.status === "success"
      ? '<span class="badge badge-success">Success</span>'
      : '<span class="badge badge-pending">Pending</span>';
    return `
      <div class="tx-row">
        <div class="tx-left">
          <div class="tx-icon">${txIcon(tx.type)}</div>
          <div class="tx-meta">
            <strong>${tx.desc}</strong>
            <span>${fmtDate(tx.date)}</span>
          </div>
        </div>
        <div class="tx-right">
          <span class="tx-amount ${isPositive ? "is-positive" : "is-negative"}">${isPositive ? "+" : ""}${fmtMoney(tx.amount)}</span>
          <span class="tx-status">${statusBadge}</span>
        </div>
      </div>`;
  }

  /* ------------------------------------------------------------
     RENDER: Accounts
  ------------------------------------------------------------ */
  function renderAccounts() {
    const user = currentUser();
    if (!user) return;
    const total = user.savings + user.checking;
    document.getElementById("acc-savings").textContent = fmtMoney(user.savings);
    document.getElementById("acc-checking").textContent = fmtMoney(user.checking);
    document.getElementById("acc-total").textContent = fmtMoney(total);

    const savingsPct = total > 0 ? Math.round((user.savings / total) * 100) : 50;
    const checkingPct = 100 - savingsPct;
    document.getElementById("alloc-savings").style.width = savingsPct + "%";
    document.getElementById("alloc-checking").style.width = checkingPct + "%";
    document.getElementById("alloc-savings-pct").textContent = savingsPct + "%";
    document.getElementById("alloc-checking-pct").textContent = checkingPct + "%";
  }

  /* ------------------------------------------------------------
     TRANSFER
  ------------------------------------------------------------ */
  const transferForm = document.getElementById("form-transfer");
  const routeToLabel = document.getElementById("route-to-label");
  const transferSubmitBtn = transferForm.querySelector('button[type="submit"]');
  let isTransferring = false; // processing lock — prevents the double-submit / double-deduction bug

  document.getElementById("tr-bank").addEventListener("change", (e) => {
    const bank = BANK_LABELS[e.target.value] || "Destination";
    routeToLabel.textContent = bank;
  });

  transferForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (isTransferring) return; // ignore accidental double-clicks while a transfer is in flight

    const user = currentUser();
    const errorEl = document.getElementById("transfer-error");
    const from = document.getElementById("tr-from").value;
    const bankCode = document.getElementById("tr-bank").value;
    const recipientNo = document.getElementById("tr-recipient-no").value.trim();
    const recipientName = document.getElementById("tr-recipient-name").value.trim();
    const amount = parseFloat(document.getElementById("tr-amount").value);
    const note = document.getElementById("tr-note").value.trim();

    if (!bankCode || !recipientNo || !recipientName || !amount || amount <= 0) {
      errorEl.textContent = "Please complete every field with a valid amount.";
      return;
    }
    // Always check against the live, current balance — never a stale/cached value.
    const liveBalance = user[from];
    if (amount > liveBalance) {
      errorEl.textContent = `Insufficient funds in your ${from} account. Available: ${fmtMoney(liveBalance)}.`;
      return;
    }
    errorEl.textContent = "";

    const bankLabel = BANK_LABELS[bankCode] || bankCode;
    const isWallet = bankCode === "BKASH" || bankCode === "NAGAD";

    runTransferModal({
      user, from, amount, bankCode, bankLabel, isWallet, recipientNo, recipientName, note,
    });
  });

  function setTransferLock(locked) {
    isTransferring = locked;
    transferSubmitBtn.disabled = locked;
    transferSubmitBtn.textContent = locked ? "Sending…" : "Review & send";
  }

  function runTransferModal({ user, from, amount, bankCode, bankLabel, isWallet, recipientNo, recipientName, note }) {
    setTransferLock(true);

    const overlayEl = document.getElementById("transfer-overlay");
    const statusText = document.getElementById("transfer-status-text");
    const spinnerEl = document.getElementById("transfer-spinner");
    const checkEl = document.getElementById("overlay-check");
    const summaryEl = document.getElementById("transfer-summary");
    const doneBtn = document.getElementById("overlay-close");
    const token = document.getElementById("flight-token");

    // Reset modal to its "processing" state every time it opens.
    spinnerEl.classList.remove("hidden");
    checkEl.classList.add("hidden");
    checkEl.classList.remove("is-drawing");
    statusText.textContent = "Processing your transfer securely…";
    statusText.classList.remove("is-success");
    summaryEl.classList.add("hidden");
    doneBtn.classList.add("hidden");
    token.classList.remove("is-visible");
    token.style.transform = "translate(-50%, -50%) scale(.6)";

    document.getElementById("flight-avatar-from").textContent = initials(user.name);
    document.getElementById("flight-avatar-to").textContent = BANK_ABBR[bankCode] || bankLabel.slice(0, 3).toUpperCase();
    document.getElementById("flight-bank-name").textContent = bankLabel;

    overlayEl.classList.add("is-active");

    // Wait one frame so the modal has its final layout before measuring the track.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        flyToken(token).then(() => {
          // Deduct + record the transaction only once the flight animation lands,
          // and only ever once per submission — this is what keeps the ledger accurate.
          user[from] -= amount;
          const tx = {
            id: "t" + Date.now(),
            date: isoNow(),
            desc: `Transfer to ${bankLabel} · ${recipientName}${note ? " — " + note : ""}`,
            type: "transfer",
            status: "success",
            amount: -amount,
          };
          user.transactions.unshift(tx);
          persistCurrentUser();
          renderDashboard();
          renderAccounts();

          spinnerEl.classList.add("hidden");
          checkEl.classList.remove("hidden");
          checkEl.classList.add("is-drawing");
          statusText.textContent = "Transfer complete";
          statusText.classList.add("is-success");

          document.getElementById("summary-sender").textContent = `${user.name} · Acc. ${user.accountNumber}`;
          document.getElementById("summary-bank").textContent = bankLabel + (isWallet ? " (wallet)" : "");
          document.getElementById("summary-recipient").textContent = `${recipientName} · ${recipientNo}`;
          document.getElementById("summary-amount").textContent = fmtMoney(amount);
          summaryEl.classList.remove("hidden");
          doneBtn.classList.remove("hidden");

          Sound.success();
        });
      });
    });
  }

  /**
   * Animates the currency token from the "from" avatar to the "to" avatar,
   * using measured pixel widths of the actual track element so the motion
   * always lands precisely on target and never spills outside the modal.
   */
  let activeFlightAnim = null;
  function flyToken(token) {
    return new Promise((resolve) => {
      if (activeFlightAnim) {
        activeFlightAnim.cancel();
        activeFlightAnim = null;
      }
      const track = document.getElementById("flight-track");
      const trackWidth = track.getBoundingClientRect().width;
      token.classList.add("is-visible");

      const anim = token.animate(
        [
          { transform: "translate(-50%, -50%) scale(.6)", offset: 0 },
          { transform: `translate(calc(-50% + ${trackWidth * 0.18}px), -230%) scale(1)`, offset: 0.22 },
          { transform: `translate(calc(-50% + ${trackWidth * 0.5}px), -300%) scale(1.12)`, offset: 0.5 },
          { transform: `translate(calc(-50% + ${trackWidth * 0.82}px), -230%) scale(1)`, offset: 0.78 },
          { transform: `translate(calc(-50% + ${trackWidth}px), -50%) scale(.6)`, offset: 1 },
        ],
        { duration: 1300, easing: "cubic-bezier(.32,.72,.28,1)", fill: "forwards" }
      );
      activeFlightAnim = anim;
      anim.onfinish = () => {
        activeFlightAnim = null;
        resolve();
      };
    });
  }

  document.getElementById("overlay-close").addEventListener("click", () => {
    document.getElementById("transfer-overlay").classList.remove("is-active");
    transferForm.reset();
    routeToLabel.textContent = "Destination";
    setTransferLock(false);
  });

  /* ------------------------------------------------------------
     HISTORY
  ------------------------------------------------------------ */
  let historyFilter = "all";
  document.querySelectorAll(".chip-filter").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".chip-filter").forEach((c) => c.classList.remove("is-active"));
      chip.classList.add("is-active");
      historyFilter = chip.dataset.filter;
      renderHistory();
    });
  });

  function renderHistory() {
    const user = currentUser();
    if (!user) return;
    const body = document.getElementById("history-body");
    let items = [...user.transactions].sort((a, b) => new Date(b.date) - new Date(a.date));
    if (historyFilter !== "all") items = items.filter((t) => t.type === historyFilter);

    if (!items.length) {
      body.innerHTML = `<tr><td colspan="5"><div class="empty-state">No transactions match this filter.</div></td></tr>`;
      return;
    }

    body.innerHTML = items.map((tx) => {
      const isPositive = tx.amount > 0;
      const statusBadge = tx.status === "success"
        ? '<span class="badge badge-success">Success</span>'
        : '<span class="badge badge-pending">Pending</span>';
      return `
        <tr>
          <td>${fmtDate(tx.date)}</td>
          <td>${tx.desc}</td>
          <td style="text-transform:capitalize;">${tx.type}</td>
          <td>${statusBadge}</td>
          <td class="ta-right"><span class="tx-amount ${isPositive ? "is-positive" : "is-negative"}">${isPositive ? "+" : ""}${fmtMoney(tx.amount)}</span></td>
        </tr>`;
    }).join("");
  }

  /* ------------------------------------------------------------
     CARDS
  ------------------------------------------------------------ */
  function renderCards() {
    const user = currentUser();
    if (!user) return;
    const list = document.getElementById("cards-list");
    const c = user.card;
    list.innerHTML = `
      <div class="card-row">
        <div class="card-row-left">
          <div class="mini-card">
            <svg viewBox="0 0 40 30"><rect x="0.5" y="0.5" width="39" height="29" rx="5" fill="none" stroke="rgba(255,255,255,.6)"/></svg>
          </div>
          <div class="card-row-meta">
            <strong>Matro Swiss ${c.tier} · Physical</strong>
            <span>${maskedCardNumber(c.number)} &nbsp;·&nbsp; Exp ${c.expiry}</span>
          </div>
        </div>
        <div class="card-row-controls">
          <div class="limit-control">
            <span>Daily spend limit: <b id="limit-value">${fmtMoney(c.limit)}</b></span>
            <input type="range" id="limit-slider" min="10000" max="500000" step="10000" value="${c.limit}">
          </div>
          <label class="switch">
            <input type="checkbox" id="freeze-toggle" ${c.frozen ? "checked" : ""}>
            <span class="switch-track"></span>
            <span id="freeze-label">${c.frozen ? "Frozen" : "Active"}</span>
          </label>
        </div>
      </div>
      <div class="card-row">
        <div class="card-row-left">
          <div class="mini-card" style="background:linear-gradient(150deg,#c41e3a,#8f1628);">
            <svg viewBox="0 0 40 30"><rect x="0.5" y="0.5" width="39" height="29" rx="5" fill="none" stroke="rgba(255,255,255,.6)"/></svg>
          </div>
          <div class="card-row-meta">
            <strong>Matro Swiss Virtual · Online</strong>
            <span>•••• •••• •••• ${randTail(c.number)} &nbsp;·&nbsp; Single-use ready</span>
          </div>
        </div>
        <div class="card-row-controls">
          <span class="badge badge-success">Enabled</span>
        </div>
      </div>
    `;

    document.getElementById("freeze-toggle").addEventListener("change", (e) => {
      c.frozen = e.target.checked;
      document.getElementById("freeze-label").textContent = c.frozen ? "Frozen" : "Active";
      persistCurrentUser();
      showToast(c.frozen ? "Your physical card has been frozen." : "Your physical card is active again.");
    });

    document.getElementById("limit-slider").addEventListener("input", (e) => {
      c.limit = parseInt(e.target.value, 10);
      document.getElementById("limit-value").textContent = fmtMoney(c.limit);
    });
    document.getElementById("limit-slider").addEventListener("change", () => {
      persistCurrentUser();
      showToast("Daily spend limit updated.");
    });
  }
  function randTail(seed) {
    // stable-looking pseudo tail for the virtual card display
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 9973;
    return (1000 + (h % 9000)).toString();
  }

  /* ------------------------------------------------------------
     BILLS
  ------------------------------------------------------------ */
  const iconPaths = {
    bolt: '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
    flame: '<path d="M12 2s-6 6-6 11a6 6 0 0 0 12 0c0-2-1-3-1-3s-.5 2-2 2c1-3-1-5-1-7 0 2-2 3-2 5-1-1-1-3 0-8Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
    drop: '<path d="M12 2s7 8 7 13a7 7 0 0 1-14 0c0-5 7-13 7-13Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
    wifi: '<path d="M2 8.5a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16.5a5 5 0 0 1 6 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="20" r="1.2" fill="currentColor"/>',
    phone: '<rect x="7" y="2.5" width="10" height="19" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 19h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    tv: '<rect x="3" y="5" width="18" height="12" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 21h8M12 17v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    book: '<path d="M4 5.5A2 2 0 0 1 6 4h5v16H6a2 2 0 0 0-2 1.5V5.5ZM20 5.5A2 2 0 0 0 18 4h-5v16h5a2 2 0 0 1 2 1.5V5.5Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
    shield: '<path d="M12 3 5 6v6c0 5 3 8 7 9 4-1 7-4 7-9V6l-7-3Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  };

  function renderBillsGrid() {
    const grid = document.getElementById("bills-grid");
    grid.innerHTML = BILL_CATALOG.map((b) => `
      <button class="bill-tile sound-click" data-bill="${b.id}">
        <svg viewBox="0 0 24 24">${iconPaths[b.icon]}</svg>
        <strong>${b.label}</strong>
        <span>${b.provider}</span>
      </button>
    `).join("");

    grid.querySelectorAll(".bill-tile").forEach((tile) => {
      tile.addEventListener("click", () => openBillForm(tile.dataset.bill));
    });
  }

  let activeBill = null;
  const billPanel = document.getElementById("bill-pay-panel");
  const billForm = document.getElementById("form-bill");

  function openBillForm(billId) {
    activeBill = BILL_CATALOG.find((b) => b.id === billId);
    document.getElementById("bill-pay-title").textContent = `Pay ${activeBill.label} — ${activeBill.provider}`;
    document.getElementById("bill-account").value = "";
    document.getElementById("bill-amount").value = "";
    document.getElementById("bill-error").textContent = "";
    billPanel.style.display = "block";
    billPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  document.getElementById("bill-cancel").addEventListener("click", () => {
    billPanel.style.display = "none";
  });

  billForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const user = currentUser();
    const errorEl = document.getElementById("bill-error");
    const acctNo = document.getElementById("bill-account").value.trim();
    const amount = parseFloat(document.getElementById("bill-amount").value);

    if (!acctNo || !amount || amount <= 0) {
      errorEl.textContent = "Enter a valid account number and amount.";
      return;
    }
    if (amount > user.checking) {
      errorEl.textContent = "Insufficient funds in your checking account.";
      return;
    }
    errorEl.textContent = "";

    user.checking -= amount;
    user.transactions.unshift({
      id: "t" + Date.now(),
      date: isoNow(),
      desc: `${activeBill.provider} — ${activeBill.label} bill (${acctNo})`,
      type: "bill",
      status: "success",
      amount: -amount,
    });
    persistCurrentUser();
    renderDashboard();
    renderAccounts();
    billPanel.style.display = "none";
    showToast(`${fmtMoney(amount)} paid to ${activeBill.provider}.`);
    Sound.success();
  });

  document.getElementById("quick-mobile-recharge").addEventListener("click", () => {
    navigateTo("bills");
    setTimeout(() => openBillForm("recharge"), 150);
  });

  /* ------------------------------------------------------------
     BOOT
  ------------------------------------------------------------ */
  if (currentAccount && users[currentAccount]) {
    viewAuth.classList.add("hidden");
    appEl.classList.remove("hidden");
    renderAll();
    navigateTo("dashboard");
  }
})();
