/**
 * Transaction-free upsert helper for Mongo deployments that do not support
 * Prisma's transaction-backed upsert behavior.
 *
 * @param {object} model Prisma model delegate (e.g. prisma.league)
 * @param {{ where: object, update: object, create: object }} args
 */
export async function upsertNoTx(model, { where, update, create }) {
  const existing = await model.findUnique({ where });
  if (existing) {
    return model.update({ where, data: update });
  }

  try {
    return await model.create({ data: create });
  } catch (error) {
    // If another process inserted between findUnique and create, update it.
    if (error?.code === "P2002") {
      return model.update({ where, data: update });
    }
    throw error;
  }
}

export default upsertNoTx;
