import mongoose from "mongoose";

type CachedConnection = {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
};

const globalForMongoose = globalThis as typeof globalThis & {
  mongooseConnection?: CachedConnection;
};

const cached = globalForMongoose.mongooseConnection ?? {
  conn: null,
  promise: null,
};

globalForMongoose.mongooseConnection = cached;

/**
 * Cached Mongoose connection (one per process). Environment loading is the
 * caller's responsibility — apps/web loads the repo-root .env via @next/env,
 * standalone scripts load it themselves before importing this module.
 */
export async function connectToDatabase() {
  if (cached.conn) {
    return cached.conn;
  }

  const uri = process.env.MONGODB_URI ?? process.env.DATABASE_URL;

  if (!uri) {
    throw new Error("MONGODB_URI (or DATABASE_URL) is required to connect to MongoDB.");
  }

  /*
   * A failed connect is forgotten, not cached. Kept, one refused handshake would
   * be replayed to every later request on this warm instance until it recycled —
   * a single blip in the Atlas proxy became a run of 500s across unrelated routes.
   */
  cached.promise ??= mongoose
    .connect(uri, { bufferCommands: false })
    .catch((error: unknown) => {
      cached.promise = null;
      throw error;
    });

  cached.conn = await cached.promise;
  return cached.conn;
}

export async function disconnectFromDatabase() {
  if (cached.conn) {
    await cached.conn.disconnect();
    cached.conn = null;
    cached.promise = null;
  }
}
