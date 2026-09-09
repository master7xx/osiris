import { describe, expect, it } from 'vitest';
import { mapIowaFeature } from './iowa';

describe('Iowa DOT camera adapter', () => {
  it('maps an official snapshot and HLS stream', () => {
    const camera = mapIowaFeature({
      attributes: {
        FID: 10,
        device_id: 1234,
        COMMON_ID: 'IA-42',
        ImageName: 'I-80 at IA 141',
        ImageURL: 'https://images.iowadot.gov/camera/42.jpg?ts=1',
        VideoURL: 'https://video.iowadot.gov/live/42/playlist.m3u8',
        latitude: 41.601,
        longitude: -93.781,
        REGION: 1,
      },
    });

    expect(camera).toMatchObject({
      id: 'iadot-IA-42',
      lat: 41.601,
      lng: -93.781,
      name: 'I-80 at IA 141',
      city: 'Iowa DOT Region 1',
      country: 'US',
      source: 'Iowa DOT',
      feed_url: 'https://images.iowadot.gov/camera/42.jpg?ts=1',
      stream_url: 'https://video.iowadot.gov/live/42/playlist.m3u8',
      stream_type: 'hls',
    });
  });

  it('keeps an unknown video format as an external viewer instead of guessing a stream type', () => {
    const camera = mapIowaFeature({
      attributes: {
        FID: 11,
        Desc_: 'US 20 near Waterloo',
        ImageURL: 'https://images.iowadot.gov/camera/11',
        VideoURL: 'https://video.iowadot.gov/camera/11',
        latitude: 42.49,
        longitude: -92.34,
      },
    });

    expect(camera).toMatchObject({
      id: 'iadot-11',
      name: 'US 20 near Waterloo',
      feed_url: 'https://images.iowadot.gov/camera/11',
      external_url: 'https://video.iowadot.gov/camera/11',
    });
    expect(camera?.stream_url).toBeUndefined();
    expect(camera?.stream_type).toBeUndefined();
  });

  it('accepts a video-only HLS camera', () => {
    const camera = mapIowaFeature({
      attributes: {
        device_id: 99,
        Route: 'I-35',
        VideoURL: 'https://video.iowadot.gov/hls/99.m3u8?token=public',
        latitude: 41.9,
        longitude: -93.6,
      },
    });

    expect(camera).toMatchObject({
      id: 'iadot-99',
      name: 'I-35',
      stream_type: 'hls',
    });
    expect(camera?.feed_url).toBeUndefined();
  });

  it('rejects invalid coordinates, unsafe URLs and rows with no feed', () => {
    expect(mapIowaFeature({ attributes: {
      FID: 1, latitude: 50, longitude: -93, ImageURL: 'https://example.test/a.jpg',
    } })).toBeNull();

    expect(mapIowaFeature({ attributes: {
      FID: 2, latitude: 41.5, longitude: -93, ImageURL: 'javascript:alert(1)',
    } })).toBeNull();

    expect(mapIowaFeature({ attributes: {
      FID: 3, latitude: 41.5, longitude: -93,
    } })).toBeNull();
  });
});
