
document.addEventListener("DOMContentLoaded", () => {
    const token = localStorage.getItem("token");
    if (!token) {
        showPage("loginPage");
    }
});

window.addEventListener("unhandledrejection", (e) => {
  const msg = (e.reason?.message || "") + (e.reason?.stack || "");

  if (
    msg.includes("site_integration") ||
    msg.includes("writing") ||
    msg.includes("generate")
  ) {
    e.preventDefault();
    return false;
  }
});


const $ = id => document.getElementById(id);
const API_BASE = "https://simple-wallet-backend-moa6.onrender.com";
const RENDER_CHUNK = 12;
let ledgerData = [];
let renderQueue = [];
let renderIndex = 0;
let observer = null;
let autoRefreshIntervalId = null;
const AUTO_REFRESH_MS = 60_000;

/* ---------- Loader / Toast / Errors ---------- */
function showLoader(show = true) {
  const el = $("loader");
  if (!el) return;
  el.classList.toggle("hidden", !show);
}
function showToast(msg, type = "info") {
  const t = $("toast");
  if (!t) return;
  t.textContent = msg;
  t.className = `toast ${type}`;
  t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), 3200);
}
function showErrorPopup(msg, timeout = 4200) {
  const stack = $("errorStack");
  if (!stack) {
    showToast(msg, "error");
    return;
  }
  const card = document.createElement("div");
  card.className = "error-card";
  card.textContent = msg;
  stack.appendChild(card);
  requestAnimationFrame(() => card.classList.add("show"));
  setTimeout(() => {
    card.classList.remove("show");
    setTimeout(() => card.remove(), 300);
  }, timeout);
}

/* ---------- Theme / Dark Mode ---------- */
function toggleDarkMode() {
  const enabled = document.body.classList.toggle("dark");
  try {
    localStorage.setItem("darkMode", enabled ? "on" : "off");
  } catch (e) {}
  showToast(enabled ? "Dark Mode Enabled" : "Light Mode Enabled", "success");
}

/* ======================================================
   🔐 AUTH-PROTECTED NAVIGATION (FIX)
   ====================================================== */
function navTo(id) {
  const token = localStorage.getItem("jwt");

  const protectedPages = [
    "homeScreen",
    "topupScreen",
    "sendScreen",
    "merchantScreen",
    "historySection",
    "profileScreen"
  ];

  if (!token && protectedPages.includes(id)) {
    showToast("Please login first", "error");
    id = "auth";
  }

  document.querySelectorAll(".screen, .auth-card").forEach(s => {
    s.style.display = "none";
    s.classList.remove("active");
  });

  const el = $(id);
  if (el) {
    el.style.display = "block";
    el.classList.add("active");
  }

  // ⭐ FIXED: Force override CSS that hides sidebar
  const sidebar = document.querySelector(".sidebar");
  if (id === "auth") {
    sidebar.style.display = "none";
    sidebar.style.opacity = "0";
    sidebar.style.visibility = "hidden";
  } else {
    sidebar.style.display = "flex";
    sidebar.style.opacity = "1";
    sidebar.style.visibility = "visible";
  }

  if (id !== "auth") {
    document.querySelectorAll(".side-btn").forEach(btn => {
      btn.classList.remove("active");
      if (btn.getAttribute("data-target") === id) {
        btn.classList.add("active");
      }
    });
  }

  if (id === "profileScreen") {
    loadProfile();
  }

  // ⭐⭐ ADD THIS (ONLY MODIFICATION YOU NEED)
  if (id === "historySection") {
    initLedger();    // 🔥 Refresh ledger for the currently logged-in user
  }
}





/* ---------- AUTH ---------- */
async function register() {
  showLoader(true);
  try {
    const username = $("username").value;
    const password = $("password").value;

    const r = await fetch(`${API_BASE}/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password })
    });

    const j = await r.json();
    showLoader(false);

    if (r.ok) showToast("Registered — you may now login", "success");
    else showErrorPopup(j.error || "Register failed");

  } catch (e) {
    showLoader(false);
    showErrorPopup("Register network error");
  }
}



async function login() {
    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;

    try {
        const res = await fetch(`${API_BASE}/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password })
        });

        const data = await res.json();

        if (!res.ok) {
            showErrorPopup(data.error || "Invalid username or password");
            return;
        }

        localStorage.setItem("jwt", data.token);

        await initAccount();

        // ⭐ ADD THIS LINE (required for sidebar + toggle)
        document.body.classList.add("logged-in");

        navTo("homeScreen");

    } catch (err) {
        console.error(err);
        showErrorPopup("Network error");
    }
}



async function initAccount() {
    try {
        const token = localStorage.getItem("jwt");
        if (!token) return;

        const res = await fetch(`${API_BASE}/me/account`, {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json"
            }
        });

        if (!res.ok) {
            console.error("Failed to load account");
            return;
        }

        const acc = await res.json();

        // Update balance on home screen
        $("accountInfo").textContent = `₱ ${(Number(acc.balance) / 100).toFixed(2)}`;

        // Save account_id for transfers
        localStorage.setItem("account_id", acc.account_id);

        // ✅ UPDATE PROFILE NAME IN SIDEBAR
        if (acc.username) {
            $("profileName").textContent = acc.username;
            $("profileId").textContent = "ID: " + acc.account_id;
        }

    } catch (err) {
        console.error("initAccount error:", err);
    }
}







/* Logout modal */
function openLogoutModal() {
  const m = $("confirmModal");
  if (m) {
    m.classList.remove("hidden");
    m.setAttribute("aria-hidden", "false");
  }
}
function closeLogoutModal() {
  const m = $("confirmModal");
  if (m) {
    m.classList.add("hidden");
    m.setAttribute("aria-hidden", "true");
  }
}
function logout() {
  localStorage.removeItem("jwt");
  document.body.classList.remove("logged-in");
  if (autoRefreshIntervalId) {
    clearInterval(autoRefreshIntervalId);
    autoRefreshIntervalId = null;
    $("autoRefreshToggle").innerText = "AutoRefresh: Off";
  }
  navTo("auth");
  $("username").value = "";
  $("password").value = "";
  showToast("Logged out", "success");
}

function openChangePasswordModal() {
  document.getElementById("changePasswordModal").classList.remove("hidden");
}

function closeChangePasswordModal() {
  document.getElementById("changePasswordModal").classList.add("hidden");
}

async function changePassword() {
  const oldPassword = document.getElementById("oldPassword").value;
  const newPassword = document.getElementById("newPassword").value;
  const confirmPassword = document.getElementById("confirmPassword").value;

  if (!oldPassword || !newPassword || !confirmPassword) {
    return showErrorPopup("All fields are required.");
  }

  if (newPassword !== confirmPassword) {
    return showErrorPopup("New passwords do not match!");
  }

  const token = localStorage.getItem("jwt");
  if (!token) return showErrorPopup("Not logged in.");

  try {
    const res = await fetch(`${API_BASE}/auth/change-password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({
        oldPassword,
        newPassword
      })
    });

    const data = await res.json();

    if (!res.ok) {
      return showErrorPopup(data.error || "Password change failed.");
    }

    showToast("Password updated successfully!", "success");
    closeChangePasswordModal();

    document.getElementById("oldPassword").value = "";
    document.getElementById("newPassword").value = "";
    document.getElementById("confirmPassword").value = "";

  } catch (err) {
    console.error(err);
    showErrorPopup("Network error.");
  }
}




/* ---------- Balance + Mini Chart ---------- */
async function updateBalanceWithAnim() {
  try {
    const token = localStorage.getItem("jwt");
    if (!token) return;

    const r = await fetch(`${API_BASE}/me/account`, {
      headers: { authorization: `Bearer ${token}` }
    });

    if (!r.ok) return;

    const j = await r.json();
    $("accountInfo").textContent = 
      `₱ ${(Number(j.balance) / 100).toFixed(2)}`;

    drawMiniChart();
  } catch (e) {}
}
function updateBalance() {
  return updateBalanceWithAnim();
}



function drawMiniChart() {
  const canvas = $("miniChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const data = ledgerData
    .slice(0, 20)
    .map(e => Number(e.balance_after) / 100)
    .reverse();

  const w = canvas.width;
  const h = canvas.height;
  const pad = 8;

  ctx.clearRect(0, 0, w, h);

  if (data.length === 0) return;

  const max = Math.max(...data);
  const min = Math.min(...data);

  ctx.lineWidth = 2.5;
  ctx.strokeStyle = "rgba(255,255,255,1)";
  ctx.beginPath();

  data.forEach((v, i) => {
    const x = pad + (i * (w - 2 * pad)) / (data.length - 1 || 1);
    const y = h - pad - ((v - min) / (max - min || 1)) * (h - 2 * pad);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.stroke();
}

/* ---------- Topup / Transfer ---------- */
/* ---------- Topup ---------- */
async function topup() {
  const pesos = Number($("topupAmount").value);
  if (!pesos || pesos <= 0) return showErrorPopup("Enter a positive peso amount");

  const amount = Math.round(pesos * 100);
  showLoader(true);

  try {
    const token = localStorage.getItem("jwt");

    const r = await fetch(`${API_BASE}/wallet/topup`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ amount })
    });

    const j = await r.json();
    showLoader(false);

    if (r.ok) {
      updateBalance();
      initLedger();
      showToast("Top-up complete", "success");
    } else showErrorPopup(j.error || "Top-up failed");

  } catch (e) {
    showLoader(false);
    showErrorPopup("Top-up network error");
  }
}

/* ---------- Transfer ---------- */
async function transferPesos() {
  const to = Number($("toAccount").value);
  const pesos = Number($("transferPesos").value);

  if (!to || !pesos || pesos <= 0)
    return showErrorPopup("Enter target & positive peso amount");

  const amount = Math.round(pesos * 100);
  showLoader(true);

  try {
    const token = localStorage.getItem("jwt");

    const r = await fetch(`${API_BASE}/wallet/transfer`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ to_account_id: to, amount })
    });

    const j = await r.json();
    showLoader(false);

    if (r.ok) {
      updateBalance();
      initLedger();
      showToast("Transfer sent", "success");
    } else showErrorPopup(j.error || "Transfer failed");

  } catch (e) {
    showLoader(false);
    showErrorPopup("Transfer network error");
  }
}

/* ---------- Purchase ---------- */
async function purchasePesos() {
  const merchant = Number($("merchantId").value);
  const pesos = Number($("purchasePesos").value);

  if (!merchant || !pesos || pesos <= 0)
    return showErrorPopup("Enter merchant ID & valid peso amount");

  const amount = Math.round(pesos * 100);
  showLoader(true);

  try {
    const token = localStorage.getItem("jwt");

    const r = await fetch(`${API_BASE}/wallet/purchase`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ merchant_id: merchant, amount })
    });

    const j = await r.json();
    showLoader(false);

    if (r.ok) {
      updateBalance();
      initLedger();
      showToast("Payment completed", "success");
    } else showErrorPopup(j.error || "Purchase failed");

  } catch (e) {
    showLoader(false);
    showErrorPopup("Purchase network error");
  }
}


/* ---------- Ledger Grouping & Rendering ---------- */
function safeParseMeta(m) {
  if (!m) return {};
  if (typeof m === "object") return m;
  try {
    return JSON.parse(m);
  } catch (e) {
    return {};
  }
}

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(d.getDate()).padStart(2, "0")}`;
}

function friendlyTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const t = d.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });

  if (d.toDateString() === now.toDateString()) return `Today • ${t}`;

  const y = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 1
  );

  if (d.toDateString() === y.toDateString()) return `Yesterday • ${t}`;

  return (
    d.toLocaleDateString([], { month: "short", day: "numeric" }) + ` • ${t}`
  );
}

function txIcon(meta, amount) {
  const type = meta && meta.type ? meta.type.toLowerCase() : null;
  if (type === "topup") return "➕";
  if (type === "purchase") return "🛒";
  if (type === "refund") return "🔁";
  if (type === "transfer") return "💸";
  return amount > 0 ? "➕" : "💸";
}

function txDesc(meta, entry) {
  if (!meta) return "Transaction";
  if (meta.type === "topup") return "Top-up";
  if (meta.type === "purchase") return "Purchase";
  if (meta.type === "refund") return "Refund";
  if (meta.counterparty)
    return entry.amount > 0
      ? `Received from ${meta.counterparty}`
      : `Sent to ${meta.counterparty}`;
  return meta.note || "Transaction";
}

function groupByDate(list) {
  const groups = {};
  list.forEach(e => {
    const k = dayKey(e.created_at);
    if (!groups[k]) groups[k] = [];
    groups[k].push(e);
  });

  return Object.keys(groups)
    .sort((a, b) => b.localeCompare(a))
    .map(k => {
      const any = new Date(k + "T00:00:00");

      const now = new Date();
      const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);

      const readable =
        any.toDateString() === now.toDateString()
          ? "Today"
          : any.toDateString() === y.toDateString()
          ? "Yesterday"
          : any.toLocaleDateString([], {
              month: "short",
              day: "numeric"
            });

      return {
        key: k,
        readable,
        items: groups[k].sort(
          (a, b) => new Date(b.created_at) - new Date(a.created_at)
        )
      };
    });
}

function buildRenderQueue(groups) {
  const q = [];
  groups.forEach(g => {
    q.push({ type: "header", payload: g.readable });
    g.items.forEach(it => q.push({ type: "item", payload: it }));
  });
  return q;
}

function renderNextChunk() {
  const container = $("ledgerList");
  if (!container) return;

  const end = Math.min(renderIndex + RENDER_CHUNK, renderQueue.length);

  for (let i = renderIndex; i < end; i++) {
    const node = renderQueue[i];

    if (node.type === "header") {
      const h = document.createElement("div");
      h.className = "date-group-header";
      h.innerText = node.payload;
      container.appendChild(h);
    } else {
      const e = node.payload;
      const meta = safeParseMeta(e.metadata);
      const amount = Number(e.amount);

      const div = document.createElement("div");
      div.className = `tx-item ${amount > 0 ? "credit" : "debit"}`;

      div.innerHTML = `
        <div class="tx-icon">${txIcon(meta, amount)}</div>
        <div class="tx-main">
          <div class="tx-row">
            <div class="tx-desc">${txDesc(meta, e)}</div>
            <div class="tx-amount">${
              amount > 0 ? "+ " : "- "
            }₱${(Math.abs(amount) / 100).toFixed(2)}</div>
          </div>
          <div class="tx-sub">
            <span>${friendlyTime(e.created_at)}</span>
            <span>Bal: ₱${(Number(e.balance_after) / 100).toFixed(2)}</span>
          </div>
        </div>
      `;

      container.appendChild(div);
      requestAnimationFrame(() => div.classList.add("visible"));
    }
  }

  renderIndex = end;

  const sentinel = $("ledgerSentinel");
  if (renderIndex >= renderQueue.length) {
    sentinel.innerText = "— End of transactions —";
    if (observer) observer.disconnect();
  } else sentinel.innerText = "";
}

function createObserver() {
  if (observer) observer.disconnect();
  const root = $("ledgerScroll");
  if (!root) return;

  observer = new IntersectionObserver(
    entries => {
      entries.forEach(en => {
        if (en.isIntersecting) renderNextChunk();
      });
    },
    { root, threshold: 0.12 }
  );
}

/* Initialize the ledger */
async function initLedger() {
  showLoader(true);

  try {
    const token = localStorage.getItem("jwt");
    const accountId = localStorage.getItem("account_id");   // ⭐ keep this

    // ⭐ FIX: remove the query param but keep your same structure
    const r = await fetch(`${API_BASE}/wallet/ledger`, {
      headers: { authorization: `Bearer ${token}` }
    });

    showLoader(false);

    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      showErrorPopup(j.error || "Failed to load ledger");
      return;
    }

    const data = await r.json();
    ledgerData = data || [];

    const groups = groupByDate(ledgerData);
    renderQueue = buildRenderQueue(groups);
    renderIndex = 0;

    $("ledgerList").innerHTML = "";
    $("ledgerSentinel").innerText = "";

    createObserver();
    observer.observe($("ledgerSentinel"));

    renderNextChunk();
    drawMiniChart();

    showToast("Transactions loaded", "success");

  } catch (e) {
    showLoader(false);
    showErrorPopup("Ledger network error");
  }
}






/* ---------- CSV & PDF EXPORT ---------- */
function exportCSV() {
  if (!ledgerData || ledgerData.length === 0)
    return showErrorPopup("No transactions to export");

  const rows = [
    [
      "id",
      "transaction_id",
      "amount_cents",
      "balance_after_cents",
      "type",
      "counterparty",
      "created_at"
    ]
  ];

  ledgerData.forEach(e => {
    const m = safeParseMeta(e.metadata);
    rows.push([
      e.id,
      e.transaction_id,
      e.amount,
      e.balance_after,
      m.type || "",
      m.counterparty || "",
      e.created_at
    ]);
  });

  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");

  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "ledger_export.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  showToast("CSV exported", "success");
}

function exportPDF() {
  if (!ledgerData || ledgerData.length === 0)
    return showErrorPopup("No transactions to export");

  const win = window.open("", "_blank");
  const html = `
  <html>
  <head><title>Ledger Export</title></head>
  <body>
  <h2>Ledger Export</h2>
  <table style="width:100%;border-collapse:collapse">
    <thead>
      <tr>
        <th style="padding:6px;border-bottom:1px solid #ccc;text-align:left">Time</th>
        <th style="padding:6px;border-bottom:1px solid #ccc;text-align:left">Desc</th>
        <th style="padding:6px;border-bottom:1px solid #ccc;text-align:right">Amount</th>
        <th style="padding:6px;border-bottom:1px solid #ccc;text-align:right">Balance</th>
      </tr>
    </thead>
    <tbody>
      ${ledgerData
        .map(e => {
          const m = safeParseMeta(e.metadata);
          return `
        <tr>
          <td style="padding:6px;border-bottom:1px solid #eee">${friendlyTime(
            e.created_at
          )}</td>
          <td style="padding:6px;border-bottom:1px solid #eee">${txDesc(
            m,
            e
          )}</td>
          <td style="padding:6px;border-bottom:1px solid #eee;text-align:right">
            ${(Number(e.amount) / 100).toFixed(2)}
          </td>
          <td style="padding:6px;border-bottom:1px solid #eee;text-align:right">
            ${(Number(e.balance_after) / 100).toFixed(2)}
          </td>
        </tr>`;
        })
        .join("")}
    </tbody>
  </table>
  </body>
  </html>
  `;

  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
  win.close();

  showToast("PDF (Print) started", "info");
}

/* ---------- Auto-refresh ---------- */
function toggleAutoRefresh() {
  const btn = $("autoRefreshToggle");

  if (autoRefreshIntervalId) {
    clearInterval(autoRefreshIntervalId);
    autoRefreshIntervalId = null;
    btn.innerText = "AutoRefresh: Off";
    showToast("Auto-refresh stopped", "info");
  } else {
    autoRefreshIntervalId = setInterval(() => {
      $("accountInfo").classList.add("pulse");
      setTimeout(() => $("accountInfo").classList.remove("pulse"), 700);
      initLedger();
      updateBalance();
    }, AUTO_REFRESH_MS);

    btn.innerText = "AutoRefresh: On";
    showToast("Auto-refresh started", "success");
  }
}

/* ---------- Startup ---------- */
document.addEventListener("DOMContentLoaded", () => {

  // Always restore theme
  if (localStorage.getItem("darkMode") === "on") {
    document.body.classList.add("dark");
  }

  const token = localStorage.getItem("jwt");

  // If token exists → verify it by loading account
  if (token) {
    initAccount()
      .then(() => {
        navTo("homeScreen");
        initLedger();
      })
      .catch(() => {
        // Token invalid → force logout
        localStorage.removeItem("jwt");
        navTo("auth");
      });
  } else {
    navTo("auth"); // No token → login page
  }

  /* -----------------------------
     FIXED LOGOUT MODAL BUTTONS
  ----------------------------- */
  const modalCancel = document.getElementById("modalCancel");
  const modalConfirm = document.getElementById("modalConfirm");

  if (modalCancel) {
    modalCancel.addEventListener("click", closeLogoutModal);
  }

  if (modalConfirm) {
    modalConfirm.addEventListener("click", () => {
      closeLogoutModal();
      logout();
    });
  }

});






/* ---------- Quick helpers ---------- */
function showQuickTopup() {
  navTo("walletScreen");
  const t = $("topupAmount");
  if (t) t.focus();
}

// (your existing code above… functions, navTo, login, initLedger, etc.)

// -------------------------------------
// Sidebar Toggle Button (add at bottom)
// -------------------------------------
document.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("toggleSidebarBtn");
    if (btn) {
        btn.addEventListener("click", () => {
            document.body.classList.toggle("sidebar-closed");
        });
    }
});

// -----------------------------
// Mobile sidebar helpers
// Append this at the end of app-v2.js
// -----------------------------
document.addEventListener("DOMContentLoaded", () => {
  // Ensure toggle button exists and attach handler (safe if already attached)
  const btn = document.getElementById("toggleSidebarBtn");
  if (btn) {
    btn.addEventListener("click", () => {
      // Toggle closed/open state
      document.body.classList.toggle("sidebar-closed");

      // If opening on mobile, add overlay; if closing, remove it
      ensureOverlay();
    });
  }

  // Create or remove overlay used to close sidebar on mobile
  function ensureOverlay() {
    // Only for small screens: width <= 900px (matches CSS)
    const isMobile = window.innerWidth <= 900;
    let overlay = document.querySelector(".sidebar-overlay");

    if (!isMobile) {
      // remove overlay for large screens
      if (overlay) overlay.remove();
      return;
    }

    // On mobile, show overlay when sidebar is open (body NOT having sidebar-closed)
    const sidebarOpen = !document.body.classList.contains("sidebar-closed");

    if (sidebarOpen) {
      // create overlay if missing
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.className = "sidebar-overlay";
        document.body.appendChild(overlay);

        // close when tapping overlay
        overlay.addEventListener("click", () => {
          document.body.classList.add("sidebar-closed");
          // remove overlay after closing
          overlay.remove();
        });
      }
    } else {
      // closed -> remove overlay if present
      if (overlay) overlay.remove();
    }
  }

  // Keep overlay behavior responsive if user resizes orientation/window
  window.addEventListener("resize", () => {
    // if mobile and sidebar open, ensure overlay; otherwise remove
    ensureOverlay();
  });

  // When app starts, make sure the overlay matches initial state
  ensureOverlay();
});

