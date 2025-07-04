const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { OpenAI } = require('openai');
const { spawn } = require('child_process');
const path = require('path');
const session = require('express-session');
const { OAuth2Client } = require('google-auth-library');
const fs = require('fs').promises;
const upload = require('./middleware/upload');
const User = require('./models/User');
const Chat = require('./models/Chat');
const Message = require('./models/Message');
const Attachment = require('./models/Attachment');
const AuthToken = require('./models/AuthToken');
const FileUploadService = require('./services/fileUpload');
const FileParser = require('./services/fileParser');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback';
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key';
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Define allowed origins
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:5173',
      'https://mcp-enabled-chatbot.vercel.app',
      'https://ai-chatbot-backend-y75u.onrender.com'
    ];
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.warn('CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true, // This is essential for session cookies
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Content-Range', 'X-Content-Range']
};

// Apply CORS middleware BEFORE other middleware
app.use(cors(corsOptions));

app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-here',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // Use secure cookies in production
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax' // Important for cross-origin
  }
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
const generateJWT = (user) => {
    return jwt.sign(
        { 
            id: user.id, 
            email: user.email, 
            name: user.name, 
            picture: user.picture 
        },
        JWT_SECRET,
        { expiresIn: '24h' }
    );
};

const verifyJWT = (token) => {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (error) {
        return null;
    }
};

// OpenAI client
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// MCP Server connection
let mcpProcess = null;
let mcpReady = false;
let requestId = 1;
let availableTools = [];
let pendingResponses = new Map();

// Complete list of ALL MCP tools (30+ tools)
const getAllMCPTools = () => [
    // Google Drive Tools (10 tools)
    {
        type: "function",
        function: {
            name: "drive_search",
            description: "Search for files in Google Drive by name, content, or metadata",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Search query for files" },
                    file_type: { type: "string", description: "Filter by file type (optional)" },
                    folder_id: { type: "string", description: "Search within specific folder (optional)" }
                },
                required: ["query"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "drive_list_files",
            description: "List files in Google Drive with optional filtering",
            parameters: {
                type: "object",
                properties: {
                    folder_id: { type: "string", description: "Folder ID to list files from (optional)" },
                    max_results: { type: "number", description: "Maximum number of files to return" }
                },
                required: []
            }
        }
    },
    {
        type: "function",
        function: {
            name: "drive_read_file",
            description: "Read the content of a file from Google Drive",
            parameters: {
                type: "object",
                properties: {
                    file_id: { type: "string", description: "Google Drive file ID" }
                },
                required: ["file_id"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "drive_create_file",
            description: "Create a new file in Google Drive",
            parameters: {
                type: "object",
                properties: {
                    name: { type: "string", description: "Name of the file to create" },
                    content: { type: "string", description: "Content of the file" },
                    mime_type: { type: "string", description: "MIME type of the file" },
                    folder_id: { type: "string", description: "Parent folder ID (optional)" }
                },
                required: ["name", "content"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "drive_update_file",
            description: "Update an existing file in Google Drive",
            parameters: {
                type: "object",
                properties: {
                    file_id: { type: "string", description: "Google Drive file ID" },
                    content: { type: "string", description: "New content for the file" },
                    name: { type: "string", description: "New name for the file (optional)" }
                },
                required: ["file_id", "content"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "drive_delete_file",
            description: "Delete a file from Google Drive",
            parameters: {
                type: "object",
                properties: {
                    file_id: { type: "string", description: "Google Drive file ID to delete" }
                },
                required: ["file_id"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "drive_share_file",
            description: "Share a Google Drive file with specific users or make it public",
            parameters: {
                type: "object",
                properties: {
                    file_id: { type: "string", description: "Google Drive file ID" },
                    email: { type: "string", description: "Email address to share with" },
                    role: { type: "string", description: "Permission role (reader, writer, owner)" },
                    type: { type: "string", description: "Permission type (user, anyone)" }
                },
                required: ["file_id", "email", "role"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "drive_upload_file",
            description: "Upload a local file to Google Drive",
            parameters: {
                type: "object",
                properties: {
                    file_path: { type: "string", description: "Local path to the file to upload" },
                    name: { type: "string", description: "Name for the file in Drive (optional)" },
                    folder_id: { type: "string", description: "Parent folder ID (optional)" }
                },
                required: ["file_path"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "drive_create_folder",
            description: "Create a new folder in Google Drive",
            parameters: {
                type: "object",
                properties: {
                    name: { type: "string", description: "Name of the folder to create" },
                    parent_folder_id: { type: "string", description: "Parent folder ID (optional)" }
                },
                required: ["name"]
            }
        }
    },
  

    // Gmail Tools (8 tools)
    {
        type: "function",
        function: {
            name: "gmail_send_message",
            description: "Send an email message via Gmail",
            parameters: {
                type: "object",
                properties: {
                    to: { type: "string", description: "Recipient email address" },
                    subject: { type: "string", description: "Email subject" },
                    body: { type: "string", description: "Email body content" },
                    cc: { type: "string", description: "CC email addresses (optional)" },
                    bcc: { type: "string", description: "BCC email addresses (optional)" }
                },
                required: ["to", "subject", "body"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "gmail_search_messages",
            description: "Search for email messages in Gmail",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Gmail search query" },
                    max_results: { type: "number", description: "Maximum number of results" }
                },
                required: ["query"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "gmail_read_message",
            description: "Read the content of a specific Gmail message",
            parameters: {
                type: "object",
                properties: {
                    message_id: { type: "string", description: "Gmail message ID" }
                },
                required: ["message_id"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "gmail_list_messages",
            description: "List recent Gmail messages",
            parameters: {
                type: "object",
                properties: {
                    max_results: { type: "number", description: "Maximum number of messages to return" },
                    label_ids: { type: "array", items: { type: "string" }, description: "Filter by label IDs" }
                },
                required: []
            }
        }
    },
    {
        type: "function",
        function: {
            name: "gmail_send_file_attachment",
            description: "Send an email with file attachments",
            parameters: {
                type: "object",
                properties: {
                    to: { type: "string", description: "Recipient email address" },
                    subject: { type: "string", description: "Email subject" },
                    body: { type: "string", description: "Email body content" },
                    file_path: { type: "string", description: "Path to file to attach" }
                },
                required: ["to", "subject", "body", "file_path"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "gmail_list_labels",
            description: "List all Gmail labels",
            parameters: {
                type: "object",
                properties: {},
                required: []
            }
        }
    },
    {
        type: "function",
        function: {
            name: "gmail_mark_as_read",
            description: "Mark Gmail messages as read",
            parameters: {
                type: "object",
                properties: {
                    message_ids: { type: "array", items: { type: "string" }, description: "List of message IDs" }
                },
                required: ["message_ids"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "gmail_add_label",
            description: "Add labels to Gmail messages",
            parameters: {
                type: "object",
                properties: {
                    message_ids: { type: "array", items: { type: "string" }, description: "List of message IDs" },
                    label_ids: { type: "array", items: { type: "string" }, description: "List of label IDs to add" }
                },
                required: ["message_ids", "label_ids"]
            }
        }
    },

    // Google Calendar Tools (6 tools)
    {
        type: "function",
        function: {
            name: "calendar_create_event",
            description: "Create a new event in Google Calendar",
            parameters: {
                type: "object",
                properties: {
                    summary: { type: "string", description: "Event title/summary" },
                    start_time: { type: "string", description: "Event start time (ISO format)" },
                    end_time: { type: "string", description: "Event end time (ISO format)" },
                    description: { type: "string", description: "Event description (optional)" },
                    attendees: { type: "array", items: { type: "string" }, description: "List of attendee emails" },
                    location: { type: "string", description: "Event location (optional)" }
                },
                required: ["summary", "start_time", "end_time"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "calendar_list_events",
            description: "List upcoming events from Google Calendar",
            parameters: {
                type: "object",
                properties: {
                    max_results: { type: "number", description: "Maximum number of events to return" },
                    time_min: { type: "string", description: "Start time filter (ISO format)" },
                    time_max: { type: "string", description: "End time filter (ISO format)" }
                },
                required: []
            }
        }
    },
    {
        type: "function",
        function: {
            name: "calendar_update_event",
            description: "Update an existing calendar event",
            parameters: {
                type: "object",
                properties: {
                    event_id: { type: "string", description: "Calendar event ID" },
                    summary: { type: "string", description: "New event title (optional)" },
                    start_time: { type: "string", description: "New start time (optional)" },
                    end_time: { type: "string", description: "New end time (optional)" },
                    description: { type: "string", description: "New description (optional)" }
                },
                required: ["event_id"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "calendar_delete_event",
            description: "Delete a calendar event",
            parameters: {
                type: "object",
                properties: {
                    event_id: { type: "string", description: "Calendar event ID to delete" }
                },
                required: ["event_id"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "calendar_get_free_busy",
            description: "Check free/busy status for calendar users",
            parameters: {
                type: "object",
                properties: {
                    emails: { type: "array", items: { type: "string" }, description: "List of email addresses to check" },
                    time_min: { type: "string", description: "Start time for check (ISO format)" },
                    time_max: { type: "string", description: "End time for check (ISO format)" }
                },
                required: ["emails", "time_min", "time_max"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "calendar_find_meeting_time",
            description: "Find available meeting times for multiple attendees",
            parameters: {
                type: "object",
                properties: {
                    attendees: { type: "array", items: { type: "string" }, description: "List of attendee emails" },
                    duration_minutes: { type: "number", description: "Meeting duration in minutes" },
                    preferred_times: { type: "array", items: { type: "string" }, description: "Preferred time slots" }
                },
                required: ["attendees", "duration_minutes"]
            }
        }
    },

    // Google Docs Tools (4 tools)
    {
        type: "function",
        function: {
            name: "docs_create_document",
            description: "Create a new Google Docs document",
            parameters: {
                type: "object",
                properties: {
                    title: { type: "string", description: "Document title" },
                    content: { type: "string", description: "Initial document content" }
                },
                required: ["title"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "docs_read_document",
            description: "Read content from a Google Docs document",
            parameters: {
                type: "object",
                properties: {
                    document_id: { type: "string", description: "Google Docs document ID" }
                },
                required: ["document_id"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "docs_update_document",
            description: "Update content in a Google Docs document",
            parameters: {
                type: "object",
                properties: {
                    document_id: { type: "string", description: "Google Docs document ID" },
                    content: { type: "string", description: "New content to insert" },
                    insert_index: { type: "number", description: "Position to insert content" }
                },
                required: ["document_id", "content"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "docs_export_document",
            description: "Export Google Docs document to different formats",
            parameters: {
                type: "object",
                properties: {
                    document_id: { type: "string", description: "Google Docs document ID" },
                    format: { type: "string", description: "Export format (pdf, docx, txt, html)" }
                },
                required: ["document_id", "format"]
            }
        }
    },

    // Google Sheets Tools (4 tools)
    {
        type: "function",
        function: {
            name: "sheets_create_spreadsheet",
            description: "Create a new Google Sheets spreadsheet",
            parameters: {
                type: "object",
                properties: {
                    title: { type: "string", description: "Spreadsheet title" },
                    sheet_names: { type: "array", items: { type: "string" }, description: "Names of sheets to create" }
                },
                required: ["title"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "sheets_read_range",
            description: "Read data from a specific range in Google Sheets",
            parameters: {
                type: "object",
                properties: {
                    spreadsheet_id: { type: "string", description: "Google Sheets spreadsheet ID" },
                    range: { type: "string", description: "Range to read (e.g., 'Sheet1!A1:C10')" }
                },
                required: ["spreadsheet_id", "range"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "sheets_write_range",
            description: "Write data to a specific range in Google Sheets",
            parameters: {
                type: "object",
                properties: {
                    spreadsheet_id: { type: "string", description: "Google Sheets spreadsheet ID" },
                    range: { type: "string", description: "Range to write to (e.g., 'Sheet1!A1:C10')" },
                    values: { type: "array", description: "2D array of values to write" }
                },
                required: ["spreadsheet_id", "range", "values"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "sheets_append_data",
            description: "Append data to the end of a Google Sheets spreadsheet",
            parameters: {
                type: "object",
                properties: {
                    spreadsheet_id: { type: "string", description: "Google Sheets spreadsheet ID" },
                    range: { type: "string", description: "Range to append to" },
                    values: { type: "array", description: "2D array of values to append" }
                },
                required: ["spreadsheet_id", "range", "values"]
            }
        }
    },

    // File Analysis Tools (6 tools)
    {
        type: "function",
        function: {
            name: "analyze_file",
            description: "Analyze and extract information from uploaded files",
            parameters: {
                type: "object",
                properties: {
                    file_path: { type: "string", description: "Path to the file to analyze" },
                    analysis_type: { type: "string", description: "Type of analysis (content, metadata, structure)" }
                },
                required: ["file_path"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "extract_text_from_pdf",
            description: "Extract text content from PDF files",
            parameters: {
                type: "object",
                properties: {
                    file_path: { type: "string", description: "Path to the PDF file" },
                    page_range: { type: "string", description: "Page range to extract (e.g., '1-5')" }
                },
                required: ["file_path"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "extract_text_from_docx",
            description: "Extract text content from Word documents",
            parameters: {
                type: "object",
                properties: {
                    file_path: { type: "string", description: "Path to the DOCX file" }
                },
                required: ["file_path"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "analyze_image",
            description: "Analyze image files and extract information",
            parameters: {
                type: "object",
                properties: {
                    file_path: { type: "string", description: "Path to the image file" },
                    analysis_type: { type: "string", description: "Type of analysis (metadata, content, ocr)" }
                },
                required: ["file_path"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "extract_data_from_csv",
            description: "Extract and analyze data from CSV files",
            parameters: {
                type: "object",
                properties: {
                    file_path: { type: "string", description: "Path to the CSV file" },
                    delimiter: { type: "string", description: "CSV delimiter (default: comma)" },
                    has_header: { type: "boolean", description: "Whether CSV has header row" }
                },
                required: ["file_path"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "convert_file_format",
            description: "Convert files between different formats",
            parameters: {
                type: "object",
                properties: {
                    input_file_path: { type: "string", description: "Path to input file" },
                    output_format: { type: "string", description: "Target format (pdf, docx, txt, etc.)" },
                    output_path: { type: "string", description: "Output file path (optional)" }
                },
                required: ["input_file_path", "output_format"]
            }
        }
    }
];

// Initialize MCP Server
async function initializeMCP(userId) {
    if (!userId) {
        console.error('❌ Cannot start MCP without userId');
        return;
    }
    currentUserId = userId;

    const mcpPath = path.join(__dirname, 'mcp_toolkit.py');

    let tokenData;
    try {
        tokenData = await AuthToken.findByUserId(userId);
        if (!tokenData) throw new Error('No auth token found for user');
    } catch (err) {
        console.error('❌ Failed to load token from Supabase:', err.message);
        return;
    }

    const mcpEnv = {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        GOOGLE_ACCESS_TOKEN: tokenData.access_token,
        GOOGLE_REFRESH_TOKEN: tokenData.refresh_token,
        GOOGLE_TOKEN_EXPIRES_AT: new Date(tokenData.expires_at).getTime().toString(),
        SESSION_USER_ID: userId
    };
    console.log('🔐 Starting MCP with tokens:', {
        access: tokenData.access_token?.substring(0, 5) + '...',
        refresh: tokenData.refresh_token?.substring(0, 5) + '...',
        expires: tokenData.expires_at
    });
    mcpProcess = spawn('python', [mcpPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: mcpEnv
    });
    let outputBuffer = '';

    mcpProcess.stdout.on('data', (data) => {
        outputBuffer += data.toString();
        const lines = outputBuffer.split('\n');
        outputBuffer = lines.pop() || '';

        for (let line of lines) {
            if (line.trim()) {
                console.log('MCP Raw Output:', line);

                if (line.includes('Server ready') || line.includes('Google Drive service initialized')) {
                    mcpReady = true;
                    console.log('✅ MCP Server is ready');
                }

                try {
                    const response = JSON.parse(line);
                    console.log('📥 MCP JSON Response:', response);

                    if (response.id && pendingResponses.has(response.id)) {
                        const { resolve, reject } = pendingResponses.get(response.id);
                        pendingResponses.delete(response.id);

                        if (response.error) {
                            reject(new Error(response.error.message || JSON.stringify(response.error)));
                        } else {
                            resolve(response.result);
                        }
                    }
                } catch (e) {
                    if (!line.includes('WARNING') && !line.includes('oauth2client')) {
                        console.log('📄 MCP Status:', line);
                    }
                }
            }
        }
    });
    mcpProcess.stderr.on('data', (data) => {
        // This will print any and all messages from Python's stderr stream
        console.error(`[PYTHON STDERR]: ${data.toString()}`);
    });
    // --- END OF ADDED BLOCK ---

    // It's also good practice to know if the process closes unexpectedly
    mcpProcess.on('close', (code) => {
        console.log(`MCP process exited with code ${code}`);
        mcpProcess = null; // Clear the process variable
        mcpReady = false;
    });

    setTimeout(() => {
        initializeMCPHandshake();
    }, 2000);
}

function restartMCP() {
    console.log('♻️ Restarting MCP due to updated credentials...');
    if (mcpProcess) {
        mcpProcess.kill();
    }
    setTimeout(() => {
        initializeMCP(user.Id);
    }, 1000);
}

async function initializeMCPHandshake() {
    try {
        console.log('🤝 Starting MCP handshake...');

        const initResponse = await sendMCPRequest('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {
                roots: {
                    listChanged: true
                },
                sampling: {}
            },
            clientInfo: {
                name: 'google-workspace-client',
                version: '1.0.0'
            }
        });

        console.log('✅ MCP Initialize response:', initResponse);
        await sendMCPNotification('notifications/initialized');
        console.log('✅ MCP Handshake completed');
        await getAvailableTools();

    } catch (error) {
        console.error('❌ MCP Handshake failed:', error);
    }
}

async function getAvailableTools() {
    try {
        console.log('🔍 Getting available tools...');
        const toolsResponse = await sendMCPRequest('tools/list');

        if (toolsResponse && toolsResponse.tools) {
            availableTools = toolsResponse.tools.map(tool => ({
                type: "function",
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.inputSchema || {
                        type: "object",
                        properties: {},
                        required: []
                    }
                }
            }));

            console.log('✅ Available tools loaded dynamically:', availableTools.map(t => t.function.name));
        } else {
            throw new Error('No tools received from MCP');
        }
    } catch (error) {
        console.error('❌ Error getting tools dynamically, using fallback:', error);
        // Use complete fallback tools
        availableTools = getAllMCPTools();
        console.log(`✅ Loaded ${availableTools.length} fallback tools:`, availableTools.map(t => t.function.name));
    }
}

function sendMCPRequest(method, params = {}) {
    return new Promise((resolve, reject) => {
        if (!mcpProcess || !mcpProcess.stdin) {
            reject(new Error('MCP process not available'));
            return;
        }

        const currentRequestId = requestId++;
        const request = {
            jsonrpc: '2.0',
            id: currentRequestId,
            method: method,
            params: params
        };

        console.log('📤 Sending MCP request:', JSON.stringify(request));

        pendingResponses.set(currentRequestId, { resolve, reject });

        setTimeout(() => {
            if (pendingResponses.has(currentRequestId)) {
                pendingResponses.delete(currentRequestId);
                reject(new Error(`MCP request timeout for method: ${method}`));
            }
        }, 30000);

        try {
            mcpProcess.stdin.write(JSON.stringify(request) + '\n');
        } catch (error) {
            pendingResponses.delete(currentRequestId);
            reject(error);
        }
    });
}

function sendMCPNotification(method, params = {}) {
    return new Promise((resolve, reject) => {
        if (!mcpProcess || !mcpProcess.stdin) {
            reject(new Error('MCP process not available'));
            return;
        }

        const notification = {
            jsonrpc: '2.0',
            method: method,
            params: params
        };

        console.log('📤 Sending MCP notification:', JSON.stringify(notification));

        try {
            mcpProcess.stdin.write(JSON.stringify(notification) + '\n');
            resolve(true);
        } catch (error) {
            reject(error);
        }
    });
}

async function callMCPTool(toolName, params) {
    try {
        console.log(`🔧 Calling MCP tool: ${toolName}`, params);

        if (!mcpReady) {
            // Provide demo responses when MCP is not ready
            return getDemoToolResponse(toolName, params);
        }

        const result = await sendMCPRequest('tools/call', {
            name: toolName,
            arguments: params
        });

        console.log(`✅ Tool ${toolName} result:`, result);

        if (result && result.content) {
            if (Array.isArray(result.content)) {
                return result.content.map(item => item.text || item).join('\n');
            } else if (typeof result.content === 'object' && result.content.text) {
                return result.content.text;
            } else {
                return result.content.toString();
            }
        } else if (typeof result === 'string') {
            return result;
        } else {
            return JSON.stringify(result);
        }
    } catch (error) {
        console.error(`❌ Error calling tool ${toolName}:`, error);
        // Fallback to demo response on error
        return getDemoToolResponse(toolName, params);
    }
}

function getDemoToolResponse(toolName, params) {
    const demoResponses = {
        // Google Drive
        'drive_search': `Demo: Found 3 files matching "${params.query}": Document1.docx, Spreadsheet1.xlsx, Presentation1.pptx`,
        'drive_list_files': 'Demo: Listed 10 files from Google Drive: file1.pdf, file2.docx, file3.xlsx...',
        'drive_read_file': `Demo: Reading file content for ${params.file_id}. Content: "This is sample file content..."`,
        'drive_create_file': `Demo: Created file "${params.name}" successfully. File ID: demo_file_123`,
        'drive_update_file': `Demo: Updated file ${params.file_id} with new content`,
        'drive_delete_file': `Demo: Deleted file ${params.file_id} successfully`,
        'drive_share_file': `Demo: Shared file ${params.file_id} with ${params.email} as ${params.role}`,
        'drive_upload_file': `Demo: Uploaded file from ${params.file_path} to Google Drive`,
        'drive_create_folder': `Demo: Created folder "${params.name}" successfully`,
        'drive_get_file_metadata': `Demo: File metadata for ${params.file_id}: Name: Sample.pdf, Size: 1.2MB, Modified: Today`,

        // Gmail
        'gmail_send_message': `Demo: Email sent to ${params.to} with subject "${params.subject}"`,
        'gmail_search_messages': `Demo: Found 5 messages matching "${params.query}"`,
        'gmail_read_message': `Demo: Message content: "This is a sample email message..."`,
        'gmail_list_messages': 'Demo: Listed 10 recent messages from Gmail inbox',
        'gmail_send_file_attachment': `Demo: Email with attachment sent to ${params.to}`,
        'gmail_list_labels': 'Demo: Labels: Inbox, Sent, Drafts, Important, Work, Personal',
        'gmail_mark_as_read': `Demo: Marked ${params.message_ids.length} messages as read`,
        'gmail_add_label': `Demo: Added labels to ${params.message_ids.length} messages`,

        // Calendar
        'calendar_create_event': `Demo: Created event "${params.summary}" for ${params.start_time}`,
        'calendar_list_events': 'Demo: Upcoming events: Meeting at 2PM, Call at 4PM, Dinner at 7PM',
        'calendar_update_event': `Demo: Updated event ${params.event_id}`,
        'calendar_delete_event': `Demo: Deleted event ${params.event_id}`,
        'calendar_get_free_busy': `Demo: Free/busy status for ${params.emails.join(', ')}: Available 9-11AM, Busy 2-4PM`,
        'calendar_find_meeting_time': `Demo: Available meeting slots: 10AM-11AM, 3PM-4PM tomorrow`,

        // Google Docs
        'docs_create_document': `Demo: Created document "${params.title}" successfully`,
        'docs_read_document': `Demo: Document content: "This is sample document content..."`,
        'docs_update_document': `Demo: Updated document ${params.document_id} with new content`,
        'docs_export_document': `Demo: Exported document ${params.document_id} as ${params.format}`,

        // Google Sheets
        'sheets_create_spreadsheet': `Demo: Created spreadsheet "${params.title}" successfully`,
        'sheets_read_range': `Demo: Data from ${params.range}: [["Name", "Age"], ["John", "25"], ["Jane", "30"]]`,
        'sheets_write_range': `Demo: Wrote data to ${params.range} successfully`,
        'sheets_append_data': `Demo: Appended ${params.values.length} rows to spreadsheet`,

        // File Analysis
        'analyze_file': `Demo: Analyzed file ${params.file_path}. Type: ${params.analysis_type || 'content'}. Results: File contains text, images, and metadata.`,
        'extract_text_from_pdf': `Demo: Extracted text from PDF: "This is sample PDF content extracted from ${params.file_path}..."`,
        'extract_text_from_docx': `Demo: Extracted text from Word document: "Sample document content..."`,
        'analyze_image': `Demo: Image analysis of ${params.file_path}: Resolution: 1920x1080, Format: PNG, Contains: text, objects`,
        'extract_data_from_csv': `Demo: CSV data extracted: 100 rows, 5 columns (Name, Age, City, Email, Phone)`,
        'convert_file_format': `Demo: Converted ${params.input_file_path} to ${params.output_format} format`
    };

    return demoResponses[toolName] || `Demo: Executed ${toolName} with parameters: ${JSON.stringify(params)}`;
}

// Authentication middleware
const requireAuth = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1]; // Bearer token
    
    if (!token) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    const decoded = verifyJWT(token);
    if (!decoded) {
        return res.status(401).json({ error: 'Invalid token' });
    }
    
    req.user = decoded;
    next();
};

// Google OAuth routes
app.get('/auth/google', (req, res) => {
    const authUrl = googleClient.generateAuthUrl({
        access_type: 'offline',
        scope: [
            'https://www.googleapis.com/auth/userinfo.profile',
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/drive',
            'https://www.googleapis.com/auth/gmail.readonly',
            'https://www.googleapis.com/auth/gmail.send',
            'https://www.googleapis.com/auth/gmail.labels',
            'https://www.googleapis.com/auth/gmail.modify',
            'https://www.googleapis.com/auth/calendar.events',
            'https://www.googleapis.com/auth/calendar.readonly',
            'https://www.googleapis.com/auth/documents',
            'https://www.googleapis.com/auth/spreadsheets'
        ],
        prompt: 'consent'
    });
    res.redirect(authUrl);
});

app.get('/auth/google/callback', async (req, res) => {
    try {
        const { code } = req.query;

        if (!code) {
            console.error('No authorization code received');
            return res.redirect(`${process.env.FRONTEND_URL}/login?error=no_code`);
        }

        console.log('🔐 Processing Google OAuth callback...');

        const { tokens } = await googleClient.getToken(code);
        console.log('✅ Received OAuth tokens');

        // Get user info
        googleClient.setCredentials(tokens);
        const ticket = await googleClient.verifyIdToken({
            idToken: tokens.id_token,
            audience: GOOGLE_CLIENT_ID
        });

        const payload = ticket.getPayload();
        const googleId = payload.sub;

        console.log('👤 User info retrieved:', { email: payload.email, name: payload.name });

        // Find or create user in database
        let user = await User.findByGoogleId(googleId);

        if (!user) {
            console.log('🆕 Creating new user...');
            user = await User.create({
                googleId: googleId,
                email: payload.email,
                name: payload.name,
                picture: payload.picture
            });
        } else {
            console.log('👋 Existing user found, updating info...');
            user = await User.update(user.id, {
                email: payload.email,
                name: payload.name,
                picture: payload.picture
            });
        }

        // Store or update auth tokens
        const expiresAt = new Date(Date.now() + (tokens.expiry_date || 3600000));

        const existingToken = await AuthToken.findByUserId(user.id);
        if (existingToken) {
            await AuthToken.update(user.id, {
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token,
                id_token: tokens.id_token,
                expires_at: expiresAt
            });
        } else {
            await AuthToken.create({
                userId: user.id,
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token,
                idToken: tokens.id_token,
                expiresAt: expiresAt
            });
        }

        // Generate JWT token
        const jwtToken = generateJWT(user);

        // Store user session (fallback for same-domain scenarios)
        req.session.user = {
            id: user.id,
            email: user.email,
            name: user.name,
            picture: user.picture
        };

        console.log('💾 User session created successfully');
        
        try {
            await initializeMCP(user.id);
            console.log("MCP initialized successfully");
        } catch (error) {
            console.log("MCP initialization error:", error);
        }

        // Redirect with JWT token as query parameter
        console.log('🔄 Redirecting to chat interface with JWT...');
        res.redirect(`${process.env.FRONTEND_URL}/auth/callback?token=${jwtToken}`);

    } catch (error) {
        console.error('❌ Google OAuth callback error:', error);
        res.redirect(`${process.env.FRONTEND_URL}/login?error=auth_failed`);
    }
});

app.get('/auth/user', async (req, res) => {
    try {
        // Check for JWT token first
        const token = req.headers.authorization?.split(' ')[1];
        
        if (token) {
            const decoded = verifyJWT(token);
            if (decoded) {
                // Get user preferences
                const preferences = await User.getPreferences(decoded.id);
                
                return res.json({
                    authenticated: true,
                    user: {
                        ...decoded,
                        preferences: preferences || {
                            preferred_model: 'gpt-4',
                            enabled_tools: [],
                            settings: {}
                        }
                    }
                });
            }
        }

        // Fallback to session-based auth
        if (req.session.user) {
            const preferences = await User.getPreferences(req.session.user.id);

            res.json({
                authenticated: true,
                user: {
                    ...req.session.user,
                    preferences: preferences || {
                        preferred_model: 'gpt-4',
                        enabled_tools: [],
                        settings: {}
                    }
                }
            });
        } else {
            res.json({
                authenticated: false,
                user: null
            });
        }
    } catch (error) {
        console.error('Error checking auth:', error);
        res.json({
            authenticated: false,
            user: null
        });
    }
});
app.post('/auth/logout', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        let userId = null;

        if (token) {
            const decoded = verifyJWT(token);
            userId = decoded?.id;
        } else if (req.session.user) {
            userId = req.session.user.id;
        }

        if (userId) {
            // Optionally clean up tokens from database
            await AuthToken.delete(userId);
        }

        req.session.destroy((err) => {
            if (err) {
                console.error('Session destruction error:', err);
                return res.status(500).json({ error: 'Failed to logout' });
            }
            res.json({ success: true });
        });
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({ error: 'Failed to logout' });
    }
});

// Chat endpoint with database integration
// Chat endpoint with database integration
app.post('/api/chat', requireAuth, upload.array('attachments', 5), async (req, res) => {
    try {
        const { message, chatId, model = 'gpt-4', enabledTools = '[]' } = req.body;
        
        // Fix: Get userId from req.user (set by requireAuth middleware) instead of req.session.user
        const userId = req.user.id;
        const files = req.files || [];

        console.log(`📝 Chat request received:`, {
            userId,
            message: message ? `${message.substring(0, 100)}...` : 'No message',
            model,
            filesCount: files.length,
            chatId: chatId || 'new'
        });

        if (!message && files.length === 0) {
            return res.status(400).json({ error: 'Message or attachments required' });
        }

        // Initialize tools if not already done
        if (availableTools.length === 0) {
            console.log('🔧 Initializing tools...');
            availableTools = getAllMCPTools();
            console.log(`✅ Initialized ${availableTools.length} tools`);
        }

        let currentChatId = chatId;
        let chat;

        // Create or get chat
        if (!currentChatId || currentChatId === 'new') {
            const title = message ? message.substring(0, 50) + '...' : `File Upload: ${files.map(f => f.originalname).join(', ')}`;
            console.log(`📁 Creating new chat: ${title}`);
            chat = await Chat.create(userId, title);
            currentChatId = chat.id;
        } else {
            console.log(`📁 Using existing chat: ${currentChatId}`);
            chat = await Chat.findById(currentChatId);
            if (!chat) {
                return res.status(404).json({ error: 'Chat not found' });
            }
        }

        // Handle file uploads
        let fileContents = [];
        for (const file of files) {
            try {
                console.log(`📎 File uploaded: ${file.originalname}`);

                // Upload file to Supabase Storage
                const uploadResult = await FileUploadService.uploadFile(file, userId);
                console.log(`☁️ File uploaded to storage: ${uploadResult.storagePath}`);

                // Parse file content
                const parsedContent = await FileParser.parseFile(
                    uploadResult.storagePath,
                    uploadResult.mimeType,
                    uploadResult.originalName
                );

                fileContents.push({
                    filename: uploadResult.originalName,
                    content: parsedContent,
                    mimeType: uploadResult.mimeType
                });

                // Save attachment to database
                await Attachment.create({
                    messageId: null, // Will be updated after message creation
                    userId: userId,
                    filename: uploadResult.filename,
                    originalName: uploadResult.originalName,
                    mimeType: uploadResult.mimeType,
                    fileSize: uploadResult.fileSize,
                    storagePath: uploadResult.storagePath
                });

            } catch (fileError) {
                console.error(`❌ Error processing file ${file.originalname}:`, fileError);
                fileContents.push({
                    filename: file.originalname,
                    content: `Error processing file: ${fileError.message}`,
                    mimeType: file.mimetype
                });
            }
        }

        // Build user message content
        let userMessageContent = message || '';
        if (fileContents.length > 0) {
            const fileDescriptions = fileContents.map(file =>
                `File: "${file.filename}" (${file.mimeType})\nContent: ${file.content}`
            ).join('\n\n');
            userMessageContent = message ? `${message}\n\nUploaded Files:\n${fileDescriptions}` : `Uploaded Files:\n${fileDescriptions}`;
        }

        // Get chat history for context
        const chatHistory = await Message.findByChatId(currentChatId);

        // Build conversation for OpenAI
        const messages = [
            {
                role: "system",
                content: `You are a helpful AI assistant with access to Google Workspace services through specialized tools. You can:

🔍 **Google Drive**: Search files, read documents, create documents, move files, share files
📧 **Gmail**: List emails, read messages, send emails, send with Drive attachments
📅 **Google Calendar**: List events, create events, check availability, update events

**Important Guidelines:**
- You CAN and SHOULD call multiple tools in sequence to complete complex tasks
- When users ask you to "create a document and send it to someone", do BOTH actions
- Break down complex requests into multiple tool calls
- Always explain what you're doing step by step
- If a tool call fails, try an alternative approach

**Multi-step Example Workflows:**
- Create document → Share with user → Send email with link
- Search for file → Read content → Create summary document → Send to recipient
- Create calendar event → Send email invitation

**Available Tools:**
${availableTools.map(tool => `- ${tool.function.name}: ${tool.function.description}`).join('\n')}

Always think step-by-step and use multiple tools when needed to fully complete the user's request.`
            }
        ];

        // Add chat history (excluding current message)
        chatHistory.slice(0, -1).forEach(msg => {
            messages.push({
                role: msg.role,
                content: msg.content
            });
        });

        // Save user message
        const userMessage = await Message.create({
            chatId: currentChatId,
            userId: userId,
            role: 'user',
            content: userMessageContent,
            model: model,
            toolsUsed: [],
            attachments: files.map(file => ({
                filename: file.originalname,
                original_name: file.originalname,
                mime_type: file.mimetype,
                file_size: file.size
            }))
        });

        messages.push(userMessage);
        console.log(`💬 Processing chat for user ${userId}, chat ${currentChatId}`);
        console.log(`🛠️  Available tools: ${availableTools.length}`);

        // Parse enabled tools
        let parsedEnabledTools = [];
        try {
            parsedEnabledTools = JSON.parse(enabledTools);
        } catch (e) {
            console.warn('Failed to parse enabled tools:', e);
        }

        // Filter available tools based on enabled tools from user preferences
        const filteredTools = parsedEnabledTools.length > 0
            ? availableTools.filter(tool => parsedEnabledTools.includes(tool.function.name))
            : availableTools;

        console.log(`🛠️ Using ${filteredTools.length} tools for model ${model}:`, filteredTools.map(t => t.function.name));

        // Initialize token tracking
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        let totalCost = 0;

        // Call OpenAI
        const completion = await openai.chat.completions.create({
            model: model,
            messages: messages,
            tools: filteredTools,
            tool_choice: "auto",
            temperature: 0.7,
            max_tokens: 3000
        });

        // Track tokens from initial completion
        if (completion.usage) {
            totalInputTokens += completion.usage.prompt_tokens || 0;
            totalOutputTokens += completion.usage.completion_tokens || 0;

            console.log(`📊 Initial API Call - Input tokens: ${completion.usage.prompt_tokens}, Output tokens: ${completion.usage.completion_tokens}`);
        }

        let response = completion.choices[0].message;
        let finalResponse = response.content;
        let toolsUsed = [];

        // Handle function calls
        if (response.tool_calls && response.tool_calls.length > 0) {
            console.log(`🔧 Processing ${response.tool_calls.length} tool calls`);

            messages.push(response);

            for (const toolCall of response.tool_calls) {
                try {
                    const toolName = toolCall.function.name;
                    const toolArgs = JSON.parse(toolCall.function.arguments);

                    console.log(`🔧 Executing tool: ${toolName}`, toolArgs);

                    const result = await callMCPTool(toolName, toolArgs);
                    toolsUsed.push(toolName);

                    messages.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        name: toolName,
                        content: result
                    });

                    console.log(`✅ Tool ${toolName} completed successfully`);
                } catch (error) {
                    console.error(`❌ Tool ${toolCall.function.name} failed:`, error);
                    messages.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        name: toolCall.function.name,
                        content: `Error executing ${toolCall.function.name}: ${error.message}`
                    });
                }
            }

            // Get final response
            const finalCompletion = await openai.chat.completions.create({
                model: model,
                messages: messages,
                tools: filteredTools,
                tool_choice: "auto",
                temperature: 0.7,
                max_tokens: 3000
            });

            let currentResponse = finalCompletion.choices[0].message;
            let maxIterations = 5; // Prevent infinite loops
            let iterations = 0;

            while (currentResponse.tool_calls && currentResponse.tool_calls.length > 0 && iterations < maxIterations) {
                iterations++;
                console.log(`🔧 Processing additional tool calls (iteration ${iterations})`);

                messages.push(currentResponse);

                for (const toolCall of currentResponse.tool_calls) {
                    try {
                        const toolName = toolCall.function.name;
                        const toolArgs = JSON.parse(toolCall.function.arguments);

                        const result = await callMCPTool(toolName, toolArgs);

                        messages.push({
                            role: "tool",
                            tool_call_id: toolCall.id,
                            name: toolName,
                            content: result
                        });
                    } catch (error) {
                        messages.push({
                            role: "tool",
                            tool_call_id: toolCall.id,
                            name: toolCall.function.name,
                            content: `Error: ${error.message}`
                        });
                    }
                }

                const nextCompletion = await openai.chat.completions.create({
                    model: model,
                    messages: messages,
                    tools: filteredTools,
                    tool_choice: "auto",
                    temperature: 0.7,
                    max_tokens: 3000
                });

                currentResponse = nextCompletion.choices[0].message;
            }

            if (finalCompletion.usage) {
                totalInputTokens += finalCompletion.usage.prompt_tokens || 0;
                totalOutputTokens += finalCompletion.usage.completion_tokens || 0;

                console.log(`📊 Final API Call - Input tokens: ${finalCompletion.usage.prompt_tokens}, Output tokens: ${finalCompletion.usage.completion_tokens}`);
            }

            finalResponse = currentResponse.content;
        }

        // Calculate estimated cost
        const modelPricing = {
            'gpt-4': { input: 0.03 / 1000, output: 0.06 / 1000 },
            'gpt-4-turbo': { input: 0.01 / 1000, output: 0.03 / 1000 },
            'gpt-3.5-turbo': { input: 0.001 / 1000, output: 0.002 / 1000 }
        };

        if (modelPricing[model]) {
            const pricing = modelPricing[model];
            totalCost = (totalInputTokens * pricing.input) + (totalOutputTokens * pricing.output);
        }

        // Print comprehensive token usage
        console.log(`📊 ===== TOKEN USAGE SUMMARY =====`);
        console.log(`🔤 Model: ${model}`);
        console.log(`📥 Total Input Tokens: ${totalInputTokens}`);
        console.log(`📤 Total Output Tokens: ${totalOutputTokens}`);
        console.log(`🔢 Total Tokens: ${totalInputTokens + totalOutputTokens}`);
        if (totalCost > 0) {
            console.log(`💰 Estimated Cost: $${totalCost.toFixed(6)}`);
        }
        console.log(`🛠️ Tools Used: ${toolsUsed.join(', ') || 'None'}`);
        console.log(`⏰ Timestamp: ${new Date().toISOString()}`);
        console.log(`================================`);

        // Save assistant message
        await Message.create({
            chatId: currentChatId,
            userId: userId,
            role: 'assistant',
            content: finalResponse,
            model: model,
            toolsUsed: toolsUsed
        });

        // Update chat timestamp
        await Chat.update(currentChatId, {});

        console.log('✅ Chat response generated successfully');

        res.json({
            response: finalResponse,
            chatId: currentChatId,
            model: model,
            timestamp: new Date().toISOString(),
            toolsUsed: toolsUsed,
            mcpReady: mcpReady,
            tokenUsage: {
                inputTokens: totalInputTokens,
                outputTokens: totalOutputTokens,
                totalTokens: totalInputTokens + totalOutputTokens,
                estimatedCost: totalCost > 0 ? totalCost : null
            }
        });

    } catch (error) {
        console.error('❌ Chat error:', error);
        res.status(500).json({
            error: 'Failed to process chat message',
            details: error.message,
            mcpReady: mcpReady
        });
    }
});
// Get chat history
app.get('/api/chat/:chatId', requireAuth, async (req, res) => {
    try {
        const { chatId } = req.params;
        const userId = req.user.id; // Fixed: use req.user instead of req.session.user

        const chat = await Chat.getWithMessages(chatId, userId);

        if (!chat) {
            return res.status(404).json({ error: 'Chat not found' });
        }

        res.json(chat);
    } catch (error) {
        console.error('Error loading chat:', error);
        res.status(500).json({ error: 'Failed to load chat' });
    }
});
// Get user chats
app.get('/api/chats/:userId', requireAuth, async (req, res) => {
    try {
        const { userId } = req.params;

        if (userId !== req.user.id) { // Fixed: use req.user instead of req.session.user
            return res.status(403).json({ error: 'Access denied' });
        }

        const chats = await Chat.findByUserId(userId);
        res.json({ chats });
    } catch (error) {
        console.error('Error getting chats:', error);
        res.status(500).json({ error: 'Failed to get chats' });
    }
});

// Delete chat
app.delete('/api/chat/:chatId', requireAuth, async (req, res) => {
    try {
        const { chatId } = req.params;
        const userId = req.user.id; // Fixed: use req.user instead of req.session.user

        // Verify chat belongs to user
        const chat = await Chat.findById(chatId);
        if (!chat || chat.user_id !== userId) {
            return res.status(404).json({ error: 'Chat not found' });
        }

        await Chat.delete(chatId);
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting chat:', error);
        res.status(500).json({ error: 'Failed to delete chat' });
    }
});

// Tools API
app.get('/api/tools', (req, res) => {
    // Ensure tools are initialized
    if (availableTools.length === 0) {
        availableTools = getAllMCPTools();
    }

    res.json({
        tools: availableTools,
        mcpReady: mcpReady,
        totalTools: availableTools.length
    });
});

// MCP Status and Control
app.get('/api/mcp/status', (req, res) => {
    res.json({
        mcpReady: mcpReady,
        processRunning: mcpProcess !== null,
        availableTools: availableTools.length,
        tools: availableTools.map(t => t.function.name),
        timestamp: new Date().toISOString()
    });
});

app.post('/api/mcp/restart', requireAuth, (req, res) => {
    console.log('🔄 Manual MCP restart requested');
    restartMCP();
    res.json({ success: true, message: 'MCP restart initiated' });
});

// User preferences
app.get('/api/user/preferences', requireAuth, async (req, res) => {
    try {
        const preferences = await User.getPreferences(req.user.id); // Fixed: use req.user instead of req.session.user
        res.json(preferences || {
            preferred_model: 'gpt-4',
            enabled_tools: [],
            settings: {}
        });
    } catch (error) {
        console.error('Error getting preferences:', error);
        res.status(500).json({ error: 'Failed to get preferences' });
    }
});

app.put('/api/user/preferences', requireAuth, async (req, res) => {
    try {
        const preferences = await User.updatePreferences(req.user.id, req.body); // Fixed: use req.user instead of req.session.user
        res.json(preferences);
    } catch (error) {
        console.error('Error updating preferences:', error);
        res.status(500).json({ error: 'Failed to update preferences' });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    // Ensure tools are initialized
    if (availableTools.length === 0) {
        availableTools = getAllMCPTools();
    }

    res.json({
        status: 'ok',
        mcpReady: mcpReady,
        availableTools: availableTools.length,
        tools: availableTools.map(t => t.function.name),
        timestamp: new Date().toISOString(),
        toolCategories: {
            'Google Drive': availableTools.filter(t => t.function.name.startsWith('drive_')).length,
            'Gmail': availableTools.filter(t => t.function.name.startsWith('gmail_')).length,
            'Calendar': availableTools.filter(t => t.function.name.startsWith('calendar_')).length,
            'Google Docs': availableTools.filter(t => t.function.name.startsWith('docs_')).length,
            'Google Sheets': availableTools.filter(t => t.function.name.startsWith('sheets_')).length,
            'File Analysis': availableTools.filter(t => ['analyze_file', 'extract_text_from_pdf', 'extract_text_from_docx', 'analyze_image', 'extract_data_from_csv', 'convert_file_format'].includes(t.function.name)).length
        }
    });
});

// File download endpoint
app.get('/api/attachments/:attachmentId/download', requireAuth, async (req, res) => {
    try {
        const { attachmentId } = req.params;
        const attachment = await Attachment.findById(attachmentId);

        if (!attachment) {
            return res.status(404).json({ error: 'Attachment not found' });
        }

        // Check if user has access to this attachment
        if (attachment.user_id !== req.user.id) { // Fixed: use req.user instead of req.session.user
            return res.status(403).json({ error: 'Access denied' });
        }

        // Get signed URL from Supabase
        const signedUrl = await Attachment.getSignedUrl(attachment.storage_path);
        res.redirect(signedUrl);
    } catch (error) {
        console.error('Error downloading attachment:', error);
        res.status(500).json({ error: 'Failed to download attachment' });
    }
});


// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, async () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔗 Frontend URL: ${process.env.FRONTEND_URL}`);
    console.log(`🔐 Google OAuth configured: ${!!GOOGLE_CLIENT_ID}`);

    // Initialize tools immediately
    availableTools = getAllMCPTools();
    console.log(`✅ Initialized ${availableTools.length} MCP tools`);

    // Initialize MCP server
    console.log('🟡 Skipping MCP startup — will initialize after user login');
});


// Graceful shutdown
process.on('SIGINT', () => {
    console.log('🛑 Shutting down server...');
    if (mcpProcess) {
        mcpProcess.kill();
    }
    process.exit(0);
});
