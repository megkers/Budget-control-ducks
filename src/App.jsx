import { useState, useEffect, useRef, useMemo } from "react";
import { sankey as d3Sankey, sankeyLinkHorizontal } from "d3-sankey";

// ------------
// localStorage helpers
// ------------
function loadConfig() {
try {
const raw = localStorage.getItem("budgetConfig");
if (raw) {
let cfg = JSON.parse(raw);
cfg = runMigrations(cfg);
if (cfg.buckets) {
cfg.buckets = cfg.buckets
.filter(b => b.id === "bills" || b.amount > 0)
.map(b => b.id === "bills"
? { ...b, items: b.items.filter(i => i.amt > 0 || i.note === "cc") }
: b);
}
return cfg;
}
} catch(e) {}
return null;
}
function saveConfig(cfg) {
try { localStorage.setItem("budgetConfig", JSON.stringify({ ...cfg, version: SCHEMA_VERSION })); } catch(e) {}
}
function loadData() {
try { const r = localStorage.getItem("budgetData"); return r ? JSON.parse(r) : null; } catch(e) { return null; }
}
function saveData(d) {
try { localStorage.setItem("budgetData", JSON.stringify(d)); } catch(e) {}
}
function loadDebts() {
try { const r = localStorage.getItem("budgetDebts"); return r ? JSON.parse(r) : null; } catch(e) { return null; }
}
function saveDebts(d) {
try { localStorage.setItem("budgetDebts", JSON.stringify(d)); } catch(e) {}
}

// ------------
// Schema versioning + migrations
// ------------
var SCHEMA_VERSION = 2;

var ID_RENAMES = {
  factor: "bill001", groceries: "bill002", dining: "bill003",
  entertainment: "bill004", gasoline: "bill005", clothing: "bill006",
  gifts: "bill007", travel: "bill008", sally_reserve: "bill009",
  house_upkeep: "bill010", savings: "bill011", beauty_reserve: "bill012",
  nephew_savings: "bill013",
};

function runMigrations(cfg) {
  var v = cfg.version || 0;
  if (v >= SCHEMA_VERSION) return cfg;
  var result = cfg;
  if (v < 1) {
    result = {
      ...result,
      buckets: (result.buckets || []).map(function(b) {
        return { ...b, id: ID_RENAMES[b.id] || b.id };
      }),
    };
    try {
      var raw = localStorage.getItem("budgetData");
      if (raw) {
        var data = JSON.parse(raw);
        var migrated = {};
        Object.keys(data).forEach(function(mk) {
          var md = data[mk];
          var newSpent = {};
          Object.keys(md.spent || {}).forEach(function(id) {
            newSpent[ID_RENAMES[id] || id] = md.spent[id];
          });
          migrated[mk] = { ...md, spent: newSpent };
        });
        localStorage.setItem("budgetData", JSON.stringify(migrated));
      }
    } catch(e) {}
  }
  if (v < 2) {
    // v1->v2: move named reserve spend keys into spent[id]
    var RSPEND_KEYS = {
      travelSpent: "bill008", clothingSpent: "bill006", giftsSpent: "bill007",
      groomingSpent: "bill009", savingsSpent: "bill011", houseSpent: "bill010",
      beautySpent: "bill012", nephewWithdrawn: "bill013",
    };
    try {
      var raw2 = localStorage.getItem("budgetData");
      if (raw2) {
        var data2 = JSON.parse(raw2);
        var migrated2 = {};
        Object.keys(data2).forEach(function(mk) {
          var md = data2[mk];
          var newSpent = Object.assign({}, md.spent || {});
          Object.keys(RSPEND_KEYS).forEach(function(sk) {
            if (md[sk] > 0) newSpent[RSPEND_KEYS[sk]] = (newSpent[RSPEND_KEYS[sk]] || 0) + md[sk];
          });
          var cleaned = {};
          Object.keys(md).forEach(function(k) { if (!RSPEND_KEYS[k]) cleaned[k] = md[k]; });
          migrated2[mk] = Object.assign(cleaned, { spent: newSpent });
        });
        localStorage.setItem("budgetData", JSON.stringify(migrated2));
      }
    } catch(e2) {}
  }
  return { ...result, version: SCHEMA_VERSION };
}

// ------------
// CSV parser - shared by welcome import and settings import
// ------------
function parseCSVSections(text) {
function parseRow(line) {
var cols = [];
var cur = "";
var inQ = false;
for (var i = 0; i < line.length; i++) {
var ch = line[i];
if (inQ) {
if (ch === '"' && i + 1 < line.length && line[i + 1] === '"') { cur += '"'; i++; }
else if (ch === '"') { inQ = false; }
else { cur += ch; }
} else {
if (ch === '"') { inQ = true; }
else if (ch === ',') { cols.push(cur); cur = ""; }
else { cur += ch; }
}
}
cols.push(cur);
return cols;
}
var rawLines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
var sections = {};
var curSection = null;
rawLines.forEach(function(line) {
var trimmed = line.trim();
if (trimmed.indexOf("## ") === 0) { curSection = trimmed.slice(3).trim(); sections[curSection] = []; }
else if (curSection && trimmed.length > 0) { sections[curSection].push(parseRow(trimmed)); }
});
return sections;
}

// ------------
// Bill template for wizard
// ------------
const BILL_TEMPLATE = [
{ name: "Rent / Mortgage",          amt: "", day: "", note: "",   category: "Housing" },
{ name: "HOA / Condo fees",         amt: "", day: "", note: "",   category: "Housing" },
{ name: "Home insurance",           amt: "", day: "", note: "",   category: "Housing" },
{ name: "Home maintenance fund",    amt: "", day: "", note: "",   category: "Housing" },
{ name: "Other housing bill",       amt: "", day: "", note: "",   category: "Housing" },
{ name: "Car payment",              amt: "", day: "", note: "",   category: "Transportation" },
{ name: "Car insurance",            amt: "", day: "", note: "",   category: "Transportation" },
{ name: "Gas & fuel",               amt: "", day: "", note: "",   category: "Transportation" },
{ name: "Public transit / Parking", amt: "", day: "", note: "",   category: "Transportation" },
{ name: "Other transportation bill",amt: "", day: "", note: "",   category: "Transportation" },
{ name: "Electric / Gas / Water",   amt: "", day: "", note: "",   category: "Utilities" },
{ name: "Internet",                 amt: "", day: "", note: "",   category: "Utilities" },
{ name: "Phone",                    amt: "", day: "", note: "",   category: "Utilities" },
{ name: "Other utility",            amt: "", day: "", note: "",   category: "Utilities" },
{ name: "Streaming",                amt: "", day: "", note: "",   category: "Subscriptions" },
{ name: "Music",                    amt: "", day: "", note: "",   category: "Subscriptions" },
{ name: "Cloud storage",            amt: "", day: "", note: "",   category: "Subscriptions" },
{ name: "News / Magazines",         amt: "", day: "", note: "",   category: "Subscriptions" },
{ name: "Other subscription",       amt: "", day: "", note: "",   category: "Subscriptions" },
{ name: "Health insurance",         amt: "", day: "", note: "",   category: "Health" },
{ name: "Dental / Vision",          amt: "", day: "", note: "",   category: "Health" },
{ name: "Pet care plan",            amt: "", day: "", note: "",   category: "Health" },
{ name: "Gym / Fitness",            amt: "", day: "", note: "",   category: "Health" },
{ name: "Other health expense",     amt: "", day: "", note: "",   category: "Health" },
{ name: "Credit card payment",      amt: "", day: "", note: "cc", category: "Financial" },
{ name: "Savings transfer",         amt: "", day: "", note: "",   category: "Financial" },
{ name: "Loan / Debt payment",      amt: "", day: "", note: "",   category: "Financial" },
{ name: "Investment / Retirement",  amt: "", day: "", note: "",   category: "Financial" },
{ name: "Other financial payment",  amt: "", day: "", note: "",   category: "Financial" },
{ name: "Donations / Charity",      amt: "", day: "", note: "",   category: "Giving" },
{ name: "Political giving",         amt: "", day: "", note: "",   category: "Giving" },
{ name: "Other donation",           amt: "", day: "", note: "",   category: "Giving" },
{ name: "Childcare / School",       amt: "", day: "", note: "",   category: "Other" },
{ name: "Storage unit",             amt: "", day: "", note: "",   category: "Other" },
{ name: "Other recurring bill",     amt: "", day: "", note: "",   category: "Other" },
];
const BLANK_BILL = () => ({ name: "", amt: "", day: "", note: "", category: "Other" });

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
// Fallback constants used only before first wizard run
const NET_PAY = 0;
const PAYDAY = 1;

const BUCKETS = [
{
id: "bills", label: "Fixed Bills", amount: 2100, color: "#4A9EFF",
items: [
{ name: "Rent / Mortgage",     amt: 1500, day: 1  },
{ name: "Car payment",         amt: 300,  day: 5  },
{ name: "Car insurance",       amt: 100,  day: 5  },
{ name: "Phone",               amt: 60,   day: 10 },
{ name: "Internet",            amt: 60,   day: 10 },
{ name: "Health insurance",    amt: 80,   day: 15 },
{ name: "Credit card payment", amt: 0,    day: 20, note: "cc" },
],
},
{ id: "bill001",        label: "Meal Kits / Delivery",   amount: 0,   color: "#E879F9", items: [{ name: "Meal kits", amt: 0 }] },
{ id: "bill002",     label: "Groceries",              amount: 400, color: "#FFB347", items: [{ name: "Groceries", amt: 400 }] },
{ id: "bill003",        label: "Dining Out",             amount: 200, color: "#FCD34D", items: [{ name: "Dining out", amt: 200 }] },
{ id: "bill004", label: "Entertainment",          amount: 200, color: "#FB923C", items: [{ name: "Entertainment", amt: 200 }] },
{ id: "bill005",      label: "Gas & Fuel",             amount: 100, color: "#FDE68A", items: [{ name: "Gas & fuel", amt: 100 }] },
{ id: "bill006",      label: "Clothing Reserve",       amount: 100, color: "#F97316", items: [{ name: "Monthly contribution", amt: 100 }] },
{ id: "bill007",         label: "Gifts Reserve",          amount: 100, color: "#FDBA74", items: [{ name: "Monthly contribution", amt: 100 }] },
{ id: "bill008",        label: "Travel Reserve",         amount: 200, color: "#7ED4A0", items: [{ name: "Monthly contribution", amt: 200 }] },
{ id: "bill009", label: "Pet Reserve",            amount: 100, color: "#F9A8D4", items: [{ name: "Grooming & vet", amt: 100 }] },
{ id: "bill010",  label: "Home Upkeep",            amount: 100, color: "#60A5FA", items: [{ name: "Home maintenance", amt: 100 }] },
{ id: "bill011",       label: "General Savings",        amount: 200, color: "#B8A9FF", items: [{ name: "Savings transfer", amt: 200 }] },
{ id: "bill012",label: "Beauty Reserve",         amount: 100, color: "#C084FC", items: [{ name: "Hair, nails & beauty", amt: 100 }] },
{ id: "bill013",label: "Other Reserve",          amount: 0,   color: "#34D399", items: [{ name: "Other reserve", amt: 0 }] },
];

function fmt(n, dec = 0) {
return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: dec }).format(Math.abs(n));
}

function ordinal(n) {
const s = ["th","st","nd","rd"];
const v = n % 100;
return n + (s[(v-20)%10] || s[v] || s[0]);
}

function getDefaultData() {
const now = new Date();
const startYear = now.getFullYear();
const r = {};
for (let y = startYear; y <= startYear + 5; y++)
for (let m = 0; m < 12; m++)
r[`${y}-${m}`] = { spent: {} };
return r;
}

// ---- Theme tokens: dark / light (ref: Figma Design System page) ----
function loadTheme() {
  try { return localStorage.getItem("budgetTheme") || "dark"; } catch(e) { return "dark"; }
}
function saveTheme(t) {
  try { localStorage.setItem("budgetTheme", t); } catch(e) {}
}

var THEMES = {
  dark: {
    bg: "#0a0e17", surf: "#131825", surf2: "#0f1218", bord: "#1e2535",
    text1: "#e8eaf0", text2: "#D8DDE8", text3: "#9ca3af", muted: "#4a5568",
    blue: "#4A9EFF", green: "#7ed4a0", red: "#ff4444",
    blueBg: "#0f1f2a", blueBord: "#4A9EFF33",
    redFade: "#ff444455", orangeFade: "#FFB34755",
    greenBg: "#0f2a1a", greenBord: "#7ed4a033",
  },
  light: {
    bg: "#f5f6fb", surf: "#ffffff", surf2: "#e8ecf4", bord: "#dde1ea",
    text1: "#111827", text2: "#374151", text3: "#6b7280", muted: "#bec2ca",
    blue: "#3A95FF", green: "#34d399", red: "#ff4444",
    blueBg: "#eaf2ff", blueBord: "#3A95FF33",
    redFade: "#ff444418", orangeFade: "#FFB34718",
    greenBg: "#eafff0", greenBord: "#34d39933",
  },
};

function resolveTheme(pref) {
  if (pref === "system") {
    try { return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"; } catch(e) { return "dark"; }
  }
  return pref === "light" ? "light" : "dark";
}

// Single module-level theme read for non-reactive components (SetupGate, WizardShell, OnboardingWizard).
// BudgetTracker has its own reactive T via useState which shadows this.
const T = THEMES[resolveTheme(loadTheme())];

//  RESERVE ICONS - Material Symbols Outlined
const RESERVE_ICONS = {
bill008: (color) => <span className="material-symbols-outlined" style={{ fontSize: "28px", color, userSelect: "none" }}>travel_luggage_and_bags</span>,
bill012: (color) => <span className="material-symbols-outlined" style={{ fontSize: "28px", color, userSelect: "none" }}>health_and_beauty</span>,
bill006: (color) => <span className="material-symbols-outlined" style={{ fontSize: "28px", color, userSelect: "none" }}>apparel</span>,
bill007: (color) => <span className="material-symbols-outlined" style={{ fontSize: "28px", color, userSelect: "none" }}>featured_seasonal_and_gifts</span>,
bill009: (color) => <span className="material-symbols-outlined" style={{ fontSize: "28px", color, userSelect: "none" }}>pets</span>,
bill010: (color) => <span className="material-symbols-outlined" style={{ fontSize: "28px", color, userSelect: "none" }}>cottage</span>,
bill011: (color) => <span className="material-symbols-outlined" style={{ fontSize: "28px", color, userSelect: "none" }}>savings</span>,
bill013: (color) => <span className="material-symbols-outlined" style={{ fontSize: "28px", color, userSelect: "none" }}>child_care</span>,
};

// ------------
// Root - gates on localStorage config
// ------------
export default function Root() {
const [ready, setReady] = useState(() => !!loadConfig());
const [rerunConfig, setRerunConfig] = useState(null);
// Increment on every wizard completion so BudgetTracker remounts and re-reads cfg
const [cfgVersion, setCfgVersion] = useState(0);

if (!ready || rerunConfig !== null) {
return <SetupGate
key={ready ? "rerun" : "fresh"}
initialConfig={rerunConfig}
onDone={() => { setRerunConfig(null); setReady(true); setCfgVersion(v => v + 1); }}
onBack={ready ? () => setRerunConfig(null) : null}
/>;
}
return <BudgetTracker
key={cfgVersion}
onReset={() => {
["budgetConfig","budgetData","budgetDebts"].forEach(k => localStorage.removeItem(k));
setReady(false);
}}
onRerunWizard={() => setRerunConfig(loadConfig())}
/>;
}

// ------------
// SetupGate - welcome screen
// ------------
function SetupGate({ onDone, onBack, initialConfig }) {
const [mode, setMode] = useState(initialConfig ? "wizard" : null);
const [csvConfig, setCsvConfig] = useState(null);
if (mode === "wizard") return <OnboardingWizard key={Date.now()} initialConfig={csvConfig || initialConfig} onDone={onDone} onBack={() => { if (onBack) onBack(); else { setCsvConfig(null); setMode(null); } }} />;
return (
<div style={{ minHeight: "100vh", background: T.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", fontFamily: "DM Mono, monospace" }}>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined&family=DM+Mono:wght@400;500&display=block" rel="stylesheet" />
<style>{`.material-symbols-outlined { font-family: 'Material Symbols Outlined'; font-weight: normal; font-style: normal; display: inline-block; line-height: 1; text-transform: none; letter-spacing: normal; word-wrap: normal; white-space: nowrap; direction: ltr; }`}</style>
<div style={{ background: T.surf, border: "1px solid " + T.bord, borderRadius: "16px", padding: "40px 32px", maxWidth: "420px", width: "100%", textAlign: "center" }}>
<div style={{ fontSize: "12px", letterSpacing: "0.2em", color: T.text3, textTransform: "uppercase", marginBottom: "8px" }}>Paycheck Split Tracker</div>
<div style={{ fontSize: "26px", fontWeight: "700", color: T.text1, marginBottom: "12px" }}>Budget Control</div>
<div style={{ fontSize: "12px", color: T.text3, marginBottom: "32px", lineHeight: "1.6" }}>
Your budget lives only on your device. Nothing is sent to a server.
</div>
<div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
<button onClick={() => setMode("wizard")}
style={{ background: T.blue, border: "none", color: T.bg, padding: "13px", borderRadius: "8px", fontSize: "13px", fontWeight: "700", cursor: "pointer", fontFamily: "DM Mono, monospace", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
Set Up My Budget
<span className="material-symbols-outlined" style={{ fontSize: "18px" }}>arrow_forward</span>
</button>
<label style={{ background: "transparent", border: "1px solid " + T.blue, color: T.blue, padding: "13px", borderRadius: "8px", fontSize: "13px", fontWeight: "700", cursor: "pointer", fontFamily: "DM Mono, monospace", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
<span className="material-symbols-outlined" style={{ fontSize: "18px" }}>upload</span>
Import from CSV
<input type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={function(ev) {
  var file = ev.target.files && ev.target.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    try {
      var text = e.target.result;
      var sections = parseCSVSections(text);

      // Validate
      if (!sections["INCOME"] || sections["INCOME"].length < 2) {
        window.alert("CSV is missing an INCOME section with at least one income row.");
        return;
      }

      function dataRows(section) { return (sections[section] || []).slice(1); }
      function num(v) { return parseFloat(v) || 0; }
      var FREQ_MAP = { weekly: 52/12, biweekly: 26/12, semimonthly: 2, monthly: 1 };

      // -- Parse META --
      var metaRows = sections["META"] || [];
      var metaMap = {};
      metaRows.forEach(function(r) { if (r.length >= 2) metaMap[r[0].trim()] = r[1].trim(); });
      var setupDateStr = metaMap["Setup Date"] || "";
      var parsedSetupMonth = new Date().getMonth();
      var parsedSetupYear = new Date().getFullYear();
      if (setupDateStr) {
        var parts = setupDateStr.split(" ");
        var moIdx = MONTHS.indexOf(parts[0]);
        if (moIdx >= 0) parsedSetupMonth = moIdx;
        if (parts[1]) parsedSetupYear = parseInt(parts[1], 10) || parsedSetupYear;
      }
      var parsedPayday = parseInt(metaMap["Primary Payday"], 10) || 1;

      // -- Parse INCOME --
      var incArr = dataRows("INCOME").map(function(r) {
        return {
          label: (r[0] || "").trim() || "Income",
          perPaycheck: num(r[1]),
          frequency: (r[2] || "monthly").trim(),
          payday: parseInt(r[3], 10) || 1,
          netPay: num(r[4]),
        };
      }).filter(function(i) { return i.netPay > 0 || i.perPaycheck > 0; });
      incArr.forEach(function(i) {
        if (!i.netPay && i.perPaycheck > 0) {
          i.netPay = Math.round(i.perPaycheck * (FREQ_MAP[i.frequency] || 1) * 100) / 100;
        }
      });

      // -- Parse FIXED BILLS --
      var billItems = dataRows("FIXED BILLS").map(function(r) {
        return { name: (r[0] || "").trim(), amt: num(r[1]), day: Math.min(28, Math.max(1, parseInt(r[2], 10) || 1)), category: (r[3] || "Other").trim(), note: (r[4] || "").trim() };
      }).filter(function(b) { return b.name && (b.amt > 0 || b.note === "cc"); });
      var billsAmt = Math.round(billItems.filter(function(b) { return b.note !== "cc"; }).reduce(function(s, b) { return s + b.amt; }, 0) * 100) / 100;

      // -- Parse DISCRETIONARY --
      var discColorMap = { bill001: "#E879F9", bill002: "#FFB347", bill003: "#FCD34D", bill004: "#FB923C", bill005: "#FDE68A" };
      var discBkts = dataRows("DISCRETIONARY").map(function(r) {
        var id = (r[0] || "").trim();
        return { id: id, label: (r[1] || "").trim(), amount: num(r[2]), color: discColorMap[id] || T.text3 };
      }).filter(function(b) { return b.id && b.amount > 0; });

      // -- Parse RESERVES --
      var resColorMap = { bill011: "#B8A9FF", bill010: "#60A5FA", bill008: T.green, bill006: "#F97316", bill007: "#FDBA74", bill009: "#F9A8D4", bill012: "#C084FC", bill013: "#34D399" };
      var resBkts = dataRows("RESERVES").map(function(r) {
        var id = (r[0] || "").trim();
        return { id: id, label: (r[1] || "").trim(), amount: num(r[2]), color: resColorMap[id] || T.text3 };
      }).filter(function(b) { return b.id && b.amount > 0; });

      // -- Build config for wizard pre-population --
      var importedCfg = {
        incomes: incArr,
        buckets: [
          { id: "bills", label: "Fixed Bills", amount: billsAmt, color: T.blue, items: billItems },
        ].concat(
          discBkts.map(function(b) { return { id: b.id, label: b.label, amount: b.amount, color: b.color, items: [{ name: b.label, amt: b.amount }] }; }),
          resBkts.map(function(b) { return { id: b.id, label: b.label, amount: b.amount, color: b.color, items: [{ name: b.label, amt: b.amount }] }; })
        ),
        primaryPayday: parsedPayday,
        setupYear: parsedSetupYear,
        setupMonth: parsedSetupMonth,
      };

      // -- Parse DEBTS and save to localStorage (wizard reads them on finish) --
      var newDebts = dataRows("DEBTS").map(function(r, i) {
        return {
          id: "d-imp-" + Date.now() + "-" + i, name: (r[0] || "").trim(), type: (r[1] || "other").trim(),
          balance: num(r[2]), apr: num(r[3]), monthly: num(r[4]), monthlyPrincipal: num(r[5]),
          escrow: num(r[6]), balanceAsOf: (r[7] || new Date().toISOString().slice(0, 10)).trim(),
          grows: (r[8] || "").trim().toLowerCase() === "yes", note: (r[9] || "").trim(),
          linkedBucketId: (r[10] || "").trim() || null, linkedType: (r[11] || "manual").trim(),
        };
      }).filter(function(d) { return d.name; });
      if (newDebts.length > 0) saveDebts(newDebts);

      // -- Parse spend data and save to localStorage (BudgetTracker reads on mount) --
      var newData = {};
      for (var yy = parsedSetupYear; yy <= new Date().getFullYear() + 1; yy++) {
        for (var mm = 0; mm < 12; mm++) {
          newData[yy + "-" + mm] = { spent: {} };
        }
      }
      var spendDiscIds = ["bill001", "bill002", "bill003", "bill004", "bill005"];
      dataRows("MONTHLY SPEND").forEach(function(r) {
        var p = (r[0] || "").trim().split(" ");
        var mi = MONTHS.indexOf(p[0]);
        var yr = parseInt(p[1], 10);
        if (mi < 0 || isNaN(yr)) return;
        var k = yr + "-" + mi;
        if (!newData[k]) newData[k] = { spent: {} };
        for (var ci = 0; ci < spendDiscIds.length; ci++) {
          var val = num(r[ci + 1]);
          if (val > 0) newData[k].spent[spendDiscIds[ci]] = val;
        }
      });
      var rSpendIds = ["bill008", "bill012", "bill006", "bill007", "bill009", "bill011", "bill010"];
      dataRows("RESERVE SPEND").forEach(function(r) {
        var p = (r[0] || "").trim().split(" ");
        var mi = MONTHS.indexOf(p[0]);
        var yr = parseInt(p[1], 10);
        if (mi < 0 || isNaN(yr)) return;
        var k = yr + "-" + mi;
        if (!newData[k]) newData[k] = { spent: {} };
        for (var ci = 0; ci < rSpendIds.length; ci++) {
          var val = num(r[ci + 1]);
          if (val > 0) newData[k].spent[rSpendIds[ci]] = val;
        }
      });
      dataRows("RESERVE TRANSACTIONS").forEach(function(r) {
        var p = (r[0] || "").trim().split(" ");
        var mi = MONTHS.indexOf(p[0]);
        var yr = parseInt(p[1], 10);
        if (mi < 0 || isNaN(yr)) return;
        var k = yr + "-" + mi;
        if (!newData[k]) newData[k] = { spent: {} };
        if (!newData[k].reserveTransactions) newData[k].reserveTransactions = [];
        newData[k].reserveTransactions.push({
          id: "tx-imp-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
          date: (r[1] || "").trim(), merchant: (r[2] || "").trim(), amount: num(r[3]),
          reserveId: (r[4] || "").trim() || null, category: (r[5] || "").trim() || null,
        });
      });
      // Check if any spend data was found
      var hasSpend = Object.keys(newData).some(function(k) {
        var md = newData[k];
        return Object.keys(md.spent || {}).some(function(id) { return md.spent[id] > 0; })
          || (md.reserveTransactions || []).length > 0;
      });
      if (hasSpend) saveData(newData);

      // Summary
      var count = incArr.length + " income, " + billItems.length + " bills, "
        + discBkts.length + " disc, " + resBkts.length + " reserves, " + newDebts.length + " debts";
      window.alert("CSV loaded: " + count + ".\n\nThe wizard will open with your data pre-filled. Review each step and hit Launch when ready.");

      // Launch wizard with imported config
      setCsvConfig(importedCfg);
      setMode("wizard");

    } catch (err) {
      window.alert("Failed to read CSV: " + err.message);
    }
  };
  reader.readAsText(file);
  ev.target.value = "";
}} />
</label>
<div style={{ fontSize: "12px", color: T.text3, lineHeight: "1.5" }}>
Have a CSV from a previous export? Import it to skip manual entry.
</div>
<button onClick={function() {
  // -- Demo data: realistic sample budget --
  var now = new Date();
  var demoYear = now.getFullYear();
  var demoMonth = now.getMonth();
  // Start 3 months ago for history
  var startMonth = demoMonth - 3;
  var startYear = demoYear;
  if (startMonth < 0) { startMonth += 12; startYear--; }

  var demoCfg = {
    incomes: [
      { label: "Main Job", perPaycheck: 2750, netPay: 5500, frequency: "semimonthly", payday: 1 },
    ],
    buckets: [
      { id: "bills", label: "Fixed Bills", amount: 2385, color: T.blue, items: [
        { name: "Rent", amt: 1450, day: 1, note: "", category: "Housing" },
        { name: "Car Payment", amt: 350, day: 5, note: "", category: "Transportation" },
        { name: "Car Insurance", amt: 120, day: 5, note: "", category: "Transportation" },
        { name: "Phone", amt: 65, day: 10, note: "", category: "Utilities" },
        { name: "Internet", amt: 70, day: 12, note: "", category: "Utilities" },
        { name: "Health Insurance", amt: 180, day: 15, note: "", category: "Health" },
        { name: "Streaming", amt: 25, day: 18, note: "", category: "Subscriptions" },
        { name: "Gym", amt: 50, day: 20, note: "", category: "Health" },
        { name: "Credit Card", amt: 0, day: 22, note: "cc", category: "Financial" },
        { name: "Donations", amt: 75, day: 25, note: "", category: "Giving" },
      ]},
      { id: "bill002", label: "Groceries", amount: 450, color: "#FFB347", items: [{ name: "Groceries", amt: 450 }] },
      { id: "bill003", label: "Dining Out", amount: 250, color: "#FCD34D", items: [{ name: "Dining out", amt: 250 }] },
      { id: "bill004", label: "Entertainment", amount: 150, color: "#FB923C", items: [{ name: "Entertainment", amt: 150 }] },
      { id: "bill005", label: "Gas & Fuel", amount: 120, color: "#FDE68A", items: [{ name: "Gas & fuel", amt: 120 }] },
      { id: "bill001", label: "Meal Kits", amount: 200, color: "#E879F9", items: [{ name: "Meal kits", amt: 200 }] },
      { id: "bill011", label: "General Savings", amount: 800, color: "#B8A9FF", items: [{ name: "Savings", amt: 800 }] },
      { id: "bill008", label: "Travel Reserve", amount: 500, color: T.green, items: [{ name: "Travel", amt: 500 }] },
      { id: "bill006", label: "Clothing Reserve", amount: 100, color: "#F97316", items: [{ name: "Clothing", amt: 100 }] },
      { id: "bill007", label: "Gifts Reserve", amount: 175, color: "#FDBA74", items: [{ name: "Gifts", amt: 175 }] },
      { id: "bill009", label: "Pet Reserve", amount: 125, color: "#F9A8D4", items: [{ name: "Pet care", amt: 125 }] },
      { id: "bill010", label: "Home Upkeep", amount: 125, color: "#60A5FA", items: [{ name: "Maintenance", amt: 125 }] },
      { id: "bill012", label: "Beauty Reserve", amount: 120, color: "#C084FC", items: [{ name: "Beauty", amt: 120 }] },
    ],
    primaryPayday: 1,
    setupYear: startYear,
    setupMonth: startMonth,
  };

  // Sample spend data for the past 3 months
  var demoData = {};
  var spendSamples = [
    { bill002: 410, bill003: 225, bill004: 90, bill005: 95, bill001: 180, bill008: 120, bill012: 65, bill006: 0, bill007: 45, bill009: 80, bill011: 0, bill010: 0 },
    { bill002: 475, bill003: 270, bill004: 130, bill005: 110, bill001: 200, bill008: 0, bill012: 85, bill006: 75, bill007: 0, bill009: 0, bill011: 0, bill010: 150 },
    { bill002: 320, bill003: 190, bill004: 75, bill005: 88, bill001: 160, bill008: 480, bill012: 0, bill006: 50, bill007: 200, bill009: 140, bill011: 0, bill010: 0 },
  ];
  for (var dy = startYear; dy <= demoYear + 1; dy++) {
    for (var dm = 0; dm < 12; dm++) {
      demoData[dy + "-" + dm] = { spent: {} };
    }
  }
  // Fill in the 3 sample months
  for (var si = 0; si < 3; si++) {
    var sampleY = startYear;
    var sampleM = startMonth + si;
    if (sampleM > 11) { sampleM -= 12; sampleY++; }
    var sk = sampleY + "-" + sampleM;
    var s = spendSamples[si];
    demoData[sk] = {
      spent: { bill002: s.bill002, bill003: s.bill003, bill004: s.bill004, bill005: s.bill005,
               bill001: s.bill001, bill008: s.bill008, bill012: s.bill012, bill006: s.bill006,
               bill007: s.bill007, bill009: s.bill009, bill011: s.bill011, bill010: s.bill010 },
      reserveTransactions: [],
    };
  }

  var demoDebts = [
    { id: "demo-1", name: "Car Loan", type: "auto", balance: 8450, apr: 4.5, monthly: 350, monthlyPrincipal: 350, escrow: 0, balanceAsOf: now.toISOString().slice(0, 10), grows: false, linkedBucketId: "Car Payment", linkedType: "fixed", note: "" },
    { id: "demo-2", name: "Student Loan", type: "student", balance: 12200, apr: 5.25, monthly: 250, monthlyPrincipal: 250, escrow: 0, balanceAsOf: now.toISOString().slice(0, 10), grows: false, linkedBucketId: null, linkedType: "manual", note: "Federal direct loan" },
  ];

  saveConfig(demoCfg);
  saveData(demoData);
  saveDebts(demoDebts);
  onDone();
}} style={{ background: "none", border: "none", color: T.blue, fontSize: "12px", cursor: "pointer", fontFamily: "DM Mono, monospace", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", padding: "8px 0 0", width: "100%" }}>
<span className="material-symbols-outlined" style={{ fontSize: "16px" }}>visibility</span>
Or just view the demo
</button>
</div>
</div>
</div>
);
}

// ------------
// WizardShell - at module level to avoid iOS keyboard focus loss
// ------------
function WizardShell({ title, subtitle, canNext, onNext, onBack, stepIdx, totalSteps, totalIncome, allocated, step, billsAmt, discAmt, resAmt, children }) {
const remaining = Math.round((totalIncome - allocated) * 100) / 100;
const over = remaining < 0;
// Display: whole-dollar, floored so sub-dollar rounding dust is hidden
const fmt0 = n => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const displayRemaining = over ? Math.ceil(Math.abs(remaining)) : Math.floor(remaining);
const bAmt = billsAmt || 0;
const dAmt = discAmt || 0;
const rAmt = resAmt || 0;
const billsPct = totalIncome > 0 ? Math.min(100, Math.round(bAmt / totalIncome * 1000) / 10) : 0;
const discPct  = totalIncome > 0 ? Math.min(100 - billsPct, Math.round(dAmt / totalIncome * 1000) / 10) : 0;
const resPct   = totalIncome > 0 ? Math.min(100 - billsPct - discPct, Math.round(rAmt / totalIncome * 1000) / 10) : 0;
const scrollRef = useRef(null);
useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }, [stepIdx]);
return (
<div style={{ minHeight: "100vh", background: T.bg, color: T.text1, fontFamily: "DM Mono, monospace", display: "flex", flexDirection: "column" }}>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined&family=DM+Mono:wght@400;500&display=block" rel="stylesheet" />
<style>{`.material-symbols-outlined { font-family: 'Material Symbols Outlined'; font-weight: normal; font-style: normal; display: inline-block; line-height: 1; text-transform: none; letter-spacing: normal; word-wrap: normal; white-space: nowrap; direction: ltr; }`}</style>
<div style={{ borderBottom: "1px solid " + T.bord, padding: "16px 24px 0" }}>
<div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px" }}>
<div style={{ fontSize: "12px", letterSpacing: "0.2em", color: T.text3, textTransform: "uppercase" }}>Budget Setup</div>
<div style={{ fontSize: "12px", color: T.text3 }}>Step {stepIdx + 1} of {totalSteps}</div>
</div>
<div style={{ display: "flex", gap: "6px", marginBottom: "16px" }}>
{Array.from({ length: totalSteps }).map((_, i) => (
<div key={i} style={{ flex: 1, height: "3px", borderRadius: "2px", background: i <= stepIdx ? T.blue : T.bord }} />
))}
</div>
</div>
{totalIncome > 0 && stepIdx >= 2 && (
<div style={{ padding: "10px 24px", borderBottom: "1px solid " + T.bord, background: T.bg }}>
<div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}>
<span style={{ fontSize: "12px", color: T.text3, letterSpacing: "0.1em", textTransform: "uppercase" }}>Allocated</span>
<span style={{ fontSize: "12px", fontWeight: "700", color: over ? T.red : T.text1 }}>
{fmt0(allocated)} / {fmt0(totalIncome)}
<span style={{ marginLeft: "8px", color: over ? T.red : allocated === 0 ? T.text3 : T.green }}>
{over ? ("  ^ " + fmt0(Math.abs(remaining)) + " over") : allocated === 0 ? (fmt0(totalIncome) + " unallocated") : (fmt0(displayRemaining) + " left")}
</span>
</span>
</div>
<div style={{ background: T.bord, borderRadius: "4px", height: "5px", display: "flex", overflow: "hidden", marginBottom: "6px" }}>
{over ? (
<div style={{ height: "100%", width: "100%", background: T.red, transition: "width 0.3s" }} />
) : (
<div style={{ display: "flex", height: "100%", width: "100%" }}>
<div style={{ height: "100%", width: billsPct + "%", background: T.blue, transition: "width 0.3s" }} />
<div style={{ height: "100%", width: discPct + "%", background: "#FFB347", transition: "width 0.3s" }} />
<div style={{ height: "100%", width: resPct + "%", background: T.green, transition: "width 0.3s" }} />
</div>
)}
</div>
{!over && (bAmt > 0 || dAmt > 0 || rAmt > 0) && (
<div style={{ display: "flex", gap: "12px" }}>
{bAmt > 0 && (
<div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
<div style={{ width: "8px", height: "8px", borderRadius: "2px", background: T.blue, flexShrink: 0 }} />
<span style={{ fontSize: "12px", color: T.text3 }}>Bills</span>
</div>
)}
{dAmt > 0 && (
<div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
<div style={{ width: "8px", height: "8px", borderRadius: "2px", background: "#FFB347", flexShrink: 0 }} />
<span style={{ fontSize: "12px", color: T.text3 }}>Spending</span>
</div>
)}
{rAmt > 0 && (
<div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
<div style={{ width: "8px", height: "8px", borderRadius: "2px", background: T.green, flexShrink: 0 }} />
<span style={{ fontSize: "12px", color: T.text3 }}>Savings</span>
</div>
)}
</div>
)}
</div>
)}
<div ref={scrollRef} style={{ flex: 1, padding: "24px 24px 100px", maxWidth: "600px", overflowY: "auto" }}>
<div style={{ fontSize: "20px", fontWeight: "700", color: T.text1, marginBottom: "4px" }}>{title}</div>
{subtitle && <div style={{ fontSize: "13px", color: T.text3, marginBottom: "24px", lineHeight: "1.6" }}>{subtitle}</div>}
{children}
</div>
<div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: T.bg, borderTop: "1px solid " + T.bord, padding: "14px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
<button onClick={onBack} style={{ background: "transparent", border: "1px solid " + T.bord, color: T.text3, padding: "10px 20px", borderRadius: "8px", fontSize: "12px", cursor: "pointer", fontFamily: "DM Mono, monospace", display: "flex", alignItems: "center", gap: "6px" }}>
<span className="material-symbols-outlined" style={{ fontSize: "18px" }}>arrow_back</span>Back
</button>
<button onClick={onNext} disabled={!canNext} style={{ background: canNext ? T.blue : T.bord, border: "none", color: canNext ? T.bg : T.muted, padding: "10px 24px", borderRadius: "8px", fontSize: "13px", fontWeight: "700", cursor: canNext ? "pointer" : "not-allowed", fontFamily: "DM Mono, monospace", display: "flex", alignItems: "center", gap: "6px" }}>
{step === "review" ? "Launch Budget" : "Continue"}
<span className="material-symbols-outlined" style={{ fontSize: "18px" }}>arrow_forward</span>
</button>
</div>
</div>
);
}

// ------------
// OnboardingWizard
// ------------
function OnboardingWizard({ onDone, onBack, initialConfig }) {
const STEPS = ["income", "howbudgets", "bills", "discretionary", "reserves", "debt", "review"];
const [step, setStep] = useState("income");
const stepIdx = STEPS.indexOf(step);
const next = () => setStep(STEPS[stepIdx + 1]);
const prev = () => stepIdx > 0 ? setStep(STEPS[stepIdx - 1]) : onBack();

const FREQ = { weekly: 52/12, biweekly: 26/12, semimonthly: 2, monthly: 1 };

// Pre-populate from saved config if re-running, otherwise start blank
const [incomes, setIncomes] = useState(() => {
if (initialConfig && initialConfig.incomes && initialConfig.incomes.length) {
return initialConfig.incomes.map(i => ({
label: i.label || "Main Job",
netPay: String(i.perPaycheck || i.netPay || ""),
payday: String(i.payday || ""),
frequency: i.frequency || "monthly",
}));
}
return [{ label: "Main Job", netPay: "", payday: "", frequency: "monthly" }];
});

const [bills, setBills] = useState(() => {
if ((initialConfig && initialConfig.buckets)) {
const savedBills = initialConfig.buckets.find(b => b.id === "bills");
// Start with full template, then fill in saved amounts/days where names match
return BILL_TEMPLATE.map(t => {
const saved = (savedBills && savedBills.items && savedBills.items.find(i => i.name === t.name));
return saved
? { ...t, amt: String(saved.amt || ""), day: String(saved.day || ""), note: saved.note || t.note }
: { ...t };
});
}
return BILL_TEMPLATE.map(i => ({ ...i }));
});

const DISC_IDS = ["bill002", "bill005", "bill003", "bill004", "bill001"];
const DISC_DEFAULTS = [
{ id: "bill002",    label: "Groceries",          amount: "", color: "#FFB347" },
{ id: "bill005",     label: "Gas & Fuel",          amount: "", color: "#FDE68A" },
{ id: "bill003",       label: "Dining Out",          amount: "", color: "#FCD34D" },
{ id: "bill004",label: "Entertainment",       amount: "", color: "#FB923C" },
{ id: "bill001",       label: "Meal Kits / Delivery",amount: "", color: "#E879F9" },
];
const [disc, setDisc] = useState(() => {
if ((initialConfig && initialConfig.buckets)) {
return DISC_DEFAULTS.map(d => {
const saved = initialConfig.buckets.find(b => b.id === d.id);
return saved ? { ...d, label: saved.label, amount: String(saved.amount || "") } : d;
});
}
return DISC_DEFAULTS;
});

const RESERVE_DEFAULTS = [
{ id: "bill011",       label: "General Savings",  amount: "", color: "#B8A9FF" },
{ id: "bill010",  label: "Home Upkeep",      amount: "", color: "#60A5FA" },
{ id: "bill008",        label: "Travel Reserve",   amount: "", color: T.green },
{ id: "bill006",      label: "Clothing Reserve", amount: "", color: "#F97316" },
{ id: "bill007",         label: "Gifts Reserve",    amount: "", color: "#FDBA74" },
{ id: "bill009", label: "Pet Reserve",      amount: "", color: "#F9A8D4" },
{ id: "bill012",label: "Beauty Reserve",   amount: "", color: "#C084FC" },
{ id: "bill013",label: "Other Reserve",    amount: "", color: "#34D399" },
];
const [reserves, setReserves] = useState(() => {
if ((initialConfig && initialConfig.buckets)) {
return RESERVE_DEFAULTS.map(r => {
const saved = initialConfig.buckets.find(b => b.id === r.id);
return saved ? { ...r, label: saved.label, amount: String(saved.amount || "") } : r;
});
}
return RESERVE_DEFAULTS;
});

const DEBT_TYPES = ["medical", "auto", "mortgage", "student", "credit card", "other"];
const newDebt = () => ({ id: "d-" + Date.now(), name: "", type: "other", balance: "", apr: "", balanceAsOf: new Date().toISOString().slice(0, 10), linkedBucketId: null, linkedType: "manual", monthly: 0, monthlyPrincipal: 0, note: "" });
const [debts, setDebts] = useState(() => {
if (initialConfig) {
  // Re-run or CSV import: load saved debts so they appear pre-filled
  var saved = loadDebts() || [];
  if (saved.length > 0) {
    return saved.map(function(d) {
      return {
        id: d.id || ("d-" + Date.now() + "-" + Math.random().toString(36).slice(2, 5)),
        name: d.name || "",
        type: d.type || "other",
        balance: d.balance != null ? String(d.balance) : "",
        apr: d.apr != null ? String(d.apr) : "",
        balanceAsOf: d.balanceAsOf || new Date().toISOString().slice(0, 10),
        linkedBucketId: d.linkedBucketId || null,
        linkedType: d.linkedType || "manual",
        monthly: d.monthly || 0,
        monthlyPrincipal: d.monthlyPrincipal || 0,
        escrow: d.escrow || 0,
        grows: d.grows || false,
        note: d.note || "",
      };
    });
  }
}
return [];
});

const totalIncome = Math.round(incomes.reduce((s, i) => s + (parseFloat(i.netPay) || 0) * (FREQ[i.frequency] || 1), 0) * 100) / 100;
const billsTotal  = bills.filter(b => b.note !== "cc").reduce((s, b) => s + (parseFloat(b.amt) || 0), 0);
const discTotal   = disc.reduce((s, b) => s + (parseFloat(b.amount) || 0), 0);
const resTotal    = reserves.reduce((s, b) => s + (parseFloat(b.amount) || 0), 0);
const allocated   = Math.round((billsTotal + discTotal + resTotal) * 100) / 100;
const unallocated = Math.round((totalIncome - allocated) * 100) / 100;

const shellProps = { stepIdx, totalSteps: STEPS.length, totalIncome, allocated, step, onBack: prev, billsAmt: billsTotal, discAmt: discTotal, resAmt: resTotal };

function finish() {
const filledBills = bills.filter(b => b.name.trim() && parseFloat(b.amt) > 0);
const billsAmt    = Math.round(filledBills.filter(b => b.note !== "cc").reduce((s, b) => s + (parseFloat(b.amt) || 0), 0) * 100) / 100;
// Preserve setupYear/setupMonth from prior save so re-running wizard doesn't reset the start date
const existingCfg = loadConfig() || {};
const now0 = new Date();
const cfg = {
incomes: incomes.map(i => ({
label: i.label || "Income",
netPay: Math.round((parseFloat(i.netPay) || 0) * (FREQ[i.frequency] || 1) * 100) / 100,
payday: parseInt(i.payday, 10) || 1,
frequency: i.frequency,
perPaycheck: parseFloat(i.netPay) || 0,
})),
buckets: [
{ id: "bills", label: "Fixed Bills", amount: billsAmt, color: T.blue,
items: filledBills.map(b => ({ ...b, amt: parseFloat(b.amt) || 0, day: Math.min(28, Math.max(1, parseInt(b.day, 10) || 1)) })) },
...disc.filter(b => parseFloat(b.amount) > 0).map(b => ({ id: b.id, label: b.label, amount: parseFloat(b.amount), color: b.color, items: [{ name: b.label, amt: parseFloat(b.amount) }] })),
...reserves.filter(b => parseFloat(b.amount) > 0).map(b => ({ id: b.id, label: b.label, amount: parseFloat(b.amount), color: b.color, items: [{ name: b.label, amt: parseFloat(b.amount) }] })),
],
primaryPayday: parseInt((incomes[0] && incomes[0].payday), 10) || 1,
// setupYear/setupMonth mark the first month of data -- preserved on re-run
setupYear:  existingCfg.setupYear  || now0.getFullYear(),
setupMonth: existingCfg.setupMonth || now0.getMonth(),
};
saveConfig(cfg);
// Save wizard-entered debts to localStorage so BudgetTracker picks them up
const filledDebts = debts.filter(d => d.name.trim() || d.linkedBucketId).map(d => ({
...d,
balance: parseFloat(d.balance) || 0,
apr: parseFloat(d.apr) || 0,
monthly: parseFloat(d.monthly) || 0,
monthlyPrincipal: parseFloat(d.monthly) || 0,
}));
saveDebts(filledDebts);
onDone();
}

// -- Step: income --
if (step === "income") {
const FREQ_OPTS = [
{ value: "weekly",      label: "Weekly",   note: "based on 52 paychecks / year" },
{ value: "biweekly",    label: "Biweekly", note: "based on 26 paychecks / year" },
{ value: "semimonthly", label: "2x / mo",  note: "2 paychecks / month" },
{ value: "monthly",     label: "Monthly",  note: "1 paycheck / month" },
];
const fmt0 = n => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const canNext = incomes.every(i => {
if (!parseFloat(i.netPay) > 0) return false;
if (i.frequency === "monthly" || i.frequency === "semimonthly") {
if (!i.payday || parseInt(i.payday) < 1 || parseInt(i.payday) > 28) return false;
}
return true;
});
return (
<WizardShell {...shellProps} title="Your income" subtitle="Add each paycheck you receive. We'll calculate your monthly total." canNext={canNext} onNext={next}>
{incomes.map((inc, i) => {
const mult    = FREQ[inc.frequency] || 1;
const monthly = Math.round((parseFloat(inc.netPay) || 0) * mult);
const upd     = patch => setIncomes(p => p.map((x, j) => j === i ? { ...x, ...patch } : x));
return (
<div key={i} style={{ background: T.surf, border: "1px solid " + T.bord, borderRadius: "10px", padding: "16px", marginBottom: "10px" }}>
<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
<div style={{ fontSize: "12px", fontWeight: "700", color: T.blue }}>Income stream {i + 1}{i === 0 ? " - Primary" : ""}</div>
{incomes.length > 1 && (
<button onClick={() => setIncomes(p => p.filter((_, j) => j !== i))} style={{ background: "none", border: "none", color: T.red, cursor: "pointer", display: "flex", alignItems: "center" }}>
<span className="material-symbols-outlined" style={{ fontSize: "20px" }}>delete</span>
</button>
)}
</div>
<div style={{ marginBottom: "12px" }}>
<div style={{ fontSize: "12px", letterSpacing: "0.15em", color: T.text3, textTransform: "uppercase", marginBottom: "6px" }}>Label</div>
<input type="text" placeholder="e.g. Main Job" value={inc.label} onChange={e => upd({ label: e.target.value })} style={{ background: T.bg, border: "1px solid " + T.bord, color: T.text1, padding: "8px 10px", borderRadius: "6px", fontSize: "16px", width: "100%", boxSizing: "border-box" }} />
</div>
<div style={{ marginBottom: "12px" }}>
<div style={{ fontSize: "12px", letterSpacing: "0.15em", color: T.text3, textTransform: "uppercase", marginBottom: "6px" }}>How often are you paid?</div>
<div style={{ display: "flex", background: T.bg, borderRadius: "8px", padding: "3px" }}>
{FREQ_OPTS.map(opt => (
<div key={opt.value} onClick={() => upd({ frequency: opt.value })} style={{ flex: 1, padding: "7px 4px", textAlign: "center", cursor: "pointer", borderRadius: "6px", fontSize: "12px", textTransform: "uppercase", background: inc.frequency === opt.value ? T.blue : "transparent", color: inc.frequency === opt.value ? T.bg : T.text3, fontWeight: inc.frequency === opt.value ? "700" : "400" }}>
{opt.label}
</div>
))}
</div>
</div>
<div style={{ marginBottom: "12px" }}>
<div style={{ fontSize: "12px", letterSpacing: "0.15em", color: T.text3, textTransform: "uppercase", marginBottom: "6px" }}>Amount per paycheck (after tax)</div>
<input type="number" placeholder="e.g. 1800" value={inc.netPay} onChange={e => upd({ netPay: e.target.value })} style={{ background: T.bg, border: "1px solid " + T.bord, color: T.text1, padding: "8px 10px", borderRadius: "6px", fontSize: "20px", width: "100%", boxSizing: "border-box" }} />
</div>
{inc.frequency === "monthly" && (
<div style={{ marginBottom: "12px" }}>
<div style={{ fontSize: "12px", letterSpacing: "0.15em", color: T.text3, textTransform: "uppercase", marginBottom: "6px" }}>Payday - day of month</div>
<input type="number" placeholder="e.g. 27" min="1" max="28" value={inc.payday} onChange={e => upd({ payday: e.target.value })} style={{ background: T.bg, border: "1px solid " + T.bord, color: T.text1, padding: "8px 10px", borderRadius: "6px", fontSize: "16px", width: "100px", boxSizing: "border-box" }} />
</div>
)}
{inc.frequency === "semimonthly" && (
<div style={{ marginBottom: "12px" }}>
<div style={{ fontSize: "12px", letterSpacing: "0.15em", color: T.text3, textTransform: "uppercase", marginBottom: "6px" }}>Payday days</div>
<div style={{ display: "flex", gap: "10px" }}>
<input type="number" placeholder="e.g. 1" min="1" max="28" value={inc.payday} onChange={e => upd({ payday: e.target.value })} style={{ background: T.bg, border: "1px solid " + T.bord, color: T.text1, padding: "8px 10px", borderRadius: "6px", fontSize: "16px", width: "80px" }} />
<input type="number" placeholder="e.g. 15" min="1" max="28" value={inc.payday2 || ""} onChange={e => upd({ payday2: e.target.value })} style={{ background: T.bg, border: "1px solid " + T.bord, color: T.text1, padding: "8px 10px", borderRadius: "6px", fontSize: "16px", width: "80px" }} />
</div>
</div>
)}
{(inc.frequency === "weekly" || inc.frequency === "biweekly") && (
<div style={{ background: T.bg, border: "1px solid " + T.bord, borderRadius: "8px", padding: "10px 12px", marginBottom: "12px", fontSize: "12px", color: T.text3 }}>
Since your payday shifts each week, we calculate your monthly total automatically. No fixed day needed.
</div>
)}
{parseFloat(inc.netPay) > 0 && (
<div style={{ background: T.blueBg, border: "1px solid " + T.blueBord, borderRadius: "8px", padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
<div>
<div style={{ fontSize: "12px", letterSpacing: "0.15em", color: T.text3, textTransform: "uppercase", marginBottom: "2px" }}>Monthly total</div>
<div style={{ fontSize: "22px", fontWeight: "700", color: T.blue }}>{fmt0(monthly)}</div>
<div style={{ fontSize: "12px", color: T.text3, marginTop: "2px" }}>{(FREQ_OPTS.find(f => f.value === inc.frequency) && FREQ_OPTS.find(f => f.value === inc.frequency).note)}</div>
</div>
<span className="material-symbols-outlined" style={{ fontSize: "36px", color: T.blue, opacity: 0.4 }}>payments</span>
</div>
)}
</div>
);
})}
{incomes.length < 4 && (
<button onClick={() => setIncomes(p => [...p, { label: "", netPay: "", payday: "", frequency: "monthly" }])} style={{ background: "transparent", border: "1px dashed " + T.bord, color: T.text3, padding: "10px 16px", borderRadius: "8px", fontSize: "12px", cursor: "pointer", width: "100%", fontFamily: "DM Mono, monospace", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
<span className="material-symbols-outlined" style={{ fontSize: "18px" }}>add</span>Add another income stream
</button>
)}
</WizardShell>
);
}

// -- Step: howbudgets --
if (step === "howbudgets") {
var fmt0h = function(n) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n); };
return (
<WizardShell {...shellProps} title="How this works" subtitle="" canNext={true} onNext={next}>
<div style={{ fontSize: "13px", color: T.text3, marginBottom: "24px", lineHeight: "1.6" }}>
Your paycheck gets split into three pools. The next three steps will fill each one.
</div>
<div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>

<div style={{ background: T.surf, border: "1px solid #4A9EFF44", borderRadius: "12px", padding: "16px 18px", display: "flex", alignItems: "center", gap: "14px" }}>
<div style={{ width: "44px", height: "44px", borderRadius: "10px", background: "#4A9EFF22", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
<span className="material-symbols-outlined" style={{ fontSize: "24px", color: T.blue }}>lock</span>
</div>
<div>
<div style={{ fontSize: "14px", fontWeight: "700", color: T.blue, marginBottom: "4px" }}>Fixed Bills</div>
<div style={{ fontSize: "12px", color: T.text3, lineHeight: "1.5" }}>Same amount, same day, every month. Rent, insurance, car payment.</div>
</div>
</div>

<div style={{ display: "flex", justifyContent: "center" }}>
<span className="material-symbols-outlined" style={{ fontSize: "20px", color: T.bord }}>arrow_downward</span>
</div>

<div style={{ background: T.surf, border: "1px solid #FFB34744", borderRadius: "12px", padding: "16px 18px", display: "flex", alignItems: "center", gap: "14px" }}>
<div style={{ width: "44px", height: "44px", borderRadius: "10px", background: "#FFB34722", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
<span className="material-symbols-outlined" style={{ fontSize: "24px", color: "#FFB347" }}>shopping_cart</span>
</div>
<div>
<div style={{ fontSize: "14px", fontWeight: "700", color: "#FFB347", marginBottom: "4px" }}>Discretionary</div>
<div style={{ fontSize: "12px", color: T.text3, lineHeight: "1.5" }}>You set a monthly target, but what you actually spend varies. Groceries, dining, gas.</div>
</div>
</div>

<div style={{ display: "flex", justifyContent: "center" }}>
<span className="material-symbols-outlined" style={{ fontSize: "20px", color: T.bord }}>arrow_downward</span>
</div>

<div style={{ background: T.surf, border: "1px solid #B8A9FF44", borderRadius: "12px", padding: "16px 18px", display: "flex", alignItems: "center", gap: "14px" }}>
<div style={{ width: "44px", height: "44px", borderRadius: "10px", background: "#B8A9FF22", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
<span className="material-symbols-outlined" style={{ fontSize: "24px", color: "#B8A9FF" }}>savings</span>
</div>
<div>
<div style={{ fontSize: "14px", fontWeight: "700", color: "#B8A9FF", marginBottom: "4px" }}>Reserves</div>
<div style={{ fontSize: "12px", color: T.text3, lineHeight: "1.5" }}>A little each month for bigger expenses. Travel, vet visits, home repairs.</div>
</div>
</div>

</div>

{totalIncome > 0 && (
<div style={{ background: T.blueBg, border: "1px solid " + T.blueBord, borderRadius: "10px", padding: "14px 16px", marginTop: "20px", textAlign: "center" }}>
<div style={{ fontSize: "12px", color: T.text3, marginBottom: "4px" }}>Your monthly income</div>
<div style={{ fontSize: "22px", fontWeight: "700", color: T.green }}>{fmt0h(totalIncome)}</div>
<div style={{ fontSize: "12px", color: T.text3, marginTop: "4px" }}>will be split across these three pools</div>
</div>
)}
</WizardShell>
);
}

// -- Step: bills --
if (step === "bills") {
const CAT_ORDER = ["Housing","Transportation","Utilities","Subscriptions","Health","Financial","Giving","Other"];
const grouped = bills.reduce((acc, b, i) => {
const c = b.category || "Other";
if (!acc[c]) acc[c] = [];
acc[c].push({ b, i });
return acc;
}, {});
const cats = CAT_ORDER.filter(c => grouped[c]);
return (
<WizardShell {...shellProps} title="Fixed bills" subtitle="Fixed bills are predictable - the same amount, due around the same day each month. Think rent, insurance, or a car payment. Leave rows blank to skip them - they won't be saved." canNext={true} onNext={next}>
<div style={{ background: T.surf, borderRadius: "8px", padding: "10px 14px", marginBottom: "20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
<span style={{ fontSize: "12px", color: T.text3 }}>Bills total so far</span>
<span style={{ fontSize: "14px", fontWeight: "700", color: T.blue }}>
{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(billsTotal)}/mo
</span>
</div>
{cats.map(cat => (
<div key={cat} style={{ marginBottom: "20px" }}>
<div style={{ fontSize: "12px", letterSpacing: "0.15em", textTransform: "uppercase", color: T.blue, marginBottom: "8px", paddingBottom: "6px", borderBottom: "1px solid " + T.bord }}>{cat}</div>
{grouped[cat].map(({ b, i }) => {
const dayVal = parseInt(b.day, 10);
const dayErr = b.day !== "" && (isNaN(dayVal) || dayVal < 1 || dayVal > 28);
return (
<div key={i} style={{ background: T.surf, border: "1px solid " + T.bord, borderRadius: "10px", padding: "10px 12px", marginBottom: "6px" }}>
<div style={{ display: "grid", gridTemplateColumns: "1fr 65px 48px auto", gap: "6px", alignItems: "center" }}>
<input type="text" placeholder="Bill name" value={b.name} onChange={e => setBills(p => p.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} style={{ background: T.bg, border: "1px solid " + T.bord, color: T.text1, padding: "8px 6px", borderRadius: "6px", fontSize: "14px", minWidth: 0 }} />
<input type="number" placeholder="Amt" value={b.amt || ""} onChange={e => setBills(p => p.map((x, j) => j === i ? { ...x, amt: e.target.value } : x))} disabled={b.note === "cc"} style={{ background: T.bg, border: "1px solid " + T.bord, color: T.text1, padding: "8px 6px", borderRadius: "6px", fontSize: "14px", minWidth: 0 }} />
<input type="number" placeholder="Due" min="1" max="28" value={b.day || ""} onChange={e => setBills(p => p.map((x, j) => j === i ? { ...x, day: e.target.value } : x))} onBlur={e => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) setBills(p => p.map((x, j) => j === i ? { ...x, day: String(Math.min(28, Math.max(1, v))) } : x)); }} style={{ background: T.bg, border: `1px solid ${dayErr ? T.red : T.bord}`, color: T.text1, padding: "8px 6px", borderRadius: "6px", fontSize: "14px", minWidth: 0 }} />
<button onClick={() => setBills(p => p.filter((_, j) => j !== i))} style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", display: "flex", alignItems: "center" }}>
<span className="material-symbols-outlined" style={{ fontSize: "20px" }}>delete</span>
</button>
</div>
{dayErr && <div style={{ fontSize: "12px", color: T.red, marginTop: "4px" }}>Day must be 1-28</div>}
{b.note === "cc" && (
<div style={{ marginTop: "8px", display: "flex", alignItems: "flex-start", gap: "7px" }}>
<div style={{ width: "14px", height: "14px", borderRadius: "3px", border: "2px solid " + T.blue, background: T.blue, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: "2px" }}>
<span className="material-symbols-outlined" style={{ color: T.bg, fontSize: "12px" }}>check</span>
</div>
<span style={{ fontSize: "12px", color: T.text3, lineHeight: "1.5" }}>Don't apply to this month's budget - this is a credit card payment whose balance changes each month</span>
</div>
)}
</div>
);
})}
<button onClick={() => setBills(p => [...p, { ...BLANK_BILL(), category: cat }])} style={{ background: "transparent", border: "1px dashed " + T.bord, color: T.muted, padding: "7px 14px", borderRadius: "8px", fontSize: "12px", cursor: "pointer", width: "100%", fontFamily: "DM Mono, monospace", marginTop: "2px", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
<span className="material-symbols-outlined" style={{ fontSize: "16px" }}>add</span>Add {cat.toLowerCase()} bill
</button>
</div>
))}
<div style={{ display: "flex", justifyContent: "center", marginTop: "8px" }}>
{bills.some(b => b.category)
? <button onClick={() => setBills([BLANK_BILL()])} style={{ background: "none", border: "none", color: T.muted, fontSize: "12px", cursor: "pointer", fontFamily: "DM Mono, monospace", textDecoration: "underline" }}>Clear all and start from scratch</button>
: <button onClick={() => setBills(BILL_TEMPLATE.map(i => ({ ...i })))} style={{ background: "none", border: "none", color: T.blue, fontSize: "12px", cursor: "pointer", fontFamily: "DM Mono, monospace", textDecoration: "underline" }}>Restore template</button>
}
</div>
</WizardShell>
);
}

// -- Step: discretionary --
if (step === "discretionary") {
return (
<WizardShell {...shellProps} title="Discretionary spending" subtitle="Unlike fixed bills, these are flexible - you set a monthly target, but what you actually spend will vary." canNext={true} onNext={next}>
{disc.map((b, i) => (
<div key={b.id} style={{ background: T.surf, border: `1px solid ${b.color}44`, borderRadius: "10px", padding: "14px 16px", marginBottom: "10px" }}>
<div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
<div style={{ width: "10px", height: "10px", borderRadius: "50%", background: b.color, flexShrink: 0 }} />
<input type="text" value={b.label} onChange={e => setDisc(p => p.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} style={{ background: "transparent", border: "none", borderBottom: "1px solid " + T.bord, color: T.text1, padding: "2px 0", fontSize: "14px", fontWeight: "600", flex: 1, fontFamily: "DM Mono, monospace" }} />
</div>
<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
<span style={{ fontSize: "12px", color: T.text3 }}>Monthly budget</span>
<input type="number" placeholder="0" value={b.amount || ""} onChange={e => setDisc(p => p.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} style={{ background: T.bg, border: "1px solid " + T.bord, color: T.text1, padding: "8px 10px", borderRadius: "6px", fontSize: "16px", width: "120px" }} />
<span style={{ fontSize: "12px", color: T.text3 }}>/mo</span>
</div>
</div>
))}
</WizardShell>
);
}

// -- Step: reserves --
if (step === "reserves") {
return (
<WizardShell {...shellProps} title="Savings & reserves" subtitle="Unlike fixed bills or discretionary spending, reserves accumulate month to month - you're setting aside a little each month so the money is there when you need it. Think vet visits, auto repairs, or a vacation." canNext={true} onNext={next}>
{reserves.map((b, i) => (
<div key={b.id} style={{ background: T.surf, border: `1px solid ${b.color}44`, borderRadius: "10px", padding: "14px 16px", marginBottom: "10px", display: "flex", alignItems: "center", gap: "14px" }}>
<div style={{ width: "10px", height: "10px", borderRadius: "50%", background: b.color, flexShrink: 0 }} />
<div style={{ flex: 1 }}>
<input type="text" value={b.label} onChange={e => setReserves(p => p.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} style={{ background: "transparent", border: "none", borderBottom: "1px solid " + T.bord, color: T.text1, padding: "2px 0", fontSize: "14px", fontWeight: "600", width: "100%", fontFamily: "DM Mono, monospace", marginBottom: "8px" }} />
<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
<input type="number" placeholder="0" value={b.amount || ""} onChange={e => setReserves(p => p.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} style={{ background: T.bg, border: "1px solid " + T.bord, color: T.text1, padding: "8px 10px", borderRadius: "6px", fontSize: "16px", width: "120px" }} />
<span style={{ fontSize: "12px", color: T.text2 }}>/mo contribution</span>
</div>
</div>
</div>
))}
</WizardShell>
);
}

// -- Step: debt --
if (step === "debt") {
const filledBills = bills.filter(b => b.name.trim() && parseFloat(b.amt) > 0 && b.note !== "cc");
const filledDisc  = disc.filter(b => parseFloat(b.amount) > 0);
const linkedIds   = new Set(debts.map(d => d.linkedBucketId).filter(Boolean));
const manualDebts = debts.filter(d => d.linkedType === "manual");

function toggle(id, name, amt, type) {
  if (linkedIds.has(id)) {
    setDebts(p => p.filter(d => d.linkedBucketId !== id));
  } else {
    setDebts(p => [...p, { ...newDebt(), name, linkedBucketId: id, linkedType: type, monthly: parseFloat(amt) || 0, monthlyPrincipal: parseFloat(amt) || 0 }]);
  }
}
function updLinked(id, patch) { setDebts(p => p.map(d => d.linkedBucketId === id ? { ...d, ...patch } : d)); }
function updManual(id, patch) { setDebts(p => p.map(d => d.id === id ? { ...d, ...patch } : d)); }

const inpStyle = { background: T.bg, border: "1px solid " + T.bord, color: T.text1, padding: "8px 10px", borderRadius: "6px", fontSize: "14px", width: "100%", boxSizing: "border-box" };

const renderDebtDetail = (d, onChange) => (
  <div style={{ marginTop: "12px", borderTop: "1px solid " + T.bord, paddingTop: "12px", display: "flex", flexDirection: "column", gap: "10px" }}>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: "12px", letterSpacing: "0.15em", color: T.text3, textTransform: "uppercase", marginBottom: "4px" }}>Balance</div>
        <input type="number" placeholder="0.00" value={d.balance} onChange={e => onChange({ balance: e.target.value })} style={inpStyle} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: "12px", letterSpacing: "0.15em", color: T.text3, textTransform: "uppercase", marginBottom: "4px" }}>Type</div>
        <select value={d.type} onChange={e => onChange({ type: e.target.value })} style={inpStyle}>
          {DEBT_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
        </select>
      </div>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: "12px", letterSpacing: "0.15em", color: T.text3, textTransform: "uppercase", marginBottom: "4px" }}>APR %</div>
        <input type="number" placeholder="0" value={d.apr} onChange={e => onChange({ apr: e.target.value })} style={inpStyle} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: "12px", letterSpacing: "0.15em", color: T.text3, textTransform: "uppercase", marginBottom: "4px" }}>Balance as of</div>
        <input type="date" value={d.balanceAsOf} onChange={e => onChange({ balanceAsOf: e.target.value })} style={{ ...inpStyle, fontSize: "12px", textAlign: "left" }} />
      </div>
    </div>
  </div>
);

return (
  <WizardShell {...shellProps} title="Debts" subtitle="Select any bills or spending categories that are paying down a debt. We'll track the balance and project your payoff date. You can skip this and add debts later from the Debt tab." canNext={true} onNext={next}>

    {filledBills.length > 0 && (
      <div style={{ marginBottom: "20px" }}>
        <div style={{ fontSize: "12px", letterSpacing: "0.15em", textTransform: "uppercase", color: T.blue, marginBottom: "8px", paddingBottom: "6px", borderBottom: "1px solid " + T.bord }}>From your fixed bills</div>
        {filledBills.map(b => {
          const isLinked = linkedIds.has(b.name);
          const debt = debts.find(d => d.linkedBucketId === b.name);
          return (
            <div key={b.name} style={{ background: T.surf, border: `1px solid ${isLinked ? "#4A9EFF55" : T.bord}`, borderRadius: "10px", padding: "12px 14px", marginBottom: "8px" }}>
              <div onClick={() => toggle(b.name, b.name, b.amt, "fixed")} style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
                <div style={{ width: "18px", height: "18px", borderRadius: "4px", border: `2px solid ${isLinked ? T.blue : T.bord}`, background: isLinked ? T.blue : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {isLinked && <span className="material-symbols-outlined" style={{ fontSize: "14px", color: T.bg }}>check</span>}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "13px", fontWeight: "600", color: T.text1 }}>{b.name}</div>
                  <div style={{ fontSize: "12px", color: T.text3 }}>{new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(b.amt)}/mo - fixed payment</div>
                </div>
              </div>
              {isLinked && debt && renderDebtDetail(debt, p => updLinked(b.name, p))}
            </div>
          );
        })}
      </div>
    )}

    {filledDisc.length > 0 && (
      <div style={{ marginBottom: "20px" }}>
        <div style={{ fontSize: "12px", letterSpacing: "0.15em", textTransform: "uppercase", color: "#FFB347", marginBottom: "8px", paddingBottom: "6px", borderBottom: "1px solid " + T.bord }}>From your discretionary spending</div>
        {filledDisc.map(b => {
          const isLinked = linkedIds.has(b.id);
          const debt = debts.find(d => d.linkedBucketId === b.id);
          return (
            <div key={b.id} style={{ background: T.surf, border: `1px solid ${isLinked ? "#FFB34755" : T.bord}`, borderRadius: "10px", padding: "12px 14px", marginBottom: "8px" }}>
              <div onClick={() => toggle(b.id, b.label, b.amount, "discretionary")} style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
                <div style={{ width: "18px", height: "18px", borderRadius: "4px", border: `2px solid ${isLinked ? "#FFB347" : T.bord}`, background: isLinked ? "#FFB347" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {isLinked && <span className="material-symbols-outlined" style={{ fontSize: "14px", color: T.bg }}>check</span>}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "13px", fontWeight: "600", color: T.text1 }}>{b.label}</div>
                  <div style={{ fontSize: "12px", color: T.text3 }}>up to {new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(b.amount)}/mo - variable</div>
                </div>
              </div>
              {isLinked && debt && renderDebtDetail(debt, p => updLinked(b.id, p))}
            </div>
          );
        })}
      </div>
    )}

    {manualDebts.length > 0 && (
      <div style={{ marginBottom: "12px" }}>
        <div style={{ fontSize: "12px", letterSpacing: "0.15em", textTransform: "uppercase", color: T.text3, marginBottom: "8px", paddingBottom: "6px", borderBottom: "1px solid " + T.bord }}>Other debts</div>
        {manualDebts.map((d, i) => (
          <div key={d.id} style={{ background: T.surf, border: "1px solid " + T.bord, borderRadius: "10px", padding: "12px 14px", marginBottom: "8px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
              <div style={{ fontSize: "12px", fontWeight: "700", color: T.text3 }}>Debt {i + 1}</div>
              <button onClick={() => setDebts(p => p.filter(x => x.id !== d.id))} style={{ background: "none", border: "none", color: T.red, cursor: "pointer", display: "flex", alignItems: "center" }}>
                <span className="material-symbols-outlined" style={{ fontSize: "20px" }}>delete</span>
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "8px" }}>
              <div>
                <div style={{ fontSize: "12px", letterSpacing: "0.15em", color: T.text3, textTransform: "uppercase", marginBottom: "4px" }}>Name</div>
                <input type="text" placeholder="e.g. Student Loan" value={d.name} onChange={e => updManual(d.id, { name: e.target.value })} style={{ background: T.bg, border: "1px solid " + T.bord, color: T.text1, padding: "8px 10px", borderRadius: "6px", fontSize: "14px", width: "100%", boxSizing: "border-box" }} />
              </div>
              <div>
                <div style={{ fontSize: "12px", letterSpacing: "0.15em", color: T.text3, textTransform: "uppercase", marginBottom: "4px" }}>Monthly payment</div>
                <input type="number" placeholder="0" value={d.monthly || ""} onChange={e => updManual(d.id, { monthly: parseFloat(e.target.value) || 0, monthlyPrincipal: parseFloat(e.target.value) || 0 })} style={{ background: T.bg, border: "1px solid " + T.bord, color: T.text1, padding: "8px 10px", borderRadius: "6px", fontSize: "14px", width: "100%", boxSizing: "border-box" }} />
              </div>
            </div>
            <div style={{ fontSize: "12px", color: T.muted, marginBottom: "8px" }}>Add this payment to Fixed Bills so it counts toward your budget.</div>
            {renderDebtDetail(d, p => updManual(d.id, p))}
          </div>
        ))}
      </div>
    )}

    {filledBills.length === 0 && filledDisc.length === 0 && debts.length === 0 && (
      <div style={{ background: T.surf, border: "1px dashed " + T.bord, borderRadius: "10px", padding: "20px", textAlign: "center", marginBottom: "16px" }}>
        <span className="material-symbols-outlined" style={{ fontSize: "32px", color: T.muted, display: "block", marginBottom: "8px" }}>credit_card_off</span>
        <div style={{ fontSize: "13px", color: T.muted }}>No bills or spending categories to link yet. Add a manual debt below, or skip this step.</div>
      </div>
    )}

    <button onClick={() => setDebts(p => [...p, newDebt()])} style={{ background: "transparent", border: "1px dashed " + T.bord, color: T.text3, padding: "10px 16px", borderRadius: "8px", fontSize: "12px", cursor: "pointer", width: "100%", fontFamily: "DM Mono, monospace", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
      <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>add</span>Add a debt not in my bills
    </button>
  </WizardShell>
);

}

// -- Step: review --
if (step === "review") {
const fmt0 = n => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
return (
<WizardShell {...shellProps} title="Review your budget" subtitle="Everything looks right? Hit Launch to get started." canNext={unallocated >= 0} onNext={finish}>
<div style={{ background: T.surf, border: "1px solid " + T.blueBord, borderRadius: "10px", padding: "14px 16px", marginBottom: "10px" }}>
<div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
<span style={{ fontSize: "12px", color: T.text3 }}>Total income</span>
<span style={{ fontSize: "13px", fontWeight: "700", color: T.green }}>{fmt0(totalIncome)}/mo</span>
</div>
<div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
<span style={{ fontSize: "12px", color: T.text3 }}>Allocated</span>
<span style={{ fontSize: "13px", fontWeight: "700" }}>{fmt0(allocated)}/mo</span>
</div>
<div style={{ height: "1px", background: T.bord, margin: "8px 0" }} />
<div style={{ display: "flex", justifyContent: "space-between" }}>
<span style={{ fontSize: "12px", fontWeight: "700", color: unallocated < 0 ? T.red : T.green }}>
{unallocated < 0 ? "Over by" : "Unallocated"}
</span>
<span style={{ fontSize: "14px", fontWeight: "700", color: unallocated < 0 ? T.red : T.green }}>
{fmt0(Math.abs(unallocated))}/mo
</span>
</div>
</div>
{unallocated < 0 && (
<div style={{ background: "#1a0a0a", border: "1px solid #ff444455", borderRadius: "8px", padding: "10px 14px", marginBottom: "10px", fontSize: "12px", color: T.red }}>
Your allocations exceed your income. Go back and adjust before launching.
</div>
)}
{unallocated > 0 && (
<div style={{ background: T.greenBg, border: "1px solid " + T.greenBord, borderRadius: "8px", padding: "12px 14px", marginBottom: "10px" }}>
<div style={{ fontSize: "12px", fontWeight: "700", color: T.green, marginBottom: "4px" }}>{fmt0(unallocated)}/mo is unallocated</div>
<div style={{ fontSize: "12px", color: T.text2, marginBottom: "10px", lineHeight: "1.5" }}>Put it to work instead of leaving it unassigned. A good rule of thumb is to save at least 15-20% of your income.</div>
<button onClick={function() {
var added = unallocated;
setReserves(function(prev) {
return prev.map(function(r) {
if (r.id !== "bill011") return r;
var current = parseFloat(r.amount) || 0;
return { ...r, amount: String(Math.round((current + added) * 100) / 100) };
});
});
}} style={{ background: T.green, border: "none", color: T.bg, padding: "8px 14px", borderRadius: "6px", fontSize: "12px", fontWeight: "700", cursor: "pointer", fontFamily: "DM Mono, monospace" }}>
Add {fmt0(unallocated)}/mo to General Savings
</button>
</div>
)}
</WizardShell>
);
}

return null;
}

function BudgetTracker({ onReset, onRerunWizard }) {
// ---- Theme ----
const [themePref, setThemePref] = useState(function() { return loadTheme(); });
const resolvedMode = resolveTheme(themePref);
const T = THEMES[resolvedMode];

// Shared style objects built from theme tokens
const cs = {
  page: { minHeight: "100vh", background: T.bg, color: T.text1, fontFamily: "DM Mono, monospace" },
  header: { borderBottom: "1px solid " + T.bord, padding: "20px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" },
  sel: { background: T.surf, border: "1px solid " + T.bord, color: T.text1, padding: "7px 10px", borderRadius: "6px", fontSize: "12px", cursor: "pointer" },
  tabs: { display: "flex", borderBottom: "1px solid " + T.bord, padding: "0 24px", overflowX: "auto", overflowY: "hidden", minHeight: "42px", scrollbarWidth: "none", msOverflowStyle: "none" },
  body: { padding: "20px 24px", maxWidth: "1100px", margin: "0 auto" },
  lbl: { fontSize: "12px", letterSpacing: "0.12em", color: T.text2, textTransform: "uppercase", marginBottom: "4px" },
  inp: { background: T.bg, border: "1px solid " + T.bord, color: T.text1, padding: "8px 10px", borderRadius: "6px", fontSize: "13px", boxSizing: "border-box" },
};
function Card({ children, border, style, onClick }) {
  return <div onClick={onClick} style={{ background: T.surf, border: "1px solid " + (border || T.bord), borderRadius: "10px", padding: "16px 18px", marginBottom: "10px", ...style }}>{children}</div>;
}
function Btn({ color, outline, onClick, children, style }) {
  return <button onClick={onClick} style={{ background: outline ? "transparent" : color, border: "1px solid " + color, color: outline ? color : T.bg, padding: "7px 14px", borderRadius: "6px", fontSize: "12px", fontWeight: "700", cursor: "pointer", ...style }}>{children}</button>;
}

// Keep data-theme on body in sync for CSS spinner styling
useEffect(function() { document.body.dataset.theme = resolvedMode; }, [resolvedMode]);

// Listen for OS dark/light switch when "system" is selected
const [, setSysTick] = useState(0);
useEffect(function() {
  if (themePref !== "system") return;
  var mq = window.matchMedia("(prefers-color-scheme: dark)");
  var handler = function() { setSysTick(function(n) { return n + 1; }); };
  if (mq.addEventListener) { mq.addEventListener("change", handler); }
  return function() { if (mq.removeEventListener) { mq.removeEventListener("change", handler); } };
}, [themePref]);
const now = new Date();
const iy = now.getFullYear();
const im = now.getMonth();

// Live config - source of truth for all budget amounts
// Falls back to module-level constants when cfg is null (first-run edge case)
const [cfg, setCfg] = useState(() => loadConfig());

// Derive working values from cfg; fall back to hardcoded constants
const buckets = cfg?.buckets || BUCKETS;
const totalIncomeCfg = cfg?.incomes
  ? Math.round(cfg.incomes.reduce((s, i) => s + (i.netPay || 0), 0) * 100) / 100
  : NET_PAY;
const primaryPayday = cfg?.primaryPayday ?? PAYDAY;
// setupYear/setupMonth: first month the app was configured -- used as loop start
// for all running-balance calculations so they don't go back to the beginning of time.
// Falls back to current year/month for existing installs without this field.
const setupYear  = cfg?.setupYear ?? iy;
const setupMonth = cfg?.setupMonth ?? 0;

// Reserve monthly contribution amounts keyed by bucket id - derived from cfg
const reserveMonthly = {};
(cfg?.buckets || BUCKETS).forEach(b => { reserveMonthly[b.id] = b.amount || 0; });

const [year, setYear] = useState(iy);
const [month, setMonth] = useState(im);
const [tab, setTab] = useState("overview");
const [expanded, setExpanded] = useState(null);
const [data, setData] = useState(() => loadData() || getDefaultData());
const [inputs, setInputs] = useState({});
const [debts, setDebts] = useState(() => loadDebts() || []);
const [showRef, setShowRef] = useState(false);
const [txMerchant, setTxMerchant] = useState("");
const [txAmount, setTxAmount] = useState("");
const [txDate, setTxDate] = useState(() => new Date().toISOString().slice(0, 10));
const [txReserve, setTxReserve] = useState("bill008");
const [txCategory, setTxCategory] = useState("reserve"); // "reserve" or "discretionary"
const [expandedReserve, setExpandedReserve] = useState(null);
const [search, setSearch] = useState("");
const [showSearch, setShowSearch] = useState(false);
const [debtInputs, setDebtInputs] = useState({});
const [projMonthly, setProjectMonthly] = useState({});
const [showFlowInfo, setShowFlowInfo] = useState(false);
const [moneyFlowHovered, setMoneyFlowHovered] = useState(null);
const [moneyFlowTooltip, setMoneyFlowTooltip] = useState(null);
// editModal: null | "bills" | "disc" | "reserves" | "debt" | "income"
const [editModal, setEditModal] = useState(null);
// Local edit state - populated when a modal opens
const [editBills, setEditBills] = useState([]);
const [editDisc, setEditDisc] = useState([]);
const [editReserves, setEditReserves] = useState([]);
const [editDebts, setEditDebts] = useState([]);
const [editIncomes, setEditIncomes] = useState([]);

// Persist data and debts to localStorage whenever they change
useEffect(() => { saveData(data); }, [data]);
useEffect(() => { saveDebts(debts); }, [debts]);

const key = `${year}-${month}`;
const cur = data[key] || { spent: {} };

function setSpent(id, val) {
setData(d => ({ ...d, [key]: { ...d[key], spent: { ...d[key]?.spent, [id]: parseFloat(val) || 0 } } }));
}


// Shared reserve balance calculator -- single source of truth for all reserve running balances.
// Rounds to cents to prevent IEEE 754 drift over many months. (ref: math_audit.py)
function getReserveBal(id) {
  let bal = 0;
  const mo = reserveMonthly[id] || 0;
  for (let y = setupYear; y <= year; y++)
    for (let m = 0; m < 12; m++) {
      if (y === setupYear && m < setupMonth) continue;
      if (y > year || (y === year && m > month)) break;
      const d = data[`${y}-${m}`] || {};
      bal += mo - ((d.spent && d.spent[id]) || 0);
    }
  return Math.round(bal * 100) / 100;
}

function reassignTransaction(txId, newReserveId) {
setData(d => {
const monthData = d[key] || {};
const txs = (monthData.reserveTransactions || []).map(tx =>
tx.id === txId ? { ...tx, reserveId: newReserveId || null } : tx
);
return { ...d, [key]: { ...monthData, reserveTransactions: txs } };
});
}

function addTransaction() {
const amount = parseFloat(txAmount);
if (!txMerchant.trim() || isNaN(amount) || amount <= 0) return;
const newTx = {
id: "tx-" + Date.now(),
date: txDate,
merchant: txMerchant.trim(),
amount,
reserveId: txCategory === "reserve" ? txReserve : null,
category: txCategory === "discretionary" ? txReserve : null,
};
// Add to reserveTransactions
setData(d => ({
...d,
[key]: {
...d[key],
reserveTransactions: [...(d[key]?.reserveTransactions ?? []), newTx],
// If reserve, also update the reserve spend total
...(txCategory === "reserve" ? {
spent: { ...(d[key]?.spent || {}), [txReserve]: ((d[key]?.spent?.[txReserve] || 0) + amount) }
} : {}),
// If discretionary, update spent
...(txCategory === "discretionary" ? {
spent: { ...d[key]?.spent, [txReserve]: (d[key]?.spent?.[txReserve] ?? 0) + amount }
} : {}),
}
}));
setTxMerchant("");
setTxAmount("");
setTxDate(new Date().toISOString().slice(0, 10));
setEditModal(null);
}

function isBillPaid(itemDay) {
// Auto-mark paid if the bill's day has passed in the current month/year
const today = new Date();
const isCurrentMonth = today.getMonth() === month && today.getFullYear() === year;
const isPastMonth = year < today.getFullYear() || (year === today.getFullYear() && month < today.getMonth());
if (isPastMonth) return true;
if (isCurrentMonth) return itemDay <= today.getDate();
return false;
}

function payoffMonths(balance, monthly) {
if (!monthly || !balance) return null;
return Math.ceil(balance / monthly);
}

function payoffDate(months) {
if (!months) return null;
const d = new Date();
d.setMonth(d.getMonth() + months);
return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// ---- Edit modal helpers ----
const DISC_IDS_EDIT = ["bill002","bill005","bill003","bill004","bill001"];
const RESERVE_IDS_EDIT = ["bill011","bill010","bill008","bill006","bill007","bill009","bill012","bill013"];
const BILL_COLORS = { Housing: T.blue, Transportation: T.green, Utilities: "#B8A9FF", Subscriptions: "#E879F9", Health: "#FF6B9D", Financial: "#FFB347", Giving: "#FB923C", Other: T.text3 };
const CAT_ORDER_EDIT = ["Housing","Transportation","Utilities","Subscriptions","Health","Financial","Giving","Other"];

const openEditModal = (panel) => {
  const c = loadConfig();
  if (panel === "bills") {
    // Merge saved bills back into full template so user can add/edit any row
    const billsBucket = c?.buckets?.find(b => b.id === "bills") ?? null;
    const saved = (billsBucket && billsBucket.items) ? billsBucket.items : [];
    const merged = BILL_TEMPLATE.map(t => {
      const s = saved.find(i => i.name === t.name);
      return s ? { ...t, amt: String(s.amt || ""), day: String(s.day || ""), note: s.note || t.note } : { ...t };
    });
    // Append any saved bills not in template (user-added)
    saved.forEach(s => {
      if (!BILL_TEMPLATE.find(t => t.name === s.name))
        merged.push({ name: s.name, amt: String(s.amt || ""), day: String(s.day || ""), note: s.note || "", category: s.category || "Other" });
    });
    setEditBills(merged);
  }
  if (panel === "disc") {
    const defaults = [
      { id: "bill002",    label: "Groceries",          amount: "", color: "#FFB347" },
      { id: "bill005",     label: "Gas & Fuel",          amount: "", color: "#FDE68A" },
      { id: "bill003",       label: "Dining Out",          amount: "", color: "#FCD34D" },
      { id: "bill004",label: "Entertainment",       amount: "", color: "#FB923C" },
      { id: "bill001",       label: "Meal Kits / Delivery",amount: "", color: "#E879F9" },
    ];
    setEditDisc(defaults.map(d => {
      const s = c?.buckets?.find(b => b.id === d.id);
      return s ? { ...d, label: s.label, amount: String(s.amount || "") } : d;
    }));
  }
  if (panel === "reserves") {
    const defaults = [
      { id: "bill011",       label: "General Savings",  amount: "", color: "#B8A9FF" },
      { id: "bill010",  label: "Home Upkeep",      amount: "", color: "#60A5FA" },
      { id: "bill008",        label: "Travel Reserve",   amount: "", color: T.green },
      { id: "bill006",      label: "Clothing Reserve", amount: "", color: "#F97316" },
      { id: "bill007",         label: "Gifts Reserve",    amount: "", color: "#FDBA74" },
      { id: "bill009", label: "Pet Reserve",      amount: "", color: "#F9A8D4" },
      { id: "bill012",label: "Beauty Reserve",   amount: "", color: "#C084FC" },
      { id: "bill013",label: "Other Reserve",    amount: "", color: "#34D399" },
    ];
    setEditReserves(defaults.map(r => {
      const s = c?.buckets?.find(b => b.id === r.id);
      return s ? { ...r, label: s.label, amount: String(s.amount || "") } : r;
    }));
  }
  if (panel === "debt") {
    setEditDebts((loadDebts() || []).map(d => ({ ...d, balance: String(d.balance), apr: String(d.apr), monthly: String(d.monthly), monthlyPrincipal: String(d.monthlyPrincipal) })));
  }
  if (panel === "income") {
    const c2 = loadConfig();
    var incArr = (c2 && c2.incomes) || [];
    setEditIncomes(incArr.map(function(i) {
      return {
        label: i.label || "Income",
        netPay: String(i.perPaycheck || ""),
        frequency: i.frequency || "monthly",
        payday: String(i.payday || ""),
      };
    }));
  }
  setEditModal(panel);
};

const saveEditModal = () => {
  const c = loadConfig() || {};
  const prev = c.buckets || [];

  if (editModal === "bills") {
    const filled = editBills.filter(b => b.name.trim() && parseFloat(b.amt) > 0);
    const billsAmt = Math.round(filled.filter(b => b.note !== "cc").reduce((s, b) => s + (parseFloat(b.amt) || 0), 0) * 100) / 100;
    const newBills = { id: "bills", label: "Fixed Bills", amount: billsAmt, color: T.blue,
      items: filled.map(b => ({ name: b.name, amt: parseFloat(b.amt) || 0, day: Math.min(28, Math.max(1, parseInt(b.day, 10) || 1)), note: b.note || "", category: b.category || "Other" })) };
    const newCfg = { ...c, buckets: [newBills, ...prev.filter(b => b.id !== "bills")] };
    saveConfig(newCfg);
    setCfg(newCfg);
  }
  if (editModal === "disc") {
    const kept = prev.filter(b => !DISC_IDS_EDIT.includes(b.id));
    const added = editDisc.filter(b => parseFloat(b.amount) > 0).map(b => ({ id: b.id, label: b.label, amount: parseFloat(b.amount), color: b.color, items: [{ name: b.label, amt: parseFloat(b.amount) }] }));
    const newCfg = { ...c, buckets: [...kept, ...added] };
    saveConfig(newCfg);
    setCfg(newCfg);
  }
  if (editModal === "reserves") {
    const kept = prev.filter(b => !RESERVE_IDS_EDIT.includes(b.id));
    const added = editReserves.filter(b => parseFloat(b.amount) > 0).map(b => ({ id: b.id, label: b.label, amount: parseFloat(b.amount), color: b.color, items: [{ name: b.label, amt: parseFloat(b.amount) }] }));
    const newCfg = { ...c, buckets: [...kept, ...added] };
    saveConfig(newCfg);
    setCfg(newCfg);
  }
  if (editModal === "debt") {
    const saved = editDebts.map(d => ({
      ...d,
      balance: parseFloat(d.balance) || 0,
      apr: parseFloat(d.apr) || 0,
      monthly: parseFloat(d.monthly) || 0,
      monthlyPrincipal: parseFloat(d.monthlyPrincipal) || 0,
    }));
    saveDebts(saved);
    setDebts(saved);
  }
  if (editModal === "income") {
    var FREQ_SAVE = { weekly: 52/12, biweekly: 26/12, semimonthly: 2, monthly: 1 };
    var savedInc = editIncomes.filter(function(i) { return parseFloat(i.netPay) > 0; }).map(function(i) {
      return {
        label: i.label || "Income",
        perPaycheck: parseFloat(i.netPay) || 0,
        netPay: Math.round((parseFloat(i.netPay) || 0) * (FREQ_SAVE[i.frequency] || 1) * 100) / 100,
        frequency: i.frequency,
        payday: parseInt(i.payday, 10) || 1,
      };
    });
    if (savedInc.length > 0) {
      var newCfg = { ...c, incomes: savedInc, primaryPayday: parseInt(savedInc[0].payday, 10) || 1 };
      saveConfig(newCfg);
      setCfg(newCfg);
    }
  }
  setEditModal(null);
};

// Shared modal overlay wrapper - renderXxx pattern per rule 3
const renderModalOverlay = (title, content) => (
  <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end" }}
    onClick={e => { if (e.target === e.currentTarget) setEditModal(null); }}>
    <div style={{ background: T.surf, borderRadius: "16px 16px 0 0", width: "100%", maxWidth: "600px", maxHeight: "85vh", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "16px 20px", borderBottom: "1px solid " + T.bord, display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
        <span style={{ fontSize: "13px", fontWeight: "700", color: T.text1, letterSpacing: "0.05em" }}>{title}</span>
        <button onClick={() => setEditModal(null)} style={{ background: "none", border: "none", color: T.text3, cursor: "pointer", display: "flex", alignItems: "center" }}>
          <span className="material-symbols-outlined" style={{ fontSize: "22px" }}>close</span>
        </button>
      </div>
      <div style={{ overflowY: "auto", padding: "16px 20px 8px", flex: 1 }}>{content}</div>
      <div style={{ padding: "12px 20px 20px", borderTop: "1px solid " + T.bord, display: "flex", gap: "10px", flexShrink: 0 }}>
        <button onClick={() => setEditModal(null)} style={{ flex: 1, background: "transparent", border: "1px solid " + T.bord, color: T.text3, padding: "10px", borderRadius: "8px", fontSize: "12px", fontWeight: "700", cursor: "pointer", fontFamily: "DM Mono, monospace" }}>Cancel</button>
        <button onClick={saveEditModal} style={{ flex: 2, background: T.blue, border: "none", color: T.bg, padding: "10px", borderRadius: "8px", fontSize: "13px", fontWeight: "700", cursor: "pointer", fontFamily: "DM Mono, monospace" }}>Save Changes</button>
      </div>
    </div>
  </div>
);

const renderInfoModal = (title, content) => (
  <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end" }}
    onClick={e => { if (e.target === e.currentTarget) setShowFlowInfo(false); }}>
    <div style={{ background: T.surf, borderRadius: "16px 16px 0 0", width: "100%", maxWidth: "760px", maxHeight: "85vh", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "16px 20px", borderBottom: "1px solid " + T.bord, display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
        <span style={{ fontSize: "13px", fontWeight: "700", color: T.text1, letterSpacing: "0.05em" }}>{title}</span>
        <button onClick={() => setShowFlowInfo(false)} style={{ background: "none", border: "none", color: T.text3, cursor: "pointer", display: "flex", alignItems: "center" }}>
          <span className="material-symbols-outlined" style={{ fontSize: "22px" }}>close</span>
        </button>
      </div>
      <div style={{ overflowY: "auto", padding: "16px 20px 20px", flex: 1 }}>{content}</div>
    </div>
  </div>
);

// Log Spend modal
const renderLogSpend = () => (
  <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end" }}
    onClick={e => { if (e.target === e.currentTarget) setEditModal(null); }}>
    <div style={{ background: T.surf, borderRadius: "16px 16px 0 0", width: "100%", maxWidth: "600px", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "16px 20px", borderBottom: "1px solid " + T.bord, display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
        <span style={{ fontSize: "13px", fontWeight: "700", color: T.text1, letterSpacing: "0.05em" }}>Log Transaction</span>
        <button onClick={() => setEditModal(null)} style={{ background: "none", border: "none", color: T.text3, cursor: "pointer", display: "flex", alignItems: "center" }}>
          <span className="material-symbols-outlined" style={{ fontSize: "22px" }}>close</span>
        </button>
      </div>
      <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "12px" }}>
        <div style={{ background: T.bg, borderRadius: "8px", padding: "3px", display: "flex" }}>
          {[["reserve", "Reserve"], ["discretionary", "Discretionary"]].map(([val, label]) => (
            <div key={val} onClick={() => setTxCategory(val)}
              style={{ flex: 1, padding: "6px 0", textAlign: "center", cursor: "pointer", borderRadius: "6px", fontSize: "12px", letterSpacing: "0.1em", textTransform: "uppercase", background: txCategory === val ? T.blue : "transparent", color: txCategory === val ? T.bg : T.text2, fontWeight: txCategory === val ? "700" : "400", transition: "all 0.15s" }}>
              {label}
            </div>
          ))}
        </div>
        <div>
          <div style={{ ...cs.lbl, marginBottom: "4px" }}>{txCategory === "reserve" ? "Reserve" : "Discretionary Bucket"}</div>
          <select value={txReserve} onChange={e => setTxReserve(e.target.value)} style={{ ...cs.inp, width: "100%", fontSize: "14px" }}>
            {txCategory === "reserve"
              ? buckets.filter(b => ["bill008","bill012","bill006","bill007","bill009","bill011"].includes(b.id)).map(b => (
                  <option key={b.id} value={b.id}>{b.label}</option>
                ))
              : buckets.filter(b => ["bill001","bill002","bill003","bill004","bill005"].includes(b.id)).map(b => (
                  <option key={b.id} value={b.id}>{b.label}</option>
                ))
            }
          </select>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: "8px", alignItems: "end" }}>
          <div>
            <div style={{ ...cs.lbl, marginBottom: "4px" }}>Merchant</div>
            <input type="text" placeholder="e.g. Awesome Socks Club"
              value={txMerchant} onChange={e => setTxMerchant(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addTransaction()}
              style={{ ...cs.inp, width: "100%", fontSize: "16px" }} />
          </div>
          <div>
            <div style={{ ...cs.lbl, marginBottom: "4px" }}>Amount</div>
            <input type="number" placeholder="0.00"
              value={txAmount} onChange={e => setTxAmount(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addTransaction()}
              style={{ ...cs.inp, width: "90px", fontSize: "16px" }} />
          </div>
          <div>
            <div style={{ ...cs.lbl, marginBottom: "4px" }}>Date</div>
            <input type="date" value={txDate} onChange={e => setTxDate(e.target.value)}
              style={{ ...cs.inp, fontSize: "14px", textAlign: "left" }} />
          </div>
        </div>
      </div>
      <div style={{ padding: "4px 20px 20px", borderTop: "1px solid " + T.bord, flexShrink: 0 }}>
        <button onClick={addTransaction}
          style={{ width: "100%", background: T.blue, border: "none", color: T.bg, padding: "12px", borderRadius: "8px", fontSize: "13px", fontWeight: "700", cursor: "pointer", fontFamily: "DM Mono, monospace", letterSpacing: "0.08em" }}>
          + Add Transaction
        </button>
      </div>
    </div>
  </div>
);

// Edit Bills modal content
const renderEditBills = () => {
  const grouped = editBills.reduce((acc, b, i) => {
    const c = b.category || "Other";
    if (!acc[c]) acc[c] = [];
    acc[c].push({ b, i });
    return acc;
  }, {});
  const cats = CAT_ORDER_EDIT.filter(c => grouped[c]);
  const billsTotal = editBills.filter(b => b.note !== "cc").reduce((s, b) => s + (parseFloat(b.amt) || 0), 0);
  return renderModalOverlay("Edit Fixed Bills", (
    <div>
      <div style={{ background: T.bg, borderRadius: "8px", padding: "10px 14px", marginBottom: "16px", display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontSize: "12px", color: T.text3 }}>Bills total</span>
        <span style={{ fontSize: "13px", fontWeight: "700", color: T.blue }}>{new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(billsTotal)}/mo</span>
      </div>
      {cats.map(cat => (
        <div key={cat} style={{ marginBottom: "18px" }}>
          <div style={{ fontSize: "12px", letterSpacing: "0.15em", textTransform: "uppercase", color: BILL_COLORS[cat] || T.text3, marginBottom: "8px", paddingBottom: "4px", borderBottom: "1px solid " + T.bord }}>{cat}</div>
          {grouped[cat].map(({ b, i }) => {
            const dayErr = b.day !== "" && (isNaN(parseInt(b.day,10)) || parseInt(b.day,10) < 1 || parseInt(b.day,10) > 28);
            return (
              <div key={i} style={{ background: T.bg, border: "1px solid " + T.bord, borderRadius: "8px", padding: "8px 10px", marginBottom: "6px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 65px 48px auto", gap: "6px", alignItems: "center" }}>
                  <input type="text" placeholder="Bill name" value={b.name}
                    onChange={e => setEditBills(p => p.map((x,j) => j===i ? {...x, name: e.target.value} : x))}
                    style={{ ...cs.inp, fontSize: "13px", minWidth: 0 }} />
                  <input type="number" placeholder="Amt" value={b.amt || ""} disabled={b.note === "cc"}
                    onChange={e => setEditBills(p => p.map((x,j) => j===i ? {...x, amt: e.target.value} : x))}
                    style={{ ...cs.inp, fontSize: "13px", minWidth: 0 }} />
                  <input type="number" placeholder="Due" min="1" max="28" value={b.day || ""}
                    onChange={e => setEditBills(p => p.map((x,j) => j===i ? {...x, day: e.target.value} : x))}
                    style={{ ...cs.inp, border: `1px solid ${dayErr ? T.red : T.bord}`, fontSize: "13px", minWidth: 0 }} />
                  <button onClick={() => setEditBills(p => p.filter((_,j) => j !== i))}
                    style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", display: "flex", alignItems: "center" }}>
                    <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>delete</span>
                  </button>
                </div>
                {b.note === "cc" && <div style={{ fontSize: "12px", color: T.text3, marginTop: "4px" }}>Credit card payment -- excluded from fixed total</div>}
              </div>
            );
          })}
          <button onClick={() => setEditBills(p => [...p, { ...BLANK_BILL(), category: cat }])}
            style={{ background: "transparent", border: "1px dashed " + T.bord, color: T.muted, padding: "6px 12px", borderRadius: "6px", fontSize: "12px", cursor: "pointer", width: "100%", fontFamily: "DM Mono, monospace", display: "flex", alignItems: "center", justifyContent: "center", gap: "4px", marginTop: "2px" }}>
            <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>add</span>Add {cat.toLowerCase()} bill
          </button>
        </div>
      ))}
    </div>
  ));
};

// Edit Discretionary modal content
const renderEditDisc = () => {
  const discTotal = editDisc.reduce((s, b) => s + (parseFloat(b.amount) || 0), 0);
  return renderModalOverlay("Edit Discretionary", (
    <div>
      <div style={{ background: T.bg, borderRadius: "8px", padding: "10px 14px", marginBottom: "16px", display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontSize: "12px", color: T.text3 }}>Total discretionary</span>
        <span style={{ fontSize: "13px", fontWeight: "700", color: "#FFB347" }}>{new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(discTotal)}/mo</span>
      </div>
      {editDisc.map((b, i) => (
        <div key={b.id} style={{ background: T.bg, border: `1px solid ${b.color}44`, borderRadius: "8px", padding: "12px 14px", marginBottom: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
            <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: b.color, flexShrink: 0 }} />
            <input type="text" value={b.label}
              onChange={e => setEditDisc(p => p.map((x,j) => j===i ? {...x, label: e.target.value} : x))}
              style={{ ...cs.inp, background: "transparent", border: "none", borderBottom: "1px solid " + T.bord, borderRadius: 0, padding: "2px 0", fontSize: "13px", fontWeight: "600", flex: 1 }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "12px", color: T.text3 }}>Monthly budget</span>
            <input type="number" placeholder="0" value={b.amount || ""}
              onChange={e => setEditDisc(p => p.map((x,j) => j===i ? {...x, amount: e.target.value} : x))}
              style={{ ...cs.inp, fontSize: "15px", width: "110px" }} />
            <span style={{ fontSize: "12px", color: T.text3 }}>/mo</span>
          </div>
        </div>
      ))}
    </div>
  ));
};

// Edit Reserves modal content
const renderEditReserves = () => {
  const resTotal = editReserves.reduce((s, b) => s + (parseFloat(b.amount) || 0), 0);
  return renderModalOverlay("Edit Reserves & Savings", (
    <div>
      <div style={{ background: T.bg, borderRadius: "8px", padding: "10px 14px", marginBottom: "16px", display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontSize: "12px", color: T.text2 }}>Total monthly contribution</span>
        <span style={{ fontSize: "13px", fontWeight: "700", color: "#B8A9FF" }}>{new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(resTotal)}/mo</span>
      </div>
      {editReserves.map((b, i) => (
        <div key={b.id} style={{ background: T.bg, border: `1px solid ${b.color}44`, borderRadius: "8px", padding: "12px 14px", marginBottom: "8px", display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: b.color, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <input type="text" value={b.label}
              onChange={e => setEditReserves(p => p.map((x,j) => j===i ? {...x, label: e.target.value} : x))}
              style={{ ...cs.inp, background: "transparent", border: "none", borderBottom: "1px solid " + T.bord, borderRadius: 0, padding: "2px 0", fontSize: "13px", fontWeight: "600", width: "100%", marginBottom: "8px" }} />
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <input type="number" placeholder="0" value={b.amount || ""}
                onChange={e => setEditReserves(p => p.map((x,j) => j===i ? {...x, amount: e.target.value} : x))}
                style={{ ...cs.inp, fontSize: "15px", width: "110px" }} />
              <span style={{ fontSize: "12px", color: T.text2 }}>/mo contribution</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  ));
};

// Edit Debts modal content
const renderEditDebtModal = () => {
  const DEBT_TYPES_EDIT = ["medical","auto","mortgage","student","credit card","other"];
  return renderModalOverlay("Edit Debts", (
    <div>
      {editDebts.length === 0 && (
        <div style={{ textAlign: "center", padding: "20px 0", color: T.muted, fontSize: "13px" }}>No debts yet. Add one below.</div>
      )}
      {editDebts.map((d, i) => (
        <div key={d.id} style={{ background: T.bg, border: "1px solid " + T.bord, borderRadius: "10px", padding: "12px 14px", marginBottom: "10px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px" }}>
            <span style={{ fontSize: "12px", fontWeight: "700", color: T.text3 }}>Debt {i+1}</span>
            <button onClick={() => setEditDebts(p => p.filter((_,j) => j !== i))}
              style={{ background: "none", border: "none", color: T.red, cursor: "pointer", display: "flex", alignItems: "center" }}>
              <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>delete</span>
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "8px" }}>
            <div>
              <div style={{ ...cs.lbl, marginBottom: "4px" }}>Name</div>
              <input type="text" placeholder="e.g. Car Loan" value={d.name}
                onChange={e => setEditDebts(p => p.map((x,j) => j===i ? {...x, name: e.target.value} : x))}
                style={{ ...cs.inp, width: "100%", boxSizing: "border-box", fontSize: "13px" }} />
            </div>
            <div>
              <div style={{ ...cs.lbl, marginBottom: "4px" }}>Type</div>
              <select value={d.type}
                onChange={e => setEditDebts(p => p.map((x,j) => j===i ? {...x, type: e.target.value} : x))}
                style={{ ...cs.inp, width: "100%", boxSizing: "border-box", fontSize: "13px", cursor: "pointer" }}>
                {DEBT_TYPES_EDIT.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "8px" }}>
            <div>
              <div style={{ ...cs.lbl, marginBottom: "4px" }}>Balance</div>
              <input type="number" placeholder="0.00" value={d.balance}
                onChange={e => setEditDebts(p => p.map((x,j) => j===i ? {...x, balance: e.target.value} : x))}
                style={{ ...cs.inp, width: "100%", boxSizing: "border-box", fontSize: "13px" }} />
            </div>
            <div>
              <div style={{ ...cs.lbl, marginBottom: "4px" }}>APR %</div>
              <input type="number" placeholder="0" value={d.apr}
                onChange={e => setEditDebts(p => p.map((x,j) => j===i ? {...x, apr: e.target.value} : x))}
                style={{ ...cs.inp, width: "100%", boxSizing: "border-box", fontSize: "13px" }} />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
            <div>
              <div style={{ ...cs.lbl, marginBottom: "4px" }}>Monthly payment</div>
              <input type="number" placeholder="0" value={d.monthly}
                onChange={e => setEditDebts(p => p.map((x,j) => j===i ? {...x, monthly: e.target.value, monthlyPrincipal: e.target.value} : x))}
                style={{ ...cs.inp, width: "100%", boxSizing: "border-box", fontSize: "13px" }} />
            </div>
            <div>
              <div style={{ ...cs.lbl, marginBottom: "4px" }}>Balance as of</div>
              <input type="date" value={d.balanceAsOf}
                onChange={e => setEditDebts(p => p.map((x,j) => j===i ? {...x, balanceAsOf: e.target.value} : x))}
                style={{ ...cs.inp, width: "100%", boxSizing: "border-box", fontSize: "12px", textAlign: "left" }} />
            </div>
          </div>
        </div>
      ))}
      <button onClick={() => setEditDebts(p => [...p, { id: "d-"+Date.now(), name: "", type: "other", balance: "", apr: "", monthly: "", monthlyPrincipal: "", balanceAsOf: new Date().toISOString().slice(0,10), grows: false, escrow: 0, note: "" }])}
        style={{ background: "transparent", border: "1px dashed " + T.bord, color: T.text3, padding: "10px 16px", borderRadius: "8px", fontSize: "12px", cursor: "pointer", width: "100%", fontFamily: "DM Mono, monospace", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
        <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>add</span>Add a debt
      </button>
    </div>
  ));
};

// Edit Income modal content
const renderEditIncome = () => {
  var FREQ_OPTS = [
    { value: "weekly",      label: "Weekly" },
    { value: "biweekly",    label: "Biweekly" },
    { value: "semimonthly", label: "2x / mo" },
    { value: "monthly",     label: "Monthly" },
  ];
  var FREQ_MULT = { weekly: 52/12, biweekly: 26/12, semimonthly: 2, monthly: 1 };
  var totalMo = Math.round(editIncomes.reduce(function(s, i) { return s + (parseFloat(i.netPay) || 0) * (FREQ_MULT[i.frequency] || 1); }, 0) * 100) / 100;
  return renderModalOverlay("Edit Income", (
    <div>
      <div style={{ background: T.bg, borderRadius: "8px", padding: "10px 14px", marginBottom: "16px", display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontSize: "12px", color: T.text3 }}>Monthly total</span>
        <span style={{ fontSize: "13px", fontWeight: "700", color: T.green }}>{new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(totalMo)}/mo</span>
      </div>
      {editIncomes.map(function(inc, i) {
        var mult = FREQ_MULT[inc.frequency] || 1;
        var monthly = Math.round((parseFloat(inc.netPay) || 0) * mult * 100) / 100;
        return (
          <div key={i} style={{ background: T.bg, border: "1px solid " + T.bord, borderRadius: "10px", padding: "12px 14px", marginBottom: "10px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
              <span style={{ fontSize: "12px", fontWeight: "700", color: T.blue }}>Income {i + 1}{i === 0 ? " - Primary" : ""}</span>
              {editIncomes.length > 1 && (
                <button onClick={function() { setEditIncomes(function(p) { return p.filter(function(_, j) { return j !== i; }); }); }}
                  style={{ background: "none", border: "none", color: T.red, cursor: "pointer", display: "flex", alignItems: "center" }}>
                  <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>delete</span>
                </button>
              )}
            </div>
            <div style={{ marginBottom: "10px" }}>
              <div style={{ ...cs.lbl, marginBottom: "4px" }}>Label</div>
              <input type="text" placeholder="e.g. Main Job" value={inc.label}
                onChange={function(e) { var v = e.target.value; setEditIncomes(function(p) { return p.map(function(x, j) { return j === i ? Object.assign({}, x, { label: v }) : x; }); }); }}
                style={{ ...cs.inp, width: "100%", boxSizing: "border-box", fontSize: "13px" }} />
            </div>
            <div style={{ marginBottom: "10px" }}>
              <div style={{ ...cs.lbl, marginBottom: "4px" }}>Frequency</div>
              <div style={{ display: "flex", background: T.surf, borderRadius: "8px", padding: "3px" }}>
                {FREQ_OPTS.map(function(opt) {
                  var isActive = inc.frequency === opt.value;
                  return (
                    <div key={opt.value}
                      onClick={function() { setEditIncomes(function(p) { return p.map(function(x, j) { return j === i ? Object.assign({}, x, { frequency: opt.value }) : x; }); }); }}
                      style={{ flex: 1, padding: "6px 4px", textAlign: "center", cursor: "pointer", borderRadius: "6px", fontSize: "12px", textTransform: "uppercase", background: isActive ? T.blue : "transparent", color: isActive ? T.bg : T.text3, fontWeight: isActive ? "700" : "400" }}>
                      {opt.label}
                    </div>
                  );
                })}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "10px" }}>
              <div>
                <div style={{ ...cs.lbl, marginBottom: "4px" }}>Per paycheck</div>
                <input type="number" placeholder="0" value={inc.netPay}
                  onChange={function(e) { var v = e.target.value; setEditIncomes(function(p) { return p.map(function(x, j) { return j === i ? Object.assign({}, x, { netPay: v }) : x; }); }); }}
                  style={{ ...cs.inp, width: "100%", boxSizing: "border-box", fontSize: "15px" }} />
              </div>
              <div>
                <div style={{ ...cs.lbl, marginBottom: "4px" }}>Payday (day of month)</div>
                <input type="number" placeholder="e.g. 27" min="1" max="28" value={inc.payday}
                  onChange={function(e) { var v = e.target.value; setEditIncomes(function(p) { return p.map(function(x, j) { return j === i ? Object.assign({}, x, { payday: v }) : x; }); }); }}
                  style={{ ...cs.inp, width: "100%", boxSizing: "border-box", fontSize: "15px" }} />
              </div>
            </div>
            {monthly > 0 && (
              <div style={{ background: T.blueBg, border: "1px solid " + T.blueBord, borderRadius: "8px", padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: "12px", color: T.text3, textTransform: "uppercase", letterSpacing: "0.1em" }}>Monthly total</div>
                  <div style={{ fontSize: "18px", fontWeight: "700", color: T.blue }}>{new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(monthly)}</div>
                </div>
                <span className="material-symbols-outlined" style={{ fontSize: "28px", color: T.blue, opacity: 0.4 }}>payments</span>
              </div>
            )}
          </div>
        );
      })}
      {editIncomes.length < 4 && (
        <button onClick={function() { setEditIncomes(function(p) { return p.concat([{ label: "", netPay: "", payday: "", frequency: "monthly" }]); }); }}
          style={{ background: "transparent", border: "1px dashed " + T.bord, color: T.text3, padding: "10px 16px", borderRadius: "8px", fontSize: "12px", cursor: "pointer", width: "100%", fontFamily: "DM Mono, monospace", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
          <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>add</span>Add income stream
        </button>
      )}
    </div>
  ));
};

// Floating edit button used in each tab
const renderEditBtn = (panel) => (
  <button onClick={() => openEditModal(panel)}
    style={{ display: "flex", alignItems: "center", gap: "5px", background: T.surf, border: "1px solid " + T.bord, color: T.text3, padding: "5px 12px", borderRadius: "20px", fontSize: "12px", fontWeight: "700", cursor: "pointer", fontFamily: "DM Mono, monospace", letterSpacing: "0.05em", marginBottom: "14px" }}>
    <span className="material-symbols-outlined" style={{ fontSize: "15px" }}>edit</span>Edit
  </button>
);
const reserveBals = {};
RESERVE_IDS_EDIT.forEach(function(id) { reserveBals[id] = getReserveBal(id); });
const totalDebtBal = debts.reduce((s, d) => s + d.balance, 0);
const totalMedBal = debts.filter(d => d.type === 'medical').reduce((s, d) => s + d.balance, 0);
const totalMedMo = debts.filter(d => d.type === 'medical').reduce((s, d) => s + d.monthly, 0);
const totalBudgeted = buckets.reduce((s, b) => s + b.amount, 0);

const tabStyle = (a) => ({
background: "none", border: "none", borderBottom: a ? "2px solid " + T.blue : "2px solid transparent",
color: a ? T.blue : T.text2, padding: "10px 16px", fontSize: "12px", letterSpacing: "0.15em",
textTransform: "uppercase", cursor: "pointer", marginBottom: "-1px", whiteSpace: "nowrap"
});

return (

<div style={cs.page}>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block" rel="stylesheet" />
<style>{`.budget-tabs::-webkit-scrollbar { display: none; } .material-symbols-outlined { font-family: 'Material Symbols Outlined'; font-weight: normal; font-style: normal; font-size: 24px; display: inline-block; line-height: 1; text-transform: none; letter-spacing: normal; word-wrap: normal; white-space: nowrap; direction: ltr; }`}</style>
<div style={cs.header}>
<div>
<div style={{ fontSize: "12px", letterSpacing: "0.2em", color: T.text3, textTransform: "uppercase", marginBottom: "2px" }}>Paycheck Split Tracker</div>
<div style={{ fontSize: "22px", fontWeight: "700", color: T.text1, letterSpacing: "-0.02em" }}>Budget Control</div>
</div>
<div style={{ display: "flex", gap: "8px" }}>
<select value={month} onChange={e => setMonth(+e.target.value)} style={cs.sel}>
{MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
</select>
<select value={year} onChange={e => setYear(+e.target.value)} style={cs.sel}>
{(function() { var yrs = []; for (var y = setupYear; y <= now.getFullYear() + 2; y++) yrs.push(y); return yrs; })().map(y => <option key={y} value={y}>{y}</option>)}
</select>
</div>
</div>
<div style={{ padding: "10px 24px", borderBottom: "1px solid " + T.bord, display: "flex", gap: "8px", alignItems: "center", maxWidth: "100%", boxSizing: "border-box", overflow: "hidden" }}>
<input
type="text"
placeholder="Search budgets, bills, providers..."
value={search}
onChange={e => setSearch(e.target.value)}
style={{ ...cs.inp, flex: 1, fontSize: "16px", padding: "8px 12px", minWidth: 0 }}
/>
{search && (
<button onClick={() => setSearch("")} style={{ background: "none", border: "1px solid " + T.bord, color: T.text2, padding: "7px 12px", borderRadius: "6px", cursor: "pointer", fontSize: "16px", flexShrink: 0, whiteSpace: "nowrap" }}></button>
)}
</div>
{search.trim().length > 0 && (() => {
const q = search.trim().toLowerCase();
const results = [];
const billsBucket = buckets.find(b => b.id === "bills");
if (billsBucket) {
billsBucket.items.forEach(item => {
if (item.name.toLowerCase().includes(q)) {
results.push({ section: "Fixed Bills", color: T.blue, name: item.name, detail: item.day ? `Autopays ${ordinal(item.day)} of month` : "Date unknown", amount: item.amt, monthly: true, note: item.note });
}
});
}
buckets.filter(b => b.id !== "bills" && b.amount > 0).forEach(b => {
if (b.label.toLowerCase().includes(q) || b.items.some(i => i.name.toLowerCase().includes(q))) {
results.push({ section: "Discretionary / Reserves", color: b.color, name: b.label, detail: b.note || b.items.map(i => i.name).join(", "), amount: b.amount, monthly: true });
}
});
debts.forEach(m => {
if (m.name.toLowerCase().includes(q)) {
results.push({ section: "Medical", color: "#FF6B9D", name: m.name, detail: m.note || (m.open ? "Balance growing" : "Fixed balance"), amount: m.balance, monthly: false, extra: m.monthly > 0 ? `${fmt(m.monthly)}/mo payment` : "No scheduled payment" });
}
});
return (
<div style={{ padding: "12px 24px", borderBottom: "1px solid " + T.bord, background: T.bg }}>
<div style={{ ...cs.lbl, marginBottom: "10px" }}>{results.length} result{results.length !== 1 ? "s" : ""} for "{search}"</div>
{results.length === 0
? <div style={{ fontSize: "13px", color: T.text2, padding: "8px 0" }}>No results found</div>
: results.map((r, i) => (
<div key={i} style={{ background: T.surf, border: `1px solid ${r.color}33`, borderRadius: "10px", padding: "12px 16px", marginBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
<div style={{ flex: 1 }}>
<div style={{ fontSize: "12px", letterSpacing: "0.15em", color: r.color, textTransform: "uppercase", marginBottom: "3px" }}>{r.section}</div>
<div style={{ fontSize: "13px", fontWeight: "700", color: T.text1, marginBottom: "3px" }}>{r.name}</div>
<div style={{ fontSize: "12px", color: T.text2 }}>{r.detail}</div>
{r.extra && <div style={{ fontSize: "12px", color: r.color, marginTop: "3px" }}>{r.extra}</div>}
</div>
<div style={{ textAlign: "right", marginLeft: "16px" }}>
<div style={{ fontSize: "16px", fontWeight: "700", color: r.color }}>{fmt(r.amount)}</div>
<div style={{ fontSize: "12px", color: T.text2 }}>{r.monthly ? "/mo" : "balance"}</div>
</div>
</div>
))
}
</div>
);
})()}

{/*  Log Transaction  */}

  <div style={{ padding: "8px 24px", borderBottom: "1px solid " + T.bord }}>
    <button onClick={() => setEditModal("logspend")}
      style={{ background: T.bg, border: "1px solid " + T.blue, color: T.blue, padding: "6px 14px", borderRadius: "6px", fontSize: "12px", cursor: "pointer", fontFamily: "DM Mono, monospace", letterSpacing: "0.08em", display: "flex", alignItems: "center", gap: "6px" }}>
      <span className="material-symbols-outlined" style={{ fontSize: "16px", color: T.blue }}>add_circle</span>
      Log Spend
    </button>
  </div>

  <div className="budget-tabs" style={cs.tabs}>
    {[["overview","Overview"],["discretionary","Discretionary"],["fixed","Fixed"],["reserves","Reserves"],["debt","Debt Repayment"],["settings","Settings"]].map(([t, label]) => (
      <button key={t} onClick={() => setTab(t)} style={tabStyle(tab === t)}>{label}</button>
    ))}
  </div>

  <div style={cs.body}>

{tab === "overview" && (
  <div>
    {(() => {
      const discIds = ["bill001","bill002","bill003","bill004","bill005"];
      const discBuckets = buckets.filter(b => discIds.includes(b.id) && b.amount > 0);
      const discBudget = discBuckets.reduce((s,b) => s+b.amount, 0);
      const discSpent = discIds.reduce((s,id) => s + (cur.spent[id] || 0), 0);
      const discLeft = discBudget - discSpent;
      const discPct = Math.min(100, discBudget > 0 ? (discSpent / discBudget) * 100 : 0);
      const over = discSpent > discBudget;

      const today = new Date();
      const daysUntilPayday = (() => {
        if (today.getDate() <= primaryPayday) {
          return primaryPayday - today.getDate();
        } else {
          const paydayNextMonth = new Date(today.getFullYear(), today.getMonth() + 1, primaryPayday);
          return Math.ceil((paydayNextMonth - today) / (1000 * 60 * 60 * 24));
        }
      })();
      const isPayday = today.getDate() === primaryPayday;
      const nextPayMonthIdx = today.getDate() > primaryPayday ? (today.getMonth() + 1) % 12 : today.getMonth();

      const RESERVE_IDS_LIST = ["bill006","bill007","bill008","bill009","bill011","bill012","bill010"];
      const bankedYTD = RESERVE_IDS_LIST.reduce((s, id) => s + getReserveBal(id), 0);

      const fixedCommitted = (buckets.find(b => b.id === "bills") ? buckets.find(b => b.id === "bills").amount : 0) || 0;
      const fixedBillItems = ((buckets.find(b => b.id === "bills") && buckets.find(b => b.id === "bills").items) || []).filter(i => i.amt > 0);
      const fixedPaidCount = fixedBillItems.filter(i => i.day && i.day <= today.getDate()).length;

      const reservesTotal = RESERVE_IDS_LIST.reduce((s,id) => { const b = buckets.find(x => x.id === id); return s + (b ? b.amount : 0); }, 0);
      const debtPaymentTotal = debts.reduce((s,d) => s + (d.monthly || 0), 0);
      const leftover = Math.max(0, totalIncomeCfg - fixedCommitted - discBudget - reservesTotal - debtPaymentTotal);
      const treeDenom = totalIncomeCfg > 0 ? totalIncomeCfg : 1;

      const kpiLbl = { fontSize: "12px", color: T.text3, letterSpacing: "0.12em", textTransform: "uppercase" };
      const kpiAmt = { fontSize: "21px", fontWeight: "700", lineHeight: 1 };
      const kpiSub = { fontSize: "12px", color: T.text1, marginTop: "4px" };
      const kpiCard = { flex: "1 0 0", maxWidth: "400px", marginBottom: 0, padding: "12px 14px", boxSizing: "border-box" };

      return (
        <div style={{ marginBottom: "8px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "stretch", marginBottom: "8px" }}>

            <Card style={{ ...kpiCard, minWidth: "280px" }}>
              <div style={kpiLbl}>Fixed & Committed</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px", marginTop: "6px" }}>
                <div>
                  <div style={{ ...kpiAmt, color: T.text1 }}>{fmt(fixedCommitted)}</div>
                  <div style={{ ...kpiSub, whiteSpace: "nowrap" }}>autopays this month</div>
                </div>
                {fixedBillItems.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "4px", flexShrink: 0 }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "2px", width: "70px" }}>
                      {fixedBillItems.map(function(item, idx) {
                        return <div key={idx} style={{ width: "8px", height: "8px", borderRadius: "1px", background: item.day && item.day <= today.getDate() ? "#B8A9FF" : T.bord }} />;
                      })}
                    </div>
                    <div style={{ fontSize: "12px", color: T.text2 }}>{fixedPaidCount} of {fixedBillItems.length} paid</div>
                  </div>
                )}
              </div>
            </Card>

            <Card style={{ ...kpiCard, minWidth: "220px" }}>
              <div style={{ ...kpiLbl, whiteSpace: "nowrap" }}>{"Banked Since " + MONTHS[setupMonth] + " " + (setupYear - 2000)}</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "6px" }}>
                <div>
                  <div style={{ ...kpiAmt, color: T.green }}>{fmt(bankedYTD)}</div>
                  <div style={{ ...kpiSub, whiteSpace: "nowrap" }}>reserves + savings</div>
                </div>
                <span className="material-symbols-outlined" style={{ fontSize: "32px", color: T.green, flexShrink: 0, opacity: 0.8 }}>celebration</span>
              </div>
            </Card>

            <Card style={{ ...kpiCard, minWidth: "320px", cursor: "pointer", display: "flex", flexDirection: "row", alignItems: "flex-start", gap: "12px", padding: "12px" }} onClick={() => setShowFlowInfo(true)}>
              <div style={{ display: "flex", flexDirection: "column", flexShrink: 0, minWidth: "90px" }}>
                <div style={kpiLbl}>Monthly Income</div>
                <div style={{ ...kpiAmt, color: T.blue, marginTop: "6px" }}>{fmt(totalIncomeCfg)}</div>
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "stretch", minWidth: "140px", alignSelf: "stretch" }}>
                {(() => {
                  const flowItems = [
                    { label: "Fixed", value: fixedCommitted, color: "#3D6CB4" },
                    { label: "Disc", value: discBudget, color: "#C28A3A" },
                    { label: "Reserves", value: reservesTotal, color: "#8B7CFF" },
                    { label: "Debt", value: debtPaymentTotal, color: "#C25450" },
                    { label: "Leftover", value: leftover, color: "#2C8C76" },
                  ].filter(item => item.value > 0);

                  if (flowItems.length === 0) return <div style={{ color: T.text2 }}>No allocation data</div>;

                  const svgHeight = 45;
                  const svgWidth = 200;
                  const miniNodes = [{ id: "Income" }].concat(flowItems.map(f => ({ id: f.label })));
                  const miniLinks = flowItems.map(f => ({ source: "Income", target: f.label, value: f.value }));
                  const miniColorMap = { Income: "#C2C9D2" };
                  flowItems.forEach(f => { miniColorMap[f.label] = f.color; });

                  const miniLayout = d3Sankey()
                    .nodeId(d => d.id)
                    .nodeWidth(10)
                    .nodePadding(3)
                    .extent([[4, 2], [svgWidth - 4, svgHeight - 2]])
                    ({ nodes: miniNodes.map(d => ({ ...d })), links: miniLinks.map(d => ({ ...d })) });

                  const miniLinkPath = sankeyLinkHorizontal();

                  return (
                    <div style={{ position: "relative", width: "100%", flex: 1, minHeight: svgHeight + "px" }}>
                      <svg viewBox={"0 0 " + svgWidth + " " + svgHeight} preserveAspectRatio="xMidYMid meet" style={{ width: "100%", height: "100%", cursor: "pointer" }}>
                        {miniLayout.links.map((link, i) => {
                          const isHovered = moneyFlowHovered === link.target.id;
                          const opacity = moneyFlowHovered && !isHovered ? 0.14 : (isHovered ? 0.9 : 0.32);
                          return (
                            <path
                              key={"ml-" + i}
                              d={miniLinkPath(link)}
                              fill="none"
                              stroke={miniColorMap[link.target.id]}
                              strokeWidth={Math.max(4, link.width)}
                              opacity={opacity}
                              style={{ transition: "opacity 0.2s" }}
                              onMouseEnter={() => setMoneyFlowHovered(link.target.id)}
                              onMouseLeave={() => setMoneyFlowHovered(null)}
                            />
                          );
                        })}
                        {miniLayout.nodes.map(node => {
                          const h = node.y1 - node.y0;
                          const isHovered = moneyFlowHovered === node.id;
                          return (
                            <rect
                              key={node.id}
                              x={node.x0}
                              y={node.y0}
                              width={node.x1 - node.x0}
                              height={h}
                              rx={Math.min(4, h / 2)}
                              fill={miniColorMap[node.id]}
                              opacity={node.id === "Income" ? 0.9 : (isHovered ? 0.95 : 0.9)}
                              style={{ transition: "opacity 0.2s" }}
                              onMouseEnter={() => {
                                if (node.id !== "Income") {
                                  setMoneyFlowHovered(node.id);
                                  setMoneyFlowTooltip({ x: node.x1 + 8, y: node.y0 - 4, label: node.id, value: flowItems.find(f => f.label === node.id)?.value || 0 });
                                }
                              }}
                              onMouseLeave={() => {
                                setMoneyFlowHovered(null);
                                setMoneyFlowTooltip(null);
                              }}
                            />
                          );
                        })}
                      </svg>

                      {moneyFlowTooltip && (
                        <div style={{
                          position: "absolute",
                          left: moneyFlowTooltip.x,
                          top: moneyFlowTooltip.y,
                          background: T.bg,
                          border: "1px solid " + T.bord,
                          borderRadius: "8px",
                          padding: "6px 10px",
                          fontSize: "11px",
                          color: T.text1,
                          whiteSpace: "nowrap",
                          pointerEvents: "none",
                          zIndex: 10,
                          boxShadow: "0 2px 8px rgba(0,0,0,0.2)"
                        }}>
                          <div style={{ fontWeight: "700", color: T.blue }}>{moneyFlowTooltip.label}</div>
                          <div style={{ marginTop: "2px" }}>{fmt(moneyFlowTooltip.value)}</div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </Card>

            <Card border={isPayday ? T.green : T.bord} style={{ ...kpiCard, minWidth: "220px" }}>
              <div style={kpiLbl}>Payday</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "6px" }}>
                <div>
                  <div style={{ ...kpiAmt, color: isPayday ? T.green : T.text1 }}>{isPayday ? "Today" : daysUntilPayday + "d"}</div>
                  <div style={{ ...kpiSub, whiteSpace: "nowrap" }}>{isPayday ? fmt(totalIncomeCfg) + " incoming" : "Est. " + MONTHS[nextPayMonthIdx] + " " + ordinal(primaryPayday)}</div>
                </div>
                <span className="material-symbols-outlined" style={{ fontSize: "32px", color: isPayday ? T.green : T.text2, opacity: 0.6, flexShrink: 0 }}>calendar_clock</span>
              </div>
            </Card>

            {debts.length > 0 && (() => {
              const totalDebt = debts.reduce((s,d) => s + d.balance, 0);
              const monthsElapsed = (year - setupYear) * 12 + (month - setupMonth) + 1;
              const paidYTD = debts.reduce((s,d) => s + (d.monthly * Math.max(0, monthsElapsed)), 0);
              const denom = totalDebt + paidYTD;
              const paidPct = denom > 0 ? Math.round((paidYTD / denom) * 100) : 0;
              return (
                <Card style={{ ...kpiCard, minWidth: "250px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "stretch", gap: "10px" }}>
                    <div>
                      <div style={kpiLbl}>Debt Paid</div>
                      <div style={{ ...kpiAmt, color: "#B8A9FF", marginTop: "6px" }}>{paidPct}% paid</div>
                      <div style={kpiSub}>{fmt(totalDebt)} outstanding</div>
                    </div>
                    <div style={{ position: "relative", width: "20px", flexShrink: 0, alignSelf: "stretch", border: "1px solid #B8A9FF", borderRadius: "3px", background: T.text3, overflow: "hidden", minHeight: "54px" }}>
                      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: paidPct + "%", background: "#B8A9FF", borderRadius: "3px" }} />
                    </div>
                  </div>
                </Card>
              );
            })()}

          </div>

          <Card border={over ? T.red : T.bord} style={{ marginBottom: 0, padding: "14px 16px", minWidth: "300px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <div style={kpiLbl}>Discretionary Budget Used</div>
              <span style={{ fontSize: "12px", color: T.text2 }}>{Math.round(discPct)}%</span>
            </div>
            <div style={{ background: T.bord, borderRadius: "4px", height: "8px", marginBottom: "10px" }}>
              <div style={{ height: "100%", width: discPct + "%", background: over ? T.red : T.green, borderRadius: "4px" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: "12px", color: T.text2, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "2px" }}>Spent</div>
                <div style={{ fontSize: "15px", fontWeight: "700", color: over ? T.red : T.green }}>{fmt(discSpent)}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: "12px", color: T.text2, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "2px" }}>{over ? "Over Budget" : "Remaining"}</div>
                <div style={{ fontSize: "15px", fontWeight: "700", color: over ? T.red : discLeft < 200 ? "#FFB347" : T.green }}>{fmt(Math.abs(discLeft))}</div>
              </div>
            </div>
          </Card>
        </div>
      );
    })()}
    {(() => {
      const discIds = ["bill001","bill002","bill003","bill004","bill005"];
      const discBuckets = buckets.filter(b => discIds.includes(b.id) && b.amount > 0);
      if (discBuckets.length === 0) return null;
      return (
        <div style={{ marginBottom: "10px" }}>
          <div style={{ ...cs.lbl, marginBottom: "8px" }}>Spending This Month</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {discBuckets.map(b => {
              const spent = cur.spent[b.id] || 0;
              const pct = b.amount > 0 ? Math.min(100, (spent / b.amount) * 100) : 0;
              const remaining = b.amount - spent;
              const isOver = spent > b.amount;
              return (
                <Card key={b.id} style={{ flex: "1 0 0", minWidth: "160px", marginBottom: 0, padding: "12px 14px" }}>
                  <div style={{ fontSize: "12px", color: T.text3, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.label}</div>
                  <div style={{ fontSize: "15px", fontWeight: "700", color: b.color, marginBottom: "8px" }}>{fmt(b.amount)}</div>
                  <div style={{ background: T.bord, borderRadius: "3px", height: "5px", marginBottom: "6px" }}>
                    <div style={{ height: "100%", width: pct + "%", background: b.color, borderRadius: "3px" }} />
                  </div>
                  <div style={{ fontSize: "12px", color: isOver ? T.red : T.text2 }}>{isOver ? fmt(spent - b.amount) + " over" : fmt(remaining) + " left"}</div>
                </Card>
              );
            })}
          </div>
        </div>
      );
    })()}
    <div style={{ background: T.surf, border: "1px solid " + T.bord, borderRadius: "10px", padding: "12px 18px", marginBottom: "10px" }}>
      {(() => {
        const reserveIds = ["bill006","bill007","bill008","bill009","bill011","bill012","bill010"];
        const iconMap = {"bill008":"travel_luggage_and_bags","bill012":"health_and_beauty","bill006":"apparel","bill007":"featured_seasonal_and_gifts","bill009":"pets","bill011":"savings"};
        const reserves = buckets.filter(b => reserveIds.includes(b.id) && b.amount > 0);
        const total = reserves.reduce((s,b) => s + b.amount, 0);
        return (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}>
              <span style={{ ...cs.lbl, marginBottom: 0 }}>Savings & Reserves</span>
              <span style={{ fontSize: "12px", color: "#B8A9FF" }}>{fmt(total)}/mo earmarked</span>
            </div>
            {/* Stacked horizontal bar */}
            <div style={{ display: "flex", height: "24px", borderRadius: "6px", overflow: "hidden", marginBottom: "14px", gap: "2px" }}>
              {reserves.map(b => (
                <div key={b.id} title={b.label + ": $" + b.amount + "/mo"}
                  style={{ flex: b.amount, background: b.color, transition: "flex 0.3s", minWidth: "4px" }} />
              ))}
            </div>
            {/* Legend with icons */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 18px" }}>
              {reserves.map(b => (
                <div key={b.id} style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                  <span className="material-symbols-outlined" style={{ fontSize: "14px", color: b.color }}>{iconMap[b.id]}</span>
                  <span style={{ fontSize: "12px", color: T.text3 }}>{b.label.replace(" Reserve","").replace(" Savings","")}</span>
                  <span style={{ fontSize: "12px", color: b.color, fontWeight: "700" }}>${b.amount}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </div>

    <div style={{ background: T.surf, border: "1px solid " + T.bord, borderRadius: "10px", overflow: "hidden", marginBottom: "10px" }}>
      <div onClick={() => setShowRef(r => !r)} style={{ padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}>
        <span style={{ fontSize: "12px", fontWeight: "600", color: T.text2, letterSpacing: "0.1em", textTransform: "uppercase" }}>Budget Details</span>
        <span style={{ color: T.text2, fontSize: "12px" }}>{showRef ? "^" : ""}</span>
      </div>
      {showRef && (
        <div style={{ borderTop: "1px solid " + T.bord, padding: "4px 0 8px" }}>
          {[
            { group: "Fixed", color: T.blue, items:
              ((buckets.find(b => b.id === "bills") && buckets.find(b => b.id === "bills").items) || []).filter(i => i.amt > 0 && i.note !== "cc").map(i => ({ label: i.name, amt: i.amt }))
            },
            { group: "Discretionary", color: "#FFB347", items:
              buckets.filter(b => ["bill001","bill002","bill003","bill004","bill005"].includes(b.id) && b.amount > 0).map(b => ({ label: b.label, amt: b.amount }))
            },
            { group: "Reserves & Savings", color: "#B8A9FF", items:
              buckets.filter(b => ["bill006","bill007","bill008","bill009","bill011","bill012","bill010"].includes(b.id) && b.amount > 0).map(b => ({ label: b.label, amt: b.amount }))
            },
          ].map(group => (
            <div key={group.group}>
              <div style={{ padding: "8px 18px 4px", fontSize: "12px", letterSpacing: "0.15em", color: T.text3, textTransform: "uppercase" }}>{group.group}</div>
              {group.items.map(item => (
                <div key={item.label} style={{ display: "flex", justifyContent: "space-between", padding: "5px 18px", borderBottom: "1px solid " + T.bord }}>
                  <span style={{ fontSize: "12px", color: T.text3 }}>{item.label}</span>
                  <span style={{ fontSize: "12px", color: T.text1, fontWeight: "600" }}>{fmt(item.amt)}/mo</span>
                </div>
              ))}
            </div>
          ))}
          <div style={{ padding: "10px 18px 4px", display: "flex", justifyContent: "space-between", borderTop: "1px solid " + T.bord, marginTop: "4px" }}>
            <span style={{ fontSize: "12px", fontWeight: "700", color: T.text1 }}>Total</span>
            <span style={{ fontSize: "12px", fontWeight: "700", color: T.blue }}>{fmt(totalIncomeCfg)}/mo</span>
          </div>
        </div>
      )}
    </div>
  </div>
)}

{tab === "discretionary" && (
  <div>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
      <div style={cs.lbl}>Discretionary Spending - {MONTHS[month]} {year}</div>
      {renderEditBtn("disc")}
    </div>
    {(() => {
      const discIds = ["bill001","bill002","bill003","bill004","bill005"];
      const discBuckets = buckets.filter(b => discIds.includes(b.id) && b.amount > 0);
      const discBudget = discBuckets.reduce((s,b) => s+b.amount, 0);
      const discSpent = discIds.reduce((s,id) => s + (cur.spent[id] || 0), 0);
      const discLeft = discBudget - discSpent;
      const over = discSpent > discBudget;
      return (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "10px", marginBottom: "20px" }}>
            <Card>
              <div style={cs.lbl}>Total Budget</div>
              <div style={{ fontSize: "20px", fontWeight: "700", color: "#FFB347" }}>{fmt(discBudget)}</div>
            </Card>
            <Card>
              <div style={cs.lbl}>Spent</div>
              <div style={{ fontSize: "20px", fontWeight: "700", color: over ? T.red : "#FFB347" }}>{fmt(discSpent)}</div>
            </Card>
            <Card border={over ? T.red : discLeft < 200 ? "#FFB347" : T.bord}>
              <div style={cs.lbl}>Remaining</div>
              <div style={{ fontSize: "20px", fontWeight: "700", color: over ? T.red : discLeft < 200 ? "#FFB347" : T.green }}>{fmt(discLeft)}</div>
            </Card>
          </div>
          <div style={{ background: T.surf, border: "1px solid " + T.bord, borderRadius: "10px", padding: "16px 18px", marginBottom: "10px" }}>
            {(() => {
              const buckets = discBuckets;
              const totalSpentAll = buckets.reduce((s,b) => s + (cur.spent[b.id] || 0), 0);
              const totalRemAll = discBudget - totalSpentAll;
              const over = totalSpentAll > discBudget;
              const barHeight = 32;
              const gap = 6;
              return (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "12px" }}>
                    <div style={cs.lbl}>Discretionary Budget Used</div>
                    <div style={{ display: "flex", gap: "16px" }}>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: "12px", color: T.text2, letterSpacing: "0.1em", textTransform: "uppercase" }}>Spent</div>
                        <div style={{ fontSize: "16px", fontWeight: "700", color: over ? T.red : "#FFB347" }}>{fmt(totalSpentAll)}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: "12px", color: T.text2, letterSpacing: "0.1em", textTransform: "uppercase" }}>Remaining</div>
                        <div style={{ fontSize: "16px", fontWeight: "700", color: over ? T.red : totalRemAll < 200 ? "#FFB347" : T.green }}>{fmt(totalRemAll)}</div>
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "16px", alignItems: "flex-start" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "2px", width: "24px", flexShrink: 0 }}>
                      {buckets.map(b => {
                        const spent = cur.spent[b.id] || 0;
                        const over = spent > b.amount;
                        const heightPct = b.amount / discBudget;
                        const spentPct = Math.min(1, spent / b.amount);
                        const h = Math.max(8, Math.round(heightPct * (buckets.length * (barHeight + gap))));
                        return (
                          <div key={b.id} style={{ position: "relative", height: `${h}px`, background: "#2a3a50", borderRadius: "3px", overflow: "hidden" }}>
                            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: `${spentPct * 100}%`, background: over ? T.red : b.color, borderRadius: "3px", transition: "height 0.4s" }} />
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2px" }}>
                      {buckets.map(b => {
                        const spent = cur.spent[b.id] || 0;
                        const rem = b.amount - spent;
                        const over = spent > b.amount;
                        const heightPct = b.amount / discBudget;
                        const h = Math.max(8, Math.round(heightPct * (buckets.length * (barHeight + gap))));
                        return (
                          <div key={b.id} style={{ height: `${h}px`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                              <div style={{ width: "8px", height: "8px", borderRadius: "2px", background: b.color, flexShrink: 0 }} />
                              <span style={{ fontSize: "12px", color: T.text3 }}>{b.label}</span>
                            </div>
                            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                              {spent > 0 && <span style={{ fontSize: "12px", color: over ? T.red : b.color }}>{fmt(spent)} spent</span>}
                              <span style={{ fontSize: "12px", color: rem < 0 ? T.red : T.text2 }}>{rem >= 0 ? `${fmt(rem)} left` : `${fmt(Math.abs(rem))} over`}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>

          {discBuckets.map(b => {
            const spent = cur.spent[b.id] || 0;
            const rem = b.amount - spent;
            const over = spent > b.amount;
            const pct = Math.min(100, (spent / b.amount) * 100);
            const open = expanded === b.id;
            return (
              <div key={b.id} style={{ background: T.surf, border: `1px solid ${over ? T.red : open ? b.color+"55" : T.bord}`, borderRadius: "10px", marginBottom: "10px", overflow: "hidden" }}>
                <div onClick={() => setExpanded(open ? null : b.id)} style={{ padding: "14px 18px", display: "flex", justifyContent: "space-between", cursor: "pointer" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div style={{ width: "7px", height: "7px", borderRadius: "50%", background: b.color }} />
                    <span style={{ fontSize: "13px", fontWeight: "600" }}>{b.label}</span>
                  </div>
                  <div style={{ display: "flex", gap: "14px", alignItems: "center" }}>
                    <span style={{ fontSize: "12px", color: rem < 0 ? T.red : T.text2 }}>
                      {fmt(spent)} / {fmt(b.amount)}
                    </span>
                    <span style={{ color: rem < 0 ? T.red : T.green, fontSize: "12px", fontWeight: "700" }}>
                      {rem >= 0 ? `${fmt(rem)} left` : `${fmt(Math.abs(rem))} over`}
                    </span>
                  </div>
                </div>
                <div style={{ padding: "0 18px 10px" }}>
                  <div style={{ background: "#2a3a50", borderRadius: "4px", height: "5px" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: over ? T.red : b.color, borderRadius: "4px", transition: "width 0.4s" }} />
                  </div>
                </div>
                {open && (
                  <div style={{ padding: "0 18px 18px", borderTop: "1px solid " + T.bord }}>
                    <div style={{ marginTop: "14px", marginBottom: "14px" }}>
                      {b.items.map(item => (
                        <div key={item.name} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid " + T.bord, fontSize: "12px" }}>
                          <span style={{ color: T.text3 }}>{item.name}</span>
                          <span>{fmt(item.amt)}</span>
                        </div>
                      ))}
                    </div>
                    <div style={cs.lbl}>Log actual spend</div>
                    <div style={{ display: "flex", gap: "8px", marginTop: "6px" }}>
                      <input type="number" placeholder={`Budget: ${b.amount}`}
                        value={inputs[b.id] || (cur.spent[b.id] > 0 ? cur.spent[b.id] : "")}
                        onChange={e => setInputs(p => ({ ...p, [b.id]: e.target.value }))}
                        style={{ ...cs.inp, flex: 1 }} />
                      <Btn color={b.color} onClick={() => { setSpent(b.id, inputs[b.id] || cur.spent[b.id]); setInputs(p => ({ ...p, [b.id]: "" })); }}>Submit</Btn>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      );
    })()}
  </div>
)}

{tab === "fixed" && (
  <div>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
      <div style={cs.lbl}>Fixed Expenses - {MONTHS[month]} {year}</div>
      {renderEditBtn("bills")}
    </div>
    {(() => {
      const billsBucket = buckets.find(b => b.id === "bills");
      const fixedBudget = billsBucket ? billsBucket.amount : 0;
      const allItems = ((billsBucket && billsBucket.items) || []).filter(i => i.amt > 0 || i.note === "cc");
      const knownItems = [...allItems].filter(i => i.day).sort((a,b) => a.day - b.day);
      const unknownItems = allItems.filter(i => !i.day);
      let running = 0;
      return (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px", marginBottom: "20px" }}>
            <Card>
              <div style={cs.lbl}>Monthly Fixed Total</div>
              <div style={{ fontSize: "20px", fontWeight: "700", color: T.blue }}>{fmt(fixedBudget)}</div>
            </Card>
            <Card>
              <div style={cs.lbl}>Payday</div>
              <div style={{ fontSize: "20px", fontWeight: "700", color: T.green }}>{ordinal(primaryPayday)}</div>
              <div style={{ fontSize: "12px", color: T.text2, marginTop: "2px" }}>early bills funded by prev. paycheck</div>
            </Card>
          </div>

          {(() => {
            const upcomingItems = knownItems.filter(item => !isBillPaid(item.day));
            const paidItems = knownItems.filter(item => isBillPaid(item.day));
            const renderItem = (item, i, arr) => {
              const isCC = item.note === "cc";
              const isEarly = item.day < primaryPayday;
              const paid = isBillPaid(item.day);
              if (!isCC) running += item.amt;
              return (
                <div key={item.name + i} style={{
                  display: "flex", alignItems: "center", gap: "12px",
                  padding: "11px 16px",
                  borderBottom: i < knownItems.length - 1 ? "1px solid " + T.bord : "none",
                  background: paid ? T.surf2 : isCC ? "#0a1520" : "transparent",
                  transition: "background 0.2s",
                }}>
                  <div style={{ width: "36px", height: "36px", borderRadius: "8px", background: isCC ? "#1a2a3a" : isEarly ? "#1a2535" : "#1a2a1a", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <span style={{ fontSize: "12px", fontWeight: "700", color: isCC ? "#98D4E8" : isEarly ? T.blue : T.green }}>{ordinal(item.day)}</span>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "13px", fontWeight: "600", color: paid ? T.muted : isCC ? "#98D4E8" : T.text1, textDecoration: paid ? "line-through" : "none", opacity: paid ? 0.5 : 1 }}>{item.name}</div>
                    <div style={{ fontSize: "12px", color: T.text2, marginTop: "2px" }}>
                      {paid ? "cleared" : isCC ? "credit card sweep" : ("autopay " + ordinal(item.day) + " of month")}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    {!isCC && (
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: "13px", fontWeight: "700", color: paid ? T.muted : T.blue }}>{fmt(item.amt)}</div>
                        <div style={{ fontSize: "12px", color: T.text2 }}>running: {fmt(running)}</div>
                      </div>
                    )}
                    {isCC && <div style={{ fontSize: "12px", color: "#98D4E8", fontStyle: "italic" }}>balance varies</div>}
                    <div style={{
                        width: "20px", height: "20px", borderRadius: "50%", flexShrink: 0,
                        background: paid ? "#2a2f3a" : "transparent",
                        border: `2px solid ${paid ? "#3a4555" : "#2a3a50"}`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "12px", color: paid ? "#5a6578" : "transparent",
                      }}></div>
                  </div>
                </div>
              );
            };
            return (
              <div>
                <div style={{ ...cs.lbl, marginBottom: "12px" }}>Upcoming This Month</div>
                <div style={{ background: T.surf, border: "1px solid " + T.bord, borderRadius: "10px", overflow: "hidden", marginBottom: "16px" }}>
                  {upcomingItems.length === 0
                    ? <div style={{ padding: "14px 18px", fontSize: "13px", color: T.text2 }}>All bills cleared for the month </div>
                    : (() => {
                        const prePayday = upcomingItems.filter(i => i.day < primaryPayday);
                        const postPayday = upcomingItems.filter(i => i.day >= primaryPayday);
                        const paydayDivider = (
                          <div key="payday" style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 16px", background: T.blueBg, borderTop: "1px solid " + T.bord, borderBottom: "1px solid " + T.bord }}>
                            <div style={{ flex: 1, height: "1px", background: T.green, opacity: 0.4 }} />
                            <span style={{ fontSize: "12px", letterSpacing: "0.15em", textTransform: "uppercase", color: T.green, fontWeight: "700", whiteSpace: "nowrap" }}> Payday - ${ordinal(primaryPayday)}</span>
                            <div style={{ flex: 1, height: "1px", background: T.green, opacity: 0.4 }} />
                          </div>
                        );
                        return (
                          <>
                            {prePayday.map((item, i) => renderItem(item, i, prePayday))}
                            {prePayday.length > 0 && postPayday.length > 0 && paydayDivider}
                            {postPayday.length > 0 && prePayday.length === 0 && paydayDivider}
                            {postPayday.map((item, i) => renderItem(item, i, postPayday))}
                          </>
                        );
                      })()
                  }
                </div>
                {paidItems.length > 0 && (
                  <div>
                    <div style={{ ...cs.lbl, marginBottom: "12px" }}>Cleared</div>
                    <div style={{ background: T.surf2, border: "1px solid #1a2030", borderRadius: "10px", overflow: "hidden", marginBottom: "16px" }}>
                      {paidItems.map((item, i) => renderItem(item, i, paidItems))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          <div style={{ ...cs.lbl, marginBottom: "12px" }}>Date Unknown</div>
          <div style={{ background: T.surf, border: "1px solid " + T.bord, borderRadius: "10px", overflow: "hidden" }}>
            {unknownItems.map((item, i) => (
              <div key={item.name} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "10px 16px",
                borderBottom: i < unknownItems.length - 1 ? "1px solid " + T.bord : "none",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <div style={{ width: "36px", height: "36px", borderRadius: "8px", background: T.bord, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <span style={{ fontSize: "16px", color: T.text2 }}>?</span>
                  </div>
                  <span style={{ fontSize: "13px" }}>{item.name}</span>
                </div>
                <span style={{ fontSize: "13px", fontWeight: "700", color: T.blue }}>{fmt(item.amt)}</span>
              </div>
            ))}
          </div>
        </div>
      );
    })()}
  </div>
)}

{tab === "reserves" && (
  <div>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
      <div style={cs.lbl}>Reserves & Savings</div>
      {renderEditBtn("reserves")}
    </div>
    {(() => {
      const reserves = buckets
        .filter(b => ["bill006","bill007","bill008","bill009","bill011","bill012","bill010"].includes(b.id))
        .map(b => ({ label: b.label.replace(" Reserve","").replace(" Savings",""), amt: b.amount, color: b.color }));
      const total = reserves.reduce((s, r) => s + r.amt, 0);
      const size = 180;
      const cx = size / 2, cy = size / 2;
      const outerR = 80, innerR = 50;
      let cumAngle = -Math.PI / 2;
      const slices = reserves.map(r => {
        const angle = (r.amt / total) * 2 * Math.PI;
        const startAngle = cumAngle;
        cumAngle += angle;
        const endAngle = cumAngle;
        const x1 = cx + outerR * Math.cos(startAngle);
        const y1 = cy + outerR * Math.sin(startAngle);
        const x2 = cx + outerR * Math.cos(endAngle);
        const y2 = cy + outerR * Math.sin(endAngle);
        const ix1 = cx + innerR * Math.cos(endAngle);
        const iy1 = cy + innerR * Math.sin(endAngle);
        const ix2 = cx + innerR * Math.cos(startAngle);
        const iy2 = cy + innerR * Math.sin(startAngle);
        const largeArc = angle > Math.PI ? 1 : 0;
        const d = `M ${x1} ${y1} A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2} L ${ix1} ${iy1} A ${innerR} ${innerR} 0 ${largeArc} 0 ${ix2} ${iy2} Z`;
        return { ...r, d, pct: Math.round((r.amt / total) * 100) };
      });
      return (
        <div style={{ display: "flex", alignItems: "center", gap: "24px", background: T.surf, border: "1px solid " + T.bord, borderRadius: "12px", padding: "20px 24px", marginBottom: "20px", flexWrap: "wrap" }}>
          <div style={{ position: "relative", flexShrink: 0 }}>
            <svg width={size} height={size}>
              {slices.map((s, i) => (
                <path key={i} d={s.d} fill={s.color} opacity={0.9} stroke={T.bg} strokeWidth="2" />
              ))}
            </svg>
            <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", textAlign: "center" }}>
              <div style={{ fontSize: "12px", color: T.text2, letterSpacing: "0.1em", textTransform: "uppercase" }}>Total</div>
              <div style={{ fontSize: "18px", fontWeight: "700", color: T.text1 }}>{fmt(total)}</div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", flex: 1, minWidth: "160px" }}>
            {/* Banked Reserves YTD */}
            {(() => {
              // Reuse shared getReserveBal to stay consistent with Overview KPI
              const resIds = ["bill006","bill007","bill008","bill009","bill011","bill012","bill010"];
              const ytd = resIds.reduce((s, id) => s + getReserveBal(id), 0);
              return (
                <div style={{ marginBottom: "10px", paddingBottom: "10px", borderBottom: "1px solid " + T.bord }}>
                  <div style={cs.lbl}>Banked Reserves YTD</div>
                  <div style={{ fontSize: "18px", fontWeight: "700", color: ytd >= 0 ? T.green : T.red }}>{ytd < 0 ? "-" : ""}{fmt(Math.abs(ytd))}</div>
                  <div style={{ fontSize: "12px", color: T.text2, marginTop: "2px" }}>net contributions minus spending</div>
                </div>
              );
            })()}
            {slices.map((s, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div style={{ width: "10px", height: "10px", borderRadius: "2px", background: s.color, flexShrink: 0 }} />
                <span style={{ fontSize: "12px", color: T.text3, flex: 1 }}>{s.label}</span>
                <span style={{ fontSize: "12px", color: s.color, fontWeight: "700" }}>{fmt(s.amt)}</span>
                <span style={{ fontSize: "12px", color: T.text2, width: "32px", textAlign: "right" }}>{s.pct}%</span>
              </div>
            ))}
          </div>
        </div>
      );
    })()}
    {(() => {
      const RESERVE_BUCKETS = buckets.filter(b => ["bill006", "bill007", "bill008", "bill009", "bill011", "bill012", "bill010"].includes(b.id) && b.amount > 0);
      // monthly contribution comes from cfg via reserveMonthly, not hardcoded
      RESERVE_BUCKETS.forEach(b => b.monthly = reserveMonthly[b.id] || b.amount || 0);
      return (
    <div style={{ marginBottom: "20px" }}>
      {RESERVE_BUCKETS.map(r => {
        const txs = (cur.reserveTransactions || []).filter(tx => tx.reserveId === r.id);
        const txTotal = txs.reduce((s, t) => s + t.amount, 0);
        const isOpen = expandedReserve === r.id;
        return (
          <div key={r.id} style={{ marginBottom: "10px" }}>
            <div onClick={() => setExpandedReserve(isOpen ? null : r.id)}
              style={{ background: r.bg, border: `1px solid ${isOpen ? r.color : r.color + "88"}`, borderRadius: isOpen ? "12px 12px 0 0" : "12px", padding: "16px 20px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                <div style={{ opacity: 0.9, flexShrink: 0 }}>
                  {RESERVE_ICONS[r.id] ? RESERVE_ICONS[r.id](r.color) : null}
                </div>
                <div>
                  <div style={cs.lbl}>{r.label}</div>
                  <div style={{ fontSize: "26px", fontWeight: "700", color: r.color, letterSpacing: "-0.02em" }}>{fmt(reserveBals[r.id] || 0)}</div>
                  <div style={{ fontSize: "12px", color: r.color, marginTop: "2px" }}>${r.monthly}/mo contribution</div>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                {txs.length > 0 && <div style={{ fontSize: "12px", color: r.color, marginBottom: "4px" }}>{txs.length} transaction{txs.length !== 1 ? "s" : ""}</div>}
                {txs.length > 0 && <div style={{ fontSize: "13px", fontWeight: "700", color: r.color }}>-{fmt(txTotal)}</div>}
                <div style={{ fontSize: "16px", color: r.color, opacity: 0.7, marginTop: "4px" }}>{isOpen ? "^" : ""}</div>
              </div>
            </div>
            {isOpen && (
              <div style={{ background: T.surf2, border: `1px solid ${r.color}88`, borderTop: "none", borderRadius: "0 0 12px 12px", overflow: "hidden" }}>
                {txs.length === 0
                  ? <div style={{ padding: "14px 18px", fontSize: "12px", color: T.text2 }}>No transactions logged for {MONTHS[month]} {year}</div>
                  : txs.map((tx, i) => (
                    <div key={tx.id} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 18px", borderBottom: i < txs.length - 1 ? `1px solid ${r.color}22` : "none" }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: "13px", fontWeight: "600", color: T.text1 }}>{tx.merchant}</div>
                        <div style={{ fontSize: "12px", color: T.text2, marginTop: "2px" }}>{tx.date}</div>
                      </div>
                      <div style={{ fontSize: "13px", fontWeight: "700", color: r.color, marginRight: "8px" }}>-{fmt(tx.amount)}</div>
                      <select value={tx.reserveId || ""} onChange={e => reassignTransaction(tx.id, e.target.value || null)}
                        style={{ background: T.surf, border: `1px solid ${r.color}55`, color: T.text2, padding: "4px 8px", borderRadius: "6px", fontSize: "12px", cursor: "pointer", fontFamily: "DM Mono, monospace" }}>
                        <option value="">Unassign</option>
                        {buckets.filter(b => ["bill006", "bill007", "bill008", "bill009", "bill011", "bill012"].includes(b.id)).map(opt => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
                      </select>
                    </div>
                  ))
                }
              </div>
            )}
          </div>
        );
      })}
    </div>
      );
    })()}
    {(() => {
      // All 8 reserve IDs with their label and color
      const ALL_HIST_COLS = [
        { id: "bill008", color: T.green },
        { id: "bill011", color: "#B8A9FF" },
        { id: "bill010", color: "#60A5FA" },
        { id: "bill006", color: "#F97316" },
        { id: "bill007", color: "#FDBA74" },
        { id: "bill009", color: "#F9A8D4" },
        { id: "bill012", color: "#C084FC" },
        { id: "bill013", color: "#34D399" },
      ];
      // Show all cols when reserves modal is open, otherwise only allocated
      const histCols = editModal === "reserves"
        ? ALL_HIST_COLS
        : ALL_HIST_COLS.filter(c => (reserveMonthly[c.id] || 0) > 0);
      if (histCols.length === 0) return null;
      // Running balances keyed by id
      const bals = {};
      histCols.forEach(c => { bals[c.id] = 0; });
      const rows = [];
      for (let y = setupYear; y <= year + 1; y++)
        for (let m = 0; m < 12; m++) {
          if (y === setupYear && m < setupMonth) continue;
          if (y > year || (y === year && m > month)) break;
          const d = data[`${y}-${m}`] || {};
          histCols.forEach(c => {
            bals[c.id] = Math.round((bals[c.id] + (reserveMonthly[c.id] || 0) - ((d.spent && d.spent[c.id]) || 0)) * 100) / 100;
          });
          const isCur = y === year && m === month;
          rows.push(
            <tr key={`${y}-${m}`} style={{ borderBottom: "1px solid " + T.bg, background: isCur ? T.blueBg : "transparent" }}>
              <td style={{ padding: "8px 10px", color: isCur ? T.blue : T.text1, whiteSpace: "nowrap" }}>{MONTHS[m]} {y}</td>
              {histCols.map(c => (
                <td key={c.id} style={{ padding: "8px 10px", fontWeight: "700", color: bals[c.id] >= 0 ? c.color : T.red }}>{fmt(bals[c.id])}</td>
              ))}
            </tr>
          );
        }
      // Build short label from bucket label in cfg, fall back to id
      const colLabel = (id) => {
        const b = buckets.find(x => x.id === id);
        return ((b && b.label) || id).replace(" Reserve","").replace(" Savings","").replace(" Reserve","");
      };
      return (
        <Card style={{ padding: "0", overflow: "hidden" }}>
          <div style={{ padding: "12px 18px", borderBottom: "1px solid " + T.bord, ...cs.lbl }}>Reserve History</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid " + T.bord }}>
                  <th style={{ padding: "8px 10px", textAlign: "left", color: T.text2, fontWeight: "400", whiteSpace: "nowrap" }}>Month</th>
                  {histCols.map(c => (
                    <th key={c.id} style={{ padding: "8px 10px", textAlign: "left", color: c.color, fontWeight: "400", whiteSpace: "nowrap" }}>{colLabel(c.id)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>{rows}</tbody>
            </table>
          </div>
        </Card>
      );
    })()}
  </div>
)}

{tab === "debt" && (
  <div>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
      <div style={cs.lbl}>Debt Repayment</div>
      {renderEditBtn("debt")}
    </div>
    {(() => {
      //  Payoff calculator 
      function calcPayoff(debt, customMonthly) {
        const pmt = customMonthly || debt.monthlyPrincipal;
        if (debt.grows || pmt === 0) return null;
        if (debt.apr === 0) {
          const months = Math.ceil(debt.balance / pmt);
          const d = new Date();
          d.setMonth(d.getMonth() + months);
          return { months, date: MONTHS[d.getMonth()] + " " + d.getFullYear(), totalInterest: 0 };
        }
        // Amortization
        const monthlyRate = debt.type === "auto"
          ? Math.pow(1 + debt.apr / 365 / 100, 30.4375) - 1
          : debt.apr / 12 / 100;
        let balance = debt.balance;
        let months = 0;
        let totalInterest = 0;
        while (balance > 0.01 && months < 600) {
          const interest = balance * monthlyRate;
          if (pmt <= interest) return null;
          totalInterest += interest;
          balance -= (pmt - interest);
          months++;
        }
        const d = new Date(debt.balanceAsOf);
        d.setMonth(d.getMonth() + months);
        return { months, date: MONTHS[d.getMonth()] + " " + d.getFullYear(), totalInterest };
      }

      //  Summary KPIs 
      const totalBal = debts.reduce((s, d) => s + d.balance, 0);
      const medDebts = debts.filter(d => d.type === "medical");
      const otherDebts = debts.filter(d => d.type !== "medical");
      const totalMonthly = debts.reduce((s, d) => s + d.monthly, 0);
      const totalMedBal = medDebts.reduce((s, d) => s + d.balance, 0);

      const typeLabel = { medical: "Medical", auto: "Auto", mortgage: "Mortgage", student: "Student", "credit card": "Credit Card", other: "Other" };
      const typeColor = { medical: "#FF6B9D", auto: T.blue, mortgage: T.green, student: "#FFB347", "credit card": "#C084FC", other: T.text3 };
      const typeIcon  = { medical: "local_hospital", auto: "directions_car", mortgage: "home", student: "school", "credit card": "credit_card", other: "payments" };

      return (
        <div>
          {debts.length > 0 ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px", marginBottom: "20px" }}>
            <Card>
              <div style={cs.lbl}>Total Debt</div>
              <div style={{ fontSize: "20px", fontWeight: "700", color: "#FF6B9D" }}>{fmt(totalBal, 0)}</div>
              <div style={{ fontSize: "12px", color: T.text2, marginTop: "2px" }}>across {debts.filter(d => d.balance > 0).length} accounts</div>
            </Card>
            <Card>
              <div style={cs.lbl}>Monthly Payments</div>
              <div style={{ fontSize: "20px", fontWeight: "700", color: "#FFB347" }}>{fmt(totalMonthly)}</div>
              <div style={{ fontSize: "12px", color: T.text2, marginTop: "2px" }}>est. from tracked debts</div>
            </Card>
          </div>
          ) : (
          <div style={{ background: T.surf, border: "1px solid " + T.bord, borderRadius: "10px", padding: "20px 18px", marginBottom: "20px", display: "flex", alignItems: "center", gap: "12px" }}>
            <span className="material-symbols-outlined" style={{ fontSize: "28px", color: T.muted }}>credit_card_off</span>
            <div>
              <div style={{ fontSize: "13px", color: T.text2, marginBottom: "4px" }}>No debts added yet</div>
              <div style={{ fontSize: "12px", color: T.muted }}>Re-run the setup wizard from Settings to add debts.</div>
            </div>
          </div>
          )}

          {/* Debt cards grouped by type -- render all types that have debts */}
          {Object.keys(typeLabel).filter(type => debts.some(d => d.type === type)).map(type => {
            const group = debts.filter(d => d.type === type);
            if (!group.length) return null;
            return (
              <div key={type} style={{ marginBottom: "24px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                  <span className="material-symbols-outlined" style={{ fontSize: "18px", color: typeColor[type] }}>{typeIcon[type]}</span>
                  <div style={{ ...cs.lbl, marginBottom: 0, color: typeColor[type] }}>{typeLabel[type]}</div>
                </div>
                {group.map(debt => {
                  const payoff = calcPayoff(debt, projMonthly[debt.id]);
                  const pct = debt.grows ? null : Math.min(100, debt.balance > 0 ? 100 : 0);
                  return (
                    <Card key={debt.id} border={debt.balance > 0 ? typeColor[type] + "33" : T.bord} style={{ marginBottom: "12px" }}>
                      {/* Header row */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "14px" }}>
                        <div>
                          <div style={{ fontSize: "14px", fontWeight: "700", color: debt.balance > 0 ? typeColor[type] : T.text2 }}>{debt.name}</div>
                          {debt.note && <div style={{ fontSize: "12px", color: T.text2, marginTop: "3px" }}>{debt.note}</div>}
                          <div style={{ display: "flex", gap: "10px", marginTop: "6px", flexWrap: "wrap" }}>
                            <span style={{ fontSize: "12px", letterSpacing: "0.1em", textTransform: "uppercase", color: debt.apr === 0 ? T.green : "#FFB347", background: (debt.apr === 0 ? T.green : "#FFB347") + "22", padding: "2px 8px", borderRadius: "4px" }}>
                              {debt.apr === 0 ? "0% interest" : debt.apr + "% APR"}
                            </span>
                            {debt.escrow > 0 && <span style={{ fontSize: "12px", letterSpacing: "0.1em", textTransform: "uppercase", color: T.text2, background: T.bord, padding: "2px 8px", borderRadius: "4px" }}>incl. {fmt(debt.escrow)} escrow</span>}
                            {debt.grows && <span style={{ fontSize: "12px", letterSpacing: "0.1em", textTransform: "uppercase", color: "#FF6B9D", background: "#FF6B9D22", padding: "2px 8px", borderRadius: "4px" }}>balance growing</span>}
                          </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: "22px", fontWeight: "700", color: T.text1 }}>{fmt(debt.balance, 2)}</div>
                          <div style={{ fontSize: "12px", color: T.text2, marginTop: "2px" }}>{fmt(debt.monthly)}/mo payment</div>
                          {debt.escrow > 0 && <div style={{ fontSize: "12px", color: T.text2 }}>{fmt(debt.monthlyPrincipal)}/mo to principal</div>}
                        </div>
                      </div>

                      {/* Payoff projector */}
                      {debt.balance > 0 && !debt.grows && debt.monthlyPrincipal > 0 && (
                        <div style={{ background: T.bg, borderRadius: "8px", padding: "12px", marginBottom: "12px" }}>
                          <div style={cs.lbl}>Payoff Projector</div>
                          <div style={{ display: "flex", gap: "8px", marginTop: "8px", alignItems: "center" }}>
                            <span style={{ fontSize: "12px", color: T.text2 }}>Scenario: pay</span>
                            <input type="number" placeholder={debt.monthlyPrincipal}
                              value={projMonthly[debt.id] || ""}
                              onChange={e => setProjectMonthly(p => ({ ...p, [debt.id]: parseFloat(e.target.value) || 0 }))}
                              style={{ ...cs.inp, width: "90px", fontSize: "12px" }} />
                            <span style={{ fontSize: "12px", color: T.text2 }}>/mo to principal</span>
                          </div>
                          {payoff && (
                            <div style={{ marginTop: "12px", display: "flex", gap: "20px", flexWrap: "wrap" }}>
                              {[
                                { label: "Months", value: payoff.months },
                                { label: "Payoff Date", value: payoff.date },
                                { label: "Total Interest", value: debt.apr === 0 ? "$0" : fmt(payoff.totalInterest, 2) },
                              ].map(st => (
                                <div key={st.label}>
                                  <div style={cs.lbl}>{st.label}</div>
                                  <div style={{ fontSize: "18px", fontWeight: "700", color: typeColor[type] }}>{st.value}</div>
                                </div>
                              ))}
                            </div>
                          )}
                          {debt.apr === 0 && <div style={{ fontSize: "12px", color: "#4a7a5a", marginTop: "6px" }}>No interest - total paid = current balance</div>}
                        </div>
                      )}

                      {/* Growing balance warning */}
                      {debt.grows && (
                        <div style={{ background: T.bg, borderRadius: "8px", padding: "10px", marginBottom: "12px", fontSize: "12px", color: T.text2 }}>
                           Balance is growing - update manually after each billing. Projection available once balance is closed.
                        </div>
                      )}

                      {/* Update balance + payment */}
                      {debt.balance > 0 && (
                        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                          <div style={{ flex: "1 1 150px", maxWidth: "300px", minWidth: "150px" }}>
                            <div style={{ ...cs.lbl, marginBottom: "4px" }}>Update Balance</div>
                            <div style={{ display: "flex", gap: "6px" }}>
                              <input type="number" placeholder={debt.balance.toFixed(2)}
                                value={debtInputs[debt.id + "-bal"] || ""}
                                onChange={e => setDebtInputs(p => ({ ...p, [debt.id + "-bal"]: e.target.value }))}
                                style={{ ...cs.inp, flex: 1, fontSize: "12px", minWidth: 0 }} />
                              <button onClick={() => {
                                const v = parseFloat(debtInputs[debt.id + "-bal"]);
                                if (!isNaN(v)) {
                                  setDebts(p => p.map(d => d.id === debt.id ? { ...d, balance: v } : d));
                                  setDebtInputs(p => ({ ...p, [debt.id + "-bal"]: "" }));
                                }
                              }} style={{ background: T.bg, border: "1px solid " + T.blue, color: T.blue, padding: "6px 14px", borderRadius: "6px", fontSize: "12px", fontWeight: "700", cursor: "pointer" }}>Save</button>
                            </div>
                          </div>
                          <div style={{ flex: "1 1 150px", maxWidth: "300px", minWidth: "150px" }}>
                            <div style={{ ...cs.lbl, marginBottom: "4px" }}>Update Payment (Monthly)</div>
                            <div style={{ display: "flex", gap: "6px" }}>
                              <input type="number" placeholder={debt.monthly}
                                value={debtInputs[debt.id + "-mo"] || ""}
                                onChange={e => setDebtInputs(p => ({ ...p, [debt.id + "-mo"]: e.target.value }))}
                                style={{ ...cs.inp, flex: 1, fontSize: "12px", minWidth: 0 }} />
                              <button onClick={() => {
                                const v = parseFloat(debtInputs[debt.id + "-mo"]);
                                if (!isNaN(v)) {
                                  setDebts(p => p.map(d => d.id === debt.id ? { ...d, monthly: v, monthlyPrincipal: d.escrow > 0 ? v - d.escrow : v } : d));
                                  setDebtInputs(p => ({ ...p, [debt.id + "-mo"]: "" }));
                                }
                              }} style={{ background: T.bg, border: "1px solid " + T.blue, color: T.blue, padding: "6px 14px", borderRadius: "6px", fontSize: "12px", fontWeight: "700", cursor: "pointer" }}>Save</button>
                            </div>
                          </div>
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            );
          })}
        </div>
      );
    })()}
  </div>
)}

{tab === "settings" && (
  <div>
    <div style={{ ...cs.lbl, marginBottom: "16px" }}>Settings</div>

    {/* Budget Setup */}
    <div style={{ background: T.surf, border: "1px solid " + T.bord, borderRadius: "10px", padding: "16px 18px", marginBottom: "10px" }}>
      <div style={{ fontSize: "13px", fontWeight: "700", color: T.text1, marginBottom: "4px" }}>Budget Setup</div>
      <div style={{ fontSize: "12px", color: T.text3, marginBottom: "14px" }}>Re-run the setup wizard. Your current budget will be pre-filled so you can adjust it.</div>
      <button onClick={onRerunWizard} style={{ background: "transparent", border: "1px solid " + T.blue, color: T.blue, padding: "8px 16px", borderRadius: "6px", fontSize: "12px", fontWeight: "700", cursor: "pointer", fontFamily: "DM Mono, monospace", display: "flex", alignItems: "center", gap: "6px" }}>
        <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>tune</span>
        Edit Budget Setup
      </button>
    </div>

    {/* Appearance */}
    <div style={{ background: T.surf, border: "1px solid " + T.bord, borderRadius: "10px", padding: "16px 18px", marginBottom: "10px" }}>
      <div style={{ fontSize: "13px", fontWeight: "700", color: T.text1, marginBottom: "4px" }}>Appearance</div>
      <div style={{ fontSize: "12px", color: T.text3, marginBottom: "14px" }}>Choose dark, light, or match your device setting.</div>
      <div style={{ display: "flex", gap: "0", border: "1px solid " + T.bord, borderRadius: "6px", overflow: "hidden" }}>
        {[["dark", "Dark", "dark_mode"], ["light", "Light", "light_mode"], ["system", "System", "settings_brightness"]].map(function(opt) {
          var val = opt[0], label = opt[1], icon = opt[2];
          var active = themePref === val;
          return <button key={val} onClick={function() { setThemePref(val); saveTheme(val); }} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", padding: "10px 8px", fontSize: "12px", fontWeight: active ? "700" : "400", color: active ? T.blue : T.text3, background: active ? T.blueBg : "transparent", border: "none", cursor: "pointer", fontFamily: "DM Mono, monospace", minHeight: "44px", borderRight: val !== "system" ? "1px solid " + T.bord : "none" }}>
            <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>{icon}</span>
            {label}
          </button>;
        })}
      </div>
    </div>

    {/* Data */}
    <div style={{ background: T.surf, border: "1px solid " + T.bord, borderRadius: "10px", padding: "16px 18px", marginBottom: "10px" }}>
      <div style={{ fontSize: "13px", fontWeight: "700", color: T.text1, marginBottom: "4px" }}>Data & Storage</div>
      <div style={{ fontSize: "12px", color: T.text3, marginBottom: "14px" }}>Your data is stored only on this device, never sent to a server.</div>

      {/* Export + Import side by side */}
      <div style={{ display: "flex", gap: "10px", marginBottom: "8px" }}>
      {/* Export CSV */}
      <button onClick={() => {
        // -- Build CSV from localStorage --
        const c = loadConfig() || {};
        const d = loadData() || {};
        const db = loadDebts() || [];
        const lines = [];
        const esc = v => {
          const s = String(v == null ? "" : v);
          return (s.indexOf(",") >= 0 || s.indexOf('"') >= 0 || s.indexOf("\n") >= 0)
            ? '"' + s.replace(/"/g, '""') + '"' : s;
        };
        const row = function() { lines.push(Array.prototype.map.call(arguments, esc).join(",")); };

        // -- INCOME --
        lines.push("## INCOME");
        row("Label", "Per Paycheck", "Frequency", "Payday", "Monthly Total");
        (c?.incomes || []).forEach(function(inc) {
          row(inc.label, inc.perPaycheck, inc.frequency, inc.payday, inc.netPay);
        });
        lines.push("");

        // -- FIXED BILLS --
        lines.push("## FIXED BILLS");
        row("Name", "Amount", "Due Day", "Category", "Note");
        var billsBucket = c?.buckets?.find(function(b) { return b.id === "bills"; }) ?? null;
        ((billsBucket && billsBucket.items) || []).forEach(function(item) {
          row(item.name, item.amt, item.day, item.category || "", item.note || "");
        });
        lines.push("");

        // -- DISCRETIONARY --
        lines.push("## DISCRETIONARY");
        row("ID", "Label", "Monthly Budget");
        var discIds = ["bill001", "bill002", "bill003", "bill004", "bill005"];
        (c?.buckets || []).filter(function(b) { return discIds.indexOf(b.id) >= 0; }).forEach(function(b) {
          row(b.id, b.label, b.amount);
        });
        lines.push("");

        // -- RESERVES --
        lines.push("## RESERVES");
        row("ID", "Label", "Monthly Contribution");
        var resIds = ["bill011", "bill010", "bill008", "bill006", "bill007", "bill009", "bill012", "bill013"];
        (c?.buckets || []).filter(function(b) { return resIds.indexOf(b.id) >= 0; }).forEach(function(b) {
          row(b.id, b.label, b.amount);
        });
        lines.push("");

        // -- DEBTS --
        lines.push("## DEBTS");
        row("Name", "Type", "Balance", "APR", "Monthly Payment", "Monthly Principal", "Escrow", "Balance As Of", "Growing", "Note", "Linked Bucket", "Linked Type");
        db.forEach(function(debt) {
          row(debt.name, debt.type, debt.balance, debt.apr, debt.monthly, debt.monthlyPrincipal, debt.escrow || 0, debt.balanceAsOf || "", debt.grows ? "yes" : "no", debt.note || "", debt.linkedBucketId || "", debt.linkedType || "manual");
        });
        lines.push("");

        // -- MONTHLY SPEND (discretionary buckets) --
        lines.push("## MONTHLY SPEND");
        var allDiscIds = ["bill001", "bill002", "bill003", "bill004", "bill005"];
        row("Month", "bill001", "bill002", "bill003", "bill004", "bill005");
        var sYear = (c && c.setupYear) || new Date().getFullYear();
        var sMo = (c && c.setupMonth) || 0;
        var now = new Date();
        for (var y = sYear; y <= now.getFullYear() + 1; y++) {
          for (var m = 0; m < 12; m++) {
            if (y === sYear && m < sMo) continue;
            if (y > now.getFullYear() + 1) break;
            var mk = y + "-" + m;
            var md = d[mk];
            if (!md) continue;
            var spent = md.spent || {};
            var hasData = allDiscIds.some(function(id) { return (spent[id] || 0) > 0; });
            if (!hasData) continue;
            row(MONTHS[m] + " " + y, spent["bill001"] || 0, spent["bill002"] || 0, spent["bill003"] || 0, spent["bill004"] || 0, spent["bill005"] || 0);
          }
        }
        lines.push("");

        // -- RESERVE SPEND --
        lines.push("## RESERVE SPEND");
        row("Month", "Travel", "Beauty", "Clothing", "Gifts", "Pet", "Savings", "House");
        var rSpendIds = ["bill008", "bill012", "bill006", "bill007", "bill009", "bill011", "bill010"];
        for (var y2 = sYear; y2 <= now.getFullYear() + 1; y2++) {
          for (var m2 = 0; m2 < 12; m2++) {
            if (y2 === sYear && m2 < sMo) continue;
            if (y2 > now.getFullYear() + 1) break;
            var mk2 = y2 + "-" + m2;
            var md2 = d[mk2];
            if (!md2) continue;
            var sp2 = md2.spent || {};
            var hasR = rSpendIds.some(function(id) { return (sp2[id] || 0) > 0; });
            if (!hasR) continue;
            row(MONTHS[m2] + " " + y2, sp2["bill008"] || 0, sp2["bill012"] || 0, sp2["bill006"] || 0, sp2["bill007"] || 0, sp2["bill009"] || 0, sp2["bill011"] || 0, sp2["bill010"] || 0);
          }
        }
        lines.push("");

        // -- RESERVE TRANSACTIONS --
        lines.push("## RESERVE TRANSACTIONS");
        row("Month", "Date", "Merchant", "Amount", "Reserve ID", "Discretionary ID");
        for (var y3 = sYear; y3 <= now.getFullYear() + 1; y3++) {
          for (var m3 = 0; m3 < 12; m3++) {
            if (y3 === sYear && m3 < sMo) continue;
            if (y3 > now.getFullYear() + 1) break;
            var mk3 = y3 + "-" + m3;
            var md3 = d[mk3];
            if (!md3) continue;
            var txs = md3.reserveTransactions || [];
            txs.forEach(function(tx) {
              row(MONTHS[m3] + " " + y3, tx.date || "", tx.merchant || "", tx.amount, tx.reserveId || "", tx.category || "");
            });
          }
        }

        // -- Metadata footer --
        lines.push("");
        lines.push("## META");
        row("Setup Date", MONTHS[sMo] + " " + sYear);
        row("Primary Payday", (c && c.primaryPayday) || 1);
        row("Exported", new Date().toISOString().slice(0, 10));

        // -- Download --
        var csv = lines.join("\n");
        var blob = new Blob([csv], { type: "text/csv" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = "budget-control-" + new Date().toISOString().slice(0, 10) + ".csv";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }} style={{ background: "transparent", border: "1px solid " + T.blue, color: T.blue, padding: "8px 12px", borderRadius: "6px", fontSize: "12px", fontWeight: "700", cursor: "pointer", fontFamily: "DM Mono, monospace", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", flex: 1, minHeight: "48px", textAlign: "center", flexWrap: "wrap" }}>
        <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>download</span>
        Export (CSV)
      </button>

      {/* Import CSV */}
      <label style={{ background: "transparent", border: "1px solid " + T.blue, color: T.blue, padding: "8px 12px", borderRadius: "6px", fontSize: "12px", fontWeight: "700", cursor: "pointer", fontFamily: "DM Mono, monospace", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", flex: 1, minHeight: "48px", textAlign: "center", flexWrap: "wrap" }}>
        <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>upload</span>
        Import (CSV)
        <input type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={function(ev) {
          var file = ev.target.files && ev.target.files[0];
          if (!file) return;
          var reader = new FileReader();
          reader.onload = function(e) {
            try {
              var text = e.target.result;
              var sections = parseCSVSections(text);

              // -- Validate required sections --
              var required = ["INCOME", "META"];
              var missing = required.filter(function(s) { return !sections[s] || sections[s].length < 2; });
              if (missing.length > 0) {
                window.alert("CSV is missing required sections: " + missing.join(", ") + ". Please use a file exported from Budget Control.");
                return;
              }

              // -- Helper: find column index by header name --
              function colIdx(section, name) {
                var hdr = sections[section] && sections[section][0];
                if (!hdr) return -1;
                for (var i = 0; i < hdr.length; i++) {
                  if (hdr[i].trim().toLowerCase() === name.toLowerCase()) return i;
                }
                return -1;
              }
              function dataRows(section) {
                return (sections[section] || []).slice(1);
              }
              function num(v) { return parseFloat(v) || 0; }

              // -- Parse META --
              var metaRows = sections["META"] || [];
              var metaMap = {};
              metaRows.forEach(function(r) { if (r.length >= 2) metaMap[r[0].trim()] = r[1].trim(); });
              var setupDateStr = metaMap["Setup Date"] || "";
              var parsedSetupMonth = 0;
              var parsedSetupYear = new Date().getFullYear();
              if (setupDateStr) {
                var parts = setupDateStr.split(" ");
                var moIdx = MONTHS.indexOf(parts[0]);
                if (moIdx >= 0) parsedSetupMonth = moIdx;
                if (parts[1]) parsedSetupYear = parseInt(parts[1], 10) || parsedSetupYear;
              }
              var parsedPayday = parseInt(metaMap["Primary Payday"], 10) || 1;

              // -- Parse INCOME --
              var incomes = dataRows("INCOME").map(function(r) {
                return {
                  label: (r[0] || "").trim() || "Income",
                  perPaycheck: num(r[1]),
                  frequency: (r[2] || "monthly").trim(),
                  payday: parseInt(r[3], 10) || 1,
                  netPay: num(r[4]),
                };
              }).filter(function(i) { return i.netPay > 0 || i.perPaycheck > 0; });

              if (incomes.length === 0) {
                window.alert("No valid income rows found in the CSV.");
                return;
              }

              // If netPay (monthly) is missing, compute it
              var FREQ_MAP = { weekly: 52/12, biweekly: 26/12, semimonthly: 2, monthly: 1 };
              incomes.forEach(function(i) {
                if (!i.netPay && i.perPaycheck > 0) {
                  i.netPay = Math.round(i.perPaycheck * (FREQ_MAP[i.frequency] || 1) * 100) / 100;
                }
              });

              // -- Parse FIXED BILLS --
              var billItems = dataRows("FIXED BILLS").map(function(r) {
                return {
                  name: (r[0] || "").trim(),
                  amt: num(r[1]),
                  day: Math.min(28, Math.max(1, parseInt(r[2], 10) || 1)),
                  category: (r[3] || "Other").trim(),
                  note: (r[4] || "").trim(),
                };
              }).filter(function(b) { return b.name && (b.amt > 0 || b.note === "cc"); });
              var billsAmt = Math.round(billItems.filter(function(b) { return b.note !== "cc"; }).reduce(function(s, b) { return s + b.amt; }, 0) * 100) / 100;

              // -- Parse DISCRETIONARY --
              var discBuckets = dataRows("DISCRETIONARY").map(function(r) {
                return { id: (r[0] || "").trim(), label: (r[1] || "").trim(), amount: num(r[2]), color: "" };
              }).filter(function(b) { return b.id && b.amount > 0; });
              // Assign colors from defaults
              var discColorMap = { bill001: "#E879F9", bill002: "#FFB347", bill003: "#FCD34D", bill004: "#FB923C", bill005: "#FDE68A" };
              discBuckets.forEach(function(b) { b.color = discColorMap[b.id] || T.text3; });

              // -- Parse RESERVES --
              var resBuckets = dataRows("RESERVES").map(function(r) {
                return { id: (r[0] || "").trim(), label: (r[1] || "").trim(), amount: num(r[2]), color: "" };
              }).filter(function(b) { return b.id && b.amount > 0; });
              var resColorMap = { bill011: "#B8A9FF", bill010: "#60A5FA", bill008: T.green, bill006: "#F97316", bill007: "#FDBA74", bill009: "#F9A8D4", bill012: "#C084FC", bill013: "#34D399" };
              resBuckets.forEach(function(b) { b.color = resColorMap[b.id] || T.text3; });

              // -- Build config --
              var newCfg = {
                incomes: incomes,
                buckets: [
                  { id: "bills", label: "Fixed Bills", amount: billsAmt, color: T.blue, items: billItems },
                ].concat(
                  discBuckets.map(function(b) { return { id: b.id, label: b.label, amount: b.amount, color: b.color, items: [{ name: b.label, amt: b.amount }] }; }),
                  resBuckets.map(function(b) { return { id: b.id, label: b.label, amount: b.amount, color: b.color, items: [{ name: b.label, amt: b.amount }] }; })
                ),
                primaryPayday: parsedPayday,
                setupYear: parsedSetupYear,
                setupMonth: parsedSetupMonth,
              };

              // -- Parse DEBTS --
              var newDebts = dataRows("DEBTS").map(function(r, i) {
                return {
                  id: "d-imp-" + Date.now() + "-" + i,
                  name: (r[0] || "").trim(),
                  type: (r[1] || "other").trim(),
                  balance: num(r[2]),
                  apr: num(r[3]),
                  monthly: num(r[4]),
                  monthlyPrincipal: num(r[5]),
                  escrow: num(r[6]),
                  balanceAsOf: (r[7] || new Date().toISOString().slice(0, 10)).trim(),
                  grows: (r[8] || "").trim().toLowerCase() === "yes",
                  note: (r[9] || "").trim(),
                  linkedBucketId: (r[10] || "").trim() || null,
                  linkedType: (r[11] || "manual").trim(),
                };
              }).filter(function(d) { return d.name; });

              // -- Parse MONTHLY SPEND + RESERVE SPEND + TRANSACTIONS into data --
              // Start with blank data from setup date
              var newData = {};
              for (var yy = parsedSetupYear; yy <= new Date().getFullYear() + 1; yy++) {
                for (var mm = 0; mm < 12; mm++) {
                  newData[yy + "-" + mm] = { spent: {} };
                }
              }

              // Helper: parse "Mar 2026" -> { y, m }
              function parseMonthStr(s) {
                var p = (s || "").trim().split(" ");
                var mi = MONTHS.indexOf(p[0]);
                var yr = parseInt(p[1], 10);
                if (mi < 0 || isNaN(yr)) return null;
                return { y: yr, m: mi };
              }

              // Monthly spend
              var spendDiscIds = ["bill001", "bill002", "bill003", "bill004", "bill005"];
              dataRows("MONTHLY SPEND").forEach(function(r) {
                var pm = parseMonthStr(r[0]);
                if (!pm) return;
                var k = pm.y + "-" + pm.m;
                if (!newData[k]) newData[k] = { spent: {} };
                for (var ci = 0; ci < spendDiscIds.length; ci++) {
                  var val = num(r[ci + 1]);
                  if (val > 0) newData[k].spent[spendDiscIds[ci]] = val;
                }
              });

              // Reserve spend (columns: Travel, Beauty, Clothing, Gifts, Pet, Savings, House)
              var rSpendIds = ["bill008", "bill012", "bill006", "bill007", "bill009", "bill011", "bill010"];
              dataRows("RESERVE SPEND").forEach(function(r) {
                var pm = parseMonthStr(r[0]);
                if (!pm) return;
                var k = pm.y + "-" + pm.m;
                if (!newData[k]) newData[k] = { spent: {} };
                for (var ci = 0; ci < rSpendIds.length; ci++) {
                  var val = num(r[ci + 1]);
                  if (val > 0) newData[k].spent[rSpendIds[ci]] = val;
                }
              });

              // Reserve transactions
              dataRows("RESERVE TRANSACTIONS").forEach(function(r) {
                var pm = parseMonthStr(r[0]);
                if (!pm) return;
                var k = pm.y + "-" + pm.m;
                if (!newData[k]) newData[k] = { spent: {} };
                if (!newData[k].reserveTransactions) newData[k].reserveTransactions = [];
                newData[k].reserveTransactions.push({
                  id: "tx-imp-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
                  date: (r[1] || "").trim(),
                  merchant: (r[2] || "").trim(),
                  amount: num(r[3]),
                  reserveId: (r[4] || "").trim() || null,
                  category: (r[5] || "").trim() || null,
                });
              });

              // -- Summary for confirmation --
              var summary = "Import summary:\n"
                + "- " + incomes.length + " income stream(s)\n"
                + "- " + billItems.length + " fixed bill(s)\n"
                + "- " + discBuckets.length + " discretionary bucket(s)\n"
                + "- " + resBuckets.length + " reserve(s)\n"
                + "- " + newDebts.length + " debt(s)\n"
                + "- Setup: " + MONTHS[parsedSetupMonth] + " " + parsedSetupYear + "\n\n"
                + "This will REPLACE all your current data. Continue?";

              if (!window.confirm(summary)) return;

              // -- Save to localStorage and update state --
              saveConfig(newCfg);
              saveData(newData);
              saveDebts(newDebts);
              setCfg(newCfg);
              setData(newData);
              setDebts(newDebts);
              setTab("overview");

            } catch (err) {
              window.alert("Failed to import CSV: " + err.message);
            }
          };
          reader.readAsText(file);
          // Reset input so same file can be re-selected
          ev.target.value = "";
        }} />
      </label>
      </div>

      <div style={{ fontSize: "12px", color: T.text3, marginBottom: "14px", lineHeight: "1.5" }}>
        Export creates a CSV backup of all your data. Import restores from a previously exported CSV -- this replaces your current data.
      </div>

      <div style={{ display: "flex", gap: "10px" }}>
      <button onClick={() => { if (window.confirm("Clear all spend data? Your budget setup will be kept.")) { setData(getDefaultData()); setDebts([]); saveData(getDefaultData()); saveDebts([]); setTab("overview"); } }} style={{ background: "transparent", border: "1px solid " + T.red, color: T.red, padding: "8px 12px", borderRadius: "6px", fontSize: "12px", fontWeight: "700", cursor: "pointer", fontFamily: "DM Mono, monospace", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", flex: 1, minHeight: "48px", textAlign: "center", flexWrap: "wrap" }}>
        <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>delete_sweep</span>
        Clear Spend Data
      </button>
      <button onClick={() => { if (window.confirm("Reset everything? This will erase all your data and return to the setup screen.")) { onReset(); } }} style={{ background: "transparent", border: "1px solid " + T.red, color: T.red, padding: "8px 12px", borderRadius: "6px", fontSize: "12px", fontWeight: "700", cursor: "pointer", fontFamily: "DM Mono, monospace", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", flex: 1, minHeight: "48px", textAlign: "center", flexWrap: "wrap" }}>
        <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>delete_forever</span>
        Reset Everything
      </button>
      </div>
    </div>
  </div>
)}

{showFlowInfo && renderInfoModal("Money Flow", (
  (() => {
    const total = totalIncomeCfg || 1;
    const categories = [
      { key: "fixed", label: "Fixed", value: fixedCommitted, color: T.blue, items: fixedBillItems.map(item => ({ label: item.name, value: item.amt, color: T.blue })) },
      { key: "discretionary", label: "Discretionary", value: discBudget, color: "#FFB347", items: buckets.filter(b => ["bill001","bill002","bill003","bill004","bill005"].includes(b.id) && b.amount > 0).map(b => ({ label: b.label, value: b.amount, color: b.color })) },
      { key: "reserves", label: "Reserves", value: reservesTotal, color: "#B8A9FF", items: buckets.filter(b => ["bill006","bill007","bill008","bill009","bill011","bill012","bill010"].includes(b.id) && b.amount > 0).map(b => ({ label: b.label, value: b.amount, color: b.color })) },
    ].filter(group => group.value > 0);
    if (debtPaymentTotal > 0) {
      categories.push({ key: "debt", label: "Debt", value: debtPaymentTotal, color: T.red, items: [{ label: "Debt payments", value: debtPaymentTotal, color: T.red }] });
    }
    if (leftover > 0) {
      categories.push({ key: "leftover", label: "Leftover", value: leftover, color: T.green, items: [{ label: "Leftover cash", value: leftover, color: T.green }] });
    }

    const sankeyNodes = [];
    const sankeyLinks = [];
    const colorMap = {};
    sankeyNodes.push({ id: "Income" });
    colorMap["Income"] = T.blue;
    categories.forEach(cat => {
      sankeyNodes.push({ id: "cat-" + cat.key });
      colorMap["cat-" + cat.key] = cat.color;
      sankeyLinks.push({ source: "Income", target: "cat-" + cat.key, value: cat.value });
      cat.items.forEach((item, i) => {
        const bucketId = "bucket-" + cat.key + "-" + i;
        sankeyNodes.push({ id: bucketId });
        colorMap[bucketId] = item.color;
        sankeyLinks.push({ source: "cat-" + cat.key, target: bucketId, value: item.value });
      });
    });

    const viewWidth = 640;
    const viewHeight = Math.max(300, categories.reduce((s, c) => s + c.items.length, 0) * 32 + 60);
    const nodeWidth = 18;
    const nodePadding = 14;

    const layout = d3Sankey()
      .nodeId(d => d.id)
      .nodeWidth(nodeWidth)
      .nodePadding(nodePadding)
      .extent([[18, 24], [viewWidth - 18, viewHeight - 24]])
      ({ nodes: sankeyNodes.map(d => ({ ...d })), links: sankeyLinks.map(d => ({ ...d })) });

    const labelForId = (id) => {
      if (id === "Income") return "Income";
      for (const cat of categories) {
        if (id === "cat-" + cat.key) return cat.label;
        for (let i = 0; i < cat.items.length; i++) {
          if (id === "bucket-" + cat.key + "-" + i) return cat.items[i].label;
        }
      }
      return "";
    };
    const valueForId = (id) => {
      if (id === "Income") return totalIncomeCfg;
      for (const cat of categories) {
        if (id === "cat-" + cat.key) return cat.value;
        for (let i = 0; i < cat.items.length; i++) {
          if (id === "bucket-" + cat.key + "-" + i) return cat.items[i].value;
        }
      }
      return 0;
    };

    const linkPath = sankeyLinkHorizontal();

    return (
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "18px", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <div style={{ fontSize: "12px", color: T.text3, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: "6px" }}>Monthly Budget Flow</div>
            <div style={{ fontSize: "22px", fontWeight: "700", color: T.text1 }}>{fmt(totalIncomeCfg)}</div>
          </div>
          <div style={{ minWidth: "160px", textAlign: "right" }}>
            <div style={{ fontSize: "12px", color: T.text2, marginBottom: "6px" }}>Debt payments</div>
            <div style={{ fontSize: "18px", fontWeight: "700", color: T.red }}>{fmt(debtPaymentTotal)}</div>
          </div>
        </div>

        <div style={{ background: T.surf2, border: "1px solid " + T.bord, borderRadius: "18px", padding: "16px", overflowX: "auto" }}>
          <svg width="100%" height={viewHeight} viewBox={`0 0 ${viewWidth} ${viewHeight}`} style={{ minWidth: "640px", display: "block" }}>
            {layout.links.map((link, i) => (
              <path key={"link-" + i} d={linkPath(link)} fill="none" stroke={colorMap[link.source.id] || T.text3} strokeWidth={Math.max(4, link.width)} strokeOpacity={0.45} />
            ))}
            {layout.nodes.map(node => {
              const label = labelForId(node.id);
              const val = valueForId(node.id);
              const h = node.y1 - node.y0;
              const col = colorMap[node.id] || T.text3;
              const isLeft = node.depth === 0;
              const isRight = node.depth === 2;
              return (
                <g key={node.id}>
                  <rect x={node.x0} y={node.y0} width={node.x1 - node.x0} height={h} rx={Math.min(6, h / 2)} fill={col} opacity={0.85} />
                  {isLeft && h > 18 && (
                    <>
                      <text x={node.x0 + nodeWidth + 8} y={node.y0 + h / 2 - 7} fill={T.text2} fontSize="10" fontWeight="700" dominantBaseline="middle">{label}</text>
                      <text x={node.x0 + nodeWidth + 8} y={node.y0 + h / 2 + 9} fill={T.text1} fontSize="14" fontWeight="700" dominantBaseline="middle">{fmt(val)}</text>
                    </>
                  )}
                  {!isLeft && !isRight && h > 14 && (
                    <>
                      <text x={node.x0 + nodeWidth + 8} y={node.y0 + Math.min(16, h / 2)} fill={col} fontSize="10" fontWeight="700">{label}</text>
                      {h > 30 && <text x={node.x0 + nodeWidth + 8} y={node.y0 + Math.min(32, h / 2 + 12)} fill={T.text1} fontSize="11" fontWeight="700">{fmt(val)}</text>}
                    </>
                  )}
                  {isRight && (
                    <text x={node.x0 - 6} y={node.y0 + h / 2} fill={T.text1} fontSize="9" fontWeight="700" textAnchor="end" dominantBaseline="middle">{label}</text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "10px", marginTop: "16px" }}>
          {categories.map(cat => (
            <div key={cat.key} style={{ background: T.surf2, border: "1px solid " + T.bord, borderRadius: "12px", padding: "14px" }}>
              <div style={{ fontSize: "11px", color: cat.color, fontWeight: "700", marginBottom: "10px", textTransform: "uppercase" }}>{cat.label}</div>
              <div style={{ fontSize: "18px", fontWeight: "700", color: T.text1, marginBottom: "6px" }}>{fmt(cat.value)}</div>
              <div style={{ fontSize: "12px", color: T.text2 }}>{Math.round((cat.value / total) * 100)}% of income</div>
            </div>
          ))}
        </div>
      </div>
    );
  })()
))}
{editModal === "logspend"  && renderLogSpend()}
{editModal === "bills"     && renderEditBills()}
{editModal === "disc"      && renderEditDisc()}
{editModal === "reserves"  && renderEditReserves()}
{editModal === "debt"      && renderEditDebtModal()}
{editModal === "income"    && renderEditIncome()}
  </div>
</div>
  );
}