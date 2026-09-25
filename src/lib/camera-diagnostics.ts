import { safeFetch } from './ssrf-guard';
import type { PlaybackCamera } from './camera-playback';
export interface CameraCheck { state: string; checkedAt?: string; httpStatus?: number; nextCheckAt?: string; method: 'HEAD'; }
interface Entry { url: string; provider: string; expires: number; result?: CameraCheck; due: number; failures: number; pending?: Promise<CameraCheck>; }
export class CameraDiagnostics {
  private entries = new Map<string, Entry>();
  private providers = new Map<string, number>();
  private running = 0;
  constructor(private request: typeof safeFetch = safeFetch, private now = Date.now) {}
  register(cameras: PlaybackCamera[]) {
    const now = this.now();
    for (const [id, entry] of this.entries) if (entry.expires < now) this.entries.delete(id);
    for (const [id, due] of this.providers) if (due < now) this.providers.delete(id);
    for (const camera of cameras) {
      if (!camera.id) continue;
      const raw = camera.stream_url || camera.feed_url;
      if (!raw) continue;
      let url: URL;
      try { url = new URL(raw); } catch { continue; }
      if (url.protocol !== 'https:' || url.username || url.password || url.port) continue;
      const old = this.entries.get(camera.id);
      if (!old && this.entries.size >= 60000) continue;
      if (old?.url === url.href) { old.expires = now + 3600000; continue; }
      this.entries.set(camera.id, {
        url: url.href, provider: camera.source || url.hostname, expires: now + 3600000, due: 0, failures: 0,
      });
    }
  }
  async check(id: string): Promise<CameraCheck> {
    const entry = this.entries.get(id); const now = this.now();
    if (!entry || entry.expires < now) return { state: 'UNKNOWN', method: 'HEAD' };
    if (entry.pending) return entry.pending;
    if (entry.due > now) return entry.result!;
    if (this.running >= 2 || (this.providers.get(entry.provider) || 0) > now) return entry.result || { state: 'QUEUED', method: 'HEAD' };
    this.providers.set(entry.provider, now + 5000);
    this.running++;
    entry.pending = (async () => {
      let result: CameraCheck; let retry = 0;
      try {
        const res = await this.request(entry.url, { method: 'HEAD', signal: AbortSignal.timeout(6000), cache: 'no-store' });
        await res.body?.cancel();
        const after = res.headers.get('retry-after');
        if (after) retry = /^\d+$/.test(after) ? Number(after) * 1000 : Math.max(0, Date.parse(after) - this.now());
        result = { state: res.ok ? 'REACHABLE' : [405, 501].includes(res.status) ? 'HEAD_UNSUPPORTED' : 'HTTP_ERROR', httpStatus: res.status, method: 'HEAD' };
      } catch { result = { state: 'NETWORK_OR_TIMEOUT', method: 'HEAD' }; }
      entry.failures = result.state === 'REACHABLE' ? 0 : Math.min(entry.failures + 1, 4);
      const delay = Math.max(300000 * 2 ** entry.failures, Number.isFinite(retry) ? retry : 0);
      entry.due = this.now() + delay;
      if (result.httpStatus === 429 || result.httpStatus === 503) this.providers.set(entry.provider, entry.due);
      entry.result = { ...result, checkedAt: new Date(this.now()).toISOString(), nextCheckAt: new Date(entry.due).toISOString() };
      return entry.result;
    })().finally(() => { entry.pending = undefined; this.running--; });
    return entry.pending;
  }
}
const scope = globalThis as typeof globalThis & { osirisCameraDiagnostics?: CameraDiagnostics };
export const cameraDiagnostics = scope.osirisCameraDiagnostics ??= new CameraDiagnostics();
