const assert = require("node:assert/strict");
const { once } = require("node:events");
const test = require("node:test");
const { startServer } = require("../server.js");

test("production server exposes health and static routes, and restricts API methods", async (t) => {
  const configNames = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_JWKS_URL"];
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
  assert.match(await homepage.text(), /Goodfood/);

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
  assert.match(await legalStyles.text(), /\.legal-document/);

  const missingConfig = await fetch(`${baseUrl}/api/auth/session`);
  assert.equal(missingConfig.status, 503);
  assert.match((await missingConfig.json()).error, /not configured/i);

  const missingRoute = await fetch(`${baseUrl}/api/not-a-route`);
  assert.equal(missingRoute.status, 404);

  const unsupportedMethod = await fetch(`${baseUrl}/api/auth/session`, { method: "POST" });
  assert.equal(unsupportedMethod.status, 405);
});
