const express = require("express");
const crypto = require("crypto");
const path = require("path");
const rateLimit = require("express-rate-limit");
const sharp = require("sharp");

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
// OGP用 HTML エスケープ
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
// OGP画像用 SVG エスケープ
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
// OGP結果画像生成
// =====================================================

async function createOgpImage(username, blocked) {

  const safeUsername =
    escapeSvg(
      "@" + norm(username)
    );

  const safeBlocked =
    escapeSvg(
      Number(blocked || 0)
        .toLocaleString("ja-JP")
    );

  const svg = `
<svg
  width="1200"
  height="630"
  viewBox="0 0 1200 630"
  xmlns="http://www.w3.org/2000/svg"
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
      id="glow"
      x="-50%"
      y="-50%"
      width="200%"
      height="200%"
    >
      <feGaussianBlur
        stdDeviation="12"
        result="blur"
      />

      <feMerge>
        <feMergeNode
          in="blur"
        />

        <feMergeNode
          in="SourceGraphic"
        />
      </feMerge>
    </filter>

  </defs>


  <rect
    width="1200"
    height="630"
    fill="url(#bg)"
  />


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


  <text
    x="600"
    y="150"
    text-anchor="middle"
    font-family="sans-serif"
    font-size="62"
    font-weight="900"
    fill="#ff5ca9"
  >
    Xブロックチェッカー
  </text>


  <text
    x="600"
    y="225"
    text-anchor="middle"
    font-family="sans-serif"
    font-size="30"
    font-weight="700"
    fill="#ff9bc8"
  >
    ${safeUsername}
  </text>


  <text
    x="600"
    y="310"
    text-anchor="middle"
    font-family="sans-serif"
    font-size="28"
    font-weight="700"
    fill="#ddd5dc"
  >
    🔒 ブロックされている数
  </text>


  <text
    x="600"
    y="425"
    text-anchor="middle"
    font-family="sans-serif"
    font-size="105"
    font-weight="900"
    fill="url(#pink)"
    filter="url(#glow)"
  >
    ${safeBlocked}
  </text>


  <text
    x="600"
    y="480"
    text-anchor="middle"
    font-family="sans-serif"
    font-size="28"
    font-weight="700"
    fill="#c9c3ca"
  >
    人
  </text>


  <text
    x="600"
    y="535"
    text-anchor="middle"
    font-family="sans-serif"
    font-size="22"
    font-weight="700"
    fill="#77737b"
  >
    Xブロックチェッカーでチェックしました
  </text>

</svg>
`;

  return sharp(
    Buffer.from(svg)
  )
    .png()
    .toBuffer();

}

// =====================================================
// OGP共有ページ
// XがURLを読み込んだときに使用
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
        `${baseUrl}/ogp?username=` +
        encodeURIComponent(username) +
        `&blocked=` +
        encodeURIComponent(blocked);

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
🔒 ブロックされている数
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
// OGP画像
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
    .digest
