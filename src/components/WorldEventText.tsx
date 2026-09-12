'use client';
import { useId, useState } from 'react';
import { formatEventText } from '@/lib/event-text';

export default function WorldEventText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  if (!text.trim()) return null;
  return <div className="world-event-description">
    <p id={id} className="world-event-body" data-expanded={expanded}>{formatEventText(text)}</p>
    <button type="button" className="world-event-read-more" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}>
      {expanded ? 'Collapse / Свернуть' : 'Read full text / Читать полностью'}
    </button>
  </div>;
}
