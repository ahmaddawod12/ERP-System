module.exports = {
  dialect: 'postgresql',
  // drizzle-kit resolves these paths from this package's working directory.
  // Relative paths keep `npm run db:generate` portable on Windows and Linux.
  schema: './schema.ts',
  out: './migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL || process.env.SMART_JOB_DATABASE_URL || '',
  },
};
