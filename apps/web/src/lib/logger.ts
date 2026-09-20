type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const levelPriority: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 50,
};

function configuredLevel(): LogLevel {
  const level = process.env.LOG_LEVEL?.toLowerCase();

  if (level === "debug" || level === "info" || level === "warn" || level === "error") {
    return level;
  }

  if (level === "silent") {
    return "silent";
  }

  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

function shouldLog(level: LogLevel) {
  return levelPriority[level] >= levelPriority[configuredLevel()];
}

function normalizeMeta(meta: Record<string, unknown> | undefined) {
  if (!meta) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(meta).map(([key, value]) => {
      if (value instanceof Error) {
        return [
          key,
          {
            message: value.message,
            name: value.name,
            stack: process.env.NODE_ENV === "production" ? undefined : value.stack,
          },
        ];
      }

      return [key, value];
    }),
  );
}

function write(
  level: Exclude<LogLevel, "silent">,
  message: string,
  meta?: Record<string, unknown>,
) {
  if (!shouldLog(level)) {
    return;
  }

  const payload = {
    level,
    message,
    metadata: normalizeMeta(meta),
    service: "hostelpalika-web",
    timestamp: new Date().toISOString(),
  };

  const serialized = JSON.stringify(payload);

  if (level === "error") {
    console.error(serialized);
    return;
  }

  if (level === "warn") {
    console.warn(serialized);
    return;
  }

  console.log(serialized);
}

export const logger = {
  debug(message: string, meta?: Record<string, unknown>) {
    write("debug", message, meta);
  },
  error(message: string, meta?: Record<string, unknown>) {
    write("error", message, meta);
  },
  info(message: string, meta?: Record<string, unknown>) {
    write("info", message, meta);
  },
  warn(message: string, meta?: Record<string, unknown>) {
    write("warn", message, meta);
  },
};
