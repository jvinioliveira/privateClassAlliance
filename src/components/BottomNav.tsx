import { NavLink as RouterNavLink } from 'react-router-dom';
import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BottomNavItem {
  to: string;
  icon: LucideIcon;
  label: string;
  end?: boolean;
  badgeCount?: number;
  avatarUrl?: string | null;
  iconClassName?: string;
}

interface BottomNavProps {
  items: BottomNavItem[];
}

const BottomNav = ({ items }: BottomNavProps) => {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/80 bg-card/95 pb-safe shadow-[0_-8px_28px_-20px_rgba(0,0,0,0.8)] backdrop-blur-xl">
      <div
        className="mx-auto grid max-w-4xl items-center gap-1 px-2 py-2"
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      >
        {items.map((item) => {
          const badgeCount = item.badgeCount ?? 0;

          return (
            <RouterNavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'group flex min-h-[56px] flex-col items-center justify-center rounded-xl px-1 py-1 text-[10px] transition-colors sm:text-[11px]',
                  isActive
                    ? 'bg-primary/12 text-primary'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cn(
                      'relative transition-transform duration-200 ease-out',
                      isActive ? 'scale-110' : 'scale-100',
                    )}
                  >
                    {item.avatarUrl ? (
                      <img
                        src={item.avatarUrl}
                        alt={`Foto de perfil - ${item.label}`}
                        className={cn(
                          'h-6 w-6 rounded-full border object-cover transition-all duration-200 ease-out',
                          isActive ? 'border-primary/50' : 'border-primary/30',
                        )}
                        loading="lazy"
                      />
                    ) : (
                      <item.icon
                        className={cn(
                          'h-[18px] w-[18px] transition-transform duration-200 ease-out',
                          isActive ? 'scale-110' : 'scale-100',
                          item.iconClassName,
                        )}
                      />
                    )}
                    {badgeCount > 0 && (
                      <span
                        className="absolute -right-2 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-semibold leading-none text-destructive-foreground"
                        aria-label={`${badgeCount} notificacoes nao lidas`}
                      >
                        {badgeCount > 9 ? '9+' : badgeCount}
                      </span>
                    )}
                  </span>

                  <span
                    className={cn(
                      'max-w-full overflow-hidden whitespace-nowrap font-medium transition-all duration-200 ease-out',
                      isActive ? 'mt-1 max-h-4 translate-y-0 opacity-100' : 'max-h-0 -translate-y-1 opacity-0',
                    )}
                  >
                    {item.label}
                  </span>
                </>
              )}
            </RouterNavLink>
          );
        })}
      </div>
    </nav>
  );
};

export default BottomNav;
