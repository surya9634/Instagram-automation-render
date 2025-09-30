import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();
const app = express();

const CLIENT_ID = process.env.CLIENT_ID; // Your Instagram App ID
const CLIENT_SECRET = process.env.CLIENT_SECRET; // Your Instagram App Secret
const REDIRECT_URI = process.env.REDIRECT_URI || "https://instagram-automation-render.onrender.com/auth/callback";

let userToken = null;

app.get("/", (req, res) => {
  res.send(`<a href="https://www.instagram.com/oauth/authorize
    ?client_id=${CLIENT_ID}
    &redirect_uri=${REDIRECT_URI}
    &scope=instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments,instagram_business_content_publish,instagram_business_manage_insights,pages_show_list,pages_manage_metadata,pages_read_engagement,pages_messaging
    &response_type=code">Connect Instagram</a>`);
});

// Step 1: Callback from Instagram
app.get("/auth/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.send("No code received!");

  try {
    // Step 2: Exchange code for token
    const tokenRes = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "authorization_code",
        redirect_uri: REDIRECT_URI,
        code,
      }),
    });

    const tokenData = await tokenRes.json();
    if (tokenData.error) return res.send("Error: " + JSON.stringify(tokenData));

    userToken = tokenData.access_token;

    // Step 3: Exchange for long-lived token
    const longRes = await fetch(
      `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${CLIENT_SECRET}&access_token=${userToken}`
    );
    const longData = await longRes.json();
    if (longData.error) return res.send("Error: " + JSON.stringify(longData));

    userToken = longData.access_token;

    // Step 4: Get FB Pages the user manages
    const pagesRes = await fetch(
      `https://graph.facebook.com/v21.0/me/accounts?access_token=${userToken}`
    );
    const pagesData = await pagesRes.json();

    if (!pagesData.data || pagesData.data.length === 0) {
      return res.send("No Facebook Pages found. Make sure your IG is a business account linked to a Page.");
    }

    // Step 5: Check IG connection for each Page
    let output = `<h2>Select a Page to connect Instagram:</h2><ul>`;
    for (let page of pagesData.data) {
      const pageId = page.id;
      const pageToken = page.access_token;

      const igRes = await fetch(
        `https://graph.facebook.com/v21.0/${pageId}?fields=connected_instagram_account&access_token=${pageToken}`
      );
      const igData = await igRes.json();

      if (igData.connected_instagram_account) {
        output += `<li>✅ Page: ${page.name} → Connected IG ID: ${igData.connected_instagram_account.id}</li>`;
      } else {
        output += `<li>⚠️ Page: ${page.name} → No IG linked. Please go to <a href="https://business.facebook.com/settings/pages/${pageId}?tab=linked_accounts" target="_blank">Page Settings → Linked Accounts</a> to connect IG.</li>`;
      }
    }
    output += `</ul>`;

    res.send(output);
  } catch (err) {
    console.error(err);
    res.send("Error: " + err.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
