// server.js
const express = require("express");
const session = require("express-session");
const axios = require("axios");
const bodyParser = require("body-parser");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5000;

const APP_ID = process.env.APP_ID || "1256408305896903"; // Your Meta App ID
const APP_SECRET = process.env.APP_SECRET || "fc7fbca3fbecd5bc6b06331bc4da17c9";
const REDIRECT_URI = process.env.REDIRECT_URI || `https://instagram-automation-render.onrender.com/auth/callback`;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: "supersecret",
    resave: false,
    saveUninitialized: true,
  })
);

// In-memory store for hotwords and logs (replace with DB for production)
const users = {}; // keyed by session ID

// --- Generate Instagram login URL ---
app.get("/auth/instagram", (req, res) => {
  const loginUrl = `https://www.instagram.com/accounts/login/?force_authentication=1&platform_app_id=${APP_ID}&enable_fb_login=1&next=${encodeURIComponent(
    `https://www.instagram.com/oauth/authorize/third_party/?redirect_uri=${REDIRECT_URI}`
  )}`;
  res.redirect(loginUrl);
});

// --- OAuth callback ---
app.get("/auth/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) return res.send("No code returned from Instagram.");

  try {
    // 1) Exchange code for short-lived token
    const tokenRes = await axios.get("https://graph.facebook.com/v20.0/oauth/access_token", {
      params: {
        client_id: APP_ID,
        client_secret: APP_SECRET,
        redirect_uri: REDIRECT_URI,
        code,
      },
    });

    const shortLivedToken = tokenRes.data.access_token;

    // 2) Exchange for long-lived token
    const longTokenRes = await axios.get("https://graph.facebook.com/v20.0/oauth/access_token", {
      params: {
        grant_type: "fb_exchange_token",
        client_id: APP_ID,
        client_secret: APP_SECRET,
        fb_exchange_token: shortLivedToken,
      },
    });

    const longLivedToken = longTokenRes.data.access_token;

    // 3) Get user's pages
    const pagesRes = await axios.get("https://graph.facebook.com/v20.0/me/accounts", {
      params: { access_token: longLivedToken },
    });

    const page = pagesRes.data.data[0];
    const pageAccessToken = page.access_token;
    const pageId = page.id;

    // 4) Get connected IG Business account
    const igRes = await axios.get(`https://graph.facebook.com/v20.0/${pageId}`, {
      params: {
        fields: "instagram_business_account",
        access_token: pageAccessToken,
      },
    });

    const igBusinessId = igRes.data.instagram_business_account?.id || null;

    // Save in session & in-memory store
    req.session.userId = Math.random().toString(36).slice(2);
    const userId = req.session.userId;
    users[userId] = {
      pageAccessToken,
      igBusinessId,
      pageId,
      configs: {}, // postId -> [{hotword, reply}]
      logs: [],
    };

    res.redirect("/"); // back to UI
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).send("Error during Instagram OAuth flow.");
  }
});

// --- API: fetch posts ---
app.get("/api/posts", async (req, res) => {
  const userId = req.session.userId;
  if (!userId || !users[userId]) return res.status(401).json({ error: "Not connected" });

  try {
    const u = users[userId];
    const mediaRes = await axios.get(`https://graph.facebook.com/v20.0/${u.igBusinessId}/media`, {
      params: {
        fields: "id,caption,media_type,media_url,permalink,timestamp",
        access_token: u.pageAccessToken,
      },
    });

    res.json({ data: mediaRes.data.data || [] });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: "Failed to fetch posts" });
  }
});

// --- API: get/add configs ---
app.get("/api/config", (req, res) => {
  const userId = req.session.userId;
  if (!userId || !users[userId]) return res.status(401).json({ error: "Not connected" });
  res.json({ configs: users[userId].configs, logs: users[userId].logs });
});

app.post("/api/config", (req, res) => {
  const userId = req.session.userId;
  if (!userId || !users[userId]) return res.status(401).json({ error: "Not connected" });

  const { postId, hotword, reply } = req.body;
  if (!postId || !hotword || !reply) return res.status(400).json({ error: "postId, hotword, reply required" });

  if (!users[userId].configs[postId]) users[userId].configs[postId] = [];
  users[userId].configs[postId].push({ hotword: hotword.toLowerCase(), reply });
  res.json({ ok: true, configs: users[userId].configs });
});

// --- API: logs ---
app.get("/api/logs", (req, res) => {
  const userId = req.session.userId;
  if (!userId || !users[userId]) return res.status(401).json({ error: "Not connected" });
  res.json({ logs: users[userId].logs });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
