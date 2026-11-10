import * as React from 'react';
import { cn } from '../../lib/utils';

// Mirrors the old .card rule in styles.css.
const Card = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('mb-3 rounded-md border border-border bg-surface p-4', className)}
    {...props}
  />
));
Card.displayName = 'Card';

export { Card };
