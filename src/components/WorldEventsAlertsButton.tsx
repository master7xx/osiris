'use client';
import { AlertTriangle } from 'lucide-react';
import { useWorldEvents } from './WorldEventsProvider';

/** An open command, not a toggle of the retired standalone alerts popover. */
export default function WorldEventsAlertsButton({ onOpen }: { onOpen: () => void }) {
  const { openFeed } = useWorldEvents();
  return <button type="button" onClick={() => { onOpen(); openFeed(); }}
    className="relative w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/10 focus-visible:ring-1 focus-visible:ring-white/50"
    title="Alerts — open World Events / Sources" aria-label="Alerts — open World Events / Sources" aria-controls="dashboard-news">
    <AlertTriangle className="w-4 h-4 text-white/60" />
  </button>;
}
