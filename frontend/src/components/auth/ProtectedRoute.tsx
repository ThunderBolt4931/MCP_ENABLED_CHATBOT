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
