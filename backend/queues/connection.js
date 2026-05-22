import IORedis from "ioredis";

/**
 * Dedicated ioredis connection for BullMQ.
 *
 * BullMQ uses blocking commands (BRPOPLPUSH/XREADGROUP) on its workers and
 * requires `maxRetriesPerRequest: null` and `enableReadyCheck: false`.
 * We deliberately keep this connection separate from the cache client in
 * `services/cacheService.js` so blocking workers can't starve cache reads.
 *
 * One connection module is shared by Queue, Worker and QueueEvents instances.
 */

let queueConnection = null;
let subscriberConnection = null;

function buildOptions() {
  return {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    connectTimeout: 5000,
    lazyConnect: true,
    retryStrategy(times) {
      // Cap to ~10s; BullMQ handles longer outages itself.
      return Math.min(1000 + times * 500, 10_000);
    },
  };
}

function createConnection(role) {
  const url = process.env.REDIS_URL || "redis://localhost:6379";
  const conn = new IORedis(url, buildOptions());

  let warnedAt = 0;
  conn.on("error", (err) => {
    const now = Date.now();
    if (now - warnedAt > 10_000) {
      console.error(`[queues:${role}] redis error:`, err.message);
      warnedAt = now;
    }
  });
  conn.on("connect", () => console.log(`[queues:${role}] redis connected`));
  conn.on("ready", () => console.log(`[queues:${role}] redis ready`));
  conn.on("close", () => console.log(`[queues:${role}] redis closed`));
  return conn;
}

export function getQueueConnection() {
  if (!queueConnection) queueConnection = createConnection("publisher");
  return queueConnection;
}

export function getSubscriberConnection() {
  if (!subscriberConnection) subscriberConnection = createConnection("worker");
  return subscriberConnection;
}

/**
 * BullMQ accepts a `prefix` option so multiple deployments can share one Redis
 * without colliding on `bull:*` keys. We reuse the existing REDIS_KEY_PREFIX so
 * BullMQ keys live alongside cache keys but in their own namespace.
 */
export function getQueuePrefix() {
  const base = process.env.REDIS_KEY_PREFIX || "kizzabet";
  return `${base}:bull`;
}

export async function closeQueueConnections() {
  const tasks = [];
  if (queueConnection) tasks.push(queueConnection.quit().catch(() => {}));
  if (subscriberConnection)
    tasks.push(subscriberConnection.quit().catch(() => {}));
  await Promise.all(tasks);
  queueConnection = null;
  subscriberConnection = null;
}
