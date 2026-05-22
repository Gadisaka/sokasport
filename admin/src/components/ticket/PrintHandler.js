/**
 * Print handler for thermal POS receipts.
 *
 * Browsers cannot enumerate physical printers from JS, so "printer detected"
 * here is a heuristic:
 *   1. We toggle a body class so the global @media print stylesheet only
 *      shows the .thermal-print-area instead of the whole admin shell.
 *   2. We call window.print().
 *   3. We listen for the `afterprint` event — fired whether the user
 *      confirmed printing or canceled. We have no way to know which.
 *   4. If `afterprint` never fires within `timeoutMs`, we treat the dialog
 *      as broken/unavailable and resolve the promise with `printed: false`.
 *
 * The caller (useTicketPrint) decides what to do on the unhappy path: by
 * default we surface the PrinterUnavailableModal which auto-downloads a PDF.
 *
 * @typedef {Object} PrintResult
 * @property {boolean} printed       Whether `afterprint` fired in time.
 * @property {boolean} timedOut      True when the timeout elapsed first.
 * @property {Error|null} error      Any thrown error during print().
 */

const PRINT_BODY_CLASS = "is-printing-thermal";
const PAGE_STYLE_ID = "thermal-print-page-style";

const PAGE_WIDTHS = {
  "80mm": "80mm",
  "58mm": "58mm",
};

/**
 * Insert a one-shot <style> element with the per-print @page rule.
 * @page cannot be scoped by a selector, so the sole reliable way to switch
 * paper size between 80mm and 58mm is to mutate the rule before each print.
 */
function injectPageStyle(width) {
  if (typeof document === "undefined") return;
  const size = PAGE_WIDTHS[width] || PAGE_WIDTHS["80mm"];
  removePageStyle();
  const tag = document.createElement("style");
  tag.id = PAGE_STYLE_ID;
  tag.media = "print";
  tag.appendChild(
    document.createTextNode(`@page { size: ${size} auto; margin: 0; }`),
  );
  document.head.appendChild(tag);
}

function removePageStyle() {
  if (typeof document === "undefined") return;
  const existing = document.getElementById(PAGE_STYLE_ID);
  if (existing && existing.parentNode) {
    existing.parentNode.removeChild(existing);
  }
}

/**
 * Trigger window.print() with thermal-only stylesheet active.
 *
 * @param {Object} opts
 * @param {number} [opts.timeoutMs=8000] Max wait for `afterprint` before
 *   resolving as `printed: false`.
 * @param {string} [opts.width="80mm"]   "80mm" or "58mm"; toggles a body
 *   class so the @page rule picks the right paper size.
 * @returns {Promise<PrintResult>}
 */
export function printTicket({ timeoutMs = 8000, width = "80mm" } = {}) {
  if (typeof window === "undefined") {
    return Promise.resolve({ printed: false, timedOut: false, error: null });
  }

  const body = document.body;

  return new Promise((resolve) => {
    let settled = false;
    let timer = null;

    const cleanup = () => {
      window.removeEventListener("afterprint", onAfterPrint);
      body.classList.remove(PRINT_BODY_CLASS);
      removePageStyle();
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const settle = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const onAfterPrint = () => {
      // afterprint fires on both confirm and cancel. We can't distinguish.
      // The hook gives the cashier a manual "Printer not detected? Download PDF"
      // button regardless, so this is fine.
      settle({ printed: true, timedOut: false, error: null });
    };

    window.addEventListener("afterprint", onAfterPrint);
    body.classList.add(PRINT_BODY_CLASS);
    injectPageStyle(width);

    // Some browsers won't paint the new layout before window.print() runs.
    // requestAnimationFrame x2 ensures the thermal-only layout is on screen
    // before the dialog snapshots it.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          window.print();
          timer = setTimeout(() => {
            settle({ printed: false, timedOut: true, error: null });
          }, timeoutMs);
        } catch (error) {
          settle({ printed: false, timedOut: false, error });
        }
      });
    });
  });
}

/**
 * Heuristic best-effort check: returns false in environments where window.print
 * is missing (very rare — node, jsdom). Real "is a physical printer attached"
 * is impossible from a normal web page.
 */
export function isPrintSupported() {
  return typeof window !== "undefined" && typeof window.print === "function";
}
