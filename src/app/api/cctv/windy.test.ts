import { describe, expect, it } from 'vitest';
import { mapWindyWebcam, windyWorldMacroContains, type WindyWebcam } from './windy';

const live: WindyWebcam = {
  webcamId: 12345,
  status: 'active',
  title: 'Tokyo skyline',
  location: {
    city: 'Tokyo',
    country: 'Japan',
    country_code: 'JP',
    latitude: 35.6762,
    longitude: 139.6503,
  },
  player: { live: 'https://webcams.windy.com/webcams/public/embed/player/12345/live' },
  urls: { detail: 'https://www.windy.com/webcams/12345' },
};

describe('mapWindyWebcam', () => {
  it('maps a live player to an iframe camera with Windy attribution', () => {
    expect(mapWindyWebcam(live)).toEqual({
      id: 'windy-12345',
      lat: 35.6762,
      lng: 139.6503,
      name: 'Tokyo skyline',
      city: 'Tokyo',
      country: 'Japan',
      stream_url: 'https://webcams.windy.com/webcams/public/embed/player/12345/live',
      stream_type: 'iframe',
      external_url: 'https://www.windy.com/webcams/12345',
      source: 'Webcams provided by Windy.com',
    });
  });

  it('accepts the legacy/object live-player shape defensively', () => {
    expect(mapWindyWebcam({
      ...live,
      player: { live: { embed: 'https://webcams.windy.com/embed/12345' } },
    })?.stream_url).toBe('https://webcams.windy.com/embed/12345');
  });

  it('rejects inactive cameras, missing live players, and invalid coordinates', () => {
    expect(mapWindyWebcam({ ...live, status: 'inactive' })).toBeNull();
    expect(mapWindyWebcam({ ...live, player: {} })).toBeNull();
    expect(mapWindyWebcam({ ...live, location: { ...live.location, latitude: 95 } })).toBeNull();
    expect(mapWindyWebcam({ ...live, webcamId: undefined })).toBeNull();
  });

  it('rejects non-https player URLs instead of embedding mixed content', () => {
    expect(mapWindyWebcam({
      ...live,
      player: { live: 'http://example.test/player' },
    })).toBeNull();
  });

  it('keeps the camera if the optional detail URL is unusable', () => {
    const camera = mapWindyWebcam({ ...live, urls: { detail: 'javascript:alert(1)' } });
    expect(camera).not.toBeNull();
    expect(camera?.external_url).toBeUndefined();
  });
});

describe('Windy world macro cells', () => {
  it('covers Latin America and Africa with multiple broad cells', () => {
    expect(windyWorldMacroContains('latam', -23.55, -46.63)).toBe(true); // Sao Paulo
    expect(windyWorldMacroContains('latam', 19.43, -99.13)).toBe(true); // Mexico City
    expect(windyWorldMacroContains('africa', -33.92, 18.42)).toBe(true); // Cape Town
    expect(windyWorldMacroContains('africa', -1.29, 36.82)).toBe(true); // Nairobi
  });

  it('covers Oceania on both sides of the antimeridian', () => {
    expect(windyWorldMacroContains('oceania', -33.87, 151.21)).toBe(true); // Sydney
    expect(windyWorldMacroContains('oceania', -17.71, 178.07)).toBe(true); // Fiji
    expect(windyWorldMacroContains('oceania', -17.55, -149.56)).toBe(true); // Tahiti
    expect(windyWorldMacroContains('oceania', 21.31, -157.86)).toBe(true); // Honolulu
  });

  it('does not classify Europe or Japan into the added world cells', () => {
    expect(windyWorldMacroContains('latam', 52.52, 13.405)).toBe(false);
    expect(windyWorldMacroContains('africa', 35.68, 139.76)).toBe(false);
    expect(windyWorldMacroContains('oceania', 35.68, 139.76)).toBe(false);
  });
});
