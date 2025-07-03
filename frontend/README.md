# AI-Powered Chatbot with Google Workspace Integration

A modern, production-ready chatbot application with Google OAuth authentication and comprehensive Google Workspace integration (Drive, Gmail, Calendar).

## 🚀 Features

### Frontend
- **Modern React UI** with TypeScript and Tailwind CSS
- **Split-screen login** with Google OAuth integration
- **Real-time chat interface** with typing indicators
- **Responsive design** that works on all devices
- **Chat history** and session management
- **Clean, professional design** with smooth animations

### Backend
- **Express.js server** with session-based authentication
- **OpenAI GPT-4 integration** for intelligent responses
- **MCP (Model Context Protocol)** for Google Workspace tools
- **Comprehensive Google APIs** integration:
  - **Google Drive**: Search, read, create, edit, share files
  - **Gmail**: Send emails, read messages, manage labels
  - **Google Calendar**: Create events, check availability, manage schedules

## 🛠️ Setup Instructions

### Prerequisites
- Node.js 18+ and npm
- Python 3.8+ and pip
- Google Cloud Console project with APIs enabled
- OpenAI API key

### 1. Clone and Install Dependencies

```bash
# Install frontend dependencies
npm install

# Install backend dependencies
cd server
npm install

# Install Python dependencies for MCP toolkit
npm run install-python-deps
```

### 2. Google Cloud Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable the following APIs:
   - Google Drive API
   - Gmail API
   - Google Calendar API
   - Google Docs API
4. Create OAuth 2.0 credentials:
   - Go to "Credentials" → "Create Credentials" → "OAuth 2.0 Client IDs"
   - Application type: Web application
   - Authorized redirect URIs: `http://localhost:3000/auth/google/callback`
5. Download the credentials JSON file

### 3. Environment Configuration

Create `server/.env` file:

```env
# OpenAI Configuration
OPENAI_API_KEY=your_openai_api_key_here

# Google OAuth Configuration
GOOGLE_CLIENT_ID=your_google_client_id_here
GOOGLE_CLIENT_SECRET=your_google_client_secret_here
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback

# Session Configuration
SESSION_SECRET=your_random_session_secret_here

# Server Configuration
PORT=3000
NODE_ENV=development
```

### 4. Run the Application

```bash
# Start both frontend and backend
npm run dev:full

# Or run separately:
# Terminal 1 - Backend
npm run server

# Terminal 2 - Frontend
npm run dev
```

The application will be available at:
- Frontend: http://localhost:5173
- Backend: http://localhost:3000

## 🔧 Architecture

### Frontend Structure
```
src/
├── components/
│   ├── auth/          # Login and authentication
│   ├── chat/          # Chat interface and sidebar
│   └── ui/            # Reusable UI components
├── services/          # API communication
├── store/             # Zustand state management
└── App.tsx           # Main application component
```

### Backend Structure
```
server/
├── server.js         # Express server with OAuth and chat endpoints
├── mcp_toolkit.py    # Python MCP server for Google Workspace
└── chats/            # File-based chat storage
```

## 🔐 Authentication Flow

1. User clicks "Sign in with Google"
2. Redirected to Google OAuth consent screen
3. After approval, redirected back with authorization code
4. Backend exchanges code for access/refresh tokens
5. Tokens saved to `token.json` for MCP toolkit
6. User session established with cookies
7. MCP server automatically restarts with new credentials

## 🛠️ Google Workspace Tools

The chatbot has access to powerful Google Workspace tools:

### Google Drive
- Search files by content
- Read document contents (Docs, PDFs, text files)
- Create new documents with markdown formatting
- Edit existing files
- Share files with specific users
- Manage folders and file organization

### Gmail
- List and search emails
- Read full email content
- Send emails with attachments
- Manage labels and organization
- Send emails with Google Drive file links

### Google Calendar
- List upcoming events
- Create events with attendees
- Check availability/free-busy times
- Update and delete events
- Send calendar invitations

## 🎯 Usage Examples

### Creating and Sharing Documents
```
"Create a project proposal document and share it with john@company.com"
```

### Email Management
```
"Find all emails from Sarah last week and summarize them"
```

### Calendar Scheduling
```
"Schedule a team meeting for tomorrow at 2 PM and invite the development team"
```

### Multi-step Workflows
```
"Create a meeting agenda, schedule the meeting, and email the agenda to all attendees"
```

## 🔧 Development

### Adding New Tools
1. Add tool function to `server/mcp_toolkit.py`
2. Use `@mcp.tool()` decorator
3. Update tool descriptions in `server/server.js` fallback list
4. Restart the MCP server

### Frontend Development
- Uses Vite for fast development
- TypeScript for type safety
- Tailwind CSS for styling
- Zustand for state management

### Backend Development
- Express.js with session middleware
- OpenAI function calling for tool integration
- MCP protocol for Google Workspace communication

## 📝 Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `OPENAI_API_KEY` | OpenAI API key for GPT-4 | Yes |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | Yes |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | Yes |
| `GOOGLE_REDIRECT_URI` | OAuth redirect URI | Yes |
| `SESSION_SECRET` | Session encryption secret | Yes |
| `PORT` | Server port (default: 3000) | No |

## 🚀 Production Deployment

### Frontend
- Build: `npm run build`
- Deploy `dist/` folder to static hosting (Vercel, Netlify)
- Update API base URL in production

### Backend
- Deploy to cloud platform (Railway, Render, Heroku)
- Set environment variables
- Ensure Python dependencies are installed
- Update CORS origins for production frontend URL

## 🔍 Troubleshooting

### Common Issues

1. **MCP Server Not Ready**
   - Check Python dependencies are installed
   - Verify Google credentials in `.env`
   - Check `token.json` exists after OAuth

2. **Authentication Errors**
   - Verify Google OAuth redirect URI matches exactly
   - Check Google Cloud Console API enablement
   - Ensure session secret is set

3. **Tool Execution Failures**
   - Check Google API quotas and limits
   - Verify user has necessary permissions
   - Check MCP server logs for detailed errors

### Debug Endpoints
- `GET /api/health` - Check server and MCP status
- `GET /api/mcp/status` - Detailed MCP server information
- `POST /api/mcp/restart` - Force restart MCP server

## 📄 License

MIT License - see LICENSE file for details.