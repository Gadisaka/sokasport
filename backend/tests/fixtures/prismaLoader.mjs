/**
 * Node ESM loader hook — redirects `Config/db.js` imports to the
 * in-memory stub so the settlement service runs against deterministic
 * data during tests.
 *
 * Usage:
 *   register(stubLoaderUrl, parentUrl);
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const stubUrl = pathToFileURL(
  path.join(__dirname, "prismaInMemoryStub.js"),
).href;

export async function resolve(specifier, context, nextResolve) {
  if (
    specifier.endsWith("Config/db.js") ||
    specifier.endsWith("Config/db") ||
    specifier === "../Config/db.js" ||
    specifier === "../../Config/db.js"
  ) {
    return { url: stubUrl, format: "module", shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
