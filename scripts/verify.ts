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

  // Import AFTER env is set so config/env picks up the in-memory URI.
  const { createApp } = await import('../src/app');
  const { connectDb } = await import('../src/config/db');
  const mongoose = (await import('mongoose')).default;

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
    const profile = { sub: 'g-1', email: 'op@itcom.uz', name: 'Operator One', picture: 'http://img/1.png' };
    const loginRes = await fetch(`${base}/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: testToken(profile) }),
    });
    captureCookie(loginRes);
    const login = await loginRes.json();
    check('POST /auth/google → 200, isNewUser=true', loginRes.status === 200 && login.isNewUser === true, login);
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
    check('GET /api/nope → JSON 404', unknownRoute.status === 404 && unknownBody?.error === 'NotFound', unknownBody);

    // malformed JSON body → 400
    const badJson = await afetch('/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ this is not json',
    });
    check('POST /events with bad JSON → 400', badJson.status === 400, badJson.status);

    // search by name
    const searchJane = await afetch(`/events/${eventId}/attendees?search=jane`).then((r) => r.json());
    check('GET attendees?search=jane → only Jane', searchJane.length === 1 && searchJane[0].fullName === 'jane doe', searchJane);

    // search hits denormalized extra (role=Speaker)
    const searchRole = await afetch(`/events/${eventId}/attendees?search=speaker`).then((r) => r.json());
    check('GET attendees?search=speaker → only John', searchRole.length === 1 && searchRole[0].fullName === 'john smith', searchRole);

    // filter by status
    const notPrinted = await afetch(`/events/${eventId}/attendees?status=not_printed`).then((r) => r.json());
    check('GET attendees?status=not_printed → both', notPrinted.length === 2, notPrinted);

    // invalid status → 400
    const badStatus = await afetch(`/events/${eventId}/attendees?status=bogus`);
    check('GET attendees?status=bogus → 400', badStatus.status === 400, badStatus.status);

    // print (first time)
    const janeId = searchJane[0]._id;
    const printed1 = await afetch(`/attendees/${janeId}/print`, { method: 'POST' }).then((r) => r.json());
    check('POST print → printStatus=printed, count=1', printed1.printStatus === 'printed' && printed1.printCount === 1, printed1);
    check('POST print → lastPrintedAt set', printed1.lastPrintedAt !== null, printed1.lastPrintedAt);

    // reprint
    const printed2 = await afetch(`/attendees/${janeId}/print`, { method: 'POST' }).then((r) => r.json());
    check('POST print again (reprint) → count=2', printed2.printCount === 2, printed2);

    // status filter reflects the print
    const printedList = await afetch(`/events/${eventId}/attendees?status=printed`).then((r) => r.json());
    check('GET attendees?status=printed → only Jane', printedList.length === 1 && printedList[0]._id === janeId, printedList);

    // list events again → printedCount reflects the print
    const eventsAfterPrint = await afetch('/events').then((r) => r.json());
    check(
      'GET /events after print → printedCount=1',
      eventsAfterPrint[0]?.printedCount === 1,
      eventsAfterPrint,
    );

    // print unknown attendee → 404
    const printMissing = await afetch('/attendees/0123456789abcdef01234567/print', { method: 'POST' });
    check('POST print unknown attendee → 404', printMissing.status === 404, printMissing.status);

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
