import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000, // 30 second timeout
});

// Add response interceptor to handle common errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('API Error:', {
      url: error.config?.url,
      method: error.config?.method,
      status: error.response?.status,
      data: error.response?.data,
      message: error.message
    });
    
    // Handle authentication errors
    if (error.response?.status === 401) {
      // Clear auth state and redirect to login
      localStorage.removeItem('auth-storage');
      window.location.href = '/login';
    }
    
    return Promise.reject(error);
  }
);

// Auth API with better error handling
export const authAPI = {
  checkAuth: () => api.get('/auth/user'),
  
  login: async (credentials: { email: string; password: string }) => {
    try {
      const response = await api.post('/auth/login', credentials);
      return response;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Login failed');
    }
  },
  
  logout: async () => {
    try {
      await api.post('/auth/logout');
      localStorage.removeItem('auth-storage');
    } catch (error) {
      console.error('Logout error:', error);
      // Clear local storage even if logout fails
      localStorage.removeItem('auth-storage');
    }
  },
  
  googleLogin: () => {
    // Store current location for redirect after auth
    localStorage.setItem('redirect_after_auth', window.location.pathname);
    window.location.href = `${API_BASE_URL}/auth/google`;
  },
  
  updatePreferences: (preferences: any) => api.put('/api/user/preferences', preferences),
  getPreferences: () => api.get('/api/user/preferences'),
};

// Chat API with improved error handling
export const chatAPI = {
  sendMessage: async (message: string, chatId?: string, model?: string, enabledTools?: string[]) => {
    try {
      const response = await api.post('/api/chat', { 
        message, 
        chatId, 
        model, 
        enabledTools: JSON.stringify(enabledTools || [])
      });
      return response;
    } catch (error: any) {
      console.error('Chat API Error:', error);
      throw new Error(error.response?.data?.error || 'Failed to send message');
    }
  },
  
  sendMessageWithAttachments: async (formData: FormData) => {
    try {
      const response = await api.post('/api/chat', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        timeout: 60000, // 60 seconds for file uploads
      });
      return response;
    } catch (error: any) {
      console.error('File upload error:', error);
      throw new Error(error.response?.data?.error || 'Failed to upload files');
    }
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
