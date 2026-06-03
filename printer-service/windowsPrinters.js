import { execFile } from "child_process";
import { promisify } from "util";
import { log } from "./logger.js";

const execFileAsync = promisify(execFile);

/**
 * C# definition of the Win32 raw-print helper, shared by the persistent
 * PowerShell worker (see powershellPrinter.js). Kept separate from any loop
 * logic so the worker can `Add-Type` it exactly once per process.
 */
export const RAW_PRINTER_HELPER_CSHARP = `using System;
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
`;

/**
 * Look up a single Windows print queue by exact name. Unlike enumerating all
 * queues with `Get-Printer`, scoping by `-Name` avoids the multi-second (or
 * multi-minute) stalls Windows incurs while querying the live status of every
 * offline / network / RDP-redirected printer on the machine.
 *
 * @param {string} name
 * @returns {Promise<{ name: string, driverName: string, portName: string, status: string, isDefault: boolean } | null>}
 */
export async function getWindowsPrinterByName(name) {
  if (process.platform !== "win32") return null;
  const target = String(name || "").trim();
  if (!target) return null;

  try {
    // A non-matching `-Name` makes Get-Printer raise a terminating error and
    // exit non-zero; catch it and exit 0 so a simply-absent queue returns empty
    // output rather than a logged failure on every reconnect attempt. Real
    // failures (timeout, missing cmdlet) still surface via the JS catch below.
    const script =
      "try { " +
      "$p = Get-Printer -Name $env:SOKA_PRINTER_NAME -ErrorAction Stop; " +
      "$p | Select-Object Name, DriverName, PortName, PrinterStatus | " +
      "ConvertTo-Json -Compress " +
      "} catch { } exit 0";
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-Command", script],
      {
        timeout: 8000,
        windowsHide: true,
        env: { ...process.env, SOKA_PRINTER_NAME: target },
      },
    );

    const trimmed = String(stdout || "").trim();
    if (!trimmed) return null;

    const parsed = JSON.parse(trimmed);
    const row = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!row || !row.Name) return null;

    return {
      name: String(row.Name).trim(),
      driverName: String(row.DriverName || "").trim(),
      portName: String(row.PortName || "").trim(),
      status: String(row.PrinterStatus ?? "").trim(),
      isDefault: false,
    };
  } catch (error) {
    log("warn", "powershell_printer_lookup_failed", {
      printer: target,
      error: error?.message || "Failed to look up printer via PowerShell",
    });
    return null;
  }
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
