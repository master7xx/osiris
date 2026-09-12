'use client';

import { useCallback, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Globe, PanelLeftClose, PanelLeftOpen, Newspaper, X } from 'lucide-react';
import './dashboard-shell.css';
import { useWorldEvents } from './WorldEventsProvider';

interface DashboardShellProps {
  mobile: boolean;
  navigationVisible: boolean;
  onShowNavigation: () => void;
  navigation: (compact: boolean) => ReactNode;
  news: ReactNode;
  status: ReactNode;
  search: ReactNode;
  children: ReactNode;
}

function useMediaQuery(query: string) {
  const subscribe = useCallback((notify: () => void) => {
    const media = window.matchMedia(query);
    media.addEventListener('change', notify);
    return () => media.removeEventListener('change', notify);
  }, [query]);
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

/** Owns layout only. Layer, tool and feed state stay with their existing owners. */
export default function DashboardShell({ mobile, navigationVisible, onShowNavigation, navigation, news, status, search, children }: DashboardShellProps) {
  const [navigationChoice, setExpanded] = useState<boolean | null>(null);
  const [newsChoice, setNewsOpen] = useState<boolean | null>(null);
  const { panelRequest } = useWorldEvents();
  const [handledSelection, setHandledSelection] = useState(0);
  const narrow = useMediaQuery('(max-width: 1023px)');
  const wide = useMediaQuery('(min-width: 1440px)');
  const newsOpen = panelRequest > handledSelection || (newsChoice ?? !narrow);
  const expanded = (navigationChoice ?? wide) && (!narrow || !newsOpen);
  const navigationButton = useRef<HTMLButtonElement>(null);
  const newsButton = useRef<HTMLButtonElement>(null);

  const closeNews = () => { setHandledSelection(panelRequest); setNewsOpen(false); newsButton.current?.focus(); };
  const closeNavigation = () => { setExpanded(false); navigationButton.current?.focus(); };

  const openNavigation = () => {
    onShowNavigation(); setExpanded(true);
    if (narrow) { setHandledSelection(panelRequest); setNewsOpen(false); }
  };
  const openNews = () => {
    setHandledSelection(panelRequest); setNewsOpen(true);
    if (narrow) setExpanded(false);
  };

  if (mobile) return <>{children}</>;

  return (
    <div className="dashboard-shell" data-navigation={!navigationVisible ? 'hidden' : expanded ? 'expanded' : 'compact'} data-news={newsOpen ? 'open' : 'closed'}>
      <header className="dashboard-header">
        <div className="dashboard-brand"><Globe aria-hidden="true" /><div><strong>OSIRIS</strong><span>GLOBAL INTELLIGENCE</span></div></div>
        <div className="dashboard-header-status">{status}</div>
        <button ref={navigationButton} type="button" className="dashboard-icon-button dashboard-panel-toggle" title="Map layers panel" aria-label={navigationVisible && expanded ? 'Collapse navigation' : 'Expand navigation'} aria-expanded={navigationVisible && expanded} aria-controls="dashboard-navigation" onClick={() => {
          onShowNavigation();
          setExpanded(!navigationVisible || !expanded);
          if (narrow) { setHandledSelection(panelRequest); setNewsOpen(false); }
        }}>{navigationVisible && expanded ? <PanelLeftClose /> : <PanelLeftOpen />}<span>Layers</span></button>
        <button ref={newsButton} type="button" className="dashboard-icon-button dashboard-panel-toggle" title="World Events / Sources panel" aria-label={newsOpen ? 'Hide news panel' : 'Show news panel'} aria-expanded={newsOpen} aria-controls="dashboard-news" onClick={() => {
          setHandledSelection(panelRequest);
          setNewsOpen(!newsOpen);
          if (narrow) setExpanded(false);
        }}><Newspaper /><span>Events</span></button>
      </header>
      {(!navigationVisible || !expanded) && <button type="button" className="dashboard-reopen dashboard-reopen-left" aria-label="Open map layers panel" aria-controls="dashboard-navigation" aria-expanded={false} onClick={openNavigation}><PanelLeftOpen /><span>Layers</span></button>}
      {!newsOpen && <button type="button" className="dashboard-reopen dashboard-reopen-right" aria-label="Open World Events and Sources panel" aria-controls="dashboard-news" aria-expanded={false} onClick={openNews}><Newspaper /><span>Events</span></button>}
      {narrow && ((navigationVisible && expanded) || newsOpen) && <button type="button" className="dashboard-backdrop" aria-label="Close side panel" onClick={newsOpen ? closeNews : closeNavigation} />}
      <nav hidden={!navigationVisible} id="dashboard-navigation" className="dashboard-navigation" aria-label="Map layers and display settings" onKeyDown={event => {
        if (event.key === 'Escape' && expanded) { event.stopPropagation(); closeNavigation(); }
      }}>
        {expanded && <div className="dashboard-panel-heading"><span>MAP LAYERS</span><button type="button" className="dashboard-icon-button" aria-label="Collapse navigation" onClick={closeNavigation}><PanelLeftClose /></button></div>}
        <div className={expanded ? 'dashboard-navigation-content' : 'dashboard-navigation-rail'}>{navigation(!expanded)}</div>
      </nav>
      <div className="dashboard-workspace">
        {children}
        <div className="dashboard-search">{search}</div>
      </div>
      {newsOpen && <aside id="dashboard-news" className="dashboard-news" aria-label="World event feed" onKeyDown={event => {
        if (event.key === 'Escape') { event.stopPropagation(); closeNews(); }
      }}>
        <div className="dashboard-panel-heading"><span>WORLD EVENTS / SOURCES</span><button type="button" className="dashboard-icon-button" aria-label="Close news panel" onClick={closeNews}><X /></button></div>
        {news}
      </aside>}
    </div>
  );
}
