import { describe, expect, it } from 'vitest';
import { sanitizeUpstreamUrl } from './server-debug-store';

describe('server debug URL sanitization', () => {
  it('removes query strings that may carry secrets', () => {
    expect(sanitizeUpstreamUrl('https://api.example.test/data?key=secret&target=x')).toEqual({
      url: 'https://api.example.test/data',
      host: 'api.example.test',
    });
  });

  it('retains a useful host and path', () => {
    expect(sanitizeUpstreamUrl('https://feeds.example.test/v1/news').url).toBe('https://feeds.example.test/v1/news');
  });
});
