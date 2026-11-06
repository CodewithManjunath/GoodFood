# Goodfood

## Local setup

Requires Node.js 22 or newer and a Supabase project.

1. Copy `.env.example` to `.env.local`.
2. Set the browser values `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, plus backend values `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_JWKS_URL`. Never prefix a secret with `VITE_`.
3. In Supabase Authentication settings, enable Email and Google providers. Create a Google OAuth client and set its authorized redirect URI to `https://<your-project-ref>.supabase.co/auth/v1/callback` in Google Cloud; add the Google client ID and secret to the Supabase Google provider. Add `http://localhost:5173` and your deployed app URL to Supabase's site URL / allowed redirect URLs.
4. Run `npm install`, then `npm run dev`, and open the local Vite URL shown in the terminal.

For a production build, run `npm run build`, then `npm start`. The server loads `.env.local`, serves the generated `dist/` folder, and exposes `GET /api/auth/session` to verify a bearer token against Supabase Auth/JWKS. It returns only the authenticated user's ID, email, and server-assigned app role. Configure HTTPS and the matching Supabase redirect URLs for deployed sites.

The Supabase MCP server is configured for this workspace in `.vscode/mcp.json` (VS Code) and `.mcp.json` (Claude Code). In VS Code, open the MCP server controls and start **supabase**, then choose **Authenticate** to complete the browser-based OAuth flow. In Claude Code, run `claude /mcp` and authenticate the Supabase server. OAuth must be completed interactively by the signed-in user.

`SUPABASE_SECRET_KEY` is optional for this user-token verification endpoint and is not set in the provided local configuration because the value supplied was redacted. Add the actual secret only to a protected server environment if a future server-side operation needs elevated access. Never expose it to Vite or the browser.

## Database connection

`.env.example` includes the direct PostgreSQL connection URL format. Replace `[YOUR-PASSWORD]` in your local `.env.local` or deployment secret settings with the database password from Supabase; do not put it in source control or chat. Percent-encode reserved characters in the password before inserting it into the URL. If the password is rotated, update the secret environment value.

The connection URL is currently configuration only: the app does not open a PostgreSQL connection or persist donations and claims in the database yet. Configure it only in the server environment, never as a `VITE_` variable. The optional `npx skills add supabase/agent-skills` command is not needed to run the application.

## Accounts and roles

- Each NGO, food business, and individual donor signs up with a separate email/password or Google account.
- Supabase Auth manages registration, passwords, confirmation emails, provider sign-in, and session refresh.
- Public sign-up cannot grant Admin access. To assign an administrator, use the Supabase dashboard or trusted server-side tooling to set the user's `app_metadata.role` to `admin`. Never use editable `user_metadata` as an Admin permission.
- A new Google account completes its Goodfood account type and display name after Google sign-in.

## Prototype limitations

Supabase currently handles authentication only. Donation listings, requests, and impact figures are still demo data in browser storage and are not shared across users. Production use requires database tables, Supabase Row Level Security policies, and server-verified authorization for each donation and claim action. Do not rely on client-side roles as access control or use this prototype for real food handoffs yet.
