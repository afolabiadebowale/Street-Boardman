import { NavLink } from 'react-router-dom';
import { cn } from '../lib/utils';

const NAV_ITEMS = {
  BETTER: [
    { to: '/better', label: 'Home', end: true },
    { to: '/better/competitions', label: 'Bet' },
    { to: '/better/my-bets', label: 'My Bets' },
    { to: '/better/wallet', label: 'Wallet' },
    { to: '/better/profile', label: 'Profile' },
  ],
  BOARDMAN: [
    { to: '/boardman', label: 'Dashboard', end: true },
    { to: '/boardman/create', label: 'Create' },
    { to: '/boardman/active', label: 'Active' },
    { to: '/boardman/wallet', label: 'Wallet' },
    { to: '/boardman/profile', label: 'Profile' },
  ],
  ADMIN: [
    { to: '/admin', label: 'Overview', end: true },
    { to: '/admin/boardmen', label: 'Boardmen' },
    { to: '/admin/disputes', label: 'Disputes' },
    { to: '/admin/settings', label: 'Settings' },
  ],
};

export default function BottomNav({ role }) {
  const items = NAV_ITEMS[role] || [];
  return (
    <nav className="fixed bottom-0 left-1/2 flex w-full max-w-[480px] -translate-x-1/2 justify-around border-t border-border bg-surface px-1 pt-2 pb-[calc(8px+env(safe-area-inset-bottom))]">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            cn('flex-1 px-0.5 py-1.5 text-center text-[11px] text-muted no-underline', isActive && 'font-bold text-primary')
          }
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
