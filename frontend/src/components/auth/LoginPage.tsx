import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Mail, Lock, Github } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { authAPI } from '../../services/api';
import { useAuthStore } from '../../store/authStore';

export const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchParams] = useSearchParams();
  
  const navigate = useNavigate();
  const { setUser } = useAuthStore();

  useEffect(() => {
    // Check for error in URL params
    const urlError = searchParams.get('error');
    if (urlError) {
      switch (urlError) {
        case 'no_code':
          setError('Authorization failed. Please try again.');
          break;
        case 'auth_failed':
          setError('Authentication failed. Please try again.');
          break;
        case 'no_token':
          setError('Authentication token missing. Please try again.');
          break;
        default:
          setError('Login failed. Please try again.');
      }
    }
  }, [searchParams]);

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    
    try {
      // Replace this with your actual email/password login API call
      const response = await authAPI.login({ email, password });
      
      if (response.data.user) {
        setUser(response.data.user);
        navigate('/chat'); // Navigate to chat after successful login
      }
    } catch (error: any) {
      console.error('Login failed:', error);
      setError(error.message || 'Login failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    try {
      setIsLoading(true);
      setError('');
      
      // Redirect to Google OAuth
      authAPI.googleLogin();
      
    } catch (error: any) {
      console.error('Google login failed:', error);
      setError('Google login failed. Please try again.');
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left side - Welcome message and abstract design */}
      <div className="flex-1 bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-12 relative overflow-hidden">
        <div className="max-w-md z-10">
          <div className="flex items-center mb-8">
            <div className="w-8 h-8 bg-gray-900 rounded-lg flex items-center justify-center mr-3">
              <div className="w-4 h-4 bg-white rounded-sm"></div>
            </div>
            <span className="text-xl font-semibold text-gray-900">Chat Bot</span>
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-6">
            Welcome to MCP Chat Bot
          </h1>
          <p className="text-lg text-gray-600 leading-relaxed">
            Sign in to experience our AI-powered conversational tools with seamless Google Workspace integration.
          </p>
        </div>
        
        {/* Abstract lines */}
        <div className="absolute inset-0 overflow-hidden">
          <svg className="absolute -top-40 -right-40 w-96 h-96 text-gray-200" viewBox="0 0 400 400" fill="none">
            <path d="M50 200 Q 200 50 350 200 Q 200 350 50 200" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.3"/>
            <path d="M80 200 Q 200 80 320 200 Q 200 320 80 200" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.4"/>
            <path d="M110 200 Q 200 110 290 200 Q 200 290 110 200" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.5"/>
          </svg>
          <svg className="absolute -bottom-40 -left-40 w-96 h-96 text-gray-200" viewBox="0 0 400 400" fill="none">
            <path d="M50 50 L 350 350" stroke="currentColor" strokeWidth="1" opacity="0.2"/>
            <path d="M80 50 L 350 320" stroke="currentColor" strokeWidth="1" opacity="0.3"/>
            <path d="M110 50 L 350 290" stroke="currentColor" strokeWidth="1" opacity="0.4"/>
            <path d="M50 80 L 320 350" stroke="currentColor" strokeWidth="1" opacity="0.3"/>
            <path d="M50 110 L 290 350" stroke="currentColor" strokeWidth="1" opacity="0.4"/>
          </svg>
        </div>
      </div>

      {/* Right side - Login form */}
      <div className="flex-1 flex items-center justify-center p-12 bg-white">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold text-gray-900 mb-2">Welcome Back</h2>
            <p className="text-gray-600">Sign in to continue to your account</p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          <form onSubmit={handleEmailLogin} className="space-y-6">
            <Input
              label="Email"
              type="email"
              placeholder="user@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              icon={<Mail className="w-5 h-5 text-gray-400" />}
              required
            />

            <Input
              label="Password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              icon={<Lock className="w-5 h-5 text-gray-400" />}
              required
            />

            <Button
              type="submit"
              className="w-full"
              loading={isLoading}
              size="lg"
            >
              Sign in
            </Button>
          </form>

          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-gray-500">OR CONTINUE WITH</span>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3">
              <Button
                variant="outline"
                onClick={handleGoogleLogin}
                className="w-full"
                size="lg"
                loading={isLoading}
              >
                <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Google
              </Button>

              <Button
                variant="outline"
                className="w-full"
                size="lg"
                icon={Github}
                disabled={isLoading}
              >
                GitHub
              </Button>
            </div>
          </div>

          <p className="mt-8 text-center text-sm text-gray-600">
            Don't have an account?{' '}
            <Link to="/signup" className="font-medium text-gray-900 hover:text-gray-700 transition-colors">
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};
