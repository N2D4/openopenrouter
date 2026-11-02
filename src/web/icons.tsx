import type { ReactNode, SVGProps } from "react";

/** Line icons drawn on a 24px grid, stroked with currentColor. */
function Icon({ children, size = 16, ...rest }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

type P = SVGProps<SVGSVGElement> & { size?: number };
export const SearchIcon = (p: P) => <Icon {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Icon>;
export const ArrowRight = (p: P) => <Icon {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Icon>;
export const ExternalIcon = (p: P) => <Icon {...p}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></Icon>;
export const SunIcon = (p: P) => <Icon {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></Icon>;
export const MoonIcon = (p: P) => <Icon {...p}><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" /></Icon>;
export const MonitorIcon = (p: P) => <Icon {...p}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></Icon>;
export const MenuIcon = (p: P) => <Icon {...p}><path d="M4 7h16M4 12h16M4 17h16" /></Icon>;
export const CloseIcon = (p: P) => <Icon {...p}><path d="M6 6l12 12M18 6 6 18" /></Icon>;
export const MailIcon = (p: P) => <Icon {...p}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></Icon>;
export const KeyIcon = (p: P) => <Icon {...p}><circle cx="8" cy="15" r="4" /><path d="m10.8 12.2 8.7-8.7M17 6l2.5 2.5M14.5 8.5 16.5 10.5" /></Icon>;
export const FingerprintIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 11v3a8 8 0 0 1-1.5 4.5M8.5 20a10 10 0 0 0 1.5-6v-2a2 2 0 1 1 4 0v1M16 17c-.2 1.3-.6 2.6-1.1 3.6M6 15.5a14 14 0 0 0 .1-3.5 6 6 0 0 1 11.9-1M21 13.5c0 .9-.1 1.7-.2 2.5M3.5 9a9 9 0 0 1 14.2-4.4" />
  </Icon>
);
export const UserIcon = (p: P) => <Icon {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></Icon>;
export const CardIcon = (p: P) => <Icon {...p}><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M2.5 10h19M6 15h3" /></Icon>;
export const LockIcon = (p: P) => <Icon {...p}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></Icon>;
export const CheckIcon = (p: P) => <Icon {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></Icon>;
export const TerminalIcon = (p: P) => <Icon {...p}><path d="m5 7 5 5-5 5M12 18h7" /></Icon>;
export const CodeIcon = (p: P) => <Icon {...p}><path d="m8 7-5 5 5 5M16 7l5 5-5 5" /></Icon>;
export const PlugIcon = (p: P) => <Icon {...p}><path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0V8ZM12 17v4" /></Icon>;

/** OpenOpenRouter mark: an open ring routing to two endpoints. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="var(--accent)" />
      <circle cx="22" cy="32" r="8.5" fill="none" stroke="#fff" strokeWidth="5.5" />
      <path d="M30.5 32H36c5.5 0 6-11 12.5-11M36 32c5.5 0 6 11 12.5 11" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
      <circle cx="49" cy="21" r="3.5" fill="#fff" />
      <circle cx="49" cy="43" r="3.5" fill="#fff" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="logo">
      <LogoMark />
      <span className="logo-word">openopenrouter</span>
    </span>
  );
}

/** Monogram tile for a model author (we don't ship third-party logos). */
export function AuthorTile({ author, size = 40 }: { author: string; size?: number }) {
  const label: Record<string, ReactNode> = { openai: "O", anthropic: "A" };
  return (
    <span className={`author-tile author-${author}`} style={{ width: size, height: size, fontSize: size * 0.45 }} aria-hidden="true">
      {label[author] ?? author.slice(0, 1).toUpperCase()}
    </span>
  );
}
