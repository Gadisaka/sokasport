import { useEffect } from "react";
import { io } from "socket.io-client";
import { getApiOrigin } from "../services/api";

function socketOrigin() {
  try {
    const url = new URL(getApiOrigin());
    return `${url.protocol}//${url.host}`;
  } catch {
    return window.location.origin;
  }
}

export function useOddsSocket(apiFixtureIds = [], handlers = {}) {
  useEffect(() => {
    const socket = io(socketOrigin(), {
      path: "/socket.io",
      transports: ["websocket", "polling"],
    });
    socket.on("connect", () => {
      for (const id of apiFixtureIds) {
        if (Number.isFinite(Number(id))) {
          socket.emit("fixture:subscribe", Number(id));
        }
      }
    });
    socket.on("market:locked", (payload) => {
      handlers?.onLocked?.(payload);
    });
    socket.on("market:unlocked", (payload) => {
      handlers?.onUnlocked?.(payload);
    });
    return () => {
      for (const id of apiFixtureIds) {
        if (Number.isFinite(Number(id))) {
          socket.emit("fixture:unsubscribe", Number(id));
        }
      }
      socket.disconnect();
    };
  }, [JSON.stringify(apiFixtureIds), handlers?.onLocked, handlers?.onUnlocked]);
}

