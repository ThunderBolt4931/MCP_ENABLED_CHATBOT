// Updated App.tsx
import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useSearchParams } from 'react-router-dom';
import { LoginPage } from './components/auth/LoginPage';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { ChatLayout } from './components/chat/ChatLayout';
import { useAuthStore } from './store/authStore';
import { authAPI } from './services/api';

// Auth Callback Handler Component
const AuthCallbackHandler: React.FC = () => {
  const [searchParams] = useSearchParams();
  const { setUser, setToken } = useAuthStore();

  useEffect(() => {
    const handleAuthCallback = async () => {
      try {
        const token = searchParams.get('token');
        const error = searchParams.get('error');

        if (error) {
          console.error('Auth callback error:', error);
          window.location.href = '/login?error=' + error;
          return;
        }

        if (token) {
          // Store the token
          setToken(token);
          
          // Verify the token and get user info
          const response = await authAPI.checkAuth();
          
          if (response.data.authenticated && response.data.user) {
            setUser(response.data.user);
            window.location.href = '/chat';
          } else {
            window.location.href = '/login?error=auth_failed';
          }
        } else {
          window.location.href = '/login?error=no_token';
        }
      } catch (error) {
        console.error('Auth callback error:', error);
        window.location.href = '/login?error=auth_failed';
      }
    };

    handleAuthCallback();
  }, [searchParams, setUser, setToken]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto mb-4"></div>
        <p className="text-gray-600">Completing authentication...</p>
      </div>
    </div>
  );
};

function App() {
  const { isAuthenticated, isLoading, setLoading } = useAuthStore();

  useEffect(() => {
    // Check for auth errors in URL
    const urlParams = new URLSearchParams(window.location.search);
    const error = urlParams.get('error');
    
    if (error) {
      console.error('Auth error:', error);
      // Clear the error from URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    
    setLoading(false);
  }, [setLoading]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <Router>
      <Routes>
        {/* Public Routes */}
        <Route 
          path="/login" 
          element={
            isAuthenticated ? <Navigate to="/chat" replace /> : <LoginPage />
          } 
        />
        
        {/* Auth Callback Route */}
        <Route 
          path="/auth/callback" 
          element={<AuthCallbackHandler />} 
        />
        
        {/* Protected Routes */}
        <Route
          path="/chat"
          element={
            <ProtectedRoute>
              <ChatLayout />
            </ProtectedRoute>
          }
        />
        
        <Route
          path="/chat/:chatId"
          element={
            <ProtectedRoute>
              <ChatLayout />
            </ProtectedRoute>
          }
        />
        
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <ChatLayout />
            </ProtectedRoute>
          }
        />
        
        <Route
          path="/config"
          element={
            <ProtectedRoute>
              <div className="p-8">
                <h1 className="text-2xl font-bold">MCP Configuration</h1>
                <p>Configuration page coming soon...</p>
              </div>
            </ProtectedRoute>
          }
        />
        
        <Route
          path="/workflow"
          element={
            <ProtectedRoute>
              <div className="p-8">
                <h1 className="text-2xl font-bold">Workflow</h1>
                <p>Workflow page coming soon...</p>
              </div>
            </ProtectedRoute>
          }
        />

        {/* Default redirect */}
        <Route 
          path="/" 
          element={
            <Navigate to={isAuthenticated ? "/chat" : "/login"} replace />
          } 
        />
        
        {/* Catch all route */}
        <Route 
          path="*" 
          element={
            <Navigate to={isAuthenticated ? "/chat" : "/login"} replace />
          } 
        />
      </Routes>
    </Router>
  );
}

export default App;

// Updated ProtectedRoute.tsx
import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { authAPI } from '../../services/api';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { isAuthenticated, user, token, setUser, setLoading } = useAuthStore();
  const [isChecking, setIsChecking] = useState(true);
  const location = useLocation();

  useEffect(() => {
    const checkAuth = async () => {
      try {
        console.log('🔍 Checking authentication status...');
        setIsChecking(true);
        
        // If we have a token, try to verify it
        if (token) {
          console.log('🔑 Token found, verifying...');
          const response = await authAPI.checkAuth();
          console.log('Auth check response:', response.data);
          
          if (response.data.authenticated && response.data.user) {
            console.log('✅ User authenticated via token:', response.data.user.email);
            setUser(response.data.user);
          } else {
            console.log('❌ Token invalid, clearing auth state');
            setUser(null);
          }
        } else {
          console.log('❌ No token found');
          setUser(null);
        }
      } catch (error) {
        console.error('❌ Auth check failed:', error);
        setUser(null);
      } finally {
        setIsChecking(false);
        setLoading(false);
      }
    };

    // Always check auth status when component mounts
    checkAuth();
  }, [token, setUser, setLoading]);

  // Show loading spinner while checking authentication
  if (isChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto mb-4"></div>
          <p className="text-gray-600">Checking authentication...</p>
        </div>
      </div>
    );
  }

  // Redirect to login if not authenticated
  if (!isAuthenticated || !user) {
    console.log('🔄 Redirecting to login - not authenticated');
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Render the protected content
  console.log('✅ Rendering protected content for:', user.email);
  return <>{children}</>;
};

// Updated authStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface User {
  id: string;
  email: string;
  name: string;
  picture?: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  setUser: (user: User | null) => void;
  setToken: (token: string | null) => void;
  setLoading: (loading: boolean) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: true,
      setUser: (user) => set({ user, isAuthenticated: !!user }),
      setToken: (token) => set({ token }),
      setLoading: (isLoading) => set({ isLoading }),
      logout: () => set({ user: null, token: null, isAuthenticated: false }),
    }),
    {
      name: 'auth-storage',
    }
  )
);

// Updated api.ts
import axios from 'axios';
import { useAuthStore } from '../store/authStore';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add request interceptor to include JWT token
api.interceptors.request.use(
  (config) => {
    const token = useAuthStore.getState().token;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Add response interceptor to handle auth errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Clear auth state on 401 errors
      useAuthStore.getState().logout();
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Auth API
export const authAPI = {
  checkAuth: () => api.get('/auth/user'),
  logout: () => api.post('/auth/logout'),
  googleLogin: () => {
    window.location.href = `${API_BASE_URL}/auth/google`;
  },
  updatePreferences: (preferences: any) => api.put('/api/user/preferences', preferences),
  getPreferences: () => api.get('/api/user/preferences'),
};

// Chat API
export const chatAPI = {
  sendMessage: (message: string, chatId?: string, model?: string, enabledTools?: string[]) =>
    api.post('/api/chat', { message, chatId, model, enabledTools }),
  sendMessageWithAttachments: (formData: FormData) => {
    return api.post('/api/chat', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  },
  getChat: (chatId: string) => api.get(`/api/chat/${chatId}`),
  getUserChats: (userId: string) => api.get(`/api/chats/${userId}`),
  deleteChat: (chatId: string) => api.delete(`/api/chat/${chatId}`),
};

// Tools API
export const toolsAPI = {
  getAvailableTools: () => api.get('/api/tools'),
  updateToolPreferences: (enabledTools: string[]) => 
    api.put('/api/tools/preferences', { enabledTools }),
};

// Health API
export const healthAPI = {
  getStatus: () => api.get('/api/health'),
};

// Attachments API
export const attachmentsAPI = {
  download: (attachmentId: string) => api.get(`/api/attachments/${attachmentId}/download`, {
    responseType: 'blob'
  }),
};

export default api;
