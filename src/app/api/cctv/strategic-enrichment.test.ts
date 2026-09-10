import { describe, expect, it } from 'vitest';
import { shouldFetchUsgsVolcano } from './strategic-enrichment';

describe('shouldFetchUsgsVolcano', () => {
  it('includes global and western-US region requests', () => {
    expect(shouldFetchUsgsVolcano('http://localhost/api/cctv')).toBe(true);
    expect(shouldFetchUsgsVolcano('http://localhost/api/cctv?region=all')).toBe(true);
    expect(shouldFetchUsgsVolcano('http://localhost/api/cctv?region=us-west')).toBe(true);
    expect(shouldFetchUsgsVolcano('http://localhost/api/cctv?region=oregon')).toBe(true);
  });

  it('includes Cascades and Alaska/Aleutians viewport requests', () => {
    expect(shouldFetchUsgsVolcano('http://localhost/api/cctv?lat=45.33&lng=-121.71')).toBe(true);
    expect(shouldFetchUsgsVolcano('http://localhost/api/cctv?lat=61.22&lng=-149.90')).toBe(true);
    expect(shouldFetchUsgsVolcano('http://localhost/api/cctv?lat=54.75&lng=-163.97')).toBe(true);
  });

  it('does not fetch the source for unrelated regions or viewports', () => {
    expect(shouldFetchUsgsVolcano('http://localhost/api/cctv?region=japan')).toBe(false);
    expect(shouldFetchUsgsVolcano('http://localhost/api/cctv?lat=35.68&lng=139.76')).toBe(false);
    expect(shouldFetchUsgsVolcano('http://localhost/api/cctv?lat=40.71&lng=-74.00')).toBe(false);
  });

  it('keeps explicit region intent authoritative', () => {
    expect(shouldFetchUsgsVolcano(
      'http://localhost/api/cctv?region=japan&lat=45.33&lng=-121.71',
    )).toBe(false);
  });
});
