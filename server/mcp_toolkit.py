import json
import os
import sys
import base64
import io
import re
import mimetypes # <--- ADDED
from typing import Any, Dict, List, Optional
from datetime import datetime, timedelta
from html import unescape
from googleapiclient.errors import HttpError
# Email handling imports
from email.mime.multipart import MIMEMultipart # <--- ADDED
from email.mime.text import MIMEText
from email.mime.base import MIMEBase # <--- ADDED
from email import encoders # <--- ADDED

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from googleapiclient.http import MediaIoBaseDownload, MediaIoBaseUpload, MediaFileUpload # <--- MODIFIED

# PDF text extraction and creation
try:
    import PyPDF2
    from reportlab.pdfgen import canvas
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import SimpleDocTemplate, Paragraph
    from reportlab.lib.units import inch
    PDF_SUPPORT = True
except ImportError:
    PDF_SUPPORT = False

from mcp.server.fastmcp import FastMCP

# Combined OAuth scopes for both Drive and Gmail
SCOPES = [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.labels',
    'https://www.googleapis.com/auth/gmail.modify',
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.readonly",
    'https://www.googleapis.com/auth/documents'
]

# Global service instances
drive_service = None
gmail_service = None
calendar_service = None

# Create FastMCP instance
mcp = FastMCP("Google Drive & Gmail MCP Server")

CREDENTIALS_PATH = os.getenv('SESSION_TOKEN_PATH', 'token.json')  # Written by server.js

def load_credentials():
    """Load and refresh credentials using token.json and env client secrets."""
    if not os.path.exists(CREDENTIALS_PATH):
        print("token.json not found. Please sign in via the web interface.")
        return None

    try:
        with open(CREDENTIALS_PATH, 'r') as token_file:
            token_data = json.load(token_file)

        client_id = os.getenv("GOOGLE_CLIENT_ID")
        client_secret = os.getenv("GOOGLE_CLIENT_SECRET")

        if not client_id or not client_secret:
            print("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in environment.")
            return None

        creds = Credentials(
            token=token_data.get("access_token"),
            refresh_token=token_data.get("refresh_token"),
            token_uri="https://oauth2.googleapis.com/token",
            client_id=client_id,
            client_secret=client_secret,
            scopes=SCOPES
        )

        if creds and creds.expired and creds.refresh_token:
            print("🔁 Refreshing access token...")
            creds.refresh(Request())
            # Save updated token
            with open(CREDENTIALS_PATH, 'w') as token_file:
                token_file.write(creds.to_json())

        print("Google credentials loaded successfully")
        return creds

    except Exception as e:
        print(f"Error loading credentials: {e}")
        return None

# ==================== GOOGLE DRIVE FUNCTIONS ====================

def get_export_mime_type(google_mime_type: str) -> str:
    """Get the export MIME type for Google Workspace files."""
    mime_type_map = {
        'application/vnd.google-apps.document': 'text/markdown',
        'application/vnd.google-apps.spreadsheet': 'text/csv',
        'application/vnd.google-apps.presentation': 'text/plain',
        'application/vnd.google-apps.drawing': 'image/png',
    }
    return mime_type_map.get(google_mime_type, 'text/plain')

def extract_pdf_text(file_io: io.BytesIO) -> str:
    """Extract text content from PDF file."""
    if not PDF_SUPPORT:
        return "PDF text extraction not available. Please install PyPDF2: pip install PyPDF2"
    
    try:
        file_io.seek(0)  # Reset file pointer
        pdf_reader = PyPDF2.PdfReader(file_io)
        text_content = []
        
        for page_num, page in enumerate(pdf_reader.pages, 1):
            try:
                page_text = page.extract_text()
                if page_text.strip():
                    text_content.append(f"--- Page {page_num} ---\n{page_text}")
            except Exception as e:
                text_content.append(f"--- Page {page_num} ---\n[Error extracting text: {e}]")
        
        if not text_content:
            return "No text content could be extracted from this PDF."
        
        return "\n\n".join(text_content)
    
    except Exception as e:
        return f"Error extracting PDF text: {e}"

def create_pdf_from_text(text_content: str) -> io.BytesIO:
    """Create a PDF file from text content."""
    if not PDF_SUPPORT:
        raise Exception("PDF creation not available. Please install reportlab: pip install reportlab")
    
    try:
        buffer = io.BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=letter, topMargin=72, bottomMargin=72)
        styles = getSampleStyleSheet()
        normal_style = styles['Normal']
        
        # Split text into paragraphs and create PDF content
        paragraphs = []
        
        # Process text line by line
        lines = text_content.split('\n')
        for line in lines:
            if line.strip():
                # Clean the text more thoroughly
                cleaned_line = (line.replace('<', '&lt;')
                                  .replace('>', '&gt;')
                                  .replace('&', '&amp;')
                                  .replace('"', '&quot;')
                                  .replace("'", '&apos;'))
                
                # Handle very long lines by wrapping them
                if len(cleaned_line) > 100:
                    words = cleaned_line.split(' ')
                    current_line = []
                    for word in words:
                        current_line.append(word)
                        if len(' '.join(current_line)) > 80:
                            if len(current_line) > 1:
                                paragraphs.append(Paragraph(' '.join(current_line[:-1]), normal_style))
                                current_line = [word]
                    if current_line:
                        paragraphs.append(Paragraph(' '.join(current_line), normal_style))
                else:
                    paragraphs.append(Paragraph(cleaned_line, normal_style))
            else:
                # Add spacing for empty lines
                paragraphs.append(Paragraph('&nbsp;', normal_style))
        
        # Build the PDF
        doc.build(paragraphs)
        buffer.seek(0)
        return buffer
    
    except Exception as e:
        raise Exception(f"Error creating PDF: {e}")

def is_base64_content(content: str) -> bool:
    """Check if content is base64 encoded."""
    try:
        # Try to decode as base64
        decoded = base64.b64decode(content)
        # Check if it re-encodes to the same string
        return base64.b64encode(decoded).decode('utf-8') == content
    except:
        return False

@mcp.resource("gdrive:///{file_id}")
def read_file(file_id: str) -> str:
    """Read a Google Drive file resource."""
    try:
        # Get file metadata
        file_metadata = drive_service.files().get(fileId=file_id, fields='mimeType').execute()
        mime_type = file_metadata.get('mimeType', '')
        
        # Handle Google Workspace files
        if mime_type.startswith('application/vnd.google-apps'):
            export_mime_type = get_export_mime_type(mime_type)
            request = drive_service.files().export_media(fileId=file_id, mimeType=export_mime_type)
            
            file_io = io.BytesIO()
            downloader = MediaIoBaseDownload(file_io, request)
            done = False
            while done is False:
                status, done = downloader.next_chunk()
            
            content = file_io.getvalue().decode('utf-8')
            return content
        
        # Handle regular files
        request = drive_service.files().get_media(fileId=file_id)
        file_io = io.BytesIO()
        downloader = MediaIoBaseDownload(file_io, request)
        done = False
        while done is False:
            status, done = downloader.next_chunk()
        
        # Handle different file types
        if mime_type.startswith('text/') or mime_type == 'application/json':
            return file_io.getvalue().decode('utf-8')
        elif mime_type == 'application/pdf':
            return extract_pdf_text(file_io)
        else:
            # Return base64 encoded for other binary files
            return base64.b64encode(file_io.getvalue()).decode('utf-8')
            
    except Exception as e:
        raise Exception(f"Error reading file {file_id}: {e}")

# ==================== GOOGLE DRIVE TOOLS ====================

@mcp.tool()
def drive_search(query: str) -> str:
    """Search for files in Google Drive"""
    try:
        # Escape special characters for Drive API
        escaped_query = query.replace("\\", "\\\\").replace("'", "\\'")
        formatted_query = f"fullText contains '{escaped_query}'"
        
        results = drive_service.files().list(
            q=formatted_query,
            pageSize=10,
            fields="files(id, name, mimeType, modifiedTime, size)"
        ).execute()
        
        files = results.get('files', [])
        file_count = len(files)
        
        if file_count == 0:
            return "No files found."
        
        file_list = []
        for file in files:
            file_list.append(f"{file['name']} ({file['mimeType']}) [ID: {file['id']}]")
        
        return f"Found {file_count} files:\n" + "\n".join(file_list)
    
    except Exception as e:
        return f"Error searching files: {str(e)}"

@mcp.tool()
def drive_read(fileId: str) -> str:
    """Read the contents of a file from Google Drive using its fileId"""
    try:
        # Get file metadata
        file_metadata = drive_service.files().get(fileId=fileId, fields='mimeType,name').execute()
        mime_type = file_metadata.get('mimeType', '')
        file_name = file_metadata.get('name', 'Unknown')
        
        # Handle Google Workspace files
        if mime_type.startswith('application/vnd.google-apps'):
            export_mime_type = get_export_mime_type(mime_type)
            request = drive_service.files().export_media(fileId=fileId, mimeType=export_mime_type)
            
            file_io = io.BytesIO()
            downloader = MediaIoBaseDownload(file_io, request)
            done = False
            while done is False:
                status, done = downloader.next_chunk()
            
            content = file_io.getvalue().decode('utf-8')
            return f"File: {file_name}\nContent:\n\n{content}"
        
        # Handle regular files
        request = drive_service.files().get_media(fileId=fileId)
        file_io = io.BytesIO()
        downloader = MediaIoBaseDownload(file_io, request)
        done = False
        while done is False:
            status, done = downloader.next_chunk()
        
        # Handle different file types
        if mime_type.startswith('text/') or mime_type == 'application/json':
            content = file_io.getvalue().decode('utf-8')
            return f"File: {file_name}\nContent:\n\n{content}"
        elif mime_type == 'application/pdf':
            content = extract_pdf_text(file_io)
            return f"File: {file_name}\nExtracted Text Content:\n\n{content}"
        else:
            # For other binary files, return file info and base64 if small enough
            file_size = len(file_io.getvalue())
            if file_size <= 1024 * 1024:  # 1MB limit for base64 encoding
                encoded_content = base64.b64encode(file_io.getvalue()).decode('utf-8')
                return f"File: {file_name}\nBinary file (Base64 encoded):\n\n{encoded_content}"
            else:
                return f"File: {file_name}\nBinary file too large to encode. File size: {file_size} bytes, MIME type: {mime_type}"
    
    except Exception as e:
        return f"Error reading file {fileId}: {str(e)}"

@mcp.tool()
def drive_edit(fileId: str, content: str) -> str:
    """Edit the content of an existing file in Google Drive"""
    try:
        # Get current file metadata to preserve MIME type
        file_metadata = drive_service.files().get(fileId=fileId, fields='mimeType,name').execute()
        mime_type = file_metadata.get('mimeType', 'text/plain')
        file_name = file_metadata.get('name', 'Unknown')
        
        # Handle PDF editing differently
        if mime_type == 'application/pdf':
            if is_base64_content(content):
                # Content is already base64 encoded binary data
                binary_content = base64.b64decode(content)
                media = MediaIoBaseUpload(
                    io.BytesIO(binary_content),
                    mimetype=mime_type,
                    resumable=True
                )
            else:
                # Content is text that needs to be converted to PDF
                pdf_buffer = create_pdf_from_text(content)
                media = MediaIoBaseUpload(
                    pdf_buffer,
                    mimetype=mime_type,
                    resumable=True
                )
        else:
            # Handle other file types
            if is_base64_content(content) and not mime_type.startswith('text/'):
                # Binary content encoded as base64
                binary_content = base64.b64decode(content)
                media = MediaIoBaseUpload(
                    io.BytesIO(binary_content),
                    mimetype=mime_type,
                    resumable=True
                )
            else:
                # Text content
                media = MediaIoBaseUpload(
                    io.BytesIO(content.encode('utf-8')),
                    mimetype=mime_type,
                    resumable=True
                )
        
        file = drive_service.files().update(
            fileId=fileId,
            media_body=media,
            fields='id, name, mimeType'
        ).execute()
        
        return f"File updated successfully: {file['name']} (ID: {file['id']}, MIME type: {file['mimeType']})"
    
    except Exception as e:
        return f"Error editing file {fileId}: {str(e)}"

@mcp.tool()
def drive_delete(fileId: str) -> str:
    """Delete a file from Google Drive using its fileId"""
    try:
        # Move to trash
        drive_service.files().update(
            fileId=fileId,
            body={'trashed': True}
        ).execute()
        
        return f"File with ID {fileId} has been moved to the trash."
    
    except Exception as e:
        return f"Error deleting file {fileId}: {str(e)}"

# Add these tools to your mcp_toolkit.py file

@mcp.tool()
def drive_upload_file(file_path: str, file_name: Optional[str] = None, folder_id: Optional[str] = None) -> str:
    """
    Upload a file to Google Drive
    
    Args:
        file_path: Path to the file to upload (from uploads directory)
        file_name: Optional custom name for the file (defaults to original filename)
        folder_id: Optional Google Drive folder ID to upload to (defaults to root)
    """
    try:
        # Check if file exists
        if not os.path.exists(file_path):
            return f"Error: File not found at {file_path}"
        
        # Get file info
        original_filename = os.path.basename(file_path)
        upload_filename = file_name if file_name else original_filename
        
        # Detect MIME type
        mime_type, _ = mimetypes.guess_type(file_path)
        if not mime_type:
            mime_type = 'application/octet-stream'
        
        # Prepare file metadata
        file_metadata = {
            'name': upload_filename
        }
        
        # Add parent folder if specified
        if folder_id:
            file_metadata['parents'] = [folder_id]
        
        # Create media upload object
        media = MediaFileUpload(file_path, mimetype=mime_type, resumable=True)
        
        # Upload file to Drive
        file = drive_service.files().create(
            body=file_metadata,
            media_body=media,
            fields='id,name,size,mimeType,webViewLink'
        ).execute()
        
        # Get file size
        file_size = os.path.getsize(file_path)
        
        response = f"File uploaded to Google Drive successfully!\n"
        response += f"File Name: {file['name']}\n"
        response += f"File ID: {file['id']}\n"
        response += f"MIME Type: {file['mimeType']}\n"
        response += f"Size: {file_size} bytes\n"
        response += f"View Link: {file.get('webViewLink', 'N/A')}\n"
        
        return response
        
    except HttpError as e:
        return f"Google Drive API error: {str(e)}"
    except Exception as e:
        return f"Error uploading file to Drive: {str(e)}"


@mcp.tool()
def drive_move(fileId: str, targetFolderId: str) -> str:
    """Move a file to a different folder in Google Drive"""
    try:
        # Get current parents
        file = drive_service.files().get(fileId=fileId, fields='parents').execute()
        previous_parents = ','.join(file.get('parents', []))
        
        # Move file
        file = drive_service.files().update(
            fileId=fileId,
            addParents=targetFolderId,
            removeParents=previous_parents,
            fields='id, name, parents'
        ).execute()
        
        return f"File moved successfully: {file['name']} (ID: {file['id']}) to folder ID: {targetFolderId}"
    
    except Exception as e:
        return f"Error moving file {fileId}: {str(e)}"

@mcp.tool()
def drive_share_file(fileId: str, email: str, role: str = "reader", send_notification: bool = True) -> str:
    """Share a Google Drive file with someone and get shareable link
    
    Args:
        fileId: ID of the file to share
        email: Email address to share with
        role: Permission level ('reader', 'writer', 'commenter')
        send_notification: Whether to send email notification
    """
    try:
        # Create permission
        permission = {
            'type': 'user',
            'role': role,
            'emailAddress': email
        }
        
        drive_service.permissions().create(
            fileId=fileId,
            body=permission,
            sendNotificationEmail=send_notification
        ).execute()
        
        # Get shareable link
        file_metadata = drive_service.files().get(
            fileId=fileId, 
            fields='webViewLink,name'
        ).execute()
        
        return f"File '{file_metadata['name']}' shared with {email} as {role}.\nShareable link: {file_metadata['webViewLink']}"
    
    except Exception as e:
        return f"Error sharing file {fileId}: {str(e)}"

@mcp.tool()
def drive_get_shareable_link(fileId: str, make_public: bool = False) -> str:
    """Get shareable link for a Google Drive file
    
    Args:
        fileId: ID of the file
        make_public: Whether to make file publicly accessible
    """
    try:
        if make_public:
            # Make file publicly readable
            permission = {
                'type': 'anyone',
                'role': 'reader'
            }
            drive_service.permissions().create(
                fileId=fileId,
                body=permission
            ).execute()
        
        # Get file metadata including links
        file_metadata = drive_service.files().get(
            fileId=fileId, 
            fields='webViewLink,webContentLink,name'
        ).execute()
        
        result = f"File: {file_metadata['name']}\n"
        result += f"View link: {file_metadata['webViewLink']}\n"
        if 'webContentLink' in file_metadata:
            result += f"Download link: {file_metadata['webContentLink']}"
        
        return result
    
    except Exception as e:
        return f"Error getting shareable link for {fileId}: {str(e)}"

@mcp.tool()
def drive_create_folder(name: str, parent_folder_id: str = None) -> str:
    """Create a new folder in Google Drive
    
    Args:
        name: Name of the folder to create
        parent_folder_id: ID of parent folder (None for root directory)
    """
    try:
        folder_metadata = {
            'name': name,
            'mimeType': 'application/vnd.google-apps.folder'
        }
        
        # Set parent folder if specified
        if parent_folder_id:
            folder_metadata['parents'] = [parent_folder_id]
        
        folder = drive_service.files().create(
            body=folder_metadata,
            fields='id, name, parents'
        ).execute()
        
        parent_info = f" in folder ID: {parent_folder_id}" if parent_folder_id else " in root directory"
        return f"Folder created successfully: '{folder['name']}' (ID: {folder['id']}){parent_info}"
    
    except Exception as e:
        return f"Error creating folder: {str(e)}"

@mcp.tool()
def drive_list_folder_contents(folder_id: str, include_subfolders: bool = True) -> str:
    """List all files and folders within a specific folder
    
    Args:
        folder_id: ID of the folder to list contents (use 'root' for root directory)
        include_subfolders: Whether to include subfolders in the listing
    """
    try:
        # Query to get files in the specified folder
        query = f"'{folder_id}' in parents and trashed=false"
        
        results = drive_service.files().list(
            q=query,
            pageSize=100,
            fields="files(id, name, mimeType, size, modifiedTime, owners)",
            orderBy="folder,name"
        ).execute()
        
        items = results.get('files', [])
        
        if not items:
            return f"No files or folders found in the specified location."
        
        # Get folder name for context
        try:
            if folder_id == 'root':
                folder_name = "My Drive (Root)"
            else:
                folder_info = drive_service.files().get(fileId=folder_id, fields='name').execute()
                folder_name = folder_info.get('name', 'Unknown Folder')
        except:
            folder_name = f"Folder ID: {folder_id}"
        
        # Separate folders and files
        folders = []
        files = []
        
        for item in items:
            item_info = {
                'name': item['name'],
                'id': item['id'],
                'mimeType': item.get('mimeType', ''),
                'size': item.get('size', 'N/A'),
                'modified': item.get('modifiedTime', 'Unknown'),
                'owner': item.get('owners', [{}])[0].get('displayName', 'Unknown') if item.get('owners') else 'Unknown'
            }
            
            if item['mimeType'] == 'application/vnd.google-apps.folder':
                folders.append(item_info)
            else:
                files.append(item_info)
        
        # Build response
        response = f"Contents of '{folder_name}':\n"
        response += f"Total items: {len(items)} ({len(folders)} folders, {len(files)} files)\n\n"
        
        # List folders first
        if folders:
            response += "📁 FOLDERS:\n"
            for folder in folders:
                response += f"  📁 {folder['name']} (ID: {folder['id']}) - Modified: {folder['modified'][:10]}\n"
            response += "\n"
        
        # List files
        if files:
            response += "📄 FILES:\n"
            for file in files:
                size_info = f" - {format_file_size(file['size'])}" if file['size'] != 'N/A' else ""
                file_type = get_file_type_emoji(file['mimeType'])
                response += f"  {file_type} {file['name']} (ID: {file['id']}){size_info} - Modified: {file['modified'][:10]}\n"
        
        # Add subfolder contents if requested
        if include_subfolders and folders:
            response += "\n" + "="*50 + "\n"
            response += "SUBFOLDER CONTENTS:\n"
            for folder in folders[:3]:  # Limit to first 3 subfolders to avoid overwhelming output
                try:
                    subfolder_query = f"'{folder['id']}' in parents and trashed=false"
                    subfolder_results = drive_service.files().list(
                        q=subfolder_query,
                        pageSize=20,
                        fields="files(id, name, mimeType)"
                    ).execute()
                    
                    subfolder_items = subfolder_results.get('files', [])
                    if subfolder_items:
                        response += f"\n📁 {folder['name']} ({len(subfolder_items)} items):\n"
                        for item in subfolder_items[:10]:  # Show first 10 items
                            emoji = "📁" if item['mimeType'] == 'application/vnd.google-apps.folder' else get_file_type_emoji(item['mimeType'])
                            response += f"    {emoji} {item['name']} (ID: {item['id']})\n"
                        if len(subfolder_items) > 10:
                            response += f"    ... and {len(subfolder_items) - 10} more items\n"
                except:
                    response += f"\n📁 {folder['name']}: [Could not access contents]\n"
            
            if len(folders) > 3:
                response += f"\n... and {len(folders) - 3} more subfolders not shown. Use include_subfolders=False for cleaner output.\n"
        
        return response
    
    except Exception as e:
        return f"Error listing folder contents: {str(e)}"

@mcp.tool()
def drive_list_all_files(max_results: int = 50, file_type: str = None, order_by: str = "name") -> str:
    """List all files and folders in Google Drive
    
    Args:
        max_results: Maximum number of items to return (default: 50, max: 1000)
        file_type: Filter by file type ('folder', 'document', 'spreadsheet', 'presentation', 'pdf', 'image', etc.)
        order_by: Sort order ('name', 'modifiedTime', 'createdTime', 'quotaBytesUsed')
    """
    try:
        # Build query based on file_type filter
        query = "trashed=false"
        
        if file_type:
            file_type_queries = {
                'folder': "mimeType='application/vnd.google-apps.folder'",
                'document': "mimeType='application/vnd.google-apps.document'",
                'spreadsheet': "mimeType='application/vnd.google-apps.spreadsheet'",
                'presentation': "mimeType='application/vnd.google-apps.presentation'",
                'pdf': "mimeType='application/pdf'",
                'image': "mimeType contains 'image/'",
                'video': "mimeType contains 'video/'",
                'audio': "mimeType contains 'audio/'",
                'text': "mimeType contains 'text/'"
            }
            
            if file_type.lower() in file_type_queries:
                query += f" and {file_type_queries[file_type.lower()]}"
            else:
                return f"Unsupported file type filter: {file_type}. Supported types: {', '.join(file_type_queries.keys())}"
        
        # Limit max_results to prevent overwhelming output
        max_results = min(max_results, 1000)
        
        results = drive_service.files().list(
            q=query,
            pageSize=max_results,
            fields="files(id, name, mimeType, size, modifiedTime, createdTime, owners, parents, shared, webViewLink)",
            orderBy=order_by
        ).execute()
        
        items = results.get('files', [])
        
        if not items:
            filter_text = f" matching filter '{file_type}'" if file_type else ""
            return f"No files found{filter_text}."
        
        # Build response
        filter_text = f" (filtered by: {file_type})" if file_type else ""
        response = f"All Files in Google Drive{filter_text}:\n"
        response += f"Showing {len(items)} items (ordered by {order_by}):\n\n"
        
        # Separate folders and files for better organization
        folders = []
        files = []
        
        for item in items:
            if item['mimeType'] == 'application/vnd.google-apps.folder':
                folders.append(item)
            else:
                files.append(item)
        
        # Show folders first
        if folders:
            response += f"📁 FOLDERS ({len(folders)}):\n"
            for folder in folders:
                modified_date = folder.get('modifiedTime', 'Unknown')[:10]
                shared_status = " [SHARED]" if folder.get('shared', False) else ""
                response += f"  📁 {folder['name']} (ID: {folder['id']}) - Modified: {modified_date}{shared_status}\n"
            response += "\n"
        
        # Show files
        if files:
            response += f"📄 FILES ({len(files)}):\n"
            for file in files:
                size_info = f" - {format_file_size(file.get('size', 'N/A'))}" if file.get('size') else ""
                modified_date = file.get('modifiedTime', 'Unknown')[:10]
                shared_status = " [SHARED]" if file.get('shared', False) else ""
                file_emoji = get_file_type_emoji(file['mimeType'])
                
                response += f"  {file_emoji} {file['name']} (ID: {file['id']}){size_info} - Modified: {modified_date}{shared_status}\n"
        
        # Add summary statistics
        total_size = 0
        size_count = 0
        for item in items:
            if item.get('size') and item['size'].isdigit():
                total_size += int(item['size'])
                size_count += 1
        
        response += f"\n📊 SUMMARY:\n"
        response += f"  Total items: {len(items)}\n"
        response += f"  Folders: {len(folders)}\n"
        response += f"  Files: {len(files)}\n"
        if size_count > 0:
            response += f"  Total size (files with size info): {format_file_size(str(total_size))}\n"
        
        return response
    
    except Exception as e:
        return f"Error listing all files: {str(e)}"
# In mcp_toolkit.py, replace the old drive_create_enhanced function with this:

@mcp.tool()
def drive_create(name: str, mimeType: str, content: str, folder_id: Optional[str] = None) -> str:
    """
    Create a new file in Google Drive. Handles Google Docs, PDFs, and plain text.
    
    Args:
        name: Name of the file.
        mimeType: MIME type ('application/vnd.google-apps.document' for Google Docs, 'application/pdf', 'text/plain', etc.).
        content: File content. For Google Docs, this is the text that will be in the document.
        folder_id: Optional Google Drive folder ID to create the file in.
    """
    try:
        file_metadata = {
            'name': name,
            'mimeType': mimeType
        }
        if folder_id:
            file_metadata['parents'] = [folder_id]

        # Special handling for Google Docs - create the doc then insert text.
        if mimeType == 'application/vnd.google-apps.document':
            docs_service = build('docs', 'v1', credentials=load_credentials())
            
            # Create an empty document first
            doc_file = drive_service.files().create(body=file_metadata).execute()
            document_id = doc_file['id']
            
            # Insert the content
            requests = [{
                'insertText': {
                    'location': {'index': 1},
                    'text': content
                }
            }]
            docs_service.documents().batchUpdate(
                documentId=document_id,
                body={'requests': requests}
            ).execute()

            # Get the document link
            file_metadata = drive_service.files().get(
                fileId=document_id, 
                fields='webViewLink,name'
            ).execute()
            
            return f"✅ Google Document created successfully!\n\n📄 **{name}**\n🆔 Document ID: {document_id}\n🔗 Link: {file_metadata['webViewLink']}"

        # Handle other file types as before
        media = None
        if mimeType == 'application/pdf':
            if is_base64_content(content):
                binary_content = base64.b64decode(content)
                media = MediaIoBaseUpload(io.BytesIO(binary_content), mimetype=mimeType, resumable=True)
            else:
                pdf_buffer = create_pdf_from_text(content)
                media = MediaIoBaseUpload(pdf_buffer, mimetype=mimeType, resumable=True)
        else:
            if is_base64_content(content) and not mimeType.startswith('text/'):
                binary_content = base64.b64decode(content)
                media = MediaIoBaseUpload(io.BytesIO(binary_content), mimetype=mimeType, resumable=True)
            else:
                media = MediaIoBaseUpload(io.BytesIO(content.encode('utf-8')), mimetype=mimeType, resumable=True)

        file = drive_service.files().create(
            body=file_metadata,
            media_body=media,
            fields='id, name, mimeType, webViewLink'
        ).execute()
        
        return f"✅ File created successfully!\n\n📄 **{file['name']}**\n🆔 ID: {file['id']}\n📋 MIME type: {file['mimeType']}\n🔗 Link: {file.get('webViewLink', 'N/A')}"
    
    except Exception as e:
        return f"❌ Error creating file: {str(e)}"
# Helper functions to add at the end of the file (before if __name__ == "__main__":)
def format_file_size(size_str: str) -> str:
    """Format file size in human-readable format"""
    try:
        if size_str == 'N/A' or not size_str or not size_str.isdigit():
            return 'Size unknown'
        
        size_bytes = int(size_str)
        
        if size_bytes < 1024:
            return f"{size_bytes} B"
        elif size_bytes < 1024 * 1024:
            return f"{size_bytes / 1024:.1f} KB"
        elif size_bytes < 1024 * 1024 * 1024:
            return f"{size_bytes / (1024 * 1024):.1f} MB"
        else:
            return f"{size_bytes / (1024 * 1024 * 1024):.1f} GB"
    except:
        return 'Size unknown'

def get_file_type_emoji(mime_type: str) -> str:
    """Get emoji based on file MIME type"""
    emoji_map = {
        'application/vnd.google-apps.folder': '📁',
        'application/vnd.google-apps.document': '📝',
        'application/vnd.google-apps.spreadsheet': '📊',
        'application/vnd.google-apps.presentation': '📽️',
        'application/vnd.google-apps.drawing': '🎨',
        'application/pdf': '📄',
        'image/': '🖼️',
        'video/': '🎥',
        'audio/': '🎵',
        'text/': '📄',
        'application/zip': '📦',
        'application/json': '🔧',
    }
    
    # Check exact matches first
    if mime_type in emoji_map:
        return emoji_map[mime_type]
    
    # Check partial matches
    for key, emoji in emoji_map.items():
        if key.endswith('/') and mime_type.startswith(key):
            return emoji
    
    # Default for unknown types
    return '📄'

# ==================== GMAIL TOOLS ====================
def strip_html_tags(html_content):
    """Remove HTML tags and convert to clean text"""
    if not html_content:
        return ""
    
    # Remove HTML tags
    clean = re.sub('<.*?>', '', html_content)
    # Decode HTML entities
    clean = unescape(clean)
    # Clean up whitespace
    clean = re.sub(r'\s+', ' ', clean).strip()
    return clean

def format_file_size(size_str):
    """Format file size in human readable format"""
    try:
        size = int(size_str)
        for unit in ['B', 'KB', 'MB', 'GB']:
            if size < 1024:
                return f"{size:.1f} {unit}"
            size /= 1024
        return f"{size:.1f} TB"
    except:
        return size_str

@mcp.tool()
def gmail_list_messages(max_results: int = 10, query: Optional[str] = None) -> str:
    """List recent emails with clean, AI-friendly format"""
    try:
        params = {'userId': 'me', 'maxResults': max_results}
        if query:
            params['q'] = query
        response = gmail_service.users().messages().list(**params).execute()
        messages = response.get('messages', [])
        
        if not messages:
            return "No messages found."
        
        # Get clean info for each message
        message_list = []
        for msg in messages:
            try:
                full_msg = gmail_service.users().messages().get(
                    userId='me', id=msg['id'], format='metadata',
                    metadataHeaders=['From', 'Subject', 'Date', 'To']
                ).execute()
                
                headers = full_msg.get('payload', {}).get('headers', [])
                subject = next((h['value'] for h in headers if h['name'] == 'Subject'), 'No Subject')
                from_addr = next((h['value'] for h in headers if h['name'] == 'From'), 'Unknown Sender')
                to_addr = next((h['value'] for h in headers if h['name'] == 'To'), 'Unknown Recipient')
                date = next((h['value'] for h in headers if h['name'] == 'Date'), 'Unknown Date')
                
                # Clean sender name (extract name from "Name <email>" format)
                sender_clean = from_addr.split('<')[0].strip().strip('"') if '<' in from_addr else from_addr
                
                message_list.append(f"ID: {msg['id']}\nSubject: {subject}\nFrom: {sender_clean}\nTo: {to_addr}\nDate: {date}\n")
                
            except Exception as e:
                message_list.append(f"ID: {msg['id']}\nError: Could not fetch details - {str(e)}\n")
        
        return "\n" + "="*50 + "\n".join(message_list)
    
    except HttpError as e:
        return f"Gmail API Error: {str(e)}"

@mcp.tool()
def gmail_read_message(message_id: str, include_attachments_info: bool = True) -> str:
    """Read email content in clean, AI-friendly format with optional attachment info"""
    try:
        message = gmail_service.users().messages().get(
            userId='me', id=message_id, format='full'
        ).execute()

        # Extract headers
        headers = message.get('payload', {}).get('headers', [])
        subject = next((h['value'] for h in headers if h['name'] == 'Subject'), 'No Subject')
        sender = next((h['value'] for h in headers if h['name'] == 'From'), 'Unknown Sender')
        recipient = next((h['value'] for h in headers if h['name'] == 'To'), 'Unknown Recipient')
        date = next((h['value'] for h in headers if h['name'] == 'Date'), 'Unknown Date')
        
        # Clean sender name
        sender_clean = sender.split('<')[0].strip().strip('"') if '<' in sender else sender
        
        # Extract body text
        body = extract_email_body(message.get('payload', {}))
        
        # Format response
        response = f"EMAIL DETAILS:\n"
        response += f"Message ID: {message_id}\n"
        response += f"Subject: {subject}\n"
        response += f"From: {sender_clean}\n"
        response += f"To: {recipient}\n"
        response += f"Date: {date}\n\n"
        response += f"BODY:\n{body}\n"
        
        # Add attachment info if requested
        if include_attachments_info:
            attachments = get_attachment_info(message.get('payload', {}))
            if attachments:
                response += f"\nATTACHMENTS ({len(attachments)}):\n"
                for i, att in enumerate(attachments, 1):
                    response += f"{i}. {att['filename']} ({att['size']}, {att['mime_type']})\n"
            else:
                response += "\nNo attachments found.\n"

        return response

    except HttpError as e:
        return f"Gmail API Error: {str(e)}"
    except Exception as e:
        return f"Error reading message: {str(e)}"

def extract_email_body(payload):
    """Extract clean text body from email payload"""
    # Try to get plain text first
    plain_text = extract_text_from_payload(payload, 'text/plain')
    if plain_text:
        return plain_text
    
    # Fall back to HTML and strip tags
    html_text = extract_text_from_payload(payload, 'text/html')
    if html_text:
        return strip_html_tags(html_text)
    
    return "No readable text content found."

def extract_text_from_payload(payload, mime_type):
    """Recursively extract text of specific MIME type from payload"""
    if payload.get('mimeType') == mime_type:
        data = payload.get('body', {}).get('data')
        if data:
            try:
                return base64.urlsafe_b64decode(data).decode('utf-8', errors='ignore')
            except:
                return None

    for part in payload.get('parts', []):
        result = extract_text_from_payload(part, mime_type)
        if result:
            return result

    return None

def get_attachment_info(payload):
    """Get basic attachment information without downloading"""
    attachments = []
    
    def process_parts(parts):
        for part in parts:
            if 'parts' in part:
                process_parts(part['parts'])
            elif part.get('filename') and part['body'].get('attachmentId'):
                attachments.append({
                    'filename': part['filename'],
                    'mime_type': part['mimeType'],
                    'size': format_file_size(str(part['body'].get('size', 0))),
                    'attachment_id': part['body']['attachmentId']
                })
    
    if 'parts' in payload:
        process_parts(payload['parts'])
    
    return attachments

@mcp.tool()
def gmail_read_attachments(
    message_id: Optional[str] = None,
    sender: Optional[str] = None,
    subject_contains: Optional[str] = None,
    days_back: int = 7,
    max_results: int = 5,
    max_attachment_size_mb: int = 10,
    read_text_content: bool = True
) -> str:
    """
    Efficiently read email attachments with flexible search options
    
    Args:
        message_id: Specific email ID to read attachments from
        sender: Filter by sender email/name  
        subject_contains: Filter by subject keywords
        days_back: How many days back to search (default: 7)
        max_results: Max emails to process (default: 5)
        max_attachment_size_mb: Max attachment size to process in MB
        read_text_content: Whether to extract and preview text content
    """
    try:
        # If specific message ID provided, process that email only
        if message_id:
            return process_single_email_attachments(message_id, max_attachment_size_mb, read_text_content)
        
        # Build search query for emails with attachments
        query_parts = ["has:attachment"]
        
        # Add date filter
        date_filter = datetime.now() - timedelta(days=days_back)
        query_parts.append(f"after:{date_filter.strftime('%Y/%m/%d')}")
        
        # Add optional filters
        if sender:
            query_parts.append(f"from:({sender})")
        if subject_contains:
            query_parts.append(f'subject:"{subject_contains}"')
        
        search_query = " ".join(query_parts)
        
        # Search for messages
        results = gmail_service.users().messages().list(
            userId='me',
            q=search_query,
            maxResults=max_results
        ).execute()
        
        messages = results.get('messages', [])
        
        if not messages:
            return f"No emails with attachments found.\nSearch criteria: {search_query}"
        
        response = f"FOUND {len(messages)} EMAIL(S) WITH ATTACHMENTS\n"
        response += f"Search Query: {search_query}\n\n"
        
        # Process each email
        for i, message in enumerate(messages, 1):
            try:
                email_response = process_single_email_attachments(
                    message['id'], max_attachment_size_mb, read_text_content
                )
                response += f"EMAIL {i}:\n{email_response}\n"
                response += "="*60 + "\n"
                
            except Exception as e:
                response += f"EMAIL {i}: Error processing {message['id']} - {str(e)}\n"
                continue
        
        return response
        
    except Exception as e:
        return f"Error reading attachments: {str(e)}"

def process_single_email_attachments(message_id: str, max_size_mb: int, read_content: bool) -> str:
    """Process attachments from a single email"""
    try:
        # Get full message
        message = gmail_service.users().messages().get(
            userId='me', id=message_id, format='full'
        ).execute()
        
        # Extract email metadata
        headers = message['payload'].get('headers', [])
        subject = next((h['value'] for h in headers if h['name'] == 'Subject'), 'No Subject')
        sender = next((h['value'] for h in headers if h['name'] == 'From'), 'Unknown Sender')
        date = next((h['value'] for h in headers if h['name'] == 'Date'), 'Unknown Date')
        
        sender_clean = sender.split('<')[0].strip().strip('"') if '<' in sender else sender
        
        response = f"Subject: {subject}\n"
        response += f"From: {sender_clean}\n"
        response += f"Date: {date}\n"
        response += f"Message ID: {message_id}\n\n"
        
        # Process attachments
        attachments = extract_attachments_from_message(message_id, message['payload'], max_size_mb, read_content)
        
        if not attachments:
            return response + "No attachments found in this email."
        
        response += f"ATTACHMENTS ({len(attachments)}):\n"
        
        for i, attachment in enumerate(attachments, 1):
            response += f"\n{i}. {attachment['filename']}\n"
            response += f"   Type: {attachment['mime_type']}\n"
            response += f"   Size: {attachment['size']}\n"
            response += f"   Status: {attachment['status']}\n"
            
            if attachment.get('content_preview'):
                response += f"   Content Preview:\n   {attachment['content_preview'][:300]}...\n"
        
        return response
        
    except Exception as e:
        return f"Error processing email {message_id}: {str(e)}"

def extract_attachments_from_message(message_id: str, payload: dict, max_size_mb: int, read_content: bool) -> List[Dict]:
    """Extract and optionally read attachment content from message payload"""
    attachments = []
    
    def process_parts(parts):
        for part in parts:
            if 'parts' in part:
                process_parts(part['parts'])
            elif part.get('filename') and part['body'].get('attachmentId'):
                filename = part['filename']
                mime_type = part['mimeType']
                size_bytes = part['body'].get('size', 0)
                attachment_id = part['body']['attachmentId']
                
                # Check size limit
                size_mb = size_bytes / (1024 * 1024) if size_bytes else 0
                
                attachment_info = {
                    'filename': filename,
                    'mime_type': mime_type,
                    'size': format_file_size(str(size_bytes)),
                    'attachment_id': attachment_id
                }
                
                if size_mb > max_size_mb:
                    attachment_info['status'] = f'Skipped - too large ({size_mb:.1f}MB > {max_size_mb}MB)'
                    attachment_info['content_preview'] = None
                else:
                    try:
                        # Download attachment data
                        attachment_data = gmail_service.users().messages().attachments().get(
                            userId='me',
                            messageId=message_id,
                            id=attachment_id
                        ).execute()
                        
                        file_data = base64.urlsafe_b64decode(attachment_data['data'])
                        attachment_info['status'] = 'Successfully downloaded'
                        
                        # Extract content preview if requested
                        if read_content:
                            attachment_info['content_preview'] = extract_attachment_content(file_data, mime_type)
                        else:
                            attachment_info['content_preview'] = None
                            
                    except Exception as e:
                        attachment_info['status'] = f'Download failed: {str(e)}'
                        attachment_info['content_preview'] = None
                
                attachments.append(attachment_info)
    
    if 'parts' in payload:
        process_parts(payload['parts'])
    
    return attachments

def extract_attachment_content(file_data: bytes, mime_type: str) -> str:
    """Extract readable content from attachment based on MIME type"""
    try:
        if mime_type.startswith('text/'):
            return file_data.decode('utf-8', errors='ignore')
        
        elif mime_type == 'application/json':
            return file_data.decode('utf-8', errors='ignore')
        
        elif mime_type in ['application/xml', 'text/xml']:
            return file_data.decode('utf-8', errors='ignore')
        
        elif mime_type == 'application/pdf':
            # Basic PDF text extraction (you'd need PyPDF2 or similar for full extraction)
            text = file_data.decode('utf-8', errors='ignore')
            # Remove PDF binary parts and keep readable text
            cleaned = re.sub(r'[^\x20-\x7E\n\r\t]', '', text)
            return cleaned if cleaned.strip() else "PDF content (binary - use PDF reader)"
        
        else:
            return f"Binary file ({mime_type}) - {len(file_data)} bytes"
            
    except Exception as e:
        return f"Content extraction failed: {str(e)}"

@mcp.tool()
def gmail_search_and_summarize(
    query: Optional[str] = None,
    sender: Optional[str] = None, 
    recipient: Optional[str] = None,
    subject_contains: Optional[str] = None,
    max_results: int = 10
) -> str:
    """Search emails with clean, summarized results"""
    try:
        # Build search query
        search_parts = []
        
        if sender:
            search_parts.append(f"from:({sender})")
        if recipient:
            search_parts.append(f"to:({recipient})")
        if subject_contains:
            search_parts.append(f"subject:({subject_contains})")
        if query:
            search_parts.append(f"({query})")
            
        gmail_query = " ".join(search_parts) if search_parts else "in:inbox"
        
        # Search messages
        results = gmail_service.users().messages().list(
            userId='me',
            q=gmail_query,
            maxResults=max_results
        ).execute()
        
        messages = results.get('messages', [])
        
        if not messages:
            return f"No emails found for query: {gmail_query}"
        
        response = f"SEARCH RESULTS ({len(messages)} emails):\n"
        response += f"Query: {gmail_query}\n\n"
        
        # Process each message
        for i, msg in enumerate(messages, 1):
            try:
                message = gmail_service.users().messages().get(
                    userId='me', id=msg['id'], format='full'
                ).execute()
                
                # Extract headers
                headers = message['payload'].get('headers', [])
                subject = next((h['value'] for h in headers if h['name'] == 'Subject'), 'No Subject')
                sender = next((h['value'] for h in headers if h['name'] == 'From'), 'Unknown')
                date = next((h['value'] for h in headers if h['name'] == 'Date'), 'Unknown')
                
                sender_clean = sender.split('<')[0].strip().strip('"') if '<' in sender else sender
                
                # Get body preview
                body = extract_email_body(message['payload'])
                body_preview = body[:200].replace('\n', ' ').strip() + "..." if len(body) > 200 else body
                
                response += f"{i}. {subject}\n"
                response += f"   From: {sender_clean}\n"
                response += f"   Date: {date}\n"
                response += f"   Preview: {body_preview}\n"
                response += f"   ID: {msg['id']}\n\n"
                
            except Exception as e:
                response += f"{i}. Error processing email {msg['id']}: {str(e)}\n\n"
        
        return response
        
    except Exception as e:
        return f"Search error: {str(e)}"

@mcp.tool()
def gmail_send_message(to: str, subject: str, body: str) -> str:
    """Send a simple email"""
    try:
        profile = gmail_service.users().getProfile(userId='me').execute()
        from_email = profile['emailAddress']
        
        msg = MIMEText(body)
        msg['to'] = to
        msg['from'] = from_email
        msg['subject'] = subject
        raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
        
        result = gmail_service.users().messages().send(
            userId='me', body={'raw': raw}
        ).execute()
        
        return f"Email sent successfully!\nMessage ID: {result['id']}\nTo: {to}\nSubject: {subject}"
    
    except Exception as e:
        return f"Error sending email: {str(e)}"


@mcp.tool() 
def gmail_list_labels() -> str:
    """List Gmail labels in clean format"""
    try:
        response = gmail_service.users().labels().list(userId='me').execute()
        labels = response.get('labels', [])
        
        if not labels:
            return "No labels found."
        
        result = "GMAIL LABELS:\n"
        for label in labels:
            result += f"- {label['name']} (ID: {label['id']})\n"
        
        return result
        
    except Exception as e:
        return f"Error listing labels: {str(e)}"

@mcp.tool()
def gmail_modify_labels(
    message_id: str,
    add_labels: Optional[List[str]] = None,
    remove_labels: Optional[List[str]] = None
) -> str:
    """Add or remove labels - returns simple confirmation"""
    try:
        add = add_labels or []
        remove = remove_labels or []
        body = {'addLabelIds': add, 'removeLabelIds': remove}
        
        gmail_service.users().messages().modify(
            userId='me', id=message_id, body=body
        ).execute()
        
        actions = []
        if add:
            actions.append(f"Added: {', '.join(add)}")
        if remove:
            actions.append(f"Removed: {', '.join(remove)}")
        
        return f"Labels updated for message {message_id}\n{' | '.join(actions)}"
        
    except Exception as e:
        return f"Error modifying labels: {str(e)}"

@mcp.tool()
def gmail_delete_message(message_id: str) -> str:
    """Delete an email - returns simple confirmation"""
    try:
        gmail_service.users().messages().delete(userId='me', id=message_id).execute()
        return f"Email {message_id} deleted successfully."
    except Exception as e:
        return f"Error deleting email: {str(e)}"

@mcp.tool()
def gmail_send_with_drive_attachment(
    to: str, subject: str, body: str, drive_file_id: str, 
    share_with_recipient: bool = True
) -> str:
    """Send email with Google Drive file link"""
    try:
        # Get file info
        file_metadata = drive_service.files().get(
            fileId=drive_file_id, 
            fields='name,webViewLink'
        ).execute()
        
        file_name = file_metadata['name']
        file_link = file_metadata['webViewLink']
        
        # Share file if requested
        share_status = "not shared"
        if share_with_recipient:
            try:
                permission = {
                    'type': 'user',
                    'role': 'reader', 
                    'emailAddress': to
                }
                drive_service.permissions().create(
                    fileId=drive_file_id,
                    body=permission,
                    sendNotificationEmail=False
                ).execute()
                share_status = "shared with recipient"
            except:
                share_status = "sharing failed"
        
        # Enhanced email body
        enhanced_body = f"{body}\n\n---\nAttached Google Drive File: {file_name}\nLink: {file_link}"
        
        # Send email
        profile = gmail_service.users().getProfile(userId='me').execute()
        from_email = profile['emailAddress']
        
        msg = MIMEText(enhanced_body)
        msg['to'] = to
        msg['from'] = from_email
        msg['subject'] = subject
        raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
        
        result = gmail_service.users().messages().send(
            userId='me', body={'raw': raw}
        ).execute()
        
        return f"Email sent with Drive file!\nMessage ID: {result['id']}\nFile: {file_name} ({share_status})\nLink: {file_link}"
    
    except Exception as e:
        return f"Error sending email with Drive attachment: {str(e)}"

@mcp.tool()
def gmail_send_multiple_attachments(
    to: str, subject: str, body: str, file_paths: List[str]
) -> str:
    """Send email with multiple file attachments"""
    try:
        # Check files exist
        missing_files = [f for f in file_paths if not os.path.exists(f)]
        if missing_files:
            return f"Files not found: {', '.join(missing_files)}"
        
        # Get sender info
        profile = gmail_service.users().getProfile(userId='me').execute()
        from_email = profile['emailAddress']
        
        # Create multipart message
        msg = MIMEMultipart()
        msg['to'] = to
        msg['from'] = from_email
        msg['subject'] = subject
        msg.attach(MIMEText(body, 'plain'))
        
        attached_files = []
        total_size = 0
        
        # Attach files
        for file_path in file_paths:
            filename = os.path.basename(file_path)
            file_size = os.path.getsize(file_path)
            total_size += file_size
            
            with open(file_path, 'rb') as f:
                file_data = f.read()
            
            part = MIMEBase('application', 'octet-stream')
            part.set_payload(file_data)
            encoders.encode_base64(part)
            part.add_header('Content-Disposition', f'attachment; filename= {filename}')
            msg.attach(part)
            
            attached_files.append({'name': filename, 'size': format_file_size(str(file_size))})
        
        # Send email
        raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
        result = gmail_service.users().messages().send(userId='me', body={'raw': raw}).execute()
        
        files_info = ", ".join([f"{f['name']} ({f['size']})" for f in attached_files])
        return f"Email sent with {len(attached_files)} attachments!\nMessage ID: {result['id']}\nFiles: {files_info}\nTotal Size: {format_file_size(str(total_size))}"
        
    except Exception as e:
        return f"Error sending email with attachments: {str(e)}"
# ==================== GOOGLE CALENDAR TOOLS ====================

@mcp.tool()
def calendar_list_events(timeMin: str, timeMax: str, maxResults: int = 10) -> str:
    """List upcoming calendar events within a time range
    
    Args:
        timeMin: RFC3339 timestamp for start of range (e.g., '2024-01-01T00:00:00Z')
        timeMax: RFC3339 timestamp for end of range (e.g., '2024-01-31T23:59:59Z') 
        maxResults: Maximum number of events to return (default: 10)
    """
    try:
        events_result = calendar_service.events().list(
            calendarId="primary",
            timeMin=timeMin,
            timeMax=timeMax,
            maxResults=maxResults,
            singleEvents=True,
            orderBy="startTime"
        ).execute()

        events = events_result.get('items', [])

        if not events:
            return "No upcoming events found."

        event_list = []
        for event in events:
            start = event['start'].get('dateTime', event['start'].get('date'))
            location = event.get('location', 'No location')
            description = event.get('description', 'No description')
            event_id = event.get('id', 'No ID')
            
            event_info = f"ID: {event_id}\nTitle: {event['summary']}\nTime: {start}\nLocation: {location}\nDescription: {description[:100]}{'...' if len(description) > 100 else ''}"
            event_list.append(event_info)

        return f"Found {len(events)} events:\n\n" + "\n\n---\n\n".join(event_list)

    except Exception as e:
        return f"Error listing events: {str(e)}"

@mcp.tool()
def calendar_create_event_with_invitations(
    summary: str,
    startTime: str, 
    endTime: str,
    attendees: Optional[List[str]] = None,
    location: Optional[str] = None,
    description: Optional[str] = None,
    send_invitations: bool = True
) -> str:
    """
    Create a calendar event and automatically send invitations to attendees.
    
    Args:
        summary: Event title
        startTime: RFC3339 start time (e.g., '2024-01-15T10:00:00Z')
        endTime: RFC3339 end time (e.g., '2024-01-15T11:00:00Z')
        attendees: List of attendee emails
        location: Event location (optional)
        description: Event description (optional)
        send_invitations: Whether to send email invitations (default: True)
    """
    try:
        # Prepare event data
        event_data = {
            'summary': summary,
            'start': {
                'dateTime': startTime,
                'timeZone': 'UTC',
            },
            'end': {
                'dateTime': endTime,
                'timeZone': 'UTC',
            },
        }
        
        # Add optional fields
        if location:
            event_data['location'] = location
        if description:
            event_data['description'] = description
            
        # Add attendees if provided
        if attendees:
            event_data['attendees'] = [{'email': email} for email in attendees]
        
        # Create the calendar event
        event = calendar_service.events().insert(
            calendarId='primary', 
            body=event_data,
            sendUpdates='all' if send_invitations and attendees else 'none'
        ).execute()
        
        event_id = event['id']
        event_link = event.get('htmlLink', '')
        
        response = f"Calendar event created successfully!\n"
        response += f"Event ID: {event_id}\n"
        response += f"Title: {summary}\n"
        response += f"Start: {startTime}\n"
        response += f"End: {endTime}\n"
        
        if location:
            response += f"Location: {location}\n"
        if description:
            response += f"Description: {description}\n"
        if event_link:
            response += f"Event Link: {event_link}\n"
            
        # If attendees were added and invitations should be sent
        if attendees and send_invitations:
            response += f"\nInvitations sent to {len(attendees)} attendees:\n"
            for email in attendees:
                response += f"- {email}\n"
                
            response += f"\nNote: Calendar invitations have been automatically sent via Google Calendar."
        elif attendees and not send_invitations:
            response += f"\nAttendees added (no invitations sent):\n"
            for email in attendees:
                response += f"- {email}\n"
        
        return response
        
    except Exception as e:
        return f"Error creating calendar event: {str(e)}"

@mcp.tool()
def calendar_get_availability(timeMin: str, timeMax: str) -> str:
    """Get free/busy information for primary calendar
    
    Args:
        timeMin: RFC3339 timestamp for start of range
        timeMax: RFC3339 timestamp for end of range
    """
    try:
        body = {
            "timeMin": timeMin,
            "timeMax": timeMax,
            "items": [{"id": "primary"}]
        }

        busy_info = calendar_service.freebusy().query(body=body).execute()
        busy_times = busy_info.get("calendars", {}).get("primary", {}).get("busy", [])

        if not busy_times:
            return f"No busy times found between {timeMin} and {timeMax}\nYou appear to be free during this entire period!"
        else:
            busy_list = []
            for busy_period in busy_times:
                start = busy_period.get("start")
                end = busy_period.get("end")
                busy_list.append(f"- Busy from {start} to {end}")

            return f"Busy periods between {timeMin} and {timeMax}:\n\n" + "\n".join(busy_list)

    except Exception as e:
        return f"Error getting availability: {str(e)}"

@mcp.tool()
def calendar_update_event(event_id: str, 
                         summary: Optional[str] = None,
                         startTime: Optional[str] = None,
                         endTime: Optional[str] = None,
                         attendees: Optional[List[str]] = None,
                         location: Optional[str] = None,
                         description: Optional[str] = None) -> str:
    """Update an existing calendar event
    
    Args:
        event_id: ID of the event to update
        summary: New event title (optional)
        startTime: New RFC3339 start time (optional)
        endTime: New RFC3339 end time (optional)
        attendees: New list of attendee emails (optional)
        location: New event location (optional)
        description: New event description (optional)
    """
    try:
        # Get the existing event
        existing_event = calendar_service.events().get(
            calendarId="primary",
            eventId=event_id
        ).execute()

        # Update only the fields that were provided
        if summary is not None:
            existing_event["summary"] = summary
        if startTime is not None:
            existing_event["start"]["dateTime"] = startTime
        if endTime is not None:
            existing_event["end"]["dateTime"] = endTime
        if attendees is not None:
            existing_event["attendees"] = [{"email": email} for email in attendees]
        if location is not None:
            existing_event["location"] = location
        if description is not None:
            existing_event["description"] = description

        # Update the event
        updated_event = calendar_service.events().update(
            calendarId="primary",
            eventId=event_id,
            body=existing_event,
            sendUpdates="all"
        ).execute()

        return f"Event updated successfully!\n\nUpdated Details:\n- Title: {updated_event.get('summary')}\n- Event ID: {event_id}\n- Link: {updated_event.get('htmlLink')}"

    except Exception as e:
        return f"Error updating event: {str(e)}"

@mcp.tool()
def calendar_delete_event(event_id: str) -> str:
    """Delete a calendar event
    
    Args:
        event_id: ID of the event to delete
    """
    try:
        calendar_service.events().delete(
            calendarId="primary",
            eventId=event_id,
            sendUpdates="all"
        ).execute()

        return f"Event with ID '{event_id}' has been deleted successfully!"

    except Exception as e:
        return f"Error deleting event: {str(e)}"

def initialize_services():
    """Initialize both Google Drive and Gmail services."""
    global drive_service, gmail_service, calendar_service
    
    creds = load_credentials()
    if not creds:
        print("Warning: No credentials available. Services will not be initialized until user authenticates.")
        return
    
    # Initialize Google Drive service
    drive_service = build('drive', 'v3', credentials=creds)
    print("Google Drive service initialized")
    
    # Initialize Gmail service
    gmail_service = build('gmail', 'v1', credentials=creds)
    calendar_service = build('calendar', 'v3', credentials=creds)
    try:
        calendar_list = calendar_service.calendarList().list().execute()
        primary_calendar = next((cal for cal in calendar_list.get('items', []) if cal.get('primary')), None)
        if primary_calendar:
            print(f"Google Calendar service initialized: {primary_calendar.get('summary', 'Primary Calendar')}")
        else:
            print("Google Calendar service initialized")
    except HttpError as e:
        print(f"Calendar connection test failed: {e}")
        raise
    
    # Test Gmail connection
    try:
        profile = gmail_service.users().getProfile(userId='me').execute()
        print(f"Gmail service initialized: {profile['emailAddress']}")
    except HttpError as e:
        print(f"Gmail connection test failed: {e}")
        raise
    
    if not PDF_SUPPORT:
        print("PDF libraries not installed. PDF creation/editing will be limited.", file=sys.stderr)
        print("Install with: pip install PyPDF2 reportlab", file=sys.stderr)
    
    print("Server ready with Google Drive, Gmail, and Calendar integration")

if __name__ == "__main__":
    initialize_services()
    mcp.run(transport="stdio")