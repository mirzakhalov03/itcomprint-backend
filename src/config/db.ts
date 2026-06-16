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
    // autoIndex stays on (Mongoose default): two small collections, one search index —
    // building it on boot guarantees fast search without a separate migration step.
  });

  console.log('[db] connected to MongoDB');
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
  console.log('[db] connection closed');
}
