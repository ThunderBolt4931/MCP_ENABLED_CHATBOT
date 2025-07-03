import React, { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { 
  MessageSquare, 
  Plus, 
  Settings, 
  Workflow, 
  FolderOpen,
  User,
  LogOut,
  Trash2,
  MoreHorizontal
} from 'lucide-react';
import { Button } from '../ui/Button';
import { useAuthStore } from '../../store/authStore';
import { useChatStore } from '../../store/chatStore';
import { authAPI, chatAPI } from '../../services/api';

interface Chat {
  id: string;
  title: string;
  updated_at: string;
}

export const Sidebar: React.FC = () => {
  const location = useLocation();
  const { chatId } = useParams();
  const { user, logout } = useAuthStore();
  const { clearMessages, refreshTrigger } = useChatStore();
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      loadChats();
    }
  }, [user, refreshTrigger]);

  const loadChats = async () => {
    try {
      setLoading(true);
      const response = await chatAPI.getUserChats(user!.id);
      setChats(response.data.chats || []);
    } catch (error) {
      console.error('Failed to load chats:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await authAPI.logout();
      logout();
      clearMessages();
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const handleNewChat = () => {
    clearMessages();
  };

  const handleDeleteChat = async (chatIdToDelete: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (confirm('Are you sure you want to delete this chat?')) {
      try {
        await chatAPI.deleteChat(chatIdToDelete);
        setChats(prev => prev.filter(chat => chat.id !== chatIdToDelete));
        
        // If we're currently viewing the deleted chat, redirect to new chat
        if (chatId === chatIdToDelete) {
          window.location.href = '/chat';
        }
      } catch (error) {
        console.error('Failed to delete chat:', error);
      }
    }
  };

  const formatChatTitle = (title: string) => {
    return title.length > 30 ? title.substring(0, 30) + '...' : title;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 1) return 'Today';
    if (diffDays === 2) return 'Yesterday';
    if (diffDays <= 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  };

  const menuItems = [
    { icon: MessageSquare, label: 'New Chat', path: '/chat', action: handleNewChat },
    { icon: Settings, label: 'MCP Configuration', path: '/config' },
    { icon: Workflow, label: 'Workflow', path: '/workflow', badge: 'Beta' },
  ];

  return (
    <div className="w-64 bg-gray-50 border-r border-gray-200 flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center mb-4">
          <div className="w-8 h-8 bg-gray-900 rounded-lg flex items-center justify-center mr-3">
            <div className="w-4 h-4 bg-white rounded-sm"></div>
          </div>
          <span className="text-lg font-semibold text-gray-900">mcp/chat-bot</span>
        </div>
        
        <Button
          onClick={handleNewChat}
          className="w-full"
          icon={Plus}
          variant="outline"
        >
          New Chat
        </Button>
      </div>

      {/* Navigation */}
      <div className="flex-1 p-4 overflow-y-auto">
        <nav className="space-y-2 mb-6">
          {menuItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              onClick={item.action}
              className={`
                flex items-center px-3 py-2 rounded-lg text-sm font-medium transition-colors
                ${location.pathname === item.path
                  ? 'bg-gray-200 text-gray-900'
                  : 'text-gray-700 hover:bg-gray-100'
                }
              `}
            >
              <item.icon className="w-4 h-4 mr-3" />
              {item.label}
              {item.badge && (
                <span className="ml-auto bg-gray-900 text-white text-xs px-2 py-0.5 rounded-full">
                  {item.badge}
                </span>
              )}
            </Link>
          ))}
        </nav>

        {/* Projects Section */}
        <div className="mb-6">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Projects
          </h3>
          <div className="flex items-center px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg cursor-pointer transition-colors">
            <FolderOpen className="w-4 h-4 mr-3" />
            <div>
              <div className="font-medium">Create a project</div>
              <div className="text-xs text-gray-500">To organize your ideas</div>
            </div>
          </div>
        </div>

        {/* Recent Chats */}
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Recent Chats
          </h3>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-400"></div>
            </div>
          ) : chats.length > 0 ? (
            <div className="space-y-1">
              {chats.slice(0, 10).map((chat) => (
                <div
                  key={chat.id}
                  className={`group relative flex items-center px-3 py-2 rounded-lg transition-colors ${
                    chatId === chat.id 
                      ? 'bg-gray-200 text-gray-900' 
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <Link
                    to={`/chat/${chat.id}`}
                    className="flex-1 min-w-0 block"
                  >
                    <div className="text-sm font-medium truncate">
                      {formatChatTitle(chat.title)}
                    </div>
                    <div className="text-xs text-gray-500">
                      {formatDate(chat.updated_at)}
                    </div>
                  </Link>
                  
                  <button
                    onClick={(e) => handleDeleteChat(chat.id, e)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-600 transition-all"
                    title="Delete chat"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
              
              {chats.length > 10 && (
                <div className="text-xs text-gray-500 px-3 py-2">
                  And {chats.length - 10} more chats...
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-500 px-3">No conversations yet</p>
          )}
        </div>
      </div>

      {/* User Profile */}
      <div className="p-4 border-t border-gray-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center min-w-0">
            {user?.picture ? (
              <img
                src={user.picture}
                alt={user.name}
                className="w-8 h-8 rounded-full mr-3"
              />
            ) : (
              <div className="w-8 h-8 bg-gray-300 rounded-full flex items-center justify-center mr-3">
                <User className="w-4 h-4 text-gray-600" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-900 truncate">
                {user?.name || 'User'}
              </p>
              <p className="text-xs text-gray-500 truncate">
                {user?.email}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            icon={LogOut}
            className="ml-2"
          />
        </div>
      </div>
    </div>
  );
};