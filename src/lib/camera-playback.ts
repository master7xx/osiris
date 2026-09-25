export interface PlaybackCamera {
  id?: string; name?: string; lat?: number; lng?: number; source?: string;
  feed_url?: string; stream_url?: string; stream_type?: string; external_url?: string;
}
export function snapshotUrl(camera: PlaybackCamera): string | undefined {
  const kind = (camera.stream_type || 'jpg').toLowerCase();
  // A feed URL may itself be an MJPEG stream. Never start it in overview mode.
  if (kind === 'mjpeg' || (kind !== 'jpg' && camera.feed_url === camera.stream_url)) return undefined;
  return kind === 'jpg' ? camera.feed_url || camera.stream_url
    : /\.(jpe?g|png|webp)(?:[?#]|$)/i.test(camera.feed_url || '') ? camera.feed_url : undefined;
}
export function nearbyCameras(selected: PlaybackCamera, cameras: PlaybackCamera[]): PlaybackCamera[] {
  if (!Number.isFinite(selected.lat) || !Number.isFinite(selected.lng)) return [];
  const seen = new Set([selected.id]);
  return cameras.filter(c => {
    if (!c.id || seen.has(c.id) || !Number.isFinite(c.lat) || !Number.isFinite(c.lng)) return false;
    seen.add(c.id);
    return !!c.stream_url && ['mp4', 'hls', 'mjpeg', 'iframe'].includes(c.stream_type || '');
  }).map(c => {
    const lat = (c.lat! - selected.lat!) * Math.PI / 180;
    const lon = (c.lng! - selected.lng!) * Math.PI / 180;
    const a = Math.sin(lat / 2) ** 2 + Math.cos(selected.lat! * Math.PI / 180) * Math.cos(c.lat! * Math.PI / 180) * Math.sin(lon / 2) ** 2;
    return { camera: c, distance: 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, a))) };
  }).filter(c => c.distance <= 2).sort((a, b) => a.distance - b.distance || a.camera.id!.localeCompare(b.camera.id!)).slice(0, 3).map(c => c.camera);
}
export function clipUrl(url: string, revision: number): string {
  // Only TfL is verified to accept cache-busting. Preserve signed provider URLs.
  let parsed: URL;
  try { parsed = new URL(url); } catch { return url; }
  if (revision && parsed.hostname === 's3-eu-west-1.amazonaws.com' && parsed.pathname.startsWith('/jamcams.tfl.gov.uk/')) parsed.searchParams.set('_osiris', String(revision));
  return parsed.href;
}
export function mediaErrorLabel(code?: number): string {
  return ({ 1: 'ABORTED', 2: 'NETWORK', 3: 'DECODE', 4: 'UNSUPPORTED' } as Record<number, string>)[code || 0] || 'MEDIA';
}
