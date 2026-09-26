import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import DebugOverlay from '../../src/components/DebugOverlay';
import CameraViewer from '../../src/components/CameraViewer';
import DashboardShell from '../../src/components/DashboardShell';
import { WorldEventsProvider, useWorldEvents } from '../../src/components/WorldEventsProvider';
import CameraMedia from '../../src/components/CameraMedia';
import '../../src/app/globals.css';
const cameras = Array.from({ length: 6 }, (_, n) => ({ id: String(n), name: `Camera ${n}`, source: 'TfL', lat: 51.5 + n / 1000, lng: -0.1,
  stream_type: 'mp4', stream_url: `https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/${n}.mp4`, feed_url: `/media/${n}.jpg` }));
function EventRecoveryHarness() {
  const events = useWorldEvents();
  return <main><DebugOverlay />
    <button onClick={() => void events.refresh()}>Refresh events</button>
    <p data-testid="sync-state">{events.loading ? 'loading' : events.error ? 'error' : 'ready'}</p>
    <p data-testid="cache-state">{events.fromCache ? 'cached' : 'fresh'}</p>
    <p data-testid="sync-error">{events.error}</p>
    <ul>{events.snapshot?.events.map(event => <li key={event.id}>{event.title}</li>)}</ul>
  </main>;
}
function VariantHarness() {
  const still = { id: 'windy-predeal', name: 'Predeal', lat: 45.47811, lng: 25.564, feed_url: 'https://imgproxy.windy.com/_/full/plain/current/1357151208/original.jpg' };
  const live = { id: 'digi-predeal', name: 'Predeal - Digi Live', lat: 45.47811, lng: 25.564, stream_type: 'hls', stream_url: 'https://digilive.rcs-rds.ro/digilivedge/predeal_desktop.stream/index.m3u8' };
  const [selected, setSelected] = useState<typeof still | typeof live | null>(still);
  return <><CameraViewer camera={selected} cameras={[still, live]} onSelect={() => setSelected(live)} onClose={() => setSelected(null)} /></>;
}
function Harness() {
  const [selected, setSelected] = useState<number | null>(null);
  const shell = new URLSearchParams(location.search).has('shell');
  const content = <><button onClick={() => setSelected(0)}>Open camera</button><button onClick={() => setSelected(5)}>Switch camera</button>
    <div style={{ width: 176, height: 99 }} data-testid="overview"><CameraMedia camera={cameras[0]} overview /></div>
    <CameraViewer camera={selected === null ? null : cameras[selected]} cameras={cameras} onSelect={camera => setSelected(cameras.findIndex(c => c.id === camera.id))} onClose={() => setSelected(null)} />
  </>;
  return shell ? <WorldEventsProvider onMapSelect={() => {}}><DashboardShell mobile={false} navigationVisible onShowNavigation={() => {}} navigation={() => <div>Layers</div>} news={<div>World events fixture</div>} status={null} search={null}>{content}</DashboardShell></WorldEventsProvider> : content;
}
createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).has('events') ? <WorldEventsProvider onMapSelect={() => {}}><EventRecoveryHarness /></WorldEventsProvider> : new URLSearchParams(location.search).has('variants') ? <VariantHarness /> : <Harness />);
