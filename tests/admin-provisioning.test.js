const test = require("node:test");
const assert = require("node:assert/strict");
const { findUserByEmail } = require("../scripts/promote-admin");

test("admin provisioning finds a confirmed account without exposing credentials", async () => {
  const expectedUser = { id: "user-1", email: "admin@example.com", email_confirmed_at: "2026-01-01" };
  const client = {
    auth: {
      admin: {
        async listUsers() {
          return { data: { users: [expectedUser] }, error: null };
        }
      }
    }
  };

  assert.equal(await findUserByEmail(client, "admin@example.com"), expectedUser);
});

test("admin provisioning returns no match when the account does not exist", async () => {
  const client = {
    auth: {
      admin: {
        async listUsers() {
          return { data: { users: [] }, error: null };
        }
      }
    }
  };

  assert.equal(await findUserByEmail(client, "missing@example.com"), null);
});

test("admin provisioning reports Supabase user-list errors", async () => {
  const client = {
    auth: {
      admin: {
        async listUsers() {
          return { data: null, error: { message: "request rejected" } };
        }
      }
    }
  };

  await assert.rejects(findUserByEmail(client, "admin@example.com"), /request rejected/);
});
