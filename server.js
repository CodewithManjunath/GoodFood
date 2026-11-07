const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const PORT = Number(process.env.PORT || 3000);
const DIST_DIR = path.join(__dirname, "dist");
const MAX_API_BODY_BYTES = 16 * 1024;
const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};
let serviceClientPromise;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(value));
}

function sendMethodNotAllowed(response, allowed) {
  response.writeHead(405, { Allow: allowed });
  response.end();
}

async function readRequestBody(request, limit = MAX_API_BODY_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, "Request body is too large.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readJsonBody(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] || "")) {
    throw new HttpError(415, "Content-Type must be application/json.");
  }
  try {
    return JSON.parse(await readRequestBody(request));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

function parseMoneyToPaise(value) {
  if (typeof value !== "string") return null;
  const match = /^(0|[1-9]\d{0,8})(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return null;
  const paise = BigInt(match[1]) * 100n + BigInt((match[2] || "").padEnd(2, "0") || "0");
  return paise <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(paise) : null;
}

function parseDonationAmount(value) {
  const amountPaise = parseMoneyToPaise(value);
  return amountPaise !== null && amountPaise >= 100 ? amountPaise : null;
}

async function getServiceClient() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new HttpError(503, "Contribution storage is not configured on the server.");
  }
  if (!serviceClientPromise) {
    serviceClientPromise = import("@supabase/supabase-js").then(({ createClient }) =>
      createClient(url, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false }
      })
    );
  }
  return serviceClientPromise;
}

async function getAuthenticatedUser(request) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_PUBLISHABLE_KEY || !process.env.SUPABASE_JWKS_URL) {
    throw new HttpError(503, "Supabase server authentication is not configured.");
  }
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const apiRequest = new Request(url, { method: request.method, headers });
  const { createSupabaseContext } = await import("@supabase/server");
  const { data: context, error } = await createSupabaseContext(apiRequest, { auth: "user" });
  if (error || !context?.userClaims?.id) {
    throw new HttpError(401, "A valid GoodFood sign-in is required.");
  }
  return context.userClaims;
}

function getManualContributionConfig() {
  const instructions = process.env.GOODFOOD_MANUAL_PAYMENT_INSTRUCTIONS?.trim() || "";
  const isConfigured = Boolean(
    instructions
      && instructions.length <= 2000
      && process.env.SUPABASE_URL
      && process.env.SUPABASE_PUBLISHABLE_KEY
      && process.env.SUPABASE_JWKS_URL
      && process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  return { enabled: isConfigured, instructions: isConfigured ? instructions : "" };
}

function isPlatformAdmin(user) {
  return (user?.app_metadata || user?.appMetadata)?.role === "admin";
}

function normalizeReference(value) {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

async function submitManualContribution(request, response) {
  try {
    if (!getManualContributionConfig().enabled) {
      throw new HttpError(503, "Manual contributions are not configured on the server.");
    }
    const user = await getAuthenticatedUser(request);
    const body = await readJsonBody(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpError(400, "A contribution amount and transfer reference are required.");
    }
    const { amount, donorReference } = body;
    const amountPaise = parseDonationAmount(amount);
    if (amountPaise === null) {
      throw new HttpError(400, "Enter a donation amount of at least ₹1.00 with up to two decimal places.");
    }
    if (typeof donorReference !== "string") {
      throw new HttpError(400, "Enter the transfer reference shown by your payment app.");
    }
    const reference = donorReference.trim();
    if (!/^[\p{L}\p{N}][\p{L}\p{N} ./_-]{2,119}$/u.test(reference)) {
      throw new HttpError(400, "Enter a valid transfer reference (3–120 letters, numbers, spaces, or . / _ -).");
    }

    const client = await getServiceClient();
    const { data: profile, error: profileError } = await client.from("profiles")
      .select("id,role,is_suspended")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError) {
      console.error("Could not validate the money donor profile.", profileError);
      throw new HttpError(503, "GoodFood could not validate your account.");
    }
    if (!profile || !profile.role || profile.is_suspended) {
      throw new HttpError(403, "An active GoodFood account is required to donate.");
    }

    const orderId = `GF${crypto.randomBytes(12).toString("hex").toUpperCase()}`;
    const { data: contribution, error: insertError } = await client.from("money_donations")
      .insert({
        donor_id: user.id,
        order_id: orderId,
        amount_paise: amountPaise,
        currency: "INR",
        donor_reference: reference,
        status: "submitted"
      })
      .select("id,order_id,amount_paise,status,donor_reference,created_at")
      .single();
    if (insertError) {
      if (insertError.code === "23505") {
        throw new HttpError(409, "This transfer reference has already been submitted. Contact GoodFood support if you believe that is an error.");
      }
      console.error("Could not create the money donation record.", insertError);
      throw new HttpError(503, "Contribution records are not ready. Apply the GoodFood manual-contribution migration.");
    }
    return sendJson(response, 201, { contribution });
  } catch (error) {
    if (error instanceof HttpError) {
      return sendJson(response, error.status, { error: error.message });
    }
    console.error("Could not submit manual contribution.", error);
    return sendJson(response, 500, { error: "Could not submit the contribution for review." });
  }
}

async function reviewManualContribution(request, response) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!isPlatformAdmin(user)) {
      throw new HttpError(403, "Only a platform administrator can review contributions.");
    }
    const body = await readJsonBody(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpError(400, "A contribution decision is required.");
    }
    const { id, status, verifiedReference, verifiedAmount, reviewNote } = body;
    if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      throw new HttpError(400, "A valid contribution ID is required.");
    }
    if (!["paid", "rejected"].includes(status)) {
      throw new HttpError(400, "Choose whether the contribution is paid or rejected.");
    }
    if (typeof reviewNote !== "string" || reviewNote.trim().length < 5 || reviewNote.trim().length > 1000) {
      throw new HttpError(400, "Add a review note of 5–1000 characters for the audit record.");
    }
    let verified = null;
    let verifiedAmountPaise = null;
    if (status === "paid") {
      if (typeof verifiedReference !== "string" || !verifiedReference.trim()) {
        throw new HttpError(400, "Enter the reference verified against the bank statement.");
      }
      verified = verifiedReference.trim();
      if (!/^[\p{L}\p{N}][\p{L}\p{N} ./_-]{2,119}$/u.test(verified)) {
        throw new HttpError(400, "Enter a valid verified transfer reference.");
      }
      verifiedAmountPaise = parseDonationAmount(verifiedAmount);
      if (verifiedAmountPaise === null) {
        throw new HttpError(400, "Enter the amount shown in the bank statement.");
      }
    }

    const client = await getServiceClient();
    const { data: existing, error: readError } = await client.from("money_donations")
      .select("id,donor_reference,amount_paise")
      .eq("id", id)
      .eq("status", "submitted")
      .maybeSingle();
    if (readError) {
      console.error("Could not load the contribution for review.", readError);
      throw new HttpError(503, "Contribution records are temporarily unavailable.");
    }
    if (!existing) throw new HttpError(409, "This contribution is no longer awaiting review.");
    if (status === "paid" && normalizeReference(verified) !== normalizeReference(existing.donor_reference)) {
      throw new HttpError(400, "The bank-statement reference must match the donor's submitted reference.");
    }
    if (status === "paid" && verifiedAmountPaise !== existing.amount_paise) {
      throw new HttpError(400, "The amount from the bank statement must match the submitted contribution amount.");
    }

    const reviewedAt = new Date().toISOString();
    const { data: updated, error: updateError } = await client.from("money_donations")
      .update({
        status,
        verified_reference: verified,
        verified_amount_paise: verifiedAmountPaise,
        review_note: reviewNote.trim(),
        reviewer_id: user.id,
        reviewed_at: reviewedAt,
        paid_at: status === "paid" ? reviewedAt : null,
        updated_at: reviewedAt
      })
      .eq("id", id)
      .eq("status", "submitted")
      .select("id,order_id,status,amount_paise,donor_reference,verified_reference,verified_amount_paise,review_note,reviewed_at,paid_at")
      .maybeSingle();
    if (updateError) {
      console.error("Could not save the contribution review.", updateError);
      throw new HttpError(503, "The contribution review could not be saved.");
    }
    if (!updated) throw new HttpError(409, "This contribution was already reviewed.");
    return sendJson(response, 200, { contribution: updated });
  } catch (error) {
    if (error instanceof HttpError) {
      return sendJson(response, error.status, { error: error.message });
    }
    console.error("Could not review manual contribution.", error);
    return sendJson(response, 500, { error: "Could not save the contribution review." });
  }
}

async function handleApi(request, response, pathname) {
  if (pathname === "/healthz" && request.method === "GET") {
    return sendJson(response, 200, { status: "ok" });
  }

  if (pathname === "/api/auth/session" && request.method === "GET") {
    try {
      const user = await getAuthenticatedUser(request);
      return sendJson(response, 200, {
        user: {
          id: user.id,
          email: user.email || null,
          appRole: (user.app_metadata || user.appMetadata)?.role || null
        }
      });
    } catch (error) {
      return sendJson(response, error.status || 500, { error: error.message || "Could not validate the session." });
    }
  }

  if (pathname === "/api/contributions/manual/config" && request.method === "GET") {
    return sendJson(response, 200, getManualContributionConfig());
  }
  if (pathname === "/api/contributions/manual/submit") {
    if (request.method !== "POST") return sendMethodNotAllowed(response, "POST");
    return submitManualContribution(request, response);
  }
  if (pathname === "/api/contributions/manual/review") {
    if (request.method !== "POST") return sendMethodNotAllowed(response, "POST");
    return reviewManualContribution(request, response);
  }
  if (pathname === "/api/auth/session" && request.method !== "GET") {
    return sendMethodNotAllowed(response, "GET");
  }
  if (pathname === "/api/contributions/manual/config" && request.method !== "GET") {
    return sendMethodNotAllowed(response, "GET");
  }
  return sendJson(response, 404, { error: "API endpoint not found." });
}

async function serve(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (url.pathname === "/healthz") {
    if (request.method !== "GET") {
      response.writeHead(405, { Allow: "GET" });
      response.end();
      return;
    }
    await handleApi(request, response, url.pathname);
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    await handleApi(request, response, url.pathname);
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end();
    return;
  }

  const requestedPath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  const filePath = path.resolve(DIST_DIR, requestedPath || "index.html");
  if (!filePath.startsWith(`${DIST_DIR}${path.sep}`) && filePath !== path.join(DIST_DIR, "index.html")) {
    response.writeHead(400);
    response.end("Invalid path");
    return;
  }

  let content;
  let resolvedPath = filePath;
  try {
    content = await fs.readFile(resolvedPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    resolvedPath = path.join(DIST_DIR, "index.html");
    content = await fs.readFile(resolvedPath);
  }

  response.writeHead(200, {
    "Content-Type": CONTENT_TYPES[path.extname(resolvedPath)] || "application/octet-stream",
    "Cache-Control": path.basename(resolvedPath) === "index.html" ? "no-cache" : "public, max-age=3600",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self' https://*.supabase.co wss://*.supabase.co; frame-src https://*.supabase.co; img-src 'self' data: https://*.googleusercontent.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://*.supabase.co"
  });
  response.end(request.method === "HEAD" ? undefined : content);
}

async function startServer(port = PORT) {
  try {
    await fs.access(path.join(DIST_DIR, "index.html"));
  } catch {
    throw new Error("Production files not found. Run `npm run build` first.");
  }
  const server = http.createServer((request, response) => {
    serve(request, response).catch((error) => {
      console.error("Request failed:", error);
      if (!response.headersSent) response.writeHead(500);
      response.end("Internal server error");
    });
  });
  server.listen(port, () => {
    const address = server.address();
    console.log(`Goodfood is available at http://localhost:${address.port}`);
  });
  return server;
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error("Goodfood failed to start:", error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  startServer,
  parseDonationAmount,
  isPlatformAdmin,
  normalizeReference
};
