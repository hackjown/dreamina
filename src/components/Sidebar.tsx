import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  FilmIcon,
  PackageIcon,
  DownloadIcon,
  SettingsIcon,
  ImageIcon,
  MenuIcon,
  CloseIcon,
  UserIcon,
  UsersIcon,
  ShieldIcon,
  LogoutIcon,
  SparkleIcon,
} from '../components/Icons';
import type { User } from '../types';
import { logout } from '../services/authService';

interface SidebarProps {
  currentUser: User | null;
  onLogout: () => void;
}

interface MenuItem {
  id: string;
  label: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
  accent?: string;
}

export default function Sidebar({ currentUser, onLogout }: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);

  const isActive = (path: string) => {
    if (path === '/') {
      return location.pathname === '/';
    }
    return location.pathname.startsWith(path);
  };

  const menuItems: MenuItem[] = [
    {
      id: 'SINGLE_TASK',
      label: '单任务生成',
      path: '/',
      icon: FilmIcon,
    },
    {
      id: 'BATCH_MANAGEMENT',
      label: '批量管理',
      path: '/batch',
      icon: PackageIcon,
    },
    {
      id: 'DOWNLOAD_MANAGEMENT',
      label: '下载管理',
      path: '/download',
      icon: DownloadIcon,
    },
    {
      id: 'ACCOUNT_POOL',
      label: '账号池管理',
      path: '/accounts',
      icon: UsersIcon,
    },
    {
      id: 'ECOMMERCE_SUITE',
      label: '电商物料',
      path: '/ecommerce',
      icon: PackageIcon,
      accent: 'text-emerald-400',
    },
    {
      id: 'GPT_IMAGE_2',
      label: 'GPT Image 2',
      path: '/gpt-image-2',
      icon: ImageIcon,
      accent: 'text-fuchsia-400',
    },
    {
      id: 'GPT_REGISTRAR',
      label: 'GPT 注册机',
      path: '/gpt-registrar',
      icon: SparkleIcon,
      accent: 'text-indigo-400',
    },
    {
      id: 'SETTINGS',
      label: '系统设置',
      path: '/settings',
      icon: SettingsIcon,
    },
    {
      id: 'ADMIN',
      label: '管理后台',
      path: '/admin',
      icon: ShieldIcon,
      adminOnly: true,
      accent: 'text-amber-500',
    },
  ];

  const handleLogout = async () => {
    await logout();
    onLogout();
    navigate('/login');
  };

  const visibleItems = menuItems.filter(
    (item) => !item.adminOnly || currentUser?.role === 'admin'
  );

  return (
    <>
      {/* Mobile Toggle */}
      <div className="lg:hidden fixed left-4 z-50 top-[calc(env(safe-area-inset-top)+1rem)]">
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="p-2 bg-[#1c1f2e] text-white rounded-lg border border-gray-800 shadow-xl"
        >
          {mobileOpen ? (
            <CloseIcon className="w-6 h-6" />
          ) : (
            <MenuIcon className="w-6 h-6" />
          )}
        </button>
      </div>

      {/* Sidebar Overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`z-40 bg-[#0f111a] border-r border-gray-800 transition-all duration-300 h-full flex-shrink-0 ${
          expanded ? 'w-64' : 'w-20'
        } ${
          mobileOpen
            ? 'fixed inset-y-0 left-0 translate-x-0'
            : 'relative hidden lg:block -translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="h-full flex flex-col">
          {/* Logo Section */}
          <div className="p-6 border-b border-gray-800 flex items-center justify-between">
            <Link to="/" className="flex items-center gap-3 overflow-hidden">
              <div className="min-w-[32px] w-8 h-8 rounded-lg bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-purple-900/40">
                <FilmIcon className="w-5 h-5 text-white" />
              </div>
              {expanded && (
                <span className="text-xl font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent whitespace-nowrap">
                  Seedance 2.0
                </span>
              )}
            </Link>
          </div>

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto py-6 px-4 space-y-2 custom-scrollbar">
            {visibleItems.map((item) => (
              <Link
                key={item.id}
                to={item.path}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-3 p-3 rounded-xl transition-all duration-200 group relative ${
                  isActive(item.path)
                    ? 'bg-purple-600/10 text-white border border-purple-500/20'
                    : 'text-gray-400 hover:bg-gray-800/50 hover:text-white'
                }`}
              >
                <item.icon
                  className={`w-5 h-5 transition-transform group-hover:scale-110 ${
                    isActive(item.path) ? (item.accent || 'text-purple-400') : ''
                  }`}
                />
                {expanded && (
                  <span className="font-medium text-sm whitespace-nowrap">
                    {item.label}
                  </span>
                )}
                {!expanded && (
                  <div className="absolute left-full ml-4 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50 shadow-xl border border-gray-800">
                    {item.label}
                  </div>
                )}
              </Link>
            ))}
          </nav>

          {/* Bottom Section */}
          <div className="p-4 border-t border-gray-800 space-y-2">
            <button
              onClick={() => setExpanded(!expanded)}
              className="w-full flex items-center gap-3 p-3 text-gray-400 hover:bg-gray-800/50 hover:text-white rounded-xl transition-all group"
            >
              <div className={`w-5 h-5 transition-transform duration-300 ${!expanded ? 'rotate-180' : ''}`}>
                <MenuIcon className="w-5 h-5" />
              </div>
              {expanded && <span className="text-sm font-medium">收起侧边栏</span>}
            </button>

            <div className="pt-2">
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 p-3 text-red-400 hover:bg-red-400/10 rounded-xl transition-all group"
              >
                <LogoutIcon className="w-5 h-5 transition-transform group-hover:scale-110" />
                {expanded && <span className="text-sm font-medium">退出登录</span>}
              </button>
            </div>

            {/* Profile Bar */}
            {expanded && currentUser && (
              <div className="mt-4 p-3 rounded-xl bg-gray-800/30 border border-gray-700 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-purple-500 to-indigo-500 flex items-center justify-center text-xs font-bold text-white shadow-inner">
                  <UserIcon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-white truncate">
                    {currentUser.username || '未登录'}
                  </p>
                  <p className="text-[10px] text-emerald-400 font-mono">
                    {currentUser.credits} Credits
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
