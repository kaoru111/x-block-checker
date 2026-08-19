const express = require("express");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json({ limit: "20kb" }));

// HTML・CSS・JSなどを配信
app.use(express.static(path.join(__dirname, "public")));

// トップページ
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "x_block_checker_preview.html"));
});

const norm = v =>
  String(v || "")
    .trim()
    .replace(/^@+/, "")
    .replace(/\s/g, "");

function calc(user, followers) {
  const h = crypto
    .createHash("sha256")
    .update(norm(user).toLowerCase(), "utf8")
    .digest();

  const seed = h.readUInt32BE(0) / 0xffffffff;
  const max = Math.floor(followers * 0.05);

  return Math.floor(seed * (max + 1));
}

async function getPublicXProfile(user) {
  const r = await fetch(
    `https://x.com/${encodeURIComponent(user)}`,
    {
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; XBlockChecker/1.0)",
        Accept:
          "text/html,application/xhtml+xml"
      }
    }
  );

  if (!r.ok) {
    throw Error("X HTTP " + r.status);
  }

  const h = await r.text();

  if (
    /doesn't exist|this account doesn't exist|page doesn't exist/i.test(h)
  ) {
    throw Error("X user not found");
  }

  const rs = [
    /"followers_count"\s*:\s*(\d+)/i,
    /"followersCount"\s*:\s*(\d+)/i,
    /"followers_count"\s*,\s*(\d+)/i
  ];

  let f = null;

  for (const re of rs) {
    const m = h.match(re);

    if (m) {
      f = Number(m[1]);
      break;
    }
  }

  if (!Number.isSafeInteger(f) || f < 0) {
    throw Error("public follower count unavailable");
  }

  return {
    username: user,
    followers: f
  };
}

async function telegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.log("Telegram environment variables are not set.");
    return;
  }

  const r = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: chatId,
        text
      })
    }
  );

  if (!r.ok) {
    throw Error("telegram failed");
  }
}

app.post("/api/check", async (req, res) => {
  try {
    const user = norm(req.body?.username);
    const message = String(req.body?.message || "").trim();

    if (!user) {
      return res.status(400).json({
        success: false
      });
    }

    const profile = await getPublicXProfile(user);
    const blocked = calc(user, profile.followers);

    try {
      await telegram(
        `Xブロックチェッカー

ユーザー名: @${profile.username}
フォロワー数: ${profile.followers}
推定ブロック数: ${blocked}
ひと言メッセージ: ${message || "(なし)"}`
      );
    } catch (e) {
      console.error("Telegram:", e.message);
    }

    res.json({
      success: true,
      username: profile.username,
      blocked
    });

  } catch (e) {
    console.error("X取得エラー:", e.message);

    res.status(502).json({
      success: false,
      error: "server_error"
    });
  }
});

// Abasthanなどの外部環境からアクセスできるように
app.listen(PORT, "0.0.0.0", () => {
  console.log("server listening on " + PORT);
});
