const fs = require("node:fs/promises");
const path = require("node:path");
const { createAdminClient, promoteAdmins } = require("./promote-admin");

function parseArguments(args) {
  let filePath;
  let mode;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--file") {
      if (filePath || !args[index + 1] || args[index + 1].startsWith("--")) {
        throw new Error("Provide exactly one path after --file.");
      }
      filePath = args[index + 1];
      index += 1;
    } else if (argument === "--dry-run" || argument === "--apply") {
      if (mode) throw new Error("Choose exactly one of --dry-run or --apply.");
      mode = argument;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!filePath || !mode) {
    throw new Error("Usage: npm run admin:promote:bulk -- --file <email-list.txt> --dry-run|--apply");
  }

  return { filePath, dryRun: mode === "--dry-run" };
}

async function readEmailList(filePath) {
  const contents = await fs.readFile(filePath, "utf8");
  return contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

async function main(args = process.argv.slice(2)) {
  const { filePath, dryRun } = parseArguments(args);
  const emails = await readEmailList(path.resolve(process.cwd(), filePath));
  const results = await promoteAdmins(createAdminClient(), emails, { dryRun });

  for (const { email, status } of results) {
    console.log(`${email}: ${status}`);
  }
  console.log(dryRun
    ? "Dry run complete; no administrator roles were changed."
    : "Bulk promotion complete. Sign out and back in to refresh each account's role.");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { main, parseArguments, readEmailList };
