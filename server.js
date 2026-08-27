const express = require("express");
const crypto = require("crypto");
const path = require("path");
const rateLimit = require("express-rate-limit");
const { createCanvas, GlobalFonts } = require("@napi-rs/canvas");

const app = express();

const PORT = Number(
  process.env.PORT || 3000
);

app.set("trust proxy", 1);

// =====================================================
// フォントの動的ロード（文字化け対策）
// =====================================================

let fontLoaded = false;

async function loadJapaneseFont() {

  if (fontLoaded) return;

  try {

    console.log("日本語フォントの読み込みを開始します...");

    const fontUrl =
      "https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-jp@latest/japanese-400-normal.ttf";

    const res = await fetch(fontUrl);

    if (!res.ok) {
      throw new Error("フォントの取得に失敗しました: " + res.status);
    }

    const arrayBuffer = await res.arrayBuffer();
    const fontBuffer = Buffer.from(arrayBuffer);

    GlobalFonts.register(fontBuffer, "NotoSansJP");
    fontLoaded = true;

    console.log("日本語フォント(NotoSansJP)の登録が完了しました。");

  } catch (error) {

    console.error("フォント読み込みエラー:", error.message);

  }

}

// サーバー起動時にフォント取得を開始
loadJapaneseFont();

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

  const match1 =
    html.match(
      /"followers_count"\s*:\s*(\d+)/i
    );

  if (match1) {

    followers =
      Number(match1[1]);

  }

  if (followers === null) {

    const match2 =
      html.match(
        /"followersCount"\s*:\s*(\d+)/i
      );

    if (match2) {

      followers =
        Number(match2[1]);

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

        break;

      }

    }

  }

  if (
    followers === null ||
    !Number.isSafeInteger(followers) ||
    followers < 0
  ) {

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
// OGP画像生成（日本語フォント完全固定）
// =====================================================

async function createOgpImage(
  username,
  blocked
) {

  await loadJapaneseFont();

  const canvas = createCanvas(1200, 630);
  const ctx = canvas.getContext("2d");

  const fontFamily = fontLoaded ? '"NotoSansJP", sans-serif' : 'sans-serif';

  // 背景グラデーション
  const bgGrad = ctx.createLinearGradient(0, 0, 1200, 630);
  bgGrad.addColorStop(0, "#08080d");
  bgGrad.addColorStop(0.5, "#171020");
  bgGrad.addColorStop(1, "#08080d");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, 1200, 630);

  // 外枠カード
  ctx.fillStyle = "#11111a";
  ctx.strokeStyle = "#ff4fa3";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(35, 35, 1130, 560, 35);
  ctx.fill();
  ctx.stroke();

  // 内枠線
  ctx.strokeStyle = "rgba(255, 79, 163, 0.22)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(55, 55, 1090, 520, 27);
  ctx.stroke();

  ctx.textAlign = "center";

  // タイトル
  ctx.fillStyle = "#ff5ca9";
  ctx.font = `bold 60px ${fontFamily}`;
  ctx.fillText("Xブロックチェッカー", 600, 150);
  // ユーザー名
  ctx.fillStyle = "#ff9bc8";
  ctx.font = `bold 32px ${fontFamily}`;
  ctx.fillText("@" + norm(username), 600, 225);

  // ブロックされている数ラベル
  ctx.fillStyle = "#ddd5dc";
  ctx.font = `bold 28px ${fontFamily}`;
  ctx.fillText("ブロックされている数", 600, 310);

  // 数字 (ピンクグラデーション)
  const pinkGrad = ctx.createLinearGradient(0, 320, 0, 450);
  pinkGrad.addColorStop(0, "#ff4fa3");
  pinkGrad.addColorStop(1, "#a72cff");
  ctx.fillStyle = pinkGrad;
  ctx.font = `900 110px ${fontFamily}`;
  ctx.fillText(Number(blocked || 0).toLocaleString("ja-JP"), 600, 425);

  // 単位
  ctx.fillStyle = "#c9c3ca";
  ctx.font = `bold 28px ${fontFamily}`;
  ctx.fillText("人", 600, 480);

  // フッターテキスト
  ctx.fillStyle = "#77737b";
  ctx.font = `bold 22px ${fontFamily}`;
  ctx.fillText("Xブロックチェッカーでチェックしました", 600, 535);

  return canvas.toBuffer("image/png");

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
