#!/usr/bin/env node
/**
 * Seed (or refresh) a test PLAYER for InOut Games staging tests.
 *
 * Idempotent: safe to re-run. It will
 *   - ensure the PLAYER role exists,
 *   - upsert a player user (by email),
 *   - ensure a PLAYER wallet set to the requested balance,
 *   - mint a fresh InoutGameSession token and print it.
 *
 * The printed token can be dropped straight into the curl smoke test as the
 * webhook `token` (AuthToken) — no login/launch round-trip required.
 *
 * Run inside the backend container:
 *   docker compose exec backend node scripts/seedInoutTestPlayer.mjs
 *
 * Optional env overrides:
 *   INOUT_TEST_PHONE     (default 0900000001)
 *   INOUT_TEST_NAME      (default "InOut Test Player")
 *   INOUT_TEST_PASSWORD  (default "test1234")
 *   INOUT_TEST_BALANCE   (default 1000)
 *   INOUT_DEFAULT_CURRENCY (default ETB)
 *   INOUT_TEST_GAME_MODE (default "plinko" — InOut's integration test guide
 *                         expects the token to come from a Plinko1000 launch)
 */
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { prisma } from "../Config/db.js";

const PHONE = process.env.INOUT_TEST_PHONE || "0900000001";
const NAME = process.env.INOUT_TEST_NAME || "InOut Test Player";
const PASSWORD = process.env.INOUT_TEST_PASSWORD || "test1234";
const BALANCE = Number(process.env.INOUT_TEST_BALANCE || 1000);
const CURRENCY = process.env.INOUT_DEFAULT_CURRENCY || "ETB";
const GAME_MODE = process.env.INOUT_TEST_GAME_MODE || "plinko";
const EMAIL = `${PHONE}@player.local`;

async function run() {
  const playerRole = await prisma.role.findUnique({ where: { name: "PLAYER" } });
  if (!playerRole) {
    throw new Error("PLAYER role not found — run `prisma db seed` first");
  }

  let user = await prisma.user.findUnique({ where: { email: EMAIL } });
  if (!user) {
    const hashed = await bcrypt.hash(PASSWORD, 10);
    user = await prisma.user.create({
      data: {
        fullname: NAME,
        phone: PHONE,
        email: EMAIL,
        password: hashed,
        role_id: playerRole.id,
        status: true,
      },
    });
    console.log(`Created player user ${user.id}`);
  } else {
    console.log(`Reusing player user ${user.id}`);
  }

  let wallet = await prisma.wallet.findFirst({
    where: { user_id: user.id, wallet_type: "PLAYER" },
  });
  if (!wallet) {
    wallet = await prisma.wallet.create({
      data: {
        user_id: user.id,
        wallet_type: "PLAYER",
        balance: BALANCE,
        withdrawable: 0,
      },
    });
    console.log(`Created PLAYER wallet ${wallet.id} with balance ${BALANCE}`);
  } else {
    wallet = await prisma.wallet.update({
      where: { id: wallet.id },
      data: { balance: BALANCE, withdrawable: 0 },
    });
    console.log(`Set PLAYER wallet ${wallet.id} balance to ${BALANCE}`);
  }

  const token = crypto.randomBytes(32).toString("hex");
  await prisma.inoutGameSession.create({
    data: {
      token,
      user_id: user.id,
      currency: CURRENCY,
      game_mode: GAME_MODE,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  console.log("\n=== InOut test session ===");
  console.log(`userId   : ${user.id}`);
  console.log(`currency : ${CURRENCY}`);
  console.log(`gameMode : ${GAME_MODE}`);
  console.log(`balance  : ${BALANCE}`);
  console.log(`token    : ${token}`);
  console.log("==========================\n");
}

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
