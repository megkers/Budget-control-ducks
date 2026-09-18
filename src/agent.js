// ------------
// Agent module
// ------------
// Everything that talks to the Anthropic API lives here. No JSX and no React:
// App.jsx owns all UI, this file owns the key, the client, and (later) the
// tool definitions and the tool loop.

// Models are picked per feature, not shared. The conversation has to reason
// across every bucket, so it gets the capable model. Verifying a key only needs
// a round trip that proves the key is real and has credit, so it uses the
// cheapest one. Screenshot reading will add a third constant here.
export const AGENT_MODEL = "claude-opus-5";
export const VERIFY_MODEL = "claude-haiku-4-5";

// ------------
// API key storage
// ------------
// Budget Control has no server, so there is nowhere to hide a shared key.
// Each user supplies their own. It is stored in localStorage on their device
// under budgetApiKey and is sent only to api.anthropic.com.
//
// Consequence worth remembering: any script on this page can read localStorage,
// so this app must never load a script from a third-party origin.
export function loadApiKey() {
  try { return localStorage.getItem("budgetApiKey") || ""; } catch(e) { return ""; }
}
export function saveApiKey(k) {
  try { localStorage.setItem("budgetApiKey", k); } catch(e) {}
}
export function clearApiKey() {
  try { localStorage.removeItem("budgetApiKey"); } catch(e) {}
}

// Cheap shape check so an obvious paste error fails before we spend a request.
export function looksLikeApiKey(k) {
  return typeof k === "string" && k.indexOf("sk-ant-") === 0 && k.length > 30;
}

// Never render a full key back to the screen.
export function maskKey(k) {
  if (!k) return "";
  return k.slice(0, 11) + "..." + k.slice(-4);
}

// Loaded on demand rather than imported at the top of the file. Most people
// never connect a key, and this keeps roughly 300kB of SDK out of the initial
// download for a PWA that has to start fast on a phone.
async function getClient(key) {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  return new Anthropic({
    apiKey: key,
    // Required to call the API from a browser. The usual reason this flag is
    // discouraged is that it leaks the developer's key to every visitor. That
    // does not apply here: the key belongs to the person who typed it, stays
    // on their device, and is billed to their own account.
    dangerouslyAllowBrowser: true,
  });
}

// Smallest possible round trip. Confirms the key is valid and has credit,
// for a fraction of a cent.
export async function verifyApiKey(key) {
  if (!looksLikeApiKey(key)) {
    return { ok: false, error: "That does not look like an Anthropic API key. Keys start with sk-ant-." };
  }
  try {
    const client = await getClient(key);
    await client.messages.create({
      model: VERIFY_MODEL,
      max_tokens: 4,
      messages: [{ role: "user", content: "Reply with OK." }],
    });
    return { ok: true, error: "" };
  } catch (e) {
    return { ok: false, error: describeApiError(e) };
  }
}

// SDK errors carry the raw JSON response body in .message. That is a debugging
// artifact, not a sentence, and it must never reach the screen. Pull the human
// part out of it when there is one.
function humanMessage(msg) {
  const m = msg.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (!m) return msg;
  try { return JSON.parse('"' + m[1] + '"'); } catch (e) { return m[1]; }
}

// Turn an SDK error into something a budgeting app user can act on.
export function describeApiError(e) {
  const status = e && e.status;
  const raw = (e && e.message) || "";
  const msg = humanMessage(raw);
  if (status === 401) return "Key rejected. Check that you copied the whole key.";
  if (status === 403) return "This key does not have permission to use the Messages API.";
  if (status === 400 && /credit|balance/i.test(raw)) {
    return "No credit available to this key. Check that your organization has a credit balance, and that the workspace this key belongs to is not capped by a spend limit.";
  }
  // An identity-linked key belongs to a person rather than a workspace, so
  // Anthropic cannot tell which workspace to bill. Asking a budgeting app user
  // for a workspace id would be a terrible question, so point them at the key
  // type that does not need one.
  if (/anthropic-workspace-id/i.test(raw)) {
    return "That key is linked to your identity rather than to a workspace, so Anthropic does not know which workspace to bill. In the Anthropic console, create a key scoped to a workspace and paste that one instead.";
  }
  if (status === 429) return "Rate limited by Anthropic. Wait a moment and try again.";
  if (status >= 500) return "Anthropic had a server error. Try again shortly.";
  // A request that never reached the API carries no status. That is the only
  // signal worth trusting here: the SDK does not set .name on these errors, and
  // checking the class name would work in dev and then break in production,
  // where the build minifies class names away.
  if (status === undefined) {
    if (/timed out/i.test(raw)) return "Anthropic did not respond in time. Try again.";
    if (/abort/i.test(raw)) return "That request was cancelled.";
    return "Could not reach Anthropic. Check your connection and try again.";
  }
  return msg || "Something went wrong.";
}

// ------------
// Screenshot import (issue #20)
// ------------
// Haiku for now. Reading a handful of rows off a cropped screenshot is closer
// to OCR than to reasoning, and this is the cheapest model that does it. Swap
// this one line to trade cost for accuracy; nothing else depends on the choice.
export const VISION_MODEL = "claude-haiku-4-5";

// Kept next to the model on purpose: these are Haiku's rates, so changing the
// model above without changing these would quietly make the cost shown to the
// user a lie. Dollars per million tokens.
const VISION_RATES = { input: 1.0, output: 5.0 };

// Claude resizes anything larger than this before reading it, so sending more
// pixels buys nothing and costs tokens. Note that image tokens are computed
// from dimensions, not file size, which is why the crop below encodes as PNG:
// it costs exactly what a JPEG of the same size would and keeps small text
// sharp instead of smearing the digits we are trying to read.
export const MAX_IMAGE_EDGE = 1568;

// Screenshots work best on a few rows. Above this we still import whatever was
// read, but say so. Tunable on purpose: calibrate once we have watched where
// read quality actually falls off, rather than guessing a rule into the UI.
export const SCREENSHOT_ROW_HINT = 8;

// Below this, a row is shown as needing a second look before it is committed.
// Rule matches score 0.7 and 0.9, so only the model's own doubt trips this.
export const LOW_CONFIDENCE = 0.6;

// Turn a crop rectangle over a loaded image into the payload the API takes.
// Downscaling belongs here rather than in the UI because the ceiling is a
// property of the API, not of the crop tool.
export function cropToBase64(img, rect) {
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(rect.w, rect.h));
  const w = Math.max(1, Math.round(rect.w * scale));
  const h = Math.max(1, Math.round(rect.h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, w, h);
  return { data: canvas.toDataURL("image/png").split(",")[1], mediaType: "image/png", width: w, height: h };
}

// Roughly what one extraction will cost, so the UI can say so before spending
// the user's money. Takes the crop at full size and applies the same ceiling
// cropToBase64 does, so the estimate tracks what will actually be sent rather
// than what was selected.
export function estimateCents(width, height) {
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(width, height));
  const imageTokens = (width * scale * height * scale) / 750;
  const inTokens = imageTokens + 900;
  const outTokens = 400;
  return ((inTokens / 1e6) * VISION_RATES.input + (outTokens / 1e6) * VISION_RATES.output) * 100;
}

// The model must answer in this shape or not at all, so a bad response fails as
// a schema error rather than as plausible-looking nonsense in someone's budget.
const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    transactions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          date: { type: "string", description: "Transaction date as YYYY-MM-DD" },
          amount: { type: "number", description: "Positive for money spent, negative for a refund or credit" },
          merchant: { type: "string", description: "Merchant or description exactly as printed" },
          bucketId: { type: ["string", "null"], description: "Best matching bucket id, or null if unsure" },
          confidence: { type: "number", description: "0 to 1, how legible and certain this row is" },
        },
        required: ["date", "amount", "merchant", "bucketId", "confidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["transactions"],
  additionalProperties: false,
};

// Read a cropped screenshot of a transaction list. One call, one image, bounded
// output: no loop, no retry, so a screenshot can never cost more than a
// screenshot. Returns { ok, rows, error } and never throws.
export async function extractTransactions(key, image, context) {
  const buckets = (context && context.buckets) || [];
  const examples = (context && context.examples) || [];
  const today = (context && context.today) || new Date().toISOString().slice(0, 10);

  const bucketList = buckets.map(b => "- " + b.id + ": " + b.label).join("\n");
  const exampleList = examples.length
    ? examples.map(e => "- " + e.description + " -> " + e.bucketId).join("\n")
    : "(none yet)";

  const system = [
    "You read transaction rows out of a screenshot of a bank or credit card statement.",
    "",
    "Today is " + today + ". Statement rows often omit the year; infer the most recent",
    "year that does not put the date in the future.",
    "",
    "Amounts are positive for money spent and negative for a refund or credit.",
    "",
    "Assign each row to one of these buckets, or null when nothing fits:",
    bucketList,
    "",
    "Bucket choices this person has already confirmed, as a guide to their habits:",
    exampleList,
    "",
    "Report a low confidence when a row is blurred, cut off, or ambiguous. Do not",
    "guess at a digit you cannot read: a wrong amount is worse than a flagged one.",
    "Only report rows you can actually see. Never invent a row to be helpful.",
  ].join("\n");

  try {
    const client = await getClient(key);
    const res = await client.messages.create({
      model: VISION_MODEL,
      max_tokens: 2048,
      system: system,
      output_config: { format: { type: "json_schema", schema: EXTRACT_SCHEMA } },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } },
          { type: "text", text: "Read every transaction row in this image." },
        ],
      }],
    });

    const text = (res.content || []).filter(b => b.type === "text").map(b => b.text).join("");
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      return { ok: false, rows: [], error: "Could not read that image. Try a tighter crop around just the transaction rows." };
    }
    const rows = (parsed && Array.isArray(parsed.transactions)) ? parsed.transactions : [];
    return { ok: true, rows: rows, error: "" };
  } catch (e) {
    return { ok: false, rows: [], error: describeApiError(e) };
  }
}
