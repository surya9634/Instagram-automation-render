/* server.js
   Single-file backend for Instagram comment->DM automation prototype.
   - Serves index.html
   - Implements OAuth redirect + callback
   - Provides endpoints to list posts, create configs (hotwords/msg)
   - Implements webhook verification & comment event handler
   - Uses an in-memory store (replaceable with real DB)
   NOTE: This is a prototype. In production: HTTPS, secure token storage,
   persistent DB, error handling, background workers, app review, rate limiting.
*/

const express = require('express');
const axios = require('axios');
const path = require('path');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = process.env.PORT || 5000;

// --- CONFIG (use real env vars in production) ---
const APP_ID = process.env.APP_ID || '1256408305896903';
const APP_SECRET = process.env.APP_SECRET || 'fc7fbca3fbecd5bc6b06331bc4da17c9';
const REDIRECT_URI = process.env.REDIRECT_URI || `https://instagram-automation-render.onrender.com//auth/callback`;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'Work-Flow';

// --- Simple in-memory store (replace with DB) ---
/*
 Structure:
 users = {
   <userId>: {
     appUserId, // our assigned id
     ig_user_id, // instagram business account id
     page_access_token, // page token (used to call IG messaging endpoints)
     short_lived_token,
     long_lived_token,
     configs: {
       // postId -> [ {hotword: 'hello', reply: 'Hi there!'} , ... ]
     },
     logs: [ {when, postId, commenter_id, commenter_username, comment_text, reply_sent} ]
   }
 }
*/
const users = {}; // keyed by a simple session id (in a cookie) for the prototype

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'))); // serve index.html from /public (or root)

// serve index.html at root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

/* ====== OAuth: /auth/instagram -> redirect to login ======
   We redirect the user to Meta's OAuth page requesting permissions.
   The permission names can vary. For full messaging & page listing you typically need:
   - instagram_basic
   - pages_show_list
   - pages_read_engagement
   - instagram_manage_messages
   - instagram_manage_comments
   - pages_messaging
   Adjust scopes in developer console and during app review.
*/
app.get('/auth/instagram', (req, res) => {
  // state should be random + validated in production
  const state = Math.random().toString(36).slice(2);
  // Use Facebook Login dialog with Instagram permissions (Meta docs)
  const scopes = [
    'pages_show_list',
    'instagram_basic',
    'instagram_manage_comments',
    'instagram_manage_messages',
    'pages_messaging',
    'pages_read_engagement'
  ].join(',');
  // Note: Many flows use the "https://www.facebook.com/v{version}/dialog/oauth" endpoint
  const oauthUrl = `https://www.facebook.com/v17.0/dialog/oauth?client_id=${APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=${state}&scope=${encodeURIComponent(scopes)}`;
  res.redirect(oauthUrl);
});

/* ====== Callback: exchange code for user access token ======
   This endpoint handles the code, exchanges for short-lived token, swaps for long-lived token,
   gets list of pages, finds the connected Instagram Business account and saves tokens.
*/
app.get('/auth/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code) return res.status(400).send('Missing code parameter from OAuth callback.');

    // 1) Exchange code for short-lived user access token
    const tokenRes = await axios.get('https://graph.facebook.com/v17.0/oauth/access_token', {
      params: {
        client_id: APP_ID,
        redirect_uri: REDIRECT_URI,
        client_secret: APP_SECRET,
        code
      }
    });

    const shortLivedToken = tokenRes.data.access_token;
    // 2) Exchange for long-lived token
    const longTokenRes = await axios.get('https://graph.facebook.com/v17.0/oauth/access_token', {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: APP_ID,
        client_secret: APP_SECRET,
        fb_exchange_token: shortLivedToken
      }
    });

    const longLivedToken = longTokenRes.data.access_token;

    // 3) Get user's pages (so we can get a page access token and connected IG account)
    const pagesRes = await axios.get('https://graph.facebook.com/v17.0/me/accounts', {
      params: { access_token: longLivedToken }
    });

    // For prototype: pick the first page (in real product user picks which page to connect)
    const pages = pagesRes.data.data || [];
    if (!pages.length) {
      return res.send('No Facebook Pages found on this account. Please ensure you have a Page and have admin role.');
    }
    const page = pages[0]; // { id, name, access_token, ... }
    const pageAccessToken = page.access_token;

    // 4) Using page access token, fetch connected instagram_business_account info (if page is linked)
    // endpoint: /{page-id}?fields=instagram_business_account
    const pageInfoRes = await axios.get(`https://graph.facebook.com/v17.0/${page.id}`, {
      params: {
        fields: 'instagram_business_account',
        access_token: pageAccessToken
      }
    });

    const instagramBusiness = pageInfoRes.data.instagram_business_account;
    if (!instagramBusiness || !instagramBusiness.id) {
      return res.send('The selected Facebook Page is not linked to an Instagram Business/Creator account. Please link the accounts first in Facebook Page settings.');
    }

    const igUserId = instagramBusiness.id;

    // Save a prototype user session
    const appUserId = Math.random().toString(36).slice(2);
    users[appUserId] = {
      appUserId,
      ig_user_id: igUserId,
      page_id: page.id,
      page_access_token: pageAccessToken,
      short_lived_token: shortLivedToken,
      long_lived_token: longLivedToken,
      configs: {}, // postId -> [ {hotword, reply} ]
      logs: []
    };

    // set cookie to keep session
    res.cookie('appUserId', appUserId, { httpOnly: true });
    res.redirect('/'); // back to UI
  } catch (err) {
    console.error('OAuth callback error', err.response ? err.response.data : err.message);
    res.status(500).send('OAuth callback error: ' + (err.message || 'unknown'));
  }
});

/* ====== API: list posts for connected IG account ======
   GET /api/posts
   returns posts for the logged-in user (from ig_user_id via Graph API)
*/
app.get('/api/posts', async (req, res) => {
  try {
    const appUserId = req.cookies.appUserId;
    if (!appUserId || !users[appUserId]) return res.status(401).json({ error: 'Not connected' });

    const u = users[appUserId];
    // Get media for the IG user
    const mediaRes = await axios.get(`https://graph.facebook.com/v17.0/${u.ig_user_id}/media`, {
      params: {
        fields: 'id,caption,media_type,media_url,permalink,thumbnail_url,timestamp',
        access_token: u.page_access_token
      }
    });

    res.json({ data: mediaRes.data.data || [] });
  } catch (err) {
    console.error('posts error', err.response ? err.response.data : err.message);
    res.status(500).json({ error: 'Failed to fetch posts', details: err.message });
  }
});

/* ====== API: manage configs (hotwords + reply messages) ====== */
app.get('/api/config', (req, res) => {
  const appUserId = req.cookies.appUserId;
  if (!appUserId || !users[appUserId]) return res.status(401).json({ error: 'Not connected' });
  res.json({ configs: users[appUserId].configs, logs: users[appUserId].logs });
});

app.post('/api/config', (req, res) => {
  const appUserId = req.cookies.appUserId;
  if (!appUserId || !users[appUserId]) return res.status(401).json({ error: 'Not connected' });
  const { postId, hotword, reply } = req.body;
  if (!postId || !hotword || !reply) return res.status(400).json({ error: 'postId, hotword, reply required' });

  if (!users[appUserId].configs[postId]) users[appUserId].configs[postId] = [];
  users[appUserId].configs[postId].push({ hotword: hotword.toLowerCase(), reply });
  res.json({ ok: true, configs: users[appUserId].configs });
});

/* ====== Webhook: verification & receive events ======
   Register this URL in your Facebook Developer app as a webhook callback.
   On verification, Facebook calls with GET containing hub.mode/hub.challenge/hub.verify_token.
   For POSTs: IG comment events will arrive here (subscribe to instagram comment changes).
*/
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verified');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook', async (req, res) => {
  // Facebook/Instagram will POST events here.
  // We must parse entries, find comment creation events, and handle them.
  try {
    const body = req.body;
    // quickly ACK (FB expects 200)
    res.status(200).send('EVENT_RECEIVED');

    // Example payload shapes vary — inspect console in dev
    // We will attempt to extract comment events under body.entry[*].changes[*]
    if (!body.entry) return;

    for (const entry of body.entry) {
      const changes = entry.changes || [];
      for (const change of changes) {
        // change.field might be 'comments' or 'mentions' etc
        // Example change.value may include: { media_id, comment_id, text, from { id, username } }
        const value = change.value || {};
        if (!value || !value.comment_id) continue;

        // commenter info
        const commenterId = (value.from && value.from.id) || null;
        const commenterUsername = (value.from && value.from.username) || null;
        const commentText = (value.text || '').toLowerCase();
        const mediaId = value.media_id || value.post_id || null;

        // Find which app user this event is for by matching the IG owner id (entry.id)
        // entry.id is usually the IG user id (owner)
        const igOwnerId = entry.id;
        const appUser = Object.values(users).find(u => u.ig_user_id === igOwnerId);
        if (!appUser) {
          console.warn('No app user found for ig id', igOwnerId);
          continue;
        }

        // Check configs for this post
        const postConfigs = appUser.configs[mediaId] || [];
        for (const c of postConfigs) {
          if (commentText.includes(c.hotword.toLowerCase())) {
            // send DM reply to commenter
            // Instagram Messaging endpoint (via page token): POST /{ig-user-id}/messages
            // Request body: { recipient: { user_id: <instagram_user_id> }, message: { text: "..." } }
            // Some endpoints expect recipient:{instagram_actor_id} or using thread id — check current meta docs.
            try {
              // Attempt send message
              const sendRes = await axios.post(`https://graph.facebook.com/v17.0/${appUser.ig_user_id}/messages`, {
                recipient: { id: commenterId },
                message: { text: c.reply }
              }, {
                params: { access_token: appUser.page_access_token }
              });

              // Log success
              appUser.logs.push({
                when: new Date().toISOString(),
                postId: mediaId,
                commenter_id: commenterId,
                commenter_username: commenterUsername,
                comment_text: commentText,
                reply_sent: c.reply,
                meta: sendRes.data
              });
              console.log('DM sent to', commenterUsername || commenterId);
            } catch (sendErr) {
              console.error('Failed sending DM', sendErr.response ? sendErr.response.data : sendErr.message);
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('Webhook processing error', err);
  }
});

/* ====== Lightweight API to fetch logs for front-end ====== */
app.get('/api/logs', (req, res) => {
  const appUserId = req.cookies.appUserId;
  if (!appUserId || !users[appUserId]) return res.status(401).json({ error: 'Not connected' });
  res.json({ logs: users[appUserId].logs || [] });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Visit http://localhost:${PORT}/auth/instagram to start connect flow`);
});
