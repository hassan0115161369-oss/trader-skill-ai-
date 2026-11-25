(() => {
  const STORAGE_KEYS = {
    USERS: "tsai_users_v1",
    SESSION: "tsai_session_v1",
    CONFIG: "tsai_config_v1"
  };

  const state = {
    authMode: "login",
    currentUser: null,
    ws: null,
    connected: false,
    isVirtualAccount: true,
    balance: null,
    currency: "USD",
    botState: "stopped", // stopped | running | paused
    ticks: [],
    lastPrevEmaDiff: null,
    sessionPnl: 0,
    consecutiveLosses: 0,
    cooldownUntil: 0,
    trades: [],
    activity: [],
    errors: [],
    deleteConfirmStep: 0
  };

  const $ = (id) => document.getElementById(id);

  function nowTime() {
    return new Date().toLocaleTimeString("ar-EG", { hour12: false });
  }

  function logActivity(msg) {
    state.activity.unshift({ time: nowTime(), msg });
    state.activity = state.activity.slice(0, 100);
    renderLogs();
  }

  function logError(msg) {
    state.errors.unshift({ time: nowTime(), msg });
    state.errors = state.errors.slice(0, 100);
    renderLogs();
  }

  function renderLogs() {
    $("activityLog").innerHTML = state.activity.length
      ? state.activity.map((x) => `<div><strong>[${x.time}]</strong> ${escapeHtml(x.msg)}</div>`).join("")
      : `<div class="muted">لا يوجد نشاط بعد.</div>`;

    $("errorLog").innerHTML = state.errors.length
      ? state.errors.map((x) => `<div><strong>[${x.time}]</strong> ${escapeHtml(x.msg)}</div>`).join("")
      : `<div class="muted">لا توجد أخطاء مسجلة.</div>`;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Splash Screen
  window.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => {
      const splash = $("splashScreen");
      splash.classList.add("fade-out");
      setTimeout(() => splash.classList.add("hidden"), 450);
    }, 900);

    bindEvents();
    restoreSessionAndConfig();
  });

  function bindEvents() {
    $("tabLogin").addEventListener("click", () => switchAuthMode("login"));
    $("tabRegister").addEventListener("click", () => switchAuthMode("register"));
    $("authForm").addEventListener("submit", handleAuthSubmit);
    $("logoutBtn").addEventListener("click", handleLogout);
    $("deleteAccountBtn").addEventListener("click", handleDeleteAccountTwoStep);
    $("langToggleBtn").addEventListener("click", toggleLanguage);

    $("brokerSelect").addEventListener("change", handleBrokerChange);
    $("connectDerivBtn").addEventListener("click", connectDeriv);
    $("disconnectDerivBtn").addEventListener("click", disconnectDeriv);

    $("startBotBtn").addEventListener("click", () => setBotState("running"));
    $("pauseBotBtn").addEventListener("click", () => setBotState("paused"));
    $("stopBotBtn").addEventListener("click", () => setBotState("stopped"));

    $("runBacktestBtn").addEventListener("click", runQuickBacktest);
    $("saveTgBtn").addEventListener("click", saveConfigToStorage);
    $("testTgBtn").addEventListener("click", sendTestTelegram);

    $("saveSessionBtn").addEventListener("click", () => {
      saveConfigToStorage();
      logActivity("تم حفظ إعدادات الجلسة والمنصة والمخاطر محلياً.");
    });

    $("exportJsonBtn").addEventListener("click", () => exportReport("json"));
    $("exportCsvBtn").addEventListener("click", () => exportReport("csv"));
    $("exportTxtBtn").addEventListener("click", () => exportReport("txt"));
  }

  function toggleLanguage() {
    const html = document.documentElement;
    const isRtl = html.getAttribute("dir") === "rtl";
    html.setAttribute("dir", isRtl ? "ltr" : "rtl");
    html.setAttribute("lang", isRtl ? "en" : "ar");
    logActivity(isRtl ? "Switched layout direction to LTR (English)." : "تم تبديل الاتجاه إلى RTL (العربية).");
  }

  function switchAuthMode(mode) {
    state.authMode = mode;
    $("tabLogin").classList.toggle("active", mode === "login");
    $("tabRegister").classList.toggle("active", mode === "register");
    $("nameField").classList.toggle("hidden", mode !== "register");
    $("authError").classList.add("hidden");
  }

  function getUsers() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS) || "[]");
    } catch {
      return [];
    }
  }

  function saveUsers(users) {
    localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
  }

  function handleAuthSubmit(e) {
    e.preventDefault();
    const email = $("authEmail").value.trim().toLowerCase();
    const password = $("authPassword").value;
    const name = $("authName").value.trim() || email.split("@")[0];
    const errBox = $("authError");
    errBox.classList.add("hidden");

    const users = getUsers();
    if (state.authMode === "register") {
      if (users.some((u) => u.email === email)) {
        errBox.textContent = "هذا البريد مسجل مسبقاً على هذا الجهاز.";
        errBox.classList.remove("hidden");
        return;
      }
      const user = { id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), name, email, password };
      users.push(user);
      saveUsers(users);
      localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(user));
      enterApp(user);
    } else {
      const found = users.find((u) => u.email === email && u.password === password);
      if (!found) {
        errBox.textContent = "بيانات الدخول غير صحيحة أو الحساب غير موجود محلياً.";
        errBox.classList.remove("hidden");
        return;
      }
      localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(found));
      enterApp(found);
    }
  }

  function handleLogout() {
    disconnectDeriv();
    setBotState("stopped");
    localStorage.removeItem(STORAGE_KEYS.SESSION);
    state.currentUser = null;
    $("appShell").classList.add("hidden");
    $("authSection").classList.remove("hidden");
  }

  function handleDeleteAccountTwoStep() {
    if (!state.currentUser) return;
    if (state.deleteConfirmStep === 0) {
      state.deleteConfirmStep = 1;
      $("deleteAccountBtn").textContent = "تأكيد الحذف (1/2)";
      setTimeout(() => {
        if (state.deleteConfirmStep === 1) {
          state.deleteConfirmStep = 0;
          $("deleteAccountBtn").textContent = "?";
        }
      }, 5000);
      return;
    }
    if (state.deleteConfirmStep === 1) {
      state.deleteConfirmStep = 2;
      $("deleteAccountBtn").textContent = "حذف نهائي (2/2)";
      return;
    }
    const users = getUsers().filter((u) => u.email !== state.currentUser.email);
    saveUsers(users);
    state.deleteConfirmStep = 0;
    $("deleteAccountBtn").textContent = "?";
    handleLogout();
  }

  function restoreSessionAndConfig() {
    try {
      const savedSession = JSON.parse(localStorage.getItem(STORAGE_KEYS.SESSION) || "null");
      if (savedSession) {
        enterApp(savedSession);
      } else {
        $("authSection").classList.remove("hidden");
      }
    } catch {
      $("authSection").classList.remove("hidden");
    }

    try {
      const cfg = JSON.parse(localStorage.getItem(STORAGE_KEYS.CONFIG) || "null");
      if (cfg) {
        if (cfg.derivAppId) $("derivAppId").value = cfg.derivAppId;
        if (cfg.derivSymbol) $("derivSymbol").value = cfg.derivSymbol;
        if (cfg.stakeAmount) $("stakeAmount").value = cfg.stakeAmount;
        if (cfg.riskPercent) $("riskPercent").value = cfg.riskPercent;
        if (cfg.maxDailyLoss) $("maxDailyLoss").value = cfg.maxDailyLoss;
        if (cfg.dailyTarget) $("dailyTarget").value = cfg.dailyTarget;
        if (cfg.maxConsecutiveLosses) $("maxConsecutiveLosses").value = cfg.maxConsecutiveLosses;
        if (cfg.newsGuardMinutes !== undefined) $("newsGuardMinutes").value = cfg.newsGuardMinutes;
        if (cfg.tgChatId) $("tgChatId").value = cfg.tgChatId;
      }
    } catch {}
    handleBrokerChange();
    updateBadges();
  }

  function saveConfigToStorage() {
    const cfg = {
      derivAppId: $("derivAppId").value.trim(),
      derivSymbol: $("derivSymbol").value.trim(),
      stakeAmount: $("stakeAmount").value,
      riskPercent: $("riskPercent").value,
      maxDailyLoss: $("maxDailyLoss").value,
      dailyTarget: $("dailyTarget").value,
      maxConsecutiveLosses: $("maxConsecutiveLosses").value,
      newsGuardMinutes: $("newsGuardMinutes").value,
      tgChatId: $("tgChatId").value.trim()
    };
    localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(cfg));
  }

  function enterApp(user) {
    state.currentUser = user;
    $("authSection").classList.add("hidden");
    $("appShell").classList.remove("hidden");
    logActivity(`مرحباً ${user.name} — تم تحميل الجلسة المحلية.`);
  }

  function handleBrokerChange() {
    const broker = $("brokerSelect").value;
    const notice = $("otherBrokerNotice");
    $("derivConfigBox").classList.toggle("hidden", broker !== "deriv");

    if (broker === "binance") {
      notice.classList.remove("hidden");
      notice.textContent = "Binance: التنفيذ الآلي يتطلب مفاتيح API وخادماً وسيطاً لتوقيع الطلبات بأمان (HMAC)؛ لم يتم إرسال أي أوامر وهمية.";
    } else if (broker === "mt5") {
      notice.classList.remove("hidden");
      notice.textContent = "MetaTrader 5: يتطلب خادماً/جسراً متصلاً بمنصة MT5؛ لا يوجد اتصال مباشر من المتصفح وحده.";
    } else if (broker === "quotex") {
      notice.classList.remove("hidden");
      notice.textContent = "Quotex: لا توفر واجهة برمجة تطبيقات (API) رسمية موثقة؛ تم تعطيل التنفيذ لتجنب أي سلوك غير موثق.";
    } else {
      notice.classList.add("hidden");
    }
  }

  // Deriv WebSocket API v3
  function connectDeriv() {
    disconnectDeriv();
    const appId = $("derivAppId").value.trim() || "1089";
    const symbol = $("derivSymbol").value.trim() || "R_100";
    const token = $("derivToken").value.trim();

    if (!token) {
      logError("يرجى إدخال Deriv API Token للاتصال بالحساب.");
      return;
    }

    const url = `wss://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(appId)}`;
    $("connStatusBadge").textContent = "جاري الاتصال...";
    logActivity(`جاري الاتصال بـ Deriv (${symbol})...`);

    const ws = new WebSocket(url);
    state.ws = ws;

    ws.onopen = () => {
      state.connected = true;
      updateBadges();
      ws.send(JSON.stringify({ authorize: token }));
      ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
      logActivity("تم فتح قناة WebSocket مع Deriv وإرسال طلب التفويض والأسعار.");
    };

    ws.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }

      if (data.error) {
        logError(`خطأ من Deriv: ${data.error.message}`);
        return;
      }

      if (data.msg_type === "authorize" && data.authorize) {
        state.isVirtualAccount = Boolean(data.authorize.is_virtual);
        state.balance = Number(data.authorize.balance);
        state.currency = data.authorize.currency || "USD";
        $("detectedAccountType").textContent = state.isVirtualAccount ? "Demo (تجريبي)" : "Real (حقيقي)";
        $("balanceReadout").textContent = `الرصيد: ${state.balance.toFixed(2)} ${state.currency}`;
        updateBadges();
        logActivity(`تم التحقق من الحساب (${state.isVirtualAccount ? "Demo" : "Real"}) — الرصيد: ${state.balance} ${state.currency}.`);
      }

      if (data.msg_type === "tick" && data.tick) {
        const price = Number(data.tick.quote);
        state.ticks.push(price);
        if (state.ticks.length > 300) state.ticks.shift();
        $("livePrice").textContent = price.toFixed(5);
        $("lastTickTime").textContent = `آخر تحديث: ${nowTime()}`;
        evaluateBotStrategy(price);
      }

      if (data.msg_type === "buy" && data.buy) {
        const contractId = data.buy.contract_id;
        const buyPrice = Number(data.buy.buy_price);
        logActivity(`تم تنفيذ أمر Deriv بنجاح — Contract #${contractId} بقيمة ${buyPrice} ${state.currency}.`);
        notifyTelegram(`تم فتح صفقة Deriv (#${contractId}) على ${symbol} بقيمة ${buyPrice} ${state.currency}.`);
      }
    };

    ws.onerror = () => {
      logError("حدث خطأ في اتصال WebSocket مع Deriv.");
    };

    ws.onclose = () => {
      state.connected = false;
      updateBadges();
      logActivity("تم إغلاق اتصال WebSocket مع Deriv.");
    };
  }

  function disconnectDeriv() {
    if (state.ws) {
      try {
        state.ws.close();
      } catch {}
      state.ws = null;
    }
    state.connected = false;
    updateBadges();
  }

  function computeEma(values, period) {
    if (values.length < period) return null;
    const k = 2 / (period + 1);
    let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < values.length; i++) {
      ema = values[i] * k + ema * (1 - k);
    }
    return ema;
  }

  function isHighImpactNewsBlocked() {
    const minsAhead = Number($("nextHighImpactNewsMinutes").value);
    const guardWindow = Number($("newsGuardMinutes").value) || 0;
    if (!minsAhead || guardWindow <= 0) return false;
    return minsAhead <= guardWindow;
  }

  function checkRiskShield() {
    const maxLoss = Number($("maxDailyLoss").value) || 20;
    const target = Number($("dailyTarget").value) || 30;
    const maxStreak = Number($("maxConsecutiveLosses").value) || 3;

    if (Date.now() < state.cooldownUntil) {
      const remSec = Math.ceil((state.cooldownUntil - Date.now()) / 1000);
      $("shieldStateBadge").textContent = `تبريد (${remSec}ث)`;
      return { allowed: false, reason: "فترة التبريد (15 دقيقة) نشطة بعد خسائر متتالية." };
    }

    if (state.sessionPnl <= -Math.abs(maxLoss)) {
      $("shieldStateBadge").textContent = "حد الخسارة اليومية";
      return { allowed: false, reason: "تم الوصول إلى الحد الأقصى للخسارة اليومية." };
    }

    if (state.sessionPnl >= Math.abs(target)) {
      $("shieldStateBadge").textContent = "تحقق الهدف اليومي";
      return { allowed: false, reason: "تم الوصول إلى هدف الربح اليومي." };
    }

    if (state.consecutiveLosses >= maxStreak) {
      state.cooldownUntil = Date.now() + 15 * 60 * 1000;
      state.consecutiveLosses = 0;
      $("shieldStateBadge").textContent = "تبريد 15 دقيقة";
      notifyTelegram("تم تفعيل فترة التبريد (15 دقيقة) بسبب بلوغ حد الخسائر المتتالية.");
      return { allowed: false, reason: "تم تفعيل فترة تبريد 15 دقيقة بسبب الخسائر المتتالية." };
    }

    $("shieldStateBadge").textContent = "درع المخاطر: نشط";
    return { allowed: true };
  }

  function evaluateBotStrategy(price) {
    if (state.botState !== "running") return;
    if (!state.connected || !state.ws || state.ws.readyState !== WebSocket.OPEN) return;

    // Strict Demo vs Real separation + Real Lock
    if (!state.isVirtualAccount && !$("realTradingLockCheckbox").checked) {
      logError("تم منع التنفيذ على حساب حقيقي (Real) لأن قفل التداول الحقيقي لم يُفك.");
      setBotState("paused");
      return;
    }

    if (isHighImpactNewsBlocked()) {
      logActivity("High-Impact News Guard: التنفيذ متوقف مؤقتاً بسبب قرب خبر عالي التأثير.");
      return;
    }

    const riskCheck = checkRiskShield();
    if (!riskCheck.allowed) {
      logActivity(`Auto-Risk Shield: ${riskCheck.reason}`);
      return;
    }

    const fastP = Math.max(2, Number($("emaFastPeriod").value) || 7);
    const slowP = Math.max(fastP + 1, Number($("emaSlowPeriod").value) || 21);
    const fastEma = computeEma(state.ticks, fastP);
    const slowEma = computeEma(state.ticks, slowP);
    if (fastEma === null || slowEma === null) return;

    const diff = fastEma - slowEma;
    if (state.lastPrevEmaDiff !== null) {
      let contractType = null;
      if (state.lastPrevEmaDiff <= 0 && diff > 0) contractType = "CALL";
      if (state.lastPrevEmaDiff >= 0 && diff < 0) contractType = "PUT";

      if (contractType) {
        const baseStake = Number($("stakeAmount").value) || 1;
        const riskPct = Number($("riskPercent").value) || 1;
        const riskCap = state.balance ? Math.max(0.35, Number((state.balance * (riskPct / 100)).toFixed(2))) : baseStake;
        const amount = Math.min(baseStake, riskCap);
        const symbol = $("derivSymbol").value.trim() || "R_100";

        const buyReq = {
          buy: 1,
          price: amount,
          parameters: {
            contract_type: contractType,
            symbol,
            duration: 1,
            duration_unit: "m",
            basis: "stake",
            amount,
            currency: state.currency || "USD"
          }
        };

        state.ws.send(JSON.stringify(buyReq));
        state.trades.push({
          time: new Date().toISOString(),
          symbol,
          contractType,
          amount,
          accountType: state.isVirtualAccount ? "DEMO" : "REAL",
          price
        });
      }
    }
    state.lastPrevEmaDiff = diff;
  }

  function setBotState(nextState) {
    state.botState = nextState;
    updateBadges();
    const labelMap = { running: "تشغيل", paused: "إيقاف مؤقت", stopped: "إيقاف كامل" };
    logActivity(`حالة الروبوت: ${labelMap[nextState] || nextState}`);
  }

  function updateBadges() {
    $("connStatusBadge").textContent = state.connected ? "متصل" : "غير متصل";
    $("connStatusBadge").className = `badge ${state.connected ? "neon" : "neutral"}`;

    if (!state.connected) {
      $("accountModeBadge").textContent = "حساب: غير محدد";
      $("accountModeBadge").className = "badge neutral";
    } else if (state.isVirtualAccount) {
      $("accountModeBadge").textContent = "حساب: DEMO";
      $("accountModeBadge").className = "badge demo";
    } else {
      $("accountModeBadge").textContent = "حساب: REAL";
      $("accountModeBadge").className = "badge real";
    }

    const botMap = { running: "الروبوت: يعمل", paused: "الروبوت: متوقف مؤقتاً", stopped: "الروبوت: متوقف" };
    $("botStatusBadge").textContent = botMap[state.botState];
    $("botStatusBadge").className = `badge ${state.botState === "running" ? "neon" : "neutral"}`;

    $("sessionPnl").textContent = state.sessionPnl.toFixed(2);
    $("streakCount").textContent = String(state.consecutiveLosses);
  }

  // Quick Backtest on real session ticks or user-supplied series
  function runQuickBacktest() {
    const raw = $("customSeriesInput").value.trim();
    let series = state.ticks.slice();

    if (raw) {
      series = raw
        .split(",")
        .map((n) => Number(n.trim()))
        .filter((n) => Number.isFinite(n));
    }

    const fastP = Math.max(2, Number($("emaFastPeriod").value) || 7);
    const slowP = Math.max(fastP + 1, Number($("emaSlowPeriod").value) || 21);

    if (series.length < slowP + 2) {
      $("backtestResult").textContent = `تحتاج على الأقل ${slowP + 2} نقطة سعرية حقيقية (موجود حالياً: ${series.length}). أضف سلسلة أسعار أو اجمع أسعاراً من السوق.`;
      return;
    }

    let prevDiff = null;
    let signals = 0;
    let wins = 0;
    let losses = 0;

    for (let i = slowP; i < series.length - 1; i++) {
      const slice = series.slice(0, i + 1);
      const f = computeEma(slice, fastP);
      const s = computeEma(slice, slowP);
      const diff = f - s;
      if (prevDiff !== null) {
        const nextMove = series[i + 1] - series[i];
        if (prevDiff <= 0 && diff > 0) {
          signals++;
          if (nextMove > 0) wins++; else if (nextMove < 0) losses++;
        } else if (prevDiff >= 0 && diff < 0) {
          signals++;
          if (nextMove < 0) wins++; else if (nextMove > 0) losses++;
        }
      }
      prevDiff = diff;
    }

    $("backtestResult").innerHTML = `
      <div><strong>عدد النقاط المختبرة:</strong> ${series.length}</div>
      <div><strong>الإشارات المكتشفة:</strong> ${signals} | <strong>موافق للاتجاه التالي:</strong> ${wins} | <strong>معاكس:</strong> ${losses}</div>
      <div class="muted">ملاحظة: اختبار تاريخي مبسط لأغراض التقييم الأولي ولا يضمن نتائج مستقبلية.</div>
    `;
  }

  // Telegram Bot Instant Notifications
  async function notifyTelegram(text) {
    const token = $("tgBotToken").value.trim();
    const chatId = $("tgChatId").value.trim();
    if (!token || !chatId) return;

    try {
      const res = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: `[Trader Skill AI]\n${text}` })
      });
      if (!res.ok) {
        logError(`فشل إرسال إشعار Telegram (HTTP ${res.status}).`);
      }
    } catch (err) {
      logError(`تعذر الوصول إلى Telegram API: ${err.message}`);
    }
  }

  function sendTestTelegram() {
    const token = $("tgBotToken").value.trim();
    const chatId = $("tgChatId").value.trim();
    if (!token || !chatId) {
      logError("أدخل Bot Token و Chat ID أولاً لاختبار Telegram.");
      return;
    }
    notifyTelegram("رسالة اختبار فورية: نظام التنبيهات متصل وجاهز.");
    logActivity("تم إرسال طلب رسالة اختبار إلى Telegram.");
  }

  // Report Export (JSON / CSV / TXT)
  function exportReport(format) {
    const payload = {
      exportedAt: new Date().toISOString(),
      broker: $("brokerSelect").value,
      accountType: state.connected ? (state.isVirtualAccount ? "DEMO" : "REAL") : "DISCONNECTED",
      sessionPnl: state.sessionPnl,
      tradesCount: state.trades.length,
      trades: state.trades,
      activity: state.activity,
      errors: state.errors
    };

    let output = "";
    if (format === "json") {
      output = JSON.stringify(payload, null, 2);
    } else if (format === "csv") {
      const header = "time,symbol,contractType,amount,accountType,price";
      const rows = state.trades.map((t) =>
        [t.time, t.symbol, t.contractType, t.amount, t.accountType, t.price].join(",")
      );
      output = [header, ...rows].join("\n");
    } else {
      output = [
        `Trader Skill AI Report — ${payload.exportedAt}`,
        `Broker: ${payload.broker} | Account: ${payload.accountType} | Session PnL: ${payload.sessionPnl}`,
        `Trades: ${payload.trades.length}`,
        "--- Activity ---",
        ...state.activity.map((a) => `[${a.time}] ${a.msg}`),
        "--- Errors ---",
        ...state.errors.map((e) => `[${e.time}] ${e.msg}`)
      ].join("\n");
    }

    $("exportPreview").value = output;
    logActivity(`تم تجهيز تقرير بصيغة ${format.toUpperCase()} في صندوق المعاينة للنسخ أو الحفظ.`);
  }
})();
