import { useId } from 'react';

/** Lucide's heart, drawn in the same 24-unit box. */
const HEART =
  'M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5';

/** The record takes the top-left of the box; the heart sits on its lower right. */
const DISC_SCALE = 0.86;
const HEART_SCALE = 0.48;
const HEART_AT = { x: 12.4, y: 12.6 };

/**
 * Liked Albums' icon: a record with a small heart on its lower right, cut out
 * of the record so the two never tangle. Takes Lucide's props, so it can stand
 * in for a Lucide icon: `fill="currentColor"` fills the heart (liked), "none"
 * leaves it an outline.
 */
export function AlbumLikeIcon({
  size = 24,
  strokeWidth = 2,
  fill = 'none',
  className,
}: {
  size?: number;
  strokeWidth?: number;
  fill?: string;
  className?: string;
}) {
  const mask = useId();
  const heartAt = `translate(${HEART_AT.x} ${HEART_AT.y}) scale(${HEART_SCALE})`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect width="24" height="24" fill="#fff" stroke="none" />
        <path d={HEART} transform={heartAt} fill="#000" stroke="#000" strokeWidth={(strokeWidth + 3) / HEART_SCALE} />
      </mask>
      <g mask={`url(#${mask})`} transform={`scale(${DISC_SCALE})`} strokeWidth={strokeWidth / DISC_SCALE}>
        <circle cx="12" cy="12" r="10" />
        <path d="M6 12c0-1.7.7-3.2 1.8-4.2" />
        <circle cx="12" cy="12" r="2" />
        <path d="M18 12c0 1.7-.7 3.2-1.8 4.2" />
      </g>
      <path
        d={HEART}
        transform={heartAt}
        fill={fill === 'none' ? 'none' : 'currentColor'}
        strokeWidth={strokeWidth / HEART_SCALE}
      />
    </svg>
  );
}
