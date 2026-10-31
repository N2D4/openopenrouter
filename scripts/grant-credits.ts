/**
 * Grant (or remove, with a negative amount) credits for a user, by email or Hexclave user ID.
 *
 *   pnpm admin:grant user@example.com 25 "Beta tester"
 *
 * Runs against the remote D1 database through wrangler, so it needs Cloudflare credentials.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const [who, usdRaw, note = "Admin grant"] = process.argv.slice(2);
const usd = Number(usdRaw);
if (!who || !Number.isFinite(usd) || usd === 0) {
  console.error('Usage: pnpm admin:grant <email-or-user-id> <usd> ["note"]');
  process.exit(1);
}
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const nano = Math.round(usd * 1e9);
const where = who.includes("@") ? `email = ${q(who)}` : `user_id = ${q(who)}`;
const id = `grant_${randomBytes(12).toString("hex")}`;
const sql = `
INSERT INTO credit_grants (id, user_id, amount_nano, source, note, created_at)
  SELECT ${q(id)}, user_id, ${nano}, 'admin', ${q(note)}, ${Date.now()} FROM accounts WHERE ${where};
UPDATE accounts SET credits_nano = credits_nano + ${nano} WHERE ${where};
SELECT user_id, email, credits_nano / 1e9 AS credits_usd, (credits_nano - usage_nano) / 1e9 AS balance_usd FROM accounts WHERE ${where};`;
const out = execFileSync("wrangler", ["d1", "execute", "openopenrouter", "--remote", "--json", "--command", sql], { encoding: "utf8" });
const rows = JSON.parse(out).at(-1)?.results ?? [];
if (!rows.length) {
  console.error(`No account found for ${who}. The user must sign in to the dashboard once first.`);
  process.exit(1);
}
console.table(rows);
