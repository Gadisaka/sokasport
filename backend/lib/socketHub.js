import { Server } from "socket.io";
import { getRedisClient } from "../services/cacheService.js";

const CHANNEL = "sportsbook:market-events";
let ioInstance = null;
let subscriber = null;

export async function publishMarketEvent(event) {
  try {
    const redis = getRedisClient();
    await redis.publish(CHANNEL, JSON.stringify(event));
  } catch (error) {
    console.error("publishMarketEvent error:", error?.message || error);
  }
}

export async function initSocketHub(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: "*" },
    path: "/socket.io",
  });
  io.on("connection", (socket) => {
    socket.on("fixture:subscribe", (apiFixtureId) => {
      const id = Number.parseInt(apiFixtureId, 10);
      if (Number.isFinite(id)) socket.join(`fixture:${id}`);
    });
    socket.on("fixture:unsubscribe", (apiFixtureId) => {
      const id = Number.parseInt(apiFixtureId, 10);
      if (Number.isFinite(id)) socket.leave(`fixture:${id}`);
    });
  });
  ioInstance = io;

  try {
    const base = getRedisClient();
    subscriber = base.duplicate();
    await subscriber.connect();
    await subscriber.subscribe(CHANNEL, (message) => {
      try {
        const payload = JSON.parse(message);
        const fixtureId = Number.parseInt(payload?.apiFixtureId, 10);
        if (Number.isFinite(fixtureId)) {
          io.emit(payload.event || "market:event", payload);
          io.to(`fixture:${fixtureId}`).emit(payload.event || "market:event", payload);
        } else {
          io.emit(payload.event || "market:event", payload);
        }
      } catch {
        // ignore malformed payload
      }
    });
  } catch (error) {
    console.error("initSocketHub subscribe error:", error?.message || error);
  }
}

export function getSocketHub() {
  return ioInstance;
}

