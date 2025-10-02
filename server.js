/**
 * server.js
 * Single-file backend for Instagram comment->DM automation prototype.
 *
 * Notes:
 * - Keep index.html in the same folder as this file (or put static files in ./public).
 * - Use environment variables on Render for APP_ID, APP_SECRET, REDIRECT_URI, VERIFY_TOKEN.
 * - This is a prototype: use persistent DB, secure token storage, HTTPS, and Meta App Review in production.
 */

const express = require('express');
const axios = require('axios');
const path = require('path');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = process.env.PORT || 5000;

// --- CONFIG (prefer to set real env vars on Render) ---
const APP_ID = process.env.APP_ID || '1256408305896903';
const APP_SECRET = process.env.APP_SECRET || 'fc7fbca3fbecd5bc6b06331bc4da17c9';
const REDIRECT_URI = process.env.REDIRECT_URI || `https://instagram-automation-render.onrender.com/auth/callback`;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'Work-Flow';

// --- Simple in-memory store (replace with DB) ---
const users = {}; // keyed by appUserId stored in cookie

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

// Serve static files from 'public' if present
app.use(express.static(path.join(__dirname, 'public')));

// Serve index.html from project root
app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, 'index.html');
  res.sendFile(indexPath, err => {
    if (err) {
      res.status(500).send('Index not found. Put index.html in project root or a public/ folder.');
    }
  });
});

/* ====== OAuth: /auth/instagram -> redirect to login ======
   We redirect the user to Facebook OAuth (used for Instagram Graph flows).
   Make sure REDIRECT_URI exactly matches the URL registered in your Meta App settings.
*/
app.get('/auth/instagram', (req, res) => {
  // In production generate and validate 'state' for CSRF protection.
  const state = Math.random().toString(36).slice(2);
  const scopes = [
    'pages_show_list',
    'instagram_basic',
    'instagram_manage_comments',
    'instagram_manage_messages',
    'pages_messaging',
    'pages_read_engagement'
  ].join(',');

  const oauthUrl = `https://www.facebook.com/v17.0/dialog/oauth?client_id=${encodeURIComponent(APP_ID)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=${encodeURIComponent(state)}&response_type=code&scope=${encodeURIComponent(scopes)}`;

  return res.redirect(oauthUrl);
});

/* ====== Callback: exchange code for user access token ======
   Exchanges code -> short token -> long token, lists pages, finds linked IG business account.
*/
app.get('/auth/callback', async (req, res) => {
  try {
    const { code } = req.query;
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

    const shortLivedToken = tokenRes.data && tokenRes.data.access_token;
    if (!shortLivedToken) return res.status(500).send('Failed to obtain short-lived access token.');

    // 2) Exchange for long-lived token
    const longTokenRes = await axios.get('https://graph.facebook.com/v17.0/oauth/access_token', {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: APP_ID,
        client_secret: APP_SECRET,
        fb_exchange_token: shortLivedToken
      }
    });

    const longLivedToken = longTokenRes.data && longTokenRes.data.access_token;
    if (!longLivedToken) {
      console.warn('Long-lived token exchange failed, falling back to short-lived token.');
    }

    const effectiveToken = longLivedToken || shortLivedToken;

    // 3) Get user's pages (so we can get a page access token and connected IG account)
    const pagesRes = await axios.get('https://graph.facebook.com/v17.0/me/accounts', {
      params: { access_token: effectiveToken }
    });

    const pages = (pagesRes.data && pagesRes.data.data) || [];
    if (!pages.length) {
      return res.send('No Facebook Pages found on this account. Please ensure you have a Page and have admin role.');
    }

    // For prototype: pick the first page (in production let user choose)
    const page = pages[0];
    if (!page || !page.id || !page.access_token) {
      return res.status(500).send('Failed to retrieve Page or page access token.');
    }
    const pageAccessToken = page.access_token;

    // 4) Using page access token, fetch connected instagram_business_account info (if page is linked)
    const pageInfoRes = await axios.get(`https://graph.facebook.com/v17.0/${page.id}`, {
      params: {
        fields: 'instagram_business_account',
        access_token: pageAccessToken
      }
    });

    const instagramBusiness = pageInfoRes.data && pageInfoRes.data.instagram_business_account;
    if (!instagramBusiness || !instagramBusiness.id) {
      return res.send('The selected Facebook Page is not linked to an Instagram Business/Creator account. Link the accounts first in Facebook Page settings.');
    }

    const igUserId = instagramBusiness.id;

    // Save session in memory (production: save to DB and encrypt tokens)
    const appUserId = Math.random().toString(36).slice(2);
    users[appUserId] = {
      appUserId,
      ig_user_id: igUserId,
      page_id: page.id,
      page_access_token: pageAccessToken,
      short_lived_token: shortLivedToken,
      long_lived_token: longLivedToken || null,
      configs: {}, // postId -> array of {hotword, reply}
      logs: []
    };

    // set cookie for prototype
    res.cookie('appUserId', appUserId, { httpOnly: true, secure: req.protocol === 'https' });
    return res.redirect('/');
  } catch (err) {
    console.error('OAuth callback error', err.response ? err.response.data : err.message);
    return res.status(500).send('OAuth callback error: ' + (err.response && JSON.stringify(err.response.data) || err.message));
  }
});

/* ====== API: list posts for connected IG account ====== */
app.get('/api/posts', async (req, res) => {
  try {
    const appUserId = req.cookies.appUserId;
    if (!appUserId || !users[appUserId]) return res.status(401).json({ error: 'Not connected' });

    const u = users[appUserId];
    const mediaRes = await axios.get(`https://graph.facebook.com/v17.0/${u.ig_user_id}/media`, {
      params: {
        fields: 'id,caption,media_type,media_url,permalink,thumbnail_url,timestamp',
        access_token: u.page_access_token
      }
    });

    return res.json({ data: (mediaRes.data && mediaRes.data.data) || [] });
  } catch (err) {
    console.error('posts error', err.response ? err.response.data : err.message);
    return res.status(500).json({ error: 'Failed to fetch posts', details: err.response ? err.response.data : err.message });
  }
});

/* ====== API: manage configs (hotwords + reply messages) ====== */
app.get('/api/config', (req, res) => {
  const appUserId = req.cookies.appUserId;
  if (!appUserId || !users[appUserId]) return res.status(401).json({ error: 'Not connected' });
  return res.json({ configs: users[appUserId].configs, logs: users[appUserId].logs });
});

app.post('/api/config', (req, res) => {
  const appUserId = req.cookies.appUserId;
  if (!appUserId || !users[appUserId]) return res.status(401).json({ error: 'Not connected' });
  const { postId, hotword, reply } = req.body;
  if (!postId || !hotword || !reply) return res.status(400).json({ error: 'postId, hotword, reply required' });

  if (!users[appUserId].configs[postId]) users[appUserId].configs[postId] = [];
  users[appUserId].configs[postId].push({ hotword: hotword.toLowerCase(), reply });
  return res.json({ ok: true, configs: users[appUserId].configs });
});

/* ====== Webhook: verification & receive events ====== */
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verified');
    return res.status(200).send(challenge);
  } else {
    return res.sendStatus(403);
  }
});

app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;
    // Acknowledge immediately
    res.status(200).send('EVENT_RECEIVED');

    if (!body || !body.entry) return;

    for (const entry of body.entry) {
      const changes = entry.changes || [];
      for (const change of changes) {
        const value = change.value || {};
        // We're primarily interested in comment creations that include comment_id and text
        if (!value || !value.comment_id) continue;

        const commenterId = (value.from && value.from.id) || null;
        const commenterUsername = (value.from && value.from.username) || null;
        const commentText = (value.text || '').toLowerCase();
        const mediaId = value.media_id || value.post_id || null;

        const igOwnerId = entry.id; // IG owner id (the account that got the comment)
        const appUser = Object.values(users).find(u => u.ig_user_id === igOwnerId);
        if (!appUser) {
          console.warn('No app user found for ig id', igOwnerId);
          continue;
        }

        const postConfigs = appUser.configs[mediaId] || [];
        for (const c of postConfigs) {
          try {
            if (!c || !c.hotword) continue;
            if (commentText.includes(c.hotword.toLowerCase())) {
              // Attempt to send DM using IG Messaging endpoint
              // NOTE: API shapes may change – if this fails, inspect response and consult Meta docs.
              const payload = {
                recipient: { id: commenterId },
                message: { text: c.reply }
              };

              const sendRes = await axios.post(`https://graph.facebook.com/v17.0/${appUser.ig_user_id}/messages`, payload, {
                params: { access_token: appUser.page_access_token }
              });

              appUser.logs.push({
                when: new Date().toISOString(),
                postId: mediaId,
                commenter_id: commenterId,
                commenter_username: commenterUsername,
                comment_text: commentText,
                reply_sent: c.reply,
                meta: sendRes.data
              });
              console.log(`DM sent for hotword="${c.hotword}" to ${commenterUsername || commenterId}`);
            }
          } catch (sendErr) {
            console.error('Failed sending DM', sendErr.response ? sendErr.response.data : sendErr.message);
            // Log failure
            appUser.logs.push({
              when: new Date().toISOString(),
              postId: mediaId,
              commenter_id: commenterId,
              commenter_username: commenterUsername,
              comment_text: commentText,
              reply_sent: c.reply,
              error: sendErr.response ? sendErr.response.data : sendErr.message
            });
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
  return res.json({ logs: users[appUserId].logs || [] });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT} (or on Render at your service URL)`);
  console.log(`Visit /auth/instagram to start the connect flow`);
});
