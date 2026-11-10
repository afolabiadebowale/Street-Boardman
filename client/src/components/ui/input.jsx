import * as React from 'react';
import { cn } from '../../lib/utils';

// Mirrors the old .field input/select/textarea rules in styles.css.
const Input = React.forwardRef(({ className, type, ...props }, ref) => (
  <input
    type={type}
    ref={ref}
    className={cn(
      'w-full rounded-[10px] border border-border bg-surface px-3.5 py-3.5 text-base',
      className
    )}
    {...props}
  />
));
Input.displayName = 'Input';

export { Input };
