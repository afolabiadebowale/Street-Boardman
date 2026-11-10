import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '../../lib/utils';

// Mirrors the old .card rule in styles.css. asChild lets a <Link> render
// as the card itself (several screens use the whole card as a nav link),
// same pattern as Button's asChild.
const Card = React.forwardRef(({ className, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : 'div';
  return (
    <Comp
      ref={ref}
      className={cn('mb-3 block rounded-md border border-border bg-surface p-4', className)}
      {...props}
    />
  );
});
Card.displayName = 'Card';

export { Card };
