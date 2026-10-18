import type { BuiltinBadge } from '@silvercord/protocol';
import { useId } from 'react';
import styles from './badges.module.css';

/** Original vector insignia, lit consistently across all seven built-in achievements. */
export function BadgeArtwork({ kind }: { readonly kind: BuiltinBadge }) {
  const id = useId().replaceAll(':', '');
  const shield = kind === 'instance_admin' || kind === 'secured' || kind === 'verified';
  return (
    <svg className={styles['artwork']} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <defs>
        <linearGradient
          id={`${id}metal`}
          x1="12"
          y1="8"
          x2="47"
          y2="57"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#fff" />
          <stop offset=".35" stopColor="currentColor" />
          <stop offset=".65" stopColor="currentColor" stopOpacity=".65" />
          <stop offset="1" stopColor="#fff" />
        </linearGradient>
        <radialGradient id={`${id}core`}>
          <stop stopColor="currentColor" stopOpacity=".34" />
          <stop offset="1" stopColor="currentColor" stopOpacity=".04" />
        </radialGradient>
      </defs>
      <path
        d={
          shield
            ? 'M32 5 53 14v17c0 14-12 23-21 28C23 54 11 45 11 31V14Z'
            : 'M32 4 48 11 57 26 54 43 41 56 23 56 10 43 7 26 16 11Z'
        }
        fill={`url(#${id}core)`}
        stroke={`url(#${id}metal)`}
        strokeWidth="2"
      />
      <circle cx="32" cy="31" r="19" stroke="currentColor" opacity=".22" strokeDasharray="2 4" />
      {kind === 'founder' ? (
        <g stroke={`url(#${id}metal)`} strokeWidth="2.5">
          <ellipse cx="32" cy="31" rx="26" ry="9" transform="rotate(-27 32 31)" />
          <circle cx="32" cy="31" r="12" fill={`url(#${id}core)`} />
          <path
            d="m32 16 3.5 10.5L46 30l-10.5 3.5L32 44l-3.5-10.5L18 30l10.5-3.5Z"
            fill="currentColor"
            stroke="none"
          />
          <circle cx="52" cy="20" r="3" fill="#fff" />
        </g>
      ) : null}
      {kind === 'early_member' ? (
        <g fill={`url(#${id}metal)`}>
          <path d="m32 13 5.7 11.5 12.7 1.8-9.2 9 2.2 12.7L32 42l-11.4 6 2.2-12.7-9.2-9 12.7-1.8Z" />
          <path d="M10 14h6m-3-3v6m36 28h6m-3-3v6" stroke="currentColor" strokeWidth="2" />
        </g>
      ) : null}
      {kind === 'anniversary' ? (
        <g
          stroke={`url(#${id}metal)`}
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20 39h24v10H20zm-3 10h30M24 30v-5m8 5v-5m8 5v-5M20 36q6 8 12 0 6 8 12 0" />
          <path
            d="M24 22q-4-3 0-7 4 4 0 7m8 0q-4-3 0-7 4 4 0 7m8 0q-4-3 0-7 4 4 0 7"
            fill="currentColor"
            stroke="none"
          />
        </g>
      ) : null}
      {kind === 'instance_admin' ? (
        <g stroke={`url(#${id}metal)`} strokeWidth="2.5" strokeLinejoin="round">
          <path d="m18 22 7 6 7-12 7 12 7-6-4 18H22Z" fill={`url(#${id}core)`} />
          <path d="M24 44h16m-13-9h10" />
          <circle cx="32" cy="30" r="2" fill="#fff" stroke="none" />
        </g>
      ) : null}
      {kind === 'server_owner' ? (
        <g stroke={`url(#${id}metal)`} strokeWidth="2.5" strokeLinejoin="round">
          <path d="m16 23 9 8 7-15 7 15 9-8-5 20H21Z" fill={`url(#${id}core)`} />
          <path d="M23 48h18" strokeLinecap="round" />
          <circle cx="16" cy="21" r="2" fill="currentColor" />
          <circle cx="48" cy="21" r="2" fill="currentColor" />
        </g>
      ) : null}
      {kind === 'verified' ? (
        <path
          d="m21 31 8 8 16-18"
          stroke={`url(#${id}metal)`}
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {kind === 'secured' ? (
        <g stroke={`url(#${id}metal)`} strokeWidth="2.8">
          <rect x="21" y="28" width="22" height="18" rx="4" fill={`url(#${id}core)`} />
          <path d="M25 28v-6a7 7 0 0 1 14 0v6m-7 7v5" strokeLinecap="round" />
          <circle cx="32" cy="35" r="2" fill="#fff" />
        </g>
      ) : null}
    </svg>
  );
}
