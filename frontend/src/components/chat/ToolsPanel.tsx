import React, { useEffect, useState } from 'react';
import { X, Settings, Wrench } from 'lucide-react';
import { Button } from '../ui/Button';
import { useChatStore } from '../../store/chatStore';
import { toolsAPI } from '../../services/api';

interface Tool {
  name: string;
  description: string;
  category: string;
  enabled: boolean;
}

interface ToolsPanelProps {
  onClose: () => void;
}

export const ToolsPanel: React.FC<ToolsPanelProps> = ({ onClose }) => {
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const { enabledTools, setEnabledTools } = useChatStore();

  useEffect(() => {
    loadTools();
  }, []);

  const loadTools = async () => {
    try {
      setLoading(true);
      const response = await toolsAPI.getAvailableTools();
      const toolsData = response.data.tools.map((tool: any) => ({
        name: tool.function.name,
        description: tool.function.description,
        category: getToolCategory(tool.function.name),
        enabled: enabledTools.includes(tool.function.name)
      }));
      setTools(toolsData);
    } catch (error) {
      console.error('Failed to load tools:', error);
    } finally {
      setLoading(false);
    }
  };

  const getToolCategory = (toolName: string): string => {
    if (toolName.startsWith('drive_')) return 'Google Drive';
    if (toolName.startsWith('gmail_')) return 'Gmail';
    if (toolName.startsWith('calendar_')) return 'Calendar';
    return 'Other';
  };

  const toggleTool = (toolName: string) => {
    const newEnabledTools = enabledTools.includes(toolName)
      ? enabledTools.filter(name => name !== toolName)
      : [...enabledTools, toolName];
    
    setEnabledTools(newEnabledTools);
    setTools(prev => prev.map(tool => 
      tool.name === toolName ? { ...tool, enabled: !tool.enabled } : tool
    ));
  };

  const toggleAllInCategory = (category: string, enable: boolean) => {
    const categoryTools = tools.filter(tool => tool.category === category);
    const categoryToolNames = categoryTools.map(tool => tool.name);
    
    let newEnabledTools;
    if (enable) {
      newEnabledTools = [...new Set([...enabledTools, ...categoryToolNames])];
    } else {
      newEnabledTools = enabledTools.filter(name => !categoryToolNames.includes(name));
    }
    
    setEnabledTools(newEnabledTools);
    setTools(prev => prev.map(tool => 
      tool.category === category ? { ...tool, enabled: enable } : tool
    ));
  };

  const groupedTools = tools.reduce((acc, tool) => {
    if (!acc[tool.category]) {
      acc[tool.category] = [];
    }
    acc[tool.category].push(tool);
    return acc;
  }, {} as Record<string, Tool[]>);

  return (
    <div className="w-80 bg-white border-l border-gray-200 flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Wrench className="w-5 h-5 text-gray-600" />
          <h2 className="text-lg font-semibold text-gray-900">Tools</h2>
        </div>
        <Button variant="ghost" size="sm" icon={X} onClick={onClose} />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(groupedTools).map(([category, categoryTools]) => {
              const allEnabled = categoryTools.every(tool => tool.enabled);
              const someEnabled = categoryTools.some(tool => tool.enabled);
              
              return (
                <div key={category} className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-900">{category}</h3>
                    <div className="flex space-x-1">
                      <button
                        onClick={() => toggleAllInCategory(category, true)}
                        className="text-xs text-blue-600 hover:text-blue-800"
                        disabled={allEnabled}
                      >
                        All
                      </button>
                      <span className="text-xs text-gray-400">|</span>
                      <button
                        onClick={() => toggleAllInCategory(category, false)}
                        className="text-xs text-gray-600 hover:text-gray-800"
                        disabled={!someEnabled}
                      >
                        None
                      </button>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    {categoryTools.map((tool) => (
                      <div
                        key={tool.name}
                        className="flex items-start space-x-3 p-3 rounded-lg border border-gray-200 hover:border-gray-300 transition-colors"
                      >
                        <div className="flex-shrink-0 mt-0.5">
                          <input
                            type="checkbox"
                            checked={tool.enabled}
                            onChange={() => toggleTool(tool.name)}
                            className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="text-sm font-medium text-gray-900">
                            {tool.name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                          </h4>
                          <p className="text-xs text-gray-600 mt-1 line-clamp-2">
                            {tool.description}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-gray-200">
        <div className="text-xs text-gray-500 text-center">
          {enabledTools.length} of {tools.length} tools enabled
        </div>
      </div>
    </div>
  );
};