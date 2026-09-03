import { useState, useEffect, useRef, useMemo } from "react";
import { sankey as d3Sankey, sankeyLinkHorizontal } from "d3-sankey";
import { loadApiKey, saveApiKey, clearApiKey, maskKey, verifyApiKey } from "./agent.js";

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
// budgetTransactions: flat, top-level itemized ledger. spent[] stays the source
// of truth for all budget math; this store is the per-transaction record that
// import (CSV, screenshot) and manual Log Spend produce and the app displays.
function loadTransactions() {
try { const r = localStorage.getItem("budgetTransactions"); return r ? JSON.parse(r) : []; } catch(e) { return []; }
}
function saveTransactions(t) {
try { localStorage.setItem("budgetTransactions", JSON.stringify(t)); } catch(e) {}
}
function newTxnId() {
return "txn_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
}
// Normalize any record (legacy per-month or new) into the canonical shape.
function toTxnRecord(tx) {
return {
id: tx.id || newTxnId(),
date: tx.date || "",
amount: tx.amount,
description: tx.description || tx.merchant || "",
merchant: tx.merchant || "",
source: tx.source || "manual",
sourceRef: tx.sourceRef || null,
bucketId: tx.bucketId || tx.reserveId || tx.category || null,
status: tx.status || "confirmed",
confidence: (tx.confidence === undefined ? null : tx.confidence),
};
}
// Fold legacy per-month reserveTransactions into the flat store. Idempotent
// (dedups by id), so it is safe to run on every mount and picks up records that
// CSV import writes into budgetData without touching those import code paths.
function foldLegacyTransactions() {
var flat = loadTransactions();
var seen = {};
flat.forEach(function(t) { if (t && t.id != null) seen[t.id] = true; });
var data = loadData() || {};
var changed = false;
Object.keys(data).forEach(function(k) {
var arr = (data[k] && data[k].reserveTransactions) || [];
arr.forEach(function(tx) {
if (!tx || tx.id == null || seen[tx.id]) return;
seen[tx.id] = true;
flat.push(toTxnRecord(tx));
changed = true;
});
});
if (changed) saveTransactions(flat);
return flat;
}
// "2026-07-12" -> { y: 2026, m: 6 } style checks used to place a txn in a month.
function txnInMonth(tx, year, month) {
if (!tx.date || tx.date.length < 7) return false;
var y = parseInt(tx.date.slice(0, 4), 10);
var m = parseInt(tx.date.slice(5, 7), 10) - 1;
return y === year && m === month;
}
function monthLabelFromDate(dateStr) {
if (!dateStr || dateStr.length < 7) return null;
var y = parseInt(dateStr.slice(0, 4), 10);
var m = parseInt(dateStr.slice(5, 7), 10) - 1;
if (isNaN(y) || m < 0 || m > 11) return null;
return MONTHS[m] + " " + y;
}

// ------------
// Schema versioning + migrations
// ------------
var SCHEMA_VERSION = 4;

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
  if (v < 3) {
    // v2->v3: give fixed bill items stable ids and relink debts that pointed at
    // a bill by name so a later rename can't break the connection.
    var nameToId3 = {};
    result = {
      ...result,
      buckets: (result.buckets || []).map(function(b) {
        if (b.id !== "bills" || !b.items) return b;
        return { ...b, items: b.items.map(function(it) {
          var id = it.id || newBillId();
          nameToId3[it.name] = id;
          return { ...it, id: id };
        }) };
      }),
    };
    try {
      var rawD3 = localStorage.getItem("budgetDebts");
      if (rawD3) {
        var debts3 = JSON.parse(rawD3);
        var remapped3 = debts3.map(function(d) {
          return (d.linkedType === "fixed" && d.linkedBucketId && nameToId3[d.linkedBucketId])
            ? { ...d, linkedBucketId: nameToId3[d.linkedBucketId] }
            : d;
        });
        localStorage.setItem("budgetDebts", JSON.stringify(remapped3));
      }
    } catch(e3) {}
  }
  if (v < 4) {
    // v3->v4: fold per-month reserveTransactions into the flat budgetTransactions
    // store. Idempotent, so it is harmless if it also runs on a later mount.
    try { foldLegacyTransactions(); } catch(e4) {}
  }
  // Persist the migrated config so migrations run exactly once. Without this,
  // loadConfig re-runs them every load; the v3 step assigns random bill ids, so
  // a second run would re-id the bills and orphan the just-relinked debts.
  var out = { ...result, version: SCHEMA_VERSION };
  try { localStorage.setItem("budgetConfig", JSON.stringify(out)); } catch(e) {}
  return out;
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
// Flat transaction CSV import (bank / credit-card exports). Kept deliberately
// separate from parseCSVSections above, which handles our own sectioned budget
// backup format. This one reads an arbitrary flat CSV: header row + data rows.
// ------------
function csvSplitRow(line) {
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
return cols.map(function(c) { return c.trim(); });
}
// Returns { headers: [...], rows: [[...], ...] }. First non-empty line is the header.
function parseFlatCSV(text) {
var lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter(function(l) { return l.trim().length > 0; });
if (lines.length === 0) return { headers: [], rows: [] };
var headers = csvSplitRow(lines[0]);
var rows = lines.slice(1).map(csvSplitRow);
return { headers: headers, rows: rows };
}
// Guess which columns hold date / amount / description / debit / credit from the
// header names. Returns indices (-1 when not found).
function csvGuessMapping(headers) {
var lower = headers.map(function(h) { return (h || "").toLowerCase(); });
function find(res) {
for (var r = 0; r < res.length; r++) {
for (var i = 0; i < lower.length; i++) { if (res[r].test(lower[i])) return i; }
}
return -1;
}
return {
date: find([/transaction date/, /posted date/, /post date/, /\bdate\b/, /date/]),
amount: find([/^amount$/, /\bamount\b/, /amount/]),
description: find([/description/, /payee/, /\bname\b/, /memo/, /merchant/]),
debit: find([/debit/, /withdrawal/]),
credit: find([/credit/, /deposit/]),
};
}
// "$1,234.56" -> 1234.56 ; "(45.00)" -> -45 ; "" / junk -> null
function csvParseAmount(str) {
if (str == null) return null;
var s = String(str).trim();
if (s === "") return null;
var neg = false;
if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
if (s.indexOf("-") !== -1) neg = true;
s = s.replace(/[^0-9.]/g, "");
if (s === "" || isNaN(parseFloat(s))) return null;
var n = parseFloat(s);
return neg ? -n : n;
}
var CSV_MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
// Accepts YYYY-MM-DD, MM/DD/YYYY, M/D/YY, DD-Mon-YYYY -> "YYYY-MM-DD" (or null).
function csvParseDate(str) {
if (str == null) return null;
var s = String(str).trim();
if (s === "") return null;
var m;
m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
if (m) return csvYMD(m[1], m[2], m[3]);
m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
if (m) { var yr = m[3].length === 2 ? "20" + m[3] : m[3]; return csvYMD(yr, m[1], m[2]); }
m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[A-Za-z]*[-\s](\d{2,4})/);
if (m) {
var mo = CSV_MONTHS[m[2].toLowerCase()];
if (mo === undefined) return null;
var yr2 = m[3].length === 2 ? "20" + m[3] : m[3];
return csvYMD(yr2, mo + 1, m[1]);
}
return null;
}
function csvYMD(y, m, d) {
var mm = parseInt(m, 10), dd = parseInt(d, 10), yy = parseInt(y, 10);
if (isNaN(mm) || isNaN(dd) || isNaN(yy) || mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
return yy + "-" + (mm < 10 ? "0" + mm : mm) + "-" + (dd < 10 ? "0" + dd : dd);
}
// Deterministic short hash (cyrb53) of date+amount+description for dedup sourceRef.
function csvRowHash(date, amount, desc) {
var str = date + "|" + amount + "|" + (desc || "").toLowerCase();
var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
for (var i = 0; i < str.length; i++) {
var ch = str.charCodeAt(i);
h1 = Math.imul(h1 ^ ch, 2654435761);
h2 = Math.imul(h2 ^ ch, 1597334677);
}
h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
return "csv_" + (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
// Stable key for a file's column layout, so a remembered mapping can be reused.
function csvHeaderSignature(headers) {
return headers.map(function(h) { return (h || "").toLowerCase().trim(); }).join("|");
}
function loadCsvMappings() {
try { var r = localStorage.getItem("budgetCsvMappings"); return r ? JSON.parse(r) : {}; } catch(e) { return {}; }
}
function saveCsvMappings(m) {
try { localStorage.setItem("budgetCsvMappings", JSON.stringify(m)); } catch(e) {}
}

// ------------
// Merchant memory: rule-based auto-categorization
// ------------
// budgetRules maps a normalized merchant string to the bucket the user last
// chose for it: { pattern: { bucketId, count, updatedAt } }. Rules are learned
// on every confirmed spend (CSV import and manual log) and applied to new
// import rows, so repeat merchants arrive pre-categorized.
function loadRules() {
try { var r = localStorage.getItem("budgetRules"); return r ? JSON.parse(r) : {}; } catch(e) { return {}; }
}
function saveRules(r) {
try { localStorage.setItem("budgetRules", JSON.stringify(r)); } catch(e) {}
}
// State/territory codes, used only to strip a trailing location off bank
// descriptions ("TRADER JOES OAKLAND CA" -> "TRADER JOES").
const MERCHANT_STATES = {
AL:1, AK:1, AZ:1, AR:1, CA:1, CO:1, CT:1, DE:1, DC:1, FL:1, GA:1, HI:1, ID:1,
IL:1, IN:1, IA:1, KS:1, KY:1, LA:1, ME:1, MD:1, MA:1, MI:1, MN:1, MS:1, MO:1,
MT:1, NE:1, NV:1, NH:1, NJ:1, NM:1, NY:1, NC:1, ND:1, OH:1, OK:1, OR:1, PA:1,
RI:1, SC:1, SD:1, TN:1, TX:1, UT:1, VT:1, VA:1, WA:1, WV:1, WI:1, WY:1, PR:1,
};
// Bank descriptions are noisy; normalization matters more than the matching
// algorithm. Uppercase, drop apostrophes, split on punctuation, then drop any
// token containing a digit (store numbers, dates, transaction ids) and a
// trailing "CITY ST" location.
function normalizeMerchant(desc) {
var s = String(desc || "").toUpperCase().replace(/'/g, "");
var tokens = s.split(/[^A-Z0-9]+/).filter(function(t) { return t && !/[0-9]/.test(t); });
if (tokens.length > 1 && MERCHANT_STATES[tokens[tokens.length - 1]]) {
tokens.pop();
// The token before a state code is the city. Only drop it if doing so still
// leaves a usable merchant name behind.
if (tokens.length > 2) tokens.pop();
}
return tokens.join(" ");
}
// Look up a bucket for a description. Exact match on the normalized string
// first; otherwise the longest rule that is a token-boundary prefix of this
// merchant (or vice versa). Returns null when nothing matches.
function matchRule(rules, desc) {
var key = normalizeMerchant(desc);
if (!key) return null;
if (rules[key]) return { bucketId: rules[key].bucketId, pattern: key, confidence: 0.9 };
var best = null;
Object.keys(rules).forEach(function(pattern) {
if (!pattern) return;
if (key.indexOf(pattern + " ") !== 0 && pattern.indexOf(key + " ") !== 0) return;
// Prefer the most specific rule, then the one seen most often.
if (!best || pattern.length > best.length || (pattern.length === best.length && rules[pattern].count > rules[best].count)) best = pattern;
});
if (!best) return null;
return { bucketId: rules[best].bucketId, pattern: best, confidence: 0.7 };
}
// Learn from a confirmed spend. The latest correction always wins, so changing
// the bucket on a suggested row retrains the rule.
function upsertRule(rules, desc, bucketId) {
var key = normalizeMerchant(desc);
if (!key || !bucketId) return rules;
var prev = rules[key];
rules[key] = {
bucketId: bucketId,
count: (prev && prev.bucketId === bucketId ? (prev.count || 0) : 0) + 1,
updatedAt: new Date().toISOString().slice(0, 10),
};
return rules;
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
const newBillId = () => "fb-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const BLANK_BILL = () => ({ id: newBillId(), name: "", amt: "", day: "", note: "", category: "Other" });
// Debts link to fixed bills by the bill item's stable id. Older CSV exports
// stored the link by bill name; remap those name-based links to ids on import.
function resolveFixedDebtLinks(billItems, debts) {
  const byId = new Set(billItems.map(b => b.id).filter(Boolean));
  const nameToId = {};
  billItems.forEach(b => { if (b.id) nameToId[b.name] = b.id; });
  return debts.map(d => (
    (d.linkedType === "fixed" && d.linkedBucketId && !byId.has(d.linkedBucketId) && nameToId[d.linkedBucketId])
      ? { ...d, linkedBucketId: nameToId[d.linkedBucketId] }
      : d
  ));
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// Where "tell me you want this" goes. The app is static with no server and no
// analytics, so a click counter would only ever be readable on the device that
// did the clicking. A survey response is the only interest signal that can
// actually reach us, and it costs the user their own words rather than a
// tracking script that could read localStorage.
const SURVEY_URL = "https://docs.google.com/forms/d/e/1FAIpQLSc71ZobqLMh8TxVX6D_nbEbSuAcIaMuWMurNU_SpLZzmRz8eg/viewform?usp=header";

// Overview card layout switcher. Flip this constant to try alternate arrangements.
//   "A" - original: single KPI row, full-width discretionary bar below
//   "B" - Monthly Income + Discretionary Budget Used share a taller row with larger visualizations
const OVERVIEW_LAYOUT = "B";

// Reconstruct a "last 12 months" debt paydown window from current balances and
// monthly principal. We have no stored history, so this assumes a steady payment.
// Returns a stacked series where paid + remaining = total (constant) at each step.
function buildDebtWindow(debts, monthsElapsed) {
  const N = Math.max(1, Math.min(12, monthsElapsed || 1));
  const P = debts.reduce((s, d) => s + (d.monthlyPrincipal || d.monthly || 0), 0);
  const C = debts.reduce((s, d) => s + (d.balance || 0), 0);
  const windowPaid = P * N;
  const startTotal = C + windowPaid;
  const series = [];
  for (let i = 0; i <= N; i++) {
    const paid = P * i;
    series.push({ i, paid, remaining: startTotal - paid, total: startTotal });
  }
  const paidPct = startTotal > 0 ? Math.round((windowPaid / startTotal) * 100) : 0;
  return { N, P, C, windowPaid, startTotal, series, paidPct };
}
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
// For a Settings CSV import: parsed debts + spend data are held in memory and
// only committed at wizard Launch, so an existing budget isn't touched on cancel.
const [rerunDebts, setRerunDebts] = useState(null);
const [pendingData, setPendingData] = useState(null);
// Increment on every wizard completion so BudgetTracker remounts and re-reads cfg
const [cfgVersion, setCfgVersion] = useState(0);

const clearRerun = () => { setRerunConfig(null); setRerunDebts(null); setPendingData(null); };

if (!ready || rerunConfig !== null) {
return <SetupGate
key={ready ? "rerun" : "fresh"}
initialConfig={rerunConfig}
initialDebts={rerunDebts}
onDone={() => { if (pendingData) saveData(pendingData); clearRerun(); setReady(true); setCfgVersion(v => v + 1); }}
onBack={ready ? clearRerun : null}
/>;
}
return <BudgetTracker
key={cfgVersion}
onReset={() => {
["budgetConfig","budgetData","budgetDebts"].forEach(k => localStorage.removeItem(k));
setReady(false);
}}
onRerunWizard={() => setRerunConfig(loadConfig())}
onImportCsv={({ config, debts, data }) => { setRerunDebts(debts || null); setPendingData(data || null); setRerunConfig(config); }}
/>;
}

// ------------
// ImportSummaryCard - "CSV Loaded" confirmation shown after a CSV import,
// before the pre-filled wizard opens. Used by both the welcome-screen import
// and the Settings import. counts = { income, bills, disc, reserves, debts }.
// ------------
function ImportSummaryCard({ T, counts, onClose }) {
return (
<div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", fontFamily: "DM Mono, monospace" }}>
<div onClick={e => e.stopPropagation()} style={{ background: T.surf, border: "1px solid " + T.bord, borderRadius: "16px", padding: "8px 24px", width: "100%", maxWidth: "340px", display: "flex", flexDirection: "column", gap: "8px" }}>
<div style={{ height: "40px", display: "flex", alignItems: "center", borderBottom: "1px solid " + T.bord }}>
<div style={{ flex: 1, fontSize: "13px", fontWeight: "600", color: T.text1 }}>CSV Loaded</div>
</div>
<div style={{ fontSize: "12px", color: T.text1, lineHeight: "1.5" }}>
<div>Income Sources: {counts.income}</div>
<div>Fixed Bills: {counts.bills}</div>
<div>Discretionary Buckets: {counts.disc}</div>
<div>Reserves: {counts.reserves}</div>
<div>Debts: {counts.debts}</div>
</div>
<div style={{ fontSize: "12px", color: T.text1, lineHeight: "1.5" }}>The wizard will open with your data pre-filled. Review each step and hit Launch when ready.</div>
<div style={{ borderTop: "1px solid " + T.bord, display: "flex", justifyContent: "flex-end" }}>
<button onClick={onClose} style={{ height: "40px", padding: "10px", background: "transparent", border: "none", color: T.blue, fontSize: "12px", fontWeight: "700", cursor: "pointer", fontFamily: "DM Mono, monospace" }}>Close</button>
</div>
</div>
</div>
);
}

// ------------
// SetupGate - welcome screen
// ------------
function SetupGate({ onDone, onBack, initialConfig, initialDebts }) {
const [mode, setMode] = useState(initialConfig ? "wizard" : null);
const [csvConfig, setCsvConfig] = useState(null);
const [csvSummary, setCsvSummary] = useState(null);
if (mode === "wizard") return <OnboardingWizard key={Date.now()} initialConfig={csvConfig || initialConfig} initialDebts={initialDebts} onDone={onDone} onBack={() => { if (onBack) onBack(); else { setCsvConfig(null); setMode(null); } }} />;
return (
<div style={{ minHeight: "100vh", background: T.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", fontFamily: "DM Mono, monospace" }}>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined&family=DM+Mono:wght@400;500&display=block" rel="stylesheet" />
<style>{`.material-symbols-outlined { font-family: 'Material Symbols Outlined'; font-weight: normal; font-style: normal; display: inline-block; line-height: 1; text-transform: none; letter-spacing: normal; word-wrap: normal; white-space: nowrap; direction: ltr; }`}</style>
{csvSummary && <ImportSummaryCard T={T} counts={csvSummary} onClose={() => { setCsvSummary(null); setMode("wizard"); }} />}
<div style={{ background: T.surf, border: "1px solid " + T.bord, borderRadius: "8px", padding: "40px 32px", maxWidth: "420px", width: "100%", textAlign: "center" }}>
<div style={{ fontSize: "12px", letterSpacing: "0.2em", color: T.text3, textTransform: "uppercase", marginBottom: "8px" }}>Paycheck Split Tracker</div>
<div style={{ fontSize: "26px", fontWeight: "700", color: T.text1, marginBottom: "12px" }}>Budget Control</div>
<div style={{ fontSize: "12px", color: T.text3, marginBottom: "32px", lineHeight: "1.6" }}>
Your budget lives only on your device. Nothing is sent to a server.
</div>
<div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
<button onClick={() => setMode("wizard")}
style={{ background: T.blue, border: "none", color: T.bg, padding: "13px", borderRadius: "4px", fontSize: "13px", fontWeight: "700", cursor: "pointer", fontFamily: "DM Mono, monospace", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
Set Up My Budget
<span className="material-symbols-outlined" style={{ fontSize: "18px" }}>arrow_forward</span>
</button>
<label style={{ background: "transparent", border: "1px solid " + T.blue, color: T.blue, padding: "13px", borderRadius: "4px", fontSize: "13px", fontWeight: "700", cursor: "pointer", fontFamily: "DM Mono, monospace", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
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
        return { name: (r[0] || "").trim(), amt: num(r[1]), day: Math.min(28, Math.max(1, parseInt(r[2], 10) || 1)), category: (r[3] || "Other").trim(), note: (r[4] || "").trim(), id: (r[5] || "").trim() || newBillId() };
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
      newDebts = resolveFixedDebtLinks(billItems, newDebts);
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
          source: "csv", status: "confirmed",
        });
      });
      // Check if any spend data was found
      var hasSpend = Object.keys(newData).some(function(k) {
        var md = newData[k];
        return Object.keys(md.spent || {}).some(function(id) { return md.spent[id] !== 0; })
          || (md.reserveTransactions || []).length > 0;
      });
      if (hasSpend) saveData(newData);

      // Stage the imported config and show the CSV Loaded summary card. The
      // wizard opens (pre-filled) when the user closes the card.
      setCsvConfig(importedCfg);
      setCsvSummary({ income: incArr.length, bills: billItems.length, disc: discBkts.length, reserves: resBkts.length, debts: newDebts.length });

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
        { id: "fb-demo-rent",   name: "Rent", amt: 1450, day: 1, note: "", category: "Housing" },
        { id: "fb-demo-car",    name: "Car Payment", amt: 350, day: 5, note: "", category: "Transportation" },
        { id: "fb-demo-carins", name: "Car Insurance", amt: 120, day: 5, note: "", category: "Transportation" },
        { id: "fb-demo-phone",  name: "Phone", amt: 65, day: 10, note: "", category: "Utilities" },
        { id: "fb-demo-net",    name: "Internet", amt: 70, day: 12, note: "", category: "Utilities" },
        { id: "fb-demo-health", name: "Health Insurance", amt: 180, day: 15, note: "", category: "Health" },
        { id: "fb-demo-stream", name: "Streaming", amt: 25, day: 18, note: "", category: "Subscriptions" },
        { id: "fb-demo-gym",    name: "Gym", amt: 50, day: 20, note: "", category: "Health" },
        { id: "fb-demo-cc",     name: "Credit Card", amt: 0, day: 22, note: "cc", category: "Financial" },
        { id: "fb-demo-give",   name: "Donations", amt: 75, day: 25, note: "", category: "Giving" },
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
    { id: "demo-1", name: "Car Loan", type: "auto", balance: 8450, apr: 4.5, monthly: 350, monthlyPrincipal: 350, escrow: 0, balanceAsOf: now.toISOString().slice(0, 10), grows: false, linkedBucketId: "fb-demo-car", linkedType: "fixed", note: "" },
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
<style>{`.material-symbols-outlined { font-family: 'Material Symbols Outlined'; font-weight: normal; font-style: normal; display: inline-block; line-height: 1; text-transform: none; letter-spacing: normal; word-wrap: normal; white-space: nowrap; direction: ltr; } input[type="date"] { text-align: left; } input[type="date"]::-webkit-date-and-time-value { text-align: left; } .wiz-grid { display: grid; grid-template-columns: 1fr; column-gap: 10px; align-items: start; } @media (min-width: 720px) { .wiz-grid { grid-template-columns: 1fr 1fr; } }`}</style>
<div style={{ borderBottom: "1px solid " + T.bord, padding: "16px 24px 0" }}>
<div style={{ maxWidth: "900px", margin: "0 auto" }}>
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
</div>
{totalIncome > 0 && stepIdx >= 2 && (
<div style={{ padding: "10px 24px", borderBottom: "1px solid " + T.bord, background: T.bg }}>
<div style={{ background: T.surf, border: "1px solid " + (over ? T.red + "55" : T.bord), borderRadius: "8px", padding: "10px 14px", maxWidth: "900px", margin: "0 auto" }}>
<div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}>
<span style={{ fontSize: "12px", color: T.text3, letterSpacing: "0.1em", textTransform: "uppercase" }}>Allocated</span>
<span style={{ fontSize: "12px", fontWeight: "700", color: over ? T.red : T.text1 }}>
{fmt0(allocated)} / {fmt0(totalIncome)}
<span style={{ marginLeft: "8px", color: over ? T.red : allocated === 0 ? T.text3 : T.green }}>
{over ? ("  ^ " + fmt0(Math.abs(remaining)) + " over") : allocated === 0 ? (fmt0(totalIncome) + " unallocated") : (fmt0(displayRemaining) + " left")}
</span>
</span>
</div>
<div style={{ background: T.bord, borderRadius: "2px", height: "5px", display: "flex", overflow: "hidden", marginBottom: "6px" }}>
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
</div>
)}
<div ref={scrollRef} style={{ flex: 1, overflowY: "auto" }}>
<div style={{ maxWidth: "900px", margin: "0 auto", padding: "24px 24px 100px", boxSizing: "border-box" }}>
<div style={{ fontSize: "20px", fontWeight: "700", color: T.text1, marginBottom: "4px" }}>{title}</div>
{subtitle && <div style={{ fontSize: "13px", color: T.text3, marginBottom: "24px", lineHeight: "1.6" }}>{subtitle}</div>}
{children}
</div>
</div>
<div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: T.bg, borderTop: "1px solid " + T.bord, padding: "14px 24px" }}>
<div style={{ maxWidth: "900px", margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
<button onClick={onBack} style={{ background: "transparent", border: "1px solid " + T.bord, color: T.text3, padding: "10px 20px", borderRadius: "4px", fontSize: "12px", cursor: "pointer", fontFamily: "DM Mono, monospace", display: "flex", alignItems: "center", gap: "6px" }}>
<span className="material-symbols-outlined" style={{ fontSize: "18px" }}>arrow_back</span>Back
</button>
<button onClick={onNext} disabled={!canNext} style={{ background: canNext ? T.blue : T.bord, border: "none", color: canNext ? T.bg : T.muted, padding: "10px 24px", borderRadius: "4px", fontSize: "13px", fontWeight: "700", cursor: canNext ? "pointer" : "not-allowed", fontFamily: "DM Mono, monospace", display: "flex", alignItems: "center", gap: "6px" }}>
{step === "review" ? "Launch Budget" : "Continue"}
<span className="material-symbols-outlined" style={{ fontSize: "18px" }}>arrow_forward</span>
</button>
</div>
</div>
</div>
);
}

// ------------
// OnboardingWizard
// ------------
function OnboardingWizard({ onDone, onBack, initialConfig, initialDebts }) {
const STEPS = ["income", "howbudgets", "bills", "discretionary", "reserves", "debt", "review"];
const [step, setStep] = useState("income");
const stepIdx = STEPS.indexOf(step);
// Snapshot of which rows to show on the review step, captured on entry so a
// row doesn't disappear mid-edit when its amount input is cleared
const [reviewKeys, setReviewKeys] = useState(null);
const next = () => {
const target = STEPS[stepIdx + 1];
if (target === "review") {
setReviewKeys({
bills: bills.map((b, i) => ({ b, i })).filter(({ b }) => b.name.trim() && parseFloat(b.amt) > 0 && b.note !== "cc").map(({ i }) => i),
disc: disc.filter(b => parseFloat(b.amount) > 0).map(b => b.id),
res: reserves.filter(b => parseFloat(b.amount) > 0).map(b => b.id),
});
}
setStep(target);
};
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
const savedItems = (savedBills && savedBills.items) || [];
// Start with full template, then fill in saved amounts/days where names match
const merged = BILL_TEMPLATE.map(t => {
const saved = savedItems.find(i => i.name === t.name);
return saved
? { ...t, id: saved.id || newBillId(), amt: String(saved.amt || ""), day: String(saved.day || ""), note: saved.note || t.note }
: { ...t, id: newBillId() };
});
// Append any saved bills not in the template (custom / imported names)
savedItems.forEach(s => {
if (s.name && !BILL_TEMPLATE.find(t => t.name === s.name))
merged.push({ id: s.id || newBillId(), name: s.name, amt: String(s.amt || ""), day: String(s.day || ""), note: s.note || "", category: s.category || "Other" });
});
return merged;
}
return BILL_TEMPLATE.map(i => ({ ...i, id: newBillId() }));
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
if (initialDebts || initialConfig) {
  // Re-run or CSV import: pre-fill debts. initialDebts (passed in-memory for a
  // Settings import) takes precedence so nothing is written until Launch;
  // otherwise fall back to saved debts in localStorage.
  var saved = initialDebts || loadDebts() || [];
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
// setupYear/setupMonth mark the first month of data. Prefer an imported
// value, then the prior save, so a re-run or CSV import keeps the start date.
setupYear:  (initialConfig?.setupYear  ?? existingCfg.setupYear)  ?? now0.getFullYear(),
setupMonth: (initialConfig?.setupMonth ?? existingCfg.setupMonth) ?? now0.getMonth(),
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
<div key={i} style={{ background: T.surf, border: "1px solid " + T.bord, borderRadius: "8px", padding: "16px", marginBottom: "10px" }}>
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
<input type="text" placeholder="e.g. Main Job" value={inc.label} onChange={e => upd({ label: e.target.value })} style={{ background: T.bg, border: "1px solid " + T.bord, color: T.text1, padding: "8px 10px", borderRadius: "4px", fontSize: "16px", width: "100%", boxSizing: "border-box" }} />
</div>
<div style={{ marginBottom: "12px" }}>
<div style={{ fontSize: "12px", letterSpacing: "0.15em", color: T.text3, textTransform: "uppercase", marginBottom: "6px" }}>How often are you paid?</div>
<div style={{ display: "flex", background: T.bg, borderRadius: "4px", padding: "3px" }}>
{FREQ_OPTS.map(opt => (
<div key={opt.value} onClick={() => upd({ frequency: opt.value })} style={{ flex: 1, padding: "7px 4px", textAlign: "center", cursor: "pointer", borderRadius: "4px", fontSize: "12px", textTransform: "uppercase", background: inc.frequency === opt.value ? T.blue : "transparent", color: inc.frequency === opt.value ? T.bg : T.text3, fontWeight: inc.frequency === opt.value ? "700" : "400" }}>
{opt.label}
</div>
))}
</div>
</div>
<div style={{ marginBottom: "12px" }}>
<div style={{ fontSize: "12px", letterSpacing: "0.15em", color: T.text3, textTransform: "uppercase", marginBottom: "6px" }}>Amount per paycheck (after tax)</div>
<input type="number" placeholder="e.g. 1800" value={inc.netPay} onChange={e => upd({ netPay: e.target.value })} style={{ background: T.bg, border: "1px solid " + T.bord, color: T.text1, padding: "8px 10px", borderRadius: "4px", fontSize: "20px", width: "100%", boxSizing: "border-box" }} />
</div>
{inc.frequency === "monthly" && (
<div style={{ marginBottom: "12px" }}>
<div style={{ fontSize: "12px", letterSpacing: "0.15em", color: T.text3, textTransform: "uppercase", marginBottom: "6px" }}>Payday - day of month</div>
<input type="number" placeholder="e.g. 27" min="1" max="28" value={inc.payday} onChange={e => upd({ payday: e.target.value })} style={{ background: T.bg, border: "1px solid " + T.bord, color: T.text1, padding: "8px 10px", borderRadius: "4px", fontSize: "16px", width: "100px", boxSizing: "border-box" }} />
</div>
)}
{inc.frequency === "semimonthly" && (
<div style={{ marginBottom: "12px" }}>
<div style={{ fontSize: "12px", letterSpacing: "0.15em", color: T.text3, textTransform: "uppercase", marginBottom: "6px" }}>Payday days</div>
<div style={{ display: "flex", gap: "10px" }}>
<input type="number" placeholder="e.g. 1" min="1" max="28" value={inc.payday} onChange={e => upd({ payday: e.target.value })} style={{ background: T.bg, border: "1px solid " + T.bord, color: T.text1, padding: "8px 10px", borderRadius: "4px", fontSize: "16px", width: "80px" }} />
<input type="number" placeholder="e.g. 15" min="1" max="28" value={inc.payday2 || ""} onChange={e => upd({ payday2: e.target.value })} style={{ background: T.bg, border: "1px solid " + T.bord, color: T.text1, padding: "8px 10px", borderRadius: "4px", fontSize: "16px", width: "80px" }} />
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
<button onClick={() => setIncomes(p => [...p, { label: "", netPay: "", payday: "", frequency: "monthly" }])} style={{ background: "transparent", border: "1px dashed " + T.bord, color: T.text3, padding: "10px 16px", borderRadius: "4px", fontSize: "12px", cursor: "pointer", width: "100%", fontFamily: "DM Mono, monospace", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
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

<div style={{ background: T.surf, border: "1px solid #4A9EFF44", borderRadius: "8px", padding: "16px 18px", display: "flex", alignItems: "center", gap: "14px" }}>
<div style={{ width: "44px", height: "44px", borderRadius: "8px", background: "#4A9EFF22", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
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

<div style={{ background: T.surf, border: "1px solid #FFB34744", borderRadius: "8px", padding: "16px 18px", display: "flex", alignItems: "center", gap: "14px" }}>
<div style={{ width: "44px", height: "44px", borderRadius: "8px", background: "#FFB34722", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
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

<div style={{ background: T.surf, border: "1px solid #B8A9FF44", borderRadius: "8px", padding: "16px 18px", display: "flex", alignItems: "center", gap: "14px" }}>
<div style={{ width: "44px", height: "44px", borderRadius: "8px", background: "#B8A9FF22", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
<span className="material-symbols-outlined" style={{ fontSize: "24px", color: "#B8A9FF" }}>savings</span>
</div>
<div>
<div style={{ fontSize: "14px", fontWeight: "700", color: "#B8A9FF", marginBottom: "4px" }}>Reserves</div>
<div style={{ fontSize: "12px", color: T.text3, lineHeight: "1.5" }}>A little each month for bigger expenses. Travel, vet visits, home repairs.</div>
</div>
</div>

</div>

{totalIncome > 0 && (
<div style={{ background: T.blueBg, border: "1px solid " + T.blueBord, borderRadius: "8px", padding: "14px 16px", marginTop: "20px", textAlign: "center" }}>
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
<div className="wiz-grid">
{grouped[cat].map(({ b, i }) => {
const dayVal = parseInt(b.day, 10);
const dayErr = b.day !== "" && (isNaN(dayVal) || dayVal < 1 || dayVal > 28);
return (
<div key={i} style={{ background: T.surf, border: "1px solid " + T.bord, borderRadius: "8px", padding: "10px 12px", marginBottom: "6px" }}>
<div style={{ display: "grid", gridTemplateColumns: "1fr 65px 48px auto", gap: "6px", alignItems: "center" }}>
<input type="text" placeholder="Bill name" value={b.name} onChange={e => setBills(p => p.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} style={{ background: T.bg, border: "1px solid " + T.bord, color: T.text1, padding: "8px 6px", borderRadius: "4px", fontSize: "14px", minWidth: 0 }} />
<input type="number" placeholder="Amt" value={b.amt || ""} onChange={e => setBills(p => p.map((x, j) => j === i ? { ...x, amt: e.target.value } : x))} disabled={b.note === "cc"} style={{ background: T.bg, border: "1px solid " + T.bord, color: T.text1, padding: "8px 6px", borderRadius: "4px", fontSize: "14px", minWidth: 0 }} />
<input type="number" placeholder="Due" min="1" max="28" value={b.day || ""} onChange={e => setBills(p => p.map((x, j) => j === i ? { ...x, day: e.target.value } : x))} onBlur={e => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) setBills(p => p.map((x, j) => j === i ? { ...x, day: String(Math.min(28, Math.max(1, v))) } : x)); }} style={{ background: T.bg, border: `1px solid ${dayErr ? T.red : T.bord}`, color: T.text1, padding: "8px 6px", borderRadius: "4px", fontSize: "14px", minWidth: 0 }} />
<button onClick={() => setBills(p => p.filter((_, j) => j !== i))} style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", display: "flex", alignItems: "center" }}>
<span className="material-symbols-outlined" style={{ fontSize: "20px" }}>delete</span>
</button>
</div>
{dayErr && <div style={{ fontSize: "12px", color: T.red, marginTop: "4px" }}>Day must be 1-28</div>}
{b.note === "cc" && (
<div style={{ marginTop: "8px", display: "flex", alignItems: "flex-start", gap: "7px" }}>
<div style={{ width: "14px", height: "14px", borderRadius: "4px", border: "2px solid " + T.blue, background: T.blue, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: "2px" }}>
<span className="material-symbols-outlined" style={{ color: T.bg, fontSize: "12px" }}>check</span>
</div>
<span style={{ fontSize: "12px", color: T.text3, lineHeight: "1.5" }}>Don't apply to this month's budget - this is a credit card payment whose balance changes each month</span>
</div>
)}
</div>
);
})}
</div>
<button onClick={() => setBills(p => [...p, { ...BLANK_BILL(), category: cat }])} style={{ background: "transparent", border: "1px dashed " + T.bord, color: T.muted, padding: "7px 14px", borderRadius: "4px", fontSize: "12px", cursor: "pointer", width: "100%", fontFamily: "DM Mono, monospace", marginTop: "2px", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
<span className="material-symbols-outlined" style={{ fontSize: "16px" }}>add</span>Add {cat.toLowerCase()} bill
</button>
</div>
))}
<div style={{ display: "flex", justifyContent: "center", marginTop: "8px" }}>
{bills.some(b => b.category)
? <button onClick={() => setBills([BLANK_BILL()])} style={{ background: "none", border: "none", color: T.muted, fontSize: "12px", cursor: "pointer", fontFamily: "DM Mono, monospace", textDecoration: "underline" }}>Clear all and start from scratch</button>
: <button onClick={() => setBills(BILL_TEMPLATE.map(i => ({ ...i, id: newBillId() })))} style={{ background: "none", border: "none", color: T.blue, fontSize: "12px", cursor: "pointer", fontFamily: "DM Mono, monospace", textDecoration: "underline" }}>Restore template</button>
}
</div>
</WizardShell>
);
}

// -- Step: discretionary --
if (step === "discretionary") {
return (
<WizardShell {...shellProps} title="Discretionary spending" subtitle="Unlike fixed bills, these are flexible - you set a monthly target, but what you actually spend will vary." canNext={true} onNext={next}>
<div className="wiz-grid">
{disc.map((b, i) => (
<div key={b.id} style={{ background: T.surf, border: `1px solid ${b.color}44`, borderRadius: "8px", padding: "14px 16px", marginBottom: "10px" }}>
<div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
<div style={{ width: "10px", height: "10px", borderRadius: "50%", background: b.color, flexShrink: 0 }} />
<input type="text" value={b.label} onChange={e => setDisc(p => p.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} style={{ background: "transparent", border: "none", borderBottom: "1px solid " + T.bord, color: T.text1, padding: "2px 0", fontSize: "14px", fontWeight: "600", flex: 1, fontFamily: "DM Mono, monospace" }} />
</div>
<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
<span style={{ fontSize: "12px", color: T.text3 }}>Monthly budget</span>
<input type="number" placeholder="0" value={b.amount || ""} onChange={e => setDisc(p => p.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} style={{ background: T.bg, border: "1px solid " + T.bord, color: T.text1, padding: "8px 10px", borderRadius: "4px", fontSize: "16px", width: "120px" }} />
<span style={{ fontSize: "12px", color: T.text3 }}>/mo</span>
</div>
</div>
))}
</div>
</WizardShell>
);
}

// -- Step: reserves --
if (step === "reserves") {
return (
<WizardShell {...shellProps} title="Savings & reserves" subtitle="Unlike fixed bills or discretionary spending, reserves accumulate month to month - you're setting aside a little each month so the money is there when you need it. Think vet visits, auto repairs, or a vacation." canNext={true} onNext={next}>
<div className="wiz-grid">
{reserves.map((b, i) => (
<div key={b.id} style={{ background: T.surf, border: `1px solid ${b.color}44`, borderRadius: "8px", padding: "14px 16px", marginBottom: "10px", display: "flex", alignItems: "center", gap: "14px" }}>
<div style={{ width: "10px", height: "10px", borderRadius: "50%", background: b.color, flexShrink: 0 }} />
<div style={{ flex: 1 }}>
<input type="text" value={b.label} onChange={e => setReserves(p => p.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} style={{ background: "transparent", border: "none", borderBottom: "1px solid " + T.bord, color: T.text1, padding: "2px 0", fontSize: "14px", fontWeight: "600", width: "100%", fontFamily: "DM Mono, monospace", marginBottom: "8px" }} />
<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
<input type="number" placeholder="0" value={b.amount || ""} onChange={e => setReserves(p => p.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} style={{ background: T.bg, border: "1px solid " + T.bord, color: T.text1, padding: "8px 10px", borderRadius: "4px", fontSize: "16px", width: "120px" }} />
<span style={{ fontSize: "12px", color: T.text2 }}>/mo contribution</span>
</div>
</div>
</div>
))}
</div>
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

const inpStyle = { background: T.bg, border: "1px solid " + T.bord, color: T.text1, padding: "8px 10px", borderRadius: "4px", fontSize: "14px", width: "100%", boxSizing: "border-box" };

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
  <WizardShell {...shellProps} title="Debts (Optional)" subtitle="Do you want to track your debts? Select any bills or spending categories that are paying down a debt. We'll track the balance and project your payoff date. You can skip this and add debts later from the Debt tab." canNext={true} onNext={next}>

    <div style={{ background: T.surf, border: "1px solid " + T.bord, borderRadius: "8px", padding: "10px 14px", marginBottom: "16px", display: "flex", alignItems: "flex-start", gap: "8px" }}>
      <span className="material-symbols-outlined" style={{ fontSize: "18px", color: T.green, flexShrink: 0, marginTop: "1px" }}>lightbulb</span>
      <span style={{ fontSize: "12px", color: T.text2, lineHeight: "1.5" }}>It's important to pay something toward every debt monthly, even if it's $5.</span>
    </div>

    {filledBills.length > 0 && (
      <div style={{ marginBottom: "20px" }}>
        <div style={{ fontSize: "12px", letterSpacing: "0.15em", textTransform: "uppercase", color: T.blue, marginBottom: "8px", paddingBottom: "6px", borderBottom: "1px solid " + T.bord }}>From your fixed bills</div>
        <div className="wiz-grid">
        {filledBills.map(b => {
          const isLinked = linkedIds.has(b.id);
          const debt = debts.find(d => d.linkedBucketId === b.id);
          return (
            <div key={b.id} style={{ background: T.surf, border: `1px solid ${isLinked ? "#4A9EFF55" : T.bord}`, borderRadius: "8px", padding: "12px 14px", marginBottom: "8px" }}>
              <div onClick={() => toggle(b.id, b.name, b.amt, "fixed")} style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
                <div style={{ width: "18px", height: "18px", borderRadius: "4px", border: `2px solid ${isLinked ? T.blue : T.bord}`, background: isLinked ? T.blue : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {isLinked && <span className="material-symbols-outlined" style={{ fontSize: "14px", color: T.bg }}>check</span>}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "13px", fontWeight: "600", color: T.text1 }}>{b.name}</div>
                  <div style={{ fontSize: "12px", color: T.text3 }}>{new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(b.amt)}/mo - fixed payment</div>
                </div>
              </div>
              {isLinked && debt && renderDebtDetail(debt, p => updLinked(b.id, p))}
            </div>
          );
        })}
        </div>
      </div>
    )}

    {filledDisc.length > 0 && (
      <div style={{ marginBottom: "20px" }}>
        <div style={{ fontSize: "12px", letterSpacing: "0.15em", textTransform: "uppercase", color: "#FFB347", marginBottom: "8px", paddingBottom: "6px", borderBottom: "1px solid " + T.bord }}>From your discretionary spending</div>
        <div className="wiz-grid">
        {filledDisc.map(b => {
          const isLinked = linkedIds.has(b.id);
          const debt = debts.find(d => d.linkedBucketId === b.id);
          return (
            <div key={b.id} style={{ background: T.surf, border: `1px solid ${isLinked ? "#FFB34755" : T.bord}`, borderRadius: "8px", padding: "12px 14px", marginBottom: "8px" }}>
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
      </div>
    )}

    {manualDebts.length > 0 && (
      <div style={{ marginBottom: "12px" }}>
        <div style={{ fontSize: "12px", letterSpacing: "0.15em", textTransform: "uppercase", color: T.text3, marginBottom: "8px", paddingBottom: "6px", borderBottom: "1px solid " + T.bord }}>Add more debts</div>
        <div className="wiz-grid">
        {manualDebts.map((d, i) => (
          <div key={d.id} style={{ background: T.surf, border: "1px solid " + T.bord, borderRadius: "8px", padding: "12px 14px", marginBottom: "8px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
              <div style={{ fontSize: "12px", fontWeight: "700", color: T.text3 }}>Debt {i + 1}</div>
              <button onClick={() => setDebts(p => p.filter(x => x.id !== d.id))} style={{ background: "none", border: "none", color: T.red, cursor: "pointer", display: "flex", alignItems: "center" }}>
                <span className="material-symbols-outlined" style={{ fontSize: "20px" }}>delete</span>
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "8px" }}>
              <div>
                <div style={{ fontSize: "12px", letterSpacing: "0.15em", color: T.text3, textTransform: "uppercase", marginBottom: "4px" }}>Name</div>
                <input type="text" placeholder="e.g. Student Loan" value={d.name} onChange={e => updManual(d.id, { name: e.target.value })} style={{ background: T.bg, border: "1px solid " + T.bord, color: T.text1, padding: "8px 10px", borderRadius: "4px", fontSize: "14px", width: "100%", boxSizing: "border-box" }} />
              </div>
              <div>
                <div style={{ fontSize: "12px", letterSpacing: "0.15em", color: T.text3, textTransform: "uppercase", marginBottom: "4px" }}>Monthly payment</div>
                <input type="number" placeholder="0" value={d.monthly || ""} onChange={e => updManual(d.id, { monthly: parseFloat(e.target.value) || 0, monthlyPrincipal: parseFloat(e.target.value) || 0 })} style={{ background: T.bg, border: "1px solid " + T.bord, color: T.text1, padding: "8px 10px", borderRadius: "4px", fontSize: "14px", width: "100%", boxSizing: "border-box" }} />
              </div>
            </div>
            <div style={{ fontSize: "12px", color: T.muted, marginBottom: "8px" }}>Add this payment to Fixed Bills so it counts toward your budget.</div>
            {renderDebtDetail(d, p => updManual(d.id, p))}
          </div>
        ))}
        </div>
      </div>
    )}

    {filledBills.length === 0 && filledDisc.length === 0 && debts.length === 0 && (
      <div style={{ background: T.surf, border: "1px dashed " + T.bord, borderRadius: "8px", padding: "20px", textAlign: "center", marginBottom: "16px" }}>
        <span className="material-symbols-outlined" style={{ fontSize: "32px", color: T.muted, display: "block", marginBottom: "8px" }}>credit_card_off</span>
        <div style={{ fontSize: "13px", color: T.muted }}>No bills or spending categories to link yet. Add a manual debt below, or skip this step.</div>
      </div>
    )}

    <button onClick={() => setDebts(p => [...p, newDebt()])} style={{ background: "transparent", border: "1px dashed " + T.bord, color: T.text3, padding: "10px 16px", borderRadius: "4px", fontSize: "12px", cursor: "pointer", width: "100%", fontFamily: "DM Mono, monospace", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
      <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>add</span>Add a debt not in my bills
    </button>
  </WizardShell>
);

}

// -- Step: review --
if (step === "review") {
const fmt0 = n => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
// Fallback if the step is ever reached without a snapshot
const rk = reviewKeys || {
bills: bills.map((b, i) => ({ b, i })).filter(({ b }) => b.name.trim() && parseFloat(b.amt) > 0 && b.note !== "cc").map(({ i }) => i),
disc: disc.filter(b => parseFloat(b.amount) > 0).map(b => b.id),
res: reserves.filter(b => parseFloat(b.amount) > 0).map(b => b.id),
};
const rowStyle = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", padding: "7px 0", borderBottom: "1px solid " + T.bord + "55" };
const rowName = { fontSize: "13px", color: T.text1, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const rowInp = { background: T.bg, border: "1px solid " + T.bord, color: T.text1, padding: "6px 8px", borderRadius: "4px", fontSize: "14px", width: "90px", textAlign: "right", fontFamily: "DM Mono, monospace" };
const perMo = <span style={{ fontSize: "12px", color: T.text3, flexShrink: 0 }}>/mo</span>;
const section = (label, color, total, targetStep, rows) => (
<div style={{ background: T.surf, border: "1px solid " + T.bord, borderRadius: "8px", padding: "12px 14px", marginBottom: "10px" }}>
<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: "8px", borderBottom: "1px solid " + T.bord }}>
<span style={{ fontSize: "12px", letterSpacing: "0.15em", textTransform: "uppercase", color }}>{label}</span>
<div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
<span style={{ fontSize: "12px", fontWeight: "700", color: T.text2 }}>{fmt0(total)}/mo</span>
<button onClick={() => setStep(targetStep)} style={{ background: "none", border: "none", color: T.blue, fontSize: "12px", cursor: "pointer", fontFamily: "DM Mono, monospace", textDecoration: "underline", padding: 0 }}>Edit step</button>
</div>
</div>
{rows}
</div>
);
return (
<WizardShell {...shellProps} title="Review your budget" subtitle="Everything looks right? Adjust any amount below and the totals update as you type. Hit Launch to get started." canNext={unallocated >= 0} onNext={finish}>
<div style={{ background: T.surf, border: "1px solid " + T.blueBord, borderRadius: "8px", padding: "14px 16px", marginBottom: "10px" }}>
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
// Make sure General Savings shows up in the review list below
setReviewKeys(function(prev) {
if (!prev || prev.res.indexOf("bill011") >= 0) return prev;
return { ...prev, res: [...prev.res, "bill011"] };
});
}} style={{ background: T.green, border: "none", color: T.bg, padding: "8px 14px", borderRadius: "4px", fontSize: "12px", fontWeight: "700", cursor: "pointer", fontFamily: "DM Mono, monospace" }}>
Add {fmt0(unallocated)}/mo to General Savings
</button>
</div>
)}

<div className="wiz-grid">
{section("Income", T.green, totalIncome, "income",
incomes.map((inc, i) => (
<div key={i} style={rowStyle}>
<span style={rowName}>{inc.label || "Income"}</span>
<span style={{ fontSize: "13px", color: T.text1, flexShrink: 0 }}>{fmt0((parseFloat(inc.netPay) || 0) * (FREQ[inc.frequency] || 1))}/mo</span>
</div>
))
)}

{rk.bills.length > 0 && section("Fixed bills", T.blue, billsTotal, "bills",
rk.bills.map(i => {
const b = bills[i];
if (!b) return null;
return (
<div key={i} style={rowStyle}>
<span style={rowName}>{b.name}</span>
<div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
<input type="number" placeholder="0" value={b.amt} onChange={e => setBills(p => p.map((x, j) => j === i ? { ...x, amt: e.target.value } : x))} style={rowInp} />
{perMo}
</div>
</div>
);
})
)}

{rk.disc.length > 0 && section("Discretionary", "#FFB347", discTotal, "discretionary",
rk.disc.map(id => {
const b = disc.find(x => x.id === id);
if (!b) return null;
return (
<div key={id} style={rowStyle}>
<span style={rowName}>{b.label}</span>
<div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
<input type="number" placeholder="0" value={b.amount} onChange={e => setDisc(p => p.map(x => x.id === id ? { ...x, amount: e.target.value } : x))} style={rowInp} />
{perMo}
</div>
</div>
);
})
)}

{rk.res.length > 0 && section("Savings & reserves", T.green, resTotal, "reserves",
rk.res.map(id => {
const b = reserves.find(x => x.id === id);
if (!b) return null;
return (
<div key={id} style={rowStyle}>
<span style={rowName}>{b.label}</span>
<div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
<input type="number" placeholder="0" value={b.amount} onChange={e => setReserves(p => p.map(x => x.id === id ? { ...x, amount: e.target.value } : x))} style={rowInp} />
{perMo}
</div>
</div>
);
})
)}
</div>
</WizardShell>
);
}

return null;
}

function BudgetTracker({ onReset, onRerunWizard, onImportCsv }) {
// ---- Theme ----
const [themePref, setThemePref] = useState(function() { return loadTheme(); });
const resolvedMode = resolveTheme(themePref);
const T = THEMES[resolvedMode];

// Shared style objects built from theme tokens
const cs = {
  page: { minHeight: "100vh", background: T.bg, color: T.text1, fontFamily: "DM Mono, monospace" },
  header: { borderBottom: "1px solid " + T.bord, padding: "20px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" },
  sel: { background: T.surf, border: "1px solid " + T.bord, color: T.text1, padding: "7px 10px", borderRadius: "4px", fontSize: "12px", cursor: "pointer", fontFamily: "DM Mono, monospace" },
  tabs: { display: "flex", borderBottom: "1px solid " + T.bord, padding: "0 24px", overflowX: "auto", overflowY: "hidden", minHeight: "42px", scrollbarWidth: "none", msOverflowStyle: "none" },
  body: { padding: "20px 24px", margin: "0" },
  lbl: { fontSize: "12px", letterSpacing: "0.12em", color: T.text2, textTransform: "uppercase", marginBottom: "4px" },
  inp: { background: T.bg, border: "1px solid " + T.bord, color: T.text1, padding: "8px 10px", borderRadius: "4px", fontSize: "13px", boxSizing: "border-box", fontFamily: "DM Mono, monospace" },
};
function Card({ children, border, style, onClick }) {
  return <div onClick={onClick} style={{ background: T.surf, border: "1px solid " + (border || T.bord), borderRadius: "8px", padding: "16px 18px", marginBottom: "10px", ...style }}>{children}</div>;
}
function Btn({ color, outline, onClick, children, style }) {
  return <button onClick={onClick} style={{ background: outline ? "transparent" : color, border: "1px solid " + color, color: outline ? color : T.bg, padding: "7px 14px", borderRadius: "4px", fontSize: "12px", fontWeight: "700", cursor: "pointer", ...style }}>{children}</button>;
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
// Flat itemized ledger. foldLegacyTransactions() migrates any per-month records
// (incl. ones a CSV import just wrote into budgetData) into it on mount.
const [transactions, setTransactions] = useState(() => foldLegacyTransactions());
const [showRef, setShowRef] = useState(false);
const [txMerchant, setTxMerchant] = useState("");
const [txAmount, setTxAmount] = useState("");
const [txDate, setTxDate] = useState(() => new Date().toISOString().slice(0, 10));
const [txReserve, setTxReserve] = useState("bill008");
// CSV import flow (inside the Log Spend modal). csvStep drives the whole
// upload; csvStep walks upload -> map -> review. Nothing is committed until the
// user hits Submit on the review step (single-session; leftovers are discarded).
const [csvStep, setCsvStep] = useState("upload");  // "upload" | "map" | "review"
const [csvFileName, setCsvFileName] = useState("");
const [csvHeaders, setCsvHeaders] = useState([]);
const [csvRawRows, setCsvRawRows] = useState([]);
const [csvMapping, setCsvMapping] = useState({ date: -1, amount: -1, description: -1, debit: -1, credit: -1 });
const [csvOutflow, setCsvOutflow] = useState("negative"); // single-amount sign meaning money out
const [csvReviewRows, setCsvReviewRows] = useState([]);
const [csvSkipped, setCsvSkipped] = useState(0);
const [csvDupes, setCsvDupes] = useState(0);
const [csvAutos, setCsvAutos] = useState(0); // rows pre-categorized by merchant memory
const [csvRefunds, setCsvRefunds] = useState(0);
const [csvDragOver, setCsvDragOver] = useState(false);
const [expandedReserve, setExpandedReserve] = useState(null);
const [search, setSearch] = useState("");
const [showSearch, setShowSearch] = useState(false);

// -- AI assistant --
// apiKey is the saved, verified key. keyInput is what is being typed in
// Settings and is never persisted until it verifies.
const [apiKey, setApiKey] = useState(loadApiKey());
const [keyInput, setKeyInput] = useState("");
const [keyStatus, setKeyStatus] = useState("idle"); // idle | verifying | error
const [keyError, setKeyError] = useState("");
const [agentOpen, setAgentOpen] = useState(false);
const [keyModalOpen, setKeyModalOpen] = useState(false);
const [debtInputs, setDebtInputs] = useState({});
const [projMonthly, setProjectMonthly] = useState({});
const [showFlowInfo, setShowFlowInfo] = useState(false);
const [showDebtInfo, setShowDebtInfo] = useState(false);
const [debtChartHover, setDebtChartHover] = useState(null);
const [moneyFlowHovered, setMoneyFlowHovered] = useState(null);
const [moneyFlowTooltip, setMoneyFlowTooltip] = useState(null);
const [flowLinkHover, setFlowLinkHover] = useState(null);
// editModal: null | "bills" | "disc" | "reserves" | "debt" | "income"
const [editModal, setEditModal] = useState(null);
// Parsed-but-not-yet-applied CSV import: { counts, payload }. Shows the CSV
// Loaded card; on close the pre-filled wizard opens (nothing saved until Launch).
const [importPreview, setImportPreview] = useState(null);
// Local edit state - populated when a modal opens
const [editBills, setEditBills] = useState([]);
const [editDisc, setEditDisc] = useState([]);
const [editReserves, setEditReserves] = useState([]);
const [editDebts, setEditDebts] = useState([]);
const [editIncomes, setEditIncomes] = useState([]);

// Persist data and debts to localStorage whenever they change
useEffect(() => { saveData(data); }, [data]);
useEffect(() => { saveDebts(debts); }, [debts]);
useEffect(() => { saveTransactions(transactions); }, [transactions]);

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

function reassignTransaction(txId, newBucketId) {
setTransactions(t => t.map(tx =>
tx.id === txId ? { ...tx, bucketId: newBucketId || null } : tx
));
}

function addTransaction() {
const amount = parseFloat(txAmount);
if (!txMerchant.trim() || isNaN(amount) || amount <= 0) return;
const rec = toTxnRecord({
id: newTxnId(),
date: txDate,
merchant: txMerchant.trim(),
amount,
bucketId: txReserve,
source: "manual",
status: "confirmed",
});
setTransactions(t => [...t, rec]);
// A manual log is the strongest signal there is about where a merchant
// belongs, and it seeds merchant memory before the first CSV import.
saveRules(upsertRule(loadRules(), txMerchant.trim(), txReserve));
// spent[] stays the source of truth for all budget math; a confirmed manual
// log adds to it directly. txReserve holds the chosen bucket id for both the
// reserve and discretionary categories.
setData(d => ({
...d,
[key]: {
...d[key],
spent: { ...(d[key]?.spent || {}), [txReserve]: ((d[key]?.spent?.[txReserve] || 0) + amount) },
}
}));
setTxMerchant("");
setTxAmount("");
setTxDate(new Date().toISOString().slice(0, 10));
setEditModal(null);
}

// ---- CSV import (flat bank/CC exports) ----
function resetCsv() {
setCsvStep("upload");
setCsvFileName("");
setCsvHeaders([]);
setCsvRawRows([]);
setCsvMapping({ date: -1, amount: -1, description: -1, debit: -1, credit: -1 });
setCsvOutflow("negative");
setCsvReviewRows([]);
setCsvSkipped(0);
setCsvDupes(0);
setCsvAutos(0);
setCsvRefunds(0);
setCsvDragOver(false);
}
function closeLogSpend() { resetCsv(); setEditModal(null); }

function handleCsvFile(file) {
if (!file) return;
const reader = new FileReader();
reader.onload = e => {
try {
const parsed = parseFlatCSV(String(e.target.result || ""));
if (!parsed.headers.length || !parsed.rows.length) { window.alert("That file has no readable rows."); return; }
setCsvFileName(file.name || "import.csv");
setCsvHeaders(parsed.headers);
setCsvRawRows(parsed.rows);
const remembered = loadCsvMappings()[csvHeaderSignature(parsed.headers)];
const mapping = remembered ? remembered.mapping : csvGuessMapping(parsed.headers);
const outflow = remembered ? (remembered.outflow || "negative") : "negative";
setCsvMapping(mapping);
setCsvOutflow(outflow);
// If we have a remembered mapping (or a confident auto-guess), skip straight
// to review; otherwise let the user confirm columns first.
const guessConfident = mapping.date !== -1 && mapping.description !== -1 && (mapping.amount !== -1 || (mapping.debit !== -1));
if (remembered || guessConfident) { applyMapping(parsed.rows, mapping, outflow); setCsvStep("review"); }
else { setCsvStep("map"); }
} catch (err) { window.alert("Failed to read CSV: " + err.message); }
};
reader.readAsText(file);
}

// Turn raw rows into reviewable spend rows using the column mapping, dropping
// malformed rows and exact duplicates of already-imported transactions. Rows
// whose merchant matches a learned rule arrive pre-categorized.
function parseCsvRows(rawRows, mapping, outflow) {
// A debit column alone is enough to know money-out; requiring a credit column
// too used to drop the file into the signed-amount branch with no amount
// column mapped, which silently skipped every row.
const useDC = mapping.debit !== -1;
const existingRefs = {};
transactions.forEach(t => { if (t.sourceRef) existingRefs[t.sourceRef] = true; });
const rules = loadRules();
// A rule can outlive its bucket (renamed setup, re-run wizard). Only pre-fill
// buckets the picker still offers, so a stale rule cannot commit into nothing.
const validBucket = {};
buckets.forEach(b => { if (DISC_IDS_EDIT.includes(b.id) || RESERVE_IDS_EDIT.includes(b.id)) validBucket[b.id] = true; });
const seenThisImport = {};
let skipped = 0, dupes = 0, autos = 0, refunds = 0;
const out = [];
rawRows.forEach(r => {
const date = csvParseDate(r[mapping.date]);
let amount = null;
if (useDC) {
const deb = csvParseAmount(r[mapping.debit]);
// A debit column holds positive money-out; a negative there is a correction.
if (deb != null && deb !== 0) amount = deb;
else if (mapping.credit !== -1) {
const cred = csvParseAmount(r[mapping.credit]);
// Money in, carried as negative spend so it nets against the bucket it is
// assigned to rather than being thrown away.
if (cred != null && cred !== 0) amount = -Math.abs(cred);
}
} else {
const raw = csvParseAmount(r[mapping.amount]);
if (raw != null && raw !== 0) {
const isOut = outflow === "negative" ? raw < 0 : raw > 0;
amount = isOut ? Math.abs(raw) : -Math.abs(raw);
}
}
const description = (mapping.description !== -1 ? (r[mapping.description] || "") : "").trim();
if (date == null || amount == null) { skipped++; return; } // malformed or blank
if (amount < 0) refunds++;
const ref = csvRowHash(date, amount, description);
if (existingRefs[ref] || seenThisImport[ref]) { dupes++; return; }
seenThisImport[ref] = true;
let hit = matchRule(rules, description);
if (hit && !validBucket[hit.bucketId]) hit = null;
if (hit) autos++;
out.push({
rowId: newTxnId(), date, amount, description, sourceRef: ref,
bucketId: hit ? hit.bucketId : null,
auto: !!hit,
// Kept alongside bucketId so the row can tell a rule's guess from a user
// correction, both for the "auto" chip and for the stored confidence.
suggestedId: hit ? hit.bucketId : null,
confidence: hit ? hit.confidence : null,
});
});
return { out, skipped, dupes, autos, refunds };
}

function applyMapping(rawRows, mapping, outflow) {
const res = parseCsvRows(rawRows, mapping, outflow);
setCsvReviewRows(res.out);
setCsvSkipped(res.skipped);
setCsvDupes(res.dupes);
setCsvAutos(res.autos);
setCsvRefunds(res.refunds);
}

// Commit the categorized review rows. Rows without a bucket are left behind
// (discarded on close). Each committed row adds to spent[bucketId] in the month
// of its date, and becomes a confirmed source:"csv" transaction record.
function commitCsv() {
const ready = csvReviewRows.filter(r => r.bucketId);
if (!ready.length) return;
const recs = ready.map(r => toTxnRecord({
id: newTxnId(), date: r.date, merchant: r.description, amount: r.amount,
bucketId: r.bucketId, source: "csv", sourceRef: r.sourceRef, status: "confirmed",
// A row the user re-bucketed is their own call, not the rule's guess.
confidence: r.auto && r.bucketId === r.suggestedId ? r.confidence : 1,
}));
// Learn from every committed row. Rows the user corrected retrain the rule,
// since upsertRule takes the bucket that was actually confirmed.
const rules = ready.reduce((acc, r) => upsertRule(acc, r.description, r.bucketId), loadRules());
saveRules(rules);
setTransactions(t => [...t, ...recs]);
setData(d => {
const next = { ...d };
ready.forEach(r => {
const mk = r.date.slice(0, 4) + "-" + (parseInt(r.date.slice(5, 7), 10) - 1);
const md = next[mk] || { spent: {} };
next[mk] = { ...md, spent: { ...(md.spent || {}), [r.bucketId]: ((md.spent && md.spent[r.bucketId]) || 0) + r.amount } };
});
return next;
});
// Remember this file's column layout so re-importing skips the mapping step.
const sig = csvHeaderSignature(csvHeaders);
const all = loadCsvMappings();
all[sig] = { mapping: csvMapping, outflow: csvOutflow };
saveCsvMappings(all);
closeLogSpend();
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
      return s ? { ...t, id: s.id || newBillId(), amt: String(s.amt || ""), day: String(s.day || ""), note: s.note || t.note } : { ...t, id: newBillId() };
    });
    // Append any saved bills not in template (user-added)
    saved.forEach(s => {
      if (!BILL_TEMPLATE.find(t => t.name === s.name))
        merged.push({ id: s.id || newBillId(), name: s.name, amt: String(s.amt || ""), day: String(s.day || ""), note: s.note || "", category: s.category || "Other" });
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
      items: filled.map(b => ({ id: b.id || newBillId(), name: b.name, amt: parseFloat(b.amt) || 0, day: Math.min(28, Math.max(1, parseInt(b.day, 10) || 1)), note: b.note || "", category: b.category || "Other" })) };
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
    <div style={{ background: T.surf, borderRadius: "8px 8px 0 0", width: "100%", maxWidth: "600px", maxHeight: "85vh", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "16px 20px", borderBottom: "1px solid " + T.bord, display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
        <span style={{ fontSize: "13px", fontWeight: "700", color: T.text1, letterSpacing: "0.05em" }}>{title}</span>
        <button onClick={() => setEditModal(null)} style={{ background: "none", border: "none", color: T.text3, cursor: "pointer", display: "flex", alignItems: "center" }}>
          <span className="material-symbols-outlined" style={{ fontSize: "22px" }}>close</span>
        </button>
      </div>
      <div style={{ overflowY: "auto", padding: "16px 20px 8px", flex: 1 }}>{content}</div>
      <div style={{ padding: "12px 20px 20px", borderTop: "1px solid " + T.bord, display: "flex", gap: "10px", flexShrink: 0 }}>
        <button onClick={() => setEditModal(null)} style={{ flex: 1, background: "transparent", border: "1px solid " + T.bord, color: T.text3, padding: "10px", borderRadius: "4px", fontSize: "12px", fontWeight: "700", cursor: "pointer", fontFamily: "DM Mono, monospace" }}>Cancel</button>
        <button onClick={saveEditModal} style={{ flex: 2, background: T.blue, border: "none", color: T.bg, padding: "10px", borderRadius: "4px", fontSize: "13px", fontWeight: "700", cursor: "pointer", fontFamily: "DM Mono, monospace" }}>Save Changes</button>
      </div>
    </div>
  </div>
);

const renderInfoModal = (title, content, onClose) => {
  const close = onClose || (() => setShowFlowInfo(false));
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px 0" }}
      onClick={e => { if (e.target === e.currentTarget) close(); }}>
      <div style={{ background: T.surf, borderRadius: "8px", width: "100%", maxWidth: "760px", maxHeight: "85vh", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid " + T.bord, display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
          <span style={{ fontSize: "13px", fontWeight: "700", color: T.text1, letterSpacing: "0.05em" }}>{title}</span>
          <button onClick={close} style={{ background: "none", border: "none", color: T.text3, cursor: "pointer", display: "flex", alignItems: "center" }}>
            <span className="material-symbols-outlined" style={{ fontSize: "22px" }}>close</span>
          </button>
        </div>
        <div style={{ overflowY: "auto", padding: "16px 20px 20px", flex: 1 }}>{content}</div>
      </div>
    </div>
  );
};

// Assistant sheet. Reuses the same bottom-sheet shell as the edit modals so it
// reads as part of the app rather than a bolted-on chat widget. Opening it as a
// sheet also means whichever tab you were reading is still there underneath.
// The tool loop and conversation land in the body next; this is the connect gate.
const renderAgentPanel = () => {
  const example = (q) => (
    <div key={q} style={{ background: T.bg, border: "1px solid " + T.bord, borderRadius: "6px", padding: "10px 12px", marginBottom: "8px", fontSize: "12px", color: T.text2 }}>{q}</div>
  );
  const examples = [
    "Why am I short this month?",
    "Where is most of my discretionary money going?",
    "Can I cover a $340 vet bill without touching savings?",
  ];

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end" }}
      onClick={e => { if (e.target === e.currentTarget) setAgentOpen(false); }}>
      <div style={{ background: T.surf, borderRadius: "8px 8px 0 0", width: "100%", maxWidth: "600px", height: "85vh", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid " + T.bord, display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
          <span style={{ fontSize: "13px", fontWeight: "700", color: T.text1, letterSpacing: "0.05em", display: "flex", alignItems: "center", gap: "8px" }}>
            <span className="material-symbols-outlined" style={{ fontSize: "18px", color: T.blue }}>auto_awesome</span>
            Assistant
          </span>
          <button onClick={() => setAgentOpen(false)} style={{ background: "none", border: "none", color: T.text3, cursor: "pointer", display: "flex", alignItems: "center" }}>
            <span className="material-symbols-outlined" style={{ fontSize: "22px" }}>close</span>
          </button>
        </div>

        <div style={{ overflowY: "auto", padding: "20px", flex: 1 }}>
          <div style={{ display: "inline-block", background: T.blueBg, border: "1px solid " + T.blueBord, color: T.blue, borderRadius: "4px", padding: "4px 10px", fontSize: "11px", fontWeight: "700", letterSpacing: "0.1em", marginBottom: "14px" }}>
            COMING SOON
          </div>

          <div style={{ fontSize: "13px", fontWeight: "700", color: T.text1, marginBottom: "6px" }}>Ask about your budget</div>
          <div style={{ fontSize: "12px", color: T.text3, marginBottom: "16px", lineHeight: "1.6" }}>
            Ask questions in plain language and get suggested changes you approve before anything is applied.
          </div>

          <div style={{ ...cs.lbl, marginBottom: "10px" }}>For example</div>
          {examples.map(example)}

          {apiKey && (
            <div style={{ fontSize: "12px", color: T.text3, marginTop: "16px", lineHeight: "1.6" }}>
              Your key is connected, so this will work as soon as it ships.
            </div>
          )}

          {/* Deliberately not a click counter. The app has no server, so a count
              would only ever be readable on the device that made it, and the
              usual fix is a third-party analytics script - which could read the
              API key out of localStorage. A survey reply is the one interest
              signal that reaches us without breaking that promise. */}
          <a href={SURVEY_URL} target="_blank" rel="noopener noreferrer"
            style={{ background: T.blue, border: "none", color: T.bg, padding: "12px 16px", borderRadius: "4px", fontSize: "13px", fontWeight: "700", fontFamily: "DM Mono, monospace", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", width: "100%", minHeight: "48px", boxSizing: "border-box", textDecoration: "none", marginTop: "20px" }}>
            Tell me you want this
            <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>arrow_forward</span>
          </a>
          <div style={{ fontSize: "12px", color: T.text3, marginTop: "10px", lineHeight: "1.6", textAlign: "center" }}>
            Opens a short survey. Nothing from your budget is sent.
          </div>
        </div>
      </div>
    </div>
  );
};

// Connect-a-key modal. Settings keeps only the status of the key and the way to
// remove it; everything a person has to read before pasting a credential lives
// here, so the warning and the decision are never on separate screens.
const renderKeyModal = () => {
  const closeModal = () => { setKeyModalOpen(false); setKeyInput(""); setKeyStatus("idle"); setKeyError(""); };
  const busy = keyStatus === "verifying";
  const empty = keyInput.trim().length === 0;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px 16px" }}
      onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
      <div style={{ background: T.surf, borderRadius: "8px", width: "100%", maxWidth: "600px", maxHeight: "85vh", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid " + T.bord, display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
          <span style={{ fontSize: "13px", fontWeight: "700", color: T.text1, letterSpacing: "0.05em", display: "flex", alignItems: "center", gap: "8px" }}>
            <span className="material-symbols-outlined" style={{ fontSize: "18px", color: T.blue }}>vpn_key</span>
            Connect My AI Assistant
          </span>
          <button onClick={closeModal} style={{ background: "none", border: "none", color: T.text3, cursor: "pointer", display: "flex", alignItems: "center" }}>
            <span className="material-symbols-outlined" style={{ fontSize: "22px" }}>close</span>
          </button>
        </div>

        <div style={{ overflowY: "auto", padding: "20px", flex: 1 }}>
          {/* Stated at the point of decision, not buried. Everything else in this
              app stays on the device, so the exception has to be explicit. */}
          <div style={{ background: T.orangeFade, border: "1px solid #FFB34755", borderRadius: "4px", padding: "12px 14px", marginBottom: "14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
              <span className="material-symbols-outlined" style={{ fontSize: "16px", color: "#FFB347" }}>warning</span>
              <span style={{ fontSize: "12px", fontWeight: "700", color: T.text1, letterSpacing: "0.05em" }}>THIS SENDS YOUR DATA OFF THIS DEVICE</span>
            </div>
            <div style={{ fontSize: "12px", color: T.text2, lineHeight: "1.6" }}>
              When you use the assistant, your budget amounts, bucket names, and transaction descriptions are sent to Anthropic to answer your question. Nothing is sent unless you use it. Your key is stored only in this browser and is billed to your own account.
            </div>
          </div>

          <div style={{ fontSize: "12px", color: T.text3, marginBottom: "14px", lineHeight: "1.6" }}>
            An API key is separate from a Claude Pro or Max subscription and is billed separately. Create one at{" "}
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" style={{ color: T.blue }}>console.anthropic.com</a>
            {" "}and add a few dollars of credit. Typical use costs well under $1 a month.
          </div>

          <div style={{ ...cs.lbl, marginBottom: "8px" }}>Your API key</div>
          <input
            type="password"
            placeholder="sk-ant-..."
            value={keyInput}
            onChange={e => { setKeyInput(e.target.value); if (keyStatus === "error") { setKeyStatus("idle"); setKeyError(""); } }}
            style={{ ...cs.inp, width: "100%", fontSize: "16px", padding: "10px 12px", marginBottom: "10px", boxSizing: "border-box" }}
          />

          {keyStatus === "error" && (
            <div style={{ background: T.redFade, border: "1px solid " + T.red + "55", borderRadius: "4px", padding: "10px 12px", marginBottom: "12px", fontSize: "12px", color: T.text2, lineHeight: "1.6" }}>
              {keyError}
            </div>
          )}

          <button
            disabled={busy || empty}
            onClick={async () => {
              const k = keyInput.trim();
              setKeyStatus("verifying"); setKeyError("");
              const res = await verifyApiKey(k);
              if (res.ok) {
                saveApiKey(k); setApiKey(k); setKeyInput(""); setKeyStatus("idle"); setKeyModalOpen(false);
              } else {
                setKeyStatus("error"); setKeyError(res.error);
              }
            }}
            style={{ background: T.blue, border: "none", color: T.bg, padding: "12px 16px", borderRadius: "4px", fontSize: "13px", fontWeight: "700", cursor: busy ? "wait" : "pointer", fontFamily: "DM Mono, monospace", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", width: "100%", minHeight: "48px", boxSizing: "border-box", opacity: (busy || empty) ? 0.5 : 1 }}>
            <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>{busy ? "hourglass_top" : "vpn_key"}</span>
            {busy ? "Verifying..." : "Connect"}
          </button>

          <div style={{ fontSize: "12px", color: T.text3, marginTop: "10px", lineHeight: "1.6", textAlign: "center" }}>
            Connecting makes one tiny test request to check the key works.
          </div>
        </div>
      </div>
    </div>
  );
};

// Debt Paid card detail: cumulative amount paid off over the last 12 months
const renderDebtInfoModal = () => {
  const kfmt = (v) => v >= 1000 ? "$" + (v / 1000).toFixed(v >= 9500 ? 0 : 1).replace(/\.0$/, "") + "k" : "$" + Math.round(v);
  const monthsElapsed = (year - setupYear) * 12 + (month - setupMonth) + 1;
  const { N, series, startTotal, C, windowPaid, paidPct } = buildDebtWindow(debts, monthsElapsed);
  const monthLabel = (i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - (N - i)); return MONTHS[d.getMonth()]; };

  const rough = startTotal || 1;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const niceMax = Math.max(pow, Math.ceil(rough / pow) * pow);

  const PINK = "#FF6B9D", SLATE = "#3D4657";
  const W = 680, H = 320, padL = 56, padR = 20, padT = 20, padB = 40;
  const x0 = padL, x1 = W - padR, y0 = padT, y1 = H - padB;
  const xFor = (i) => x0 + (i / N) * (x1 - x0);
  const yFor = (v) => y1 - (v / niceMax) * (y1 - y0);

  const paidPts = series.map(p => xFor(p.i).toFixed(1) + " " + yFor(p.paid).toFixed(1));
  const paidLine = "M " + paidPts.join(" L ");
  const paidArea = "M " + xFor(0).toFixed(1) + " " + y1 + " L " + paidPts.join(" L ") + " L " + xFor(N).toFixed(1) + " " + y1 + " Z";
  const totalY = yFor(startTotal);
  const remainArea = "M " + xFor(0).toFixed(1) + " " + totalY.toFixed(1) + " L " + xFor(N).toFixed(1) + " " + totalY.toFixed(1) + " L " + paidPts.slice().reverse().join(" L ") + " Z";
  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  const xStep = Math.max(1, Math.round(N / 6));
  const xTicks = [];
  for (let i = 0; i <= N; i += xStep) xTicks.push(i);
  if (xTicks[xTicks.length - 1] !== N) xTicks.push(N);

  const hi = debtChartHover != null && debtChartHover <= N ? debtChartHover : null;

  const legendItem = (color, label, dashed) => (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      {dashed
        ? <svg width="26" height="8"><line x1="0" y1="4" x2="26" y2="4" stroke={color} strokeWidth="2" strokeDasharray="4 3" /></svg>
        : <span style={{ width: "16px", height: "12px", borderRadius: "2px", background: color, display: "inline-block" }} />}
      <span style={{ fontSize: "12px", color: T.text2 }}>{label}</span>
    </div>
  );

  return renderInfoModal("Debt Paid (Last 12M)", (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "14px", flexWrap: "wrap", gap: "8px" }}>
        <div style={{ fontSize: "12px", color: T.text3, letterSpacing: "0.1em", textTransform: "uppercase" }}>{fmt(C)} outstanding &middot; {paidPct}% paid</div>
        <div style={{ fontSize: "20px", fontWeight: "700", color: PINK }}>{kfmt(windowPaid)} paid off</div>
      </div>

      <div style={{ background: T.surf2, border: "1px solid " + T.bord, borderRadius: "8px", padding: "12px 8px 8px" }}>
        <svg viewBox={"0 0 " + W + " " + H} preserveAspectRatio="xMidYMid meet" style={{ width: "100%", height: "auto", display: "block" }}>
          <defs>
            <linearGradient id="debtPaidArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={PINK} stopOpacity="0.9" />
              <stop offset="100%" stopColor={PINK} stopOpacity="0.5" />
            </linearGradient>
          </defs>
          {yTicks.map(f => {
            const gy = yFor(f * niceMax);
            return (
              <g key={"y" + f}>
                <line x1={x0} y1={gy} x2={x1} y2={gy} stroke={T.bord} strokeWidth="1" strokeOpacity={f === 0 ? 0.9 : 0.35} />
                <text x={x0 - 8} y={gy} fill={T.text3} fontSize="11" textAnchor="end" dominantBaseline="middle">{kfmt(f * niceMax)}</text>
              </g>
            );
          })}
          {xTicks.map(i => (
            <text key={"x" + i} x={xFor(i)} y={y1 + 20} fill={T.text3} fontSize="11" textAnchor="middle">{monthLabel(i)}</text>
          ))}
          <path d={remainArea} fill={SLATE} opacity="0.85" />
          <path d={paidArea} fill="url(#debtPaidArea)" />
          <line x1={x0} y1={totalY} x2={x1} y2={totalY} stroke={T.text2} strokeWidth="2" strokeDasharray="5 4" />
          <path d={paidLine} fill="none" stroke={PINK} strokeWidth="2.5" strokeLinejoin="round" />
          {series.map(p => (
            <circle key={"d" + p.i} cx={xFor(p.i)} cy={yFor(p.paid)} r="4" fill={PINK} stroke={T.surf2} strokeWidth="1.5" />
          ))}
          {hi != null && (
            <g>
              <line x1={xFor(hi)} y1={y0} x2={xFor(hi)} y2={y1} stroke={T.text2} strokeWidth="1" strokeDasharray="3 3" strokeOpacity="0.6" />
              <circle cx={xFor(hi)} cy={yFor(series[hi].paid)} r="5.5" fill={PINK} stroke={T.surf} strokeWidth="2" />
              {(() => {
                const tw = 118, th = 52;
                const tx = Math.max(x0, Math.min(x1 - tw, xFor(hi) + 8));
                return (
                  <g>
                    <rect x={tx} y={y0 + 2} width={tw} height={th} rx="8" fill={T.bg} stroke={T.bord} strokeWidth="1" />
                    <text x={tx + 10} y={y0 + 17} fill={T.text3} fontSize="10">{monthLabel(hi)}</text>
                    <text x={tx + 10} y={y0 + 32} fill={PINK} fontSize="12" fontWeight="700">{fmt(Math.round(series[hi].paid))} paid</text>
                    <text x={tx + 10} y={y0 + 46} fill={T.text2} fontSize="11">{fmt(Math.round(series[hi].remaining))} left</text>
                  </g>
                );
              })()}
            </g>
          )}
          <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill="transparent"
            onMouseMove={e => {
              const r = e.currentTarget.getBoundingClientRect();
              const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
              setDebtChartHover(Math.round(frac * N));
            }}
            onMouseLeave={() => setDebtChartHover(null)} />
        </svg>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "18px", justifyContent: "center", marginTop: "16px" }}>
        {legendItem(PINK, "Paid Off", false)}
        {legendItem(T.text2, "Total debt (Last 12M)", true)}
        {legendItem(SLATE, "Remaining Debt", false)}
      </div>

      <div style={{ fontSize: "11px", color: T.text3, marginTop: "14px", lineHeight: 1.5 }}>
        Assumes a steady monthly payment across the window. Hover the line to see how much was paid off by any month.
      </div>
    </div>
  ), () => { setShowDebtInfo(false); setDebtChartHover(null); });
};

// Log Spend modal
const renderLogSpend = () => {
  // The stepper is only meaningful once a file is in play; before that this is
  // just the log-a-transaction form that happens to accept a CSV.
  const showSteps = csvRawRows.length > 0;
  const csvSteps = [["upload", "Upload"], ["map", "Map columns"], ["review", "Review"]];
  const csvStepIdx = csvSteps.findIndex(s => s[0] === csvStep);
  // A wrong column map or sign choice is only discoverable on the next step, so
  // completed steps stay reachable. Forward moves still go through the step's
  // own Continue button, which is what validates and re-parses.
  const gotoCsvStep = (target) => {
    const ti = csvSteps.findIndex(s => s[0] === target);
    if (ti === -1 || ti >= csvStepIdx) return;
    setCsvStep(target);
  };
  const discOpts = buckets.filter(b => DISC_IDS_EDIT.includes(b.id));
  const resOpts = buckets.filter(b => RESERVE_IDS_EDIT.includes(b.id));
  const mapPreview = csvStep === "map"
    ? parseCsvRows(csvRawRows, csvMapping, csvOutflow)
    : { out: [], skipped: 0, dupes: 0, autos: 0, refunds: 0 };
  const readyCount = csvReviewRows.filter(r => r.bucketId).length;
  const colSelect = (field, label) => (
    <div>
      <div style={{ ...cs.lbl, marginBottom: "4px" }}>{label}</div>
      <select value={csvMapping[field]} onChange={e => setCsvMapping(m => ({ ...m, [field]: parseInt(e.target.value, 10) }))}
        style={{ ...cs.inp, width: "100%", fontSize: "13px" }}>
        <option value={-1}>-- none --</option>
        {csvHeaders.map((h, i) => <option key={i} value={i}>{h || ("Column " + (i + 1))}</option>)}
      </select>
    </div>
  );
  // How many rows share each merchant, so a repeat is visible before the picker
  // quietly fills in its siblings.
  const merchantCounts = {};
  csvReviewRows.forEach(r => {
    const k = normalizeMerchant(r.description);
    if (k) merchantCounts[k] = (merchantCounts[k] || 0) + 1;
  });
  // Answering for one row answers for every other row from the same merchant
  // that is still blank. Rows already set by hand are left alone, so a
  // deliberate one-off never gets overwritten by a later sibling.
  const setRowBucket = (row, bucketId) => {
    const key = normalizeMerchant(row.description);
    setCsvReviewRows(rows => rows.map(x => {
      if (x.rowId === row.rowId) return { ...x, bucketId: bucketId || null };
      if (bucketId && !x.bucketId && key && normalizeMerchant(x.description) === key) return { ...x, bucketId };
      return x;
    }));
  };
  // Whole-file assignment, for the CSV that is one trip or one occasion.
  // Clearing is the same operation with an empty bucket, which doubles as the
  // undo for a bulk apply that went the wrong way.
  const applyBulk = (bucketId) => {
    setCsvReviewRows(rows => rows.map(r => ({ ...r, bucketId: bucketId === "__clear" ? null : bucketId })));
  };
  const txReady = !!txMerchant.trim() && !isNaN(parseFloat(txAmount)) && parseFloat(txAmount) > 0 && !!txReserve;
  const bucketPicker = (row) => (
    <select value={row.bucketId || ""} onChange={e => setRowBucket(row, e.target.value)}
      style={{ ...cs.inp, fontSize: "12px", padding: "5px 6px", minWidth: 0, width: "100%" }}>
      <option value="">Categorize...</option>
      <optgroup label="Discretionary">{discOpts.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}</optgroup>
      <optgroup label="Reserves">{resOpts.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}</optgroup>
    </select>
  );
  const csvStepper = (
    <div style={{ padding: "16px 20px 0", display: "flex", alignItems: "center", flexShrink: 0 }}>
      {csvSteps.map(([id, label], i) => {
        const done = i < csvStepIdx;
        const cur = i === csvStepIdx;
        const tint = cur ? T.blue : done ? T.green : T.bord;
        return (
          <div key={id} style={{ display: "flex", alignItems: "center", flex: i < csvSteps.length - 1 ? 1 : "0 0 auto", minWidth: 0 }}>
            <div onClick={() => gotoCsvStep(id)} title={done ? "Back to " + label : undefined}
              style={{ display: "flex", alignItems: "center", gap: "7px", flexShrink: 0, cursor: done ? "pointer" : "default" }}>
              <div style={{ width: "20px", height: "20px", borderRadius: "50%", border: "1px solid " + tint, background: cur ? T.blue : "transparent", color: cur ? T.bg : tint, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: "700", flexShrink: 0 }}>
                {done ? <span className="material-symbols-outlined" style={{ fontSize: "13px" }}>check</span> : i + 1}
              </div>
              <span style={{ fontSize: "11px", letterSpacing: "0.08em", textTransform: "uppercase", whiteSpace: "nowrap", color: cur ? T.text1 : done ? T.text2 : T.text3, fontWeight: cur ? "700" : "400" }}>{label}</span>
            </div>
            {i < csvSteps.length - 1 && (
              <div style={{ flex: 1, height: "1px", minWidth: "12px", margin: "0 10px", background: i < csvStepIdx ? T.green : T.bord }} />
            )}
          </div>
        );
      })}
    </div>
  );
  return (
  <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px 16px" }}
    onClick={e => { if (e.target === e.currentTarget) closeLogSpend(); }}
    onDragOver={e => e.preventDefault()}
    onDrop={e => { e.preventDefault(); if (e.dataTransfer.files[0]) handleCsvFile(e.dataTransfer.files[0]); }}>
    <div style={{ background: T.surf, borderRadius: "8px", width: "100%", maxWidth: csvStep === "review" ? "1040px" : csvStep === "map" ? "840px" : "640px", maxHeight: "90vh", minHeight: csvStep === "upload" ? "0" : "560px", overflowY: "auto", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "16px 20px", borderBottom: "1px solid " + T.bord, display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
        <span style={{ fontSize: "13px", fontWeight: "700", color: T.text1, letterSpacing: "0.05em" }}>{csvStep === "upload" ? "Log Spending" : "Import Spending (CSV)"}</span>
        <button onClick={closeLogSpend} style={{ background: "none", border: "none", color: T.text3, cursor: "pointer", display: "flex", alignItems: "center" }}>
          <span className="material-symbols-outlined" style={{ fontSize: "22px" }}>close</span>
        </button>
      </div>

      {showSteps && csvStepper}

      {csvStep === "upload" && (<>
      <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "12px" }}>
        <div>
          <div style={{ ...cs.lbl, marginBottom: "4px" }}>Bucket</div>
          <select value={txReserve} onChange={e => setTxReserve(e.target.value)} style={{ ...cs.inp, width: "100%", fontSize: "14px" }}>
            <optgroup label="Discretionary">{discOpts.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}</optgroup>
            <optgroup label="Reserves">{resOpts.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}</optgroup>
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

        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "2px" }}>
          <div style={{ flex: 1, height: "1px", background: T.bord }} />
          <span style={{ fontSize: "10px", letterSpacing: "0.1em", textTransform: "uppercase", color: T.text3, whiteSpace: "nowrap" }}>or import a batch</span>
          <div style={{ flex: 1, height: "1px", background: T.bord }} />
        </div>
        <label
          onDragOver={e => { e.preventDefault(); setCsvDragOver(true); }}
          onDragLeave={() => setCsvDragOver(false)}
          onDrop={e => { e.preventDefault(); setCsvDragOver(false); if (e.dataTransfer.files[0]) handleCsvFile(e.dataTransfer.files[0]); }}
          style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "6px", padding: "20px", border: `2px dashed ${csvDragOver ? T.blue : T.bord}`, borderRadius: "8px", cursor: "pointer", background: csvDragOver ? T.blue + "11" : T.bg, textAlign: "center" }}>
          <span className="material-symbols-outlined" style={{ fontSize: "26px", color: T.text3 }}>upload_file</span>
          <span style={{ fontSize: "13px", fontWeight: "700", color: T.text1 }}>Drop a .csv here or tap to choose</span>
          <span style={{ fontSize: "11px", color: T.text3, lineHeight: "1.5" }}>Export from your bank or credit card. We read Date, Description and Amount, and ask about any column we cannot guess.</span>
          <input type="file" accept=".csv,text/csv" style={{ display: "none" }}
            onChange={e => { if (e.target.files[0]) handleCsvFile(e.target.files[0]); e.target.value = ""; }} />
        </label>
        {csvRawRows.length > 0 && (
          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <div style={{ flex: 1, fontSize: "12px", color: T.text3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {csvFileName} - {csvRawRows.length} row{csvRawRows.length !== 1 ? "s" : ""} loaded
            </div>
            <button onClick={() => setCsvStep("map")}
              style={{ flex: "0 0 auto", background: T.blue, border: "none", color: T.bg, padding: "10px 18px", borderRadius: "4px", fontSize: "13px", fontWeight: "700", cursor: "pointer", fontFamily: "DM Mono, monospace", letterSpacing: "0.08em" }}>
              Continue
            </button>
          </div>
        )}
      </div>
      <div style={{ padding: "4px 20px 20px", borderTop: "1px solid " + T.bord, flexShrink: 0 }}>
        <button onClick={addTransaction} disabled={!txReady}
          style={{ width: "100%", background: txReady ? T.blue : T.bord, border: "none", color: T.bg, padding: "12px", borderRadius: "4px", fontSize: "13px", fontWeight: "700", cursor: txReady ? "pointer" : "default", fontFamily: "DM Mono, monospace", letterSpacing: "0.08em" }}>
          + Add Transaction
        </button>
      </div>
      </>)}

      {csvStep === "map" && (<>
      <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "14px" }}>
        <div style={{ fontSize: "12px", color: T.text3 }}>{csvFileName} - map the columns we could not guess.</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
          {colSelect("date", "Date")}
          {colSelect("description", "Description")}
          {colSelect("amount", "Amount (one signed column)")}
          <div />
          {colSelect("debit", "Debit / money out (optional)")}
          {colSelect("credit", "Credit / money in (optional)")}
        </div>
        <div style={{ fontSize: "11px", color: T.text3, lineHeight: "1.6" }}>
          Use Amount when one column carries both directions and the sign tells them apart. Use Debit / Credit only when your file has separate columns for money out and money in.
        </div>
        {csvMapping.debit === -1 && (
          <div>
            <div style={{ ...cs.lbl, marginBottom: "4px" }}>In the Amount column, money spent is shown as</div>
            <div style={{ background: T.bg, borderRadius: "4px", padding: "3px", display: "flex" }}>
              {[["negative", "Negative (-45.00)"], ["positive", "Positive (45.00)"]].map(([val, label]) => (
                <div key={val} onClick={() => setCsvOutflow(val)}
                  style={{ flex: 1, padding: "6px 0", textAlign: "center", cursor: "pointer", borderRadius: "4px", fontSize: "12px", background: csvOutflow === val ? T.blue : "transparent", color: csvOutflow === val ? T.bg : T.text2, fontWeight: csvOutflow === val ? "700" : "400" }}>
                  {label}
                </div>
              ))}
            </div>
          </div>
        )}
        <div style={{ border: "1px solid " + T.bord, borderRadius: "6px", overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: "11px", width: "100%" }}>
            <thead><tr>{csvHeaders.map((h, i) => <th key={i} style={{ textAlign: "left", padding: "6px 8px", color: T.text3, borderBottom: "1px solid " + T.bord, whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
            <tbody>{csvRawRows.slice(0, 3).map((r, ri) => <tr key={ri}>{csvHeaders.map((h, ci) => <td key={ci} style={{ padding: "6px 8px", color: T.text2, borderBottom: ri < 2 ? "1px solid " + T.bord : "none", whiteSpace: "nowrap" }}>{r[ci]}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </div>
      <div style={{ padding: "0 20px 12px", flexShrink: 0 }}>
        <div style={{ padding: "10px 12px", background: T.bg, borderRadius: "6px" }}>
          <div style={{ fontSize: "11px", letterSpacing: "0.08em", textTransform: "uppercase", color: T.text3, marginBottom: "6px" }}>With these columns</div>
          {mapPreview.out.length === 0
            ? <div style={{ fontSize: "12px", color: T.red }}>Nothing would import. Check the column choices and which sign means money out.</div>
            : (<>
              <div style={{ fontSize: "12px", color: T.text2, marginBottom: "6px" }}>
                <span style={{ color: T.text1, fontWeight: "700" }}>{mapPreview.out.length}</span> will import
                {mapPreview.skipped > 0 && <span> - {mapPreview.skipped} skipped as money in or blank</span>}
                {mapPreview.dupes > 0 && <span> - {mapPreview.dupes} already imported</span>}
              </div>
              {mapPreview.out.slice(0, 3).map(r => (
                <div key={r.rowId} style={{ display: "flex", gap: "10px", fontSize: "11px", color: T.text3, padding: "2px 0" }}>
                  <span style={{ flex: "0 0 78px" }}>{r.date}</span>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.description || "(no description)"}</span>
                  <span style={{ flex: "0 0 auto", color: T.text2 }}>{r.amount.toFixed(2)}</span>
                </div>
              ))}
            </>)
          }
        </div>
      </div>
      <div style={{ padding: "4px 20px 20px", borderTop: "1px solid " + T.bord, display: "flex", gap: "10px", flexShrink: 0 }}>
        <button onClick={() => setCsvStep("upload")} style={{ flex: "0 0 auto", background: "transparent", border: "1px solid " + T.bord, color: T.text2, padding: "12px 16px", borderRadius: "4px", fontSize: "13px", fontWeight: "700", cursor: "pointer", fontFamily: "DM Mono, monospace" }}>Back</button>
        <button disabled={csvMapping.date === -1 || (csvMapping.amount === -1 && csvMapping.debit === -1)}
          onClick={() => { applyMapping(csvRawRows, csvMapping, csvOutflow); setCsvStep("review"); }}
          style={{ flex: "0 0 auto", marginLeft: "auto", minWidth: "170px", background: (csvMapping.date === -1 || (csvMapping.amount === -1 && csvMapping.debit === -1)) ? T.bord : T.blue, border: "none", color: T.bg, padding: "12px 20px", borderRadius: "4px", fontSize: "13px", fontWeight: "700", cursor: "pointer", fontFamily: "DM Mono, monospace", letterSpacing: "0.08em" }}>
          Continue
        </button>
      </div>
      </>)}

      {csvStep === "review" && (<>
      <div style={{ padding: "14px 20px 4px", flexShrink: 0 }}>
        <div style={{ fontSize: "12px", color: T.text2 }}>
          <span style={{ color: T.text1, fontWeight: "700" }}>{csvReviewRows.length}</span> to review
          {csvDupes > 0 && <span> - {csvDupes} duplicate{csvDupes !== 1 ? "s" : ""} skipped</span>}
          {csvRefunds > 0 && <span> - {csvRefunds} credit{csvRefunds !== 1 ? "s" : ""}</span>}
          {csvSkipped > 0 && <span> - {csvSkipped} blank or unreadable skipped</span>}
        </div>
        {csvAutos > 0 && (
          <div style={{ fontSize: "11px", color: T.green, marginTop: "3px" }}>
            {csvAutos} pre-categorized from merchant memory - change any that look wrong.
          </div>
        )}
        <div style={{ fontSize: "11px", color: T.text3, marginTop: "3px" }}>Categorizing a row also fills any other blank row from the same merchant. Rows left uncategorized are discarded when you close.</div>
        {csvRefunds > 0 && (
          <div style={{ fontSize: "11px", color: T.green, marginTop: "3px" }}>
            Credits are shown negative and reduce whichever bucket you assign them to. Leave money that is not a refund uncategorized.
          </div>
        )}
        {csvReviewRows.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", marginTop: "10px", padding: "10px 12px", background: T.bg, borderRadius: "6px" }}>
            <span style={{ fontSize: "11px", letterSpacing: "0.08em", textTransform: "uppercase", color: T.text3, whiteSpace: "nowrap" }}>Set all rows to</span>
            <select value="" onChange={e => { if (e.target.value) applyBulk(e.target.value); }}
              style={{ ...cs.inp, fontSize: "12px", padding: "6px 8px", flex: 1, minWidth: "160px" }}>
              <option value="">Choose a bucket...</option>
              <optgroup label="Discretionary">{discOpts.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}</optgroup>
              <optgroup label="Reserves">{resOpts.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}</optgroup>
              <option value="__clear">-- clear existing entries --</option>
            </select>
          </div>
        )}
      </div>
      <div style={{ padding: "8px 0", overflowY: "auto", flex: 1 }}>
        {csvReviewRows.length === 0
          ? <div style={{ padding: "24px 20px", textAlign: "center", fontSize: "12px", color: T.text3, lineHeight: "1.6" }}>
              No new spending rows found in this file.<br />
              Go Back to check the column mapping and which sign means money out.
            </div>
          : csvReviewRows.map((row, i) => (
            <div key={row.rowId} style={{ display: "grid", gridTemplateColumns: "78px 1fr 84px 130px 34px 28px", gap: "8px", alignItems: "center", padding: "8px 20px", background: i % 2 === 1 ? T.bg : "transparent" }}>
              <div style={{ fontSize: "11px", color: T.text3 }}>{row.date}</div>
              <div style={{ fontSize: "12px", color: T.text1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {row.description || "(no description)"}
                {merchantCounts[normalizeMerchant(row.description)] > 1 && (
                  <span style={{ marginLeft: "6px", fontSize: "10px", color: T.text3 }}>x{merchantCounts[normalizeMerchant(row.description)]}</span>
                )}
                {row.amount < 0 && (
                  <span style={{ marginLeft: "6px", fontSize: "10px", letterSpacing: "0.08em", color: T.green }}>CREDIT</span>
                )}
              </div>
              <input type="number" value={row.amount}
                onChange={e => setCsvReviewRows(rows => rows.map(x => x.rowId === row.rowId ? { ...x, amount: parseFloat(e.target.value) || 0 } : x))}
                style={{ ...cs.inp, fontSize: "12px", padding: "5px 6px", width: "100%", minWidth: 0, textAlign: "right", color: row.amount < 0 ? T.green : T.text1 }} />
              {bucketPicker(row)}
              {/* Fixed-width slot so the chip appearing never shifts the picker. */}
              <div style={{ fontSize: "10px", letterSpacing: "0.08em", textAlign: "center", color: T.green }}>
                {row.auto && row.bucketId === row.suggestedId ? "auto" : ""}
              </div>
              <button onClick={() => setCsvReviewRows(rows => rows.filter(x => x.rowId !== row.rowId))}
                style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>close</span>
              </button>
            </div>
          ))
        }
      </div>
      <div style={{ padding: "10px 20px 20px", borderTop: "1px solid " + T.bord, display: "flex", gap: "10px", flexShrink: 0 }}>
        <button onClick={() => setCsvStep("map")} style={{ flex: "0 0 auto", background: "transparent", border: "1px solid " + T.bord, color: T.text2, padding: "12px 16px", borderRadius: "4px", fontSize: "13px", fontWeight: "700", cursor: "pointer", fontFamily: "DM Mono, monospace" }}>Back</button>
        <button onClick={closeLogSpend} style={{ flex: "0 0 auto", background: "transparent", border: "1px solid " + T.bord, color: T.text2, padding: "12px 16px", borderRadius: "4px", fontSize: "13px", fontWeight: "700", cursor: "pointer", fontFamily: "DM Mono, monospace" }}>Cancel</button>
        <button disabled={readyCount === 0} onClick={commitCsv}
          style={{ flex: "0 0 auto", marginLeft: "auto", minWidth: "200px", background: readyCount === 0 ? T.bord : T.blue, border: "none", color: T.bg, padding: "12px 20px", borderRadius: "4px", fontSize: "13px", fontWeight: "700", cursor: readyCount === 0 ? "default" : "pointer", fontFamily: "DM Mono, monospace", letterSpacing: "0.08em" }}>
          Import {readyCount} transaction{readyCount !== 1 ? "s" : ""}
        </button>
      </div>
      </>)}
    </div>
  </div>
  );
};

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
            style={{ background: "transparent", border: "1px dashed " + T.bord, color: T.muted, padding: "6px 12px", borderRadius: "4px", fontSize: "12px", cursor: "pointer", width: "100%", fontFamily: "DM Mono, monospace", display: "flex", alignItems: "center", justifyContent: "center", gap: "4px", marginTop: "2px" }}>
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
        <div key={d.id} style={{ background: T.bg, border: "1px solid " + T.bord, borderRadius: "8px", padding: "12px 14px", marginBottom: "10px" }}>
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
        style={{ background: "transparent", border: "1px dashed " + T.bord, color: T.text3, padding: "10px 16px", borderRadius: "4px", fontSize: "12px", cursor: "pointer", width: "100%", fontFamily: "DM Mono, monospace", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
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
          <div key={i} style={{ background: T.bg, border: "1px solid " + T.bord, borderRadius: "8px", padding: "12px 14px", marginBottom: "10px" }}>
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
              <div style={{ display: "flex", background: T.surf, borderRadius: "4px", padding: "3px" }}>
                {FREQ_OPTS.map(function(opt) {
                  var isActive = inc.frequency === opt.value;
                  return (
                    <div key={opt.value}
                      onClick={function() { setEditIncomes(function(p) { return p.map(function(x, j) { return j === i ? Object.assign({}, x, { frequency: opt.value }) : x; }); }); }}
                      style={{ flex: 1, padding: "6px 4px", textAlign: "center", cursor: "pointer", borderRadius: "4px", fontSize: "12px", textTransform: "uppercase", background: isActive ? T.blue : "transparent", color: isActive ? T.bg : T.text3, fontWeight: isActive ? "700" : "400" }}>
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
          style={{ background: "transparent", border: "1px dashed " + T.bord, color: T.text3, padding: "10px 16px", borderRadius: "4px", fontSize: "12px", cursor: "pointer", width: "100%", fontFamily: "DM Mono, monospace", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
          <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>add</span>Add income stream
        </button>
      )}
    </div>
  ));
};

// Floating edit button used in each tab
const renderEditBtn = (panel) => (
  <button onClick={() => openEditModal(panel)}
    style={{ display: "flex", alignItems: "center", gap: "5px", background: T.surf, border: "1px solid " + T.bord, color: T.text3, padding: "5px 12px", borderRadius: "4px", fontSize: "12px", fontWeight: "700", cursor: "pointer", fontFamily: "DM Mono, monospace", letterSpacing: "0.05em", marginBottom: "14px" }}>
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
<style>{`.budget-tabs::-webkit-scrollbar { display: none; } .material-symbols-outlined { font-family: 'Material Symbols Outlined'; font-weight: normal; font-style: normal; font-size: 24px; display: inline-block; line-height: 1; text-transform: none; letter-spacing: normal; word-wrap: normal; white-space: nowrap; direction: ltr; } input[type="date"] { text-align: left; } input[type="date"]::-webkit-date-and-time-value { text-align: left; }`}</style>
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
<button onClick={() => setSearch("")} style={{ background: "none", border: "1px solid " + T.bord, color: T.text2, padding: "7px 12px", borderRadius: "4px", cursor: "pointer", fontSize: "16px", flexShrink: 0, whiteSpace: "nowrap" }}></button>
)}
<button onClick={() => { resetCsv(); setEditModal("logspend"); }}
  style={{ background: T.bg, border: "1px solid " + T.blue, color: T.blue, padding: "7px 14px", borderRadius: "4px", fontSize: "12px", cursor: "pointer", fontFamily: "DM Mono, monospace", letterSpacing: "0.08em", display: "flex", alignItems: "center", gap: "6px", flexShrink: 0, whiteSpace: "nowrap" }}>
  <span className="material-symbols-outlined" style={{ fontSize: "16px", color: T.blue }}>add_circle</span>
  Log Spend
</button>
{/* Assistant lives in the action row, not the tab bar: it reads across every
    bucket rather than being one more slice of the budget, and opening it as a
    sheet keeps whichever tab you were reading underneath. */}
<button onClick={() => setAgentOpen(true)}
  style={{ background: T.bg, border: "1px solid " + T.blue, color: T.blue, padding: "7px 14px", borderRadius: "4px", fontSize: "12px", cursor: "pointer", fontFamily: "DM Mono, monospace", letterSpacing: "0.08em", display: "flex", alignItems: "center", gap: "6px", flexShrink: 0, whiteSpace: "nowrap" }}>
  <span className="material-symbols-outlined" style={{ fontSize: "16px", color: T.blue }}>auto_awesome</span>
  Ask
</button>
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
<div key={i} style={{ background: T.surf, border: `1px solid ${r.color}33`, borderRadius: "8px", padding: "12px 16px", marginBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
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
      const discPct = Math.max(0, Math.min(100, discBudget > 0 ? (discSpent / discBudget) * 100 : 0));
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

      const fixedBillItems = ((buckets.find(b => b.id === "bills") && buckets.find(b => b.id === "bills").items) || []).filter(i => i.amt > 0);
      const fixedCommitted = Math.round(fixedBillItems.filter(i => i.note !== "cc").reduce((s, i) => s + i.amt, 0) * 100) / 100;
      const fixedPaidCount = fixedBillItems.filter(i => i.day && i.day <= today.getDate()).length;

      const reservesTotal = RESERVE_IDS_LIST.reduce((s,id) => { const b = buckets.find(x => x.id === id); return s + (b ? b.amount : 0); }, 0);
      const linkedBillIds = new Set(debts.filter(d => d.linkedType === "fixed" && d.linkedBucketId).map(d => d.linkedBucketId));
      const linkedDiscIds = new Set(debts.filter(d => d.linkedType === "discretionary" && d.linkedBucketId).map(d => d.linkedBucketId));
      const fixedFlowTotal = Math.round(fixedBillItems.filter(i => i.note !== "cc" && !linkedBillIds.has(i.id)).reduce((s, i) => s + i.amt, 0) * 100) / 100;
      const discFlowTotal = discBuckets.filter(b => !linkedDiscIds.has(b.id)).reduce((s, b) => s + b.amount, 0);
      const debtPaymentTotal = Math.round((fixedBillItems.filter(i => i.note !== "cc" && linkedBillIds.has(i.id)).reduce((s, i) => s + i.amt, 0) + discBuckets.filter(b => linkedDiscIds.has(b.id)).reduce((s, b) => s + b.amount, 0)) * 100) / 100;
      const leftover = Math.max(0, totalIncomeCfg - fixedFlowTotal - discFlowTotal - reservesTotal - debtPaymentTotal);
      const treeDenom = totalIncomeCfg > 0 ? totalIncomeCfg : 1;

      const kpiLbl = { fontSize: "12px", color: T.text3, letterSpacing: "0.12em", textTransform: "uppercase" };
      const kpiAmt = { fontSize: "21px", fontWeight: "700", lineHeight: 1 };
      const kpiSub = { fontSize: "12px", color: T.text1, marginTop: "4px" };
      const kpiCard = { flex: "1 0 0", marginBottom: 0, padding: "12px 14px", boxSizing: "border-box" };

      const isB = OVERVIEW_LAYOUT === "B";

      const incomeCard = (
        <Card style={{ ...kpiCard, minWidth: "340px", cursor: "pointer", display: "flex", flexDirection: isB ? "column" : "row", alignItems: isB ? "stretch" : "flex-start", gap: "12px", padding: "12px", ...(isB ? { minHeight: "115px" } : {}) }} onClick={() => setShowFlowInfo(true)}>
          <div style={{ flexShrink: 0, minWidth: "90px" }}>
            <div style={kpiLbl}>Monthly Income</div>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "stretch", minWidth: "140px", alignSelf: "stretch" }}>
            {(() => {
              const flowItems = [
                { label: "Fixed", value: fixedFlowTotal, color: "#4A9EFF" },
                { label: "Disc", value: discFlowTotal, color: "#FFB347" },
                { label: "Reserves", value: reservesTotal, color: "#C084FC" },
                { label: "Debt", value: debtPaymentTotal, color: "#FF6B9D" },
                { label: "Unallocated", value: leftover, color: T.text3 },
              ].filter(item => item.value > 0);

              if (flowItems.length === 0) return <div style={{ color: T.text2 }}>No allocation data</div>;

              const svgHeight = isB ? 80 : 45;
              const svgWidth = isB ? 260 : 200;
              const miniNodes = [{ id: "Income" }].concat(flowItems.map(f => ({ id: f.label })));
              const miniLinks = flowItems.map(f => ({ source: "Income", target: f.label, value: f.value }));
              const miniColorMap = { Income: "#7ED4A0" };
              flowItems.forEach(f => { miniColorMap[f.label] = f.color; });

              const miniLayout = d3Sankey()
                .nodeId(d => d.id)
                .nodeWidth(isB ? 14 : 10)
                .nodePadding(3)
                .extent([[4, 0], [svgWidth - 4, svgHeight]])
                ({ nodes: miniNodes.map(d => ({ ...d })), links: miniLinks.map(d => ({ ...d })) });

              // The Income "node" is rendered as an HTML block (below) so its amount label
              // stays a real, fixed pixel size. Collapse its SVG node to the left edge so
              // the flow links originate flush against that block, and re-center it
              // vertically (d3 skews it toward the largest flows) so the link fan shares
              // the block's vertical center.
              const incomeAmtStr = fmt(totalIncomeCfg);
              const incomeNode = miniLayout.nodes.find(n => n.id === "Income");
              if (incomeNode) {
                incomeNode.x0 = 0; incomeNode.x1 = 0;
                const dy = (svgHeight - (incomeNode.y1 - incomeNode.y0)) / 2 - incomeNode.y0;
                incomeNode.y0 += dy; incomeNode.y1 += dy;
                miniLayout.links.forEach(l => { if (l.source.id === "Income") l.y0 += dy; });
              }

              const miniLinkPath = sankeyLinkHorizontal();

              return (
                <div style={{ position: "relative", width: "100%", flex: 1, minHeight: svgHeight + "px", display: "flex", alignItems: "stretch", gap: "6px" }}>
                  <div style={{ background: miniColorMap.Income, borderRadius: "1px", flexShrink: 0, alignSelf: "center", height: "90%", display: "flex", alignItems: "center", justifyContent: "center", padding: isB ? "0 14px" : "0 8px", minWidth: isB ? "70px" : "48px" }}>
                    <div style={{ ...(isB ? kpiAmt : { fontSize: "12px", fontWeight: "700", lineHeight: 1 }), color: T.bg, whiteSpace: "nowrap" }}>{incomeAmtStr}</div>
                  </div>
                  <svg viewBox={"0 0 " + svgWidth + " " + svgHeight} preserveAspectRatio="none" style={{ flex: 1, minWidth: 0, height: "100%", cursor: "pointer" }}>
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
                    {miniLayout.nodes.filter(node => node.id !== "Income").map(node => {
                      const h = node.y1 - node.y0;
                      const w = node.x1 - node.x0;
                      const isHovered = moneyFlowHovered === node.id;
                      return (
                        <rect
                          key={node.id}
                          x={node.x0}
                          y={node.y0}
                          width={w}
                          height={h}
                          rx={1}
                          fill={miniColorMap[node.id]}
                          opacity={isHovered ? 0.95 : 0.9}
                          style={{ transition: "opacity 0.2s" }}
                          onMouseEnter={() => {
                            setMoneyFlowHovered(node.id);
                            setMoneyFlowTooltip({ x: node.x1 + 8, y: node.y0 - 4, label: node.id, value: flowItems.find(f => f.label === node.id)?.value || 0 });
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
      );

      // Compact discretionary card (uses the sizing formerly on Debt Paid) - sits in the first row.
      const discCard = (
        <Card border={over ? T.red : T.bord} style={{ ...kpiCard, minWidth: "280px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <div style={kpiLbl}>Discretionary Budget Used</div>
            <span style={{ fontSize: "12px", color: T.text2 }}>{Math.round(discPct)}%</span>
          </div>
          <div style={{ background: T.bord, borderRadius: "2px", height: "8px", marginBottom: "10px" }}>
            <div style={{ height: "100%", width: discPct + "%", background: over ? T.red : T.green, borderRadius: "2px" }} />
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
      );

      // Debt Paid card (uses the taller sizing formerly on Discretionary) - pairs with Monthly Income.
      const debtCard = debts.length > 0 ? (() => {
        const monthsElapsed = (year - setupYear) * 12 + (month - setupMonth) + 1;
        const dw = buildDebtWindow(debts, monthsElapsed);
        const PINK = "#FF6B9D", SLATE = "#3D4657";
        const w = 160, h = 66;
        const niceMax = (dw.startTotal || 1) * 1.1;
        const xF = (i) => (i / dw.N) * w;
        const yF = (v) => h - (v / niceMax) * h;
        const paidPts = dw.series.map(p => xF(p.i).toFixed(1) + " " + yF(p.paid).toFixed(1));
        const paidArea = "M 0 " + h + " L " + paidPts.join(" L ") + " L " + w + " " + h + " Z";
        const paidLine = "M " + paidPts.join(" L ");
        const totalY = yF(dw.startTotal);
        const remainArea = "M 0 " + totalY.toFixed(1) + " L " + w + " " + totalY.toFixed(1) + " L " + paidPts.slice().reverse().join(" L ") + " Z";
        return (
          <Card style={{ marginBottom: 0, padding: "14px 16px", minWidth: "340px", cursor: "pointer", ...(isB ? { flex: "1 0 0", minHeight: "115px", display: "flex", flexDirection: "column" } : {}) }} onClick={() => setShowDebtInfo(true)}>
            <div style={{ ...kpiLbl, marginBottom: "8px", whiteSpace: "nowrap" }}>Debt Paid (Last 12M)</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "stretch", gap: "14px", ...(isB ? { flex: 1 } : {}) }}>
              <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", flexShrink: 0 }}>
                <div style={{ ...kpiAmt, color: PINK }}>{dw.paidPct}% paid</div>
                <div style={{ ...kpiSub, whiteSpace: "nowrap" }}>{fmt(dw.C)} outstanding</div>
              </div>
              <div style={{ flex: 1, minWidth: "110px", alignSelf: "stretch", display: "flex", minHeight: "56px" }}>
                <svg viewBox={"0 0 " + w + " " + h} preserveAspectRatio="none" style={{ width: "100%", height: "100%", display: "block" }}>
                  <path d={remainArea} fill={SLATE} opacity="0.85" />
                  <path d={paidArea} fill={PINK} opacity="0.85" />
                  <path d={paidLine} fill="none" stroke={PINK} strokeWidth="2" />
                  <line x1="0" y1={totalY} x2={w} y2={totalY} stroke={T.text2} strokeWidth="1.5" strokeDasharray="4 3" />
                </svg>
              </div>
            </div>
          </Card>
        );
      })() : null;

      return (
        <div style={{ marginBottom: "8px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "stretch", marginBottom: "8px" }}>

            <Card style={{ ...kpiCard, minWidth: "280px" }}>
              <div style={kpiLbl}>Fixed & Committed</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px", marginTop: "6px" }}>
                <div>
                  <div style={{ ...kpiAmt, color: "#B8A9FF" }}>{fmt(fixedCommitted)}</div>
                  <div style={{ ...kpiSub, whiteSpace: "nowrap" }}>autopays this month</div>
                </div>
                {fixedBillItems.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "4px", flexShrink: 0 }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "2px", width: "70px" }}>
                      {fixedBillItems.map(function(item, idx) {
                        return <div key={idx} style={{ width: "8px", height: "8px", borderRadius: "2px", background: item.day && item.day <= today.getDate() ? "#B8A9FF" : T.bord }} />;
                      })}
                    </div>
                    <div style={{ fontSize: "12px", color: T.text2 }}>{fixedPaidCount} of {fixedBillItems.length} paid</div>
                  </div>
                )}
              </div>
            </Card>

            <Card style={{ ...kpiCard, minWidth: "280px" }}>
              <div style={{ ...kpiLbl, whiteSpace: "nowrap" }}>{"Banked Since " + MONTHS[setupMonth] + " " + (setupYear - 2000)}</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "6px" }}>
                <div>
                  <div style={{ ...kpiAmt, color: T.green }}>{fmt(bankedYTD)}</div>
                  <div style={{ ...kpiSub, whiteSpace: "nowrap" }}>reserves + savings</div>
                </div>
                <span className="material-symbols-outlined" style={{ fontSize: "32px", color: T.green, flexShrink: 0, opacity: 0.8 }}>celebration</span>
              </div>
            </Card>

            {!isB && incomeCard}

            <Card border={isPayday ? T.green : T.bord} style={{ ...kpiCard, minWidth: "280px" }}>
              <div style={kpiLbl}>Payday</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "6px" }}>
                <div>
                  <div style={{ ...kpiAmt, color: isPayday ? T.green : "#FFB347" }}>{isPayday ? "Today" : daysUntilPayday + "d"}</div>
                  <div style={{ ...kpiSub, whiteSpace: "nowrap" }}>{isPayday ? fmt(totalIncomeCfg) + " incoming" : "Est. " + MONTHS[nextPayMonthIdx] + " " + ordinal(primaryPayday)}</div>
                </div>
                <span className="material-symbols-outlined" style={{ fontSize: "32px", color: isPayday ? T.green : "#FFB347", opacity: 0.6, flexShrink: 0 }}>calendar_clock</span>
              </div>
            </Card>

            {discCard}

          </div>

          {isB ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "stretch" }}>
              {incomeCard}
              {debtCard}
            </div>
          ) : debtCard}
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
              const pct = b.amount > 0 ? Math.max(0, Math.min(100, (spent / b.amount) * 100)) : 0;
              const remaining = b.amount - spent;
              const isOver = spent > b.amount;
              return (
                <Card key={b.id} style={{ flex: "1 0 0", minWidth: "160px", marginBottom: 0, padding: "12px 14px" }}>
                  <div style={{ fontSize: "12px", color: T.text3, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.label}</div>
                  <div style={{ fontSize: "15px", fontWeight: "700", color: b.color, marginBottom: "8px" }}>{fmt(b.amount)}</div>
                  <div style={{ background: T.bord, borderRadius: "2px", height: "5px", marginBottom: "6px" }}>
                    <div style={{ height: "100%", width: pct + "%", background: b.color, borderRadius: "2px" }} />
                  </div>
                  <div style={{ fontSize: "12px", color: isOver ? T.red : T.text2 }}>{isOver ? fmt(spent - b.amount) + " over" : fmt(remaining) + " left"}</div>
                </Card>
              );
            })}
          </div>
        </div>
      );
    })()}
    <div style={{ background: T.surf, border: "1px solid " + T.bord, borderRadius: "8px", padding: "12px 18px", marginBottom: "10px" }}>
      {(() => {
        const reserveIds = ["bill006","bill007","bill008","bill009","bill011","bill012","bill010"];
        const iconMap = {"bill008":"travel_luggage_and_bags","bill012":"health_and_beauty","bill006":"apparel","bill007":"featured_seasonal_and_gifts","bill009":"pets","bill011":"savings"};
        const reserves = buckets.filter(b => reserveIds.includes(b.id) && b.amount > 0);
        const total = reserves.reduce((s,b) => s + b.amount, 0);
        return (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}>
              <span style={{ ...cs.lbl, marginBottom: 0 }}>Reserves & Savings</span>
              <span style={{ fontSize: "12px", color: "#B8A9FF" }}>{fmt(total)}/mo earmarked</span>
            </div>
            {/* Stacked horizontal bar */}
            <div style={{ display: "flex", height: "24px", borderRadius: "4px", overflow: "hidden", marginBottom: "14px", gap: "2px" }}>
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

    <div style={{ background: T.surf, border: "1px solid " + T.bord, borderRadius: "8px", overflow: "hidden", marginBottom: "10px" }}>
      <div onClick={() => setShowRef(r => !r)} style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
        <span className="material-symbols-outlined" style={{ fontSize: "18px", color: T.text2 }}>{showRef ? "keyboard_arrow_up" : "keyboard_arrow_down"}</span>
        <span style={{ fontSize: "12px", fontWeight: "600", color: T.text2, letterSpacing: "0.1em", textTransform: "uppercase" }}>Budget Details</span>
      </div>
      {showRef && (() => {
        const linkedBillIds = new Set(debts.filter(d => d.linkedType === "fixed" && d.linkedBucketId).map(d => d.linkedBucketId));
        const linkedDiscIds = new Set(debts.filter(d => d.linkedType === "discretionary" && d.linkedBucketId).map(d => d.linkedBucketId));
        const refBillItems = ((buckets.find(b => b.id === "bills") && buckets.find(b => b.id === "bills").items) || []).filter(i => i.amt > 0 && i.note !== "cc");
        const refDiscBuckets = buckets.filter(b => ["bill001","bill002","bill003","bill004","bill005"].includes(b.id) && b.amount > 0);
        const refGroups = [
          { group: "Fixed", color: T.blue, items:
            refBillItems.filter(i => !linkedBillIds.has(i.id)).map(i => ({ label: i.name, amt: i.amt }))
          },
          { group: "Discretionary", color: "#FFB347", items:
            refDiscBuckets.filter(b => !linkedDiscIds.has(b.id)).map(b => ({ label: b.label, amt: b.amount }))
          },
          { group: "Reserves & Savings", color: "#B8A9FF", items:
            buckets.filter(b => ["bill006","bill007","bill008","bill009","bill011","bill012","bill010"].includes(b.id) && b.amount > 0).map(b => ({ label: b.label, amt: b.amount }))
          },
          { group: "Debt Repayment", color: "#FF6B9D", items:
            refBillItems.filter(i => linkedBillIds.has(i.id)).map(i => ({ label: i.name, amt: i.amt }))
              .concat(refDiscBuckets.filter(b => linkedDiscIds.has(b.id)).map(b => ({ label: b.label, amt: b.amount })))
          },
        ].filter(group => group.items.length > 0);
        const refTotal = refGroups.reduce((s, g) => s + g.items.reduce((t, i) => t + i.amt, 0), 0);
        const refUnallocated = Math.round((totalIncomeCfg - refTotal) * 100) / 100;
        return (
        <div style={{ borderTop: "1px solid " + T.bord, padding: "14px 18px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
            {refGroups.map(group => {
              const subtotal = group.items.reduce((s, i) => s + i.amt, 0);
              return (
                <div key={group.group} style={{ flex: "1 1 240px", display: "flex", flexDirection: "column", background: T.bg, border: "1px solid " + T.bord, borderRadius: "8px", overflow: "hidden" }}>
                  <div style={{ padding: "8px 12px", background: T.surf, borderBottom: "1px solid " + T.bord, fontSize: "12px", letterSpacing: "0.15em", color: T.text2, textTransform: "uppercase" }}>{group.group}</div>
                  {group.items.map(item => (
                    <div key={item.label} style={{ display: "flex", justifyContent: "space-between", gap: "8px", padding: "6px 12px", borderBottom: "1px solid " + T.bord }}>
                      <span style={{ fontSize: "12px", color: T.text3 }}>{item.label}</span>
                      <span style={{ fontSize: "12px", color: T.text3, whiteSpace: "nowrap" }}>{fmt(item.amt)}/mo</span>
                    </div>
                  ))}
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", padding: "8px 12px", marginTop: "auto" }}>
                    <span style={{ fontSize: "12px", color: T.text2 }}>Subtotal</span>
                    <span style={{ fontSize: "12px", color: group.color, whiteSpace: "nowrap" }}>{fmt(subtotal)}/mo</span>
                  </div>
                </div>
              );
            })}
          </div>
          {refUnallocated !== 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", paddingTop: "12px", marginTop: "12px", borderTop: "1px solid " + T.bord }}>
              <span style={{ fontSize: "12px", color: T.text3 }}>Unallocated</span>
              <span style={{ fontSize: "12px", color: T.text3 }}>{fmt(refUnallocated)}/mo</span>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", paddingTop: "12px", marginTop: refUnallocated !== 0 ? "8px" : "12px", borderTop: "1px solid " + T.bord }}>
            <span style={{ fontSize: "12px", fontWeight: "700", color: T.text1 }}>Total</span>
            <span style={{ fontSize: "12px", fontWeight: "700", color: T.blue }}>{fmt(refTotal)}/mo</span>
          </div>
        </div>
        );
      })()}
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
          <div style={{ background: T.surf, border: "1px solid " + T.bord, borderRadius: "8px", padding: "16px 18px", marginBottom: "10px" }}>
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
                        const spentPct = Math.max(0, Math.min(1, spent / b.amount));
                        const h = Math.max(8, Math.round(heightPct * (buckets.length * (barHeight + gap))));
                        return (
                          <div key={b.id} style={{ position: "relative", height: `${h}px`, background: "#2a3a50", borderRadius: "2px", overflow: "hidden" }}>
                            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: `${spentPct * 100}%`, background: over ? T.red : b.color, borderRadius: "2px", transition: "height 0.4s" }} />
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
            const pct = Math.max(0, Math.min(100, (spent / b.amount) * 100));
            const open = expanded === b.id;
            return (
              <div key={b.id} style={{ background: T.surf, border: `1px solid ${over ? T.red : open ? b.color+"55" : T.bord}`, borderRadius: "8px", marginBottom: "10px", overflow: "hidden" }}>
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
                  <div style={{ background: "#2a3a50", borderRadius: "2px", height: "5px" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: over ? T.red : b.color, borderRadius: "2px", transition: "width 0.4s" }} />
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
                        value={inputs[b.id] || (cur.spent[b.id] ? cur.spent[b.id] : "")}
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
                <div style={{ background: T.surf, border: "1px solid " + T.bord, borderRadius: "8px", overflow: "hidden", marginBottom: "16px" }}>
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
                    <div style={{ background: T.surf2, border: "1px solid #1a2030", borderRadius: "8px", overflow: "hidden", marginBottom: "16px" }}>
                      {paidItems.map((item, i) => renderItem(item, i, paidItems))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          <div style={{ ...cs.lbl, marginBottom: "12px" }}>Date Unknown</div>
          <div style={{ background: T.surf, border: "1px solid " + T.bord, borderRadius: "8px", overflow: "hidden" }}>
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
        <div style={{ display: "flex", alignItems: "center", gap: "24px", background: T.surf, border: "1px solid " + T.bord, borderRadius: "8px", padding: "20px 24px", marginBottom: "20px", flexWrap: "wrap" }}>
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
        const txs = transactions.filter(tx => tx.bucketId === r.id && tx.status !== "ignored" && txnInMonth(tx, year, month));
        const txTotal = txs.reduce((s, t) => s + t.amount, 0);
        const isOpen = expandedReserve === r.id;
        return (
          <div key={r.id} style={{ marginBottom: "10px" }}>
            <div onClick={() => setExpandedReserve(isOpen ? null : r.id)}
              style={{ background: r.bg, border: `1px solid ${isOpen ? r.color : r.color + "88"}`, borderRadius: isOpen ? "8px 8px 0 0" : "8px", padding: "16px 20px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
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
              <div style={{ background: T.surf2, border: `1px solid ${r.color}88`, borderTop: "none", borderRadius: "0 0 8px 8px", overflow: "hidden" }}>
                {txs.length === 0
                  ? <div style={{ padding: "14px 18px", fontSize: "12px", color: T.text2 }}>No transactions logged for {MONTHS[month]} {year}</div>
                  : txs.map((tx, i) => (
                    <div key={tx.id} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 18px", borderBottom: i < txs.length - 1 ? `1px solid ${r.color}22` : "none" }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: "13px", fontWeight: "600", color: T.text1 }}>{tx.merchant}</div>
                        <div style={{ fontSize: "12px", color: T.text2, marginTop: "2px" }}>{tx.date}</div>
                      </div>
                      <div style={{ fontSize: "13px", fontWeight: "700", color: r.color, marginRight: "8px" }}>-{fmt(tx.amount)}</div>
                      <select value={tx.bucketId || ""} onChange={e => reassignTransaction(tx.id, e.target.value || null)}
                        style={{ background: T.surf, border: `1px solid ${r.color}55`, color: T.text2, padding: "4px 8px", borderRadius: "4px", fontSize: "12px", cursor: "pointer", fontFamily: "DM Mono, monospace" }}>
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
          <div style={{ background: T.surf, border: "1px solid " + T.bord, borderRadius: "8px", padding: "20px 18px", marginBottom: "20px", display: "flex", alignItems: "center", gap: "12px" }}>
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
                              }} style={{ background: T.bg, border: "1px solid " + T.blue, color: T.blue, padding: "6px 14px", borderRadius: "4px", fontSize: "12px", fontWeight: "700", cursor: "pointer" }}>Save</button>
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
                              }} style={{ background: T.bg, border: "1px solid " + T.blue, color: T.blue, padding: "6px 14px", borderRadius: "4px", fontSize: "12px", fontWeight: "700", cursor: "pointer" }}>Save</button>
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
    <div style={{ background: T.surf, border: "1px solid " + T.bord, borderRadius: "8px", padding: "16px 18px", marginBottom: "10px" }}>
      <div style={{ fontSize: "13px", fontWeight: "700", color: T.text1, marginBottom: "4px" }}>Budget Setup</div>
      <div style={{ fontSize: "12px", color: T.text3, marginBottom: "14px" }}>Re-run the setup wizard. Your current budget will be pre-filled so you can adjust it.</div>
      <button onClick={onRerunWizard} style={{ background: "transparent", border: "1px solid " + T.blue, color: T.blue, padding: "8px 16px", borderRadius: "4px", fontSize: "12px", fontWeight: "700", cursor: "pointer", fontFamily: "DM Mono, monospace", display: "flex", alignItems: "center", gap: "6px" }}>
        <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>tune</span>
        Edit Budget Setup
      </button>
    </div>

    {/* Appearance */}
    <div style={{ background: T.surf, border: "1px solid " + T.bord, borderRadius: "8px", padding: "16px 18px", marginBottom: "10px" }}>
      <div style={{ fontSize: "13px", fontWeight: "700", color: T.text1, marginBottom: "4px" }}>Appearance</div>
      <div style={{ fontSize: "12px", color: T.text3, marginBottom: "14px" }}>Choose dark, light, or match your device setting.</div>
      <div style={{ display: "flex", gap: "0", border: "1px solid " + T.bord, borderRadius: "4px", overflow: "hidden" }}>
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
    <div style={{ background: T.surf, border: "1px solid " + T.bord, borderRadius: "8px", padding: "16px 18px", marginBottom: "10px" }}>
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
        row("Name", "Amount", "Due Day", "Category", "Note", "ID");
        var billsBucket = c?.buckets?.find(function(b) { return b.id === "bills"; }) ?? null;
        ((billsBucket && billsBucket.items) || []).forEach(function(item) {
          row(item.name, item.amt, item.day, item.category || "", item.note || "", item.id || "");
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
        loadTransactions().forEach(function(tx) {
          var lbl = monthLabelFromDate(tx.date);
          if (!lbl) return;
          row(lbl, tx.date || "", tx.merchant || "", tx.amount, tx.bucketId || "", "");
        });

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
      }} style={{ background: "transparent", border: "1px solid " + T.blue, color: T.blue, padding: "8px 12px", borderRadius: "4px", fontSize: "12px", fontWeight: "700", cursor: "pointer", fontFamily: "DM Mono, monospace", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", flex: 1, minHeight: "48px", textAlign: "center", flexWrap: "wrap" }}>
        <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>download</span>
        Export (CSV)
      </button>

      {/* Import CSV */}
      <label style={{ background: "transparent", border: "1px solid " + T.blue, color: T.blue, padding: "8px 12px", borderRadius: "4px", fontSize: "12px", fontWeight: "700", cursor: "pointer", fontFamily: "DM Mono, monospace", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", flex: 1, minHeight: "48px", textAlign: "center", flexWrap: "wrap" }}>
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
                  id: (r[5] || "").trim() || newBillId(),
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
              newDebts = resolveFixedDebtLinks(billItems, newDebts);

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
                  source: "csv", status: "confirmed",
                });
              });

              // Show the CSV Loaded card. Nothing is written yet -- on close the
              // pre-filled wizard opens and the data is applied only at Launch.
              setImportPreview({
                counts: { income: incomes.length, bills: billItems.length, disc: discBuckets.length, reserves: resBuckets.length, debts: newDebts.length },
                payload: { config: newCfg, debts: newDebts, data: newData },
              });

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
      <button onClick={() => { if (window.confirm("Clear all spend data? Your budget setup will be kept.")) { setData(getDefaultData()); setDebts([]); saveData(getDefaultData()); saveDebts([]); setTab("overview"); } }} style={{ background: "transparent", border: "1px solid " + T.red, color: T.red, padding: "8px 12px", borderRadius: "4px", fontSize: "12px", fontWeight: "700", cursor: "pointer", fontFamily: "DM Mono, monospace", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", flex: 1, minHeight: "48px", textAlign: "center", flexWrap: "wrap" }}>
        <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>delete_sweep</span>
        Clear Spend Data
      </button>
      <button onClick={() => { if (window.confirm("Reset everything? This will erase all your data and return to the setup screen.")) { onReset(); } }} style={{ background: "transparent", border: "1px solid " + T.red, color: T.red, padding: "8px 12px", borderRadius: "4px", fontSize: "12px", fontWeight: "700", cursor: "pointer", fontFamily: "DM Mono, monospace", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", flex: 1, minHeight: "48px", textAlign: "center", flexWrap: "wrap" }}>
        <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>delete_forever</span>
        Reset Everything
      </button>
      </div>
    </div>

    {/* AI Assistant */}
    <div style={{ background: T.surf, border: "1px solid " + T.bord, borderRadius: "8px", padding: "16px 18px", marginBottom: "10px" }}>
      <div style={{ fontSize: "13px", fontWeight: "700", color: T.text1, marginBottom: "4px" }}>AI Assistant</div>
      <div style={{ fontSize: "12px", color: T.text3, marginBottom: "14px", lineHeight: "1.5" }}>
        Optional, and coming soon. Connect an Anthropic API key now and the assistant will work the day it ships. Budget Control works fully without this.
      </div>

      {apiKey ? (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", background: T.greenBg, border: "1px solid " + T.greenBord, borderRadius: "4px", padding: "10px 12px", marginBottom: "12px" }}>
            <span className="material-symbols-outlined" style={{ fontSize: "18px", color: T.green }}>check_circle</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "12px", fontWeight: "700", color: T.text1 }}>Connected</div>
              <div style={{ fontSize: "12px", color: T.text3, wordBreak: "break-all" }}>{maskKey(apiKey)}</div>
            </div>
          </div>
          <button onClick={() => {
            if (window.confirm("Remove your API key? The assistant will stop working until you add it again.")) {
              clearApiKey(); setApiKey(""); setKeyInput(""); setKeyStatus("idle"); setKeyError("");
            }
          }} style={{ background: "transparent", border: "1px solid " + T.red, color: T.red, padding: "8px 16px", borderRadius: "4px", fontSize: "12px", fontWeight: "700", cursor: "pointer", fontFamily: "DM Mono, monospace", display: "flex", alignItems: "center", gap: "6px", minHeight: "44px" }}>
            <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>key_off</span>
            Remove Key
          </button>
        </div>
      ) : (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", background: T.bg, border: "1px solid " + T.bord, borderRadius: "4px", padding: "10px 12px", marginBottom: "12px" }}>
            <span className="material-symbols-outlined" style={{ fontSize: "18px", color: T.text3 }}>key_off</span>
            <div style={{ fontSize: "12px", color: T.text3 }}>No key connected</div>
          </div>
          <button onClick={() => { setKeyInput(""); setKeyStatus("idle"); setKeyError(""); setKeyModalOpen(true); }}
            style={{ background: "transparent", border: "1px solid " + T.blue, color: T.blue, padding: "8px 16px", borderRadius: "4px", fontSize: "12px", fontWeight: "700", cursor: "pointer", fontFamily: "DM Mono, monospace", display: "flex", alignItems: "center", gap: "6px", minHeight: "44px" }}>
            <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>vpn_key</span>
            Connect My AI Assistant
          </button>
        </div>
      )}
    </div>
  </div>
)}

{showFlowInfo && renderInfoModal("Money Flow", (
  (() => {
    // Self-contained so the modal does not depend on the Overview tab's locals.
    const bills = buckets.find(b => b.id === "bills");
    const linkedBillIds = new Set(debts.filter(d => d.linkedType === "fixed" && d.linkedBucketId).map(d => d.linkedBucketId));
    const linkedDiscIds = new Set(debts.filter(d => d.linkedType === "discretionary" && d.linkedBucketId).map(d => d.linkedBucketId));
    const allBillItems = ((bills && bills.items) || []).filter(i => i.amt > 0 && i.note !== "cc");
    const fixedBillItems = allBillItems.filter(i => !linkedBillIds.has(i.id));
    const fixedCommitted = Math.round(fixedBillItems.reduce((s, i) => s + i.amt, 0) * 100) / 100;
    const discIds = ["bill001","bill002","bill003","bill004","bill005"];
    const RESERVE_IDS_LIST = ["bill006","bill007","bill008","bill009","bill011","bill012","bill010"];
    const allDiscBuckets = buckets.filter(b => discIds.includes(b.id) && b.amount > 0);
    const discBudget = allDiscBuckets.filter(b => !linkedDiscIds.has(b.id)).reduce((s, b) => s + b.amount, 0);
    const reservesTotal = RESERVE_IDS_LIST.reduce((s, id) => { const b = buckets.find(x => x.id === id); return s + (b ? b.amount : 0); }, 0);
    const debtItems = allBillItems.filter(i => linkedBillIds.has(i.id)).map(i => ({ label: i.name, value: i.amt, color: "#FF6B9D" }))
      .concat(allDiscBuckets.filter(b => linkedDiscIds.has(b.id)).map(b => ({ label: b.label, value: b.amount, color: "#FF6B9D" })));
    const debtPaymentTotal = Math.round(debtItems.reduce((s, i) => s + i.value, 0) * 100) / 100;
    const rawLeftover = Math.round((totalIncomeCfg - fixedCommitted - discBudget - reservesTotal - debtPaymentTotal) * 100) / 100;
    const leftover = Math.max(0, rawLeftover);
    const total = totalIncomeCfg || 1;

    const categories = [
      { key: "fixed", label: "Fixed", value: fixedCommitted, color: T.blue, items: fixedBillItems.map(item => ({ label: item.name, value: item.amt, color: T.blue, group: item.category || "Other" })) },
      { key: "discretionary", label: "Discretionary", value: discBudget, color: "#FFB347", items: allDiscBuckets.filter(b => !linkedDiscIds.has(b.id)).map(b => ({ label: b.label, value: b.amount, color: b.color })) },
      { key: "reserves", label: "Reserves", value: reservesTotal, color: "#B8A9FF", items: buckets.filter(b => RESERVE_IDS_LIST.includes(b.id) && b.amount > 0).map(b => ({ label: b.label, value: b.amount, color: b.color })) },
    ].filter(group => group.value > 0);
    if (debtPaymentTotal > 0) {
      categories.push({ key: "debt", label: "Debt Repayment", value: debtPaymentTotal, color: "#FF6B9D", items: debtItems });
    }
    if (leftover > 0) {
      categories.push({ key: "leftover", label: "Unallocated", value: leftover, color: T.text3, items: [{ label: "Unallocated cash", value: leftover, color: T.text3 }] });
    }

    const sankeyNodes = [];
    const sankeyLinks = [];
    const meta = {}; // id -> { label, value, color }
    const addNode = (id, label, value, color) => { sankeyNodes.push({ id }); meta[id] = { label, value, color }; };

    addNode("Income", "Income", totalIncomeCfg, "#7ED4A0");
    categories.forEach(cat => {
      const catId = "cat-" + cat.key;
      addNode(catId, cat.label, cat.value, cat.color);
      sankeyLinks.push({ source: "Income", target: catId, value: cat.value });

      if (cat.key === "fixed" && cat.items.length > 0) {
        // Extra level: group fixed bills by their bill category (Housing, Utilities, ...).
        const order = [];
        const groups = {};
        cat.items.forEach(it => { const g = it.group || "Other"; if (!groups[g]) { groups[g] = []; order.push(g); } groups[g].push(it); });
        order.forEach((g, gi) => {
          const gItems = groups[g];
          const gVal = gItems.reduce((s, x) => s + x.value, 0);
          const subId = "sub-fixed-" + gi;
          addNode(subId, g, gVal, cat.color);
          sankeyLinks.push({ source: catId, target: subId, value: gVal });
          gItems.forEach((it, ii) => {
            const leafId = "leaf-fixed-" + gi + "-" + ii;
            addNode(leafId, it.label, it.value, it.color);
            sankeyLinks.push({ source: subId, target: leafId, value: it.value });
          });
        });
      } else {
        cat.items.forEach((it, ii) => {
          const leafId = "leaf-" + cat.key + "-" + ii;
          addNode(leafId, it.label, it.value, it.color);
          sankeyLinks.push({ source: catId, target: leafId, value: it.value });
        });
      }
    });
    const colorMap = {};
    Object.keys(meta).forEach(id => { colorMap[id] = meta[id].color; });

    const viewWidth = 760;
    const labelPad = 150; // room on the right so leaf labels are not clipped
    const leafCount = categories.reduce((s, c) => s + c.items.length, 0);
    const viewHeight = Math.max(300, leafCount * 32 + 60);
    const nodeWidth = 16;
    const nodePadding = 14;

    const layout = d3Sankey()
      .nodeId(d => d.id)
      .nodeWidth(nodeWidth)
      .nodePadding(nodePadding)
      .extent([[18, 24], [viewWidth - labelPad, viewHeight - 24]])
      ({ nodes: sankeyNodes.map(d => ({ ...d })), links: sankeyLinks.map(d => ({ ...d })) });

    const maxDepth = layout.nodes.reduce((m, n) => Math.max(m, n.depth), 0);
    const labelForId = (id) => (meta[id] && meta[id].label) || "";
    const valueForId = (id) => (meta[id] && meta[id].value) || 0;

    const linkPath = sankeyLinkHorizontal();
    const hoverLink = flowLinkHover != null ? layout.links[flowLinkHover] : null;
    const hoverEnds = hoverLink ? [hoverLink.source.id, hoverLink.target.id] : null;

    return (
      <div>
        <div style={{ marginBottom: "18px" }}>
          <div style={{ fontSize: "12px", color: T.text3, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: "6px" }}>Monthly Budget Flow</div>
          <div style={{ fontSize: "22px", fontWeight: "700", color: T.text1 }}>{fmt(totalIncomeCfg)}</div>
        </div>

        <div style={{ background: T.surf2, border: "1px solid " + T.bord, borderRadius: "8px", padding: "16px", overflowX: "auto" }}>
          <svg width={viewWidth} height={viewHeight} viewBox={`0 0 ${viewWidth} ${viewHeight}`} style={{ display: "block", maxWidth: "100%" }}>
            {layout.links.map((link, i) => (
              <path key={"link-" + i} d={linkPath(link)} fill="none" stroke={colorMap[link.source.id] || T.text3} strokeWidth={Math.max(4, link.width)}
                strokeOpacity={flowLinkHover != null ? (flowLinkHover === i ? 0.85 : 0.06) : 0.45}
                style={{ transition: "stroke-opacity 0.15s", cursor: "pointer" }}
                pointerEvents="stroke"
                onMouseEnter={() => setFlowLinkHover(i)}
                onMouseLeave={() => setFlowLinkHover(null)} />
            ))}
            {layout.nodes.map(node => {
              const label = labelForId(node.id);
              const val = valueForId(node.id);
              const h = node.y1 - node.y0;
              const col = colorMap[node.id] || T.text3;
              const isLeft = node.depth === 0;
              const isRight = node.depth === maxDepth;
              const dim = hoverEnds && hoverEnds.indexOf(node.id) === -1;
              return (
                <g key={node.id} style={{ opacity: dim ? 0.2 : 1, transition: "opacity 0.15s", pointerEvents: "none" }}>
                  <rect x={node.x0} y={node.y0} width={node.x1 - node.x0} height={h} rx={1} fill={col} opacity={0.85} />
                  {isLeft && h > 18 && (
                    <>
                      <text x={node.x0 + nodeWidth + 8} y={node.y0 + h / 2 - 7} fill={T.text1} fontSize="10" fontWeight="700" dominantBaseline="middle">{label}</text>
                      <text x={node.x0 + nodeWidth + 8} y={node.y0 + h / 2 + 9} fill={T.text1} fontSize="14" fontWeight="700" dominantBaseline="middle">{fmt(val)}</text>
                    </>
                  )}
                  {!isLeft && !isRight && h > 14 && (
                    <>
                      <text x={node.x0 + nodeWidth + 8} y={node.y0 + Math.min(16, h / 2)} fill={T.text1} fontSize="10" fontWeight="700">{label}</text>
                      {h > 30 && <text x={node.x0 + nodeWidth + 8} y={node.y0 + Math.min(32, h / 2 + 12)} fill={T.text1} fontSize="11" fontWeight="700">{fmt(val)}</text>}
                    </>
                  )}
                  {isRight && (
                    <text x={node.x1 + 6} y={node.y0 + h / 2} fill={T.text1} fontSize="9" fontWeight="700" textAnchor="start" dominantBaseline="middle">{label}</text>
                  )}
                </g>
              );
            })}
            {hoverLink && (() => {
              const val = hoverLink.value;
              const pct = Math.round((val / total) * 100);
              const flow = labelForId(hoverLink.source.id) + " -> " + labelForId(hoverLink.target.id);
              const tw = Math.max(160, flow.length * 6.6 + 24), th = 46;
              const midX = (hoverLink.source.x1 + hoverLink.target.x0) / 2;
              const midY = (hoverLink.y0 + hoverLink.y1) / 2;
              let tx = Math.max(4, Math.min(viewWidth - tw - 4, midX - tw / 2));
              let ty = midY - th - 8;
              if (ty < 4) ty = midY + 8;
              return (
                <g style={{ pointerEvents: "none" }}>
                  <rect x={tx} y={ty} width={tw} height={th} rx="8" fill={T.bg} stroke={T.bord} strokeWidth="1" />
                  <text x={tx + 12} y={ty + 18} fill={T.text1} fontSize="12" fontWeight="700">{flow}</text>
                  <text x={tx + 12} y={ty + 34} fill={T.text2} fontSize="11">{fmt(val)} ({pct}% of income)</text>
                </g>
              );
            })()}
          </svg>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "10px", marginTop: "16px" }}>
          {categories.map(cat => (
            <div key={cat.key} style={{ background: T.surf2, border: "1px solid " + T.bord, borderRadius: "8px", padding: "14px" }}>
              <div style={{ fontSize: "11px", color: cat.color, fontWeight: "700", marginBottom: "10px", textTransform: "uppercase" }}>{cat.label}</div>
              <div style={{ fontSize: "18px", fontWeight: "700", color: T.text1, marginBottom: "6px" }}>{fmt(cat.value)}</div>
              <div style={{ fontSize: "12px", color: T.text2 }}>{Math.round((cat.value / total) * 100)}% of income</div>
            </div>
          ))}
          {rawLeftover < 0 && (
            <div style={{ background: T.surf2, border: "1px solid " + T.bord, borderRadius: "8px", padding: "14px" }}>
              <div style={{ fontSize: "11px", color: T.text3, fontWeight: "700", marginBottom: "10px", textTransform: "uppercase" }}>Unallocated</div>
              <div style={{ fontSize: "18px", fontWeight: "700", color: T.text3, marginBottom: "6px" }}>{fmt(rawLeftover)}</div>
              <div style={{ fontSize: "12px", color: T.text2 }}>allocations exceed income</div>
            </div>
          )}
        </div>
      </div>
    );
  })()
))}
{showDebtInfo && renderDebtInfoModal()}
{editModal === "logspend"  && renderLogSpend()}
{editModal === "bills"     && renderEditBills()}
{editModal === "disc"      && renderEditDisc()}
{editModal === "reserves"  && renderEditReserves()}
{editModal === "debt"      && renderEditDebtModal()}
{editModal === "income"    && renderEditIncome()}
{agentOpen                 && renderAgentPanel()}
{keyModalOpen              && renderKeyModal()}
{importPreview && <ImportSummaryCard T={T} counts={importPreview.counts} onClose={() => { const p = importPreview.payload; setImportPreview(null); onImportCsv(p); }} />}
  </div>
</div>
  );
}