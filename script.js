import express from "express";
import fetch from "node-fetch";
import cookieParser from "cookie-parser";

const app = express();
app.use(cookieParser());

const APP_ID = process.env.FB_APP_ID;
const APP_SECRET = process.env.FB_APP_SECRET;
const REDIRECT_URI = "https://instagram-automation-render.onrender.com/auth/callback";

// Step 1: Redirect user to Instagram login
app.get("/auth/login", (req, res) => {
  const authUrl = `https://www.instagram.com/oauth/authorize?client_id=${APP_ID}&redirect_uri=${encodeURIComponent(
    REDIRECT_URI
  )}&scope=instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments,instagram_business_content_publish,instagram_business_manage_insights,pages_show_list,pages_manage_metadata,pages_messaging&response_type=code&force_reauth=true`;

  res.redirect(authUrl);
});

// Step 2: Handle callback and exchange code for token
app.get("/auth/callback", async (req, res) => {
  const code = req.query.code;

  if (!code) {
    return res.status(400).send("No code received from Instagram");
  }

  try {
    // Exchange code for user token
    const tokenRes = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?client_id=${APP_ID}&client_secret=${APP_SECRET}&redirect_uri=${encodeURIComponent(
        REDIRECT_URI
      )}&code=${code}`,
      { method: "GET" }
    );
    const tokenData = await tokenRes.json();

    if (tokenData.error) {
      return res.json({ error: tokenData.error });
    }

    const userAccessToken = tokenData.access_token;

    // Get Pages the user manages
    const pagesRes = await fetch(
      `https://graph.facebook.com/v21.0/me/accounts?access_token=${userAccessToken}`
    );
    const pagesData = await pagesRes.json();

    if (pagesData.error) {
      return res.json({ error: pagesData.error });
    }

    // Pick first page (you can add UI for user to choose)
    const page = pagesData.data[0];
    if (!page) {
      return res.json({ error: "No pages found for this user." });
    }

    const pageAccessToken = page.access_token;
    const pageId = page.id;

    // Get Instagram Business account linked to this Page
    const igRes = await fetch(
      `https://graph.facebook.com/v21.0/${pageId}?fields=connected_instagram_account&access_token=${pageAccessToken}`
    );
    const igData = await igRes.json();

    if (igData.error) {
      return res.json({ error: igData.error });
    }

    return res.json({
      message: "✅ Instagram account connected to your Page successfully!",
      page: page,
      instagramAccount: igData.connected_instagram_account || "No IG connected",
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/", (req, res) => {
  res.send(`<a href="/auth/login">Connect Instagram</a>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
