import { betterAuth } from "better-auth/minimal";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./prisma";
import { deploymentOrigin } from "./deployment-origin.mjs";

const deployment = deploymentOrigin(process.env.BETTER_AUTH_URL);
// Better Auth can append this separate environment list internally. Keep this
// app's trust boundary in the single validated deployment setting instead.
if (process.env.BETTER_AUTH_TRUSTED_ORIGINS)
  throw new Error("Configure trusted origins only through BETTER_AUTH_URL.");
export const auth = betterAuth({
  appName: "Investor Desk",
  baseURL: deployment.origin,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: deployment.trustedOrigins,
  advanced: { trustedProxyHeaders: false },
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
  },
  session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 10 },
      "/sign-up/email": { window: 60, max: 5 },
    },
  },
});
