import * as React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import { cn } from '../../lib/utils';

// Mirrors the old .field label rule in styles.css.
const Label = React.forwardRef(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn('mb-1.5 block text-sm font-semibold', className)}
    {...props}
  />
));
Label.displayName = 'Label';

export { Label };
