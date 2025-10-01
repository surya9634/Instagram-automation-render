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

// In-memory storage
const users = new Map();
const posts = new Map();
const hotwords = new Map();
const dmLogs = new Map();

// Instagram Configuration - Using Instagram Basic Display API
const INSTAGRAM_CONFIG = {
    clientId: process.env.INSTAGRAM_CLIENT_ID || '1477959410285896',
    clientSecret: process.env.INSTAGRAM_CLIENT_SECRET,
    redirectUri: process.env.REDIRECT_URI || 'https://instagram-automation-render.onrender.com/auth/callback',
    // Using Instagram Basic Display API scopes instead of Business API
    scope: 'user_profile,user_media'
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
    }, 30000);
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
        // Get user's media from Instagram Basic Display API
        const mediaResponse = await axios.get(`https://graph.instagram.com/me/media`, {
            params: {
                fields: 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp',
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
        // Get comments for this post using Instagram Basic Display API
        // Note: The Basic Display API doesn't support reading comments directly
        // We'll simulate this for demo purposes
        await simulateCommentProcessing(userId, userData, post, postHotwords);
    } catch (error) {
        console.error(`Error processing comments for post ${post.id}:`, error.message);
    }
}

// Simulate comment processing (since Basic Display API doesn't support comments)
async function simulateCommentProcessing(userId, userData, post, postHotwords) {
    // For demo purposes, we'll simulate finding comments with hotwords
    // In a real implementation, you'd need:
    // 1. Instagram Graph API with instagram_basic and pages_read_engagement permissions
    // 2. A webhook setup to receive real-time comments
    
    const simulatedComments = [
        { text: "I'm interested in this product!", username: "demo_user_1", id: "sim_1" },
        { text: "Where can I buy this?", username: "demo_user_2", id: "sim_2" },
        { text: "More info please", username: "demo_user_3", id: "sim_3" }
    ];

    for (const comment of simulatedComments) {
        const commentText = comment.text.toLowerCase();
        
        for (const hotwordConfig of postHotwords) {
            if (commentText.includes(hotwordConfig.word.toLowerCase())) {
                // Check if we already processed this comment
                const userLogs = dmLogs.get(userId) || [];
                const alreadyProcessed = userLogs.some(log => 
                    log.commentId === comment.id && log.postId === post.id
                );
                
                if (!alreadyProcessed) {
                    await sendSimulatedDM(userId, userData, comment, post, hotwordConfig);
                    break;
                }
            }
        }
    }
}

// Send simulated DM (since Basic Display API doesn't support sending DMs)
async function sendSimulatedDM(userId, userData, comment, post, hotwordConfig) {
    try {
        console.log(`📨 [SIMULATED] Would send DM to ${comment.username}: ${hotwordConfig.dmMessage}`);
        
        // Log the action
        const logEntry = {
            id: generateRandomId(),
            timestamp: new Date().toISOString(),
            postId: post.id,
            postCaption: post.caption ? post.caption.substring(0, 100) + '...' : 'No caption',
            commentId: comment.id,
            commentText: comment.text,
            commenter: comment.username,
            hotword: hotwordConfig.word,
            dmMessage: hotwordConfig.dmMessage,
            status: 'sent (simulated)',
            note: 'Using Instagram Basic Display API - DMs are simulated'
        };
        
        const userLogs = dmLogs.get(userId) || [];
        userLogs.unshift(logEntry);
        dmLogs.set(userId, userLogs);
        
        logAction(userId, 'DM_SENT_SIMULATED', {
            postId: post.id,
            commenter: comment.username,
            hotword: hotwordConfig.word
        });
        
    } catch (error) {
        console.error('Error in simulated DM:', error);
    }
}

// Routes

// Serve main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        users: users.size,
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// Instagram OAuth - Start authentication
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
    req.session.oauthState = null;
    
    const state = generateRandomId();
    req.session.oauthState = state;
    
    // Save session immediately before redirect
    req.session.save((err) => {
        if (err) {
            console.error('Session save error:', err);
            return res.status(500).send('Session error - please try again');
        }
        
        const authUrl = `https://api.instagram.com/oauth/authorize?` +
            `client_id=${INSTAGRAM_CONFIG.clientId}` +
            `&redirect_uri=${encodeURIComponent(INSTAGRAM_CONFIG.redirectUri)}` +
            `&scope=${encodeURIComponent(INSTAGRAM_CONFIG.scope)}` +
            `&response_type=code` +
            `&state=${state}`;
        
        console.log('🔐 OAuth Initiated:', {
            state: state,
            clientId: INSTAGRAM_CONFIG.clientId,
            redirectUri: INSTAGRAM_CONFIG.redirectUri,
            scope: INSTAGRAM_CONFIG.scope
        });
        
        res.redirect(authUrl);
    });
});

// Instagram OAuth - Callback
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
    
    // Enhanced state validation
    if (!state || !req.session.oauthState || state !== req.session.oauthState) {
        console.error('❌ State validation failed:', {
            received: state,
            expected: req.session.oauthState
        });
        return res.status(400).send(`
            <html>
                <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                    <h2>Security Error - State Mismatch</h2>
                    <p>Please <a href="/">return to home</a> and try again.</p>
                </body>
            </html>
        `);
    }
    
    // Clear the state after successful validation
    req.session.oauthState = null;
    
    try {
        console.log('🔄 Exchanging code for access token...');
        
        // Exchange code for access token using Instagram Basic Display API
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
        console.log('✅ Instagram access token received for user:', user_id);
        
        // Get user profile from Instagram Basic Display API
        const profileResponse = await axios.get(`https://graph.instagram.com/me`, {
            params: {
                fields: 'id,username,account_type,media_count',
                access_token: access_token
            }
        });

        const userData = {
            id: user_id,
            username: profileResponse.data.username,
            accessToken: access_token,
            accountType: profileResponse.data.account_type,
            mediaCount: profileResponse.data.media_count,
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
            status: error.response?.status
        });
        
        let errorMessage = error.response?.data?.error_message || error.message;
        
        res.status(500).send(`
            <html>
                <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                    <h2>Authentication Failed</h2>
                    <p>Error: ${errorMessage}</p>
                    <div style="text-align: left; max-width: 500px; margin: 20px auto; background: #f8f9fa; padding: 20px; border-radius: 8px;">
                        <h3>Common Solutions:</h3>
                        <ul>
                            <li>Make sure your Instagram app is in "Live" mode</li>
                            <li>Verify the redirect URI matches exactly in your app settings</li>
                            <li>Ensure you're using the correct client ID and secret</li>
                            <li>Check that the user has accepted all required permissions</li>
                        </ul>
                    </div>
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
        accountType: user.accountType,
        mediaCount: user.mediaCount,
        connectedAt: user.connectedAt
    });
});

// Get user's Instagram posts via Basic Display API
app.get('/api/posts', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const user = users.get(req.session.userId);
    if (!user) {
        return res.status(401).json({ error: 'User not found' });
    }
    
    try {
        // Get user's media from Instagram Basic Display API
        const mediaResponse = await axios.get(`https://graph.instagram.com/me/media`, {
            params: {
                fields: 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp',
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
                media_display_url: post.media_url || post.thumbnail_url,
                // Add simulated comments count for demo
                comments_count: Math.floor(Math.random() * 20)
            };
        });
        
        res.json({ 
            success: true, 
            posts: postsWithHotwords 
        });
        
    } catch (error) {
        console.error('Error fetching posts via Basic Display API:', error.response?.data || error.message);
        
        // Return mock data for demo
        const mockPosts = [
            {
                id: 'demo_post_1',
                caption: 'Demo Post: Check out our amazing product! #demo',
                media_type: 'IMAGE',
                media_url: 'https://via.placeholder.com/500x500/667eea/white?text=Demo+Post+1',
                timestamp: new Date().toISOString(),
                comments_count: 12,
                hotwords: [],
                media_display_url: 'https://via.placeholder.com/500x500/667eea/white?text=Demo+Post+1'
            },
            {
                id: 'demo_post_2',
                caption: 'Demo Exclusive: Special offer! #special',
                media_type: 'IMAGE',
                media_url: 'https://via.placeholder.com/500x500/764ba2/white?text=Demo+Post+2',
                timestamp: new Date(Date.now() - 86400000).toISOString(),
                comments_count: 8,
                hotwords: [],
                media_display_url: 'https://via.placeholder.com/500x500/764ba2/white?text=Demo+Post+2'
            }
        ];
        
        res.json({ 
            success: true, 
            posts: mockPosts,
            note: 'Using demo data with simulated comment monitoring'
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
        timestamp: new Date().toISOString()
    };
    
    // Create mock post
    const mockPost = {
        id: postId,
        caption: 'Simulated post for testing'
    };
    
    // Process the comment
    for (const hotwordConfig of postHotwords) {
        if (commentText.toLowerCase().includes(hotwordConfig.word.toLowerCase())) {
            await sendSimulatedDM(userId, user, mockComment, mockPost, hotwordConfig);
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
    console.log(`🚀 Instagram DM Automation Platform running on port ${PORT}`);
    console.log(`📱 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔗 Redirect URI: ${INSTAGRAM_CONFIG.redirectUri}`);
    console.log(`🔑 Using Instagram Basic Display API`);
    console.log(`👥 Monitoring comments with simulated automation...`);
    
    // Start comment monitoring
    startCommentMonitoring();
});
