/**
 * One-off: assign receipt_number to tickets that do not have one (Mongo/legacy).
 *
 *   node backend/scripts/backfillTicketReceiptNumbers.js
 */
import { prisma } from "../Config/db.js";

function buildReceiptNumber() {
  const a = Math.floor(Math.random() * 100_000)
    .toString()
    .padStart(5, "0");
  const b = Math.floor(Math.random() * 100_000)
    .toString()
    .padStart(5, "0");
  return `${a}-${b}`;
}

async function reserveUniqueReceiptNumber() {
  for (let i = 0; i < 20; i++) {
    const candidate = buildReceiptNumber();
    const clash = await prisma.ticket.findFirst({
      where: { receipt_number: candidate },
      select: { id: true },
    });
    if (!clash) return candidate;
  }
  throw new Error("Could not allocate receipt number");
}

async function main() {
  const all = await prisma.ticket.findMany({
    select: { id: true, receipt_number: true },
  });
  const tickets = all.filter((t) => !t.receipt_number);

  let n = 0;
  for (const t of tickets) {
    const rn = await reserveUniqueReceiptNumber();
    await prisma.ticket.update({
      where: { id: t.id },
      data: { receipt_number: rn },
    });
    n += 1;
  }

  console.log(`Backfilled receipt_number on ${n} ticket(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
