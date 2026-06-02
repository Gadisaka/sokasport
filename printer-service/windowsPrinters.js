import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { log } from "./logger.js";

const execFileAsync = promisify(execFile);

const RAW_PRINT_SCRIPT = `$ErrorActionPreference = "Stop"
$PrinterName = $env:SOKA_PRINTER_NAME
if ([string]::IsNullOrWhiteSpace($PrinterName)) {
    Write-Error "Missing SOKA_PRINTER_NAME"
    exit 2
}
Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Runtime.InteropServices;

public class RawPrinterHelper {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public class DOCINFOW {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }

    [DllImport("winspool.Drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPWStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOW di);

    [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

    public static int SendBytesToPrinter(string szPrinterName, byte[] bytes) {
        IntPtr hPrinter;
        if (!OpenPrinter(szPrinterName, out hPrinter, IntPtr.Zero))
            return -1;
        try {
            var di = new DOCINFOW { pDocName = "Sokasport Ticket", pDataType = "RAW" };
            if (!StartDocPrinter(hPrinter, 1, di)) return -2;
            try {
                if (!StartPagePrinter(hPrinter)) return -3;
                try {
                    int written = 0;
                    IntPtr p = Marshal.AllocCoTaskMem(bytes.Length);
                    try {
                        Marshal.Copy(bytes, 0, p, bytes.Length);
                        if (!WritePrinter(hPrinter, p, bytes.Length, out written)) return -4;
                    } finally { Marshal.FreeCoTaskMem(p); }
                    return written;
                } finally { EndPagePrinter(hPrinter); }
            } finally { EndDocPrinter(hPrinter); }
        } finally { ClosePrinter(hPrinter); }
    }
}
"@

$stdin = [System.Console]::OpenStandardInput()
$ms = New-Object System.IO.MemoryStream
$stdin.CopyTo($ms)
$bytes = $ms.ToArray()
$result = [RawPrinterHelper]::SendBytesToPrinter($PrinterName, $bytes)
if ($result -lt 0) {
    $stage = switch ($result) {
        -1 { "OpenPrinter" }
        -2 { "StartDocPrinter" }
        -3 { "StartPagePrinter" }
        -4 { "WritePrinter" }
        default { "Unknown" }
    }
    $win = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
    Write-Error ("$stage failed for '$PrinterName' (Win32 error $win)")
    exit 1
}
Write-Output ("written=" + $result)
`;

/**
 * Send raw ESC/POS bytes to a Windows print queue via PowerShell + Win32 WritePrinter.
 * @param {Buffer} buffer
 * @param {string} printerName
 * @returns {Promise<{ ok: boolean, error?: string, bytesWritten?: number }>}
 */
export function printRawViaPowerShell(buffer, printerName) {
  if (process.platform !== "win32") {
    return Promise.resolve({ ok: false, error: "PowerShell printing only supported on Windows" });
  }

  return new Promise((resolve) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", RAW_PRINT_SCRIPT],
      {
        windowsHide: true,
        env: { ...process.env, SOKA_PRINTER_NAME: printerName },
      },
    );

    let stdout = "";
    let stderr = "";
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", (err) =>
      settle({ ok: false, error: err?.message || "powershell spawn failed" }),
    );
    child.on("close", (code) => {
      if (code === 0) {
        const match = /written=(\d+)/.exec(stdout);
        settle({ ok: true, bytesWritten: match ? Number(match[1]) : buffer.length });
      } else {
        settle({
          ok: false,
          error: (stderr || stdout || `powershell exit ${code}`).trim(),
        });
      }
    });

    child.stdin.end(buffer);
  });
}

/**
 * Fallback printer enumeration when node-printer native getPrinters() is empty.
 * Uses the same source as `Get-Printer` in PowerShell.
 * @returns {Promise<Array<{ name: string, driverName: string, portName: string, status: string, isDefault: boolean }>>}
 */
export async function listWindowsPrintersViaPowerShell() {
  if (process.platform !== "win32") return [];

  try {
    const script =
      "Get-Printer | Select-Object Name, DriverName, PortName, PrinterStatus | ConvertTo-Json -Compress";
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-Command", script],
      { timeout: 10000, windowsHide: true },
    );

    const trimmed = String(stdout || "").trim();
    if (!trimmed) return [];

    const parsed = JSON.parse(trimmed);
    const rows = Array.isArray(parsed) ? parsed : [parsed];

    return rows
      .filter((row) => row && row.Name)
      .map((row) => ({
        name: String(row.Name).trim(),
        driverName: String(row.DriverName || "").trim(),
        portName: String(row.PortName || "").trim(),
        status: String(row.PrinterStatus ?? "").trim(),
        isDefault: false,
      }));
  } catch (error) {
    log("warn", "powershell_printers_failed", {
      error: error?.message || "Failed to list printers via PowerShell",
    });
    return [];
  }
}
