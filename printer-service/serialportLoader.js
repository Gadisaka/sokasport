import path from "path";
import { createRequire } from "module";

/** @type {typeof import("serialport").SerialPort | null} */
let SerialPortClass = null;

/**
 * Load serialport from disk when packaged (native .node cannot run from pkg snapshot).
 */
export async function getSerialPort() {
  if (SerialPortClass) return SerialPortClass;

  if (process.pkg) {
    const base = path.dirname(process.execPath);
    const requireFromDisk = createRequire(
      path.join(base, "node_modules", "serialport", "package.json"),
    );
    SerialPortClass = requireFromDisk("serialport").SerialPort;
  } else {
    const mod = await import("serialport");
    SerialPortClass = mod.SerialPort;
  }

  return SerialPortClass;
}
