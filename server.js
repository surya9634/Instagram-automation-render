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

// Facebook App Configuration for Instagram Business API
const FACEBOOK_CONFIG = {
    clientId: process.env.FACEBOOK_CLIENT_ID || '1477959410285896',
    clientSecret: process.env.FACEBOOK_CLIENT_SECRET,
    redirectUri: process.env.REDIRECT_URI || 'https://instagram-automation-render.onrender.com/auth/callback',
    // Facebook permissions needed for Instagram Business API
    scope: 'business_management,instagram_basic,instagram_manage_messages,instagram_manage_comments,pages_show_list,pages_read_engagement'
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
    
    if (userPosts.size === 0 || !userData.igBusinessAccountId || !userData.pageAccessToken) return;

    try {
        // Get user's media from Instagram Business Account
        const mediaResponse = await axios.get(`https://graph.facebook.com/v19.0/${userData.igBusinessAccountId}/media`, {
            params: {
                fields: 'id,caption,media_type,media_url,permalink,thumbnail_url,timestamp,comments_count,like_count',
                access_token: userData.pageAccessToken,
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
                fields: 'id,text,username,from',
                access_token: userData.pageAccessToken
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
            break;
        }
    }
}

// Send automated DM using Instagram Business API
async function sendAutomatedDM(userId, userData, comment, post, hotwordConfig) {
    try {
        // Send DM using Instagram Business API
        const dmResponse = await axios.post(`https://graph.facebook.com/v19.0/${userData.igBusinessAccountId}/messages`, {
            recipient: `{"comment_id":"${comment.id}"}`,
            message: `{"text":"${hotwordConfig.dmMessage}"}`
        }, {
            params: {
                access_token: userData.pageAccessToken
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
            commenterId: comment.from?.id,
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

// Facebook OAuth for Instagram Business API
app.get('/auth/facebook', (req, res) => {
    // Validate Facebook config
    if (!FACEBOOK_CONFIG.clientId || !FACEBOOK_CONFIG.clientSecret) {
        return res.status(500).send(`
            <html>
                <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                    <h2>Configuration Error</h2>
                    <p>Facebook OAuth is not properly configured.</p>
                    <p>Please set FACEBOOK_CLIENT_ID and FACEBOOK_CLIENT_SECRET environment variables.</p>
                    <a href="/">Return to home</a>
                </body>
            </html>
        `);
    }

    const state = generateRandomId();
    req.session.oauthState = state;
    
    // Facebook OAuth URL for Instagram Business API
    const authUrl = `https://www.facebook.com/v19.0/dialog/oauth?` +
        `client_id=${FACEBOOK_CONFIG.clientId}` +
        `&redirect_uri=${encodeURIComponent(FACEBOOK_CONFIG.redirectUri)}` +
        `&scope=${encodeURIComponent(FACEBOOK_CONFIG.scope)}` +
        `&response_type=code` +
        `&state=${state}`;
    
    console.log('🔐 Facebook OAuth Initiated for Instagram Business API');
    
    req.session.save((err) => {
        if (err) {
            console.error('Session save error:', err);
            return res.status(500).send('Session error');
        }
        res.redirect(authUrl);
    });
});

// Facebook OAuth Callback
app.get('/auth/callback', async (req, res) => {
    const { code, state, error, error_reason, error_description } = req.query;
    
    console.log('🔐 Facebook OAuth Callback Received:', {
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
                    <p>Reason: ${error_reason}</p>
                    <p>Description: ${error_description}</p>
                    <a href="/">Return to home</a>
                </body>
            </html>
        `);
    }
    
    // State validation
    if (!state || !req.session.oauthState || state !== req.session.oauthState) {
        console.error('State validation failed');
        return res.status(400).send('Invalid state parameter');
    }
    
    req.session.oauthState = null;
    
    try {
        console.log('🔄 Exchanging code for Facebook access token...');
        
        // Step 1: Exchange code for Facebook access token
        const tokenResponse = await axios.get(`https://graph.facebook.com/v19.0/oauth/access_token`, {
            params: {
                client_id: FACEBOOK_CONFIG.clientId,
                client_secret: FACEBOOK_CONFIG.clientSecret,
                redirect_uri: FACEBOOK_CONFIG.redirectUri,
                code: code
            }
        });
        
        const { access_token } = tokenResponse.data;
        console.log('✅ Facebook access token received');
        
        // Step 2: Get long-lived token (60 days)
        const longLivedResponse = await axios.get(`https://graph.facebook.com/v19.0/oauth/access_token`, {
            params: {
                grant_type: 'fb_exchange_token',
                client_id: FACEBOOK_CONFIG.clientId,
                client_secret: FACEBOOK_CONFIG.clientSecret,
                fb_exchange_token: access_token
            }
        });
        
        const longLivedToken = longLivedResponse.data.access_token;
        console.log('✅ Long-lived Facebook access token received');
        
        // Step 3: Get user's Facebook pages
        const pagesResponse = await axios.get(`https://graph.facebook.com/v19.0/me/accounts`, {
            params: {
                access_token: longLivedToken,
                fields: 'id,name,access_token,instagram_business_account{id,username,profile_picture_url,followers_count}'
            }
        });

        // Find pages with Instagram Business accounts
        const pagesWithInstagram = pagesResponse.data.data.filter(page => page.instagram_business_account);
        
        if (pagesWithInstagram.length === 0) {
            return res.status(400).send(`
                <html>
                    <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                        <h2>No Instagram Business Account Found</h2>
                        <p>Please make sure:</p>
                        <ol style="text-align: left; display: inline-block;">
                            <li>Your Instagram account is a Business account</li>
                            <li>It's connected to a Facebook Page you manage</li>
                            <li>You have the required permissions</li>
                        </ol>
                        <a href="/">Return to home</a>
                    </body>
                </html>
            `);
        }

        // For now, use the first Instagram Business account found
        const page = pagesWithInstagram[0];
        const igBusinessAccount = page.instagram_business_account;

        const userData = {
            id: generateRandomId(), // Generate our own user ID since we're using Facebook login
            username: igBusinessAccount.username,
            accessToken: longLivedToken, // Long-lived Facebook token
            pageAccessToken: page.access_token, // Page access token for Instagram Business API
            pageId: page.id,
            pageName: page.name,
            igBusinessAccountId: igBusinessAccount.id,
            profilePicture: igBusinessAccount.profile_picture_url,
            followersCount: igBusinessAccount.followers_count,
            connectedAt: new Date().toISOString()
        };
        
        // Store user data
        const userId = userData.id;
        users.set(userId, userData);
        req.session.userId = userId;
        req.session.username = userData.username;
        
        // Initialize user data structures
        if (!posts.has(userId)) posts.set(userId, new Map());
        if (!hotwords.has(userId)) hotwords.set(userId, new Map());
        if (!dmLogs.has(userId)) dmLogs.set(userId, []);
        
        console.log('✅ Instagram Business account connected:', userData.username);
        
        res.redirect('/dashboard');
        
    } catch (error) {
        console.error('❌ OAuth process error:', {
            message: error.message,
            response: error.response?.data,
            status: error.response?.status
        });
        
        let errorMessage = 'Authentication failed';
        if (error.response?.data?.error?.message) {
            errorMessage = error.response.data.error.message;
        } else {
            errorMessage = error.message;
        }
        
        res.status(500).send(`
            <html>
                <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                    <h2>Authentication Failed</h2>
                    <p>Error: ${errorMessage}</p>
                    <div style="text-align: left; max-width: 500px; margin: 20px auto; background: #f8f9fa; padding: 20px; border-radius: 8px;">
                        <h3>Required Setup:</h3>
                        <ol>
                            <li>Your Instagram account must be a Business account</li>
                            <li>It must be connected to a Facebook Page you manage</li>
                            <li>Your Facebook app must have Business Management permission</li>
                            <li>The app must be approved for all requested permissions</li>
                            <li>You must be an admin of the Facebook Page</li>
                        </ol>
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
        profilePicture: user.profilePicture,
        pageName: user.pageName,
        followersCount: user.followersCount,
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
    if (!user || !user.igBusinessAccountId || !user.pageAccessToken) {
        return res.status(401).json({ error: 'User not properly connected' });
    }
    
    try {
        // Get user's media from Instagram Business API
        const mediaResponse = await axios.get(`https://graph.facebook.com/v19.0/${user.igBusinessAccountId}/media`, {
            params: {
                fields: 'id,caption,media_type,media_url,permalink,thumbnail_url,timestamp,comments_count,like_count',
                access_token: user.pageAccessToken,
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
        res.status(500).json({ 
            error: 'Failed to fetch posts',
            details: error.response?.data?.error?.message || error.message 
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

// Test DM endpoint
app.post('/api/test-dm', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const user = users.get(req.session.userId);
    if (!user || !user.igBusinessAccountId || !user.pageAccessToken) {
        return res.status(400).json({ error: 'User not properly connected' });
    }
    
    try {
        // Create a test comment ID
        const testCommentId = `test_comment_${generateRandomId()}`;
        
        // Send test DM
        const dmResponse = await axios.post(`https://graph.facebook.com/v19.0/${user.igBusinessAccountId}/messages`, {
            recipient: `{"comment_id":"${testCommentId}"}`,
            message: `{"text":"Test DM from automation system"}`
        }, {
            params: {
                access_token: user.pageAccessToken
            }
        });
        
        res.json({ 
            success: true, 
            message: 'Test DM functionality verified',
            messageId: dmResponse.data.message_id 
        });
        
    } catch (error) {
        console.error('Test DM error:', error.response?.data || error.message);
        res.status(500).json({ 
            error: 'Failed to send test DM',
            details: error.response?.data?.error || error.message 
        });
    }
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
    console.log(`🔗 Redirect URI: ${FACEBOOK_CONFIG.redirectUri}`);
    console.log(`🔑 Using Facebook Login for Instagram Business API`);
    console.log(`👥 Monitoring comments for Instagram Business automation...`);
    
    // Start comment monitoring
    startCommentMonitoring();
});
