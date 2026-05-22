/**
 * Structured errors for the Market Evaluator V2 subsystem.
 *
 * `ValidationError`    – thrown by a market module's `validate()` when
 *                         placement-time params are malformed. Never
 *                         thrown at runtime grading. Carries a machine
 *                         code (e.g. `"invalid_line"`) + optional
 *                         `field` + `details` so controllers can return
 *                         `400` bodies the frontend can localize.
 *
 * `MarketUnknownError` – thrown by the registry when a caller asks for
 *                         a market code that has not been registered.
 *                         Settlement code catches this and downgrades
 *                         to a `VOID / unknown_market` outcome.
 *
 * `MarketModuleError`  – thrown from inside a module's `evaluate()` to
 *                         signal a data-shape violation the engine
 *                         should record as `module_error:<code>`. The
 *                         engine swallows this and returns `VOID`.
 *
 * All three extend `Error` so `instanceof` checks keep working and the
 * stack traces are preserved for Sentry / audit logs.
 *
 * @module services/markets/errors
 */

export class ValidationError extends Error {
  constructor(code, extra = {}) {
    super(`market_validation:${code}`);
    this.name = "ValidationError";
    this.code = String(code || "invalid");
    this.field = extra.field || null;
    this.details = extra.details || null;
  }
}

export class MarketUnknownError extends Error {
  constructor(code) {
    super(`market_unknown:${code}`);
    this.name = "MarketUnknownError";
    this.code = "unknown_market";
    this.marketCode = String(code || "");
  }
}

export class MarketModuleError extends Error {
  constructor(code, details = null) {
    super(`market_module:${code}`);
    this.name = "MarketModuleError";
    this.code = String(code || "unknown");
    this.details = details;
  }
}
