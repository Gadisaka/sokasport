import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const row = await prisma.setting.findUnique({
    where: { key: "ONLINE_DEPOSIT_RECEIVERS" },
  });
  
  console.log("Raw setting value:");
  console.log(row?.value ?? "(not set)");
  
  if (row?.value) {
    console.log("\nParsed:");
    const parsed = JSON.parse(row.value);
    console.log(JSON.stringify(parsed, null, 2));
    
    console.log("\nTelebirr config:");
    console.log("  receiverName:", parsed.telebirr?.receiverName || "(empty)");
    console.log("  receiverPhone:", parsed.telebirr?.receiverPhone || "(empty)");
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
