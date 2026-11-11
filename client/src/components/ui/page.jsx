import { cn } from '../../lib/utils';

// FEAT-050: the single source of truth for how wide the main content
// column gets at each breakpoint. #root (client/index.html) and
// BottomNav.jsx track the *shell* width (wider) independently — see the
// comments there for why they can't just read this component's classes.
export function Page({ className, ...props }) {
  return (
    <div
      className={cn(
        'mx-auto w-full max-w-[480px] px-4 pb-24 pt-4 sm:max-w-[560px] md:max-w-[640px] lg:max-w-[720px]',
        className
      )}
      {...props}
    />
  );
}
