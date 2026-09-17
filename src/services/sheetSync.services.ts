import { Types } from 'mongoose';
import { JWT } from 'google-auth-library';
import { env, isTest } from '../config/env';
import { AppError } from '../utils/AppError';
import { AttendeeModel } from '../models/attendee.model';
import { EventModel } from '../models/event.model';
import { buildSearchText } from './event.services';

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

// Template sheets ship a locked instructions row right under the header
// (both cells literally read "do not change") — never real attendee data.
const SENTINEL_VALUE = 'do not change';

/**
 * Maps raw Sheets API rows (first row = header) into attendee shape.
 * A row missing registrantId or fullName, or matching the template's
 * "do not change" instructions row, is skipped, not fatal.
 */
export function mapSheetRows(rows: string[][]): { mapped: MappedRow[]; skipped: number } {
  if (rows.length === 0) return { mapped: [], skipped: 0 };
  const [header, ...dataRows] = rows;
  const regIdx = header.indexOf(SHEET_COLUMNS.registrantId);
  const nameIdx = header.indexOf(SHEET_COLUMNS.fullName);
  if (regIdx === -1 || nameIdx === -1) {
    return { mapped: [], skipped: dataRows.length };
  }

  let skipped = 0;
  const mapped: MappedRow[] = [];
  for (const row of dataRows) {
    const registrantId = (row[regIdx] ?? '').trim();
    const fullName = (row[nameIdx] ?? '').trim();
    if (
      registrantId.toLowerCase() === SENTINEL_VALUE ||
      fullName.toLowerCase() === SENTINEL_VALUE
    ) {
      skipped++;
      continue;
    }
    if (!registrantId || !fullName) {
      skipped++;
      continue;
    }
    const extra: Record<string, string> = {};
    header.forEach((col, i) => {
      if (i === regIdx || i === nameIdx) return;
      const value = (row[i] ?? '').trim();
      if (value) extra[col] = value;
    });
    mapped.push({ registrantId, fullName, extra });
  }
  return { mapped, skipped };
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
            searchText: buildSearchText(row.fullName, row.extra),
          },
        },
        upsert: true,
      },
    })),
  );

  return { added: result.upsertedCount, updated: result.modifiedCount };
}

export async function syncEventAttendees(
  eventId: string,
): Promise<{ added: number; updated: number; skipped: number; total: number }> {
  const event = await EventModel.findById(eventId);
  if (!event) throw new AppError(404, 'Event not found');
  if (!event.sheetId) throw new AppError(400, 'Event is not linked to a sheet');

  const rows = await fetchSheetRows(event.sheetId);
  const { mapped, skipped } = mapSheetRows(rows);
  const { added, updated } = await syncRowsIntoEvent(eventId, mapped);

  event.lastSyncedAt = new Date();
  await event.save();

  return { added, updated, skipped, total: mapped.length + skipped };
}
