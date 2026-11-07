const { createClient } = require("@supabase/supabase-js");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERS_PER_PAGE = 1000;

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

async function promoteAdmin(email) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(normalizedEmail)) {
    throw new Error("Provide the email address of the existing GoodFood account.");
  }

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

module.exports = { findUserByEmail, promoteAdmin };
