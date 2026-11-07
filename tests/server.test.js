const assert = require("node:assert/strict");
const { once } = require("node:events");
const test = require("node:test");
const { startServer } = require("../server.js");

test("production server exposes health and static routes, and restricts API methods", async (t) => {
  const configNames = [
    "SUPABASE_URL",
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_JWKS_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "GOODFOOD_MANUAL_PAYMENT_INSTRUCTIONS"
  ];
  const savedConfig = new Map(configNames.map((name) => [name, process.env[name]]));
  configNames.forEach((name) => delete process.env[name]);

  const server = await startServer(0);
  await once(server, "listening");
  t.after(async () => {
    for (const [name, value] of savedConfig) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const health = await fetch(`${baseUrl}/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok" });

  const healthPost = await fetch(`${baseUrl}/healthz`, { method: "POST" });
  assert.equal(healthPost.status, 405);

  const homepage = await fetch(`${baseUrl}/`);
  assert.equal(homepage.status, 200);
  assert.match(homepage.headers.get("content-type"), /text\/html/);
  const homepageHtml = await homepage.text();
  assert.match(homepageHtml, /Goodfood/);
  assert.match(homepageHtml, /id="topbar-sign-out"/);

  const privacyPolicy = await fetch(`${baseUrl}/privacy.html`);
  assert.equal(privacyPolicy.status, 200);
  assert.match(privacyPolicy.headers.get("content-type"), /text\/html/);
  assert.match(await privacyPolicy.text(), /GoodFood Privacy Notice/);

  const terms = await fetch(`${baseUrl}/terms.html`);
  assert.equal(terms.status, 200);
  assert.match(terms.headers.get("content-type"), /text\/html/);
  assert.match(await terms.text(), /GoodFood Terms of Service/);

  const legalStyles = await fetch(`${baseUrl}/legal.css`);
  assert.equal(legalStyles.status, 200);
  assert.match(legalStyles.headers.get("content-type"), /text\/css/);
  const stylesheet = await legalStyles.text();
  assert.match(stylesheet, /\.legal-document/);

  const stylesPath = homepageHtml.match(/href="([^"]+\.css)"/)?.[1];
  assert.ok(stylesPath, "built stylesheet should be linked from the homepage");
  const appStyles = await fetch(new URL(stylesPath, baseUrl));
  assert.equal(appStyles.status, 200);
  assert.match(await appStyles.text(), /prefers-reduced-motion/);

  const missingConfig = await fetch(`${baseUrl}/api/auth/session`);
  assert.equal(missingConfig.status, 503);
  assert.match((await missingConfig.json()).error, /not configured/i);

  const manualConfig = await fetch(`${baseUrl}/api/contributions/manual/config`);
  assert.equal(manualConfig.status, 200);
  assert.deepEqual(await manualConfig.json(), { enabled: false, instructions: "" });

  const manualConfigPost = await fetch(`${baseUrl}/api/contributions/manual/config`, { method: "POST" });
  assert.equal(manualConfigPost.status, 405);

  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
  process.env.SUPABASE_JWKS_URL = "https://example.supabase.co/auth/v1/.well-known/jwks.json";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  process.env.GOODFOOD_MANUAL_PAYMENT_INSTRUCTIONS = "Official test UPI ID: test@example";
  const configuredManual = await fetch(`${baseUrl}/api/contributions/manual/config`);
  assert.equal(configuredManual.status, 200);
  assert.deepEqual(await configuredManual.json(), {
    enabled: true,
    instructions: "Official test UPI ID: test@example"
  });

  const submitMethod = await fetch(`${baseUrl}/api/contributions/manual/submit`);
  assert.equal(submitMethod.status, 405);
  const reviewMethod = await fetch(`${baseUrl}/api/contributions/manual/review`);
  assert.equal(reviewMethod.status, 405);
  const unauthenticatedSubmission = await fetch(`${baseUrl}/api/contributions/manual/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount: "10.00", donorReference: "TEST123" })
  });
  assert.equal(unauthenticatedSubmission.status, 401);
  const unauthenticatedReview = await fetch(`${baseUrl}/api/contributions/manual/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: "00000000-0000-4000-8000-000000000001",
      status: "paid",
      verifiedReference: "TEST123",
      verifiedAmount: "10.00",
      reviewNote: "Matched to statement."
    })
  });
  assert.equal(unauthenticatedReview.status, 401);

  const missingRoute = await fetch(`${baseUrl}/api/not-a-route`);
  assert.equal(missingRoute.status, 404);

  const unsupportedMethod = await fetch(`${baseUrl}/api/auth/session`, { method: "POST" });
  assert.equal(unsupportedMethod.status, 405);
});
