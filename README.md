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

## 🛠️ Deployment on Render

This project is configured for easy deployment on Render with separate frontend and backend services.

### Prerequisites
- Render account
- Google Cloud Console project with APIs enabled
- OpenAI API key
- Supabase project

### 1. Deploy Backend

1. **Create a new Web Service** on Render
2. **Connect your repository**
3. **Configure the service:**
   - **Name**: `ai-chatbot-backend`
   - **Environment**: `Node`
   - **Build Command**: `cd server && npm install && npm run install-python-deps`
   - **Start Command**: `cd server && npm start`
   - **Auto-Deploy**: Yes

4. **Set Environment Variables:**
   ```
   NODE_ENV=production
   PORT=3000
   OPENAI_API_KEY=your_openai_api_key_here
   GOOGLE_CLIENT_ID=your_google_client_id_here
   GOOGLE_CLIENT_SECRET=your_google_client_secret_here
   GOOGLE_REDIRECT_URI=https://your-backend-url.onrender.com/auth/google/callback
   SUPABASE_URL=your_supabase_url_here
   SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here
   SESSION_SECRET=your_random_session_secret_here
   FRONTEND_URL=https://your-frontend-url.onrender.com
   PYTHON_PATH=/opt/render/project/src/.venv/bin/python
   ```

### 2. Deploy Frontend

1. **Create a new Static Site** on Render
2. **Connect your repository**
3. **Configure the service:**
   - **Name**: `ai-chatbot-frontend`
   - **Build Command**: `cd frontend && npm install && npm run build`
   - **Publish Directory**: `frontend/dist`
   - **Auto-Deploy**: Yes

4. **Set Environment Variables:**
   ```
   VITE_API_URL=https://your-backend-url.onrender.com
   VITE_SUPABASE_URL=your_supabase_url_here
   VITE_SUPABASE_ANON_KEY=your_supabase_anon_key_here
   ```

### 3. Update Google OAuth Settings

After deployment, update your Google Cloud Console OAuth settings:

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to **APIs & Services** → **Credentials**
3. Edit your OAuth 2.0 Client ID
4. Add your Render backend URL to **Authorized redirect URIs**:
   ```
   https://your-backend-url.onrender.com/auth/google/callback
   ```
5. Add your frontend URL to **Authorized JavaScript origins**:
   ```
   https://your-frontend-url.onrender.com
   ```

## 🔧 Local Development

### Prerequisites
- Node.js 18+ and npm
- Python 3.8+ and pip
- Google Cloud Console project with APIs enabled
- OpenAI API key
- Supabase project

### 1. Clone and Install Dependencies

```bash
# Install all dependencies
npm run install:all

# Or install separately:
npm install
cd frontend && npm install
cd ../server && npm install
```

### 2. Environment Configuration

Create environment files from examples:

```bash
# Frontend
cp frontend/.env.example frontend/.env

# Backend
cp server/.env.example server/.env
```

Fill in your actual values in both `.env` files.

### 3. Install Python Dependencies

```bash
cd server
npm run install-python-deps
```

### 4. Run the Application

```bash
# Start both frontend and backend
npm run dev

# Or run separately:
# Terminal 1 - Backend
npm run dev:backend

# Terminal 2 - Frontend
npm run dev:frontend
```

The application will be available at:
- Frontend: http://localhost:5173
- Backend: http://localhost:3000

## 🔧 Architecture

### Project Structure
```
├── frontend/          # React frontend application
│   ├── src/
│   ├── package.json
│   └── .env.example
├── server/           # Express.js backend
│   ├── models/       # Database models
│   ├── services/     # Business logic
│   ├── middleware/   # Express middleware
│   ├── config/       # Configuration files
│   ├── mcp_toolkit.py # Python MCP server (DO NOT MODIFY)
│   ├── package.json
│   └── .env.example
├── package.json      # Root package.json for development
└── render.yaml       # Render deployment configuration
```

### Frontend Structure
```
frontend/src/
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
├── models/           # Supabase database models
├── services/         # File upload, parsing services
├── middleware/       # Upload middleware
├── config/           # Supabase configuration
├── server.js         # Express server with OAuth and chat endpoints
└── mcp_toolkit.py    # Python MCP server for Google Workspace
```

## 🔐 Authentication Flow

1. User clicks "Sign in with Google"
2. Redirected to Google OAuth consent screen
3. After approval, redirected back with authorization code
4. Backend exchanges code for access/refresh tokens
5. Tokens saved to Supabase for MCP toolkit
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
1. Add tool function to `server/mcp_toolkit.py` (DO NOT MODIFY - this file should remain unchanged)
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

### Backend (.env)
| Variable | Description | Required |
|----------|-------------|----------|
| `OPENAI_API_KEY` | OpenAI API key for GPT-4 | Yes |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | Yes |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | Yes |
| `GOOGLE_REDIRECT_URI` | OAuth redirect URI | Yes |
| `SUPABASE_URL` | Supabase project URL | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key | Yes |
| `SESSION_SECRET` | Session encryption secret | Yes |
| `FRONTEND_URL` | Frontend URL for CORS | Yes |
| `PORT` | Server port (default: 3000) | No |

### Frontend (.env)
| Variable | Description | Required |
|----------|-------------|----------|
| `VITE_API_URL` | Backend API URL | Yes |
| `VITE_SUPABASE_URL` | Supabase project URL | Yes |
| `VITE_SUPABASE_ANON_KEY` | Supabase anonymous key | Yes |

## 🚀 Production Considerations

### Security
- All sensitive data stored in environment variables
- Session-based authentication with secure cookies
- CORS properly configured for production domains
- File upload restrictions and validation

### Performance
- Frontend built as static assets for CDN delivery
- Backend optimized for serverless deployment
- Database queries optimized with proper indexing
- File uploads handled through Supabase Storage

### Monitoring
- Health check endpoints available
- Comprehensive error logging
- MCP server status monitoring

## 🔍 Troubleshooting

### Common Issues

1. **MCP Server Not Ready**
   - Check Python dependencies are installed on Render
   - Verify Google credentials in environment variables
   - Check Supabase token storage

2. **Authentication Errors**
   - Verify Google OAuth redirect URI matches exactly
   - Check Google Cloud Console API enablement
   - Ensure session secret is set

3. **CORS Errors**
   - Verify FRONTEND_URL is set correctly in backend
   - Check that frontend is using correct API_URL

4. **File Upload Issues**
   - Verify Supabase Storage bucket is configured
   - Check file size limits and allowed types

### Debug Endpoints
- `GET /api/health` - Check server and MCP status
- `GET /api/mcp/status` - Detailed MCP server information
- `POST /api/mcp/restart` - Force restart MCP server

## 📄 License

MIT License - see LICENSE file for details.