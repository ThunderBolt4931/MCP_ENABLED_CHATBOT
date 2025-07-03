const supabase = require('../config/supabase');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

class FileUploadService {
  static async uploadFile(file, userId) {
    try {
      // Generate unique filename
      const fileExtension = path.extname(file.originalname);
      const uniqueFilename = `${userId}/${uuidv4()}${fileExtension}`;
      
      // Upload to Supabase Storage
      const { data, error } = await supabase.storage
        .from('attachments')
        .upload(uniqueFilename, file.buffer, {
          contentType: file.mimetype,
          upsert: false
        });
      
      if (error) {
        throw error;
      }
      
      // Generate a proper filename for database storage
      const dbFilename = `${uuidv4()}_${file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
      
      return {
        storagePath: data.path,
        filename: dbFilename, // This is the key fix - ensure filename is never null
        originalName: file.originalname,
        mimeType: file.mimetype,
        fileSize: file.size
      };
    } catch (error) {
      console.error('File upload error:', error);
      throw new Error(`Failed to upload file: ${error.message}`);
    }
  }

  static async getFileUrl(storagePath) {
    try {
      const { data, error } = await supabase.storage
        .from('attachments')
        .createSignedUrl(storagePath, 3600); // 1 hour expiry
      
      if (error) {
        throw error;
      }
      
      return data.signedUrl;
    } catch (error) {
      console.error('Get file URL error:', error);
      throw new Error(`Failed to get file URL: ${error.message}`);
    }
  }

  static async downloadFile(storagePath) {
    try {
      const { data, error } = await supabase.storage
        .from('attachments')
        .download(storagePath);
      
      if (error) {
        throw error;
      }
      
      return data;
    } catch (error) {
      console.error('File download error:', error);
      throw new Error(`Failed to download file: ${error.message}`);
    }
  }

  static async deleteFile(storagePath) {
    try {
      const { error } = await supabase.storage
        .from('attachments')
        .remove([storagePath]);
      
      if (error) {
        throw error;
      }
      
      return true;
    } catch (error) {
      console.error('File deletion error:', error);
      throw new Error(`Failed to delete file: ${error.message}`);
    }
  }
}

module.exports = FileUploadService;