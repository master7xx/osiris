import { fetchSwpcAlerts } from '@/lib/swpc-alerts';
import { NextResponse } from 'next/server';

/**
 * OSIRIS — Space Weather API
 * Fetches real-time solar activity from NOAA Space Weather Prediction Center
 * FREE — No API key required
 * Data: Kp index (geomagnetic), solar flares, alerts/watches/warnings
 */

const NOAA_BASE = 'https://services.swpc.noaa.gov';

async function fetchJson(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
  return response.json();
}

export async function GET() {
  try {
    const [kpRes, alertsRes, flareRes] = await Promise.allSettled([
      fetchJson(`${NOAA_BASE}/json/planetary_k_index_1m.json`),
      // NOAA publishes current Alerts, Watches and Warnings under /products.
      fetchSwpcAlerts(),
      fetchJson(`${NOAA_BASE}/json/goes/primary/xray-flares-latest.json`),
    ]);

    // Missing/invalid measurements are unknown; numeric zero is a valid observation.
    let kpIndex: number | null = null;
    let kpTimestamp = '';
    if (kpRes.status === 'fulfilled' && Array.isArray(kpRes.value) && kpRes.value.length > 0) {
      const latest = kpRes.value[kpRes.value.length - 1];
      const raw: unknown = latest?.kp_index ?? latest?.Kp;
      const value = typeof raw === 'number' ? raw
        : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN;
      if (Number.isFinite(value) && value >= 0 && value <= 9) {
        kpIndex = value;
        kpTimestamp = typeof latest.time_tag === 'string' ? latest.time_tag : '';
      }
    }

    // NOAA G-scale: Kp 5/6/7/8/9 -> G1/G2/G3/G4/G5 (9- remains G4).
    let stormLevel = 'Unknown';
    let stormColor = '#555';
    if (kpIndex !== null) {
      stormLevel = 'Quiet'; stormColor = '#00E676';
      if (kpIndex >= 9) { stormLevel = 'Extreme (G5)'; stormColor = '#FF1744'; }
      else if (kpIndex >= 8) { stormLevel = 'Severe (G4)'; stormColor = '#FF3D3D'; }
      else if (kpIndex >= 7) { stormLevel = 'Strong (G3)'; stormColor = '#FF9500'; }
      else if (kpIndex >= 6) { stormLevel = 'Moderate (G2)'; stormColor = '#FFD700'; }
      else if (kpIndex >= 5) { stormLevel = 'Minor (G1)'; stormColor = '#FFD700'; }
      else if (kpIndex >= 3) { stormLevel = 'Unsettled'; stormColor = '#D4AF37'; }
    }

    // Recent alerts
    const alerts: Array<{ id: string; issue_datetime: string; message: string }> = [];
    if (alertsRes.status === 'fulfilled' && Array.isArray(alertsRes.value)) {
      for (const alert of alertsRes.value.slice(0, 10)) {
        alerts.push({
          id: alert.product_id || `alert-${Date.now()}`,
          issue_datetime: alert.issue_datetime,
          message: (alert.message || '').substring(0, 200),
        });
      }
    }

    // Recent solar flares
    const flares: Array<{ class: string; begin?: string; peak?: string; end?: string }> = [];
    if (flareRes.status === 'fulfilled' && Array.isArray(flareRes.value)) {
      for (const flare of flareRes.value.slice(0, 5)) {
        if (!flare || typeof flare.max_class !== 'string' || !flare.max_class) continue;
        flares.push({
          class: flare.max_class,
          begin: flare.begin_time,
          peak: flare.max_time,
          end: flare.end_time,
        });
      }
    }

    const availability = {
      kp: kpIndex !== null,
      alerts: alertsRes.status === 'fulfilled',
      solar_flares: flareRes.status === 'fulfilled' && Array.isArray(flareRes.value),
    };
    const available = Object.values(availability).filter(Boolean).length;
    return NextResponse.json({
      data_status: available === 3 ? 'available' : available ? 'partial' : 'unavailable',
      availability,
      kp_index: kpIndex,
      storm_level: stormLevel,
      storm_color: stormColor,
      kp_timestamp: kpTimestamp,
      alerts,
      solar_flares: flares,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Space Weather API error:', error);
    return NextResponse.json({
      kp_index: null, kp_timestamp: '', storm_level: 'Unknown', storm_color: '#555',
      alerts: [], solar_flares: [], data_status: 'unavailable', availability: { kp: false, alerts: false, solar_flares: false }, error: 'Failed to fetch space weather data',
    }, { status: 500 });
  }
}
