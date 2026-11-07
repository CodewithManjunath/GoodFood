const { createClient } = require("@supabase/supabase-js");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERS_PER_PAGE = 1000;

function normalizeAdminEmails(emails) {
  if (!Array.isArray(emails) || emails.length === 0) {
    throw new Error("Provide at least one confirmed account email address.");
  }

  const normalizedEmails = [...new Set(emails.map((email) => email.trim().toLowerCase()))];
  const invalidEmails = normalizedEmails.filter((email) => !EMAIL_PATTERN.test(email));
  if (invalidEmails.length) {
    throw new Error(`Invalid email address(es): ${invalidEmails.join(", ")}`);
  }
  return normalizedEmails;
}

async function findUserByEmail(client, email) {
  for (let page = 1; ; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({
      page,
      perPage: USERS_PER_PAGE
    });
    if (error) throw new Error(`Could not find the account: ${error.message}`);

    const users = data.users || [];
    const user = users.find((candidate) => candidate.email?.toLowerCase() === email);
    if (user) return user;
    if (users.length < USERS_PER_PAGE) return null;
  }
}

function createAdminClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the private server environment.");
  }
  if (process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SECRET_KEY) {
    throw new Error("Never expose Supabase admin keys through VITE_ variables.");
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  return client;
}

async function findUsersByEmail(client, emails) {
  const remainingEmails = new Set(emails);
  const usersByEmail = new Map();

  for (let page = 1; remainingEmails.size > 0; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({
      page,
      perPage: USERS_PER_PAGE
    });
    if (error) throw new Error(`Could not find the accounts: ${error.message}`);

    const users = data.users || [];
    for (const user of users) {
      const email = user.email?.toLowerCase();
      if (email && remainingEmails.has(email)) {
        usersByEmail.set(email, user);
        remainingEmails.delete(email);
      }
    }

    if (users.length < USERS_PER_PAGE) break;
  }

  return usersByEmail;
}

async function promoteAdmins(client, emails, { dryRun = false } = {}) {
  const normalizedEmails = normalizeAdminEmails(emails);
  const usersByEmail = await findUsersByEmail(client, normalizedEmails);
  const missingEmails = normalizedEmails.filter((email) => !usersByEmail.has(email));
  if (missingEmails.length) {
    throw new Error(`No GoodFood account was found for: ${missingEmails.join(", ")}`);
  }

  const unconfirmedEmails = normalizedEmails.filter((email) => !usersByEmail.get(email).email_confirmed_at);
  if (unconfirmedEmails.length) {
    throw new Error(`Confirm these account emails before granting administrator access: ${unconfirmedEmails.join(", ")}`);
  }

  const results = [];
  for (const email of normalizedEmails) {
    const user = usersByEmail.get(email);
    if (user.app_metadata?.role === "admin") {
      results.push({ email, status: "already-admin" });
      continue;
    }

    if (dryRun) {
      results.push({ email, status: "would-promote" });
      continue;
    }

    const { data, error } = await client.auth.admin.updateUserById(user.id, {
      app_metadata: { ...user.app_metadata, role: "admin" }
    });
    if (error) {
      const completed = results.filter((result) => result.status === "promoted").map((result) => result.email);
      throw new Error(`Promotion failed for ${email}; earlier successful promotions remain active (${completed.join(", ") || "none"}). ${error.message}`);
    }
    if (data.user?.app_metadata?.role !== "admin") {
      const completed = results.filter((result) => result.status === "promoted").map((result) => result.email);
      throw new Error(`Supabase did not confirm administrator access for ${email}; earlier successful promotions remain active (${completed.join(", ") || "none"}).`);
    }
    results.push({ email, status: "promoted" });
  }

  return results;
}

async function promoteAdmin(email) {
  const [normalizedEmail] = normalizeAdminEmails([email]);
  const client = createAdminClient();
  const user = await findUserByEmail(client, normalizedEmail);
  if (!user) throw new Error("No GoodFood account was found for that email.");
  if (!user.email_confirmed_at) {
    throw new Error("Confirm the account email before granting administrator access.");
  }
  if (user.app_metadata?.role === "admin") {
    console.log("This confirmed account already has administrator access.");
    return;
  }

  const { data, error } = await client.auth.admin.updateUserById(user.id, {
    app_metadata: { ...user.app_metadata, role: "admin" }
  });
  if (error) throw new Error(`Could not grant administrator access: ${error.message}`);
  if (data.user?.app_metadata?.role !== "admin") {
    throw new Error("Supabase did not confirm the administrator role update.");
  }

  console.log("Administrator access granted to the confirmed account.");
  console.log("Sign out of GoodFood and sign back in to refresh the account role.");
}

if (require.main === module) {
  const email = process.argv[2];
  if (!email) {
    console.error("Usage: npm run admin:promote -- <confirmed-account-email>");
    process.exitCode = 1;
  } else {
    promoteAdmin(email).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}

module.exports = {
  createAdminClient,
  findUserByEmail,
  findUsersByEmail,
  normalizeAdminEmails,
  promoteAdmin,
  promoteAdmins
};
