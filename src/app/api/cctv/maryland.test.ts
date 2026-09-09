import { describe, expect, it } from 'vitest';
import { iframeSrc, parseMarylandFeatures } from './maryland';

describe('Maryland CHART camera adapter', () => {
  it('extracts an iframe source safely', () => {
    expect(iframeSrc('<iframe src="https://chart.maryland.gov/Video/GetVideo/abc?x=1&amp;y=2"></iframe>'))
      .toBe('https://chart.maryland.gov/Video/GetVideo/abc?x=1&y=2');
    expect(iframeSrc('<iframe src="javascript:alert(1)"></iframe>')).toBeNull();
  });

  it('maps public ArcGIS camera records without pretending viewer pages are JPEGs', () => {
    const cameras = parseMarylandFeatures({
      features: [{
        attributes: {
          OBJECTID: 42,
          feedID: 'CAM-42',
          location: 'I-495 W of MD 185',
          county: 'Montgomery',
          lat: 39.007416,
          long: -77.08681,
          url: 'https://chart.maryland.gov/TrafficCameras/GetTrafficCamera?id=CAM-42',
          iframe: '<iframe src="https://chart.maryland.gov/Video/GetVideo/CAM-42"></iframe>',
        },
      }],
    });

    expect(cameras).toHaveLength(1);
    expect(cameras[0]).toMatchObject({
      id: 'mdchart-CAM-42',
      lat: 39.007416,
      lng: -77.08681,
      name: 'I-495 W of MD 185',
      city: 'Montgomery County',
      country: 'US',
      source: 'MDOT CHART / MD iMAP',
      external_url: 'https://chart.maryland.gov/TrafficCameras/GetTrafficCamera?id=CAM-42',
      stream_url: 'https://chart.maryland.gov/Video/GetVideo/CAM-42',
      stream_type: 'iframe',
    });
    expect(cameras[0].feed_url).toBeUndefined();
  });

  it('keeps an explicit snapshot URL previewable', () => {
    const [camera] = parseMarylandFeatures({
      features: [{ attributes: {
        OBJECTID: 7,
        lat: 39.2,
        long: -76.7,
        url: 'https://example.maryland.gov/cameras/7.jpg?cache=1',
      } }],
    });
    expect(camera.feed_url).toBe('https://example.maryland.gov/cameras/7.jpg?cache=1');
  });

  it('drops rows without valid coordinates or a public URL', () => {
    const cameras = parseMarylandFeatures({
      features: [
        { attributes: { OBJECTID: 1, lat: 999, long: -76.7, url: 'https://example.test/a' } },
        { attributes: { OBJECTID: 2, lat: 39.1, long: -76.7 } },
        { attributes: { OBJECTID: 3, lat: 39.1, long: -76.7, url: 'javascript:alert(1)' } },
      ],
    });
    expect(cameras).toEqual([]);
  });
});
