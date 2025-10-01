const express = require('express');
const session = require('express-session');
const axios = require('axios');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 5000;

// Trust proxy for Render
app.set('trust proxy', 1);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Enhanced session configuration for Render
app.use(session({
    secret: process.env.SESSION_SECRET || 'instagram-dm-automation-secret-key-2024',
    resave: true,
    saveUninitialized: true,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        httpOnly: true
    },
    proxy: true
}));

// In-memory storage (replace with database in production)
const users = new Map();
const posts = new Map();
const hotwords = new Map();
const dmLogs = new Map();

// Instagram Business API Configuration
const INSTAGRAM_CONFIG = {
    clientId: process.env.INSTAGRAM_CLIENT_ID || '1477959410285896',
    clientSecret: process.env.INSTAGRAM_CLIENT_SECRET,
    redirectUri: process.env.REDIRECT_URI || 'https://instagram-automation-render.onrender.com/auth/callback',
    scope: 'instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments,instagram_business_content_publish,instagram_business_manage_insights'
};

// Utility functions
function generateRandomId() {
    return crypto.randomBytes(16).toString('hex');
}

function logAction(userId, action, details) {
    console.log(`[${new Date().toISOString()}] User ${userId}: ${action}`, details);
}

// Start background comment monitoring
function startCommentMonitoring() {
    setInterval(() => {
        monitorComments();
    }, 30000); // Check every 30 seconds
}

// Monitor comments for all users
async function monitorComments() {
    for (const [userId, userData] of users.entries()) {
        try {
            await checkUserComments(userId, userData);
        } catch (error) {
            console.error(`Error monitoring comments for user ${userId}:`, error.message);
        }
    }
}

// Check comments for a specific user
async function checkUserComments(userId, userData) {
    const userPosts = posts.get(userId) || new Map();
    const userHotwords = hotwords.get(userId) || new Map();
    
    if (userPosts.size === 0) return;

    try {
        // Get user's media from Instagram Business Account
        const mediaResponse = await axios.get(`https://graph.facebook.com/v19.0/${userData.igBusinessAccountId}/media`, {
            params: {
                fields: 'id,caption,media_type,media_url,permalink,thumbnail_url,timestamp,comments_count,like_count',
                access_token: userData.accessToken,
                limit: 20
            }
        });

        for (const post of mediaResponse.data.data) {
            await processPostComments(userId, userData, post, userHotwords);
        }
    } catch (error) {
        console.error(`Error fetching media for user ${userId}:`, error.response?.data || error.message);
    }
}

// Process comments for a specific post
async function processPostComments(userId, userData, post, userHotwords) {
    const postHotwords = userHotwords.get(post.id) || [];
    if (postHotwords.length === 0) return;

    try {
        // Get comments for this post using Instagram Business API
        const commentsResponse = await axios.get(`https://graph.facebook.com/v19.0/${post.id}/comments`, {
            params: {
                fields: 'id,text,username,timestamp,from',
                access_token: userData.accessToken
            }
        });

        for (const comment of commentsResponse.data.data) {
            await processComment(userId, userData, post, comment, postHotwords);
        }
    } catch (error) {
        console.error(`Error fetching comments for post ${post.id}:`, error.response?.data || error.message);
    }
}

// Process individual comment
async function processComment(userId, userData, post, comment, postHotwords) {
    const commentText = comment.text.toLowerCase();
    const commentId = comment.id;
    
    // Check if we already processed this comment
    const userLogs = dmLogs.get(userId) || [];
    const alreadyProcessed = userLogs.some(log => 
        log.commentId === commentId && log.postId === post.id
    );
    
    if (alreadyProcessed) return;

    // Check for matching hotwords
    for (const hotwordConfig of postHotwords) {
        if (commentText.includes(hotwordConfig.word.toLowerCase())) {
            await sendAutomatedDM(userId, userData, comment, post, hotwordConfig);
            break; // Only send one DM per comment
        }
    }
}

// Send automated DM using Instagram Business API
async function sendAutomatedDM(userId, userData, comment, post, hotwordConfig) {
    try {
        // Get the commenter's Instagram user ID
        const commenterId = comment.from?.id;
        
        if (!commenterId) {
            console.log('No commenter ID found');
            return;
        }

        // Send DM using Instagram Business API
        // Note: This requires the instagram_business_manage_messages permission
        const dmResponse = await axios.post(`https://graph.facebook.com/v19.0/${userData.igBusinessAccountId}/messages`, null, {
            params: {
                access_token: userData.accessToken,
                recipient: `{"comment_id":"${comment.id}"}`,
                message: `{"text":"${hotwordConfig.dmMessage}"}`
            }
        });

        console.log(`📨 DM sent to ${comment.username}: ${hotwordConfig.dmMessage}`);
        
        // Log the action
        const logEntry = {
            id: generateRandomId(),
            timestamp: new Date().toISOString(),
            postId: post.id,
            postCaption: post.caption ? post.caption.substring(0, 100) + '...' : 'No caption',
            commentId: comment.id,
            commentText: comment.text,
            commenter: comment.username,
            commenterId: commenterId,
            hotword: hotwordConfig.word,
            dmMessage: hotwordConfig.dmMessage,
            status: 'sent',
            messageId: dmResponse.data.message_id
        };
        
        const userLogs = dmLogs.get(userId) || [];
        userLogs.unshift(logEntry);
        dmLogs.set(userId, userLogs);
        
        logAction(userId, 'DM_SENT', {
            postId: post.id,
            commenter: comment.username,
            hotword: hotwordConfig.word,
            messageId: dmResponse.data.message_id
        });
        
    } catch (error) {
        console.error('Error sending DM:', error.response?.data || error.message);
        
        // Log failure
        const logEntry = {
            id: generateRandomId(),
            timestamp: new Date().toISOString(),
            postId: post.id,
            commentId: comment.id,
            commentText: comment.text,
            commenter: comment.username,
            hotword: hotwordConfig.word,
            dmMessage: hotwordConfig.dmMessage,
            status: 'failed',
            error: error.response?.data?.error?.message || error.message
        };
        
        const userLogs = dmLogs.get(userId) || [];
        userLogs.unshift(logEntry);
        dmLogs.set(userId, userLogs);
    }
}

// Routes

// Serve main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check endpoint for Render
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        users: users.size,
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// Instagram Business OAuth - Start authentication
app.get('/auth/instagram', (req, res) => {
    // Validate Instagram config
    if (!INSTAGRAM_CONFIG.clientId || !INSTAGRAM_CONFIG.clientSecret) {
        return res.status(500).send(`
            <html>
                <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                    <h2>Configuration Error</h2>
                    <p>Instagram OAuth is not properly configured.</p>
                    <p>Please set INSTAGRAM_CLIENT_ID and INSTAGRAM_CLIENT_SECRET environment variables.</p>
                    <a href="/">Return to home</a>
                </body>
            </html>
        `);
    }

    // Clear previous state to prevent conflicts
    const previousState = req.session.oauthState;
    req.session.oauthState = null;
    
    const state = generateRandomId();
    req.session.oauthState = state;
    
    // Save session immediately before redirect
    req.session.save((err) => {
        if (err) {
            console.error('Session save error:', err);
            return res.status(500).send('Session error - please try again');
        }
        
        const authUrl = `https://www.instagram.com/oauth/authorize?` +
            `force_reauth=true` +
            `&client_id=${INSTAGRAM_CONFIG.clientId}` +
            `&redirect_uri=${encodeURIComponent(INSTAGRAM_CONFIG.redirectUri)}` +
            `&response_type=code` +
            `&scope=${encodeURIComponent(INSTAGRAM_CONFIG.scope)}` +
            `&state=${state}`;
        
        console.log('🔐 OAuth Initiated:', {
            previousState: previousState,
            newState: state,
            clientId: INSTAGRAM_CONFIG.clientId,
            redirectUri: INSTAGRAM_CONFIG.redirectUri
        });
        
        res.redirect(authUrl);
    });
});

// Instagram Business OAuth - Callback
app.get('/auth/callback', async (req, res) => {
    const { code, state, error } = req.query;
    
    console.log('🔐 OAuth Callback Received:', {
        code: code ? 'present' : 'missing',
        state: state,
        sessionState: req.session.oauthState,
        error: error
    });
    
    if (error) {
        return res.status(400).send(`
            <html>
                <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                    <h2>Authorization Failed</h2>
                    <p>Error: ${error}</p>
                    <a href="/">Return to home</a>
                </body>
            </html>
        `);
    }
    
    // Enhanced state validation with debugging
    if (!state) {
        console.error('❌ No state parameter received');
        return res.status(400).send('Missing state parameter');
    }
    
    if (!req.session.oauthState) {
        console.error('❌ No state in session');
        return res.status(400).send(`
            <html>
                <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                    <h2>Session Expired</h2>
                    <p>Your session has expired. Please return to the home page and try again.</p>
                    <a href="/">Return to home</a>
                </body>
            </html>
        `);
    }
    
    if (state !== req.session.oauthState) {
        console.error('❌ State mismatch:', {
            received: state,
            expected: req.session.oauthState,
            sessionId: req.sessionID
        });
        return res.status(400).send(`
            <html>
                <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                    <h2>Security Error - State Mismatch</h2>
                    <p>This may be due to:</p>
                    <ul style="text-align: left; display: inline-block;">
                        <li>Opening multiple login windows</li>
                        <li>Browser cookie restrictions</li>
                        <li>Session timeout</li>
                    </ul>
                    <p>Please <a href="/">return to home</a> and try again.</p>
                </body>
            </html>
        `);
    }
    
    // Clear the state after successful validation
    req.session.oauthState = null;
    
    try {
        console.log('🔄 Exchanging code for access token...');
        
        // Exchange code for access token
        const tokenResponse = await axios.post('https://api.instagram.com/oauth/access_token', 
            new URLSearchParams({
                client_id: INSTAGRAM_CONFIG.clientId,
                client_secret: INSTAGRAM_CONFIG.clientSecret,
                grant_type: 'authorization_code',
                redirect_uri: INSTAGRAM_CONFIG.redirectUri,
                code: code
            }), {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                timeout: 10000
            }
        );
        
        const { access_token, user_id } = tokenResponse.data;
        console.log('✅ Access token received for user:', user_id);
        
        // Get Facebook pages to find Instagram Business account
        const pagesResponse = await axios.get(`https://graph.facebook.com/v19.0/me/accounts`, {
            params: {
                access_token: access_token,
                fields: 'id,name,access_token,instagram_business_account{id,username,profile_picture_url}'
            }
        });

        const pageWithInstagram = pagesResponse.data.data.find(page => page.instagram_business_account);
        
        if (!pageWithInstagram) {
            return res.status(400).send(`
                <html>
                    <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                        <h2>No Instagram Business Account Found</h2>
                        <p>Please make sure:</p>
                        <ol style="text-align: left; display: inline-block;">
                            <li>Your Instagram account is connected to a Facebook Page</li>
                            <li>The Facebook Page has an Instagram Business account</li>
                            <li>You have the necessary permissions</li>
                        </ol>
                        <a href="/">Return to home</a>
                    </body>
                </html>
            `);
        }

        const userData = {
            id: user_id,
            username: pageWithInstagram.instagram_business_account.username,
            accessToken: pageWithInstagram.access_token,
            pageId: pageWithInstagram.id,
            igBusinessAccountId: pageWithInstagram.instagram_business_account.id,
            profilePicture: pageWithInstagram.instagram_business_account.profile_picture_url,
            connectedAt: new Date().toISOString()
        };
        
        // Store user data
        users.set(user_id, userData);
        req.session.userId = user_id;
        req.session.username = userData.username;
        
        // Initialize user data structures
        if (!posts.has(user_id)) posts.set(user_id, new Map());
        if (!hotwords.has(user_id)) hotwords.set(user_id, new Map());
        if (!dmLogs.has(user_id)) dmLogs.set(user_id, []);
        
        console.log('✅ User successfully connected:', userData.username);
        
        res.redirect('/dashboard');
        
    } catch (error) {
        console.error('❌ OAuth process error:', {
            message: error.message,
            response: error.response?.data,
            stack: error.stack
        });
        
        res.status(500).send(`
            <html>
                <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                    <h2>Authentication Failed</h2>
                    <p>Error: ${error.response?.data?.error_message || error.message}</p>
                    <p>Please check:</p>
                    <ul style="text-align: left; display: inline-block;">
                        <li>Your Instagram app configuration</li>
                        <li>Redirect URI settings</li>
                        <li>App permissions</li>
                    </ul>
                    <a href="/">Return to home and try again</a>
                </body>
            </html>
        `);
    }
});

// Dashboard route
app.get('/dashboard', (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/');
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API Routes

// Get user info
app.get('/api/user', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const user = users.get(req.session.userId);
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
        username: user.username,
        profilePicture: user.profilePicture,
        igBusinessAccountId: user.igBusinessAccountId,
        connectedAt: user.connectedAt
    });
});

// Get user's Instagram posts via Business API
app.get('/api/posts', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const user = users.get(req.session.userId);
    if (!user) {
        return res.status(401).json({ error: 'User not found' });
    }
    
    try {
        // Get user's media from Instagram Business API
        const mediaResponse = await axios.get(`https://graph.facebook.com/v19.0/${user.igBusinessAccountId}/media`, {
            params: {
                fields: 'id,caption,media_type,media_url,permalink,thumbnail_url,timestamp,comments_count,like_count',
                access_token: user.accessToken,
                limit: 20
            }
        });
        
        const userPosts = posts.get(req.session.userId) || new Map();
        
        // Enhance posts with hotword data
        const postsWithHotwords = mediaResponse.data.data.map(post => {
            const postHotwords = userPosts.get(post.id) || [];
            return {
                ...post,
                hotwords: postHotwords,
                media_display_url: post.media_url || post.thumbnail_url
            };
        });
        
        res.json({ 
            success: true, 
            posts: postsWithHotwords 
        });
        
    } catch (error) {
        console.error('Error fetching posts via Business API:', error.response?.data || error.message);
        
        // Return mock data for demo if API fails
        const mockPosts = [
            {
                id: 'mock_business_post_1',
                caption: 'Business Post: Check out our amazing new product! #newarrival',
                media_type: 'IMAGE',
                media_url: 'https://via.placeholder.com/500x500/667eea/white?text=Business+Post',
                timestamp: new Date().toISOString(),
                comments_count: 15,
                like_count: 45,
                hotwords: [],
                media_display_url: 'https://via.placeholder.com/500x500/667eea/white?text=Business+Post'
            },
            {
                id: 'mock_business_post_2',
                caption: 'Business Exclusive: Limited time offer! #sale',
                media_type: 'IMAGE',
                media_url: 'https://via.placeholder.com/500x500/764ba2/white?text=Business+Exclusive',
                timestamp: new Date(Date.now() - 86400000).toISOString(),
                comments_count: 8,
                like_count: 32,
                hotwords: [],
                media_display_url: 'https://via.placeholder.com/500x500/764ba2/white?text=Business+Exclusive'
            }
        ];
        
        res.json({ 
            success: true, 
            posts: mockPosts,
            note: 'Using mock data - Instagram Business API unavailable'
        });
    }
});

// Add hotword to post
app.post('/api/posts/:postId/hotwords', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const { postId } = req.params;
    const { word, dmMessage } = req.body;
    
    if (!word || !dmMessage) {
        return res.status(400).json({ error: 'Word and DM message are required' });
    }
    
    const userId = req.session.userId;
    const userHotwords = hotwords.get(userId) || new Map();
    const userPosts = posts.get(userId) || new Map();
    
    // Add to hotwords map
    if (!userHotwords.has(postId)) {
        userHotwords.set(postId, []);
    }
    
    const hotwordConfig = {
        id: generateRandomId(),
        word: word.toLowerCase().trim(),
        dmMessage: dmMessage,
        postId: postId,
        createdAt: new Date().toISOString()
    };
    
    userHotwords.get(postId).push(hotwordConfig);
    
    // Also store in posts map for easy lookup
    if (!userPosts.has(postId)) {
        userPosts.set(postId, []);
    }
    userPosts.get(postId).push(hotwordConfig);
    
    hotwords.set(userId, userHotwords);
    posts.set(userId, userPosts);
    
    logAction(userId, 'HOTWORD_ADDED', { postId, word: hotwordConfig.word });
    
    res.json({ success: true, hotword: hotwordConfig });
});

// Remove hotword from post
app.delete('/api/posts/:postId/hotwords/:hotwordId', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const { postId, hotwordId } = req.params;
    const userId = req.session.userId;
    
    const userHotwords = hotwords.get(userId);
    const userPosts = posts.get(userId);
    
    let removed = false;
    
    if (userHotwords && userHotwords.has(postId)) {
        const postHotwords = userHotwords.get(postId).filter(hw => hw.id !== hotwordId);
        userHotwords.set(postId, postHotwords);
        removed = true;
    }
    
    if (userPosts && userPosts.has(postId)) {
        const postConfigs = userPosts.get(postId).filter(hw => hw.id !== hotwordId);
        userPosts.set(postId, postConfigs);
    }
    
    if (removed) {
        logAction(userId, 'HOTWORD_REMOVED', { postId, hotwordId });
    }
    
    res.json({ success: true, removed });
});

// Get hotwords for a post
app.get('/api/posts/:postId/hotwords', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const { postId } = req.params;
    const userHotwords = hotwords.get(req.session.userId) || new Map();
    const postHotwords = userHotwords.get(postId) || [];
    
    res.json({ success: true, hotwords: postHotwords });
});

// Get DM logs
app.get('/api/logs', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const userLogs = dmLogs.get(req.session.userId) || [];
    res.json({ success: true, logs: userLogs.slice(0, 50) });
});

// Simulate comment for testing
app.post('/api/simulate-comment', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const { postId, commentText } = req.body;
    
    if (!postId || !commentText) {
        return res.status(400).json({ error: 'Post ID and comment text required' });
    }
    
    const userId = req.session.userId;
    const user = users.get(userId);
    const userHotwords = hotwords.get(userId) || new Map();
    const postHotwords = userHotwords.get(postId) || [];
    
    // Create mock comment
    const mockComment = {
        id: `simulated_comment_${generateRandomId()}`,
        text: commentText,
        username: 'test_user',
        timestamp: new Date().toISOString(),
        from: { id: 'test_user_id' }
    };
    
    // Create mock post
    const mockPost = {
        id: postId,
        caption: 'Simulated post for testing'
    };
    
    // Process the comment
    for (const hotwordConfig of postHotwords) {
        if (commentText.toLowerCase().includes(hotwordConfig.word.toLowerCase())) {
            await sendAutomatedDM(userId, user, mockComment, mockPost, hotwordConfig);
            break;
        }
    }
    
    logAction(userId, 'COMMENT_SIMULATED', { postId, commentText });
    
    res.json({ success: true, message: 'Comment simulated and processed' });
});

// Logout
app.post('/auth/logout', (req, res) => {
    if (req.session.userId) {
        logAction(req.session.userId, 'USER_LOGGED_OUT');
    }
    req.session.destroy();
    res.json({ success: true });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Instagram Business DM Automation Platform running on port ${PORT}`);
    console.log(`📱 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔗 Redirect URI: ${INSTAGRAM_CONFIG.redirectUri}`);
    console.log(`🔑 Client ID: ${INSTAGRAM_CONFIG.clientId}`);
    console.log(`👥 Monitoring comments for Instagram Business automation...`);
    
    // Start comment monitoring
    startCommentMonitoring();
});
