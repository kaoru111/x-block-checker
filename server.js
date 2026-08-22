const express = require("express");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

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
  const username = norm(user);

  // まずXの公開プロフィール確認用エンドポイントを確認する。
  // 存在しないユーザーの場合は空配列になることを利用する。
  try {
    const infoUrl =
      `https://cdn.syndication.twimg.com/widgets/followbutton/info.json?screen_names=${encodeURIComponent(username)}`;

    const infoResponse = await fetch(infoUrl, {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; XBlockChecker/1.0)",
        Accept: "application/json,text/plain,*/*"
      }
    });

    if (infoResponse.ok) {
      const info = await infoResponse.json().catch(() => null);

      if (Array.isArray(info)) {
        if (info.length === 0) {
          throw Error("X user not found");
        }

        const profile = info.find(
          p => String(p.screen_name || "").toLowerCase() === username.toLowerCase()
        );

        if (!profile) {
          throw Error("X user not found");
        }

        const followers =
          Number(profile.followers_count);

        if (Number.isSafeInteger(followers) && followers >= 0) {
          return {
            username: String(profile.screen_name || username),
            followers
          };
        }
      }
    }
  } catch (e) {
    if (e.message === "X user not found") {
      throw e;
    }
    console.error("X公開プロフィール確認:", e.message);
  }

  // 上記エンドポイントが利用できない場合はX公開ページを確認する。
  const r = await fetch(
    `https://x.com/${encodeURIComponent(username)}`,
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
    if (r.status === 404) {
      throw Error("X user not found");
    }
    throw Error("X HTTP " + r.status);
  }

  const h = await r.text();

  // 明確な存在しないユーザー表示を確認。
  if (
    /This account doesn['’]t exist|This account doesn't exist|page doesn't exist|Account suspended/i.test(h)
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

  // ページ内に対象ユーザー名のプロフィール情報がない場合は
  // 存在確認ができないため、誤って結果を表示しない。
  const lowerHtml = h.toLowerCase();
  const lowerUser = username.toLowerCase();

  if (
    !lowerHtml.includes(`"screen_name":"${lowerUser}"`) &&
    !lowerHtml.includes(`"screen_name": "${lowerUser}"`) &&
    !lowerHtml.includes(`@${lowerUser}`)
  ) {
    throw Error("X user not found");
  }

  return {
    username,
    followers: f
  };
}
async function telegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    throw Error("Telegram environment variables are not set.");
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

    if (!user || !message) {
      return res.status(400).json({
        success: false,
        error: "username_and_message_required"
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
ひと言メッセージ: ${message}`
      );
    } catch (e) {
      console.error("Telegram送信エラー:", e.message);

      return res.status(502).json({
        success: false,
        error: "telegram_failed"
      });
    }

    res.json({
      success: true,
      username: profile.username,
      blocked
    });

  } catch (e) {
    console.error("X取得エラー:", e.message);

    if (e.message === "X user not found") {
      return res.status(404).json({
        success: false,
        error: "user_not_found"
      });
    }

    res.status(502).json({
      success: false,
      error: "server_error"
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("server listening on " + PORT);
});