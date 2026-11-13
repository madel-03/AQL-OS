const paths = {
  mic: 'M9 4a3 3 0 0 1 6 0v8a3 3 0 0 1-6 0V4Zm-4 7v1a7 7 0 0 0 14 0v-1m-7 8v4m-4 0h8',
  home: 'M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9',
  chat: 'M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 4V6a2 2 0 0 1 2-2ZM7 9h10M7 13h6',
  tasks: 'm3 6 2 2 4-4M12 6h9m-18 8 2 2 4-4m3 2h9M3 22l2-2m7 1h9',
  calendar: 'M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2ZM7 2v4m10-4v4M3 10h18M7 14h2m4 0h2m-8 4h2',
  projects: 'M3 7V5h7l2 3h9v12H3V7ZM3 11h18',
  desk: 'M4 3h16v18H4ZM8 7h8M8 11h8m-8 4h5',
  device: 'M3 4h18v13H3ZM8 21h8m-4-4v4',
  focus: 'M12 3a9 9 0 1 0 9 9 9 9 0 0 0-9-9Zm0 4v5l3 2',
  ideas: 'M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0c-1 1-1 2-1 2H9s0-1-1-2Z',
  memory: 'M8 4h8v4h4v8h-4v4H8v-4H4V8h4ZM9 9h6v6H9Z',
  ambience: 'M9 18V5l11-2v13M9 9l11-2M4 16a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm11-2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  goals: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
  reports: 'M4 20V10m5 10V4m5 16v-7m5 7V7',
  profile: 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM4 21v-3a8 5 0 0 1 16 0v3',
  investigate: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 6 6',
  history: 'M3 11a9 9 0 1 1 2 7M3 4v7h7m2-4v5l4 2',
  achievements: 'm12 3 3 6 6 1-4 5 1 6-6-3-6 3 1-6-4-5 6-1Z',
  lifeos: 'M3 12h4l3-8 4 16 3-8h4',
  menu: 'M4 6h16M4 12h16M4 18h16', close: 'm6 6 12 12M6 18 18 6',
  more: 'M5 12h.01M12 12h.01M19 12h.01', chevron: 'm9 5 7 7-7 7',
};
export default function AppIcon({ name, ...props }) {
  const aliases = { dashboard: 'home', commitments: 'focus' };
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}><path d={paths[aliases[name] || name] || paths.home} /></svg>;
}
