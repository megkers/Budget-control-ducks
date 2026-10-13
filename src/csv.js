// CSV parsing: our sectioned budget backup format and flat bank exports.

// ------------
// CSV parser - shared by welcome import and settings import
// ------------
export function parseCSVSections(text) {
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
export function parseFlatCSV(text) {
var lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter(function(l) { return l.trim().length > 0; });
if (lines.length === 0) return { headers: [], rows: [] };
var headers = csvSplitRow(lines[0]);
var rows = lines.slice(1).map(csvSplitRow);
return { headers: headers, rows: rows };
}
// Guess which columns hold date / amount / description / debit / credit from the
// header names. Returns indices (-1 when not found).
export function csvGuessMapping(headers) {
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
export function csvParseAmount(str) {
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
export function csvParseDate(str) {
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
export function csvRowHash(date, amount, desc) {
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
export function csvHeaderSignature(headers) {
return headers.map(function(h) { return (h || "").toLowerCase().trim(); }).join("|");
}
export function loadCsvMappings() {
try { var r = localStorage.getItem("budgetCsvMappings"); return r ? JSON.parse(r) : {}; } catch(e) { return {}; }
}
export function saveCsvMappings(m) {
try { localStorage.setItem("budgetCsvMappings", JSON.stringify(m)); } catch(e) {}
}
