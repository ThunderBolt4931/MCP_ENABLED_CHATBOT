# Frontend Deployment Guide for Render

## Step-by-Step Frontend Deployment on Render

### 1. Create a Static Site on Render

1. **Log into your Render Dashboard**
2. **Click "New +"** in the top right corner
3. **Select "Static Site"** from the dropdown menu
4. **Connect your GitHub repository** (the same repo that contains your frontend folder)

### 2. Configure the Static Site

Fill in the following configuration:

```
Name: ai-chatbot-frontend
Environment: Static Site
Branch: main (or your default branch)
Root Directory: (leave empty - Render will find the frontend folder)
Build Command: cd frontend && npm install && npm run build
Publish Directory: frontend/dist
Auto-Deploy: Yes (recommended)
```

**Important Details:**
- **Build Command**: `cd frontend && npm install && npm run build`
  - This navigates to the frontend folder, installs dependencies, and builds the React app
- **Publish Directory**: `frontend/dist`
  - This is where Vite outputs the built static files
- **Auto-Deploy**: Enable this so your frontend updates automatically when you push to GitHub

### 3. Set Environment Variables

Before deploying, add these environment variables in the Render dashboard:

```bash
VITE_API_URL=https://your-backend-url.onrender.com
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key_here
```

**How to add environment variables:**
1. In your static site settings, scroll down to "Environment Variables"
2. Click "Add Environment Variable"
3. Add each variable one by one

**Important Notes:**
- Replace `your-backend-url` with your actual backend service URL from Render
- Replace `your-project-id` with your actual Supabase project ID
- Use the **anon key** (not service role key) for the frontend

### 4. Deploy the Frontend

1. **Click "Create Static Site"**
2. **Render will start building your frontend**
3. **Wait for the build to complete** (usually 2-5 minutes)
4. **Your frontend will be available** at a URL like `https://ai-chatbot-frontend.onrender.com`

### 5. Update Backend Environment Variables

Once your frontend is deployed, update your backend's environment variables:

1. **Go to your backend service** in Render dashboard
2. **Update the FRONTEND_URL variable:**
   ```bash
   FRONTEND_URL=https://your-actual-frontend-url.onrender.com
   ```
3. **Save and redeploy** the backend service

### 6. Test Your Frontend

1. **Visit your frontend URL**
2. **Check that it loads properly**
3. **Try the login functionality**
4. **Verify it can communicate with your backend**

## Frontend Build Process Explained

### What Happens During Build

1. **Render runs**: `cd frontend && npm install && npm run build`
2. **npm install**: Downloads all React dependencies
3. **npm run build**: Vite builds your React app into static files
4. **Output**: Creates optimized HTML, CSS, and JS files in `frontend/dist`
5. **Render serves**: The static files from the `frontend/dist` directory

### Build Command Breakdown

```bash
cd frontend          # Navigate to frontend directory
npm install          # Install dependencies (React, Vite, etc.)
npm run build        # Run Vite build process
```

The `npm run build` command runs Vite's build process which:
- Bundles your React components
- Optimizes CSS and JavaScript
- Creates production-ready static files
- Outputs everything to `frontend/dist`

## Troubleshooting Frontend Deployment

### Common Build Issues

**1. Build Command Fails**
```
Error: Cannot find module 'react'
```
**Solution**: Make sure your `frontend/package.json` includes all dependencies

**2. Environment Variables Not Working**
```
Error: VITE_API_URL is undefined
```
**Solution**: 
- Ensure environment variables are set in Render dashboard
- Variables must start with `VITE_` for Vite to include them
- Redeploy after adding environment variables

**3. 404 Errors on Page Refresh**
```
Cannot GET /chat/123
```
**Solution**: Add a `_redirects` file for React Router:

```bash
# Add this file: frontend/public/_redirects
/*    /index.html   200
```

### Checking Build Logs

1. **Go to your static site** in Render dashboard
2. **Click on "Events" tab**
3. **Look for build logs** to see what went wrong
4. **Common issues**: Missing dependencies, environment variable problems

### Manual Build Test

Test your build locally before deploying:

```bash
cd frontend
npm install
npm run build
npm run preview  # Test the built version locally
```

## Frontend Deployment Checklist

- [ ] Repository pushed to GitHub
- [ ] Static site created on Render
- [ ] Build command set: `cd frontend && npm install && npm run build`
- [ ] Publish directory set: `frontend/dist`
- [ ] Environment variables added (VITE_API_URL, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)
- [ ] Build completed successfully
- [ ] Frontend URL noted and working
- [ ] Backend FRONTEND_URL updated
- [ ] Google OAuth redirect URIs updated
- [ ] Login and chat functionality tested

## Frontend vs Backend Deployment

| Aspect | Frontend (Static Site) | Backend (Web Service) |
|--------|----------------------|---------------------|
| **Type** | Static Site | Web Service |
| **Build** | `npm run build` | `npm install` |
| **Output** | Static files (HTML/CSS/JS) | Running Node.js server |
| **Hosting** | CDN/Static hosting | Server instance |
| **Environment** | Build-time variables (VITE_*) | Runtime variables |
| **Scaling** | Automatic (CDN) | Manual/Auto scaling |

## Next Steps After Frontend Deployment

1. **Update Google OAuth settings** with your new frontend URL
2. **Test the complete flow**: Login → Chat → File upload
3. **Monitor performance** and errors
4. **Set up custom domain** (optional, requires paid plan)

Your frontend should now be successfully deployed and communicating with your backend!