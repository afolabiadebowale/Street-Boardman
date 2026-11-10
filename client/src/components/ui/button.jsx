import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/utils';

// Mirrors the old .btn/.btn-primary/.btn-secondary/.btn-danger rules in
// styles.css (full-width mobile CTAs) so migrated screens look identical.
const buttonVariants = cva(
  'mb-3 flex w-full items-center justify-center rounded-md px-4 py-4 text-[17px] font-semibold text-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed [&:not(button)]:cursor-pointer',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-white active:bg-primary-dark',
        secondary: 'bg-surface text-primary border-2 border-primary',
        destructive: 'bg-danger text-white',
      },
    },
    defaultVariants: {
      variant: 'primary',
    },
  }
);

const Button = React.forwardRef(({ className, variant, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant }), className)} ref={ref} {...props} />;
});
Button.displayName = 'Button';

export { Button, buttonVariants };
