import { describe, expect, it, vi } from 'vitest';

import { createLogger, type LogSink } from './index.js';

function fakeSink(): LogSink & { calls: Record<'debug' | 'info' | 'warn' | 'error', string[]> } {
  const calls = {
    debug: [] as string[],
    info: [] as string[],
    warn: [] as string[],
    error: [] as string[],
  };
  return {
    calls,
    debug: (m) => calls.debug.push(m),
    info: (m) => calls.info.push(m),
    warn: (m) => calls.warn.push(m),
    error: (m) => calls.error.push(m),
  };
}

describe('createLogger — every level redacts before reaching the sink', () => {
  it.each(['debug', 'info', 'warn'] as const)('%s redacts a key: value message', (level) => {
    const sink = fakeSink();
    const logger = createLogger({ sink });
    logger[level]('password: hunter2');
    expect(sink.calls[level]).toEqual(['password: <redacted>']);
  });

  it('error(string) redacts like every other level', () => {
    const sink = fakeSink();
    const logger = createLogger({ sink });
    logger.error('token: abc123');
    expect(sink.calls.error).toEqual(['token: <redacted>']);
  });

  it('there is no option or parameter that bypasses redaction', () => {
    const sink = fakeSink();
    const logger = createLogger({ sink });
    const secret = 'https://sub.example.com/a?key=do-not-leak';
    logger.info(secret);
    expect(sink.calls.info[0]).not.toContain('do-not-leak');
  });
});

describe('createLogger — defaults to a console-backed sink when none is given', () => {
  it.each(['debug', 'info', 'warn', 'error'] as const)(
    'calls console.%s for logger.%s with no sink option',
    (level) => {
      const spy = vi.spyOn(console, level).mockImplementation(() => undefined);
      createLogger()[level]('token: abc123');
      expect(spy).toHaveBeenCalledWith('token: <redacted>');
      spy.mockRestore();
    },
  );
});

describe('createLogger — Error handling redacts message and stack, line by line', () => {
  it('redacts a plain Error, keeping frame lines individually readable', () => {
    const sink = fakeSink();
    const logger = createLogger({ sink });
    const error = new Error('failed');
    error.stack = 'Error: failed\n    at doThing (app.ts:10:5)\n    at main (app.ts:20:3)';

    logger.error(error);

    expect(sink.calls.error).toHaveLength(1);
    const [logged] = sink.calls.error;
    expect(logged).toContain('at doThing (app.ts:10:5)');
    expect(logged).toContain('at main (app.ts:20:3)');
  });

  it('redacts a credential-shaped token that leaked into a stack frame (e.g. a data: URL)', () => {
    const sink = fakeSink();
    const logger = createLogger({ sink });
    const error = new Error('failed');
    error.stack =
      'Error: failed\n    at load (data:text/plain;base64,QWxhZGRpbjpvcGVuIHNlc2FtZQ==:1:1)';

    logger.error(error);

    const [logged] = sink.calls.error;
    expect(logged).not.toContain('QWxhZGRpbjpvcGVuIHNlc2FtZQ==');
  });

  it('falls back to the (redacted) message when the Error has no stack at all', () => {
    const sink = fakeSink();
    const logger = createLogger({ sink });
    const error = new Error('subscription-url: https://sub.example.com/a?token=x');
    delete error.stack;

    logger.error(error);

    expect(sink.calls.error).toEqual(['subscription-url: <redacted>']);
  });

  it('a multi-line message is still redacted line by line via the stack, not wholesale-collapsed — documented trade-off for frame readability', () => {
    const sink = fakeSink();
    const logger = createLogger({ sink });
    const error = new Error('line one\nline two');
    error.stack = 'Error: line one\nline two\n    at main (app.ts:1:1)';

    logger.error(error);

    const [logged] = sink.calls.error;
    // Each line survives on its own (no wholesale <redacted:N lines>), and
    // the frame line stays fully readable.
    expect(logged).toContain('at main (app.ts:1:1)');
    expect(logged).not.toContain('<redacted:');
  });
});
