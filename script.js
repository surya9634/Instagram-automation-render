import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

app.get("/auth/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send("Missing code");

  try {
    // Exchange code for short-lived token
    const tokenRes = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.APP_ID,
        client_secret: process.env.APP_SECRET,
        grant_type: "authorization_code",
        redirect_uri: process.env.REDIRECT_URI,
        code,
      }),
    });
    const tokenData = await tokenRes.json();
    if (tokenData.error) return res.status(400).json(tokenData);

    const shortLivedToken = tokenData.access_token;
    const userId = tokenData.user_id;

    // Exchange for long-lived token
    const longRes = await fetch(
      `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${process.env.APP_SECRET}&access_token=${shortLivedToken}`
    );
    const longData = await longRes.json();
    const longLivedToken = longData.access_token;

    // Fetch connected Instagram Business account from your platform FB Page
    const pageId = process.env.PLATFORM_PAGE_ID;
    const igRes = await fetch(
      `https://graph.facebook.com/v21.0/${pageId}?fields=connected_instagram_account&access_token=${longLivedToken}`
    );
    const igData = await igRes.json();

    if (!igData.connected_instagram_account) {
      return res.status(400).send(
        "User must approve IG -> Page connection in Instagram login flow."
      );
    }

    res.json({
      userId,
      shortLivedToken,
      longLivedToken,
      pageId,
      instagramAccount: igData.connected_instagram_account,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Auth failed");
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
