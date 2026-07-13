/**
 * Prisma seed — upserts roles and staff test accounts.
 *
 * Run: npm run db:seed   OR   npx prisma db seed
 *
 * Loads `.env` from backend/ regardless of cwd. Requires DATABASE_URL unless
 * you run inside Docker Compose (see comment below).
 *
 * VPS + Docker Compose (recommended):
 *   docker compose -f docker-compose.prod.yml exec backend npx prisma db seed
 * (DATABASE_URL comes from Compose; prisma.config.ts skips loading .env in some cases.)
 */

import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env") });

if (!process.env.DATABASE_URL) {
  console.error(
    "DATABASE_URL is not set.\n" +
      "• Create backend/.env with DATABASE_URL pointing at Mongo (host must resolve from where you run: use mongodb://127.0.0.1:<port>/... when Mongo is published locally, not mongo:27017 on the VPS shell).\n" +
      "• Or seed from the API container:\n" +
      "    docker compose -f docker-compose.prod.yml exec backend npx prisma db seed\n"
  );
  process.exit(1);
}

const bcrypt = (await import("bcrypt")).default;
const { PrismaClient } = await import("@prisma/client");
const { ensureBonusPresets, PRESET_BONUSES } = await import("../lib/ensureBonusPresets.js");
const { normalizeEthiopiaPhone } = await import("../lib/phone.js");
const prisma = new PrismaClient({});

const ROLES = [
  {
    name: "SUPER_ADMIN",
    description: "Full system ownership and configuration",
  },
  {
    name: "ADMIN",
    description:
      "Main system controller — users, games, tickets, wallet, bonuses, CMS, reports",
  },
  {
    name: "FINANCIAL_SUPPORT",
    description: "Deposit/withdrawal approval, view reports",
  },
  {
    name: "AGENT",
    description: "View-only — dashboard, reports, assigned branch tickets",
  },
  {
    name: "CASHIER",
    description: "Sell/cancel/payout tickets, cash out, deposits/withdrawals",
  },
  {
    name: "PLAYER",
    description:
      "End user — place bets, deposit, withdraw, view tickets/wallet",
  },
];

const STAFF_TEST_ACCOUNTS = [
  {
    role: "SUPER_ADMIN",
    username: "superadmin",
    fullname: "Super Admin",
    email: "superadmin@test.local",
    phone: "0911112222",
    password: "Test@12345",
  },
  {
    role: "ADMIN",
    username: "admin",
    fullname: "Admin User",
    email: "admin@test.local",
    phone: "0911113333",
    password: "Test@12345",
  },
  {
    role: "FINANCIAL_SUPPORT",
    username: "financial",
    fullname: "Financial Support",
    email: "financial.support@test.local",
    phone: "0911114444",
    password: "Test@12345",
  },
  {
    role: "AGENT",
    username: "agent",
    fullname: "Agent User",
    email: "agent@test.local",
    phone: "0911115555",
    password: "Test@12345",
  },
  {
    role: "CASHIER",
    username: "cashier",
    fullname: "Cashier User",
    email: "cashier@test.local",
    phone: "0911116666",
    password: "Test@12345",
  },
];

async function main() {
  for (const role of ROLES) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: { description: role.description },
      create: { name: role.name, description: role.description },
    });
    console.log(`  Role ${role.name} — ok`);
  }
  console.log(`Seeded ${ROLES.length} roles.`);

  for (const account of STAFF_TEST_ACCOUNTS) {
    const hashedPassword = await bcrypt.hash(account.password, 10);
    const phone = normalizeEthiopiaPhone(account.phone);

    await prisma.user.upsert({
      where: { email: account.email },
      update: {
        username: account.username,
        fullname: account.fullname,
        phone,
        password: hashedPassword,
        status: true,
        role: {
          connect: { name: account.role },
        },
      },
      create: {
        username: account.username,
        fullname: account.fullname,
        email: account.email,
        phone,
        password: hashedPassword,
        status: true,
        role: {
          connect: { name: account.role },
        },
      },
    });

    console.log(`  User ${account.role} (${account.username} / ${phone}) — ok`);
  }
  console.log(`Seeded ${STAFF_TEST_ACCOUNTS.length} staff test accounts.`);

  await ensureBonusPresets(prisma);
  for (const preset of PRESET_BONUSES) {
    console.log(`  Bonus preset ${preset.type} — ok`);
  }
  console.log(`Ensured ${PRESET_BONUSES.length} bonus presets (create-only on re-seed).`);

  // Ensure every cashier user has supporting wallet + cashier profile rows.
  const cashierRole = await prisma.role.findUnique({
    where: { name: "CASHIER" },
    select: { id: true },
  });

  if (cashierRole?.id) {
    // Legacy rows may have null/missing branch fields; Prisma cannot read them until patched.
    await prisma.$runCommandRaw({
      update: "cashiers",
      updates: [
        {
          q: {
            $or: [
              { branch_name: null },
              { branch_name: { $exists: false } },
              { branch_location: null },
              { branch_location: { $exists: false } },
            ],
          },
          u: {
            $set: {
              branch_name: "Default Cashier Branch",
              branch_location: "HQ",
            },
          },
          multi: true,
        },
      ],
    });

    const cashierUsers = await prisma.user.findMany({
      where: { role_id: cashierRole.id },
      select: { id: true, fullname: true, status: true },
    });

    for (const user of cashierUsers) {
      let wallet = await prisma.wallet.findFirst({
        where: {
          user_id: user.id,
          wallet_type: "CASHIER",
        },
        select: { id: true },
      });

      if (!wallet) {
        wallet = await prisma.wallet.create({
          data: {
            user_id: user.id,
            wallet_type: "CASHIER",
            balance: 0,
          },
          select: { id: true },
        });
        console.log(`  Created cashier wallet for ${user.fullname}`);
      }

      await prisma.cashier.upsert({
        where: { user_id: user.id },
        update: {
          wallet_id: wallet.id,
          status: Boolean(user.status),
          branch_name: "Default Cashier Branch",
          branch_location: "HQ",
        },
        create: {
          user_id: user.id,
          wallet_id: wallet.id,
          branch_name: "Default Cashier Branch",
          branch_location: "HQ",
          status: Boolean(user.status),
        },
      });
      console.log(`  Ensured cashier profile for ${user.fullname}`);
    }
  }
}

try {
  await main();
} catch (error) {
  console.error("Seed failed:", error);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
