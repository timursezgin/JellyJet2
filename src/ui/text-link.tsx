import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';

/**
 * A name inside running text that goes somewhere when clicked (an artist, an
 * album). Plain inline text rather than a <button>: buttons are boxes, so a
 * long name couldn't wrap, be cut short with "…" or line-clamped with the
 * text around it.
 */
export function TextLink({
  onOpen,
  className,
  children,
}: {
  onOpen(): void;
  className?: string;
  children: ReactNode;
}) {
  const open = (e: MouseEvent | KeyboardEvent) => {
    e.stopPropagation();
    onOpen();
  };
  return (
    <span
      role="link"
      tabIndex={0}
      className={className}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter') open(e);
      }}
    >
      {children}
    </span>
  );
}
