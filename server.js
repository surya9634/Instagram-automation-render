const express = require('express');
const session = require('express-session');
const axios = require('axios');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
    secret: 'instagram-dm-automation-secret-key-2024',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

// In-memory storage (replace with database in production)
const users = new Map();
const posts = new Map();
const hotwords = new Map();
const dmLogs = new Map();

// Instagram API Configuration
const INSTAGRAM_CONFIG = {
    clientId: process.env.INSTAGRAM_CLIENT_ID || 'YOUR_INSTAGRAM_APP_ID',
    clientSecret: process.env.INSTAGRAM_CLIENT_SECRET || 'YOUR_INSTAGRAM_APP_SECRET',
    redirectUri: process.env.REDIRECT_URI || 'http://localhost:5000/auth/instagram/callback',
    scope: 'user_profile,user_media,instagram_basic,instagram_manage_messages,pages_show_list,pages_read_engagement'
};

// Utility functions
function generateRandomId() {
    return crypto.randomBytes(8).toString('hex');
}

function logAction(userId, action, details) {
    console.log(`[${new Date().toISOString()}] User ${userId}: ${action}`, details);
}

// Start background comment monitoring
function startCommentMonitoring() {
    setInterval(() => {
        monitorComments();
    }, 15000); // Check every 15 seconds
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
        // Get user's recent media (in production, you'd use webhooks)
        const mediaResponse = await axios.get(`https://graph.instagram.com/me/media`, {
            params: {
                fields: 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,comments_count',
                access_token: userData.accessToken,
                limit: 10
            }
        });

        for (const post of mediaResponse.data.data) {
            await processPostComments(userId, userData, post, userHotwords);
        }
    } catch (error) {
        console.error(`Error fetching media for user ${userId}:`, error.message);
    }
}

// Process comments for a specific post
async function processPostComments(userId, userData, post, userHotwords) {
    const postHotwords = userHotwords.get(post.id) || [];
    if (postHotwords.length === 0) return;

    try {
        // Get comments for this post
        const commentsResponse = await axios.get(`https://graph.instagram.com/${post.id}/comments`, {
            params: {
                fields: 'id,text,username,timestamp',
                access_token: userData.accessToken
            }
        });

        for (const comment of commentsResponse.data.data) {
            await processComment(userId, userData, post, comment, postHotwords);
        }
    } catch (error) {
        console.error(`Error fetching comments for post ${post.id}:`, error.message);
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

// Send automated DM
async function sendAutomatedDM(userId, userData, comment, post, hotwordConfig) {
    try {
        // In production, use Instagram Graph API to send DM
        // This is a simulation since DM sending requires additional permissions
        console.log(`📨 [SIMULATION] Would send DM to ${comment.username}: ${hotwordConfig.dmMessage}`);
        
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
            status: 'sent'
        };
        
        const userLogs = dmLogs.get(userId) || [];
        userLogs.unshift(logEntry);
        dmLogs.set(userId, userLogs);
        
        logAction(userId, 'DM_SENT', {
            postId: post.id,
            commenter: comment.username,
            hotword: hotwordConfig.word
        });
        
    } catch (error) {
        console.error('Error in sendAutomatedDM:', error);
        
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
            error: error.message
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

// Instagram OAuth - Start authentication
app.get('/auth/instagram', (req, res) => {
    const state = generateRandomId();
    req.session.oauthState = state;
    
    const authUrl = `https://api.instagram.com/oauth/authorize?` +
        `client_id=${INSTAGRAM_CONFIG.clientId}` +
        `&redirect_uri=${encodeURIComponent(INSTAGRAM_CONFIG.redirectUri)}` +
        `&scope=${encodeURIComponent(INSTAGRAM_CONFIG.scope)}` +
        `&response_type=code` +
        `&state=${state}`;
    
    res.redirect(authUrl);
});

// Instagram OAuth - Callback
app.get('/auth/instagram/callback', async (req, res) => {
    const { code, state, error } = req.query;
    
    if (error) {
        return res.status(400).send(`Authorization failed: ${error}`);
    }
    
    if (state !== req.session.oauthState) {
        return res.status(400).send('State parameter mismatch');
    }
    
    try {
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
                }
            }
        );
        
        const { access_token, user_id } = tokenResponse.data;
        
        // Get user profile
        const profileResponse = await axios.get(`https://graph.instagram.com/me`, {
            params: {
                fields: 'id,username,account_type',
                access_token: access_token
            }
        });
        
        const userData = {
            id: user_id,
            username: profileResponse.data.username,
            accessToken: access_token,
            accountType: profileResponse.data.account_type,
            connectedAt: new Date().toISOString()
        };
        
        // Store user data
        users.set(user_id, userData);
        req.session.userId = user_id;
        req.session.username = profileResponse.data.username;
        
        // Initialize user data structures
        if (!posts.has(user_id)) posts.set(user_id, new Map());
        if (!hotwords.has(user_id)) hotwords.set(user_id, new Map());
        if (!dmLogs.has(user_id)) dmLogs.set(user_id, []);
        
        logAction(user_id, 'USER_CONNECTED', { username: userData.username });
        
        res.redirect('/dashboard');
        
    } catch (error) {
        console.error('Instagram OAuth error:', error.response?.data || error.message);
        res.status(500).send(`
            <html>
                <body>
                    <h2>Authentication failed</h2>
                    <p>Error: ${error.response?.data?.error_message || error.message}</p>
                    <a href="/">Return to home</a>
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
        connectedAt: user.connectedAt
    });
});

// Get user's Instagram posts
app.get('/api/posts', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const user = users.get(req.session.userId);
    if (!user) {
        return res.status(401).json({ error: 'User not found' });
    }
    
    try {
        // Get user's media from Instagram API
        const mediaResponse = await axios.get(`https://graph.instagram.com/me/media`, {
            params: {
                fields: 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,comments_count',
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
        console.error('Error fetching posts:', error.response?.data || error.message);
        
        // Return mock data for demo if API fails
        const mockPosts = [
            {
                id: 'mock_post_1',
                caption: 'Check out our amazing new product! #newarrival',
                media_type: 'IMAGE',
                media_url: 'https://via.placeholder.com/500x500/667eea/white?text=Product+Post',
                timestamp: new Date().toISOString(),
                comments_count: 15,
                hotwords: [],
                media_display_url: 'https://via.placeholder.com/500x500/667eea/white?text=Product+Post'
            },
            {
                id: 'mock_post_2',
                caption: 'Limited time offer! Don\'t miss out! #sale',
                media_type: 'IMAGE',
                media_url: 'https://via.placeholder.com/500x500/764ba2/white?text=Sale+Post',
                timestamp: new Date(Date.now() - 86400000).toISOString(),
                comments_count: 8,
                hotwords: [],
                media_display_url: 'https://via.placeholder.com/500x500/764ba2/white?text=Sale+Post'
            }
        ];
        
        res.json({ 
            success: true, 
            posts: mockPosts,
            note: 'Using mock data - Instagram API unavailable'
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
    res.json({ success: true, logs: userLogs.slice(0, 50) }); // Return last 50 logs
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

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        users: users.size,
        uptime: process.uptime()
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Instagram DM Automation Platform running on http://localhost:${PORT}`);
    console.log(`📱 Monitoring comments for Instagram automation...`);
    startCommentMonitoring();
});
