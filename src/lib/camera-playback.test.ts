import { describe, expect, it } from 'vitest';
import { clipUrl, mediaErrorLabel, nearbyCameras, snapshotUrl } from './camera-playback';
describe('client camera selection', () => {
  it('never starts a stream just to produce an overview', () => {
    expect(snapshotUrl({ stream_type: 'mjpeg', feed_url: 'https://x/stream' })).toBeUndefined();
    expect(snapshotUrl({ stream_type: 'mjpeg', feed_url: 'https://x/stream.jpg' })).toBeUndefined();
    expect(snapshotUrl({ stream_type: 'hls', stream_url: 'https://x/live.m3u8' })).toBeUndefined();
    expect(snapshotUrl({ stream_type: 'mp4', feed_url: 'https://x/frame.jpg' })).toBe('https://x/frame.jpg');
  });
  it('selects at most three unique nearby videos, excluding selected and distant cameras', () => {
    const selected = { id: 'selected', lat: 0, lng: 179.999 };
    const cameras = Array.from({ length: 6 }, (_, n) => ({ id: String(n), lat: n / 1000, lng: -179.999, stream_type: 'hls', stream_url: 'https://x/live' }));
    expect(nearbyCameras(selected, [...cameras, cameras[0], { ...cameras[0], id: 'far', lat: 30 }, { ...cameras[0], ...selected }]).map(c => c.id)).toEqual(['0', '1', '2']);
  });
  it('does not automatically embed neighboring provider web pages', () => {
    expect(nearbyCameras({ id: 'selected', lat: 0, lng: 0 }, [{ id: 'page', lat: 0, lng: 0, stream_type: 'iframe', stream_url: 'https://provider.example/camera-page' }])).toEqual([]);
  });
  it('preserves signed URLs and separates media errors from HTTP codes', () => {
    expect(clipUrl('https://x/clip.mp4?token=secret', 123)).toBe('https://x/clip.mp4?token=secret');
    expect(clipUrl('https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/1.mp4', 123)).toContain('_osiris=123');
    expect(mediaErrorLabel(2)).toBe('NETWORK');
    expect(mediaErrorLabel(4)).toBe('UNSUPPORTED');
  });
});

import { cameraVariantKey, preferredCamera } from './camera-playback';
describe('reviewed camera variants', () => {
  const still = { id: 'windy', name: 'Predeal', lat: 45.47811, lng: 25.564, feed_url: 'https://imgproxy.windy.com/_/full/plain/current/1357151208/original.jpg' };
  const live = { id: 'digi', name: 'Predeal - Digi Live', lat: 45.47811, lng: 25.564, stream_type: 'hls', stream_url: 'https://digilive.rcs-rds.ro/digilivedge/predeal_desktop.stream/index.m3u8' };
  it('promotes the reviewed video, retains snapshot fallback and removes its duplicate tile', () => {
    const main = preferredCamera(still, [still, live]);
    expect(main).toEqual({ ...live, feed_url: still.feed_url });
    expect(nearbyCameras(main, [still, live])).toEqual([]);
    expect(preferredCamera(live, [still, live])).toEqual(main);
    expect(snapshotUrl(still)).toBe(still.feed_url);
  });
  it('keeps a still without its loaded variant and never substitutes a nearby namesake', () => {
    const other = { ...live, id: 'centru', stream_url: 'https://digilive.rcs-rds.ro/digilivedge/predeal_centru_desktop.stream/index.m3u8' };
    expect(preferredCamera(still, [other])).toBe(still);
    expect(nearbyCameras(preferredCamera(still, [live, other]), [live, other])).toEqual([other]);
    expect(cameraVariantKey({ ...still, feed_url: still.feed_url.replace('imgproxy.windy.com', 'imgproxy.windy.com.example.org') })).toBeUndefined();
    expect(cameraVariantKey(other)).toBeUndefined();
  });
});
