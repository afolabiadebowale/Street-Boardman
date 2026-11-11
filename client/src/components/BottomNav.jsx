import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/utils';

const NAV_ITEMS = {
  BETTER: [
    { to: '/better', labelKey: 'nav.better.home', end: true },
    { to: '/better/competitions', labelKey: 'nav.better.bet' },
    { to: '/better/my-bets', labelKey: 'nav.better.myBets' },
    { to: '/better/wallet', labelKey: 'nav.better.wallet' },
    { to: '/better/profile', labelKey: 'nav.better.profile' },
  ],
  BOARDMAN: [
    { to: '/boardman', labelKey: 'nav.boardman.dashboard', end: true },
    { to: '/boardman/create', labelKey: 'nav.boardman.create' },
    { to: '/boardman/active', labelKey: 'nav.boardman.active' },
    { to: '/boardman/wallet', labelKey: 'nav.boardman.wallet' },
    { to: '/boardman/profile', labelKey: 'nav.boardman.profile' },
  ],
  ADMIN: [
    { to: '/admin', labelKey: 'nav.admin.overview', end: true },
    { to: '/admin/boardmen', labelKey: 'nav.admin.boardmen' },
    { to: '/admin/disputes', labelKey: 'nav.admin.disputes' },
    { to: '/admin/settings', labelKey: 'nav.admin.settings' },
  ],
};

export default function BottomNav({ role }) {
  const { t } = useTranslation('common');
  const items = NAV_ITEMS[role] || [];
  return (
    // FEAT-050: these breakpoints must match client/index.html's #root
    // shell width exactly — this bar is position:fixed, a sibling (not a
    // descendant) of #root's content, so it can't inherit that width.
    <nav className="fixed bottom-0 left-1/2 flex w-full max-w-[480px] -translate-x-1/2 justify-around border-t border-border bg-surface px-1 pt-2 pb-[calc(8px+env(safe-area-inset-bottom))] sm:max-w-[640px] md:max-w-[760px] lg:max-w-[880px]">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            cn('flex-1 px-0.5 py-1.5 text-center text-[11px] text-muted no-underline', isActive && 'font-bold text-primary')
          }
        >
          {t(item.labelKey)}
        </NavLink>
      ))}
    </nav>
  );
}
