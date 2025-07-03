const fs = require('fs').promises;
const path = require('path');
const supabase = require('../config/supabase');

class FileParser {
  static async parseFile(storagePath, mimeType, originalName) {
    try {
      console.log(`📄 Parsing file: ${originalName} (${mimeType})`);
      
      // Download file from Supabase Storage
      const { data: fileData, error } = await supabase.storage
        .from('attachments')
        .download(storagePath);
      
      if (error) {
        throw new Error(`Failed to download file: ${error.message}`);
      }
      
      // Convert blob to buffer
      const buffer = Buffer.from(await fileData.arrayBuffer());
      
      // Parse based on file type
      let content = '';
      
      if (mimeType.startsWith('text/')) {
        content = await this.parseTextFile(buffer);
      } else if (mimeType === 'application/pdf') {
        content = await this.parsePDF(buffer);
      } else if (mimeType.includes('word') || mimeType.includes('document')) {
        content = await this.parseWordDocument(buffer);
      } else if (mimeType.startsWith('image/')) {
        content = await this.parseImage(buffer, originalName);
      } else {
        content = `File "${originalName}" (${mimeType}) uploaded but content parsing not supported for this file type.`;
      }
      
      console.log(`✅ File parsed successfully: ${content.length} characters extracted`);
      return content;
      
    } catch (error) {
      console.error(`❌ Error parsing file ${originalName}:`, error);
      return `Error parsing file "${originalName}": ${error.message}`;
    }
  }
  
  static async parseTextFile(buffer) {
    return buffer.toString('utf-8');
  }
  
  static async parsePDF(buffer) {
    try {
      // For now, return a placeholder - in production you'd use a PDF parsing library
      return `PDF file content detected. File contains ${Math.floor(buffer.length / 1024)}KB of data. To fully parse PDF content, please ensure PDF parsing libraries are installed.`;
    } catch (error) {
      return `PDF parsing error: ${error.message}`;
    }
  }
  
  static async parseWordDocument(buffer) {
    try {
      // For now, return a placeholder - in production you'd use a Word document parsing library
      return `Word document detected. File contains ${Math.floor(buffer.length / 1024)}KB of data. To fully parse Word document content, please ensure document parsing libraries are installed.`;
    } catch (error) {
      return `Word document parsing error: ${error.message}`;
    }
  }
  
  static async parseImage(buffer, filename) {
    try {
      const sizeKB = Math.floor(buffer.length / 1024);
      return `Image file "${filename}" uploaded successfully. Image size: ${sizeKB}KB. The image is available for viewing and can be processed by vision-capable AI models.`;
    } catch (error) {
      return `Image parsing error: ${error.message}`;
    }
  }
  
  static async getFileMetadata(storagePath) {
    try {
      const { data, error } = await supabase.storage
        .from('attachments')
        .list(path.dirname(storagePath), {
          search: path.basename(storagePath)
        });
      
      if (error) throw error;
      
      const fileInfo = data.find(file => file.name === path.basename(storagePath));
      return fileInfo || null;
    } catch (error) {
      console.error('Error getting file metadata:', error);
      return null;
    }
  }
}

module.exports = FileParser;