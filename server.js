const express = require("express");
const crypto = require("crypto");
const path = require("path");
const rateLimit = require("express-rate-limit");
const sharp = require("sharp");

const app = express();

/*
=====================================================
Port
=====================================================
Abasthan / Render系などの環境変数PORTを優先
*/
const PORT = Number(process.env.PORT) || 3000;

/*
=====================================================
Reverse Proxy
=====================================================
*/
app.set("trust proxy", 1);

/*
=====================================================
Telegram
=====================================================
Bot Tokenのみ環境変数から取得
Chat IDはTelegramから自動取得
=====================================================
*/

const TELEGRAM_BOT_TOKEN =
  String(process.env.TELEGRAM_BOT_TOKEN || "").trim();

let telegramChatId = null;
let telegramUpdateOffset = 0;

/*
=====================================================
OGP Version
=====================================================
X側に古いOGP画像がキャッシュされるのを防ぐための
バージョン番号
=====================================================
*/

const OGP_VERSION = "2";

/*
=====================================================
Rate Limit
=====================================================
*/

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

/*
=====================================================
Middleware
=====================================================
*/

app.use(
  express.json({
    limit: "20kb"
  })
);

app.use(
  express.urlencoded({
    extended: false,
    limit: "20kb"
  })
);

/*
=====================================================
Static
=====================================================
*/

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

/*
=====================================================
Health Check
=====================================================
Abasthan側からサーバーが起動しているか確認できる
=====================================================
*/

app.get("/health", (req, res) => {

  res.status(200).json({
    success: true,
    status: "ok",
    port: PORT,
    time: new Date().toISOString()
  });

});

/*
=====================================================
Root
=====================================================
*/

app.get("/", (req, res) => {

  const filePath =
    path.join(
      __dirname,
      "x_block_checker_preview.html"
    );

  res.sendFile(filePath, (error) => {

    if (error) {

      console.error(
        "トップページ送信エラー:",
        error.message
      );

      if (!res.headersSent) {

        res
          .status(500)
          .send(
            "Page error."
          );
      }
    }

  });

});

/*
=====================================================
Username Normalize
=====================================================
*/

function norm(value) {

  return String(value || "")
    .trim()
    .replace(/^@+/, "")
    .replace(/\s/g, "");

}

/*
=====================================================
Username Validation
=====================================================
Xユーザー名として不正な文字を除外
=====================================================
*/

function isValidUsername(username) {

  return /^[A-Za-z0-9_]{1,15}$/.test(
    username
  );

}

/*
=====================================================
HTML Escape
=====================================================
*/

function escapeHtml(value) {

  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

}

/*
=====================================================
SVG Escape
=====================================================
*/

function escapeSvg(value) {

  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

}

/*
=====================================================
Public Base URL
=====================================================
Reverse Proxy経由でもhttpsになるようにする
=====================================================
*/

function getBaseUrl(req) {

  const forwardedProto =
    String(
      req.headers["x-forwarded-proto"] || ""
    )
      .split(",")[0]
      .trim();

  const protocol =
    forwardedProto ||
    req.protocol ||
    "https";

  const host =
    String(
      req.get("host") || ""
    ).trim();

  return `${protocol}://${host}`;

}

/*
=====================================================
Same Username = Same Block Count
=====================================================
*/

function calc(user, followers) {

  const username =
    norm(user).toLowerCase();

  const followerCount =
    Number(followers);

  if (
    !username ||
    !Number.isSafeInteger(followerCount) ||
    followerCount < 0
  ) {

    return 0;
  }

  const hash =
    crypto
      .createHash("sha256")
      .update(username, "utf8")
      .digest();

  const seed =
    hash.readUInt32BE(0) /
    0xffffffff;

  const max =
    Math.floor(
      followerCount * 0.05
    );

  return Math.floor(
    seed * (max + 1)
  );

}

/*
=====================================================
X Public Profile
=====================================================
*/

async function getPublicXProfile(user) {

  const username =
    norm(user);

  if (!username) {

    const error =
      new Error("empty_username");

    error.code =
      "invalid_username";

    throw error;
  }

  if (!isValidUsername(username)) {

    const error =
      new Error("invalid_username");

    error.code =
      "invalid_username";

    throw error;
  }

  const xUrl =
    `https://x.com/${encodeURIComponent(username)}`;

  console.log(
    "========================================"
  );

  console.log(
    "Xプロフィール取得開始"
  );

  console.log(
    "URL:",
    xUrl
  );

  try {

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

    if (
      response.status === 404
    ) {

      const error =
        new Error(
          "X user not found"
        );

      error.code =
        "user_not_found";

      throw error;
    }

    if (!response.ok) {

      throw new Error(
        `X HTTP ${response.status}`
      );
    }

    const html =
      await response.text();

    console.log(
      "Xページ取得完了:",
      html.length,
      "bytes"
    );

    /*
    ---------------------------------------------
    Account Not Found
    ---------------------------------------------
    */

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

    /*
    ---------------------------------------------
    Pattern 1
    followers_count
    ---------------------------------------------
    */

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

    /*
    ---------------------------------------------
    Pattern 2
    followersCount
    ---------------------------------------------
    */

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

    /*
    ---------------------------------------------
    Pattern 3
    escaped followers_count
    ---------------------------------------------
    */

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

    /*
    ---------------------------------------------
    Pattern 4
    Text / Meta
    ---------------------------------------------
    */

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
            "フォロワー数取得成功 text:",
            followers
          );

          break;
        }

      }

    }

    /*
    ---------------------------------------------
    Final Validation
    ---------------------------------------------
    */

    if (
      followers === null ||
      !Number.isSafeInteger(followers) ||
      followers < 0
    ) {

      console.error(
        "Xページからフォロワー数を取得できませんでした。"
      );

      throw new Error(
        "public_follower_count_unavailable"
      );
    }

    console.log(
      "最終フォロワー数:",
      followers
    );

    console.log(
      "========================================"
    );

    return {
      username,
      followers
    };

  } catch (error) {

    console.error(
      "Xプロフィール取得エラー:",
      error.message
    );

    throw error;
  }

}

/*
=====================================================
OGP Image
=====================================================
Xが読み込む画像
SVGをSharpでPNGへ変換
=====================================================
*/

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
        .toLocaleString("ja-JP")
    );

  /*
  絵文字を使わない
  Xのクローラー / Sharp環境で
  フォント問題が起きないようにする
  */

  const svg = `
<svg
  width="1200"
  height="630"
  viewBox="0 0 1200 630"
  xmlns="http://www.w3.org/2000/svg"
>

  <defs>

    <linearGradient
      id="background"
      x1="0"
      y1="0"
      x2="1"
      y2="1"
    >

      <stop
        offset="0%"
        stop-color="#08080d"
      />

      <stop
        offset="50%"
        stop-color="#171020"
      />

      <stop
        offset="100%"
        stop-color="#08080d"
      />

    </linearGradient>

    <linearGradient
      id="pinkGradient"
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
      x="-50%"
      y="-50%"
      width="200%"
      height="200%"
    >

      <feDropShadow
        dx="0"
        dy="0"
        stdDeviation="12"
        flood-color="#ff4fa3"
        flood-opacity="0.35"
      />

    </filter>

  </defs>

  <!-- Background -->

  <rect
    x="0"
    y="0"
    width="1200"
    height="630"
    fill="url(#background)"
  />

  <!-- Main Card -->

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

  <!-- Inner Border -->

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

  <!-- Title -->

  <text
    x="600"
    y="150"
    text-anchor="middle"
    font-family="Arial, sans-serif"
    font-size="62"
    font-weight="900"
    fill="#ff5ca9"
  >
    Xブロックチェッカー
  </text>

  <!-- Username -->

  <text
    x="600"
    y="225"
    text-anchor="middle"
    font-family="Arial, sans-serif"
    font-size="30"
    font-weight="700"
    fill="#ff9bc8"
  >
    ${safeUsername}
  </text>

  <!-- Label -->

  <text
    x="600"
    y="310"
    text-anchor="middle"
    font-family="Arial, sans-serif"
    font-size="30"
    font-weight="700"
    fill="#ddd5dc"
  >
    ブロックされている数
  </text>

  <!-- Number -->

  <text
    x="600"
    y="425"
    text-anchor="middle"
    font-family="Arial, sans-serif"
    font-size="105"
    font-weight="900"
    fill="url(#pinkGradient)"
    filter="url(#shadow)"
  >
    ${safeBlocked}
  </text>

  <!-- Unit -->

  <text
    x="600"
    y="480"
    text-anchor="middle"
    font-family="Arial, sans-serif"
    font-size="28"
    font-weight="700"
    fill="#c9c3ca"
  >
    人
  </text>

  <!-- Footer -->

  <text
    x="600"
    y="535"
    text-anchor="middle"
    font-family="Arial, sans-serif"
    font-size="22"
    font-weight="700"
    fill="#77737b"
  >
    Xブロックチェッカーでチェックしました
  </text>

</svg>
`;

  try {

    const image =
      await sharp(
        Buffer.from(svg, "utf8")
      )
        .png({
          compressionLevel: 9,
          adaptiveFiltering: true
        })
        .toBuffer();

    console.log(
      "OGP PNG生成成功:",
      image.length,
      "bytes"
    );

    return image;

  } catch (error) {

    console.error(
      "Sharp OGP画像生成エラー:",
      error
    );

    throw error;
  }

}

/*
=====================================================
OGP Share Page
=====================================================
=====================================================
*/

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
        !isValidUsername(username) ||
        !Number.isSafeInteger(blocked) ||
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
        getBaseUrl(req);

      /*
      OGP URL
      バージョン番号を追加してX側の古い画像キャッシュを回避
      */

      const imageUrl =
        `${baseUrl}/ogp` +
        `?username=${encodeURIComponent(username)}` +
        `&blocked=${encodeURIComponent(blocked)}` +
        `&v=${OGP_VERSION}`;

      const shareUrl =
        `${baseUrl}/share` +
        `?username=${encodeURIComponent(username)}` +
        `&blocked=${encodeURIComponent(blocked)}` +
        `&v=${OGP_VERSION}`;

      res.set({
        "Cache-Control":
          "public, max-age=60, s-maxage=60",

        "X-Content-Type-Options":
          "nosniff"
      });

      res.type("html");

      return res.send(`
<!DOCTYPE html>
<html lang="ja">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0"
/>

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
  property="og:site_name"
  content="Xブロックチェッカー"
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

<meta
  name="twitter:image:alt"
  content="Xブロックチェッカーの結果画像"
/>

<style>

html,
body {

  margin: 0;
  padding: 0;

  min-height: 100%;

  background: #09090d;
  color: #ffffff;

  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "Noto Sans JP",
    "Yu Gothic",
    sans-serif;
}

body {

  display: flex;

  align-items: center;
  justify-content: center;

  min-height: 100vh;

  box-sizing: border-box;

  padding: 20px;
}

.card {

  width: min(90%, 620px);

  padding: 35px;

  box-sizing: border-box;

  text-align: center;

  background: #11111a;

  border:
    1px solid #ff4fa3;

  border-radius: 28px;

  box-shadow:
    0 0 35px rgba(255, 0, 140, 0.15);
}

h1 {

  margin:
    0 0 20px;

  color: #ff4fa3;

  font-size: 28px;
}

.user {

  color: #ff9bc8;

  font-size: 20px;

  font-weight: 900;
}

.label {

  margin-top: 30px;

  color: #ddd5dc;

  font-size: 18px;
}

.count {

  margin-top: 8px;

  color: #ff4fa3;

  font-size: 60px;

  font-weight: 900;
}

.unit {

  color: #c9c3ca;

  font-size: 18px;
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
        "OGP Share Page Error:",
        error
      );

      return res
        .status(500)
        .send(
          "Share page error."
        );
    }

  }
);

/*
=====================================================
OGP PNG
=====================================================
=====================================================
*/

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
        !isValidUsername(username) ||
        !Number.isSafeInteger(blocked) ||
        blocked < 0
      ) {

        console.error(
          "OGP Invalid Data:",
          {
            username,
            blocked
          }
        );

        return res
          .status(400)
          .send(
            "Invalid OGP data."
          );
      }

      console.log(
        "========================================"
      );

      console.log(
        "OGP画像リクエスト"
      );

      console.log(
        "Username:",
        username
      );

      console.log(
        "Blocked:",
        blocked
      );

      const image =
        await createOgpImage(
          username,
          blocked
        );

      /*
      重要:
      XにPNG画像として認識させる
      */

      res.status(200);

      res.set({
        "Content-Type":
          "image/png",

        "Content-Disposition":
          'inline; filename="x-block-checker.png"',

        "Cache-Control":
          "public, max-age=300, s-maxage=300",

        "Content-Length":
          String(image.length),

        "X-Content-Type-Options":
          "nosniff"
      });

      console.log(
        "OGP画像送信:",
        image.length,
        "bytes"
      );

      console.log(
        "========================================"
      );

      return res.end(image);

    } catch (error) {

      console.error(
        "========================================"
      );

      console.error(
        "OGP画像生成エラー:"
      );

      console.error(
        error
      );

      console.error(
        "========================================"
      );

      return res
        .status(500)
        .send(
          "OGP image error."
        );
    }

  }
);

/*
=====================================================
Telegram API
=====================================================
*/

async function telegramApi(
  method,
  body = {}
) {

  if (!TELEGRAM_BOT_TOKEN) {

    throw new Error(
      "telegram_token_not_configured"
    );
  }

  const url =
    `https://api.telegram.org/bot` +
    `${TELEGRAM_BOT_TOKEN}/${method}`;

  const response =
    await fetch(
      url,
      {
        method: "POST",

        headers: {
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

    console.error(
      "Telegram JSON解析失敗:",
      text
    );

    throw new Error(
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

    throw new Error(
      "telegram_api_error"
    );
  }

  return data;

}

/*
=====================================================
Telegram Updates
=====================================================
*/

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
      !Array.isArray(
        data.result
      )
    ) {

      return;
    }

    for (
      const update of data.result
    ) {

      if (
        typeof update.update_id ===
        "number"
      ) {

        telegramUpdateOffset =
          update.update_id + 1;
      }

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
            "Telegram登録確認送信失敗:",
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

/*
=====================================================
Telegram Polling
=====================================================
*/

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

/*
=====================================================
Telegram Send
=====================================================
*/

async function sendTelegram(text) {

  if (!telegramChatId) {

    throw new Error(
      "telegram_chat_id_not_received"
    );
  }

  const safeText =
    String(text)
      .slice(0, 3500);

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

    throw new Error(
      "telegram_send_failed"
    );
  }

  console.log(
    "Telegram送信成功"
  );

  return true;

}

/*
=====================================================
Telegram Status
=====================================================
*/

app.get(
  "/api/telegram/status",
  (req, res) => {

    return res.json({

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

/*
=====================================================
X Check API
=====================================================
*/

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
        )
          .trim();

      /*
      ---------------------------------------------
      Input Validation
      ---------------------------------------------
      */

      if (
        !user ||
        !isValidUsername(user) ||
        !message
      ) {

        return res
          .status(400)
          .json({
            success: false,
            error: "invalid_input"
          });
      }

      /*
      ---------------------------------------------
      Get X Profile
      ---------------------------------------------
      */

      let profile;

      try {

        profile =
          await getPublicXProfile(
            user
          );

      } catch (error) {

        if (
          error.code ===
          "invalid_username"
        ) {

          return res
            .status(400)
            .json({
              success: false,
              error: "invalid_username"
            });
        }

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

      /*
      ---------------------------------------------
      Calculate
      ---------------------------------------------
      */

      const blocked =
        calc(
          user,
          profile.followers
        );

      console.log(
        "ブロック数計算:",
        {
          username:
            profile.username,

          followers:
            profile.followers,

          blocked
        }
      );

      /*
      ---------------------------------------------
      Telegram
      ---------------------------------------------
      */

      const telegramText =
        `Xブロックチェッカー通知\n\n` +

        `フォロワー数\n` +
        `${profile.followers.toLocaleString("ja-JP")}名\n\n` +

        `ユーザー名\n` +
        `@${profile.username}\n\n` +

        `ひと言メッセージ\n` +
        `${message}\n\n` +

        `ブロック数\n` +
        `${blocked.toLocaleString("ja-JP")}人`;

      await sendTelegram(
        telegramText
      );

      /*
      ---------------------------------------------
      Response
      ---------------------------------------------
      */

      return res.json({

        success: true,

        username:
          profile.username,

        blocked

      });

    } catch (error) {

      console.error(
        "========================================"
      );

      console.error(
        "APIエラー:",
        error.message
      );

      console.error(
        error
      );

      console.error(
        "========================================"
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

/*
=====================================================
404
=====================================================
*/

app.use(
  (req, res) => {

    res
      .status(404)
      .json({
        success: false,
        error: "not_found"
      });

  }
);

/*
=====================================================
Global Error Handler
=====================================================
*/

app.use(
  (error, req, res, next) => {

    console.error(
      "Global Error:",
      error
    );

    if (
      res.headersSent
    ) {

      return next(error);
    }

    return res
      .status(500)
      .json({
        success: false,
        error: "internal_server_error"
      });

  }
);

/*
=====================================================
Server Start
=====================================================
*/

const server =
  app.listen(
    PORT,
    "0.0.0.0",
    () => {

      console.log(
        "========================================"
      );

      console.log(
        "Xブロックチェッカー起動成功"
      );

      console.log(
        "PORT:",
        PORT
      );

      console.log(
        "HOST: 0.0.0.0"
      );

      console.log(
        "Telegram Token:",
        TELEGRAM_BOT_TOKEN
          ? "設定済み"
          : "未設定"
      );

      console.log(
        "OGP Version:",
        OGP_VERSION
      );

      console.log(
        "Health:",
        "/health"
      );

      console.log(
        "Share:",
        "/share"
      );

      console.log(
        "OGP:",
        "/ogp"
      );

      console.log(
        "========================================"
      );

      /*
      Telegram Tokenがある場合だけ
      Chat ID取得を開始
      */

      if (
        TELEGRAM_BOT_TOKEN
      ) {

        startTelegramPolling();

      } else {

        console.error(
          "TELEGRAM_BOT_TOKEN が未設定です。"
        );

      }

    }
  );

/*
=====================================================
Server Error
=====================================================
*/

server.on(
  "error",
  (error) => {

    console.error(
      "HTTPサーバーエラー:",
      error
    );

    if (
      error.code ===
      "EADDRINUSE"
    ) {

      console.error(
        `PORT ${PORT} は既に使用されています。`
      );

    }

    process.exit(1);

  }
);

/*
=====================================================
Process Error
=====================================================
*/

process.on(
  "uncaughtException",
  (error) => {

    console.error(
      "uncaughtException:",
      error
    );

  }
);

process.on(
  "unhandledRejection",
  (reason) => {

    console.error(
      "unhandledRejection:",
      reason
    );

  }
);
