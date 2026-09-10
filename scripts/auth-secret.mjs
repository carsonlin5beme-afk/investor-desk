import {
  existsSync,
  readFileSync,
  appendFileSync,
  copyFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
export function ensureLocalAuthSecret() {
  if (process.env.BETTER_AUTH_SECRET) return;
  if (!existsSync(".env")) copyFileSync(".env.example", ".env");
  const content = readFileSync(".env", "utf8");
  if (/^BETTER_AUTH_SECRET=.+/m.test(content)) return;
  appendFileSync(
    ".env",
    "\nBETTER_AUTH_SECRET=" + randomBytes(48).toString("base64url") + "\n",
  );
  console.log("Generated a private local profile-signing secret in .env.");
}
ensureLocalAuthSecret();
