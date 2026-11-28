import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  BookOpen,
  Bookmark,
  ChevronLeft,
  Compass,
  Plus,
  SlidersHorizontal,
} from 'lucide-react';
import { haptic } from '../lib/haptics';
import { DollCabinetDrawer } from './DollCabinetDrawer';
import { HomeBrandLetterHero } from './HomeBrandLetterHero';
import { WorkshopMusic } from './WorkshopMusic';

interface LayoutProps {
  children: ReactNode;
}

const NAV_ITEMS = [
  { label: '展馆', to: '/', icon: Compass, kind: 'standard' as const },
  { label: '图鉴', to: '/plaza', icon: BookOpen, kind: 'standard' as const },
  { label: '定制', to: '/create', icon: Plus, kind: 'create' as const },
  { label: '收藏', to: '/works', icon: Bookmark, kind: 'standard' as const },
  { label: '控制台', to: '/dev', icon: SlidersHorizontal, kind: 'utility' as const },
] as const;

function getRouteMeta(pathname: string): {
  isRootTab: boolean;
  title: string;
  backTo: string;
  backLabel: string;
  hideBottomTab: boolean;
} {
  if (pathname === '/') {
    return { isRootTab: true, title: '果壳碰碰', backTo: '/', backLabel: '', hideBottomTab: false };
  }
  if (pathname === '/plaza') {
    return { isRootTab: true, title: '人格图鉴', backTo: '/', backLabel: '', hideBottomTab: false };
  }
  if (pathname === '/create') {
    return { isRootTab: true, title: '定制角色', backTo: '/', backLabel: '', hideBottomTab: false };
  }
  if (pathname === '/works') {
    return { isRootTab: true, title: '我的收藏', backTo: '/', backLabel: '', hideBottomTab: false };
  }
  if (pathname === '/dev') {
    return { isRootTab: true, title: '控制台', backTo: '/', backLabel: '', hideBottomTab: false };
  }
  if (pathname.startsWith('/nfc/')) {
    return { isRootTab: false, title: 'NFC 唤醒', backTo: '/', backLabel: '展馆', hideBottomTab: false };
  }
  if (pathname.startsWith('/d/') && pathname.endsWith('/chat')) {
    const dollId = pathname.split('/')[2] || '';
    return {
      isRootTab: false,
      title: '角色对话',
      backTo: dollId ? `/d/${dollId}` : '/',
      backLabel: '档案',
      hideBottomTab: true,
    };
  }
  if (pathname.startsWith('/d/')) {
    return {
      isRootTab: false,
      title: '角色档案',
      backTo: '/',
      backLabel: '展馆',
      hideBottomTab: false,
    };
  }
  if (pathname.startsWith('/create/processing')) {
    return {
      isRootTab: false,
      title: '正在绘制',
      backTo: '/create',
      backLabel: '定制',
      hideBottomTab: false,
    };
  }
  if (pathname.startsWith('/card/')) {
    return {
      isRootTab: false,
      title: '作品与绑定',
      backTo: '/works',
      backLabel: '收藏',
      hideBottomTab: false,
    };
  }
  return { isRootTab: true, title: '果壳碰碰', backTo: '/', backLabel: '', hideBottomTab: false };
}

export function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [cabinetOpen, setCabinetOpen] = useState(false);

  const isHome = location.pathname === '/';

  useEffect(() => {
    setCabinetOpen(false);
  }, [location.pathname]);

  const isActive = (to: string) => {
    if (to === '/') return location.pathname === '/' || location.pathname.startsWith('/d/');
    if (to === '/create') return location.pathname.startsWith('/create');
    if (to === '/works')
      return location.pathname.startsWith('/works') || location.pathname.startsWith('/card/');
    return location.pathname.startsWith(to);
  };

  const routeMeta = getRouteMeta(location.pathname);

  return (
    <div className="min-h-dvh flex flex-col journal-paper text-[#382A22]">
      {/* Unified Apple-Style Frosted Top Navigation Bar */}
      <header className="sticky top-0 z-30 ios-glass-bar border-b border-[#EAE2D6]/85">
        <div className={`mx-auto h-12 max-w-[1160px] items-center px-3.5 sm:px-8 md:h-14 ${isHome
          ? 'flex justify-between gap-2' : 'grid grid-cols-3'}`}>
          {isHome ? <HomeBrandLetterHero /> : (
            <div className="flex items-center justify-start">
              {routeMeta.isRootTab ? (
                <Link
                  to="/"
                  onClick={() => haptic('selection')}
                  className="group inline-flex items-center gap-2 text-[#382A22] active:opacity-60 transition-opacity whitespace-nowrap"
                >
                  <svg
                    width="21"
                    height="21"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                    className="text-[#4A8276] transition-transform duration-300 group-hover:rotate-[-8deg]"
                  >
                    <path
                      d="M12 3.2V5.4"
                      stroke="#C9963B"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                    <path
                      d="M6.4 9.2C6.4 7.0 8.9 5.4 12 5.4C15.1 5.4 17.6 7.0 17.6 9.2H6.4Z"
                      fill="currentColor"
                      fillOpacity="0.16"
                      stroke="currentColor"
                      strokeWidth="1.65"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M7.6 9.5C7.6 14.2 9.4 18.2 12 19.9C14.6 18.2 16.4 14.2 16.4 9.5"
                      stroke="#382A22"
                      strokeWidth="1.65"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span className="hidden sm:inline font-editorial text-[16px] font-semibold tracking-tight text-[#382A22]">
                    果壳碰碰
                  </span>
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    haptic('light');
                    navigate(routeMeta.backTo);
                  }}
                  className="inline-flex items-center gap-0.5 text-[14.5px] font-medium text-[#4A8276] active:opacity-55 transition-opacity min-h-[40px] pr-2 whitespace-nowrap"
                >
                  <ChevronLeft className="w-5 h-5 -ml-1" strokeWidth={2} />
                  <span>{routeMeta.backLabel}</span>
                </button>
              )}
            </div>
          )}
          {!isHome && (
            <div className="text-center font-editorial text-[16px] md:text-[17px] font-semibold tracking-tight text-[#382A22] truncate">
              {routeMeta.title}
            </div>
          )}
          <div className="flex items-center justify-end gap-1 sm:gap-2">
            {isHome ? (
              <button
                type="button"
                onClick={() => {
                  haptic('light');
                  setCabinetOpen(true);
                }}
                aria-label="打开娃娃收藏柜"
                aria-expanded={cabinetOpen}
                className="group inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-medium btn-ink-tinted whitespace-nowrap shrink-0"
              >
                {/* Bespoke Japanese Wooden Display Cabinet Icon */}
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                  className="text-[#356B5F] transition-transform duration-200 group-hover:scale-105"
                >
                  <rect
                    x="3.5"
                    y="3.5"
                    width="17"
                    height="17"
                    rx="3.5"
                    stroke="currentColor"
                    strokeWidth="1.7"
                  />
                  <path
                    d="M3.5 12H20.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                  <path
                    d="M12 3.5V12"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeOpacity="0.65"
                  />
                  <circle cx="7.8" cy="8.2" r="1.45" fill="#C9963B" />
                  <circle cx="16.2" cy="8.2" r="1.45" fill="currentColor" fillOpacity="0.72" />
                  <path
                    d="M8.5 16.4H15.5"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
                <span className="text-[11.5px] sm:text-xs">收藏柜</span>
              </button>
            ) : (
              <span className="hidden sm:inline font-atelier-num italic text-[13.5px] tracking-[0.06em] text-[#968477]">
                NutShell Atelier
              </span>
            )}
            <WorkshopMusic />
          </div>
        </div>
      </header>

      {/* Main Content with bottom clearance for persistent Apple Bottom Tab Bar */}
      <motion.main
        key={location.pathname}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className={`flex-1 ${routeMeta.hideBottomTab ? '' : 'pb-[80px] md:pb-[96px]'}`}
      >
        {children}
      </motion.main>

      {/* Always-Visible Apple iOS Bottom Tab Bar (Edge-to-edge on mobile, Floating Glass Dock on tablet/desktop) */}
      {!routeMeta.hideBottomTab && (
        <div className="fixed bottom-0 inset-x-0 md:bottom-4 z-40 pointer-events-none flex justify-center">
          <nav
            aria-label="底部导航"
            className="pointer-events-auto w-full md:w-auto md:min-w-[468px] ios-tab-bar md:rounded-full"
          >
            <div className="grid grid-cols-5 items-center h-[60px] md:h-[64px] max-w-lg mx-auto px-1.5 md:px-3.5 gap-0.5">
              {NAV_ITEMS.map((item) => {
                const active = isActive(item.to);
                const Icon = item.icon;

                // Signature tactile circular seal for the "定制" creation tab
                if (item.kind === 'create') {
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      data-pressable="tab"
                      onClick={() => haptic('medium')}
                      aria-current={active ? 'page' : undefined}
                      className="group relative flex flex-col items-center justify-center gap-0.5 py-1 select-none"
                    >
                      <span
                        className={`relative w-9 h-9 rounded-full flex items-center justify-center transition-all duration-250 ${
                          active
                            ? 'bg-gradient-to-b from-[#589688] to-[#3E7468] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_6px_16px_-3px_rgba(62,116,104,0.48)] scale-105'
                            : 'bg-gradient-to-b from-[#F2FAF7] to-[#E3F1EC] border border-[#C2DDD4] text-[#2F6358] shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_2px_6px_-2px_rgba(62,116,104,0.16)] group-hover:border-[#94C0B2]'
                        }`}
                      >
                        <Icon className="w-[18px] h-[18px]" strokeWidth={2.25} />
                      </span>
                      <span
                        className={`text-[10px] tracking-tight transition-colors ${
                          active ? 'text-[#29594F] font-semibold' : 'text-[#6E5C50] font-medium'
                        }`}
                      >
                        {item.label}
                      </span>
                    </Link>
                  );
                }

                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    data-pressable="tab"
                    onClick={() => haptic('selection')}
                    aria-current={active ? 'page' : undefined}
                    className="group relative flex flex-col items-center justify-center gap-0.5 py-1 select-none"
                  >
                    <span className="relative w-12 h-7 rounded-full flex items-center justify-center">
                      {active && (
                        <motion.span
                          layoutId="bottom-tab-active-pill"
                          transition={{ type: 'spring', stiffness: 460, damping: 34 }}
                          className="absolute inset-0 rounded-full bg-[#4A8276]/13 border border-[#4A8276]/16 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]"
                        />
                      )}
                      <Icon
                        className={`relative z-10 w-[19.5px] h-[19.5px] transition-all duration-200 ${
                          active
                            ? 'text-[#2B5D52] scale-105'
                            : 'text-[#8F7E71] group-hover:text-[#4D3D34]'
                        }`}
                        strokeWidth={active ? 2.15 : 1.65}
                      />
                    </span>
                    <span
                      className={`text-[10px] tracking-tight transition-colors ${
                        active ? 'text-[#2B5D52] font-semibold' : 'text-[#8F7E71] font-medium'
                      }`}
                    >
                      {item.label}
                    </span>
                  </Link>
                );
              })}
            </div>
          </nav>
        </div>
      )}

      {/* Home Page Doll Collection Cabinet Slide-Over Drawer */}
      <DollCabinetDrawer open={cabinetOpen} onClose={() => setCabinetOpen(false)} />
    </div>
  );
}
