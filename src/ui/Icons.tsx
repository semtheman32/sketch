import type { ReactNode } from 'react'

const paths: Record<string, ReactNode> = {
  select: <path d="M5 3.5l10 5.2-4.4 1.3-1.9 4.5z" strokeLinejoin="round" />,
  bond: <path d="M4 15.5L16 4.5" />,
  atom: <><circle cx="10" cy="10" r="6.5" /><path d="M12.2 7.6a3.2 3.2 0 1 0 0 4.8" /></>,
  ring: <path d="M10 3l6 3.5v7L10 17l-6-3.5v-7z" strokeLinejoin="round" />,
  arrow: <><path d="M3 10h12.5" /><path d="M12.5 6.5L16.5 10l-4 3.5" strokeLinejoin="round" /></>,
  curly: <><path d="M4 15C4.5 7 11 4 15.5 8.5" /><path d="M12.5 9.3l3.6-.3-.5-3.6" strokeLinejoin="round" /></>,
  text: <path d="M5 5h10M10 5v11" />,
  eraser: <><path d="M8 16.5h8" /><path d="M4.6 12.4l7-7a1.6 1.6 0 0 1 2.2 0l1.8 1.8a1.6 1.6 0 0 1 0 2.2L10 15h-3z" strokeLinejoin="round" /></>,
  undo: <><path d="M7 7.5H12a4 4 0 0 1 0 8H8" /><path d="M9.5 4.5l-3 3 3 3" strokeLinejoin="round" /></>,
  redo: <><path d="M13 7.5H8a4 4 0 0 0 0 8h4" /><path d="M10.5 4.5l3 3-3 3" strokeLinejoin="round" /></>,
  download: <><path d="M10 3.5v9M6.5 9l3.5 3.5L13.5 9" strokeLinejoin="round" /><path d="M4 15.5h12" /></>,
  open: <path d="M3.5 6V15a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1H10L8.5 5H4.5a1 1 0 0 0-1 1z" strokeLinejoin="round" />,
  save: <><path d="M4.5 3.5h9l2 2v10a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z" strokeLinejoin="round" /><path d="M7 3.5v4h6v-4M7 16.5v-5h6v5" /></>,
  sparkles: <><path d="M9 3.5l1.4 3.6L14 8.5l-3.6 1.4L9 13.5l-1.4-3.6L4 8.5l3.6-1.4z" strokeLinejoin="round" /><path d="M14.5 12.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z" strokeLinejoin="round" /></>,
  sun: <><circle cx="10" cy="10" r="3.2" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" /></>,
  moon: <path d="M15.5 12.2A6 6 0 0 1 7.8 4.5a6 6 0 1 0 7.7 7.7z" strokeLinejoin="round" />,
  fit: <path d="M3.5 7.5v-4h4M12.5 3.5h4v4M16.5 12.5v4h-4M7.5 16.5h-4v-4" />,
  clean: <><path d="M10 3v3M10 14v3M3 10h3M14 10h3" /><circle cx="10" cy="10" r="3" /></>,
  trash: <><path d="M4 6h12M8 6V4.5h4V6" /><path d="M5.5 6l.8 10h7.4l.8-10" strokeLinejoin="round" /></>,
  plus: <path d="M10 4.5v11M4.5 10h11" />,
  close: <path d="M5 5l10 10M15 5L5 15" />,
  search: <><circle cx="8.8" cy="8.8" r="5" /><path d="M12.6 12.6L16.5 16.5" /></>,
  copy: <><rect x="6.5" y="6.5" width="10" height="10" rx="2" /><path d="M4 13.5V5.5A2 2 0 0 1 6 3.5h7.5" /></>,
  palette: <><path d="M10 3.5a6.5 6.5 0 1 0 0 13c1.2 0 1.6-.9 1.2-1.8-.5-1-.1-2.2 1.1-2.2H14a2.5 2.5 0 0 0 2.5-2.5c0-3.6-2.9-6.5-6.5-6.5z" /><circle cx="6.6" cy="9" r=".9" fill="currentColor" /><circle cx="9" cy="6.4" r=".9" fill="currentColor" /><circle cx="12.4" cy="7" r=".9" fill="currentColor" /></>,
  shapes: <><path d="M5.5 4.5l3.2 1.9v3.7L5.5 12 2.3 10.1V6.4z" strokeLinejoin="round" /><rect x="11" y="10.5" width="6" height="6" rx="1.2" /><circle cx="14" cy="5.5" r="2.6" /></>,
  rotl: <><path d="M5 8.5A5.5 5.5 0 1 1 6 14" /><path d="M4.5 4.5v4h4" strokeLinejoin="round" /></>,
  rotr: <><path d="M15 8.5A5.5 5.5 0 1 0 14 14" /><path d="M15.5 4.5v4h-4" strokeLinejoin="round" /></>,
  fliph: <><path d="M10 3v14" strokeDasharray="2 2" /><path d="M7.5 6L3.5 14h4zM12.5 6l4 8h-4z" strokeLinejoin="round" /></>,
  flipv: <><path d="M3 10h14" strokeDasharray="2 2" /><path d="M6 7.5L14 3.5v4zM6 12.5l8 4v-4z" strokeLinejoin="round" /></>,
  bracket: <path d="M7 3.5H4.5v13H7M13 3.5h2.5v13H13" strokeLinejoin="round" />,
  expand: <><path d="M4 10h4M12 10h4M10 4v4M10 12v4" /><circle cx="10" cy="10" r="1.6" /></>,
  command: <path d="M7 4.5a2.5 2.5 0 1 0 0 5h6a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0-2.5 2.5v6a2.5 2.5 0 1 0 2.5-2.5H7a2.5 2.5 0 1 0 2.5 2.5V7A2.5 2.5 0 0 0 7 4.5z" strokeLinejoin="round" />,
  send: <><path d="M10 16V4.5" /><path d="M5.5 9L10 4.5 14.5 9" strokeLinejoin="round" /></>,
  stop: <rect x="5.5" y="5.5" width="9" height="9" rx="1.5" fill="currentColor" stroke="none" />,
  book: <><path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H10v13H5.5A1.5 1.5 0 0 0 4 17.5z" strokeLinejoin="round" /><path d="M16 4.5A1.5 1.5 0 0 0 14.5 3H10v13h4.5a1.5 1.5 0 0 1 1.5 1.5z" strokeLinejoin="round" /></>,
  flask: <><path d="M8 3.5h4M8.5 3.5v4.5L4.5 15a1 1 0 0 0 .9 1.5h9.2a1 1 0 0 0 .9-1.5l-4-7V3.5" strokeLinejoin="round" /><path d="M6.5 12.5h7" /></>,
}

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden="true">
      {paths[name]}
    </svg>
  )
}
