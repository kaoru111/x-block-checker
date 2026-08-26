const express = require("express");
const crypto = require("crypto");
const path = require("path");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = Number(process.env.PORT || 3000);

// Abasthanなどのリバースプロキシに対応
app.set("trust proxy", 1);

// =====================================================
// Telegram
// TokenだけAbasthanの環境変数から取得
// Chat IDはTelegramから自動取得
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

app.use(express.json({ limit: "20kb" }));

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
// OGP共有ページ
// 追加部分
// =====================================================

function escapeHtml(value) {

  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeSvg(value) {

  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}


// =====================================================
// OGP結果画像
// =====================================================

app.get(
  "/og/result.svg",
  (req, res) => {

    const username =
      norm(req.query.username);

    const blockedRaw =
      Number(req.query.blocked);

    const blocked =
      Number.isFinite(blockedRaw) &&
      blockedRaw >= 0
        ? Math.floor(blockedRaw)
        : 0;

    const displayUsername =
      "@" + username;

    const displayBlocked =
      blocked.toLocaleString("ja-JP");

    const svg = `
<svg
  xmlns="http://www.w3.org/2000/svg"
  width="1200"
  height="630"
  viewBox="0 0 1200 630"
>
  <defs>

    <linearGradient
      id="bg"
      x1="0"
      y1="0"
      x2="1"
      y2="1"
    >
      <stop
        offset="0%"
        stop-color="#09090d"
      />

      <stop
        offset="50%"
        stop-color="#17111d"
      />

      <stop
        offset="100%"
        stop-color="#09090d"
      />
    </linearGradient>

    <linearGradient
      id="pink"
      x1="0"
      y1="0"
      x2="1"
      y2="1"
    >
      <stop
        offset="0%"
        stop-color="#ff4fa3"
      />

      <stop
        offset="100%"
        stop-color="#a72cff"
      />
    </linearGradient>

    <filter
      id="shadow"
      x="-30%"
      y="-30%"
      width="160%"
      height="160%"
    >
      <feDropShadow
        dx="0"
        dy="8"
        stdDeviation="18"
        flood-color="#000000"
        flood-opacity=".55"
      />
    </filter>

  </defs>


  <rect
    width="1200"
    height="630"
    fill="url(#bg)"
  />


  <circle
    cx="120"
    cy="100"
    r="180"
    fill="#ff3296"
    opacity=".12"
  />


  <circle
    cx="1080"
    cy="520"
    r="220"
    fill="#9632ff"
    opacity=".12"
  />


  <rect
    x="100"
    y="65"
    width="1000"
    height="500"
    rx="45"
    fill="#11111a"
    stroke="#ff4fa3"
    stroke-opacity=".65"
    stroke-width="2"
    filter="url(#shadow)"
  />


  <text
    x="600"
    y="145"
    text-anchor="middle"
    fill="#ff4fa3"
    font-family="Arial, sans-serif"
    font-size="58"
    font-weight="900"
  >
    Xブロックチェッカー
  </text>


  <circle
    cx="600"
    cy="235"
    r="58"
    fill="url(#pink)"
  />


  <text
    x="600"
    y="257"
    text-anchor="middle"
    fill="#ffffff"
    font-family="Arial, sans-serif"
    font-size="44"
    font-weight="900"
  >
    X
  </text>


  <text
    x="600"
    y="335"
    text-anchor="middle"
    fill="#ff9bc8"
    font-family="Arial, sans-serif"
    font-size="30"
    font-weight="700"
  >
    ${escapeSvg(displayUsername)}
  </text>


  <text
    x="600"
    y="395"
    text-anchor="middle"
    fill="#ddd5dc"
    font-family="Arial, sans-serif"
    font-size="28"
    font-weight="700"
  >
    🔒 ブロックされている数
  </text>


  <text
    x="600"
    y="475"
    text-anchor="middle"
    fill="#ff4fa3"
    font-family="Arial, sans-serif"
    font-size="72"
    font-weight="900"
  >
    ${escapeSvg(displayBlocked)}人
  </text>


  <text
    x="600"
    y="525"
    text-anchor="middle"
    fill="#aaa4ae"
    font-family="Arial, sans-serif"
    font-size="20"
    font-weight="600"
  >
    あなたもブロック数をチェックしよう！
  </text>

</svg>
`;

    res.set(
      "Content-Type",
      "image/svg+xml; charset=utf-8"
    );

    res.set(
      "Cache-Control",
      "public, max-age=300"
    );

    res.send(svg);
  }
);


// =====================================================
// OGP共有ページ
// =====================================================

app.get(
  "/share",
  (req, res) => {

    const username =
      norm(req.query.username);

    const blockedRaw =
      Number(req.query.blocked);

    const blocked =
      Number.isFinite(blockedRaw) &&
      blockedRaw >= 0
        ? Math.floor(blockedRaw)
        : 0;

    if (!username) {

      return res
        .status(400)
        .send("Invalid username");
    }


    const baseUrl =
      `${req.protocol}://${req.get("host")}`;


    const shareUrl =
      `${baseUrl}/share?username=` +
      `${encodeURIComponent(username)}` +
      `&blocked=${encodeURIComponent(blocked)}`;


    const imageUrl =
      `${baseUrl}/og/result.svg?username=` +
      `${encodeURIComponent(username)}` +
      `&blocked=${encodeURIComponent(blocked)}`;


    const safeUsername =
      escapeHtml(username);

    const safeBlocked =
      escapeHtml(
        blocked.toLocaleString("ja-JP")
      );


    const html = `
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
  content="Xブロックチェッカーの結果ページです。"
>

<meta
  property="og:type"
  content="website"
>

<meta
  property="og:title"
  content="Xブロックチェッカー - 結果"
>

<meta
  property="og:description"
  content="@${safeUsername} のブロックチェック結果"
>

<meta
  property="og:url"
  content="${escapeHtml(shareUrl)}"
>

<meta
  property="og:image"
  content="${escapeHtml(imageUrl)}"
>

<meta
  property="og:image:width"
  content="1200"
>

<meta
  property="og:image:height"
  content="630"
>

<meta
  name="twitter:card"
  content="summary_large_image"
>

<meta
  name="twitter:title"
  content="Xブロックチェッカー - 結果"
>

<meta
  name="twitter:description"
  content="@${safeUsername} のブロックチェック結果"
>

<meta
  name="twitter:image"
  content="${escapeHtml(imageUrl)}"
>

<style>

*{
  box-sizing:border-box;
}

body{
  margin:0;
  min-height:100vh;
  display:flex;
  align-items:center;
  justify-content:center;
  padding:20px;

  background:
    radial-gradient(
      circle at 15% 15%,
      rgba(255,50,150,.18),
      transparent 25%
    ),
    radial-gradient(
      circle at 85% 80%,
      rgba(150,50,255,.16),
      transparent 28%
    ),
    linear-gradient(
      145deg,
      #09090d 0%,
      #11111a 48%,
      #09090d 100%
    );

  color:#fff;

  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "Noto Sans JP",
    "Yu Gothic",
    sans-serif;
}

.card{
  width:100%;
  max-width:620px;
  padding:35px 25px;
  text-align:center;

  border:
    1px solid
    rgba(255,79,163,.55);

  border-radius:28px;

  background:
    linear-gradient(
      145deg,
      rgba(27,27,38,.98),
      rgba(15,15,23,.98)
    );

  box-shadow:
    0 15px 45px rgba(0,0,0,.55),
    0 0 35px rgba(255,0,140,.10);
}

.logo{
  font-size:36px;
  font-weight:1000;
  color:#ff4fa3;
  margin-bottom:25px;
}

.user{
  color:#ff9bc8;
  font-size:20px;
  font-weight:900;
  margin-bottom:25px;
}

.label{
  color:#ddd5dc;
  font-size:18px;
  font-weight:900;
}

.number{
  margin-top:8px;
  color:#ff4fa3;
  font-size:56px;
  font-weight:1000;
}

.message{
  margin-top:20px;
  color:#aaa4ae;
  font-size:14px;
}

</style>

</head>

<body>

<div class="card">

  <div class="logo">
    Xブロックチェッカー
  </div>

  <div class="user">
    @${safeUsername}
  </div>

  <div class="label">
    🔒 ブロックされている数
  </div>

  <div class="number">
    ${safeBlocked}人
  </div>

  <div class="message">
    あなたもブロック数をチェックしよう！
  </div>

</div>

</body>
</html>
`;

    res.set(
      "Cache-Control",
      "public, max-age=60"
    );

    res.send(html);
  }
);

// =====================================================
// ユーザー名正規化
// =====================================================

const norm = (v) =>
  String(v || "")
    .trim()
    .replace(/^@+/, "")
    .replace(/\s/g, "");

// =====================================================
// 同じユーザー名なら同じブロック数
// =====================================================

function calc(user, followers) {

  const h = crypto
    .createHash("sha256")
    .update(
      norm(user).toLowerCase(),
      "utf8"
    )
    .digest();

  const seed =
    h.readUInt32BE(0) / 0xffffffff;

  const max =
    Math.floor(followers * 0.05);

  return Math.floor(
    seed * (max + 1)
  );
}

// =====================================================
// X公開ページ取得
// User-Agent付き
// =====================================================

async function getPublicXProfile(user) {

  const username = norm(user);

  if (!username) {
    throw Error("empty_username");
  }

  const xUrl =
    `https://x.com/${encodeURIComponent(username)}`;

  console.log(
    "Xプロフィール取得開始:",
    xUrl
  );

  const response = await fetch(
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
      new Error("X user not found");

    error.code =
      "user_not_found";

    throw error;
  }

  if (!response.ok) {
    throw Error(
      "X HTTP " + response.status
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
      new Error("X user not found");

    error.code =
      "user_not_found";

    throw error;
  }

  let followers = null;

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
          "フォロワー数取得成功 meta/text:",
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
// Telegram API呼び出し
// =====================================================

async function telegramApi(method, body = {}) {

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
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body: JSON.stringify(body)
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
// Telegramの更新を取得
// Botに送られたメッセージからChat IDを自動取得
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

          timeout: 1,

          allowed_updates: [
            "message"
          ]
        }
      );

    if (
      !Array.isArray(data.result)
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

          console.log(
            "Telegram登録確認メッセージ送信成功"
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
// Telegram受信監視
// =====================================================

function startTelegramPolling() {

  console.log(
    "Telegram Chat ID自動取得を開始します"
  );

  const poll = async () => {

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
    String(text).slice(0, 3500);

  const data =
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

  if (!data.ok) {
    throw Error(
      "telegram_send_failed"
    );
  }

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

      success: true,

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
            success: false,
            error: "invalid_input"
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
              success: false,
              error: "user_not_found"
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

        success: true,

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
          success: false,
          error: "server_error"
        });
    }
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
      "server listening on port " +
      PORT
    );

    startTelegramPolling();
  }
);
