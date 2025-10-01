import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Home page: link to start IG login
app.get("/", (req, res) => {
  const authUrl = `https://www.instagram.com/oauth/authorize?client_id=${process.env.APP_ID}&redirect_uri=${process.env.REDIRECT_URI}&scope=instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments,instagram_business_content_publish,instagram_business_manage_insights,pages_show_list,pages_manage_metadata,pages_messaging&response_type=code&force_reauth=true`;

  res.send(`
    <h2>🚀 Instagram Automation Login</h2>
    <a href="${authUrl}">
      <button style="padding:10px 20px;font-size:16px;">Connect Instagram</button>
    </a>
  `);
});

// OAuth callback
app.get("/auth/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send("❌ No code received");

  try {
    // 1. Exchange code for access token
    const tokenResp = await axios.get("https://graph.facebook.com/v21.0/oauth/access_token", {
      params: {
        client_id: process.env.APP_ID,
        client_secret: process.env.APP_SECRET,
        redirect_uri: process.env.REDIRECT_URI,
        code
      }
    });

    const userAccessToken = tokenResp.data.access_token;
    console.log("✅ User Access Token:", userAccessToken);

    // 2. Fetch Pages the user manages
    const pagesResp = await axios.get("https://graph.facebook.com/v21.0/me/accounts", {
      params: { access_token: userAccessToken }
    });

    const pages = pagesResp.data.data;
    console.log("📄 User Pages:", pages);

    if (!pages.length) {
      return res.send("❌ No Facebook Pages connected to this account.");
    }

    // 3. Find your platform’s Page
    const platformPage = pages.find(p => p.id === process.env.PLATFORM_PAGE_ID);
    if (!platformPage) {
      return res.send("❌ User does not manage the required FB Page. Please connect your IG to our Page first.");
    }

    const pageAccessToken = platformPage.access_token;
    console.log("✅ Platform Page Token:", pageAccessToken);

    // 4. Fetch IG account connected to the Page
    const igResp = await axios.get(
      `https://graph.facebook.com/v21.0/${process.env.PLATFORM_PAGE_ID}`,
      {
        params: {
          fields: "connected_instagram_account",
          access_token: pageAccessToken
        }
      }
    );

    console.log("📸 IG Connected:", igResp.data);

    // 5. Subscribe Page to webhook events (DMs, comments)
    const subResp = await axios.post(
      `https://graph.facebook.com/v21.0/${process.env.PLATFORM_PAGE_ID}/subscribed_apps`,
      {},
      { params: { access_token: pageAccessToken } }
    );

    console.log("🔔 Subscribed:", subResp.data);

    res.json({
      message: "✅ Instagram account connected to your Page successfully!",
      instagramUser: igResp.data,
      subscription: subResp.data
    });
  } catch (err) {
    console.error("❌ Error in callback:", err.response?.data || err.message);
    res.status(500).json(err.response?.data || { error: err.message });
  }
});

app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
