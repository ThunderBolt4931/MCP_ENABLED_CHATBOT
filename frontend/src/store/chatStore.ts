import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  model?: string;
  tools_used?: string[];
  attachments?: Array<{
    id: string;
    filename: string;
    original_name: string;
    mime_type: string;
    file_size: number;
  }>;
}

interface Chat {
  chatId: string;
  title: string;
  updatedAt: string;
}

interface ChatState {
  messages: Message[];
  chats: Chat[];
  currentChatId: string | null;
  isLoading: boolean;
  selectedModel: string;
  enabledTools: string[];
  refreshTrigger: number;
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  setChats: (chats: Chat[]) => void;
  setCurrentChatId: (chatId: string | null) => void;
  setLoading: (loading: boolean) => void;
  setSelectedModel: (model: string) => void;
  setEnabledTools: (tools: string[]) => void;
  clearMessages: () => void;
  refreshChats: () => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      messages: [],
      chats: [],
      currentChatId: null,
      isLoading: false,
      selectedModel: 'gpt-4',
      enabledTools: [],
      refreshTrigger: 0,
      setMessages: (messages) => set({ messages }),
      addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
      setChats: (chats) => set({ chats }),
      setCurrentChatId: (currentChatId) => set({ currentChatId }),
      setLoading: (isLoading) => set({ isLoading }),
      setSelectedModel: (selectedModel) => set({ selectedModel }),
      setEnabledTools: (enabledTools) => set({ enabledTools }),
      clearMessages: () => set({ messages: [], currentChatId: null }),
      refreshChats: () => set((state) => ({ refreshTrigger: state.refreshTrigger + 1 })),
    }),
    {
      name: 'chat-storage',
      partialize: (state) => ({
        selectedModel: state.selectedModel,
        enabledTools: state.enabledTools,
      }),
    }
  )
);