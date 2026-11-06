const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const PORT = Number(process.env.PORT || 3000);
const DIST_DIR = path.join(__dirname, "dist");
const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function sendJson(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(value));
}

async function handleApi(request, response, pathname) {
  if (pathname === "/healthz" && request.method === "GET") {
    return sendJson(response, 200, { status: "ok" });
  }

  if (pathname === "/api/auth/session" && request.method === "GET") {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_PUBLISHABLE_KEY || !process.env.SUPABASE_JWKS_URL) {
      return sendJson(response, 503, { error: "Supabase server authentication is not configured." });
    }

    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (value) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    const apiRequest = new Request(url, { method: "GET", headers });
    const { createSupabaseContext } = await import("@supabase/server");
    const { data: context, error } = await createSupabaseContext(apiRequest, { auth: "user" });
    if (error || !context?.userClaims) {
      return sendJson(response, 401, { error: "A valid Supabase user session is required." });
    }

    return sendJson(response, 200, {
      user: {
        id: context.userClaims.id,
        email: context.userClaims.email || null,
        appRole: context.userClaims.appMetadata?.role || null
      }
    });
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
    if (request.method !== "GET") {
      response.writeHead(405, { Allow: "GET" });
      response.end();
      return;
    }
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
    "Content-Security-Policy": "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self' https://*.supabase.co wss://*.supabase.co; img-src 'self' data: https://*.googleusercontent.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://*.supabase.co"
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

module.exports = { startServer };
