const test = require("node:test");
const assert = require("node:assert/strict");
const { findUserByEmail, promoteAdmins } = require("../scripts/promote-admin");
const { parseArguments } = require("../scripts/promote-admins");

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

test("bulk admin promotion validates all accounts before changing any role", async () => {
  let updateCount = 0;
  const client = {
    auth: {
      admin: {
        async listUsers() {
          return {
            data: {
              users: [
                { id: "user-1", email: "admin1@example.com", email_confirmed_at: "2026-01-01" }
              ]
            },
            error: null
          };
        },
        async updateUserById() {
          updateCount += 1;
          return { data: { user: { app_metadata: { role: "admin" } } }, error: null };
        }
      }
    }
  };

  await assert.rejects(
    promoteAdmins(client, ["admin1@example.com", "missing@example.com"]),
    /No GoodFood account was found/
  );
  assert.equal(updateCount, 0);
});

test("bulk admin promotion supports dry runs and duplicate emails", async () => {
  let updateCount = 0;
  const client = {
    auth: {
      admin: {
        async listUsers() {
          return {
            data: {
              users: [
                { id: "user-1", email: "admin1@example.com", email_confirmed_at: "2026-01-01" },
                { id: "user-2", email: "admin2@example.com", email_confirmed_at: "2026-01-01", app_metadata: { role: "admin" } }
              ]
            },
            error: null
          };
        },
        async updateUserById(id, attributes) {
          updateCount += 1;
          return {
            data: { user: { id, app_metadata: attributes.app_metadata } },
            error: null
          };
        }
      }
    }
  };

  const dryRun = await promoteAdmins(
    client,
    [" ADMIN1@example.com ", "admin1@example.com", "admin2@example.com"],
    { dryRun: true }
  );
  assert.deepEqual(dryRun, [
    { email: "admin1@example.com", status: "would-promote" },
    { email: "admin2@example.com", status: "already-admin" }
  ]);
  assert.equal(updateCount, 0);

  const applied = await promoteAdmins(client, ["admin1@example.com"]);
  assert.deepEqual(applied, [{ email: "admin1@example.com", status: "promoted" }]);
  assert.equal(updateCount, 1);
});

test("bulk admin promotion rejects unconfirmed accounts before changing any role", async () => {
  let updateCount = 0;
  const client = {
    auth: {
      admin: {
        async listUsers() {
          return {
            data: {
              users: [
                { id: "user-1", email: "admin1@example.com", email_confirmed_at: "2026-01-01" },
                { id: "user-2", email: "admin2@example.com" }
              ]
            },
            error: null
          };
        },
        async updateUserById() {
          updateCount += 1;
          return { data: { user: { app_metadata: { role: "admin" } } }, error: null };
        }
      }
    }
  };

  await assert.rejects(
    promoteAdmins(client, ["admin1@example.com", "admin2@example.com"]),
    /Confirm these account emails/
  );
  assert.equal(updateCount, 0);
});

test("bulk admin command requires an explicit dry-run or apply mode", () => {
  assert.deepEqual(
    parseArguments(["--file", "admins.txt", "--dry-run"]),
    { filePath: "admins.txt", dryRun: true }
  );
  assert.deepEqual(
    parseArguments(["--file", "admins.txt", "--apply"]),
    { filePath: "admins.txt", dryRun: false }
  );
  assert.throws(() => parseArguments(["--file", "admins.txt"]), /Usage:/);
  assert.throws(() => parseArguments(["--file", "admins.txt", "--dry-run", "--apply"]), /exactly one/);
});
