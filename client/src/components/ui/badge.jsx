import * as React from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/utils';

// Mirrors the old .badge/.badge-*/.trust-badge rules in styles.css —
// same color pairs, kept as literal hex since they're one-off tints that
// don't belong in the shared theme palette.
const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold',
  {
    variants: {
      variant: {
        open: 'bg-[#e6f4ea] text-primary-dark',
        won: 'bg-[#e6f4ea] text-primary-dark',
        trust: 'bg-[#e6f4ea] text-primary-dark',
        closed: 'bg-[#eef0ee] text-muted',
        lost: 'bg-[#eef0ee] text-muted',
        pending: 'bg-[#fff4e0] text-[#8a5b00]',
        disputed: 'bg-[#fdecea] text-danger',
      },
    },
    defaultVariants: {
      variant: 'open',
    },
  }
);

const Badge = React.forwardRef(({ className, variant, ...props }, ref) => (
  <span ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />
));
Badge.displayName = 'Badge';

export { Badge, badgeVariants };
