/**
 * End-to-end verification against an ephemeral in-memory MongoDB.
 * Boots a real mongod, points the app at it, starts the HTTP server,
 * authenticates via the test-token bypass, and exercises every endpoint.
 *
 * Run: npx tsx scripts/verify.ts
 * This is a dev/demo aid — not part of the running service.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

let pass = 0;
let fail = 0;

function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}`, detail !== undefined ? JSON.stringify(detail) : '');
  }
}

async function main() {
  const mongo = await MongoMemoryServer.create();
  process.env.NODE_ENV = 'test'; // silences request logging, enables the auth test bypass
  process.env.MONGODB_URI = mongo.getUri('roadshow_badges');
  process.env.PORT = '4055';
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.JWT_SECRET = 'test-secret-at-least-16-chars-long';
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'test-sheet-sync@example.iam.gserviceaccount.com';
  process.env.GOOGLE_SERVICE_ACCOUNT_KEY =
    'test-key-unused-because-fetchSheetRows-is-stubbed-in-test-mode';

  // Import AFTER env is set so config/env picks up the in-memory URI.
  const { createApp } = await import('../src/app');
  const { connectDb } = await import('../src/config/db');
  const mongoose = (await import('mongoose')).default;

  // Sheet sync: pure column mapping (no DB, no network needed)
  const { extractSheetId, mapSheetRows } = await import('../src/services/sheetSync.services');

  check(
    'extractSheetId parses a standard Sheets URL',
    extractSheetId('https://docs.google.com/spreadsheets/d/abc123XYZ/edit#gid=0') === 'abc123XYZ',
  );
  check(
    'extractSheetId returns null for a non-Sheets URL',
    extractSheetId('https://example.com') === null,
  );

  const mapResult = mapSheetRows([
    ['Reg. Number', 'First Name', 'Last Name', 'Occupation', 'Full Name'],
    ['R1', 'Jane', 'Doe', 'Engineer', 'Jane Doe'],
    ['', 'No', 'Reg', 'Id', 'No Reg Id'], // missing registrantId → skipped
    ['R2', 'John', '', '', 'John Smith'],
  ]);
  check('mapSheetRows maps 2 valid rows', mapResult.mapped.length === 2, mapResult);
  check('mapSheetRows skips 1 row missing registrantId', mapResult.skipped === 1, mapResult);
  check(
    'mapSheetRows puts Occupation into extra',
    mapResult.mapped[0].extra.Occupation === 'Engineer',
    mapResult.mapped[0],
  );
  check(
    'mapSheetRows omits empty extra values',
    !('Last Name' in mapResult.mapped[1].extra),
    mapResult.mapped[1],
  );

  const { fetchSheetRows, __setTestSheetRows } = await import('../src/services/sheetSync.services');

  check(
    'fetchSheetRows returns [] for an unset sheetId',
    (await fetchSheetRows('unset-sheet')).length === 0,
  );

  __setTestSheetRows('fixture-sheet-1', [
    ['Reg. Number', 'First Name', 'Last Name', 'Occupation', 'Full Name'],
    ['R1', 'Jane', 'Doe', 'Engineer', 'Jane Doe'],
  ]);
  const fixtureRows = await fetchSheetRows('fixture-sheet-1');
  check(
    'fetchSheetRows returns the fixture rows set for a sheetId',
    fixtureRows.length === 2,
    fixtureRows,
  );

  await connectDb();
  const app = createApp();
  const server = app.listen(4055);
  const base = 'http://localhost:4055/api';

  // --- cookie jar: capture Set-Cookie from login, replay it on later requests ---
  let sessionCookie = '';
  function captureCookie(res: Response) {
    const set = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    const sess = set.find((c) => c.startsWith('session='));
    if (sess) sessionCookie = sess.split(';')[0];
  }
  function afetch(path: string, init: RequestInit = {}) {
    const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
    if (sessionCookie) headers.Cookie = sessionCookie;
    return fetch(`${base}${path}`, { ...init, headers });
  }
  const testToken = (p: { sub: string; email: string; name: string; picture: string }) =>
    'test|' + JSON.stringify(p);

  try {
    // health (public)
    const health = await fetch(`${base}/health`).then((r) => r.json());
    check('GET /health → {ok:true}', health.ok === true, health);

    // --- AUTH ---
    // guarded route without a session → 401
    const noAuth = await fetch(`${base}/events`);
    check('GET /events without session → 401', noAuth.status === 401, noAuth.status);

    // google login (stubbed via test bypass) → new user + cookie
    const profile = {
      sub: 'g-1',
      email: 'op@itcom.uz',
      name: 'Operator One',
      picture: 'http://img/1.png',
    };
    const loginRes = await fetch(`${base}/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: testToken(profile) }),
    });
    captureCookie(loginRes);
    const login = await loginRes.json();
    check(
      'POST /auth/google → 200, isNewUser=true',
      loginRes.status === 200 && login.isNewUser === true,
      login,
    );
    check('login set a session cookie', sessionCookie.startsWith('session='), sessionCookie);
    check('new user onboardedAt is null', login.user.onboardedAt === null, login.user);

    // login again with same sub → existing user
    const login2 = await fetch(`${base}/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: testToken(profile) }),
    }).then((r) => r.json());
    check('POST /auth/google again → isNewUser=false', login2.isNewUser === false, login2);

    // bad token → 401
    const badToken = await fetch(`${base}/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: 'not-a-valid-token' }),
    });
    check('POST /auth/google bad token → 401', badToken.status === 401, badToken.status);

    // /auth/me with cookie
    const meBody = await afetch('/auth/me').then((r) => r.json());
    check('GET /auth/me → user email', meBody.user.email === 'op@itcom.uz', meBody);

    // /auth/me without cookie → 401
    const meNo = await fetch(`${base}/auth/me`);
    check('GET /auth/me without cookie → 401', meNo.status === 401, meNo.status);

    // confirm name (onboarding step)
    const patched = await afetch('/auth/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: 'Operator Uno' }),
    }).then((r) => r.json());
    check(
      'PATCH /auth/me → name updated + onboardedAt set',
      patched.user.displayName === 'Operator Uno' && patched.user.onboardedAt !== null,
      patched,
    );

    // --- EVENTS / ATTENDEES (now require the session cookie) ---
    const createRes = await afetch('/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Roadshow June',
        date: '2026-06-20',
        attendees: [
          { fullName: 'john smith', extra: { role: 'Speaker' } },
          { fullName: 'jane doe', extra: {} },
        ],
      }),
    });
    const created = await createRes.json();
    check('POST /events → 201', createRes.status === 201, createRes.status);
    check('POST /events → attendeeCount=2', created.attendeeCount === 2, created);
    check('POST /events → authorName stamped', created.authorName === 'Operator Uno', created);
    const eventId = created._id;

    // empty attendees → 400
    const badRes = await afetch('/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'X', date: '2026-01-01', attendees: [] }),
    });
    check('POST /events with no attendees → 400', badRes.status === 400, badRes.status);

    // list events → attendeeCount + printedCount present (nothing printed yet)
    const events = await afetch('/events').then((r) => r.json());
    check(
      'GET /events → attendeeCount=2, printedCount=0',
      Array.isArray(events) && events[0]?.attendeeCount === 2 && events[0]?.printedCount === 0,
      events,
    );

    // get one
    const one = await afetch(`/events/${eventId}`).then((r) => r.json());
    check('GET /events/:id → matching event', one._id === eventId, one);

    // unknown event → 404
    const missing = await afetch('/events/0123456789abcdef01234567');
    check('GET /events/:unknown → 404', missing.status === 404, missing.status);

    // malformed ObjectId → 400
    const badId = await afetch('/events/not-an-objectid');
    check('GET /events/:malformed → 400', badId.status === 400, badId.status);

    // unknown route → JSON 404
    const unknownRoute = await afetch('/nope');
    const unknownBody = await unknownRoute.json().catch(() => null);
    check(
      'GET /api/nope → JSON 404',
      unknownRoute.status === 404 && unknownBody?.error === 'NotFound',
      unknownBody,
    );

    // malformed JSON body → 400
    const badJson = await afetch('/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ this is not json',
    });
    check('POST /events with bad JSON → 400', badJson.status === 400, badJson.status);

    // search by name
    const searchJane = await afetch(`/events/${eventId}/attendees?search=jane`).then((r) =>
      r.json(),
    );
    check(
      'GET attendees?search=jane → only Jane',
      searchJane.length === 1 && searchJane[0].fullName === 'jane doe',
      searchJane,
    );

    // search hits denormalized extra (role=Speaker)
    const searchRole = await afetch(`/events/${eventId}/attendees?search=speaker`).then((r) =>
      r.json(),
    );
    check(
      'GET attendees?search=speaker → only John',
      searchRole.length === 1 && searchRole[0].fullName === 'john smith',
      searchRole,
    );

    // filter by status
    const notPrinted = await afetch(`/events/${eventId}/attendees?status=not_printed`).then((r) =>
      r.json(),
    );
    check('GET attendees?status=not_printed → both', notPrinted.length === 2, notPrinted);

    // invalid status → 400
    const badStatus = await afetch(`/events/${eventId}/attendees?status=bogus`);
    check('GET attendees?status=bogus → 400', badStatus.status === 400, badStatus.status);

    // print (first time)
    const janeId = searchJane[0]._id;
    const printed1 = await afetch(`/attendees/${janeId}/print`, { method: 'POST' }).then((r) =>
      r.json(),
    );
    check(
      'POST print → printStatus=printed, count=1',
      printed1.printStatus === 'printed' && printed1.printCount === 1,
      printed1,
    );
    check(
      'POST print → lastPrintedAt set',
      printed1.lastPrintedAt !== null,
      printed1.lastPrintedAt,
    );

    // reprint
    const printed2 = await afetch(`/attendees/${janeId}/print`, { method: 'POST' }).then((r) =>
      r.json(),
    );
    check('POST print again (reprint) → count=2', printed2.printCount === 2, printed2);

    // status filter reflects the print
    const printedList = await afetch(`/events/${eventId}/attendees?status=printed`).then((r) =>
      r.json(),
    );
    check(
      'GET attendees?status=printed → only Jane',
      printedList.length === 1 && printedList[0]._id === janeId,
      printedList,
    );

    // list events again → printedCount reflects the print
    const eventsAfterPrint = await afetch('/events').then((r) => r.json());
    check(
      'GET /events after print → printedCount=1',
      eventsAfterPrint[0]?.printedCount === 1,
      eventsAfterPrint,
    );

    // print unknown attendee → 404
    const printMissing = await afetch('/attendees/0123456789abcdef01234567/print', {
      method: 'POST',
    });
    check('POST print unknown attendee → 404', printMissing.status === 404, printMissing.status);

    // --- BADGE TEMPLATES ---
    // GET seeds and returns the default
    const templates = await afetch('/templates').then((r) => r.json());
    check(
      'GET /templates → seeds a default',
      Array.isArray(templates) &&
        templates.length >= 1 &&
        templates.some((t: { isDefault: boolean }) => t.isDefault),
      templates,
    );
    const defaultTemplate = templates.find((t: { isDefault: boolean }) => t.isDefault);

    // GET /templates again → still exactly one default (idempotent seed)
    const templates2 = await afetch('/templates').then((r) => r.json());
    check(
      'GET /templates twice → exactly one default',
      templates2.filter((t: { isDefault: boolean }) => t.isDefault).length === 1,
      templates2,
    );

    // GET one
    const oneTemplate = await afetch(`/templates/${defaultTemplate._id}`).then((r) => r.json());
    check('GET /templates/:id → matching', oneTemplate._id === defaultTemplate._id, oneTemplate);

    // unknown template → 404
    const missingT = await afetch('/templates/0123456789abcdef01234567');
    check('GET /templates/:unknown → 404', missingT.status === 404, missingT.status);

    // field-keys includes the seeded attendee's extra key 'role'
    const fieldKeys = await afetch('/templates/field-keys').then((r) => r.json());
    check(
      'GET /templates/field-keys → includes "role"',
      Array.isArray(fieldKeys) && fieldKeys.includes('role'),
      fieldKeys,
    );

    // create a custom template
    const createTRes = await afetch('/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Speaker badge',
        labelWidthMm: 90,
        labelHeightMm: 60,
        zones: [
          { id: 'n', field: 'fullName', fontSize: 14, bold: true, align: 'center', hidden: false },
          { id: 'r', field: 'role', fontSize: 12, bold: false, align: 'center', hidden: false },
        ],
      }),
    });
    const customTemplate = await createTRes.json();
    check('POST /templates → 201', createTRes.status === 201, createTRes.status);
    check('POST /templates → isDefault false', customTemplate.isDefault === false, customTemplate);

    // bad template body → 400
    const badTRes = await afetch('/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '', zones: [] }),
    });
    check('POST /templates empty name → 400', badTRes.status === 400, badTRes.status);

    // update it
    const updTRes = await afetch(`/templates/${customTemplate._id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Speaker badge v2',
        labelWidthMm: 90,
        labelHeightMm: 60,
        zones: [
          { id: 'n', field: 'fullName', fontSize: 6, bold: true, align: 'left', hidden: false },
        ],
      }),
    });
    const updatedTemplate = await updTRes.json();
    check(
      'PUT /templates/:id → name + zones updated',
      updatedTemplate.name === 'Speaker badge v2' && updatedTemplate.zones.length === 1,
      updatedTemplate,
    );

    // cannot delete the default
    const delDefault = await afetch(`/templates/${defaultTemplate._id}`, { method: 'DELETE' });
    check('DELETE default template → 400', delDefault.status === 400, delDefault.status);

    // assign the custom template to the event
    const setT = await afetch(`/events/${eventId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: customTemplate._id }),
    }).then((r) => r.json());
    check(
      'PATCH /events/:id → templateId set',
      String(setT.templateId) === customTemplate._id,
      setT,
    );

    // bad templateId (not an ObjectId) → 400
    const badAssign = await afetch(`/events/${eventId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: 'nope' }),
    });
    check('PATCH /events/:id bad templateId → 400', badAssign.status === 400, badAssign.status);

    // unknown templateId → 404
    const missingAssign = await afetch(`/events/${eventId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: '0123456789abcdef01234567' }),
    });
    check(
      'PATCH /events/:id unknown template → 404',
      missingAssign.status === 404,
      missingAssign.status,
    );

    // delete the custom one
    const delCustom = await afetch(`/templates/${customTemplate._id}`, { method: 'DELETE' });
    check('DELETE custom template → 200', delCustom.status === 200, delCustom.status);
    const afterDelete = await afetch(`/templates/${customTemplate._id}`);
    check('GET deleted template → 404', afterDelete.status === 404, afterDelete.status);

    // deleting the assigned template reverted the event to the default (null)
    const eventAfterTDelete = await afetch(`/events/${eventId}`).then((r) => r.json());
    check(
      'event templateId reverts to null after its template is deleted',
      eventAfterTDelete.templateId === null,
      eventAfterTDelete,
    );

    // assign null explicitly → stays null
    const setNull = await afetch(`/events/${eventId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: null }),
    }).then((r) => r.json());
    check('PATCH /events/:id templateId null → null', setNull.templateId === null, setNull);

    // --- EVENT EDIT / TRASH / RESTORE / PERMANENT DELETE ---
    const { EventModel: TrashEventModel } = await import('../src/models/event.model');
    const { AttendeeModel: TrashAttendeeModel } = await import('../src/models/attendee.model');

    // rename + reschedule via the broadened PATCH
    const renamed = await afetch(`/events/${eventId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Roadshow June (Updated)', date: '2026-06-21' }),
    }).then((r) => r.json());
    check(
      'PATCH /events/:id → name + date updated',
      renamed.name === 'Roadshow June (Updated)' &&
        new Date(renamed.date).toISOString().startsWith('2026-06-21'),
      renamed,
    );

    // empty patch body → 400 (schema requires at least one field)
    const emptyPatch = await afetch(`/events/${eventId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    check('PATCH /events/:id empty body → 400', emptyPatch.status === 400, emptyPatch.status);

    // create a disposable event to soft/hard-delete without disturbing eventId
    const trashCreateRes = await afetch('/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Trash Me',
        date: '2026-07-01',
        attendees: [{ fullName: 'Doomed Attendee', extra: {} }],
      }),
    });
    const trashEvent = await trashCreateRes.json();
    const trashEventId = trashEvent._id;

    // soft delete (DELETE /:id → trash)
    const softDel = await afetch(`/events/${trashEventId}`, { method: 'DELETE' });
    check('DELETE /events/:id → 200 (soft delete)', softDel.status === 200, softDel.status);

    const eventsAfterTrash = await afetch('/events').then((r) => r.json());
    check(
      'GET /events excludes trashed event',
      !eventsAfterTrash.some((e: { _id: string }) => e._id === trashEventId),
      eventsAfterTrash,
    );

    const getTrashed = await afetch(`/events/${trashEventId}`);
    check('GET /events/:id on trashed event → 404', getTrashed.status === 404, getTrashed.status);

    const trashList = await afetch('/events/trash').then((r) => r.json());
    check(
      'GET /events/trash includes it',
      trashList.some((e: { _id: string }) => e._id === trashEventId),
      trashList,
    );

    // restore
    const restoreRes = await afetch(`/events/${trashEventId}/restore`, { method: 'POST' });
    const restored = await restoreRes.json();
    check(
      'POST /events/:id/restore → 200, deletedAt cleared',
      restoreRes.status === 200 && restored.deletedAt === null,
      restored,
    );

    const eventsAfterRestore = await afetch('/events').then((r) => r.json());
    check(
      'GET /events includes restored event',
      eventsAfterRestore.some((e: { _id: string }) => e._id === trashEventId),
      eventsAfterRestore,
    );

    // restoring a non-trashed event → 404
    const restoreNotTrashed = await afetch(`/events/${trashEventId}/restore`, { method: 'POST' });
    check(
      'POST /events/:id/restore on a non-trashed event → 404',
      restoreNotTrashed.status === 404,
      restoreNotTrashed.status,
    );

    // permanent delete requires the event to be trashed first
    const permBeforeTrash = await afetch(`/events/${trashEventId}/permanent`, { method: 'DELETE' });
    check(
      'DELETE /events/:id/permanent on a non-trashed event → 404',
      permBeforeTrash.status === 404,
      permBeforeTrash.status,
    );

    await afetch(`/events/${trashEventId}`, { method: 'DELETE' }); // trash it again
    const permDel = await afetch(`/events/${trashEventId}/permanent`, { method: 'DELETE' });
    check('DELETE /events/:id/permanent → 200', permDel.status === 200, permDel.status);

    const attendeesAfterPermDelete = await TrashAttendeeModel.find({
      eventId: trashEventId,
    }).lean();
    check(
      'permanent delete cascades to attendees',
      attendeesAfterPermDelete.length === 0,
      attendeesAfterPermDelete,
    );

    const trashListAfterPerm = await afetch('/events/trash').then((r) => r.json());
    check(
      'GET /events/trash no longer includes permanently deleted event',
      !trashListAfterPerm.some((e: { _id: string }) => e._id === trashEventId),
      trashListAfterPerm,
    );

    // lazy purge: an event trashed 46 days ago is hard-deleted the next time trash is listed
    const expiredCreateRes = await afetch('/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Long Gone',
        date: '2026-01-01',
        attendees: [{ fullName: 'Old Attendee', extra: {} }],
      }),
    });
    const expiredEvent = await expiredCreateRes.json();
    const fortySixDaysAgo = new Date(Date.now() - 46 * 24 * 60 * 60 * 1000);
    await TrashEventModel.findByIdAndUpdate(expiredEvent._id, { deletedAt: fortySixDaysAgo });

    const trashListAfterExpiry = await afetch('/events/trash').then((r) => r.json());
    check(
      'GET /events/trash lazily purges items past 45 days',
      !trashListAfterExpiry.some((e: { _id: string }) => e._id === expiredEvent._id),
      trashListAfterExpiry,
    );
    const expiredAttendees = await TrashAttendeeModel.find({ eventId: expiredEvent._id }).lean();
    check('lazy purge cascades to attendees', expiredAttendees.length === 0, expiredAttendees);

    // --- SHEET-LINKED EVENTS: creation + on-demand sync over HTTP ---
    __setTestSheetRows('fixture-sheet-3', [
      ['Reg. Number', 'First Name', 'Last Name', 'Occupation', 'Full Name'],
      ['R1', 'Alice', 'Lee', 'Designer', 'Alice Lee'],
    ]);
    const createSheetEventRes = await afetch('/events/sheet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Bot Event',
        date: '2026-10-01',
        sheetUrl: 'https://docs.google.com/spreadsheets/d/fixture-sheet-3/edit',
      }),
    });
    const sheetEvent = await createSheetEventRes.json();
    check('POST /events/sheet → 201', createSheetEventRes.status === 201, sheetEvent);
    check('POST /events/sheet → initial roster of 1', sheetEvent.added === 1, sheetEvent);

    __setTestSheetRows('fixture-sheet-3', [
      ['Reg. Number', 'First Name', 'Last Name', 'Occupation', 'Full Name'],
      ['R1', 'Alice', 'Lee', 'Designer', 'Alice Lee'],
      ['R2', 'Bob', 'Kim', 'PM', 'Bob Kim'], // walk-in registers mid-event
    ]);
    const syncRes = await afetch(`/events/${sheetEvent._id}/sync-sheet`, { method: 'POST' });
    const syncBody = await syncRes.json();
    check('POST /events/:id/sync-sheet → picks up the walk-in', syncBody.added === 1, syncBody);

    const notLinkedEvents = await afetch('/events').then((r) => r.json());
    const xlsxEvent = notLinkedEvents.find((e: { sheetId: string | null }) => !e.sheetId);
    const badSyncRes = await afetch(`/events/${xlsxEvent._id}/sync-sheet`, { method: 'POST' });
    check(
      'POST /events/:id/sync-sheet on an XLSX event → 400',
      badSyncRes.status === 400,
      badSyncRes.status,
    );

    const badUrlRes = await afetch('/events/sheet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Bad',
        date: '2026-10-01',
        sheetUrl: 'https://example.com/not-a-sheet',
      }),
    });
    check(
      'POST /events/sheet with unparseable URL → 400',
      badUrlRes.status === 400,
      badUrlRes.status,
    );

    // --- SHEET SYNC: upsert + orchestration (needs DB, no HTTP required) ---
    const { syncEventAttendees } = await import('../src/services/sheetSync.services');
    const { EventModel: SyncEventModel } = await import('../src/models/event.model');
    const { AttendeeModel: SyncAttendeeModel } = await import('../src/models/attendee.model');

    const syncEvent = await SyncEventModel.create({
      name: 'Sync Test Event',
      date: new Date(),
      authorId: new mongoose.Types.ObjectId(),
      sheetId: 'fixture-sheet-2',
    });

    check(
      'syncEventAttendees → 400 when event has no sheetId',
      await SyncEventModel.create({
        name: 'No Sheet',
        date: new Date(),
        authorId: new mongoose.Types.ObjectId(),
      })
        .then((e) => syncEventAttendees(String(e._id)))
        .then(
          () => false,
          (err) => err.status === 400,
        ),
    );

    __setTestSheetRows('fixture-sheet-2', [
      ['Reg. Number', 'First Name', 'Last Name', 'Occupation', 'Full Name'],
      ['R1', 'Jane', 'Doe', 'Engineer', 'Jane Doe'],
    ]);
    const firstSync = await syncEventAttendees(String(syncEvent._id));
    check(
      'first sync → 1 added, 0 updated',
      firstSync.added === 1 && firstSync.updated === 0,
      firstSync,
    );

    __setTestSheetRows('fixture-sheet-2', [
      ['Reg. Number', 'First Name', 'Last Name', 'Occupation', 'Full Name'],
      ['R1', 'Jane', 'Doe', 'Senior Engineer', 'Jane Doe'], // Occupation changed
      ['R2', 'John', 'Smith', '', 'John Smith'], // new registrant (walk-in)
    ]);
    const secondSync = await syncEventAttendees(String(syncEvent._id));
    check(
      'second sync → 1 added (walk-in), 1 updated (changed)',
      secondSync.added === 1 && secondSync.updated === 1,
      secondSync,
    );

    const attendeesAfterSync = await SyncAttendeeModel.find({ eventId: syncEvent._id }).lean();
    check(
      'event now has 2 attendees total',
      attendeesAfterSync.length === 2,
      attendeesAfterSync.length,
    );
    check(
      "Jane's occupation was updated in place, not duplicated",
      attendeesAfterSync.find((a) => a.registrantId === 'R1')?.extra.Occupation ===
        'Senior Engineer',
      attendeesAfterSync.find((a) => a.registrantId === 'R1'),
    );

    // --- LOGOUT ---
    const logoutRes = await afetch('/auth/logout', { method: 'POST' });
    check('POST /auth/logout → 204', logoutRes.status === 204, logoutRes.status);
    sessionCookie = ''; // simulate the cleared cookie
    const afterLogout = await fetch(`${base}/auth/me`);
    check('GET /auth/me after logout → 401', afterLogout.status === 401, afterLogout.status);
  } finally {
    server.close();
    await mongoose.disconnect();
    await mongo.stop();
  }

  console.log(`\n${fail === 0 ? 'ALL PASSED' : 'FAILURES'}: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('verify crashed:', err);
  process.exit(1);
});
