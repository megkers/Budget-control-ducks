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

// Turn an SDK error into something a budgeting app user can act on.
export function describeApiError(e) {
  const status = e && e.status;
  const msg = (e && e.message) || "";
  if (status === 401) return "Key rejected. Check that you copied the whole key.";
  if (status === 403) return "This key does not have permission to use the Messages API.";
  if (status === 400 && /credit|balance/i.test(msg)) {
    return "This key has no credit balance. Add credits in the Anthropic console, then try again.";
  }
  if (status === 429) return "Rate limited by Anthropic. Wait a moment and try again.";
  if (status >= 500) return "Anthropic had a server error. Try again shortly.";
  if (e && e.name === "APIConnectionError") return "Could not reach Anthropic. Check your connection.";
  return msg || "Something went wrong.";
}
