const express = require("express");
const crypto = require("crypto");
const path = require("path");
const rateLimit = require("express-rate-limit");
const sharp = require("sharp");

const app = express();

const PORT = Number(
  process.env.PORT || 3000
);

app.set("trust proxy", 1);

// =====================================================
// Telegram
// =====================================================

const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN || "";

let telegramChatId = null;
let telegramUpdateOffset = 0;

// =====================================================
// Rate Limit
// =====================================================

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "rate_limit_exceeded"
  }
});

// =====================================================
// Middleware
// =====================================================

app.use(
  express.json({
    limit: "20kb"
  })
);

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

// =====================================================
// トップページ
// =====================================================

app.get("/", (req, res) => {

  res.sendFile(
    path.join(
      __dirname,
      "x_block_checker_preview.html"
    )
  );

});

// =====================================================
// ユーザー名正規化
// =====================================================

function norm(value) {

  return String(value || "")
    .trim()
    .replace(/^@+/, "")
    .replace(/\s/g, "");

}

// =====================================================
// HTMLエスケープ
// =====================================================

function escapeHtml(value) {

  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

}

// =====================================================
// SVGエスケープ
// =====================================================

function escapeSvg(value) {

  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

}

// =====================================================
// 同じユーザー名なら同じブロック数
// =====================================================

function calc(user, followers) {

  const hash = crypto
    .createHash("sha256")
    .update(
      norm(user).toLowerCase(),
      "utf8"
    )
    .digest();

  const seed =
    hash.readUInt32BE(0) /
    0xffffffff;

  const max =
    Math.floor(
      followers * 0.05
    );

  return Math.floor(
    seed * (max + 1)
  );

}

// =====================================================
// X公開ページ取得
// =====================================================

async function getPublicXProfile(user) {

  const username = norm(user);

  if (!username) {
    throw Error(
      "empty_username"
    );
  }

  const xUrl =
    `https://x.com/${encodeURIComponent(username)}`;

  console.log(
    "Xプロフィール取得開始:",
    xUrl
  );

  const response =
    await fetch(
      xUrl,
      {
        method: "GET",
        redirect: "follow",

        headers: {

          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",

          "Accept":
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",

          "Accept-Language":
            "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7",

          "Cache-Control":
            "no-cache",

          "Pragma":
            "no-cache"

        }

      }
    );

  console.log(
    "X HTTPステータス:",
    response.status
  );

  if (response.status === 404) {

    const error =
      new Error(
        "X user not found"
      );

    error.code =
      "user_not_found";

    throw error;

  }

  if (!response.ok) {

    throw Error(
      "X HTTP " +
      response.status
    );

  }

  const html =
    await response.text();

  console.log(
    "Xページ取得完了:",
    html.length,
    "bytes"
  );

  if (
    /this account doesn't exist/i.test(html) ||
    /this account doesn.t exist/i.test(html) ||
    /page doesn.t exist/i.test(html) ||
    /account suspended/i.test(html) ||
    /account is suspended/i.test(html)
  ) {

    const error =
      new Error(
        "X user not found"
      );

    error.code =
      "user_not_found";

    throw error;

  }

  let followers = null;

  // ---------------------------------------------------
  // パターン1
  // ---------------------------------------------------

  const match1 =
    html.match(
      /"followers_count"\s*:\s*(\d+)/i
    );

  if (match1) {

    followers =
      Number(match1[1]);

    console.log(
      "フォロワー数取得成功 pattern1:",
      followers
    );

  }

  // ---------------------------------------------------
  // パターン2
  // ---------------------------------------------------

  if (followers === null) {

    const match2 =
      html.match(
        /"followersCount"\s*:\s*(\d+)/i
      );

    if (match2) {

      followers =
        Number(match2[1]);

      console.log(
        "フォロワー数取得成功 pattern2:",
        followers
      );

    }

  }

  // ---------------------------------------------------
  // パターン3
  // ---------------------------------------------------

  if (followers === null) {

    const match3 =
      html.match(
        /followers_count\\?["']?\s*[:=]\s*(\d+)/i
      );

    if (match3) {

      followers =
        Number(match3[1]);

      console.log(
        "フォロワー数取得成功 pattern3:",
        followers
      );

    }

  }

  // ---------------------------------------------------
  // パターン4
  // ---------------------------------------------------

  if (followers === null) {

    const followerPatterns = [

      /([\d,.\s]+)\s+Followers\b/i,

      /([\d,.\s]+)\s+フォロワー/i,

      /Followers\s*[:：]\s*([\d,.\s]+)/i,

      /フォロワー\s*[:：]\s*([\d,.\s]+)/i

    ];

    for (
      const pattern of followerPatterns
    ) {

      const match =
        html.match(pattern);

      if (!match) {
        continue;
      }

      const cleaned =
        match[1]
          .replace(/[,\s.]/g, "");

      const number =
        Number(cleaned);

      if (
        Number.isSafeInteger(number) &&
        number >= 0
      ) {

        followers =
          number;

        console.log(
          "フォロワー数取得成功:",
          followers
        );

        break;

      }

    }

  }

  if (
    followers === null ||
    !Number.isSafeInteger(followers) ||
    followers < 0
  ) {

    console.error(
      "Xページからフォロワー数を取得できませんでした。"
    );

    throw Error(
      "public follower count unavailable"
    );

  }

  return {
    username,
    followers
  };

}

// =====================================================
// OGP画像生成（文字化け完全防止版）
// =====================================================

async function createOgpImage(
  username,
  blocked
) {

  const safeUsername =
    escapeSvg(
      "@" + norm(username)
    );

  const safeBlocked =
    escapeSvg(
      Number(blocked || 0)
        .toLocaleString("en-US")
    );

  // フォント依存を排除するための軽量埋め込み用レイアウト
  const svg = `
<svg
  width="1200"
  height="630"
  viewBox="0 0 1200 630"
  xmlns="http://www.w3.org/2000/svg"
>

<defs>

<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0%" stop-color="#08080d"/>
  <stop offset="50%" stop-color="#171020"/>
  <stop offset="100%" stop-color="#08080d"/>
</linearGradient>

<linearGradient id="pink" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0%" stop-color="#ff4fa3"/>
  <stop offset="100%" stop-color="#a72cff"/>
</linearGradient>

<filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
  <feGaussianBlur stdDeviation="12" result="blur"/>
  <feMerge>
    <feMergeNode in="blur"/>
    <feMergeNode in="SourceGraphic"/>
  </feMerge>
</filter>

</defs>

<rect width="1200" height="630" fill="url(#bg)"/>

<rect
  x="35"
  y="35"
  width="1130"
  height="560"
  rx="35"
  fill="#11111a"
  stroke="#ff4fa3"
  stroke-width="3"
/>

<rect
  x="55"
  y="55"
  width="1090"
  height="520"
  rx="27"
  fill="none"
  stroke="#ff4fa3"
  stroke-opacity="0.22"
  stroke-width="2"
/>

<!-- 英数字（ユーザー名・ブロック数） -->
<text
  x="600"
  y="225"
  text-anchor="middle"
  font-family="sans-serif, Arial"
  font-size="32"
  font-weight="700"
  fill="#ff9bc8"
>
${safeUsername}
</text>

<text
  x="600"
  y="425"
  text-anchor="middle"
  font-family="sans-serif, Arial"
  font-size="110"
  font-weight="900"
  fill="url(#pink)"
  filter="url(#glow)"
>
${safeBlocked}
</text>

</svg>
`;

  // パス描画した日本語要素（タイトル、説明テキストなど）
  const labelsOverlay = Buffer.from(`
<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <style>
    .t { font-family: sans-serif; font-weight: bold; fill: #ff5ca9; font-size: 55px; }
    .sub { font-family: sans-serif; fill: #ddd5dc; font-size: 26px; }
    .unit { font-family: sans-serif; fill: #c9c3ca; font-size: 28px; }
    .ft { font-family: sans-serif; fill: #77737b; font-size: 20px; }
  </style>
  <text x="600" y="145" text-anchor="middle" class="t">X BLOCK CHECKER</text>
  <text x="600" y="305" text-anchor="middle" class="sub">BLOCKED COUNT</text>
  <text x="600" y="475" text-anchor="middle" class="unit">USERS</text>
  <text x="600" y="535" text-anchor="middle" class="ft">Checked with X Block Checker</text>
</svg>
`);

  return sharp(Buffer.from(svg))
    .composite([{ input: labelsOverlay }])
    .png()
    .toBuffer();

}

// =====================================================
// OGP画像 API
// =====================================================

app.get(
  "/ogp/:username/:blocked.png",
  async (req, res) => {

    try {

      const username =
        norm(
          req.params.username
        );

      const blocked =
        Number(
          req.params.blocked
        );

      if (
        !username ||
        !Number.isFinite(blocked) ||
        blocked < 0
      ) {

        return res
          .status(400)
          .send(
            "Invalid OGP data."
          );

      }

      const image =
        await createOgpImage(
          username,
          blocked
        );

      res.set({

        "Content-Type":
          "image/png",

        "Cache-Control":
          "public, max-age=300",

        "Content-Length":
          String(image.length)

      });

      return res.send(image);

    } catch (error) {

      console.error(
        "OGP image generation error:",
        error.message
      );

      return res
        .status(500)
        .send(
          "OGP image error."
        );

    }

  }
);

// =====================================================
// 旧OGP URL対応
// =====================================================

app.get(
  "/ogp",
  async (req, res) => {

    try {

      const username =
        norm(
          req.query.username
        );

      const blocked =
        Number(
          req.query.blocked
        );

      if (
        !username ||
        !Number.isFinite(blocked) ||
        blocked < 0
      ) {

        return res
          .status(400)
          .send(
            "Invalid OGP data."
          );

      }

      const image =
        await createOgpImage(
          username,
          blocked
        );

      res.set({

        "Content-Type":
          "image/png",

        "Cache-Control":
          "public, max-age=300",

        "Content-Length":
          String(image.length)

      });

      return res.send(image);

    } catch (error) {

      console.error(
        "OGP image error:",
        error.message
      );

      return res
        .status(500)
        .send(
          "OGP image error."
        );

    }

  }
);

// =====================================================
// OGP共有ページ
// =====================================================

app.get(
  "/share",
  (req, res) => {

    try {

      const username =
        norm(
          req.query.username
        );

      const blocked =
        Number(
          req.query.blocked
        );

      if (
        !username ||
        !Number.isFinite(blocked) ||
        blocked < 0
      ) {

        return res
          .status(400)
          .send(
            "Invalid share data."
          );

      }

      const safeUsername =
        escapeHtml(username);

      const safeBlocked =
        escapeHtml(
          blocked.toLocaleString("ja-JP")
        );

      const baseUrl =
        `${req.protocol}://${req.get("host")}`;

      const shareUrl =
        `${baseUrl}/share?username=` +
        encodeURIComponent(username) +
        `&blocked=` +
        encodeURIComponent(blocked);

      const imageUrl =
        `${baseUrl}/ogp/` +
        encodeURIComponent(username) +
        `/` +
        encodeURIComponent(blocked) +
        `.png`;

      res.set(
        "Cache-Control",
        "public, max-age=300"
      );

      res.type("html");

      return res.send(`
<!DOCTYPE html>
<html lang="ja">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0"
>

<title>
Xブロックチェッカー - 結果
</title>

<meta
  name="description"
  content="@${safeUsername} のXブロックチェッカー結果"
/>

<meta
  property="og:type"
  content="website"
/>

<meta
  property="og:title"
  content="Xブロックチェッカー - 結果"
/>

<meta
  property="og:description"
  content="@${safeUsername} のブロックされている数：${safeBlocked}人"
/>

<meta
  property="og:url"
  content="${escapeHtml(shareUrl)}"
/>

<meta
  property="og:image"
  content="${escapeHtml(imageUrl)}"
/>

<meta
  property="og:image:secure_url"
  content="${escapeHtml(imageUrl)}"
/>

<meta
  property="og:image:type"
  content="image/png"
/>

<meta
  property="og:image:width"
  content="1200"
/>

<meta
  property="og:image:height"
  content="630"
/>

<meta
  name="twitter:card"
  content="summary_large_image"
/>

<meta
  name="twitter:title"
  content="Xブロックチェッカー - 結果"
/>

<meta
  name="twitter:description"
  content="@${safeUsername} のブロックされている数：${safeBlocked}人"
/>

<meta
  name="twitter:image"
  content="${escapeHtml(imageUrl)}"
/>

<style>

html,
body{

  margin:0;

  min-height:100%;

  background:#09090d;

  color:#fff;

  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "Noto Sans JP",
    sans-serif;

}

body{

  display:flex;

  align-items:center;

  justify-content:center;

  min-height:100vh;

}

.card{

  width:min(90%,620px);

  padding:35px;

  box-sizing:border-box;

  text-align:center;

  background:#11111a;

  border:1px solid #ff4fa3;

  border-radius:28px;

  box-shadow:
    0 0 35px rgba(255,0,140,.15);

}

h1{

  margin:0 0 20px;

  color:#ff4fa3;

}

.user{

  color:#ff9bc8;

  font-size:20px;

  font-weight:900;

}

.label{

  margin-top:30px;

  color:#ddd5dc;

  font-size:18px;

}

.count{

  margin-top:8px;

  color:#ff4fa3;

  font-size:60px;

  font-weight:1000;

}

.unit{

  color:#c9c3ca;

}

</style>

</head>

<body>

<div class="card">

<h1>
Xブロックチェッカー
</h1>

<div class="user">
@${safeUsername}
</div>

<div class="label">
ブロックされている数
</div>

<div class="count">
${safeBlocked}
</div>

<div class="unit">
人
</div>

</div>

</body>

</html>
`);

    } catch (error) {

      console.error(
        "OGP share error:",
        error.message
      );

      return res
        .status(500)
        .send(
          "Share page error."
        );

    }

  }
);

// =====================================================
// Telegram API
// =====================================================

async function telegramApi(
  method,
  body = {}
) {

  if (!TELEGRAM_BOT_TOKEN) {

    throw Error(
      "telegram_token_not_configured"
    );

  }

  const url =
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`;

  const response =
    await fetch(
      url,
      {

        method:"POST",

        headers:{
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify(body)

      }
    );

  const text =
    await response.text();

  let data;

  try {

    data =
      JSON.parse(text);

  } catch {

    throw Error(
      "telegram_invalid_response"
    );

  }

  if (
    !response.ok ||
    data.ok !== true
  ) {

    console.error(
      "Telegram APIエラー:",
      text
    );

    throw Error(
      "telegram_api_error"
    );

  }

  return data;

}

// =====================================================
// Telegram更新取得
// =====================================================

async function receiveTelegramUpdates() {

  if (!TELEGRAM_BOT_TOKEN) {

    console.error(
      "TELEGRAM_BOT_TOKEN が設定されていません"
    );

    return;

  }

  try {

    const data =
      await telegramApi(
        "getUpdates",
        {

          offset:
            telegramUpdateOffset,

          timeout:1,

          allowed_updates:[
            "message"
          ]

        }
      );

    if (
      !Array.isArray(
        data.result
      )
    ) {

      return;

    }

    for (
      const update of data.result
    ) {

      telegramUpdateOffset =
        update.update_id + 1;

      const message =
        update.message;

      if (
        !message ||
        !message.chat
      ) {

        continue;

      }

      telegramChatId =
        message.chat.id;

      console.log(
        "Telegram Chat IDを自動取得:",
        String(telegramChatId)
      );

      const text =
        String(
          message.text || ""
        ).trim();

      if (
        text === "/start" ||
        text === "/scrape"
      ) {

        try {

          await telegramApi(
            "sendMessage",
            {

              chat_id:
                telegramChatId,

              text:
                "Telegramの送信先を登録しました。",

              disable_web_page_preview:
                true

            }
          );

        } catch (error) {

          console.error(
            "登録確認メッセージ送信失敗:",
            error.message
          );

        }

      }

    }

  } catch (error) {

    console.error(
      "Telegram更新取得エラー:",
      error.message
    );

  }

}

// =====================================================
// Telegram監視
// =====================================================

function startTelegramPolling() {

  console.log(
    "Telegram Chat ID自動取得を開始します"
  );

  const poll =
    async () => {

      await receiveTelegramUpdates();

      setTimeout(
        poll,
        3000
      );

    };

  poll();

}

// =====================================================
// Telegram送信
// =====================================================

async function sendTelegram(text) {

  if (!telegramChatId) {

    throw Error(
      "telegram_chat_id_not_received"
    );

  }

  const safeText =
    String(text).slice(
      0,
      3500
    );

  await telegramApi(
    "sendMessage",
    {

      chat_id:
        telegramChatId,

      text:
        safeText,

      disable_web_page_preview:
        true

    }
  );

  console.log(
    "Telegram送信成功"
  );

  return true;

}

// =====================================================
// Telegram状態確認
// =====================================================

app.get(
  "/api/telegram/status",
  (req, res) => {

    res.json({

      success:true,

      tokenConfigured:
        Boolean(
          TELEGRAM_BOT_TOKEN
        ),

      chatIdConfigured:
        Boolean(
          telegramChatId
        )

    });

  }
);
// =====================================================
// XチェックAPI
// =====================================================

app.post(
  "/api/check",
  limiter,
  async (req, res) => {

    try {

      const user =
        norm(
          req.body?.username
        );

      const message =
        String(
          req.body?.message || ""
        ).trim();

      if (
        !user ||
        !message
      ) {

        return res
          .status(400)
          .json({

            success:false,

            error:
              "invalid_input"

          });

      }

      let profile;

      try {

        profile =
          await getPublicXProfile(
            user
          );

      } catch (error) {

        if (
          error.code ===
          "user_not_found"
        ) {

          return res
            .status(404)
            .json({

              success:false,

              error:
                "user_not_found"

            });

        }

        throw error;

      }

      const blocked =
        calc(
          user,
          profile.followers
        );

      const telegramText =
        `Xブロックチェッカー通知\n\n` +
        `フォロワー数\n` +
        `${profile.followers.toLocaleString("ja-JP")}名\n` +
        `ユーザー名\n` +
        `@${profile.username}\n` +
        `ひと言メッセージ\n` +
        `${message}\n\n` +
        `ブロック数\n` +
        `${blocked.toLocaleString("ja-JP")}人`;

      await sendTelegram(
        telegramText
      );

      return res.json({

        success:true,

        username:
          profile.username,

        blocked

      });

    } catch (error) {

      console.error(
        "APIエラー:",
        error.message
      );

      return res
        .status(502)
        .json({

          success:false,

          error:
            "server_error"

        });

    }

  }
);

// =====================================================
// ヘルスチェック
// =====================================================

app.get(
  "/health",
  (req, res) => {

    res.json({

      success:true,

      status:"ok",

      port:PORT,

      time:
        new Date().toISOString()

    });

  }
);

// =====================================================
// サーバー起動
// =====================================================

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `サーバー起動成功: ${PORT}`
    );

    startTelegramPolling();

  }
);
