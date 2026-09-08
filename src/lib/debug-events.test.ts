import { describe, expect, it } from 'vitest';
import { isDebuggableEndpoint, sanitizeEndpoint } from './debug-events';

describe('debug endpoint sanitization', () => {
  it('strips query strings and fragments', () => {
    expect(sanitizeEndpoint('/api/scanner?target=secret.example&type=quick#x')).toBe('/api/scanner');
  });

  it('keeps only the path for absolute URLs', () => {
    expect(sanitizeEndpoint('https://example.test/api/news?token=secret')).toBe('/api/news');
  });

  it('instruments API calls only', () => {
    expect(isDebuggableEndpoint('/api/weather?lat=1')).toBe(true);
    expect(isDebuggableEndpoint('/favicon.ico')).toBe(false);
  });
});
