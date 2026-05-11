const path = require('node:path');

module.exports = {
  dialect: 'postgresql',
  schema: path.join(__dirname, 'schema.ts'),
  out: path.join(__dirname, 'migrations'),
  dbCredentials: {
    url: process.env.DATABASE_URL || process.env.SMART_JOB_DATABASE_URL || '',
  },
};