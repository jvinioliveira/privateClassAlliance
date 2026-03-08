import { NavLink as RouterNavLink } from 'react-router-dom';
import { LucideIcon } from 'lucide-react';

interface BottomNavItem {
  to: string;
  icon: LucideIcon;
  label: string;
  end?: boolean;
  badgeCount?: number;
}

interface BottomNavProps {
  items: BottomNavItem[];
}

const BottomNav = ({ items }: BottomNavProps) => {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card/95 backdrop-blur-lg pb-safe">
      <div className="mx-auto flex max-w-4xl items-center gap-0.5 overflow-x-auto px-1 py-1.5">
        {items.map((item) => {
          const badgeCount = item.badgeCount ?? 0;

          return (
            <RouterNavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex min-w-[56px] flex-1 flex-col items-center gap-0.5 px-1.5 py-1 text-[10px] transition-colors sm:text-[11px] ${
                isActive
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`
            }
          >
            <span className="relative">
              <item.icon className="h-[18px] w-[18px]" />
              {badgeCount > 0 && (
                <span
                  className="absolute -right-2 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-semibold leading-none text-destructive-foreground"
                  aria-label={`${badgeCount} notificações não lidas`}
                >
                  {badgeCount > 9 ? '9+' : badgeCount}
                </span>
              )}
            </span>
            <span className="max-w-full truncate whitespace-nowrap font-medium">{item.label}</span>
          </RouterNavLink>
          );
        })}
      </div>
    </nav>
  );
};

export default BottomNav;
