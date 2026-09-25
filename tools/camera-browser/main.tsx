import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import CameraViewer from '../../src/components/CameraViewer';
import DashboardShell from '../../src/components/DashboardShell';
import { WorldEventsProvider } from '../../src/components/WorldEventsProvider';
import CameraMedia from '../../src/components/CameraMedia';
import '../../src/app/globals.css';
const cameras = Array.from({ length: 6 }, (_, n) => ({ id: String(n), name: `Camera ${n}`, source: 'TfL', lat: 51.5 + n / 1000, lng: -0.1,
  stream_type: 'mp4', stream_url: `https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/${n}.mp4`, feed_url: `/media/${n}.jpg` }));
function Harness() {
  const [selected, setSelected] = useState<number | null>(null);
  const shell = new URLSearchParams(location.search).has('shell');
  const content = <><button onClick={() => setSelected(0)}>Open camera</button><button onClick={() => setSelected(5)}>Switch camera</button>
    <div style={{ width: 176, height: 99 }} data-testid="overview"><CameraMedia camera={cameras[0]} overview /></div>
    <CameraViewer camera={selected === null ? null : cameras[selected]} cameras={cameras} onSelect={camera => setSelected(cameras.findIndex(c => c.id === camera.id))} onClose={() => setSelected(null)} />
  </>;
  return shell ? <WorldEventsProvider onMapSelect={() => {}}><DashboardShell mobile={false} navigationVisible onShowNavigation={() => {}} navigation={() => <div>Layers</div>} news={<div>World events fixture</div>} status={null} search={null}>{content}</DashboardShell></WorldEventsProvider> : content;
}
createRoot(document.getElementById('root')!).render(<Harness />);
