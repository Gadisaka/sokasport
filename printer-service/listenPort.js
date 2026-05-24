import { log } from "./logger.js";

const DEFAULT_BASE_PORT = 3005;
const DEFAULT_ATTEMPTS = 6;

/**
 * @param {import("express").Express} app
 * @param {string} host
 * @returns {Promise<{ server: import("http").Server, port: number }>}
 */
export async function listenWithPortFallback(app, host) {
  const basePort = Number(process.env.PORT) || DEFAULT_BASE_PORT;
  const attempts = Number(process.env.PORT_FALLBACK_ATTEMPTS) || DEFAULT_ATTEMPTS;
  const ports = Array.from({ length: attempts }, (_, index) => basePort + index);

  /** @type {Error | null} */
  let lastError = null;

  for (const port of ports) {
    try {
      const server = await tryListen(app, host, port);
      if (port !== basePort) {
        log("warn", "port_fallback", {
          requestedPort: basePort,
          listenPort: port,
          message: `Port ${basePort} in use — listening on ${port}`,
        });
      }
      return { server, port };
    } catch (error) {
      lastError = error;
      if (error?.code !== "EADDRINUSE") {
        throw error;
      }
      log("warn", "port_in_use", { port, next: port + 1 });
    }
  }

  throw lastError || new Error(`No available port in range ${basePort}-${ports.at(-1)}`);
}

/**
 * @param {import("express").Express} app
 * @param {string} host
 * @param {number} port
 */
function tryListen(app, host, port) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host);

    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };

    const onListening = () => {
      server.off("error", onError);
      resolve(server);
    };

    server.once("error", onError);
    server.once("listening", onListening);
  });
}
