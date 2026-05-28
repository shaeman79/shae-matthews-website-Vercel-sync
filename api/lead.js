// Vercel serverless function: POST /api/lead
// Captures name+email+phone, pushes to Zoho CRM (Lead) and Zoho Campaigns (subscriber).
// Returns { ok: true, redirect: "/shae-matthews/thank-you-magnetic-man-call" }.
// Env vars (set on the Vercel project): ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET,
//   ZOHO_REFRESH_TOKEN, ZOHO_ACCOUNTS_DOMAIN, ZOHO_API_DOMAIN,
//   ZOHO_CAMPAIGNS_DOMAIN, ZOHO_CAMPAIGNS_LIST_KEY.

const ACCOUNTS_DOMAIN = process.env.ZOHO_ACCOUNTS_DOMAIN || "https://accounts.zoho.eu";
const API_DOMAIN = process.env.ZOHO_API_DOMAIN || "https://www.zohoapis.eu";
const CAMPAIGNS_DOMAIN = process.env.ZOHO_CAMPAIGNS_DOMAIN || "https://campaigns.zoho.eu";
const REDIRECT_URL = "/shae-matthews/thank-you-magnetic-man-call";

let cachedToken = null;
let cachedExpiresAt = 0;

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && cachedExpiresAt > now + 60_000) return cachedToken;
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    refresh_token: process.env.ZOHO_REFRESH_TOKEN,
  });
  const r = await fetch(`${ACCOUNTS_DOMAIN}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  if (!r.ok) throw new Error(`Zoho token refresh failed: ${r.status} ${await r.text()}`);
  const data = await r.json();
  if (!data.access_token) throw new Error("Zoho token refresh: no access_token");
  cachedToken = data.access_token;
  cachedExpiresAt = now + (data.expires_in || 3600) * 1000;
  return cachedToken;
}

async function pushToCRM(token, { name, email, phone, source }) {
  const parts = name.split(/\s+/);
  const firstName = parts[0] || name;
  const lastName = parts.slice(1).join(" ") || "(unknown)";
  const body = {
    data: [{
      First_Name: firstName,
      Last_Name: lastName,
      Email: email,
      Phone: phone,
      Lead_Source: source || "Homepage Popup",
      Description: `Captured from homepage booking popup at ${new Date().toISOString()}`,
    }],
    trigger: ["workflow"],
  };
  const r = await fetch(`${API_DOMAIN}/crm/v2/Leads`, {
    method: "POST",
    headers: { Authorization: `Zoho-oauthtoken ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`CRM Leads failed: ${r.status} ${text}`);
  return JSON.parse(text);
}

async function pushToCampaigns(token, { name, email }) {
  const listKey = process.env.ZOHO_CAMPAIGNS_LIST_KEY;
  if (!listKey) return { skipped: true };
  const contactInfo = encodeURIComponent(JSON.stringify({
    "Contact Email": email,
    "First Name": name.split(/\s+/)[0] || name,
    "Last Name": name.split(/\s+/).slice(1).join(" ") || "",
  }));
  const url = `${CAMPAIGNS_DOMAIN}/api/v1.1/json/listsubscribe?resfmt=JSON&listkey=${encodeURIComponent(listKey)}&contactinfo=${contactInfo}`;
  const r = await fetch(url, { method: "POST", headers: { Authorization: `Zoho-oauthtoken ${token}` } });
  const text = await r.text();
  if (!r.ok) throw new Error(`Campaigns listsubscribe failed: ${r.status} ${text}`);
  return JSON.parse(text);
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ ok: false, error: "Method not allowed" }); return; }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const name = (body.name || "").trim();
  const email = (body.email || "").trim();
  const phone = (body.phone || "").trim();
  const source = (body.source || "Homepage Popup").trim();

  if (!name || !email || !phone) { res.status(400).json({ ok: false, error: "Missing required fields" }); return; }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { res.status(400).json({ ok: false, error: "Invalid email" }); return; }

  let zohoError = null;
  try {
    const token = await getAccessToken();
    const [crm, camp] = await Promise.allSettled([
      pushToCRM(token, { name, email, phone, source }),
      pushToCampaigns(token, { name, email }),
    ]);
    if (crm.status === "rejected") { zohoError = "CRM: " + crm.reason.message; console.error("[lead] CRM:", crm.reason); }
    if (camp.status === "rejected") { console.error("[lead] Campaigns:", camp.reason); }
  } catch (e) {
    zohoError = e.message; console.error("[lead] token:", e);
  }
  // Always succeed for the user; lead errors are logged for review.
  res.status(200).json({ ok: true, redirect: REDIRECT_URL });
};
