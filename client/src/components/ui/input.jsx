import * as React from 'react';
import { cn } from '../../lib/utils';

// Mirrors the old .field input/select/textarea rules in styles.css, which
// styled all three identically via one comma-separated selector — so
// Select/Textarea below are thin native-element wrappers sharing the same
// box styling, not full custom listbox/autosize components.
const fieldBoxClasses = 'w-full rounded-[10px] border border-border bg-surface px-3.5 py-3.5 text-base';

const Input = React.forwardRef(({ className, type, ...props }, ref) => (
  <input type={type} ref={ref} className={cn(fieldBoxClasses, className)} {...props} />
));
Input.displayName = 'Input';

const Select = React.forwardRef(({ className, children, ...props }, ref) => (
  <select ref={ref} className={cn(fieldBoxClasses, className)} {...props}>
    {children}
  </select>
));
Select.displayName = 'Select';

const Textarea = React.forwardRef(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(fieldBoxClasses, className)} {...props} />
));
Textarea.displayName = 'Textarea';

export { Input, Select, Textarea };
