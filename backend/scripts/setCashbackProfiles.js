/**
 * One-off: write the v3 two-profile CASHBACK rules onto the existing
 * Bonus row without flipping `status`. Fresh databases already get this
 * shape from `ensureBonusPresets`; this script is for DBs that still
 * hold v2 (or legacy flat) cashback rules.
 *
 *   node backend/scripts/setCashbackProfiles.js
 *
 * After it runs, turn cashback on from Settings → Cashback (or leave it
 * off until you are ready).
 */
import { prisma } from "../Config/db.js";
import { DEFAULT_CASHBACK_RULES } from "../lib/ensureBonusPresets.js";

async function main() {
  const existing = await prisma.bonus.findFirst({
    where: { type: "CASHBACK" },
    select: { id: true, status: true, rules: true },
  });

  if (!existing) {
    await prisma.bonus.create({
      data: {
        name: "Cashback on losses",
        type: "CASHBACK",
        percentage: 0,
        rules: DEFAULT_CASHBACK_RULES,
        status: false,
      },
    });
    console.log("Created CASHBACK bonus with v3 profiles (status: off).");
    return;
  }

  await prisma.bonus.update({
    where: { id: existing.id },
    data: { rules: DEFAULT_CASHBACK_RULES },
  });
  console.log(
    `Updated CASHBACK rules to v3 profiles (status left ${existing.status ? "on" : "off"}).`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
