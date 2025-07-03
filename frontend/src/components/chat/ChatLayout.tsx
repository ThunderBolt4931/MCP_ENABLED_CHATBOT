import React from 'react';
import { Sidebar } from './Sidebar';
import { ChatInterface } from './ChatInterface';

export const ChatLayout: React.FC = () => {
  return (
    <div className="h-screen flex bg-gray-50">
      <Sidebar />
      <ChatInterface />
    </div>
  );
};