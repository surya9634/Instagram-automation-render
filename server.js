const express = require("express");
const session = require("express-session");
const axios = require("axios");
const bodyParser = require("body-parser");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

const APP_ID = process.env.APP_ID || "1256408305896903"; // Your Meta App ID
const APP_SECRET = process.env.APP_SECRET; // from Meta
const REDIRECT_URI = process.env.REDIRECT_URI || "https://instagram-automation-render.onrender.com/auth/callback";

app.use(bodyParser.json());
app.use(express.static("public")); // serve index.html if in /public
app.use(
  session({
    secret: "supersecret",
    resave: false,
    saveUninitialized: true,
  })
);

// Instagram-first login (ManyChat style)
app.get("/auth/instagram", (req, res) => {
  const loginUrl = `https://www.instagram.com/accounts/login/?force_authentication=1&platform_app_id=${APP_ID}&enable_fb_login=1&next=https://www.instagram.com/oauth/authorize/third_party/?redirect_uri=${encodeURIComponent(
    REDIRECT_URI
  )}`;
  res.redirect(loginUrl);
});

// OAuth callback
app.get("/auth/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) return res.send("No code returned from Instagram.");

  try {
    // Exchange code for access token
    const tokenRes = await axios.get(
      `https://graph.facebook.com/v20.0/oauth/access_token`, {
        params: {
          client_id: APP_ID,
          client_secret: APP_SECRET,
          redirect_uri: REDIRECT_URI,
          code
        }
      }
    );

    const shortLivedToken = tokenRes.data.access_token;

    // Exchange for long-lived token
    const longTokenRes = await axios.get(
      `https://graph.facebook.com/v20.0/oauth/access_token`, {
        params: {
          grant_type: "fb_exchange_token",
          client_id: APP_ID,
          client_secret: APP_SECRET,
          fb_exchange_token: shortLivedToken
        }
      }
    );

    const longLivedToken = longTokenRes.data.access_token;
    req.session.token = longLivedToken;

    // Get user’s pages
    const pagesRes = await axios.get("https://graph.facebook.com/v20.0/me/accounts", {
      params: { access_token: longLivedToken }
    });

    // Pick first page
    const page = pagesRes.data.data[0];
    const pageId = page.id;
    const pageAccessToken = page.access_token;

    // Get connected Instagram business account
    const igRes = await axios.get(`https://graph.facebook.com/v20.0/${pageId}`, {
      params: {
        fields: "instagram_business_account",
        access_token: pageAccessToken
      }
    });

    const igBusinessId = igRes.data.instagram_business_account
      ? igRes.data.instagram_business_account.id
      : null;

    // Save in session
    req.session.pageAccessToken = pageAccessToken;
    req.session.igBusinessId = igBusinessId;

    res.send(`
      <h2>✅ Instagram Connected!</h2>
      <p>Page ID: ${pageId}</p>
      <p>IG Business ID: ${igBusinessId}</p>
      <p>Now you can automate DMs 🎉</p>
    `);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).send("Error during Instagram OAuth flow.");
  }
});

// Example: Send DM
app.post("/send-dm", async (req, res) => {
  const { recipientId, message } = req.body;
  const token = req.session.pageAccessToken;

  try {
    const resp = await axios.post(
      `https://graph.facebook.com/v20.0/me/messages`,
      {
        recipient: { id: recipientId },
        message: { text: message },
      },
      { params: { access_token: token } }
    );

    res.json({ success: true, response: resp.data });
  } catch (err) {
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
