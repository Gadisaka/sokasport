/**
 * Persistent PowerShell raw-print worker.
 *
 * The previous implementation spawned a fresh `powershell.exe` for every print
 * and recompiled the Win32 helper via `Add-Type` each time. Cold PowerShell
 * startup plus runtime C# compilation (scanned by AV/AMSI on every spawn) made
 * each print take seconds — and minutes under load.
 *
 * This worker spawns ONE long-lived `powershell.exe`, runs `Add-Type` exactly
 * once, then loops reading jobs from stdin. Each job is a single line:
 *
 *     <printerName>\t<base64 ESC/POS bytes>\n
 *
 * and the worker replies with one line:
 *
 *     OK\t<bytesWritten>      on success
 *     ERR\t<message>          on failure
 *
 * Jobs are processed strictly one at a time (the bridge's PrintQueue already
 * drains serially), so we keep a single outstanding request.
 */

import { spawn } from "child_process";
import { RAW_PRINTER_HELPER_CSHARP } from "./windowsPrinters.js";
import { log } from "./logger.js";

const READY_TIMEOUT_MS = Number(process.env.PS_WORKER_READY_TIMEOUT_MS) || 30_000;
const TAB = String.fromCharCode(9);

function buildWorkerScript() {
  // `[char]9` is used for tab in output so the PowerShell source needs no
  // backtick escapes inside this JS template literal.
  return `$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.Encoding]::ASCII
[Console]::OutputEncoding = [System.Text.Encoding]::ASCII
Add-Type -TypeDefinition @"
${RAW_PRINTER_HELPER_CSHARP}
"@
[Console]::Out.WriteLine("READY")
[Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line.Length -eq 0) { continue }
  $tab = $line.IndexOf([char]9)
  if ($tab -lt 0) {
    [Console]::Out.WriteLine("ERR" + [char]9 + "bad_frame")
    [Console]::Out.Flush()
    continue
  }
  $name = $line.Substring(0, $tab)
  $b64 = $line.Substring($tab + 1)
  try {
    $bytes = [Convert]::FromBase64String($b64)
    $r = [RawPrinterHelper]::SendBytesToPrinter($name, $bytes)
    if ($r -lt 0) {
      $stage = switch ($r) {
        -1 { "OpenPrinter" }
        -2 { "StartDocPrinter" }
        -3 { "StartPagePrinter" }
        -4 { "WritePrinter" }
        default { "Unknown" }
      }
      $win = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
      [Console]::Out.WriteLine("ERR" + [char]9 + "$stage failed for '$name' (Win32 error $win)")
    } else {
      [Console]::Out.WriteLine("OK" + [char]9 + $r)
    }
  } catch {
    $m = $_.Exception.Message -replace "[\\r\\n]", " "
    [Console]::Out.WriteLine("ERR" + [char]9 + $m)
  }
  [Console]::Out.Flush()
}
`;
}

export class PowerShellPrinter {
  constructor() {
    /** @type {import("child_process").ChildProcessWithoutNullStreams | null} */
    this.child = null;
    /** @type {Promise<void> | null} */
    this.readyPromise = null;
    this.ready = false;
    this.stdoutBuf = "";
    this.stderrTail = "";
    /** @type {{ resolve: Function, timer: ReturnType<typeof setTimeout> } | null} */
    this.pending = null;
    this.disposed = false;
  }

  isAvailable() {
    return process.platform === "win32";
  }

  /** Spawn (or reuse) the worker and resolve once it reports READY. */
  start() {
    if (this.disposed) {
      return Promise.reject(new Error("PowerShell printer disposed"));
    }
    if (this.child && this.readyPromise) return this.readyPromise;

    this.readyPromise = new Promise((resolve, reject) => {
      let settled = false;
      const child = spawn(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", buildWorkerScript()],
        { windowsHide: true },
      );
      this.child = child;
      this.ready = false;
      this.stdoutBuf = "";
      this.stderrTail = "";

      const readyTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        log("error", "ps_worker_ready_timeout", { timeoutMs: READY_TIMEOUT_MS });
        this._teardown(new Error("PowerShell worker failed to initialize"));
        reject(new Error("PowerShell worker failed to initialize"));
      }, READY_TIMEOUT_MS);

      this._onReady = () => {
        if (settled) return;
        settled = true;
        clearTimeout(readyTimer);
        this.ready = true;
        log("info", "ps_worker_ready", {});
        resolve();
      };

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => this._onStdout(chunk));
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        this.stderrTail = (this.stderrTail + chunk).slice(-2000);
      });
      child.on("error", (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(readyTimer);
          reject(err);
        }
        this._teardown(err);
      });
      child.on("exit", (code) => {
        if (!settled) {
          settled = true;
          clearTimeout(readyTimer);
          reject(new Error(`PowerShell worker exited (code ${code})`));
        }
        this._teardown(
          new Error(
            `PowerShell worker exited (code ${code})${
              this.stderrTail ? `: ${this.stderrTail.trim()}` : ""
            }`,
          ),
        );
      });
    });

    return this.readyPromise;
  }

  _onStdout(chunk) {
    this.stdoutBuf += chunk;
    let idx;
    while ((idx = this.stdoutBuf.indexOf("\n")) >= 0) {
      const line = this.stdoutBuf.slice(0, idx).replace(/\r$/, "");
      this.stdoutBuf = this.stdoutBuf.slice(idx + 1);
      this._handleLine(line);
    }
  }

  _handleLine(line) {
    if (!line) return;
    if (line === "READY") {
      this._onReady?.();
      return;
    }
    const sep = line.indexOf(TAB);
    const tag = sep >= 0 ? line.slice(0, sep) : line;
    const rest = sep >= 0 ? line.slice(sep + 1) : "";
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    clearTimeout(pending.timer);
    if (tag === "OK") {
      pending.resolve({ ok: true, bytesWritten: Number(rest) || 0 });
    } else {
      pending.resolve({ ok: false, error: rest || "PowerShell raw print failed" });
    }
  }

  /** Reject any in-flight job and drop the worker so the next print respawns. */
  _teardown(error) {
    const pending = this.pending;
    this.pending = null;
    this.child = null;
    this.readyPromise = null;
    this.ready = false;
    this._onReady = null;
    if (pending) {
      clearTimeout(pending.timer);
      pending.resolve({
        ok: false,
        error: error?.message || "PowerShell worker stopped",
      });
    }
  }

  /**
   * Send one ESC/POS job to the printer queue.
   * @param {string} printerName
   * @param {string} base64 - base64-encoded ESC/POS bytes
   * @param {number} timeoutMs
   * @returns {Promise<{ ok: boolean, bytesWritten?: number, error?: string, code?: string }>}
   */
  async print(printerName, base64, timeoutMs) {
    if (!this.isAvailable()) {
      return { ok: false, error: "PowerShell printing only supported on Windows" };
    }

    try {
      await this.start();
    } catch (err) {
      return { ok: false, error: err?.message || "PowerShell worker unavailable" };
    }

    if (this.pending) {
      return { ok: false, error: "PowerShell worker busy" };
    }
    if (!this.child || !this.child.stdin.writable) {
      return { ok: false, error: "PowerShell worker not running" };
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending && this.pending.resolve === resolve) {
          this.pending = null;
        }
        // The worker may be stuck mid-write; drop it so the next job is clean.
        this.kill();
        resolve({ ok: false, error: "Write timeout", code: "write_timeout" });
      }, timeoutMs);

      this.pending = { resolve, timer };
      const frame = `${printerName}${TAB}${base64}\n`;
      this.child.stdin.write(frame, "utf8", (err) => {
        if (err && this.pending && this.pending.resolve === resolve) {
          this.pending = null;
          clearTimeout(timer);
          resolve({ ok: false, error: err.message || "stdin write failed" });
        }
      });
    });
  }

  /** Hard-stop the worker (used on timeout / errors). */
  kill() {
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending = null;
    }
    const child = this.child;
    this.child = null;
    this.readyPromise = null;
    this.ready = false;
    this._onReady = null;
    if (child) {
      try {
        child.kill();
      } catch {
        // ignore
      }
    }
  }

  /** Permanent shutdown (process exit). */
  dispose() {
    this.disposed = true;
    const child = this.child;
    this.kill();
    if (child) {
      try {
        child.stdin.end();
      } catch {
        // ignore
      }
    }
  }
}
