import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

// Step 1: Redirect user to Instagram-styled Meta OAuth
app.get("/auth/instagram", (req, res) => {
  const authUrl = `https://www.instagram.com/accounts/login/?force_authentication&platform_app_id=${process.env.APP_ID}&enable_fb_login&next=${encodeURIComponent(
    `https://www.instagram.com/oauth/authorize/third_party/?redirect_uri=${process.env.REDIRECT_URI}`
  )}`;
  res.redirect(authUrl);
});

// Step 2: Callback - exchange code for token
app.get("/auth/callback", async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).send("No code provided");
  }

  try {
    // Exchange code for short-lived token
    const tokenRes = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?client_id=${process.env.APP_ID}&redirect_uri=${process.env.REDIRECT_URI}&client_secret=${process.env.APP_SECRET}&code=${code}`
    );
    const tokenData = await tokenRes.json();

    if (tokenData.error) {
      return res.status(400).json(tokenData);
    }

    const shortLivedToken = tokenData.access_token;

    // Exchange for long-lived token
    const longRes = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${process.env.APP_ID}&client_secret=${process.env.APP_SECRET}&fb_exchange_token=${shortLivedToken}`
    );
    const longData = await longRes.json();

    const accessToken = longData.access_token;

    // Fetch user pages
    const pagesRes = await fetch(
      `https://graph.facebook.com/v21.0/me/accounts?access_token=${accessToken}`
    );
    const pagesData = await pagesRes.json();

    // Get Instagram account from first Page (demo)
    const pageId = pagesData.data[0].id;
    const igRes = await fetch(
      `https://graph.facebook.com/v21.0/${pageId}?fields=connected_instagram_account&access_token=${accessToken}`
    );
    const igData = await igRes.json();

    res.json({
      accessToken,
      pageId,
      instagramAccount: igData.connected_instagram_account,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error during auth");
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
