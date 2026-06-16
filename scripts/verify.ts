/**
 * End-to-end verification against an ephemeral in-memory MongoDB.
 * Boots a real mongod, points the app at it, starts the HTTP server,
 * and exercises every endpoint from the plan's self-review checklist.
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
  process.env.NODE_ENV = 'test'; // silences request logging, keeps output clean
  process.env.MONGODB_URI = mongo.getUri('roadshow_badges');
  process.env.PORT = '4055';

  // Import AFTER env is set so config/env picks up the in-memory URI.
  const { createApp } = await import('../src/app');
  const { connectDb } = await import('../src/config/db');
  const mongoose = (await import('mongoose')).default;

  await connectDb();
  const app = createApp();
  const server = app.listen(4055);
  const base = 'http://localhost:4055/api';

  try {
    // health
    const health = await fetch(`${base}/health`).then((r) => r.json());
    check('GET /health → {ok:true}', health.ok === true, health);

    // create event + attendees (bulk)
    const createRes = await fetch(`${base}/events`, {
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
    const eventId = created._id;

    // validation: empty attendees should 400
    const badRes = await fetch(`${base}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'X', date: '2026-01-01', attendees: [] }),
    });
    check('POST /events with no attendees → 400', badRes.status === 400, badRes.status);

    // list events → attendeeCount present
    const events = await fetch(`${base}/events`).then((r) => r.json());
    check('GET /events → array with attendeeCount=2', Array.isArray(events) && events[0]?.attendeeCount === 2, events);

    // get one
    const one = await fetch(`${base}/events/${eventId}`).then((r) => r.json());
    check('GET /events/:id → matching event', one._id === eventId, one);

    // get unknown event → 404
    const missing = await fetch(`${base}/events/0123456789abcdef01234567`);
    check('GET /events/:unknown → 404', missing.status === 404, missing.status);

    // malformed ObjectId → 400 (not 500)
    const badId = await fetch(`${base}/events/not-an-objectid`);
    check('GET /events/:malformed → 400', badId.status === 400, badId.status);

    // unknown route → JSON 404
    const unknownRoute = await fetch(`${base}/nope`);
    const unknownBody = await unknownRoute.json().catch(() => null);
    check('GET /api/nope → JSON 404', unknownRoute.status === 404 && unknownBody?.error === 'NotFound', unknownBody);

    // malformed JSON body → 400 (not 500)
    const badJson = await fetch(`${base}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ this is not json',
    });
    check('POST /events with bad JSON → 400', badJson.status === 400, badJson.status);

    // search by name
    const searchJane = await fetch(`${base}/events/${eventId}/attendees?search=jane`).then((r) => r.json());
    check('GET attendees?search=jane → only Jane', searchJane.length === 1 && searchJane[0].fullName === 'jane doe', searchJane);

    // search hits denormalized extra values (role=Speaker)
    const searchRole = await fetch(`${base}/events/${eventId}/attendees?search=speaker`).then((r) => r.json());
    check('GET attendees?search=speaker → only John (matches extra)', searchRole.length === 1 && searchRole[0].fullName === 'john smith', searchRole);

    // filter by status
    const notPrinted = await fetch(`${base}/events/${eventId}/attendees?status=not_printed`).then((r) => r.json());
    check('GET attendees?status=not_printed → both', notPrinted.length === 2, notPrinted);

    // invalid status → 400
    const badStatus = await fetch(`${base}/events/${eventId}/attendees?status=bogus`);
    check('GET attendees?status=bogus → 400', badStatus.status === 400, badStatus.status);

    // print (first time)
    const janeId = searchJane[0]._id;
    const printed1 = await fetch(`${base}/attendees/${janeId}/print`, { method: 'POST' }).then((r) => r.json());
    check('POST print → printStatus=printed, count=1', printed1.printStatus === 'printed' && printed1.printCount === 1, printed1);
    check('POST print → lastPrintedAt set', printed1.lastPrintedAt !== null, printed1.lastPrintedAt);

    // reprint (same endpoint increments)
    const printed2 = await fetch(`${base}/attendees/${janeId}/print`, { method: 'POST' }).then((r) => r.json());
    check('POST print again (reprint) → count=2', printed2.printCount === 2, printed2);

    // status filter now reflects the print
    const printedList = await fetch(`${base}/events/${eventId}/attendees?status=printed`).then((r) => r.json());
    check('GET attendees?status=printed → only Jane', printedList.length === 1 && printedList[0]._id === janeId, printedList);

    // print unknown attendee → 404
    const printMissing = await fetch(`${base}/attendees/0123456789abcdef01234567/print`, { method: 'POST' });
    check('POST print unknown attendee → 404', printMissing.status === 404, printMissing.status);
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
