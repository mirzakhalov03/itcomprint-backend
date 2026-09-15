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

/**
 * Maps raw Sheets API rows (first row = header) into attendee shape.
 * A row missing registrantId or fullName is skipped, not fatal.
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
