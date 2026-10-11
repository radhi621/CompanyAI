import type { ReactNode } from "react";

export function ScopeIcon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="10" cy="10" r="2" fill="currentColor" />
    </svg>
  );
}

export function UploadIcon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path d="M10 13V4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M6.5 7.5L10 4l3.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 14.5h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function CalendarIcon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <rect x="3" y="4" width="14" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3 8h14" stroke="currentColor" strokeWidth="1.6" />
      <path d="M6.5 2v2M13.5 2v2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="7" cy="11" r="0.8" fill="currentColor" />
      <circle cx="10" cy="11" r="0.8" fill="currentColor" />
      <circle cx="13" cy="11" r="0.8" fill="currentColor" />
    </svg>
  );
}

export function UserIcon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <circle cx="10" cy="7" r="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4.5 16c1.3-2.2 3.3-3.3 5.5-3.3S14.2 13.8 15.5 16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function ControlsIcon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
      <path d="M4 6h12M4 10h12M4 14h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="6" r="1.1" fill="currentColor" />
      <circle cx="12" cy="10" r="1.1" fill="currentColor" />
      <circle cx="9" cy="14" r="1.1" fill="currentColor" />
    </svg>
  );
}

export function QuickActionsIcon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
      <path d="M10.8 2.8 6 9.3h3.1L8.7 17l5.4-6.7h-3.3l.1-7.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export function FetchIcon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
      <circle cx="9" cy="9" r="4.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="m12.3 12.3 3.2 3.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function InsertIcon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
      <circle cx="10" cy="10" r="6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 7v6M7 10h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function ToolLimitIcon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
      <rect x="3.5" y="4" width="4.2" height="4.2" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="12.3" y="4" width="4.2" height="4.2" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="3.5" y="11.8" width="4.2" height="4.2" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="12.3" y="11.8" width="4.2" height="4.2" rx="1" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function quickActionIcon(title: string): ReactNode {
  if (title.toLowerCase().includes("schedule")) {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
        <rect x="3.5" y="4.5" width="13" height="12" rx="2" stroke="currentColor" strokeWidth="1.6" />
        <path d="M6.5 3.3v2.2M13.5 3.3v2.2M3.5 8.5h13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }

  if (title.toLowerCase().includes("find")) {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
        <circle cx="8.6" cy="8.6" r="4" stroke="currentColor" strokeWidth="1.6" />
        <path d="m11.6 11.6 4.1 4.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }

  if (title.toLowerCase().includes("appointment")) {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
        <rect x="3.5" y="4.5" width="13" height="12" rx="2" stroke="currentColor" strokeWidth="1.6" />
        <path d="M10 8.3v4M8 10.3h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }

  if (title.toLowerCase().includes("patient") && title.toLowerCase().includes("create")) {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
        <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.6" />
        <path d="M3.5 15c1.2-2 2.8-3 4.5-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M13.5 8v5M11 10.5h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }

  if (title.toLowerCase().includes("patients")) {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
        <circle cx="7" cy="7.4" r="2.2" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="13.1" cy="8" r="1.9" stroke="currentColor" strokeWidth="1.5" />
        <path d="M3.9 14.8c.9-1.6 2.1-2.4 3.3-2.4 1.2 0 2.4.8 3.2 2.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M11 14.8c.5-1 1.3-1.5 2.3-1.5s1.8.5 2.4 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }

  if (title.toLowerCase().includes("note")) {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
        <path d="M5 4h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.5" />
        <path d="M6.5 8.5h7M6.5 11h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }

  if (title.toLowerCase().includes("availability") || title.toLowerCase().includes("schedule")) {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
        <circle cx="10" cy="10" r="6.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10 6.5V10l2.5 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }

  if (title.toLowerCase().includes("doctor")) {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
        <circle cx="10" cy="6" r="2.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M5 15.5c1-2 2.5-3 5-3s4 1 5 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M14 2.5l2 2-2 2M16 4.5h-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    );
  }

  if (title.toLowerCase().includes("search")) {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
        <circle cx="8.6" cy="8.6" r="4" stroke="currentColor" strokeWidth="1.6" />
        <path d="m11.6 11.6 4.1 4.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M10 5.5l3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    );
  }

  if (title.toLowerCase().includes("summary")) {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
        <path d="M4 4h12a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.5" />
        <path d="M7 8h6M7 10.5h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }

  if (title.toLowerCase().includes("staff") || title.toLowerCase().includes("account")) {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
        <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.6" />
        <path d="M3.5 15c1.2-2 2.8-3 4.5-3s3.3 1 4.5 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M14 6v5M11.5 8.5h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
      <path d="M10 3.5v13M3.5 10h13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
