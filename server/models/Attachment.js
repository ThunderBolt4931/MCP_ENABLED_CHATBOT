const supabase = require('../config/supabase');

class Attachment {
  static async create({ messageId, userId, filename, originalName, mimeType, fileSize, storagePath }) {
    const { data, error } = await supabase
      .from('attachments')
      .insert([{
        message_id: messageId,
        user_id: userId,
        filename,
        original_name: originalName,
        mime_type: mimeType,
        file_size: fileSize,
        storage_path: storagePath,
        created_at: new Date().toISOString()
      }])
      .select()
      .single();
    
    if (error) {
      throw error;
    }
    
    return data;
  }

  static async findById(id) {
    const { data, error } = await supabase
      .from('attachments')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error && error.code !== 'PGRST116') {
      throw error;
    }
    
    return data;
  }

  static async findByMessageId(messageId) {
    const { data, error } = await supabase
      .from('attachments')
      .select('*')
      .eq('message_id', messageId);
    
    if (error) {
      throw error;
    }
    
    return data || [];
  }

  static async delete(id) {
    const { error } = await supabase
      .from('attachments')
      .delete()
      .eq('id', id);
    
    if (error) {
      throw error;
    }
  }

  static async getSignedUrl(storagePath) {
    const { data, error } = await supabase.storage
      .from('attachments')
      .createSignedUrl(storagePath, 3600); // 1 hour expiry
    
    if (error) {
      throw error;
    }
    
    return data.signedUrl;
  }
}

module.exports = Attachment;