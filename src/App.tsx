import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import Sidebar from './components/Sidebar';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import AdminPage from './pages/AdminPage';
import SingleTaskPage from './pages/SingleTaskPage';
import BatchManagementPage from './pages/BatchManagement';
import SettingsPage from './pages/Settings';
import DownloadManagementPage from './pages/DownloadManagement';
import AccountPoolPage from './pages/AccountPoolPage';
import GPTRegistrarPage from './pages/GPTRegistrarPage';
import EcommerceSuitePage from './pages/EcommerceSuitePage';
import GptImage2Page from './pages/GptImage2Page';
import type { User } from './types';
import { getCurrentUser, subscribeAuthUserUpdates } from './services/authService';

// 受保护的路由组件
function ProtectedRoute({
  children,
  requireAdmin = false,
  currentUser,
}: {
  children: React.ReactNode;
  requireAdmin?: boolean;
  currentUser: User | null;
}) {
  if (!currentUser) {
    return <Navigate to="/login" replace />;
  }

  if (requireAdmin && currentUser.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

// 主布局组件（带侧边栏）
function MainLayout({
  currentUser,
  onLogout,
  children,
}: {
  currentUser: User | null;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen w-full max-w-full bg-[#0f111a] overflow-hidden">
      <Sidebar currentUser={currentUser} onLogout={onLogout} />
      <main className="flex-1 min-w-0 relative h-full overflow-y-auto overflow-x-hidden overscroll-x-none custom-scrollbar pt-16 lg:pt-0">
        {children}
      </main>
    </div>
  );
}

function AppContent() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const handleAuthSuccess = (user: User) => {
    setCurrentUser(user);
  };

  // 加载当前用户
  useEffect(() => {
    const loadUser = async () => {
      try {
        const user = await getCurrentUser();
        setCurrentUser(user);
      } catch (error) {
        console.error('加载用户信息失败:', error);
      } finally {
        setLoading(false);
      }
    };
    loadUser();
  }, []);

  useEffect(() => subscribeAuthUserUpdates(setCurrentUser), []);

  const handleLogout = () => {
    setCurrentUser(null);
  };

  // 加载过程中显示加载状态
  if (loading) {
    return (
      <div className="min-h-screen bg-[#0f111a] flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin text-purple-500 mb-4">
            <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" strokeWidth={2} strokeLinecap="round" />
            </svg>
          </div>
          <p className="text-gray-400">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <AppProvider currentUser={currentUser}>
      <Routes>
        {/* 公开路由 */}
        <Route
          path="/login"
          element={
            currentUser ? (
              <Navigate to="/" replace />
            ) : (
              <LoginPage onLoginSuccess={handleAuthSuccess} />
            )
          }
        />
        <Route
          path="/register"
          element={
            currentUser ? (
              <Navigate to="/" replace />
            ) : (
              <RegisterPage onRegisterSuccess={handleAuthSuccess} />
            )
          }
        />

        {/* 受保护的路由 */}
        <Route
          path="/"
          element={
            <ProtectedRoute currentUser={currentUser}>
              <MainLayout currentUser={currentUser} onLogout={handleLogout}>
                <SingleTaskPage />
              </MainLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/batch"
          element={
            <ProtectedRoute currentUser={currentUser}>
              <MainLayout currentUser={currentUser} onLogout={handleLogout}>
                <BatchManagementPage />
              </MainLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/download"
          element={
            <ProtectedRoute currentUser={currentUser}>
              <MainLayout currentUser={currentUser} onLogout={handleLogout}>
                <DownloadManagementPage />
              </MainLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/accounts"
          element={
            <ProtectedRoute currentUser={currentUser}>
              <MainLayout currentUser={currentUser} onLogout={handleLogout}>
                <AccountPoolPage />
              </MainLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute currentUser={currentUser}>
              <MainLayout currentUser={currentUser} onLogout={handleLogout}>
                <SettingsPage />
              </MainLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/gpt-registrar"
          element={
            <ProtectedRoute currentUser={currentUser}>
              <MainLayout currentUser={currentUser} onLogout={handleLogout}>
                <GPTRegistrarPage />
              </MainLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/ecommerce"
          element={
            <ProtectedRoute currentUser={currentUser}>
              <MainLayout currentUser={currentUser} onLogout={handleLogout}>
                <EcommerceSuitePage />
              </MainLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/gpt-image-2"
          element={
            <ProtectedRoute currentUser={currentUser}>
              <MainLayout currentUser={currentUser} onLogout={handleLogout}>
                <GptImage2Page />
              </MainLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <ProtectedRoute requireAdmin currentUser={currentUser}>
              <MainLayout currentUser={currentUser} onLogout={handleLogout}>
                <AdminPage />
              </MainLayout>
            </ProtectedRoute>
          }
        />

        {/* 404 重定向 */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}
