const supabase = require('../config/supabase');

class AuthToken {
  static async create({ userId, accessToken, refreshToken, idToken, expiresAt }) {
    const { data, error } = await supabase
      .from('auth_tokens')
      .insert([{
        user_id: userId,
        access_token: accessToken,
        refresh_token: refreshToken,
        id_token: idToken,
        expires_at: expiresAt,
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

  static async findByUserId(userId) {
    const { data, error } = await supabase
      .from('auth_tokens')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    
    if (error && error.code !== 'PGRST116') {
      throw error;
    }
    
    return data;
  }

  static async update(userId, updates) {
    const { data, error } = await supabase
      .from('auth_tokens')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId)
      .select()
      .single();
    
    if (error) {
      throw error;
    }
    
    return data;
  }

  static async delete(userId) {
    const { error } = await supabase
      .from('auth_tokens')
      .delete()
      .eq('user_id', userId);
    
    if (error) {
      throw error;
    }
  }

  static async createTemporaryTokenFile(userId) {
    // Get the latest token for the user
    const tokenData = await this.findByUserId(userId);
    
    if (!tokenData) {
      throw new Error('No authentication tokens found for user');
    }
    
    // Return token data that can be used by mcp_toolkit.py
    // This will be passed as environment variables instead of a file
    return {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      id_token: tokenData.id_token,
      expires_at: tokenData.expires_at
    };
  }
}

module.exports = AuthToken;