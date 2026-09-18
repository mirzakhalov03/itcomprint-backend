import { Types } from 'mongoose';
import { JWT } from 'google-auth-library';
import { env, isTest } from '../config/env';
import { AppError } from '../utils/AppError';
import { AttendeeModel } from '../models/attendee.model';
import { EventModel } from '../models/event.model';

export function extractSheetId(url: string): string | null {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}

export const SHEET_COLUMNS = {
  registrantId: 'Reg. Number',
  fullName: 'Full Name',
} as const;

export interface MappedRow {
  registrantId: string;
  fullName: string;
  extra: Record<string, string>;
}

export type SheetIssueReason = 'missing_name' | 'missing_id' | 'duplicate_id';

/** A half-filled sheet row the sync couldn't import — surfaced so operators can fix the sheet. */
export interface SheetIssue {
  row: number; // 1-based sheet row, as Google Sheets shows it
  registrantId: string;
  fullName: string;
  reason: SheetIssueReason;
}

// Template sheets ship a locked instructions row right under the header
// (both cells literally read "do not change") — never real attendee data.
const SENTINEL_VALUE = 'do not change';
// Pre-seeded walk-in slots ("manual-001", …) stay nameless until someone fills them in.
const PLACEHOLDER_ID = /^manual-\d+$/i;

/**
 * Maps raw Sheets API rows (first row = header) into attendee shape.
 * A row missing registrantId or fullName, a repeated registrantId, or the
 * template's "do not change" row is skipped, not fatal. Half-filled rows and
 * duplicates are also reported as issues; blank rows and placeholders are not.
 */
export function mapSheetRows(rows: string[][]): {
  mapped: MappedRow[];
  skipped: number;
  issues: SheetIssue[];
} {
  if (rows.length === 0) return { mapped: [], skipped: 0, issues: [] };
  const [header, ...dataRows] = rows;
  const regIdx = header.indexOf(SHEET_COLUMNS.registrantId);
  const nameIdx = header.indexOf(SHEET_COLUMNS.fullName);
  if (regIdx === -1 || nameIdx === -1) {
    return { mapped: [], skipped: dataRows.length, issues: [] };
  }

  let skipped = 0;
  const mapped: MappedRow[] = [];
  const issues: SheetIssue[] = [];
  const seen = new Set<string>();
  dataRows.forEach((row, i) => {
    const registrantId = (row[regIdx] ?? '').trim();
    const fullName = (row[nameIdx] ?? '').trim();
    const issue = (reason: SheetIssueReason) =>
      issues.push({ row: i + 2, registrantId, fullName, reason });

    if (
      registrantId.toLowerCase() === SENTINEL_VALUE ||
      fullName.toLowerCase() === SENTINEL_VALUE
    ) {
      skipped++;
      return;
    }
    if (!registrantId || !fullName) {
      skipped++;
      if (fullName) issue('missing_id');
      else if (registrantId && !PLACEHOLDER_ID.test(registrantId)) issue('missing_name');
      return;
    }
    // First row wins; a later copy would otherwise silently overwrite it.
    if (seen.has(registrantId)) {
      skipped++;
      issue('duplicate_id');
      return;
    }
    seen.add(registrantId);

    const extra: Record<string, string> = {};
    header.forEach((col, j) => {
      if (j === regIdx || j === nameIdx) return;
      const value = (row[j] ?? '').trim();
      if (value) extra[col] = value;
    });
    mapped.push({ registrantId, fullName, extra });
  });
  return { mapped, skipped, issues };
}

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

let jwtClient: JWT | null = null;
function getJwtClient(): JWT {
  if (!jwtClient) {
    jwtClient = new JWT({
      email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: env.GOOGLE_SERVICE_ACCOUNT_KEY.replace(/\\n/g, '\n'),
      scopes: [SHEETS_SCOPE],
    });
  }
  return jwtClient;
}

/**
 * TEST BYPASS: when NODE_ENV=test, rows come from an in-memory fixture set
 * via __setTestSheetRows instead of a real Sheets API call — mirrors the
 * test|{...} bypass pattern in auth.services.ts. isTest is false outside
 * the verify harness, so this branch is dead code in dev/prod.
 */
const testRowsBySheetId = new Map<string, string[][]>();

export function __setTestSheetRows(sheetId: string, rows: string[][]): void {
  if (!isTest) throw new Error('__setTestSheetRows is test-only');
  testRowsBySheetId.set(sheetId, rows);
}

export async function fetchSheetRows(sheetId: string): Promise<string[][]> {
  if (isTest) {
    return testRowsBySheetId.get(sheetId) ?? [];
  }
  const client = getJwtClient();
  try {
    const res = await client.request<{ values?: string[][] }>({
      url: `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A:Z`,
    });
    return res.data.values ?? [];
  } catch (err) {
    console.error('[sheetSync] fetchSheetRows failed for sheetId', sheetId, err);
    throw new AppError(
      400,
      `Can't read this Google Sheet — share it with ${env.GOOGLE_SERVICE_ACCOUNT_EMAIL} and try again.`,
    );
  }
}

export async function syncRowsIntoEvent(
  eventId: string,
  rows: MappedRow[],
): Promise<{ added: number; updated: number }> {
  if (rows.length === 0) return { added: 0, updated: 0 };

  // Cast explicitly: the schema declares eventId as ObjectId, but this
  // function takes a string (as callers — e.g. route params — have it).
  // Mongoose casts bulkWrite filter/update documents against the schema
  // at runtime either way, but the typed bulkWrite() overload requires the
  // shape to already match AttendeeDoc, so TS needs the cast too.
  const eventObjectId = new Types.ObjectId(eventId);

  const result = await AttendeeModel.bulkWrite(
    rows.map((row) => ({
      updateOne: {
        filter: { eventId: eventObjectId, registrantId: row.registrantId },
        update: {
          $set: {
            eventId: eventObjectId,
            registrantId: row.registrantId,
            fullName: row.fullName,
            extra: row.extra,
            removedAt: null, // back on the sheet → back on the roster
          },
        },
        upsert: true,
      },
    })),
  );

  return { added: result.upsertedCount, updated: result.modifiedCount };
}

/** Soft-removes sheet attendees whose row is gone, keeping their print history. */
export async function markRemovedAttendees(eventId: string, keepIds: string[]): Promise<number> {
  const result = await AttendeeModel.updateMany(
    {
      eventId: new Types.ObjectId(eventId),
      registrantId: { $exists: true, $nin: keepIds },
      removedAt: null,
    },
    { $set: { removedAt: new Date() } },
  );
  return result.modifiedCount;
}

export async function syncEventAttendees(eventId: string): Promise<{
  added: number;
  updated: number;
  removed: number;
  skipped: number;
  total: number;
  issues: SheetIssue[];
  lastSyncedAt: Date;
}> {
  const event = await EventModel.findOne({ _id: eventId, deletedAt: null });
  if (!event) throw new AppError(404, 'Event not found');
  if (!event.sheetId) throw new AppError(400, 'Event is not linked to a sheet');

  const rows = await fetchSheetRows(event.sheetId);
  const { mapped, skipped, issues } = mapSheetRows(rows);
  const { added, updated } = await syncRowsIntoEvent(eventId, mapped);
  // An empty mapping means a renamed header or blank read, never "everyone left" — don't wipe the roster.
  const removed =
    mapped.length > 0
      ? await markRemovedAttendees(
          eventId,
          mapped.map((r) => r.registrantId),
        )
      : 0;

  event.lastSyncedAt = new Date();
  await event.save();

  return {
    added,
    updated,
    removed,
    skipped,
    total: mapped.length + skipped,
    issues,
    lastSyncedAt: event.lastSyncedAt!,
  };
}
