import { describe, expect, it } from 'vitest';
import { cameraProxyTarget } from './camera-proxy-target';
describe('camera proxy target policy', () => {
  it('allows provider frames and relative redirects', () => {
    expect(cameraProxyTarget('../frame.jpg', 'https://cdn.skylinewebcams.com/path/a').href).toBe('https://cdn.skylinewebcams.com/frame.jpg');
  });
  it('rejects redirect escapes, credentials, ports and active protocols', () => {
    for (const value of ['http://127.0.0.1/', '//169.254.169.254/', 'https://cdn.skylinewebcams.com.evil.test/', 'https://user:pass@cdn.skylinewebcams.com/', 'https://cdn.skylinewebcams.com:444/', 'file:///etc/passwd']) {
      expect(() => cameraProxyTarget(value, 'https://cdn.skylinewebcams.com/')).toThrow();
    }
  });
});
