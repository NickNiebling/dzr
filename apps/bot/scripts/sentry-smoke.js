const Sentry = require('../services/sentry');
if (!process.env.SENTRY_DSN) {
  console.error('Set SENTRY_DSN in apps/bot/.env first (never commit it).');
  process.exitCode = 1;
} else {
  const id = Sentry.captureException(new Error('Sentry local bot connection check'));
  Sentry.close(5000).then((drained) => {
    console.log(`Local test queued: ${id}; queue drained: ${drained}. Confirm receipt in Sentry.`);
  });
}
