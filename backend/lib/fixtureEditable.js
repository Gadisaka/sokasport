/**
 * Rules for which fixtures admins may edit in Fixture Ops.
 *
 * Default: completed (terminal) fixtures, or past-day LIVE/HT still in play.
 * Optional `includeIncompletePast`: also allow past kickoff still marked NS.
 *
 * @module lib/fixtureEditable
 */
import { isTerminalFixtureStatus } from "../services/ticketSettlementService.js";

/** In-play statuses that may remain editable after the calendar day has passed. */
export const PAST_DAY_IN_PROGRESS_STATUSES = ["LIVE", "HT"];

export function startOfTodayUtc(now = new Date()) {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function parseStartTime(fixture) {
  if (!fixture?.start_time) return null;
  const start =
    fixture.start_time instanceof Date
      ? fixture.start_time
      : new Date(fixture.start_time);
  return Number.isNaN(start.getTime()) ? null : start;
}

function isPastCalendarDay(fixture, now) {
  const start = parseStartTime(fixture);
  if (!start) return false;
  return start < startOfTodayUtc(now);
}

/**
 * @param {{ start_time?: Date | string, status?: string }} fixture
 * @param {{ now?: Date, includeIncompletePast?: boolean }} [options]
 */
export function isFixtureEditable(fixture, options = {}) {
  if (!fixture) return false;
  const now = options.now ?? new Date();
  const status = String(fixture.status || "").toUpperCase();

  if (isTerminalFixtureStatus(status)) return true;

  if (!isPastCalendarDay(fixture, now)) return false;

  if (PAST_DAY_IN_PROGRESS_STATUSES.includes(status)) return true;

  if (options.includeIncompletePast && status === "NS") return true;

  return false;
}

/**
 * @param {{ now?: Date, includeIncompletePast?: boolean }} [options]
 * @returns {import("@prisma/client").Prisma.FixtureWhereInput}
 */
export function buildEditableFixtureWhere(options = {}) {
  const now = options.now ?? new Date();
  const startOfToday = startOfTodayUtc(now);
  const or = [
    {
      status: {
        in: ["FT", "AET", "PEN", "AWD", "WO", "CANC", "ABD", "PST"],
      },
    },
    {
      AND: [
        { start_time: { lt: startOfToday } },
        { status: { in: PAST_DAY_IN_PROGRESS_STATUSES } },
      ],
    },
  ];

  if (options.includeIncompletePast) {
    or.push({
      AND: [{ start_time: { lt: startOfToday } }, { status: "NS" }],
    });
  }

  return { OR: or };
}

/**
 * @param {{ start_time?: Date | string, status?: string }} fixture
 * @param {{ now?: Date, includeIncompletePast?: boolean }} [options]
 */
export function getFixtureEditableReason(fixture, options = {}) {
  if (!fixture) return "not_found";
  if (!isFixtureEditable(fixture, options)) return "not_editable";

  const status = String(fixture.status || "").toUpperCase();
  if (isTerminalFixtureStatus(status)) return "terminal";
  if (PAST_DAY_IN_PROGRESS_STATUSES.includes(status)) return "past_in_progress";
  if (status === "NS") return "incomplete_past";
  return "editable";
}
