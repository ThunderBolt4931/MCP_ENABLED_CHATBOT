const supabase = require('../config/supabase');

class Chat {
    static async create(userId, title) {
        const { data, error } = await supabase
            .from('chats')
            .insert([{
                user_id: userId,
                title,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }])
            .select()
            .single();
        
        if (error) {
            throw error;
        }
        
        return data;
    }

    static async findById(chatId) {
        const { data, error } = await supabase
            .from('chats')
            .select('*')
            .eq('id', chatId)
            .single();
        
        if (error && error.code !== 'PGRST116') {
            throw error;
        }
        
        return data;
    }

    static async findByUserId(userId) {
        const { data, error } = await supabase
            .from('chats')
            .select('*')
            .eq('user_id', userId)
            .order('updated_at', { ascending: false });
        
        if (error) {
            throw error;
        }
        
        return data || [];
    }

    static async update(chatId, updates) {
        const { data, error } = await supabase
            .from('chats')
            .update({
                ...updates,
                updated_at: new Date().toISOString()
            })
            .eq('id', chatId)
            .select()
            .single();
        
        if (error) {
            throw error;
        }
        
        return data;
    }

    static async delete(chatId) {
        const { data, error } = await supabase
            .from('chats')
            .delete()
            .eq('id', chatId)
            .select()
            .single();
        
        if (error) {
            throw error;
        }
        
        return data;
    }

    static async getWithMessages(chatId, userId) {
        // First get the chat
        const { data: chat, error: chatError } = await supabase
            .from('chats')
            .select('*')
            .eq('id', chatId)
            .eq('user_id', userId)
            .single();
        
        if (chatError) {
            if (chatError.code === 'PGRST116') {
                return null;
            }
            throw chatError;
        }
        
        // Get messages for this chat with attachments
        const { data: messages, error: messagesError } = await supabase
            .from('messages')
            .select(`
                *,
                attachments (
                    id,
                    filename,
                    original_name,
                    mime_type,
                    file_size,
                    storage_path
                )
            `)
            .eq('chat_id', chatId)
            .order('created_at', { ascending: true });
        
        if (messagesError) {
            throw messagesError;
        }
        
        return {
            ...chat,
            messages: messages || []
        };
    }
}

module.exports = Chat;