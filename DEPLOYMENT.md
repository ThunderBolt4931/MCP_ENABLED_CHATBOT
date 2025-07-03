# Deployment Guide for Render

This guide will walk you through deploying the AI Chatbot application on Render with separate frontend and backend services.

## Prerequisites

Before deploying, ensure you have:

1. **Render Account**: Sign up at [render.com](https://render.com)
2. **GitHub Repository**: Your code should be in a GitHub repository
3. **Google Cloud Project**: With OAuth credentials and APIs enabled
4. **OpenAI API Key**: From [OpenAI Platform](https://platform.openai.com)
5. **Supabase Project**: From [supabase.com](https://supabase.com)

## Step 1: Prepare Your Repository

1. **Push your code** to GitHub with the updated structure
2. **Ensure all environment example files** are in place:
   - `frontend/.env.example`
   - `server/.env.example`

## Step 2: Deploy Backend Service

### Create Web Service

1. **Log into Render Dashboard**
2. **Click "New +"** → **"Web Service"**
3. **Connect your GitHub repository**
4. **Configure the service:**

   ```
   Name: ai-chatbot-backend
   Environment: Node
   Region: Choose closest to your users
   Branch: main (or your default branch)
   Root Directory: (leave empty)
   Build Command: cd server && npm install && npm run install-python-deps
   Start Command: cd server && npm start
   ```

### Set Environment Variables

In the Render dashboard, add these environment variables:

```bash
NODE_ENV=production
PORT=3000
OPENAI_API_KEY=sk-your-openai-key-here
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=https://your-backend-url.onrender.com/auth/google/callback
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
SESSION_SECRET=your-random-32-character-string
FRONTEND_URL=https://your-frontend-url.onrender.com
PYTHON_PATH=/opt/render/project/src/.venv/bin/python
```

**Important Notes:**
- Replace `your-backend-url` and `your-frontend-url` with your actual Render URLs
- Generate a strong random string for `SESSION_SECRET`
- Use the service role key (not anon key) for `SUPABASE_SERVICE_ROLE_KEY`

### Deploy Backend

1. **Click "Create Web Service"**
2. **Wait for deployment** (this may take 5-10 minutes for first deploy)
3. **Note your backend URL** (e.g., `https://ai-chatbot-backend.onrender.com`)

## Step 3: Deploy Frontend Service

### Create Static Site

1. **Click "New +"** → **"Static Site"**
2. **Connect the same GitHub repository**
3. **Configure the service:**

   ```
   Name: ai-chatbot-frontend
   Branch: main (or your default branch)
   Root Directory: (leave empty)
   Build Command: cd frontend && npm install && npm run build
   Publish Directory: frontend/dist
   ```

### Set Environment Variables

Add these environment variables for the frontend:

```bash
VITE_API_URL=https://your-backend-url.onrender.com
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

**Important Notes:**
- Use your actual backend URL from Step 2
- Use the anon key (not service role key) for `VITE_SUPABASE_ANON_KEY`

### Deploy Frontend

1. **Click "Create Static Site"**
2. **Wait for deployment** (usually 2-5 minutes)
3. **Note your frontend URL** (e.g., `https://ai-chatbot-frontend.onrender.com`)

## Step 4: Update Google OAuth Settings

Now that you have your deployed URLs, update your Google Cloud Console:

1. **Go to [Google Cloud Console](https://console.cloud.google.com/)**
2. **Navigate to APIs & Services** → **Credentials**
3. **Click on your OAuth 2.0 Client ID**
4. **Update Authorized JavaScript origins:**
   ```
   https://your-frontend-url.onrender.com
   ```
5. **Update Authorized redirect URIs:**
   ```
   https://your-backend-url.onrender.com/auth/google/callback
   ```
6. **Save changes**

## Step 5: Update Environment Variables

Go back to your Render backend service and update these environment variables with the actual URLs:

```bash
GOOGLE_REDIRECT_URI=https://your-actual-backend-url.onrender.com/auth/google/callback
FRONTEND_URL=https://your-actual-frontend-url.onrender.com
```

Then update your frontend environment variables:

```bash
VITE_API_URL=https://your-actual-backend-url.onrender.com
```

## Step 6: Redeploy Services

1. **Redeploy backend service** (to pick up new environment variables)
2. **Redeploy frontend service** (to pick up new API URL)

## Step 7: Test Your Deployment

1. **Visit your frontend URL**
2. **Try logging in with Google**
3. **Test chat functionality**
4. **Verify file uploads work**
5. **Check Google Workspace integrations**

## Troubleshooting

### Common Issues

#### 1. Build Failures

**Backend build fails:**
- Check that Python dependencies can be installed
- Verify Node.js version compatibility
- Check build logs for specific errors

**Frontend build fails:**
- Ensure all environment variables are set
- Check for TypeScript errors
- Verify all dependencies are in package.json

#### 2. Authentication Issues

**Google OAuth not working:**
- Verify redirect URIs match exactly (including https://)
- Check that Google APIs are enabled
- Ensure client ID and secret are correct

**Session issues:**
- Verify SESSION_SECRET is set
- Check that cookies are working (HTTPS required)

#### 3. API Connection Issues

**Frontend can't reach backend:**
- Verify VITE_API_URL is correct
- Check CORS settings in backend
- Ensure backend is running and healthy

#### 4. Database Issues

**Supabase connection fails:**
- Verify Supabase URL and keys are correct
- Check that database tables exist
- Ensure RLS policies are properly configured

### Health Checks

Use these endpoints to verify your deployment:

- **Backend Health**: `https://your-backend-url.onrender.com/api/health`
- **MCP Status**: `https://your-backend-url.onrender.com/api/mcp/status`

### Logs

Check Render logs for debugging:

1. **Go to your service dashboard**
2. **Click on "Logs" tab**
3. **Look for error messages**
4. **Check both build and runtime logs**

## Performance Optimization

### Backend Optimization

1. **Enable auto-scaling** if needed
2. **Monitor resource usage**
3. **Consider upgrading plan** for better performance

### Frontend Optimization

1. **Enable CDN** (automatic with Render static sites)
2. **Optimize build size** by removing unused dependencies
3. **Use environment-specific builds**

## Security Considerations

1. **Use HTTPS everywhere** (automatic with Render)
2. **Keep environment variables secure**
3. **Regularly rotate secrets**
4. **Monitor for security updates**

## Maintenance

### Regular Tasks

1. **Monitor application health**
2. **Update dependencies regularly**
3. **Check logs for errors**
4. **Monitor usage and costs**

### Updating the Application

1. **Push changes to GitHub**
2. **Render will auto-deploy** (if enabled)
3. **Monitor deployment status**
4. **Test after deployment**

## Support

If you encounter issues:

1. **Check Render documentation**: [render.com/docs](https://render.com/docs)
2. **Review application logs**
3. **Check GitHub issues** for known problems
4. **Contact Render support** if needed

## Cost Optimization

### Free Tier Limitations

- **Backend**: Free tier spins down after 15 minutes of inactivity
- **Frontend**: Static sites are free with bandwidth limits
- **Consider paid plans** for production use

### Monitoring Costs

1. **Check Render dashboard** for usage
2. **Monitor bandwidth usage**
3. **Consider upgrading** for better performance and reliability