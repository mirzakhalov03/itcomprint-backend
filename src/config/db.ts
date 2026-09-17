import mongoose from 'mongoose';
import { env } from './env';

export async function connectDb(): Promise<void> {
  mongoose.set('strictQuery', true);

  // Surface connection-lifecycle events so prod incidents are diagnosable from logs.
  mongoose.connection.on('error', (err) => console.error('[db] connection error', err));
  mongoose.connection.on('disconnected', () => console.warn('[db] disconnected'));
  mongoose.connection.on('reconnected', () => console.log('[db] reconnected'));

  await mongoose.connect(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10_000, // fail fast on an unreachable DB instead of hanging
    maxPoolSize: 10,
    // autoIndex stays on (Mongoose default): builds new indexes on boot, but never drops
    // stale ones or old fields. Deploying against an existing prod DB needs a one-time
    // cleanup first — drop `eventId_1_searchText_1` and `isDefault_1`, unset attendees'
    // orphaned `searchText` field. See the audit-fixes plan's OPS-1 task for exact commands.
  });

  console.log('[db] connected to MongoDB');
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
  console.log('[db] connection closed');
}
