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
let currentUserId = null;
let mcpInitializationPromise = null;

// Initialize MCP Server
async function initializeMCP(userId) {
    if (!userId) {
        console.error('❌ Cannot start MCP without userId');
        return false;
    }

    console.log(`🔄 MCP initialization requested for user: ${userId}`);
    console.log(`🔄 Current MCP user: ${currentUserId}`);
    console.log(`🔄 MCP ready status: ${mcpReady}`);

    // Check if we need to switch users or reinitialize
    const needsReinitialization = !mcpReady || currentUserId !== userId || !mcpProcess;
    
    if (needsReinitialization) {
        console.log(`🔄 MCP needs reinitialization: ready=${mcpReady}, currentUser=${currentUserId}, targetUser=${userId}, process=${!!mcpProcess}`);
        
        // Reset initialization promise to force a fresh start
        mcpInitializationPromise = null;
        
        // Kill existing process if any
        if (mcpProcess) {
            console.log('🔄 Terminating existing MCP process for user switch');
            mcpProcess.kill();
            mcpProcess = null;
            mcpReady = false;
            currentUserId = null;
            availableTools = [];
            pendingResponses.clear();
        }
    } else {
        console.log('✅ MCP already initialized for current user');
        return true;
    }

    // If already initializing for this user, wait for it
    if (mcpInitializationPromise) {
        console.log('⏳ MCP initialization already in progress, waiting...');
        return mcpInitializationPromise;
    }

    mcpInitializationPromise = new Promise(async (resolve, reject) => {
        try {
            console.log(`🚀 Starting MCP initialization for user: ${userId}`);
            currentUserId = userId;

            // Find Python executable
            const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
            const mcpPath = path.join(__dirname, 'mcp_toolkit.py');

            // Verify Python file exists
            try {
                await fs.access(mcpPath);
            } catch (err) {
                throw new Error(`MCP Python file not found: ${mcpPath}`);
            }

            let tokenData;
            try {
                tokenData = await AuthToken.findByUserId(userId);
                if (!tokenData) throw new Error('No auth token found for user');
            } catch (err) {
                throw new Error(`Failed to load token from database: ${err.message}`);
            }

            const mcpEnv = {
                ...process.env,
                PYTHONUNBUFFERED: '1',
                PYTHONIOENCODING: 'utf-8',
                GOOGLE_ACCESS_TOKEN: tokenData.access_token,
                GOOGLE_REFRESH_TOKEN: tokenData.refresh_token,
                GOOGLE_TOKEN_EXPIRES_AT: new Date(tokenData.expires_at).getTime().toString(),
                GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
                GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
                SESSION_USER_ID: userId
            };

            console.log('🔐 Starting MCP with environment variables set');
            console.log('🔐 Python command:', pythonCmd);
            console.log('🔐 MCP path:', mcpPath);
            console.log('🔐 User ID:', userId);

            mcpProcess = spawn(pythonCmd, [mcpPath], {
                stdio: ['pipe', 'pipe', 'pipe'],
                env: mcpEnv,
                cwd: __dirname
            });

            let outputBuffer = '';
            let errorBuffer = '';
            let allOutput = ''; // Track all output for final check
            let servicesInitialized = {
                drive: false,
                gmail: false,
                calendar: false,
                docs: false,
                serverReady: false
            };

            // Function to check service initialization status
            const checkServiceStatus = (text) => {
                // Track service initialization
                if (text.includes('Google Drive service initialized')) {
                    servicesInitialized.drive = true;
                    console.log('✅ Drive service detected');
                }
                if (text.includes('Gmail service initialized')) {
                    servicesInitialized.gmail = true;
                    console.log('✅ Gmail service detected');
                }
                if (text.includes('Google Calendar service initialized')) {
                    servicesInitialized.calendar = true;
                    console.log('✅ Calendar service detected');
                }
                if (text.includes('Google Docs service initialized')) {
                    servicesInitialized.docs = true;
                    console.log('✅ Docs service detected');
                }
                if (text.includes('Server ready with Google Drive') || 
                    text.includes('Waiting for initialization command')) {
                    servicesInitialized.serverReady = true;
                    console.log('✅ Server ready status detected');
                }

                // Check if we can proceed with initialization
                if (servicesInitialized.drive && servicesInitialized.calendar && 
                    servicesInitialized.docs && servicesInitialized.serverReady && !mcpReady) {
                    mcpReady = true;
                    clearTimeout(initializationTimeout);
                    console.log(`✅ MCP Server is ready for user ${userId} - all essential services initialized`);

                    // Initialize handshake
                    setTimeout(async () => {
                        try {
                            await initializeMCPHandshake();
                            console.log(`✅ MCP fully initialized for user: ${userId}`);
                            resolve(true);
                        } catch (err) {
                            console.error(`❌ MCP handshake failed for user ${userId}:`, err);
                            reject(err);
                        }
                    }, 1000);
                }
            };

            let initializationTimeout = setTimeout(() => {
                console.log('⏰ MCP initialization timeout check...');
                console.log('📊 Services status:', servicesInitialized);
                console.log('📄 Recent output:', allOutput.slice(-500)); // Last 500 chars
                
                // Check if core services are ready (relaxed check)
                if (servicesInitialized.drive && servicesInitialized.calendar && 
                    servicesInitialized.docs && servicesInitialized.serverReady) {
                    console.log(`✅ MCP Server detected as ready for user ${userId} (essential services initialized)`);
                    mcpReady = true;
                    clearTimeout(initializationTimeout);
                    
                    setTimeout(async () => {
                        try {
                            await initializeMCPHandshake();
                            console.log(`✅ MCP fully initialized for user: ${userId}`);
                            resolve(true);
                        } catch (err) {
                            console.error(`❌ MCP handshake failed for user ${userId}:`, err);
                            reject(err);
                        }
                    }, 1000);
                } else {
                    console.log(`❌ MCP initialization timeout for user ${userId} - services not ready`);
                    reject(new Error(`MCP initialization timeout for user ${userId}`));
                }
            }, 25000); // 25 second timeout

            mcpProcess.stdout.on('data', (data) => {
                const dataStr = data.toString();
                outputBuffer += dataStr;
                allOutput += dataStr;
                
                const lines = outputBuffer.split('\n');
                outputBuffer = lines.pop() || '';

                for (let line of lines) {
                    if (line.trim()) {
                        console.log(`MCP Output [${userId}]:`, line);

                        // Check for service initialization in stdout
                        checkServiceStatus(line);

                        // Handle JSON responses
                        try {
                            const response = JSON.parse(line);
                            console.log(`📥 MCP JSON Response [${userId}]:`, response);

                            if (response.id && pendingResponses.has(response.id)) {
                                const { resolve: resolveReq, reject: rejectReq } = pendingResponses.get(response.id);
                                pendingResponses.delete(response.id);

                                if (response.error) {
                                    rejectReq(new Error(response.error.message || JSON.stringify(response.error)));
                                } else {
                                    resolveReq(response.result);
                                }
                            }
                        } catch (e) {
                            // Not JSON, just log
                            if (!line.includes('WARNING') && 
                                !line.includes('oauth2client') && 
                                !line.includes('DeprecationWarning') &&
                                !line.includes('file_cache is only supported')) {
                                console.log(`📄 MCP Status [${userId}]:`, line);
                            }
                        }
                    }
                }
            });

            mcpProcess.stderr.on('data', (data) => {
                const errorOutput = data.toString();
                errorBuffer += errorOutput;
                allOutput += errorOutput;
                
                // Process stderr line by line
                const lines = errorBuffer.split('\n');
                errorBuffer = lines.pop() || '';

                for (let line of lines) {
                    if (line.trim()) {
                        // Check for service initialization in stderr
                        checkServiceStatus(line);

                        // Filter out known warnings for logging
                        if (!line.includes('DeprecationWarning') &&
                            !line.includes('file_cache is only supported') &&
                            !line.includes('oauth2client')) {
                            console.log(`[MCP STDERR ${userId}]: ${line}`);
                        }
                    }
                }

                // Check for critical errors
                if (errorOutput.includes('ModuleNotFoundError') ||
                    errorOutput.includes('ImportError') ||
                    errorOutput.includes('SyntaxError')) {
                    clearTimeout(initializationTimeout);
                    reject(new Error(`MCP Python error for user ${userId}: ${errorOutput}`));
                }
            });

            mcpProcess.on('close', (code) => {
                console.log(`MCP process for user ${userId} exited with code ${code}`);
                mcpProcess = null;
                mcpReady = false;
                currentUserId = null;
                mcpInitializationPromise = null;
                clearTimeout(initializationTimeout);

                if (code !== 0) {
                    reject(new Error(`MCP process exited with code ${code}`));
                }
            });

            mcpProcess.on('error', (error) => {
                console.error(`❌ MCP process error for user ${userId}:`, error);
                mcpProcess = null;
                mcpReady = false;
                currentUserId = null;
                mcpInitializationPromise = null;
                clearTimeout(initializationTimeout);
                reject(error);
            });

        } catch (error) {
            console.error(`❌ MCP initialization error for user ${userId}:`, error);
            mcpProcess = null;
            mcpReady = false;
            currentUserId = null;
            mcpInitializationPromise = null;
            reject(error);
        }
    });

    return mcpInitializationPromise;
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
        console.log('✅ Available tools loaded');

    } catch (error) {
        console.error('❌ MCP Handshake failed:', error);
        throw error;
    }
}

function sendMCPRequest(method, params = {}) {
    return new Promise((resolve, reject) => {
        if (!mcpProcess || !mcpProcess.stdin || !mcpReady) {
            reject(new Error('MCP process not ready'));
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

        // Timeout handling
        const timeout = setTimeout(() => {
            if (pendingResponses.has(currentRequestId)) {
                pendingResponses.delete(currentRequestId);
                reject(new Error(`MCP request timeout for method: ${method}`));
            }
        }, 30000);

        // Clean up timeout on resolution
        const originalResolve = resolve;
        const originalReject = reject;

        resolve = (result) => {
            clearTimeout(timeout);
            originalResolve(result);
        };

        reject = (error) => {
            clearTimeout(timeout);
            originalReject(error);
        };

        try {
            mcpProcess.stdin.write(JSON.stringify(request) + '\n');
        } catch (error) {
            clearTimeout(timeout);
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

        // Ensure MCP is ready
        if (!mcpReady || !mcpProcess) {
            throw new Error('MCP service not ready');
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
        throw error;
    }
}


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
            name: "gmail_read_message_without_attachments",
            description: "Read email content in clean, AI-friendly format with optional attachment info",
            parameters: {
                type: "object",
                properties: {
                    message_id: {
                        type: "string",
                        description: "Gmail message ID to read"
                    },
                    include_attachments_info: {
                        type: "boolean",
                        description: "Whether to include attachment information in the response",
                        default: true
                    }
                },
                required: ["message_id"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "gmail_find_messages_with_attachments",
            description: "Find Gmail messages with attachments based on search criteria",
            parameters: {
                type: "object",
                properties: {
                    max_results: {
                        type: "integer",
                        description: "Maximum number of messages to return",
                        minimum: 1,
                        maximum: 100
                    },
                    query: {
                        type: "string",
                        description: "Custom Gmail search query (optional)"
                    },
                    sender: {
                        type: "string",
                        description: "Filter by sender email/name (optional)"
                    },
                    subject_contains: {
                        type: "string",
                        description: "Filter by subject containing text (optional)"
                    },
                    date_after: {
                        type: "string",
                        description: "Messages after date in YYYY/MM/DD format (optional)"
                    },
                    date_before: {
                        type: "string",
                        description: "Messages before date in YYYY/MM/DD format (optional)"
                    },
                    attachment_type: {
                        type: "string",
                        description: "Filter by attachment extension (pdf, xlsx, docx, etc.) (optional)",
                        enum: ["pdf", "doc", "docx", "rtf", "odt", "xls", "xlsx", "ods", "csv", "ppt", "pptx", "odp", "txt", "md", "json", "xml", "html", "css", "js", "jpg", "jpeg", "png", "gif", "bmp", "tiff", "tif", "svg", "webp", "zip", "rar", "7z", "tar", "gz", "mp3", "wav", "flac", "aac", "ogg", "mp4", "avi", "mov", "wmv", "flv", "mkv", "gdoc", "gsheet", "gslides", "gdraw", "gform", "gsite"]
                    },
                    mime_type: {
                        type: "string",
                        description: "Filter by exact MIME type (e.g., 'application/pdf') (optional)"
                    }
                },
                required: ["max_results"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "gmail_read_attachment_content",
            description: "Reads and extracts text content from a PDF, DOCX, or TXT attachment in a Gmail message. Maximum token limit: 30000 tokens",
            parameters: {
                type: "object",
                properties: {
                    message_id: {
                        type: "string",
                        description: "Gmail message ID containing the attachment"
                    },
                    attachment_id: {
                        type: "string",
                        description: "Specific attachment ID to read. If not provided, automatically uses the first supported attachment found (optional)"
                    }
                },
                required: ["message_id"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "gmail_search_and_summarize",
            description: "Search emails with clean, summarized results",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "General search query (optional)"
                    },
                    sender: {
                        type: "string",
                        description: "Filter by sender email/name (optional)"
                    },
                    recipient: {
                        type: "string",
                        description: "Filter by recipient email/name (optional)"
                    },
                    subject_contains: {
                        type: "string",
                        description: "Filter by subject containing text (optional)"
                    },
                    max_results: {
                        type: "integer",
                        description: "Maximum number of messages to return",
                        default: 10,
                        minimum: 1,
                        maximum: 50
                    }
                },
                required: []
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
            name: "gmail_list_messages",
            description: "List recent emails with clean, AI-friendly format",
            parameters: {
                type: "object",
                properties: {
                    max_results: {
                        type: "integer",
                        description: "Maximum number of messages to return",
                        default: 10,
                        minimum: 1,
                        maximum: 100
                    },
                    query: {
                        type: "string",
                        description: "Gmail search query to filter messages (optional)"
                    }
                },
                required: []
            }
        }
    },
    {
        type: "function",
        function: {
            name: "gmail_modify_labels",
            description: "Add or remove labels from an email message",
            parameters: {
                type: "object",
                properties: {
                    message_id: {
                        type: "string",
                        description: "Gmail message ID to modify"
                    },
                    add_labels: {
                        type: "array",
                        items: { type: "string" },
                        description: "Array of label IDs to add to the message (optional)"
                    },
                    remove_labels: {
                        type: "array",
                        items: { type: "string" },
                        description: "Array of label IDs to remove from the message (optional)"
                    }
                },
                required: ["message_id"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "gmail_delete_message",
            description: "Delete an email message permanently",
            parameters: {
                type: "object",
                properties: {
                    message_id: {
                        type: "string",
                        description: "Gmail message ID to delete"
                    }
                },
                required: ["message_id"]
            }
        }
    },

    // Google Calendar Tools (3 tools)
    {
        type: "function",
        function: {
            name: "calendar_create_event_with_invitations",
            description: "Create a calendar event and automatically send invitations to attendees",
            parameters: {
                type: "object",
                properties: {
                    summary: { 
                        type: "string", 
                        description: "Event title" 
                    },
                    startTime: { 
                        type: "string", 
                        description: "RFC3339 start time (e.g., '2024-01-15T10:00:00Z')" 
                    },
                    endTime: { 
                        type: "string", 
                        description: "RFC3339 end time (e.g., '2024-01-15T11:00:00Z')" 
                    },
                    attendees: { 
                        type: "array", 
                        items: { type: "string" },
                        description: "List of attendee emails (optional)" 
                    },
                    location: { 
                        type: "string", 
                        description: "Event location (optional)" 
                    },
                    description: { 
                        type: "string", 
                        description: "Event description (optional)" 
                    },
                    send_invitations: { 
                        type: "boolean", 
                        description: "Whether to send email invitations (default: true)",
                        default: true
                    }
                },
                required: ["summary", "startTime", "endTime"]
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
    }

];


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
            'https://www.googleapis.com/auth/gmail.compose',
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
                        preferred_model: 'gpt-4o-mini',
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
app.post('/api/chat', requireAuth, upload.array('attachments', 5), async (req, res) => {
    try {
        const { message, chatId, model = 'gpt-4', enabledTools = '[]' } = req.body;
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

        // Ensure MCP is initialized for this user
        try {
            if (!mcpReady || currentUserId !== userId) {
                console.log('🔄 Initializing MCP for user:', userId);
                await initializeMCP(userId);
            }
        } catch (mcpError) {
            console.error('❌ MCP initialization failed:', mcpError);
            // Continue without MCP tools
            console.log('⚠️ Continuing without MCP tools');
        }

        // Initialize tools
        if (availableTools.length === 0) {
            console.log('🔧 Loading fallback tools...');
            availableTools = getAllMCPTools();
            console.log(`✅ Loaded ${availableTools.length} fallback tools`);
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
                    messageId: null,
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
- MCP Status: ${mcpReady ? 'Ready' : 'Not Ready'}

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
        console.log(`🔧 MCP Ready: ${mcpReady}`);

        // Parse enabled tools
        let parsedEnabledTools = [];
        try {
            parsedEnabledTools = JSON.parse(enabledTools);
        } catch (e) {
            console.warn('Failed to parse enabled tools:', e);
        }

        // Filter available tools based on enabled tools and MCP status
        let filteredTools = [];
        if (mcpReady && availableTools.length > 0) {
            filteredTools = parsedEnabledTools.length > 0
                ? availableTools.filter(tool => parsedEnabledTools.includes(tool.function.name))
                : availableTools;
        }

        console.log(`🛠️ Using ${filteredTools.length} tools for model ${model}:`, filteredTools.map(t => t.function.name));

        // Initialize token tracking
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        let totalCost = 0;

        // Call OpenAI
        const completion = await openai.chat.completions.create({
            model: model,
            messages: messages,
            tools: filteredTools.length > 0 ? filteredTools : undefined,
            tool_choice: filteredTools.length > 0 ? "auto" : undefined,
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

        // Handle function calls (only if MCP is ready)
        if (response.tool_calls && response.tool_calls.length > 0 && mcpReady) {
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

            // Get final response after tool calls
            const finalCompletion = await openai.chat.completions.create({
                model: model,
                messages: messages,
                tools: filteredTools.length > 0 ? filteredTools : undefined,
                tool_choice: filteredTools.length > 0 ? "auto" : undefined,
                temperature: 0.7,
                max_tokens: 3000
            });

            if (finalCompletion.usage) {
                totalInputTokens += finalCompletion.usage.prompt_tokens || 0;
                totalOutputTokens += finalCompletion.usage.completion_tokens || 0;
                console.log(`📊 Final API Call - Input tokens: ${finalCompletion.usage.prompt_tokens}, Output tokens: ${finalCompletion.usage.completion_tokens}`);
            }

            finalResponse = finalCompletion.choices[0].message.content;
        } else if (response.tool_calls && response.tool_calls.length > 0 && !mcpReady) {
            // If tools were called but MCP is not ready
            finalResponse = "I notice you're trying to use Google Workspace tools, but the MCP service is not currently available. Please try again in a moment, or ask me something else I can help with.";
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
        console.log(`🔧 MCP Status: ${mcpReady ? 'Ready' : 'Not Ready'}`);
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
