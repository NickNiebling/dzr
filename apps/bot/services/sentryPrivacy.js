// Shared by Next and the separately deployed bot (copy via scripts/sync-shared.js).
// Only approved diagnostic fields leave the process. Error messages, request bodies,
// breadcrumbs and local variables can contain payment credentials or coaching text.
function beforeSend(event) {
  const values = event.exception?.values?.map((exception) => ({
    type: /^[\w.]{1,100}$/.test(exception.type || "") ? exception.type : "Error",
    value: "Application failure; details remain in platform logs",
    stacktrace: exception.stacktrace && {
      frames: exception.stacktrace.frames?.map((frame) => ({
        filename: frame.filename?.split(/[?#]/)[0],
        function: frame.function,
        lineno: frame.lineno,
        colno: frame.colno,
        in_app: frame.in_app,
      })),
    },
  }));
  return {
    type: event.type,
    event_id: event.event_id,
    timestamp: event.timestamp,
    platform: event.platform,
    level: event.level,
    environment: event.environment,
    release: event.release,
    tags: { service: event.tags?.service },
    exception: values?.length ? { values } : undefined,
    message: values?.length ? undefined : "Application error log; details remain in platform logs",
  };
}

module.exports = { beforeSend };
