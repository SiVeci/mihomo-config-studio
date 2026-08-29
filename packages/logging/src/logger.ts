import { redact } from './redact.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Injected output port — tests supply a fake, a real caller supplies one backed by `console` (or nothing at all, the default). */
export interface LogSink {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  /**
   * Accepts a plain message or an `Error`. For an `Error`, `stack` (when
   * present) is redacted line by line rather than as one block — a stack
   * trace's per-frame lines (`at fn (file:line:col)`) must stay individually
   * readable, which a wholesale multi-line collapse (`redact()`'s own rule
   * 1) would destroy. Each frame line still goes through the same
   * single-line rules, so a stray `data:` URL or credential-shaped token in
   * a frame is still caught (the concern this parameter exists for).
   */
  error(messageOrError: string | Error): void;
}

const CONSOLE_SINK: LogSink = {
  debug: (message) => {
    console.debug(message);
  },
  info: (message) => {
    console.info(message);
  },
  warn: (message) => {
    console.warn(message);
  },
  error: (message) => {
    console.error(message);
  },
};

export interface CreateLoggerOptions {
  /** Defaults to a thin `console` wrapper. */
  sink?: LogSink;
}

/** Every method redacts before it ever reaches `sink` — there is no parameter or option that skips it. */
export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const sink = options.sink ?? CONSOLE_SINK;

  function emit(level: LogLevel, message: string): void {
    sink[level](redact(message));
  }

  return {
    debug: (message) => {
      emit('debug', message);
    },
    info: (message) => {
      emit('info', message);
    },
    warn: (message) => {
      emit('warn', message);
    },
    error: (messageOrError) => {
      if (!(messageOrError instanceof Error)) {
        emit('error', messageOrError);
        return;
      }
      // Not routed through emit()/redact() again: each line below is
      // already fully redacted, and re-running the whole (now multi-line)
      // joined result back through redact() would hit its own rule 1 and
      // collapse the whole, already-safe stack into one opaque marker.
      const text = messageOrError.stack ?? messageOrError.message;
      const redactedLines = text.split(/\r\n|\r|\n/).map((line) => redact(line));
      sink.error(redactedLines.join('\n'));
    },
  };
}
