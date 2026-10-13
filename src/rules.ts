// Merchant memory rules and AI categorization merging.
import type { BucketId, MerchantRules, RuleMatch, ImportReviewRow } from "./types.js";
import type { Suggestion } from "./agent.js";

// ------------
// Merchant memory: rule-based auto-categorization
// ------------
// budgetRules maps a normalized merchant string to the bucket the user last
// chose for it: { pattern: { bucketId, count, updatedAt } }. Rules are learned
// on every confirmed spend (CSV import and manual log) and applied to new
// import rows, so repeat merchants arrive pre-categorized.
export function loadRules(): MerchantRules {
try { var r = localStorage.getItem("budgetRules"); return r ? JSON.parse(r) : {}; } catch(e) { return {}; }
}
export function saveRules(r: MerchantRules): void {
try { localStorage.setItem("budgetRules", JSON.stringify(r)); } catch(e) {}
}
// State/territory codes, used only to strip a trailing location off bank
// descriptions ("TRADER JOES OAKLAND CA" -> "TRADER JOES").
const MERCHANT_STATES: Record<string, number> = {
AL:1, AK:1, AZ:1, AR:1, CA:1, CO:1, CT:1, DE:1, DC:1, FL:1, GA:1, HI:1, ID:1,
IL:1, IN:1, IA:1, KS:1, KY:1, LA:1, ME:1, MD:1, MA:1, MI:1, MN:1, MS:1, MO:1,
MT:1, NE:1, NV:1, NH:1, NJ:1, NM:1, NY:1, NC:1, ND:1, OH:1, OK:1, OR:1, PA:1,
RI:1, SC:1, SD:1, TN:1, TX:1, UT:1, VT:1, VA:1, WA:1, WV:1, WI:1, WY:1, PR:1,
};
// Bank descriptions are noisy; normalization matters more than the matching
// algorithm. Uppercase, drop apostrophes, split on punctuation, then drop any
// token containing a digit (store numbers, dates, transaction ids) and a
// trailing "CITY ST" location.
export function normalizeMerchant(desc: string | null | undefined): string {
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
export function matchRule(rules: MerchantRules, desc: string): RuleMatch | null {
var key = normalizeMerchant(desc);
if (!key) return null;
if (rules[key]) return { bucketId: rules[key].bucketId, pattern: key, confidence: 0.9 };
var best: string | null = null;
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
export function upsertRule(rules: MerchantRules, desc: string, bucketId: BucketId | null): MerchantRules {
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
// AI categorization (issue #7)
// ------------
// Off by default: turning it on sends merchant descriptions from imports to
// Anthropic, which is this person's call to make, not the app's. Stored as its
// own key rather than inside budgetConfig so a config re-import never flips it.
export function loadAiCategorize(): boolean {
try { return localStorage.getItem("budgetAiCategorize") === "1"; } catch(e) { return false; }
}
export function saveAiCategorize(on: boolean): void {
try { if (on) localStorage.setItem("budgetAiCategorize", "1"); else localStorage.removeItem("budgetAiCategorize"); } catch(e) {}
}
// Fold the model's suggestions into review rows. Only a row that is still
// blank takes a suggestion: the user may have categorized rows by hand while
// the request was in flight, and their choice always wins. A suggestion for
// an unknown row, a bucket the picker does not offer, or with no usable
// confidence is dropped rather than guessed at. Returns { rows, filled }.
export function mergeAiSuggestions(rows: ImportReviewRow[], suggestions: Suggestion[] | null | undefined, validBucket: Record<BucketId, boolean>): { rows: ImportReviewRow[]; filled: number } {
var byId: Record<string, Suggestion> = {};
(suggestions || []).forEach(function(sg) {
if (sg && typeof sg.id === "string" && sg.bucketId && validBucket[sg.bucketId]) byId[sg.id] = sg;
});
var filled = 0;
var out = rows.map(function(r) {
if (r.bucketId) return r;
var sg = byId[r.rowId];
if (!sg) return r;
var conf = (typeof sg.confidence === "number" && isFinite(sg.confidence)) ? Math.max(0, Math.min(1, sg.confidence)) : null;
filled++;
return { ...r, bucketId: sg.bucketId, auto: true, ai: true, suggestedId: sg.bucketId, confidence: conf };
});
return { rows: out, filled: filled };
}
