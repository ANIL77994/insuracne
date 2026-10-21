/**
 * Prisma Client Singleton
 *
 * Prisma 7 requires a driver adapter. We use @prisma/adapter-pg with the
 * existing DATABASE_URL environment variable.
 *
 * Import `prisma` wherever you need database access — do NOT create additional
 * PrismaClient instances.
 */

import { PrismaClient } from '../generated/prisma/client';
export * from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';

config();

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({
    connectionString:
      process.env.DATABASE_URL ||
      'postgresql://postgres:anil@localhost:5432/testdb',
  });

  return new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'warn', 'error']
        : ['warn', 'error'],
  });
}

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? createPrismaClient();

// Reuse across hot-reloads in development
if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/**
 * Connect to database via Prisma explicitly (optional, but verifies connectivity on startup).
 */
export async function connectPrisma(): Promise<void> {
  await prisma.$connect();
}

/**
 * Disconnect Prisma on process exit.
 * Call this once in your server entry-point.
 */
export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}

