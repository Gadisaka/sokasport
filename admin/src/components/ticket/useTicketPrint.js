import { useCallback, useEffect, useRef, useState } from "react";
import { buildTicketPdfFilename, downloadTicketPdf } from "./pdfGenerator";
import { encodeTicketAsync } from "./escpos";
import {
  getBarcodePayload,
  renderBarcodeToDataURL,
} from "./ticketBarcode";
import {
  checkBridgeCompatibility,
  getStatus as getLocalPrinterStatus,
  print as printViaLocalService,
  STATUS_POLL_MS,
} from "../../services/localPrinter";

/**
 * Orchestrates the cashier print flow:
 *
 *   1. Generates a Code 128 barcode data URL (receipt or coupon) for
 *      <TicketTemplate> under the logo.
 *   2. Returns a `ticketRef` to attach to the off-screen <TicketTemplate>.
 *   3. Exposes `print()` which:
 *        a. tries local print bridge direct printing (silent, no dialog),
 *        b. returns reason codes for UI handling when it cannot print.
 *   4. Exposes `downloadPdf()` for manual backup export.
 *   5. Exposes printer status and test print helpers.
 *
 * Print priority: local bridge only (silent).
 */
export function useTicketPrint(
  ticket,
  { width = "80mm", preferLocalService = true, platformWinningsTax = null } = {},
) {
  const ticketRef = useRef(null);
  const [barcodeDataUrl, setBarcodeDataUrl] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [lastError, setLastError] = useState("");
  const [printerStatus, setPrinterStatus] = useState({
    connected: false,
    port: "",
    message: "",
    queueLength: 0,
    processing: false,
    lastError: null,
    reconnectAttempts: 0,
    lastSuccessfulPrintAt: null,
  });

  const applyStatus = useCallback((status) => {
    if (status.success) {
      setPrinterStatus({
        connected: status.connected,
        port: status.port || "",
        message: status.message || "",
        queueLength: status.queueLength ?? 0,
        processing: Boolean(status.processing),
        lastError: status.lastError || null,
        reconnectAttempts: status.reconnectAttempts ?? 0,
        lastSuccessfulPrintAt: status.lastSuccessfulPrintAt || null,
      });
      return;
    }
    setPrinterStatus((prev) => ({
      connected: false,
      port: "",
      message: status.message || "",
      queueLength: 0,
      processing: false,
      lastError: status.code === "service_unreachable" ? null : prev.lastError,
      reconnectAttempts: 0,
      lastSuccessfulPrintAt: prev.lastSuccessfulPrintAt,
    }));
  }, []);

  const barcodePayload = getBarcodePayload(ticket);

  useEffect(() => {
    let alive = true;
    if (!barcodePayload) {
      setBarcodeDataUrl("");
      return () => {
        alive = false;
      };
    }
    const url = renderBarcodeToDataURL(barcodePayload);
    if (alive) setBarcodeDataUrl(url);
    return () => {
      alive = false;
    };
  }, [barcodePayload]);

  const refreshPrinterStatus = useCallback(async () => {
    const status = await getLocalPrinterStatus();
    applyStatus(status);
    return status;
  }, [applyStatus]);

  useEffect(() => {
    let active = true;

    void (async () => {
      const compatibility = await checkBridgeCompatibility();
      if (!active) return;
      if (compatibility.warning) {
        setPrinterStatus((prev) => ({
          ...prev,
          message: compatibility.warning,
        }));
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    let timer = null;

    const run = async () => {
      const status = await getLocalPrinterStatus();
      if (!active) return;
      applyStatus(status);
      timer = window.setTimeout(run, STATUS_POLL_MS);
    };

    void run();

    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [applyStatus]);

  const downloadPdf = useCallback(async () => {
    if (!ticketRef.current) {
      setLastError("Ticket not ready");
      return false;
    }
    setPdfBusy(true);
    setLastError("");
    try {
      await downloadTicketPdf({
        node: ticketRef.current,
        filename: buildTicketPdfFilename(ticket),
        width,
      });
      return true;
    } catch (error) {
      setLastError(error?.message || "Failed to generate PDF");
      return false;
    } finally {
      setPdfBusy(false);
    }
  }, [ticket, width]);

  const print = useCallback(async () => {
    if (!ticket) return { printed: false, method: "none", fellBackToPdf: false };
    setLastError("");

    if (preferLocalService) {
      try {
        const escposData = await encodeTicketAsync(ticket, {
          width,
          platformWinningsTax,
        });
        const result = await printViaLocalService(escposData);

        if (result.success) {
          return { printed: true, method: "local_service", reason: "success" };
        }

        if (result.code === "service_unreachable") {
          setLastError(
            "Local print service unreachable. Start PrinterBridge.exe on this PC.",
          );
          return {
            printed: false,
            method: "local_service",
            reason: "service_unreachable",
          };
        }

        if (result.code === "unauthorized") {
          setLastError(
            "Printer bridge auth failed. Ensure PrinterBridge.exe and cashier app use the same API key.",
          );
          return {
            printed: false,
            method: "local_service",
            reason: "unauthorized",
          };
        }

        if (result.code === "com_unavailable") {
          setLastError("COM port unavailable. Check POS80 driver and PRINTER_COM.");
          return {
            printed: false,
            method: "local_service",
            reason: "com_unavailable",
          };
        }

        if (result.code === "write_timeout") {
          setLastError("Print timed out. Check printer connection and try again.");
          return {
            printed: false,
            method: "local_service",
            reason: "write_timeout",
          };
        }

        const errorMessage = String(result.error?.message || "");
        if (/printer disconnected|offline/i.test(errorMessage)) {
          setLastError("Printer disconnected. Check POS80 connection and COM port.");
          return {
            printed: false,
            method: "local_service",
            reason: "printer_disconnected",
          };
        }

        setLastError(errorMessage || "Local printing failed");
        return { printed: false, method: "local_service", reason: "other_error" };
      } catch (error) {
        setLastError(error?.message || "Failed to prepare print data");
        return { printed: false, method: "local_service", reason: "other_error" };
      }
    }

    setLastError("Local printer service is disabled.");
    return { printed: false, method: "none", reason: "local_service_disabled" };
  }, [ticket, width, preferLocalService, platformWinningsTax]);

  const retryPrint = useCallback(async () => {
    return print();
  }, [print]);

  const testPrint = useCallback(async () => {
    const testData = await encodeTicketAsync(
      {
        couponNumber: "ab000000",
        receiptNumber: "99999-88888",
        cashierId: "TEST",
        cashierName: "Test Cashier",
        branchName: "Test Branch",
        branchLocation: "HQ",
        status: "TEST",
        createdAt: new Date().toISOString(),
        stake: 100,
        totalOdds: 2.5,
        potentialWin: 250,
        selections: [
          {
            match: { homeTeam: "Team A", awayTeam: "Team B", startTime: new Date().toISOString() },
            selection: "Team A Win",
            marketLabel: "1X2",
            odds: 2.5,
          },
        ],
      },
      { width, platformWinningsTax: null },
    );

    const result = await printViaLocalService(testData);
    if (!result.success) {
      setLastError(result.error?.message || "Test print failed. Check printer service.");
      return false;
    }
    return true;
  }, [width]);

  return {
    ticketRef,
    barcodeDataUrl,
    print,
    retryPrint,
    downloadPdf,
    pdfBusy,
    lastError,
    printerStatus,
    refreshPrinterStatus,
    testPrint,
  };
}
