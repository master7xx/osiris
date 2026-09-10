import { describe, expect, it } from 'vitest';
import { mapUsgsAshcam, type UsgsAshcamRow } from './usgs-volcano';

const volcanoCamera: UsgsAshcamRow = {
  webcamCode: 'hood-palmer',
  webcamName: 'CVO Hood (Palmer, South)',
  latitude: 45.3313,
  longitude: -121.711,
  externalUrl: 'https://example.test/mount-hood-camera',
  vnum: '322010',
  vName: 'Mount Hood',
  hasImages: 'Y',
  currentImageUrl: 'https://volcview.wr.usgs.gov/ashcam-api/images/webcams/hood-palmer/current.jpeg',
};

describe('mapUsgsAshcam', () => {
  it('maps a volcano-linked observation camera to an official snapshot', () => {
    expect(mapUsgsAshcam(volcanoCamera)).toEqual({
      id: 'usgs-volcano-hood-palmer',
      lat: 45.3313,
      lng: -121.711,
      name: 'CVO Hood (Palmer, South)',
      city: 'Mount Hood',
      country: 'US',
      feed_url: 'https://volcview.wr.usgs.gov/ashcam-api/images/webcams/hood-palmer/current.jpeg',
      external_url: 'https://example.test/mount-hood-camera',
      source: 'USGS Volcano Hazards Program',
    });
  });

  it('rejects road-labelled cameras even when USGS associates them with a volcano', () => {
    expect(mapUsgsAshcam({
      ...volcanoCamera,
      webcamCode: 'rainier-elbe',
      webcamName: 'CVO Rainier (Elbe, Highway)',
      vName: 'Mount Rainier',
    })).toBeNull();
  });

  it('rejects rows that are not explicitly linked to a volcano', () => {
    expect(mapUsgsAshcam({ ...volcanoCamera, vnum: null, vName: null })).toBeNull();
  });

  it('rejects missing imagery, invalid coordinates and non-https snapshots', () => {
    expect(mapUsgsAshcam({ ...volcanoCamera, hasImages: 'N' })).toBeNull();
    expect(mapUsgsAshcam({ ...volcanoCamera, latitude: 95 })).toBeNull();
    expect(mapUsgsAshcam({ ...volcanoCamera, currentImageUrl: 'http://example.test/current.jpg' })).toBeNull();
  });

  it('keeps a valid camera when its optional external URL is unusable', () => {
    const camera = mapUsgsAshcam({ ...volcanoCamera, externalUrl: 'javascript:alert(1)' });
    expect(camera).not.toBeNull();
    expect(camera?.external_url).toBeUndefined();
  });
});
