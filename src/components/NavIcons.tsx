/**
 * Line icons for navigation.
 *
 * Drawn here rather than pulled from an icon package: five glyphs do not
 * justify a dependency, and emoji — fine on a tile, where they carry a service's
 * identity — look accidental in a navigation bar, where every symbol should be
 * from the same hand.
 *
 * All of them use `currentColor` and a 1.6 stroke on a 24-unit grid, so they
 * inherit the active/inactive colour and stay optically even next to each other.
 */
type IconProps = { className?: string };

function Svg({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? "h-5 w-5"}
      aria-hidden
    >
      {children}
    </svg>
  );
}

export function HomeIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5.5 9.5V21h13V9.5" />
    </Svg>
  );
}

export function ChartIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3 20h18" />
      <path d="M6 20v-6M11 20V7M16 20v-9M21 20V4" />
    </Svg>
  );
}

export function BoxIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z" />
      <path d="M3 7.5 12 12l9-4.5M12 12v9" />
    </Svg>
  );
}

export function BellIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M6 9a6 6 0 1 1 12 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </Svg>
  );
}

export function BulbIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M9 18h6" />
      <path d="M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.5 10.9c.3.3.5.7.5 1.1h6c0-.4.2-.8.5-1.1A6 6 0 0 0 12 3z" />
    </Svg>
  );
}

export function MediaIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m10 9 5 3-5 3z" />
      <path d="M7 2.5 10 5M17 2.5 14 5" />
    </Svg>
  );
}

export function SearchIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5 21 21" />
    </Svg>
  );
}

export function GearIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9 5.3 5.3" />
    </Svg>
  );
}

export function SectionsIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </Svg>
  );
}

export function EventsIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3 12h4l2.5-5 4.2 10 2.4-5H21" />
      <path d="M3 4h18M3 20h18" />
    </Svg>
  );
}

export function DevicesIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="2.5" y="4" width="14" height="11" rx="1.5" />
      <path d="M7 19h8M11 15v4" />
      <rect x="18" y="8" width="3.5" height="10" rx="1" />
    </Svg>
  );
}

export function CalendarIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M7 3v4M17 3v4M3 10h18M8 15h3M14 15h2" />
    </Svg>
  );
}

export function TransferIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4" />
    </Svg>
  );
}

export function RequestsIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M7 3h8l4 4v14H5V3h2zM15 3v5h4M9 12h6M9 16h4" />
    </Svg>
  );
}

export function FilmIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 4v16M17 4v16M3 9h4m-4 6h4m10-6h4m-4 6h4" />
    </Svg>
  );
}

export function SeriesIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="5" y="6" width="16" height="14" rx="2" />
      <path d="M3 17V4h15M11 10l5 3-5 3z" />
    </Svg>
  );
}
