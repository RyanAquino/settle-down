// utils/theme.ts — Quiet design tokens
// Monochrome surface with a single indigo accent and deterministic person colors.

export const theme = {
  // surfaces
  bg: '#F5F5F7',
  surface: '#FFFFFF',
  surfaceAlt: '#FAFAFC',

  // text
  ink: '#0B0B0F',
  inkMuted: '#6B6B74',
  inkFaint: '#A8A8B0',

  // borders / hairlines
  border: 'rgba(11,11,15,0.08)',
  borderStrong: 'rgba(11,11,15,0.14)',

  // accents
  accent: '#3B3BE8',
  accentBg: 'rgba(59,59,232,0.08)',
  accentInk: '#3B3BE8',

  // semantic
  success: '#0E8A4F',
  warn: '#C8621B',
  danger: '#C82B2B',

  // radii
  radius: 14,
  radiusSm: 10,
  radiusLg: 22,
  radiusXl: 28,

  // per-person palette (stable, distinguishable)
  personColors: ['#E8556B', '#4E89E0', '#E8A33E', '#5FB88A', '#9066D4', '#3DAFA8'],
} as const;

// --- elevation -------------------------------------------------------------
// Soft, low-contrast shadows. Depth comes from layering many faint shadows,
// not one harsh drop — this is what keeps "minimal" from looking flat.
export const shadow = {
  sm: {
    shadowColor: '#0B0B0F',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  md: {
    shadowColor: '#0B0B0F',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 4,
  },
  lg: {
    shadowColor: '#0B0B0F',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.12,
    shadowRadius: 30,
    elevation: 12,
  },
} as const;

// --- motion ----------------------------------------------------------------
// One vocabulary for movement across the app. A single, slightly-overshooting
// spring + a calm entrance easing read as "considered" rather than "bouncy".
export const motion = {
  entranceDuration: 440,
  stagger: 70, // ms between successive revealed elements
  pressScale: 0.965, // how far a tappable shrinks while held
  spring: { friction: 7, tension: 140 },
} as const;

// --- type scale ------------------------------------------------------------
// Centralized so headings/labels stay in proportion across screens.
export const type = {
  display: { fontSize: 30, fontWeight: '700' as const, letterSpacing: -0.8, lineHeight: 36 },
  title: { fontSize: 22, fontWeight: '600' as const, letterSpacing: -0.4 },
  body: { fontSize: 16, fontWeight: '500' as const, letterSpacing: -0.2 },
  label: { fontSize: 13, fontWeight: '600' as const, letterSpacing: -0.1 },
  eyebrow: { fontSize: 10, fontWeight: '700' as const, letterSpacing: 1.4 },
  numeral: { fontVariant: ['tabular-nums'] as ['tabular-nums'] },
} as const;

// deterministic color per user id — same person → same color across the app.
// Uses FNV-1a hash for much better distribution than the old naive hash.
export function colorForUser(userId: string): string {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return theme.personColors[hash % theme.personColors.length];
}

// When rendering a fixed group of users on one screen, index-based assignment
// guarantees every user gets a different color (up to palette size).
// Prefer this over `colorForUser` inside a known member list.
export function colorForUserIndex(index: number): string {
  return theme.personColors[((index % theme.personColors.length) + theme.personColors.length) % theme.personColors.length];
}

// Build a stable id → color map for a list of users, with no duplicates
// as long as the group is smaller than the palette.
export function buildUserColorMap(users: { id: string }[]): Record<string, string> {
  const map: Record<string, string> = {};
  users.forEach((u, i) => {
    map[u.id] = colorForUserIndex(i);
  });
  return map;
}

export function initialFor(name: string): string {
  return (name || '?').trim().charAt(0).toUpperCase();
}
