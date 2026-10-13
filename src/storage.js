// localStorage load/save, the flat transaction ledger, and schema migrations.
import { MONTHS, newBillId } from "./constants.js";

// ------------
// localStorage helpers
// ------------
export function loadConfig() {
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
export function saveConfig(cfg) {
try { localStorage.setItem("budgetConfig", JSON.stringify({ ...cfg, version: SCHEMA_VERSION })); } catch(e) {}
}
export function loadData() {
try { const r = localStorage.getItem("budgetData"); return r ? JSON.parse(r) : null; } catch(e) { return null; }
}
export function saveData(d) {
try { localStorage.setItem("budgetData", JSON.stringify(d)); } catch(e) {}
}
export function loadDebts() {
try { const r = localStorage.getItem("budgetDebts"); return r ? JSON.parse(r) : null; } catch(e) { return null; }
}
export function saveDebts(d) {
try { localStorage.setItem("budgetDebts", JSON.stringify(d)); } catch(e) {}
}
// budgetTransactions: flat, top-level itemized ledger. spent[] stays the source
// of truth for all budget math; this store is the per-transaction record that
// import (CSV, screenshot) and manual Log Spend produce and the app displays.
export function loadTransactions() {
try { const r = localStorage.getItem("budgetTransactions"); return r ? JSON.parse(r) : []; } catch(e) { return []; }
}
export function saveTransactions(t) {
try { localStorage.setItem("budgetTransactions", JSON.stringify(t)); } catch(e) {}
}
export function newTxnId() {
return "txn_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
}
// Normalize any record (legacy per-month or new) into the canonical shape.
export function toTxnRecord(tx) {
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
export function foldLegacyTransactions() {
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
export function txnInMonth(tx, year, month) {
if (!tx.date || tx.date.length < 7) return false;
var y = parseInt(tx.date.slice(0, 4), 10);
var m = parseInt(tx.date.slice(5, 7), 10) - 1;
return y === year && m === month;
}
export function monthLabelFromDate(dateStr) {
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


export function getDefaultData() {
const now = new Date();
const startYear = now.getFullYear();
const r = {};
for (let y = startYear; y <= startYear + 5; y++)
for (let m = 0; m < 12; m++)
r[`${y}-${m}`] = { spent: {} };
return r;
}
