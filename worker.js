// @ts-nocheck

// ============================================================
// DEGEN PAPER TRADER
// MULTI-SOURCE MARKET ENGINE
// ============================================================
//
// Sources:
// 1. HoodScan (Robinhood)
// 2. DexScreener
// 3. GeckoTerminal
// 4. Uniswap direct pools
// 5. Robinhood / EVM RPC
// 6. Blockscout / Etherscan-style APIs
// 7. Direct ERC20 metadata
// 8. Solana RPC
//
// Priority:
// HoodScan → DexScreener → GeckoTerminal → direct DEX → on-chain
//
// This is PAPER TRADING only.
// No real blockchain transactions are made.
// ============================================================


// ============================================================
// CONFIG
// ============================================================

const STARTING_BALANCE = 150;

const CHAINS = {
  solana: {
    name: "Solana",
    emoji: "🟣",
    type: "solana",
    dex: "solana",
    rpc: [
      "https://api.mainnet.solana.com",
      "https://solana-rpc.publicnode.com"
    ],
    gecko: "solana"
  },

  robinhood: {
    name: "Robinhood",
    emoji: "🟠",
    type: "evm",
    chainId: 4663,
    dex: "robinhood",
    rpc: [
      "https://rpc.mainnet.chain.robinhood.com/",
      "https://robinhood-rpc.publicnode.com",
      "https://robinhood.drpc.org"
    ],
    gecko: "robinhood"
  },

  arc: {
    name: "Arc",
    emoji: "🔵",
    type: "evm",
    chainId: 5042,
    dex: "arc",
    rpc: [
      "https://rpc.mainnet.arc.io"
    ],
    gecko: "arc"
  }
};


// ============================================================
// UNISWAP CONFIG
// ============================================================

const UNISWAP = {
  robinhood: {
    v2Factory:
      "0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f",

    v3Factory:
      "0x1f7d7550b1b028f7571e69A784071F0205FD2EfA",

    v4PoolManager:
      "0x8366a39cc670b4001a1121b8f6a443a643e40951"
  },

  arc: {
    v3Factory:
      "0xf0db7b58379503491d857dB50AC9ece64c653918"
  }
};


// ============================================================
// COMMON ADDRESSES
// ============================================================

const ZERO =
  "0x0000000000000000000000000000000000000000";

const WETH = {
  robinhood:
    "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",

  arc:
    "0x3600000000000000000000000000000000000000"
};


// ============================================================
// TELEGRAM
// ============================================================

async function telegram(env, method, body) {
  const token = env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN");
  }

  const response = await fetch(
    `https://api.telegram.org/bot${token}/${method}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  const data = await response.json();

  if (!data.ok) {
    throw new Error(
      data.description || "Telegram API error"
    );
  }

  return data;
}


async function sendMessage(
  env,
  chatId,
  text,
  keyboard = null
) {
  const body = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true
  };

  if (keyboard) {
    body.reply_markup = {
      inline_keyboard: keyboard
    };
  }

  return telegram(
    env,
    "sendMessage",
    body
  );
}


async function sendPhoto(
  env,
  chatId,
  photo,
  caption,
  keyboard = null
) {
  const body = {
    chat_id: chatId,
    photo,
    caption,
    parse_mode: "HTML"
  };

  if (keyboard) {
    body.reply_markup = {
      inline_keyboard: keyboard
    };
  }

  return telegram(
    env,
    "sendPhoto",
    body
  );
}


async function editMessage(
  env,
  chatId,
  messageId,
  text,
  keyboard = null
) {
  const body = {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true
  };

  if (keyboard) {
    body.reply_markup = {
      inline_keyboard: keyboard
    };
  }

  return telegram(
    env,
    "editMessageText",
    body
  );
}


async function answerCallback(env, id) {
  try {
    return await telegram(
      env,
      "answerCallbackQuery",
      {
        callback_query_id: id
      }
    );
  } catch {}
}


// ============================================================
// HELPERS
// ============================================================

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}


function money(value) {
  const n = Number(value || 0);

  return `$${n.toLocaleString(
    "en-US",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }
  )}`;
}


function price(value) {
  const n = Number(value || 0);

  if (!Number.isFinite(n) || n <= 0) {
    return "N/A";
  }

  if (n >= 1) {
    return `$${n.toLocaleString(
      "en-US",
      {
        maximumFractionDigits: 6
      }
    )}`;
  }

  return `$${n.toPrecision(6)}`;
}


function compactMoney(value) {
  const n = Number(value || 0);

  if (!Number.isFinite(n) || n <= 0) {
    return "N/A";
  }

  if (n >= 1e9) {
    return `$${(n / 1e9).toFixed(2)}B`;
  }

  if (n >= 1e6) {
    return `$${(n / 1e6).toFixed(2)}M`;
  }

  if (n >= 1e3) {
    return `$${(n / 1e3).toFixed(2)}K`;
  }

  return `$${n.toFixed(2)}`;
}


function percent(value) {
  const n = Number(value || 0);

  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}


function sleep(ms) {
  return new Promise(
    resolve => setTimeout(resolve, ms)
  );
}


function validNumber(value) {
  return (
    value !== null &&
    value !== undefined &&
    Number.isFinite(Number(value)) &&
    Number(value) > 0
  );
}


function normalizeAddress(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}


// ============================================================
// DATABASE
// ============================================================

// Self-healing D1 schema.
// The bot can safely start even when one of the expected tables/columns
// was not created in an earlier setup attempt.
async function ensurePaperTraderSchema(env) {
  if (!env?.DB) {
    throw new Error("D1 binding DB is missing");
  }

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id TEXT UNIQUE,
      username TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `).run();

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS wallets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      starting_balance REAL NOT NULL DEFAULT 150,
      cash_balance REAL NOT NULL DEFAULT 150,
      realized_pnl REAL NOT NULL DEFAULT 0,
      total_fees REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `).run();

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      user_id INTEGER PRIMARY KEY,
      state TEXT NOT NULL DEFAULT 'idle',
      data TEXT NOT NULL DEFAULT '{}',
      updated_at INTEGER NOT NULL
    )
  `).run();

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      chain TEXT NOT NULL,
      ca TEXT NOT NULL,
      name TEXT,
      symbol TEXT,
      logo_url TEXT,
      entry_price REAL,
      current_price REAL,
      entry_mcap REAL,
      current_mcap REAL,
      quantity REAL NOT NULL DEFAULT 0,
      invested_usd REAL NOT NULL DEFAULT 0,
      remaining_invested_usd REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `).run();

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      position_id INTEGER,
      chain TEXT NOT NULL,
      ca TEXT NOT NULL,
      name TEXT,
      symbol TEXT,
      side TEXT NOT NULL,
      sell_percent REAL,
      price REAL,
      mcap REAL,
      quantity REAL,
      usd_amount REAL,
      pnl_usd REAL NOT NULL DEFAULT 0,
      pnl_percent REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `).run();

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS fund_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'approved',
      created_at INTEGER NOT NULL
    )
  `).run();

  // Add expected columns to older tables when they exist but are missing
  // fields required by this version. All table/column names here are static.
  const additions = {
    users: [
      ["telegram_id", "TEXT"], ["username", "TEXT"],
      ["created_at", "INTEGER"], ["updated_at", "INTEGER"]
    ],
    wallets: [
      ["user_id", "INTEGER"], ["starting_balance", "REAL DEFAULT 150"],
      ["cash_balance", "REAL DEFAULT 150"], ["realized_pnl", "REAL DEFAULT 0"],
      ["total_fees", "REAL DEFAULT 0"], ["created_at", "INTEGER"], ["updated_at", "INTEGER"]
    ],
    user_sessions: [
      ["state", "TEXT DEFAULT 'idle'"], ["data", "TEXT DEFAULT '{}'"], ["updated_at", "INTEGER"]
    ],
    positions: [
      ["user_id", "INTEGER"], ["chain", "TEXT"], ["ca", "TEXT"], ["name", "TEXT"],
      ["symbol", "TEXT"], ["logo_url", "TEXT"], ["entry_price", "REAL"],
      ["current_price", "REAL"], ["entry_mcap", "REAL"], ["current_mcap", "REAL"],
      ["quantity", "REAL DEFAULT 0"], ["invested_usd", "REAL DEFAULT 0"],
      ["remaining_invested_usd", "REAL DEFAULT 0"], ["created_at", "INTEGER"], ["updated_at", "INTEGER"]
    ],
    trades: [
      ["user_id", "INTEGER"], ["position_id", "INTEGER"], ["chain", "TEXT"], ["ca", "TEXT"],
      ["name", "TEXT"], ["symbol", "TEXT"], ["side", "TEXT"], ["sell_percent", "REAL"],
      ["price", "REAL"], ["mcap", "REAL"], ["quantity", "REAL"], ["usd_amount", "REAL"],
      ["pnl_usd", "REAL DEFAULT 0"], ["pnl_percent", "REAL DEFAULT 0"], ["created_at", "INTEGER"]
    ],
    fund_requests: [
      ["user_id", "INTEGER"], ["amount", "REAL"], ["status", "TEXT DEFAULT 'approved'"], ["created_at", "INTEGER"]
    ]
  };

  for (const [table, columns] of Object.entries(additions)) {
    let info;
    try {
      info = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
    } catch (e) {
      console.log("SCHEMA INFO ERROR", table, String(e?.message || e));
      continue;
    }

    const existing = new Set((info?.results || []).map(x => x.name));

    for (const [column, definition] of columns) {
      if (existing.has(column)) continue;
      try {
        await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
      } catch (e) {
        // Some old tables may already satisfy the logical requirement even
        // if SQLite rejects a redundant ALTER. Do not stop /start for this.
        console.log("SCHEMA ALTER SKIP", table, column, String(e?.message || e));
      }
    }
  }
}

async function ensureUser(env, tgUser) {
  await ensurePaperTraderSchema(env);

  const now = Date.now();
  const telegramId = String(tgUser?.id || "").trim();

  if (!telegramId) {
    throw new Error("Telegram user id missing");
  }

  let user = await env.DB
    .prepare("SELECT * FROM users WHERE telegram_id = ? LIMIT 1")
    .bind(telegramId)
    .first();

  if (!user) {
    // INSERT OR IGNORE avoids a race when Telegram delivers two updates
    // close together for the same first-time user.
    await env.DB
      .prepare(`
        INSERT OR IGNORE INTO users
        (telegram_id, username, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `)
      .bind(
        telegramId,
        tgUser.username || null,
        now,
        now
      )
      .run();

    user = await env.DB
      .prepare("SELECT * FROM users WHERE telegram_id = ? LIMIT 1")
      .bind(telegramId)
      .first();
  } else {
    await env.DB
      .prepare(`
        UPDATE users
        SET username = ?, updated_at = ?
        WHERE id = ?
      `)
      .bind(
        tgUser.username || null,
        now,
        user.id
      )
      .run();
  }

  if (!user?.id) {
    throw new Error("Could not create/load user");
  }

  const wallet = await env.DB
    .prepare("SELECT * FROM wallets WHERE user_id = ? LIMIT 1")
    .bind(user.id)
    .first();

  if (!wallet) {
    await env.DB
      .prepare(`
        INSERT INTO wallets
        (user_id, starting_balance, cash_balance, realized_pnl, total_fees, created_at, updated_at)
        VALUES (?, ?, ?, 0, 0, ?, ?)
      `)
      .bind(
        user.id,
        STARTING_BALANCE,
        STARTING_BALANCE,
        now,
        now
      )
      .run();
  }

  const session = await env.DB
    .prepare("SELECT user_id FROM user_sessions WHERE user_id = ? LIMIT 1")
    .bind(user.id)
    .first();

  if (!session) {
    await env.DB
      .prepare(`
        INSERT INTO user_sessions
        (user_id, state, data, updated_at)
        VALUES (?, 'idle', '{}', ?)
      `)
      .bind(user.id, now)
      .run();
  }

  return user;
}


async function getSession(env, userId) {
  return env.DB
    .prepare(`
      SELECT *
      FROM user_sessions
      WHERE user_id = ?
    `)
    .bind(userId)
    .first();
}


async function setSession(
  env,
  userId,
  state,
  data = {}
) {
  await env.DB
    .prepare(`
      INSERT INTO user_sessions
      (user_id, state, data, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id)
      DO UPDATE SET
        state = excluded.state,
        data = excluded.data,
        updated_at = excluded.updated_at
    `)
    .bind(
      userId,
      state,
      JSON.stringify(data),
      Date.now()
    )
    .run();
}


async function clearSession(env, userId) {
  return setSession(
    env,
    userId,
    "idle",
    {}
  );
}


async function getWallet(env, userId) {
  return env.DB
    .prepare(`
      SELECT *
      FROM wallets
      WHERE user_id = ?
    `)
    .bind(userId)
    .first();
}


// ============================================================
// HTTP FETCH HELPERS
// ============================================================

async function fetchJSON(
  url,
  options = {},
  timeout = 7000
) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => controller.abort(),
      timeout
    );

  try {
    const response =
      await fetch(
        url,
        {
          ...options,
          signal:
            controller.signal
        }
      );

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}`
      );
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}


async function postJSON(
  url,
  body,
  options = {},
  timeout = 7000
) {
  return fetchJSON(
    url,
    {
      ...options,
      method: "POST",
      headers: {
        "content-type":
          "application/json",
        ...(options.headers || {})
      },
      body: JSON.stringify(body)
    },
    timeout
  );
}


// ============================================================
// MARKET RESULT NORMALIZER
// ============================================================

function emptyMarket(chain, ca) {
  return {
    chain,
    ca,

    name: "Unknown",
    symbol: "UNKNOWN",
    image: null,

    price: null,
    mcap: null,
    fdv: null,
    liquidity: null,
    volume24h: null,
    volume5m: null,
    txns24h: null,

    pair: null,
    dex: null,
    url: null,

    source: null,
    confidence: 0,

    markets: []
  };
}


function scoreMarket(m) {
  let score = 0;

  if (validNumber(m.price)) score += 40;
  if (validNumber(m.mcap)) score += 20;
  if (validNumber(m.liquidity)) score += 15;
  if (validNumber(m.volume24h)) score += 10;
  if (m.pair) score += 5;
  if (m.dex) score += 5;
  if (m.image) score += 2;
  if (m.symbol) score += 3;

  return score;
}


function normalizeDexPair(
  chain,
  ca,
  pair,
  source = "dexscreener"
) {
  const base =
    pair.baseToken || {};

  const quote =
    pair.quoteToken || {};

  const tokenAddress =
    normalizeAddress(ca);

  const baseAddress =
    normalizeAddress(base.address);

  const isBase =
    baseAddress === tokenAddress;

  const token =
    isBase ? base : quote;

  const priceUsd =
    Number(
      pair.priceUsd ||
      0
    );

  return {
    chain,
    ca,

    name:
      token.name ||
      base.name ||
      "Unknown",

    symbol:
      token.symbol ||
      base.symbol ||
      "UNKNOWN",

    image:
      pair.info?.imageUrl ||
      null,

    price:
      validNumber(priceUsd)
        ? priceUsd
        : null,

    mcap:
      validNumber(pair.marketCap)
        ? Number(pair.marketCap)
        : validNumber(pair.fdv)
          ? Number(pair.fdv)
          : null,

    fdv:
      validNumber(pair.fdv)
        ? Number(pair.fdv)
        : null,

    liquidity:
      validNumber(pair.liquidity?.usd)
        ? Number(pair.liquidity.usd)
        : null,

    volume24h:
      validNumber(pair.volume?.h24)
        ? Number(pair.volume.h24)
        : null,

    volume5m:
      validNumber(pair.volume?.m5)
        ? Number(pair.volume.m5)
        : null,

    txns24h:
      pair.txns?.h24
        ? Number(pair.txns.h24.buys || 0) +
          Number(pair.txns.h24.sells || 0)
        : null,

    pair:
      pair.pairAddress ||
      null,

    dex:
      pair.dexId ||
      null,

    url:
      pair.url ||
      null,

    source,

    confidence: 0,

    markets: []
  };
}


// ============================================================
// DEXSCREENER
// ============================================================

async function getDexScreenerMarkets(
  chain,
  ca
) {
  const config =
    CHAINS[chain];

  const urls = [
    `https://api.dexscreener.com/token-pairs/v1/${config.dex}/${encodeURIComponent(ca)}`,
    `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(ca)}`
  ];

  const all = [];

  for (const url of urls) {
    try {
      const data =
        await fetchJSON(
          url,
          {},
          6500
        );

      if (Array.isArray(data)) {
        all.push(...data);
      }

      if (Array.isArray(data?.pairs)) {
        all.push(...data.pairs);
      }
    } catch {}
  }

  const seen =
    new Set();

  const pairs =
    all.filter(
      p => {
        const id =
          p.pairAddress ||
          p.url ||
          JSON.stringify(p);

        if (seen.has(id)) {
          return false;
        }

        seen.add(id);
        return true;
      }
    );

  return pairs
    .map(
      p =>
        normalizeDexPair(
          chain,
          ca,
          p,
          "dexscreener"
        )
    )
    .filter(
      m =>
        validNumber(m.price)
    );
}


// ============================================================
// GECKOTERMINAL
// ============================================================

async function getGeckoMarkets(
  chain,
  ca
) {
  const config =
    CHAINS[chain];

  if (!config.gecko) {
    return [];
  }

  const urls = [
    `https://api.geckoterminal.com/api/v2/networks/${config.gecko}/tokens/${encodeURIComponent(ca)}/pools`,
    `https://api.geckoterminal.com/api/v2/networks/${config.gecko}/tokens/${encodeURIComponent(ca)}`
  ];

  const result = [];

  for (const url of urls) {
    try {
      const data =
        await fetchJSON(
          url,
          {
            headers: {
              accept:
                "application/json"
            }
          },
          7000
        );

      const list =
        Array.isArray(data?.data)
          ? data.data
          : [];

      for (const item of list) {
        const attrs =
          item.attributes || {};

        const price =
          Number(
            attrs.token_price_usd ||
            attrs.base_token_price_usd ||
            0
          );

        if (!validNumber(price)) {
          continue;
        }

        const relationships =
          item.relationships || {};

        const dex =
          relationships.dex?.data?.id ||
          null;

        const pool =
          item.id ||
          null;

        result.push({
          chain,
          ca,

          name:
            attrs.name ||
            "Unknown",

          symbol:
            attrs.symbol ||
            "UNKNOWN",

          image:
            attrs.image_url ||
            null,

          price,

          mcap:
            validNumber(
              attrs.market_cap_usd
            )
              ? Number(
                  attrs.market_cap_usd
                )
              : null,

          fdv:
            validNumber(
              attrs.fdv_usd
            )
              ? Number(
                  attrs.fdv_usd
                )
              : null,

          liquidity:
            validNumber(
              attrs.reserve_in_usd
            )
              ? Number(
                  attrs.reserve_in_usd
                )
              : null,

          volume24h:
            validNumber(
              attrs.volume_usd?.h24
            )
              ? Number(
                  attrs.volume_usd.h24
                )
              : null,

          volume5m: null,
          txns24h: null,

          pair: pool,
          dex,

          url:
            pool
              ? `https://www.geckoterminal.com/${config.gecko}/pools/${pool}`
              : null,

          source:
            "geckoterminal",

          confidence: 0,

          markets: []
        });
      }
    } catch {}
  }

  return result;
}


// ============================================================
// SOLANA RPC
// ============================================================

async function solanaRPC(
  method,
  params,
  rpcList
) {
  for (const rpc of rpcList) {
    try {
      const data =
        await postJSON(
          rpc,
          {
            jsonrpc: "2.0",
            id: 1,
            method,
            params
          },
          {},
          7000
        );

      if (
        data &&
        !data.error
      ) {
        return data.result;
      }
    } catch {}
  }

  return null;
}


async function getSolanaMetadata(
  ca
) {
  const config =
    CHAINS.solana;

  try {
    const supply =
      await solanaRPC(
        "getTokenSupply",
        [ca],
        config.rpc
      );

    const decimals =
      Number(
        supply?.value?.decimals
      );

    const amount =
      Number(
        supply?.value?.uiAmount ||
        0
      );

    return {
      decimals,
      supply: amount
    };
  } catch {
    return {
      decimals: null,
      supply: null
    };
  }
}


// ============================================================
// EVM RPC
// ============================================================

function hexToNumber(hex) {
  if (!hex) return 0;

  try {
    return Number(
      BigInt(hex)
    );
  } catch {
    return 0;
  }
}


function padAddress(address) {
  return address
    .replace("0x", "")
    .toLowerCase()
    .padStart(64, "0");
}


function encodeUint256(value) {
  let hex =
    BigInt(value).toString(16);

  return hex.padStart(
    64,
    "0"
  );
}


function decodeStringResult(hex) {
  if (!hex || hex === "0x") {
    return null;
  }

  try {
    const raw =
      hex.slice(2);

    if (raw.length >= 128) {
      const offset =
        parseInt(
          raw.slice(0, 64),
          16
        );

      if (
        offset * 2 + 64 <=
        raw.length
      ) {
        const len =
          parseInt(
            raw.slice(
              offset * 2,
              offset * 2 + 64
            ),
            16
          );

        const start =
          offset * 2 + 64;

        const bytes =
          raw.slice(
            start,
            start + len * 2
          );

        const arr =
          new Uint8Array(
            bytes.match(
              /.{1,2}/g
            ).map(
              x =>
                parseInt(
                  x,
                  16
                )
            )
          );

        return new TextDecoder()
          .decode(arr)
          .replaceAll("\u0000", "")
          .trim();
      }
    }

    const arr =
      new Uint8Array(
        raw
          .match(/.{1,2}/g)
          .map(
            x =>
              parseInt(x, 16)
          )
      );

    return new TextDecoder()
      .decode(arr)
      .replaceAll("\u0000", "")
      .trim();

  } catch {
    return null;
  }
}


function decodeUint256(hex) {
  try {
    return BigInt(hex);
  } catch {
    return 0n;
  }
}


async function evmRPC(
  chain,
  method,
  params
) {
  const config =
    CHAINS[chain];

  if (!config?.rpc) {
    return null;
  }

  for (const rpc of config.rpc) {
    try {
      const data =
        await postJSON(
          rpc,
          {
            jsonrpc: "2.0",
            id: 1,
            method,
            params
          },
          {},
          7000
        );

      if (
        data &&
        !data.error
      ) {
        return data.result;
      }
    } catch {}
  }

  return null;
}


async function evmCall(
  chain,
  to,
  data
) {
  return evmRPC(
    chain,
    "eth_call",
    [
      {
        to,
        data
      },
      "latest"
    ]
  );
}


async function getERC20Metadata(
  chain,
  ca
) {
  const result = {
    name: null,
    symbol: null,
    decimals: null,
    totalSupply: null
  };

  try {
    const name =
      await evmCall(
        chain,
        ca,
        "0x06fdde03"
      );

    result.name =
      decodeStringResult(name);
  } catch {}

  try {
    const symbol =
      await evmCall(
        chain,
        ca,
        "0x95d89b41"
      );

    result.symbol =
      decodeStringResult(symbol);
  } catch {}

  try {
    const decimals =
      await evmCall(
        chain,
        ca,
        "0x313ce567"
      );

    result.decimals =
      hexToNumber(decimals);
  } catch {}

  try {
    const supply =
      await evmCall(
        chain,
        ca,
        "0x18160ddd"
      );

    result.totalSupply =
      decodeUint256(supply);
  } catch {}

  return result;
}


// ============================================================
// ETHERSCAN / ROBINSCAN
// ============================================================

async function getExplorerTokenData(
  chain,
  ca
) {
  if (chain !== "robinhood") {
    return null;
  }

  const base =
    "https://api.etherscan.io/v2/api";

  try {
    const data =
      await fetchJSON(
        `${base}?chainid=4663&module=contract&action=getabi&address=${encodeURIComponent(ca)}`,
        {},
        7000
      );

    if (
      data?.status === "1"
    ) {
      return {
        verified: true,
        source: "robinscan"
      };
    }
  } catch {}

  return null;
}


// ============================================================
// UNISWAP V3 DIRECT
// ============================================================

const SELECTORS = {
  factoryGetPool:
    "0x1698ee82",

  token0:
    "0x0dfe1681",

  token1:
    "0xd21220a7",

  slot0:
    "0x3850c7bd",

  liquidity:
    "0x1a686502",

  v2GetPair:
    "0xe6a43905",

  v2GetReserves:
    "0x0902f1ac",

  decimals:
    "0x313ce567"
};


async function getFactoryPool(
  chain,
  factory,
  tokenA,
  tokenB,
  fee
) {
  const data =
    SELECTORS.factoryGetPool +
    padAddress(tokenA) +
    padAddress(tokenB) +
    encodeUint256(fee);

  const result =
    await evmCall(
      chain,
      factory,
      data
    );

  if (
    !result ||
    result === "0x"
  ) {
    return null;
  }

  return (
    "0x" +
    result
      .slice(-40)
  );
}


async function getV3PoolInfo(
  chain,
  factory,
  token,
  quote
) {
  const fees =
    [
      100,
      500,
      3000,
      10000
    ];

  const pools = [];

  for (const fee of fees) {
    try {
      let pool =
        await getFactoryPool(
          chain,
          factory,
          token,
          quote,
          fee
        );

      if (
        !pool ||
        normalizeAddress(pool) ===
        ZERO
      ) {
        pool =
          await getFactoryPool(
            chain,
            factory,
            quote,
            token,
            fee
          );
      }

      if (
        pool &&
        normalizeAddress(pool) !==
        ZERO
      ) {
        pools.push({
          pool,
          fee
        });
      }
    } catch {}
  }

  return pools;
}


async function getV2Pair(
  chain,
  factory,
  tokenA,
  tokenB
) {
  const data =
    SELECTORS.v2GetPair +
    padAddress(tokenA) +
    padAddress(tokenB);

  const result =
    await evmCall(
      chain,
      factory,
      data
    );

  if (
    !result ||
    result === "0x"
  ) {
    return null;
  }

  const pair =
    "0x" +
    result.slice(-40);

  if (
    normalizeAddress(pair) ===
    ZERO
  ) {
    return null;
  }

  return pair;
}


async function getDexScreenerReferencePrice(
  chain,
  token
) {
  try {
    const data =
      await fetchJSON(
        `https://api.dexscreener.com/token-pairs/v1/${CHAINS[chain].dex}/${encodeURIComponent(token)}`,
        {},
        6500
      );

    const pairs =
      Array.isArray(data)
        ? data
        : [];

    const valid =
      pairs
        .map(
          p => Number(p.priceUsd || 0)
        )
        .filter(validNumber);

    if (!valid.length) {
      return null;
    }

    return Math.max(...valid);
  } catch {
    return null;
  }
}


async function getDirectUniswapV2Markets(
  chain,
  ca
) {
  const config =
    UNISWAP[chain];

  if (
    !config?.v2Factory
  ) {
    return [];
  }

  const quote =
    WETH[chain];

  if (!quote) {
    return [];
  }

  const pair =
    await getV2Pair(
      chain,
      config.v2Factory,
      ca,
      quote
    );

  if (!pair) {
    return [];
  }

  try {
    const token0Raw =
      await evmCall(
        chain,
        pair,
        SELECTORS.token0
      );

    const token1Raw =
      await evmCall(
        chain,
        pair,
        SELECTORS.token1
      );

    const token0 =
      "0x" +
      token0Raw.slice(-40);

    const token1 =
      "0x" +
      token1Raw.slice(-40);

    const reservesRaw =
      await evmCall(
        chain,
        pair,
        SELECTORS.v2GetReserves
      );

    if (
      !reservesRaw ||
      reservesRaw === "0x"
    ) {
      return [];
    }

    const raw =
      reservesRaw.slice(2);

    const reserve0 =
      BigInt(
        "0x" +
        raw.slice(0, 64)
      );

    const reserve1 =
      BigInt(
        "0x" +
        raw.slice(64, 128)
      );

    const decimals0 =
      hexToNumber(
        await evmCall(
          chain,
          token0,
          SELECTORS.decimals
        )
      );

    const decimals1 =
      hexToNumber(
        await evmCall(
          chain,
          token1,
          SELECTORS.decimals
        )
      );

    const r0 =
      Number(reserve0) /
      Math.pow(10, decimals0);

    const r1 =
      Number(reserve1) /
      Math.pow(10, decimals1);

    if (
      !Number.isFinite(r0) ||
      !Number.isFinite(r1) ||
      r0 <= 0 ||
      r1 <= 0
    ) {
      return [];
    }

    const caIsToken0 =
      normalizeAddress(token0) ===
      normalizeAddress(ca);

    const tokenReserve =
      caIsToken0 ? r0 : r1;

    const quoteReserve =
      caIsToken0 ? r1 : r0;

    const tokenPriceInQuote =
      quoteReserve /
      tokenReserve;

    const quoteUsd =
      await getDexScreenerReferencePrice(
        chain,
        quote
      );

    const priceUsd =
      validNumber(quoteUsd)
        ? tokenPriceInQuote * quoteUsd
        : null;

    if (
      !validNumber(priceUsd)
    ) {
      return [];
    }

    const liquidity =
      validNumber(quoteUsd)
        ? quoteReserve *
          quoteUsd *
          2
        : null;

    return [
      {
        chain,
        ca,

        name: "Unknown",
        symbol: "UNKNOWN",
        image: null,

        price: priceUsd,
        mcap: null,
        fdv: null,
        liquidity,
        volume24h: null,
        volume5m: null,
        txns24h: null,

        pair,
        dex: "uniswap-v2",

        url:
          `https://app.uniswap.org/explore/pools/${pair}`,

        source:
          "uniswap-v2",

        confidence: 0,
        markets: []
      }
    ];
  } catch (error) {
    console.log(
      "UNISWAP V2 ERROR",
      error?.message ||
        String(error)
    );

    return [];
  }
}


async function getDirectUniswapMarkets(
  chain,
  ca
) {
  const config =
    UNISWAP[chain];

  if (
    !config?.v3Factory
  ) {
    return [];
  }

  const quote =
    WETH[chain];

  if (!quote) {
    return [];
  }

  const pools =
    await getV3PoolInfo(
      chain,
      config.v3Factory,
      ca,
      quote
    );

  const result = [];

  for (const item of pools) {
    try {
      const pool =
        item.pool;

      const token0 =
        await evmCall(
          chain,
          pool,
          SELECTORS.token0
        );

      const token1 =
        await evmCall(
          chain,
          pool,
          SELECTORS.token1
        );

      const t0 =
        "0x" +
        token0.slice(-40);

      const t1 =
        "0x" +
        token1.slice(-40);

      const slot0 =
        await evmCall(
          chain,
          pool,
          SELECTORS.slot0
        );

      if (!slot0) continue;

      const raw =
        slot0.slice(2);

      const sqrtPriceX96 =
        BigInt(
          "0x" +
          raw.slice(0, 64)
        );

      if (
        sqrtPriceX96 <= 0n
      ) {
        continue;
      }

      const decimals0 =
        hexToNumber(
          await evmCall(
            chain,
            t0,
            SELECTORS.decimals
          )
        );

      const decimals1 =
        hexToNumber(
          await evmCall(
            chain,
            t1,
            SELECTORS.decimals
          )
        );

      const sqrt =
        Number(
          sqrtPriceX96
        );

      const rawPrice =
        (
          sqrt *
          sqrt
        ) /
        Math.pow(
          2,
          192
        );

      let tokenPerQuote;

      if (
        normalizeAddress(t0) ===
        normalizeAddress(ca)
      ) {
        tokenPerQuote =
          rawPrice *
          Math.pow(
            10,
            decimals0 - decimals1
          );
      } else {
        tokenPerQuote =
          1 /
          rawPrice *
          Math.pow(
            10,
            decimals0 - decimals1
          );
      }

      const quotePrice =
        await getDexScreenerReferencePrice(
          chain,
          quote
        );

      const priceUsd =
        validNumber(quotePrice)
          ? tokenPerQuote *
            quotePrice
          : null;

      if (
        !validNumber(priceUsd)
      ) {
        continue;
      }

      result.push({
        chain,
        ca,

        name: "Unknown",
        symbol: "UNKNOWN",
        image: null,

        price: priceUsd,

        mcap: null,
        fdv: null,
        liquidity: null,
        volume24h: null,
        volume5m: null,
        txns24h: null,

        pair: pool,
        dex: "uniswap-v3",

        url:
          `https://app.uniswap.org/explore/pools/${pool}`,

        source:
          "uniswap",

        confidence: 0,

        markets: []
      });

    } catch {}
  }

  return result;
}


// ============================================================
// MARKET AGGREGATOR
// ============================================================

function chooseBestMarket(
  markets
) {
  if (!markets.length) {
    return null;
  }

  const valid =
    markets.filter(
      m =>
        validNumber(m.price)
    );

  if (!valid.length) {
    return null;
  }

  // Highest quality first.
  valid.sort(
    (a, b) => {
      const scoreA =
        scoreMarket(a);

      const scoreB =
        scoreMarket(b);

      return scoreB - scoreA;
    }
  );

  return valid[0];
}


function enrichConfidence(
  best,
  markets
) {
  if (!best) return null;

  const prices =
    markets
      .map(m => Number(m.price))
      .filter(
        Number.isFinite
      );

  let confidence = 40;

  if (
    prices.length >= 2
  ) {
    const min =
      Math.min(...prices);

    const max =
      Math.max(...prices);

    if (min > 0) {
      const spread =
        (max - min) /
        min;

      if (spread <= 0.01) {
        confidence += 35;
      } else if (
        spread <= 0.03
      ) {
        confidence += 20;
      } else if (
        spread <= 0.10
      ) {
        confidence += 5;
      }
    }
  }

  const uniqueSources =
    new Set(
      markets.map(
        m => m.source
      )
    ).size;

  confidence +=
    Math.min(
      uniqueSources * 5,
      15
    );

  best.confidence =
    Math.min(
      confidence,
      100
    );

  best.markets =
    markets.slice(0, 8);

  return best;
}


// ============================================================
// HOODSCAN MARKET SOURCE
// ============================================================
// HoodScan exposes public read-only token pages and MCP tools.
// We use the public token page as a lightweight Robinhood source.
// The page supports Accept: text/markdown.
// ============================================================

function parseHoodScanNumber(value) {
  if (value == null) return null;

  let raw = String(value)
    .trim()
    .replace(/[,$\s]/g, "")
    .toLowerCase();

  if (!raw) return null;

  // Handle values such as < $0.001, > $1.2K, ~1.2M.
  raw = raw.replace(/^[<>=~]+/, "");

  const match = raw.match(
    /^(-?(?:\d+\.?\d*|\.\d+))(k|m|b)?$/i
  );

  if (!match) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  let n = Number(match[1]);
  if (!Number.isFinite(n)) return null;

  if (match[2] === "k") n *= 1e3;
  if (match[2] === "m") n *= 1e6;
  if (match[2] === "b") n *= 1e9;

  return Number.isFinite(n) ? n : null;
}

function stripHoodScanText(text) {
  return String(text || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\r/g, "")
    .replace(/\t/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .trim();
}

function extractHoodScanMetric(text, label) {
  const source = String(text || "");

  // Markdown/plain text commonly appears as:
  // Price $0.00005278
  // Market cap $52.8K
  // or: Price: $0.00005278
  const re = new RegExp(
    "(?:^|[\\n|•])\\s*" +
      label.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&") +
      "\\s*:?\\s*" +
      "(?:\\$\\s*)?" +
      "([<>~=]?[-]?(?:\\d+(?:,\\d{3})*(?:\\.\\d+)?|\\.\\d+)(?:[kKmMbB])?)",
    "im"
  );

  const match = source.match(re);
  if (match) {
    return parseHoodScanNumber(match[1]);
  }

  // Fallback for HTML/plain text where the label is not line-bounded.
  const loose = new RegExp(
    label.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&") +
      "\\s*:?\\s*(?:\\$\\s*)?" +
      "([<>~=]?[-]?(?:\\d+(?:,\\d{3})*(?:\\.\\d+)?|\\.\\d+)(?:[kKmMbB])?)",
    "i"
  );

  const looseMatch = source.match(loose);
  return looseMatch
    ? parseHoodScanNumber(looseMatch[1])
    : null;
}

function extractHoodScanIdentity(text, address) {
  const source = String(text || "");

  let name = null;
  let symbol = null;

  // Preferred page/title forms:
  // # Lain ($LAIN) on Robinhood Chain
  // Lain ($LAIN) on Robinhood Chain
  let match = source.match(
    /(?:^|[\n#])\s*([^\n|]+?)\s*\(\$([A-Za-z0-9._-]+)\)\s+on\s+Robinhood\s+Chain/i
  );

  if (match) {
    name = match[1]
      .replace(/^#+\s*/, "")
      .trim();
    symbol = match[2].trim();
  }

  if (!match) {
    match = source.match(
      /(?:^|[\n#])\s*\$?([^\n|]+?)\s+on\s+Robinhood\s+Chain/i
    );

    if (match) {
      name = match[1]
        .replace(/^#+\s*/, "")
        .trim();
    }
  }

  // Contract is useful as a sanity check when the page exposes it.
  const contractMatch = source.match(
    /(?:contract|token)\s*[:`]?\s*(0x[a-fA-F0-9]{40})/i
  );

  const contract =
    contractMatch?.[1]?.toLowerCase() ||
    String(address || "").toLowerCase();

  // If no explicit symbol was found, use a standalone $TICKER near the
  // title, but never use the literal $USD / $USDC / $USDG settlement labels.
  if (!symbol) {
    const tickerMatch = source.match(
      /\$([A-Za-z][A-Za-z0-9._-]{1,15})/g
    );

    const ignored = new Set([
      "USD",
      "USDC",
      "USDG",
      "WETH",
      "ETH"
    ]);

    const candidate = (tickerMatch || [])
      .map(x => x.slice(1))
      .find(x => !ignored.has(x.toUpperCase()));

    if (candidate) {
      symbol = candidate;
    }
  }

  return {
    name: name || "Unknown",
    symbol: symbol || "UNKNOWN",
    contract
  };
}

async function getHoodScanMarket(chain, ca) {
  if (chain !== "robinhood") return [];

  const address = String(ca || "")
    .trim()
    .toLowerCase();

  if (!/^0x[a-f0-9]{40}$/.test(address)) {
    return [];
  }

  const url =
    `https://hoodscan.co/token/${address}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Accept": "text/markdown, text/plain;q=0.9, text/html;q=0.8",
      "User-Agent": "Degen-Paper-Trader/1.1"
    },
    cf: {
      cacheTtl: 15,
      cacheEverything: true
    }
  });

  // A missing/unindexed token should not kill the whole market engine.
  if (response.status === 404 || response.status === 503) {
    return [];
  }

  if (!response.ok) {
    throw new Error(
      `HoodScan HTTP ${response.status}`
    );
  }

  const raw = await response.text();
  const text = stripHoodScanText(raw);

  if (!text) return [];

  const identity = extractHoodScanIdentity(
    text,
    address
  );

  const priceUsd =
    extractHoodScanMetric(text, "Price");

  const mcap =
    extractHoodScanMetric(text, "Market cap");

  const volume24h =
    extractHoodScanMetric(text, "24h volume");

  const liquidity =
    extractHoodScanMetric(text, "Liquidity");

  const txns24h =
    extractHoodScanMetric(text, "24h trades");

  // Do not accept a page as a market result unless it actually contains
  // a usable price. This prevents metadata-only pages from winning.
  if (!validNumber(priceUsd)) {
    return [];
  }

  return [
    {
      chain,
      ca: identity.contract,

      name: identity.name,
      symbol: identity.symbol,
      image: null,

      price: priceUsd,
      mcap,
      fdv: null,
      liquidity,
      volume24h,
      volume5m: null,
      txns24h,

      pair: null,
      dex: "hoodscan",

      url,
      source: "hoodscan",
      confidence: 95,
      markets: []
    }
  ];
}


// ============================================================
// FINAL MARKET ENGINE
// ============================================================

async function getTokenData(
  chain,
  ca
) {
  const config =
    CHAINS[chain];

  if (!config) {
    throw new Error(
      "Unsupported chain"
    );
  }

  ca =
    String(ca || "")
      .trim();

  if (!ca) {
    throw new Error(
      "Missing CA"
    );
  }

  // Solana base58 validation
  if (
    chain === "solana" &&
    (
      ca.length < 32 ||
      ca.length > 50
    )
  ) {
    throw new Error(
      "Invalid Solana CA"
    );
  }

  // EVM validation
  if (
    config.type === "evm" &&
    !/^0x[a-fA-F0-9]{40}$/.test(ca)
  ) {
    throw new Error(
      "Invalid EVM CA"
    );
  }

  const normalizedCA =
    config.type === "evm"
      ? ca.toLowerCase()
      : ca;

  const markets = [];

  // ----------------------------------------------------------
  // 1. HOODSCAN (Robinhood-first)
  // ----------------------------------------------------------

  try {
    const hs =
      await getHoodScanMarket(
        chain,
        normalizedCA
      );

    markets.push(...hs);
  } catch (error) {
    console.log(
      "HOODSCAN ERROR",
      error?.message || String(error)
    );
  }

  // ----------------------------------------------------------
  // 2. DEXSCREENER
  // ----------------------------------------------------------

  try {
    const ds =
      await getDexScreenerMarkets(
        chain,
        normalizedCA
      );

    markets.push(...ds);
  } catch {}

  // ----------------------------------------------------------
  // 3. GECKOTERMINAL
  // ----------------------------------------------------------

  try {
    const gt =
      await getGeckoMarkets(
        chain,
        normalizedCA
      );

    markets.push(...gt);
  } catch {}

  // ----------------------------------------------------------
  // 4. DIRECT UNISWAP V2 + V3
  // ----------------------------------------------------------

  if (
    config.type === "evm"
  ) {
    try {
      const uniV2 =
        await getDirectUniswapV2Markets(
          chain,
          normalizedCA
        );

      markets.push(...uniV2);
    } catch {}

    try {
      const uniV3 =
        await getDirectUniswapMarkets(
          chain,
          normalizedCA
        );

      markets.push(...uniV3);
    } catch {}
  }

  // ----------------------------------------------------------
  // Remove duplicate markets
  // ----------------------------------------------------------

  const unique =
    [];

  const seen =
    new Set();

  for (const market of markets) {
    const key =
      `${market.source}:${normalizeAddress(
        market.pair || ""
      )}:${market.price}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(market);
  }

  // ----------------------------------------------------------
  // Best market
  // ----------------------------------------------------------

  let best =
    chooseBestMarket(
      unique
    );

  // ----------------------------------------------------------
  // ON-CHAIN METADATA FALLBACK
  // ----------------------------------------------------------

  let metadata = {
    name: null,
    symbol: null,
    decimals: null,
    totalSupply: null
  };

  // Only hit chain metadata when the market source did not
  // already provide the fields we need. This keeps a BUY/SELL
  // market check lightweight, especially for HoodScan.
  const needsMetadata =
    !best ||
    !best.name ||
    best.name === "Unknown" ||
    !best.symbol ||
    best.symbol === "UNKNOWN" ||
    !validNumber(best.mcap);

  if (needsMetadata && config.type === "evm") {
    metadata =
      await getERC20Metadata(
        chain,
        normalizedCA
      );
  }

  if (needsMetadata && chain === "solana") {
    const sol =
      await getSolanaMetadata(
        normalizedCA
      );

    metadata = {
      ...metadata,
      decimals:
        sol.decimals,
      totalSupply:
        sol.supply
    };
  }

  // ----------------------------------------------------------
  // No market but token exists
  // ----------------------------------------------------------

  if (!best) {
    if (
      metadata.name ||
      metadata.symbol ||
      validNumber(
        metadata.totalSupply
      )
    ) {
      return {
        ...emptyMarket(
          chain,
          normalizedCA
        ),

        name:
          metadata.name ||
          "Unknown",

        symbol:
          metadata.symbol ||
          "UNKNOWN",

        price: null,
        mcap: null,

        source:
          "onchain",

        confidence: 15,

        markets: []
      };
    }

    throw new Error(
      "Token and market not found"
    );
  }

  // ----------------------------------------------------------
  // Fill missing metadata
  // ----------------------------------------------------------

  best.name =
    best.name !== "Unknown"
      ? best.name
      : metadata.name ||
        best.name;

  best.symbol =
    best.symbol !== "UNKNOWN"
      ? best.symbol
      : metadata.symbol ||
        best.symbol;

  // ----------------------------------------------------------
  // Calculate MCap if missing
  // ----------------------------------------------------------

  if (
    !validNumber(best.mcap) &&
    validNumber(best.price) &&
    validNumber(metadata.totalSupply)
  ) {
    const supply =
      typeof metadata.totalSupply ===
      "bigint"
        ? Number(
            metadata.totalSupply
          )
        : Number(
            metadata.totalSupply
          );

    if (
      Number.isFinite(supply)
    ) {
      best.mcap =
        best.price *
        supply;
    }
  }

  return enrichConfidence(
    best,
    unique
  );
}


// ============================================================
// KEYBOARDS
// ============================================================

function mainKeyboard() {
  return [
    [
      {
        text: "⚡ TRADE",
        callback_data: "trade"
      },
      {
        text: "📊 POSITIONS",
        callback_data: "positions"
      }
    ],
    [
      {
        text: "💰 WALLET",
        callback_data: "wallet"
      },
      {
        text: "📜 HISTORY",
        callback_data: "history"
      }
    ]
  ];
}


function backKeyboard() {
  return [
    [
      {
        text: "← Back",
        callback_data: "home"
      }
    ]
  ];
}


function chainKeyboard() {
  return [
    [
      {
        text: "🟣 Solana",
        callback_data: "chain:solana"
      }
    ],
    [
      {
        text: "🔵 Arc",
        callback_data: "chain:arc"
      }
    ],
    [
      {
        text: "🟠 Robinhood",
        callback_data: "chain:robinhood"
      }
    ],
    [
      {
        text: "← Back",
        callback_data: "home"
      }
    ]
  ];
}


// ============================================================
// HOME
// ============================================================

async function showHome(
  env,
  chatId,
  userId,
  messageId = null
) {
  const wallet =
    await getWallet(
      env,
      userId
    );

  const positions =
    await env.DB
      .prepare(`
        SELECT *
        FROM positions
        WHERE user_id = ?
        ORDER BY created_at DESC
      `)
      .bind(userId)
      .all();

  let holdings = 0;
  let unrealized = 0;

  for (
    const p of
    positions.results || []
  ) {
    try {
      const market =
        await getTokenData(
          p.chain,
          p.ca
        );

      const value =
        Number(p.quantity) *
        Number(market.price);

      holdings += value;

      unrealized +=
        value -
        Number(
          p.invested_usd
        );
    } catch {}
  }

  const cash =
    Number(
      wallet.cash_balance
    );

  const total =
    cash +
    holdings;

  const totalPnl =
    Number(
      wallet.realized_pnl
    ) +
    unrealized;

  const text = `
🦍 <b>DEGEN PAPER TRADER</b>

💰 Cash: <b>${money(cash)}</b>
📊 Portfolio: <b>${money(total)}</b>
📈 PnL: <b>${totalPnl >= 0 ? "+" : ""}${money(totalPnl)}</b>

Paper Capital: ${money(wallet.starting_balance)}
`.trim();

  if (messageId) {
    return editMessage(
      env,
      chatId,
      messageId,
      text,
      mainKeyboard()
    );
  }

  return sendMessage(
    env,
    chatId,
    text,
    mainKeyboard()
  );
}


// ============================================================
// TRADE
// ============================================================

async function showChains(
  env,
  chatId
) {
  return sendMessage(
    env,
    chatId,
    `
⚡ <b>TRADE</b>

Select a chain:
`.trim(),
    chainKeyboard()
  );
}


async function askCA(
  env,
  chatId,
  userId,
  chain
) {
  await setSession(
    env,
    userId,
    "awaiting_ca",
    {
      chain
    }
  );

  const c =
    CHAINS[chain];

  return sendMessage(
    env,
    chatId,
    `
${c.emoji} <b>${c.name}</b>

Paste the token CA 👇

Send the contract address as a message.
`.trim(),
    backKeyboard()
  );
}


async function showToken(
  env,
  chatId,
  userId,
  token
) {
  await setSession(
    env,
    userId,
    "awaiting_amount",
    {
      token
    }
  );

  const text = `
🪙 <b>${esc(token.symbol)}</b>
${esc(token.name)}

${esc(token.chainName || CHAINS[token.chain]?.name || token.chain)}

💵 Price: <b>${price(token.price)}</b>
💰 MCap: <b>${compactMoney(token.mcap)}</b>
💧 Liquidity: <b>${compactMoney(token.liquidity)}</b>

📡 Source: <b>${esc(token.source || "multi-source")}</b>
🎯 Confidence: <b>${Number(token.confidence || 0)}%</b>

CA:
<code>${esc(token.ca)}</code>

How much do you want to buy?
`.trim();

  const keyboard = [
    [
      {
        text: "$1",
        callback_data: "buyamt:1"
      },
      {
        text: "$5",
        callback_data: "buyamt:5"
      },
      {
        text: "$10",
        callback_data: "buyamt:10"
      }
    ],
    [
      {
        text: "$25",
        callback_data: "buyamt:25"
      },
      {
        text: "$50",
        callback_data: "buyamt:50"
      },
      {
        text: "Custom",
        callback_data: "buycustom"
      }
    ],
    [
      {
        text: "← Back",
        callback_data: "trade"
      }
    ]
  ];

  if (token.image) {
    try {
      return await sendPhoto(
        env,
        chatId,
        token.image,
        text,
        keyboard
      );
    } catch {}
  }

  return sendMessage(
    env,
    chatId,
    text,
    keyboard
  );
}


// ============================================================
// BUY CONFIRM
// ============================================================

async function showBuyConfirm(
  env,
  chatId,
  userId,
  amount
) {
  const session =
    await getSession(
      env,
      userId
    );

  if (!session) {
    return showHome(
      env,
      chatId,
      userId
    );
  }

  const data =
    JSON.parse(
      session.data || "{}"
    );

  const token =
    data.token;

  if (!token) {
    return showHome(
      env,
      chatId,
      userId
    );
  }

  amount =
    Number(amount);

  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    return sendMessage(
      env,
      chatId,
      "❌ Invalid amount.",
      backKeyboard()
    );
  }

  await setSession(
    env,
    userId,
    "confirm_buy",
    {
      token,
      amount
    }
  );

  return sendMessage(
    env,
    chatId,
    `
🟢 <b>CONFIRM PAPER BUY</b>

🪙 $${esc(token.symbol)}

Amount:
<b>${money(amount)}</b>

No real transaction will happen.
This is paper trading only.
`.trim(),
    [
      [
        {
          text: "✅ CONFIRM BUY",
          callback_data: "confirmbuy"
        }
      ],
      [
        {
          text: "❌ CANCEL",
          callback_data: "trade"
        }
      ]
    ]
  );
}


// ============================================================
// EXECUTE BUY
// ============================================================

async function executeBuy(
  env,
  chatId,
  userId
) {
  const session =
    await getSession(
      env,
      userId
    );

  if (!session) return;

  const data =
    JSON.parse(
      session.data || "{}"
    );

  const token =
    data.token;

  const amount =
    Number(data.amount);

  if (
    !token ||
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    return;
  }

  const wallet =
    await getWallet(
      env,
      userId
    );

  if (
    amount >
    Number(wallet.cash_balance)
  ) {
    return sendMessage(
      env,
      chatId,
      "❌ Insufficient paper balance.",
      mainKeyboard()
    );
  }

  let market;

  try {
    market =
      await getTokenData(
        token.chain,
        token.ca
      );
  } catch {
    return sendMessage(
      env,
      chatId,
      "❌ Market data unavailable right now. Try again.",
      mainKeyboard()
    );
  }

  if (
    !validNumber(market.price)
  ) {
    return sendMessage(
      env,
      chatId,
      "❌ Token has no usable market price yet.",
      mainKeyboard()
    );
  }

  const executionPrice =
    Number(market.price);

  const quantity =
    amount /
    executionPrice;

  const now =
    Date.now();

  const existing =
    await env.DB
      .prepare(`
        SELECT *
        FROM positions
        WHERE user_id = ?
        AND chain = ?
        AND ca = ?
        LIMIT 1
      `)
      .bind(
        userId,
        token.chain,
        token.ca
      )
      .first();

  if (existing) {
    const oldQty =
      Number(existing.quantity);

    const oldInvested =
      Number(existing.invested_usd);

    const newQty =
      oldQty +
      quantity;

    const newInvested =
      oldInvested +
      amount;

    const avgPrice =
      newInvested /
      newQty;

    const oldEntryMcap =
      Number(
        existing.entry_mcap ||
        market.mcap ||
        0
      );

    const newEntryMcap =
      oldInvested > 0 &&
      validNumber(market.mcap)
        ? (
            (
              oldEntryMcap *
              oldInvested
            ) +
            (
              Number(market.mcap) *
              amount
            )
          ) /
          newInvested
        : market.mcap;

    await env.DB
      .prepare(`
        UPDATE positions
        SET
          entry_price = ?,
          current_price = ?,
          entry_mcap = ?,
          current_mcap = ?,
          quantity = ?,
          invested_usd = ?,
          remaining_invested_usd = ?,
          updated_at = ?
        WHERE id = ?
      `)
      .bind(
        avgPrice,
        executionPrice,
        newEntryMcap || null,
        market.mcap || null,
        newQty,
        newInvested,
        newInvested,
        now,
        existing.id
      )
      .run();

    await env.DB
      .prepare(`
        UPDATE wallets
        SET
          cash_balance =
            cash_balance - ?,
          updated_at = ?
        WHERE user_id = ?
      `)
      .bind(
        amount,
        now,
        userId
      )
      .run();

    await env.DB
      .prepare(`
        INSERT INTO trades
        (
          user_id,
          position_id,
          chain,
          ca,
          name,
          symbol,
          side,
          sell_percent,
          price,
          mcap,
          quantity,
          usd_amount,
          pnl_usd,
          pnl_percent,
          created_at
        )
        VALUES (
          ?, ?, ?, ?, ?, ?,
          'BUY', NULL,
          ?, ?, ?, ?,
          0, 0, ?
        )
      `)
      .bind(
        userId,
        existing.id,
        token.chain,
        token.ca,
        token.name,
        token.symbol,
        executionPrice,
        market.mcap || null,
        quantity,
        amount,
        now
      )
      .run();

  } else {
    const result =
      await env.DB
        .prepare(`
          INSERT INTO positions
          (
            user_id,
            chain,
            ca,
            name,
            symbol,
            logo_url,
            entry_price,
            current_price,
            entry_mcap,
            current_mcap,
            quantity,
            invested_usd,
            remaining_invested_usd,
            created_at,
            updated_at
          )
          VALUES (
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?, ?, ?
          )
        `)
        .bind(
          userId,
          token.chain,
          token.ca,
          token.name,
          token.symbol,
          token.image || null,
          executionPrice,
          executionPrice,
          market.mcap || null,
          market.mcap || null,
          quantity,
          amount,
          amount,
          now,
          now
        )
        .run();

    const positionId =
      result.meta.last_row_id;

    await env.DB
      .prepare(`
        UPDATE wallets
        SET
          cash_balance =
            cash_balance - ?,
          updated_at = ?
        WHERE user_id = ?
      `)
      .bind(
        amount,
        now,
        userId
      )
      .run();

    await env.DB
      .prepare(`
        INSERT INTO trades
        (
          user_id,
          position_id,
          chain,
          ca,
          name,
          symbol,
          side,
          sell_percent,
          price,
          mcap,
          quantity,
          usd_amount,
          pnl_usd,
          pnl_percent,
          created_at
        )
        VALUES (
          ?, ?, ?, ?, ?, ?,
          'BUY', NULL,
          ?, ?, ?, ?,
          0, 0, ?
        )
      `)
      .bind(
        userId,
        positionId,
        token.chain,
        token.ca,
        token.name,
        token.symbol,
        executionPrice,
        market.mcap || null,
        quantity,
        amount,
        now
      )
      .run();
  }

  await clearSession(
    env,
    userId
  );

  return sendMessage(
    env,
    chatId,
    `
✅ <b>PAPER BUY COMPLETE</b>

🪙 $${esc(token.symbol)}
${esc(
  CHAINS[token.chain]?.name ||
  token.chain
)}

Entry:
<b>${price(executionPrice)}</b>

MCap:
<b>${compactMoney(market.mcap)}</b>

Invested:
<b>${money(amount)}</b>

Tokens:
<b>${quantity.toLocaleString()}</b>

📡 ${esc(market.source || "multi-source")}
`.trim(),
    [
      [
        {
          text: "📊 VIEW POSITIONS",
          callback_data: "positions"
        }
      ],
      [
        {
          text: "⚡ TRADE AGAIN",
          callback_data: "trade"
        },
        {
          text: "🏠 HOME",
          callback_data: "home"
        }
      ]
    ]
  );
}


// ============================================================
// POSITIONS
// ============================================================

async function showPositions(
  env,
  chatId,
  userId
) {
  const rows =
    await env.DB
      .prepare(`
        SELECT *
        FROM positions
        WHERE user_id = ?
        ORDER BY created_at DESC
      `)
      .bind(userId)
      .all();

  if (
    !rows.results?.length
  ) {
    return sendMessage(
      env,
      chatId,
      `
📊 <b>POSITIONS</b>

No open positions yet.
`.trim(),
      [
        [
          {
            text: "⚡ TRADE",
            callback_data: "trade"
          }
        ],
        [
          {
            text: "← Back",
            callback_data: "home"
          }
        ]
      ]
    );
  }

  const buttons = [];

  for (
    const p of
    rows.results
  ) {
    let market;

    try {
      market =
        await getTokenData(
          p.chain,
          p.ca
        );
    } catch {
      market = {
        price:
          Number(
            p.current_price || 0
          ),
        mcap:
          p.current_mcap
      };
    }

    const value =
      Number(p.quantity) *
      Number(market.price || 0);

    const pnl =
      value -
      Number(p.invested_usd);

    buttons.push([
      {
        text:
          `${pnl >= 0 ? "🟢" : "🔴"} $${p.symbol} ${percent(
            Number(p.invested_usd) > 0
              ? (
                  pnl /
                  Number(
                    p.invested_usd
                  )
                ) * 100
              : 0
          )}`,
        callback_data:
          `pos:${p.id}`
      }
    ]);
  }

  buttons.push([
    {
      text: "← Back",
      callback_data: "home"
    }
  ]);

  return sendMessage(
    env,
    chatId,
    "📊 <b>YOUR POSITIONS</b>\n\nSelect a position:",
    buttons
  );
}


// ============================================================
// POSITION DETAIL
// ============================================================

async function showPosition(
  env,
  chatId,
  userId,
  positionId
) {
  const p =
    await env.DB
      .prepare(`
        SELECT *
        FROM positions
        WHERE id = ?
        AND user_id = ?
      `)
      .bind(
        positionId,
        userId
      )
      .first();

  if (!p) {
    return sendMessage(
      env,
      chatId,
      "❌ Position not found.",
      mainKeyboard()
    );
  }

  let market;

  try {
    market =
      await getTokenData(
        p.chain,
        p.ca
      );
  } catch {
    market = {
      price:
        Number(
          p.current_price || 0
        ),
      mcap:
        p.current_mcap
    };
  }

  const currentPrice =
    Number(
      market.price ||
      p.current_price ||
      0
    );

  const value =
    Number(p.quantity) *
    currentPrice;

  const invested =
    Number(p.invested_usd);

  const pnl =
    value -
    invested;

  const pnlPercent =
    invested > 0
      ? (
          pnl /
          invested
        ) * 100
      : 0;

  const multiple =
    Number(p.entry_price) > 0
      ? currentPrice /
        Number(p.entry_price)
      : 0;

  await env.DB
    .prepare(`
      UPDATE positions
      SET
        current_price = ?,
        current_mcap = ?,
        updated_at = ?
      WHERE id = ?
    `)
    .bind(
      currentPrice,
      market.mcap || null,
      Date.now(),
      positionId
    )
    .run();

  return sendMessage(
    env,
    chatId,
    `
📊 <b>$${esc(p.symbol)} POSITION</b>

${esc(p.name)}

━━━━━━━━━━━━

Entry Price:
<b>${price(p.entry_price)}</b>

Current Price:
<b>${price(currentPrice)}</b>

Entry MCap:
<b>${compactMoney(p.entry_mcap)}</b>

Current MCap:
<b>${compactMoney(market.mcap)}</b>

━━━━━━━━━━━━

Invested:
<b>${money(invested)}</b>

Current Value:
<b>${money(value)}</b>

PnL:
<b>${pnl >= 0 ? "+" : ""}${money(pnl)}</b>
<b>(${percent(pnlPercent)})</b>

Multiple:
<b>${multiple.toFixed(2)}x</b>
`.trim(),
    [
      [
        {
          text: "➕ BUY MORE",
          callback_data:
            `buypos:${positionId}`
        }
      ],
      [
        {
          text: "🔴 SELL",
          callback_data:
            `sell:${positionId}`
        }
      ],
      [
        {
          text: "← Back",
          callback_data:
            "positions"
        }
      ]
    ]
  );
}


// ============================================================
// BUY MORE
// ============================================================

async function askBuyMore(
  env,
  chatId,
  userId,
  positionId
) {
  const p =
    await env.DB
      .prepare(`
        SELECT *
        FROM positions
        WHERE id = ?
        AND user_id = ?
      `)
      .bind(
        positionId,
        userId
      )
      .first();

  if (!p) return;

  await setSession(
    env,
    userId,
    "buy_more",
    {
      positionId
    }
  );

  return sendMessage(
    env,
    chatId,
    `
➕ <b>BUY MORE</b>

$${esc(p.symbol)}

Choose amount:
`.trim(),
    [
      [
        {
          text: "$1",
          callback_data: "moreamt:1"
        },
        {
          text: "$5",
          callback_data: "moreamt:5"
        },
        {
          text: "$10",
          callback_data: "moreamt:10"
        }
      ],
      [
        {
          text: "$25",
          callback_data: "moreamt:25"
        },
        {
          text: "$50",
          callback_data: "moreamt:50"
        },
        {
          text: "Custom",
          callback_data: "morecustom"
        }
      ],
      [
        {
          text: "← Back",
          callback_data:
            `pos:${positionId}`
        }
      ]
    ]
  );
}


async function confirmBuyMore(
  env,
  chatId,
  userId,
  amount
) {
  const session =
    await getSession(
      env,
      userId
    );

  if (!session) return;

  const data =
    JSON.parse(
      session.data || "{}"
    );

  const positionId =
    Number(
      data.positionId
    );

  const p =
    await env.DB
      .prepare(`
        SELECT *
        FROM positions
        WHERE id = ?
        AND user_id = ?
      `)
      .bind(
        positionId,
        userId
      )
      .first();

  if (!p) return;

  amount =
    Number(amount);

  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    return sendMessage(
      env,
      chatId,
      "❌ Invalid amount.",
      backKeyboard()
    );
  }

  const market =
    await getTokenData(
      p.chain,
      p.ca
    );

  const qty =
    amount /
    Number(market.price);

  await setSession(
    env,
    userId,
    "confirm_more",
    {
      positionId,
      amount
    }
  );

  return sendMessage(
    env,
    chatId,
    `
🟢 <b>CONFIRM BUY MORE</b>

$${esc(p.symbol)}

Current Price:
<b>${price(market.price)}</b>

Current MCap:
<b>${compactMoney(market.mcap)}</b>

Add:
<b>${money(amount)}</b>

Tokens:
<b>${qty.toLocaleString()}</b>
`.trim(),
    [
      [
        {
          text: "✅ CONFIRM",
          callback_data:
            "confirmmore"
        }
      ],
      [
        {
          text: "❌ CANCEL",
          callback_data:
            `pos:${positionId}`
        }
      ]
    ]
  );
}


async function executeBuyMore(
  env,
  chatId,
  userId
) {
  const session =
    await getSession(
      env,
      userId
    );

  if (!session) return;

  const data =
    JSON.parse(
      session.data || "{}"
    );

  const positionId =
    Number(
      data.positionId
    );

  const amount =
    Number(data.amount);

  const p =
    await env.DB
      .prepare(`
        SELECT *
        FROM positions
        WHERE id = ?
        AND user_id = ?
      `)
      .bind(
        positionId,
        userId
      )
      .first();

  if (!p) return;

  const wallet =
    await getWallet(
      env,
      userId
    );

  if (
    amount >
    Number(wallet.cash_balance)
  ) {
    return sendMessage(
      env,
      chatId,
      "❌ Insufficient paper balance.",
      mainKeyboard()
    );
  }

  const market =
    await getTokenData(
      p.chain,
      p.ca
    );

  const qty =
    amount /
    Number(market.price);

  const oldQty =
    Number(p.quantity);

  const oldInvested =
    Number(p.invested_usd);

  const newQty =
    oldQty +
    qty;

  const newInvested =
    oldInvested +
    amount;

  const newEntryPrice =
    newInvested /
    newQty;

  const now =
    Date.now();

  await env.DB
    .prepare(`
      UPDATE positions
      SET
        entry_price = ?,
        current_price = ?,
        current_mcap = ?,
        quantity = ?,
        invested_usd = ?,
        remaining_invested_usd = ?,
        updated_at = ?
      WHERE id = ?
    `)
    .bind(
      newEntryPrice,
      market.price,
      market.mcap || null,
      newQty,
      newInvested,
      newInvested,
      now,
      positionId
    )
    .run();

  await env.DB
    .prepare(`
      UPDATE wallets
      SET
        cash_balance =
          cash_balance - ?,
        updated_at = ?
      WHERE user_id = ?
    `)
    .bind(
      amount,
      now,
      userId
    )
    .run();

  await env.DB
    .prepare(`
      INSERT INTO trades
      (
        user_id,
        position_id,
        chain,
        ca,
        name,
        symbol,
        side,
        sell_percent,
        price,
        mcap,
        quantity,
        usd_amount,
        pnl_usd,
        pnl_percent,
        created_at
      )
      VALUES (
        ?, ?, ?, ?, ?, ?,
        'BUY', NULL,
        ?, ?, ?, ?,
        0, 0, ?
      )
    `)
    .bind(
      userId,
      positionId,
      p.chain,
      p.ca,
      p.name,
      p.symbol,
      market.price,
      market.mcap || null,
      qty,
      amount,
      now
    )
    .run();

  await clearSession(
    env,
    userId
  );

  return sendMessage(
    env,
    chatId,
    `
✅ <b>BUY MORE COMPLETE</b>

$${esc(p.symbol)}

Added:
<b>${money(amount)}</b>

New Entry:
<b>${price(newEntryPrice)}</b>
`.trim(),
    [
      [
        {
          text: "📊 POSITION",
          callback_data:
            `pos:${positionId}`
        }
      ],
      [
        {
          text: "🏠 HOME",
          callback_data:
            "home"
        }
      ]
    ]
  );
}


// ============================================================
// SELL
// ============================================================

async function showSellMenu(
  env,
  chatId,
  userId,
  positionId
) {
  const p =
    await env.DB
      .prepare(`
        SELECT *
        FROM positions
        WHERE id = ?
        AND user_id = ?
      `)
      .bind(
        positionId,
        userId
      )
      .first();

  if (!p) return;

  let market;

  try {
    market =
      await getTokenData(
        p.chain,
        p.ca
      );
  } catch {
    market = {
      price:
        Number(
          p.current_price
        ),
      mcap:
        p.current_mcap
    };
  }

  const value =
    Number(p.quantity) *
    Number(market.price);

  const pnl =
    value -
    Number(p.invested_usd);

  const multiple =
    Number(p.entry_price) > 0
      ? Number(market.price) /
        Number(p.entry_price)
      : 0;

  return sendMessage(
    env,
    chatId,
    `
🔴 <b>SELL $${esc(p.symbol)}</b>

Current:
<b>${price(market.price)}</b>

Position:
<b>${money(value)}</b>

PnL:
<b>${pnl >= 0 ? "+" : ""}${money(pnl)}</b>

Multiple:
<b>${multiple.toFixed(2)}x</b>
`.trim(),
    [
      [
        {
          text: "💥 MAX SELL 100%",
          callback_data:
            `sellconfirm:${positionId}:100`
        }
      ],
      [
        {
          text: "📉 DCA OUT",
          callback_data:
            `dca:${positionId}`
        }
      ],
      [
        {
          text: "← Back",
          callback_data:
            `pos:${positionId}`
        }
      ]
    ]
  );
}


// ============================================================
// DCA OUT
// ============================================================

async function showDcaMenu(
  env,
  chatId,
  userId,
  positionId
) {
  const p =
    await env.DB
      .prepare(`
        SELECT *
        FROM positions
        WHERE id = ?
        AND user_id = ?
      `)
      .bind(
        positionId,
        userId
      )
      .first();

  if (!p) return;

  let market;

  try {
    market =
      await getTokenData(
        p.chain,
        p.ca
      );
  } catch {
    market = {
      price:
        Number(
          p.current_price
        )
    };
  }

  const multiple =
    Number(p.entry_price) > 0
      ? Number(market.price) /
        Number(p.entry_price)
      : 0;

  const value =
    Number(p.quantity) *
    Number(market.price);

  const pnl =
    value -
    Number(p.invested_usd);

  return sendMessage(
    env,
    chatId,
    `
📉 <b>DCA OUT</b>

$${esc(p.symbol)}

Current:
<b>${price(market.price)}</b>

Value:
<b>${money(value)}</b>

PnL:
<b>${pnl >= 0 ? "+" : ""}${money(pnl)}</b>

Multiple:
<b>${multiple.toFixed(2)}x</b>

Sell:
`.trim(),
    [
      [
        {
          text: "20%",
          callback_data:
            `sellconfirm:${positionId}:20`
        },
        {
          text: "40%",
          callback_data:
            `sellconfirm:${positionId}:40`
        }
      ],
      [
        {
          text: "60%",
          callback_data:
            `sellconfirm:${positionId}:60`
        },
        {
          text: "80%",
          callback_data:
            `sellconfirm:${positionId}:80`
        },
        {
          text: "100%",
          callback_data:
            `sellconfirm:${positionId}:100`
        }
      ],
      [
        {
          text: "← Back",
          callback_data:
            `sell:${positionId}`
        }
      ]
    ]
  );
}


// ============================================================
// SELL CONFIRM
// ============================================================

async function confirmSell(
  env,
  chatId,
  userId,
  positionId,
  sellPercent
) {
  const p =
    await env.DB
      .prepare(`
        SELECT *
        FROM positions
        WHERE id = ?
        AND user_id = ?
      `)
      .bind(
        positionId,
        userId
      )
      .first();

  if (!p) return;

  const market =
    await getTokenData(
      p.chain,
      p.ca
    );

  const pct =
    Number(sellPercent);

  if (
    !Number.isFinite(pct) ||
    pct <= 0 ||
    pct > 100
  ) {
    return;
  }

  const sellQty =
    Number(p.quantity) *
    pct /
    100;

  const sellValue =
    sellQty *
    Number(market.price);

  const costBasis =
    Number(p.invested_usd) *
    pct /
    100;

  const pnl =
    sellValue -
    costBasis;

  await setSession(
    env,
    userId,
    "confirm_sell",
    {
      positionId,
      sellPercent: pct
    }
  );

  return sendMessage(
    env,
    chatId,
    `
🔴 <b>CONFIRM PAPER SELL</b>

$${esc(p.symbol)}

Sell:
<b>${pct}%</b>

Value:
<b>${money(sellValue)}</b>

PnL:
<b>${pnl >= 0 ? "+" : ""}${money(pnl)}</b>
`.trim(),
    [
      [
        {
          text: "✅ CONFIRM SELL",
          callback_data:
            "confirmsell"
        }
      ],
      [
        {
          text: "❌ CANCEL",
          callback_data:
            `pos:${positionId}`
        }
      ]
    ]
  );
}


// ============================================================
// EXECUTE SELL
// ============================================================

async function executeSell(
  env,
  chatId,
  userId
) {
  const session =
    await getSession(
      env,
      userId
    );

  if (!session) return;

  const data =
    JSON.parse(
      session.data || "{}"
    );

  const positionId =
    Number(
      data.positionId
    );

  const sellPercent =
    Number(
      data.sellPercent
    );

  const p =
    await env.DB
      .prepare(`
        SELECT *
        FROM positions
        WHERE id = ?
        AND user_id = ?
      `)
      .bind(
        positionId,
        userId
      )
      .first();

  if (!p) return;

  const market =
    await getTokenData(
      p.chain,
      p.ca
    );

  const pct =
    sellPercent /
    100;

  const oldQty =
    Number(p.quantity);

  const sellQty =
    oldQty *
    pct;

  const sellValue =
    sellQty *
    Number(market.price);

  const oldInvested =
    Number(p.invested_usd);

  const costBasis =
    oldInvested *
    pct;

  const pnl =
    sellValue -
    costBasis;

  const pnlPercent =
    costBasis > 0
      ? (
          pnl /
          costBasis
        ) * 100
      : 0;

  const newQty =
    oldQty -
    sellQty;

  const newInvested =
    oldInvested -
    costBasis;

  const now =
    Date.now();

  await env.DB
    .prepare(`
      UPDATE wallets
      SET
        cash_balance =
          cash_balance + ?,
        realized_pnl =
          realized_pnl + ?,
        updated_at = ?
      WHERE user_id = ?
    `)
    .bind(
      sellValue,
      pnl,
      now,
      userId
    )
    .run();

  await env.DB
    .prepare(`
      INSERT INTO trades
      (
        user_id,
        position_id,
        chain,
        ca,
        name,
        symbol,
        side,
        sell_percent,
        price,
        mcap,
        quantity,
        usd_amount,
        pnl_usd,
        pnl_percent,
        created_at
      )
      VALUES (
        ?, ?, ?, ?, ?, ?,
        'SELL', ?,
        ?, ?, ?, ?,
        ?, ?, ?
      )
    `)
    .bind(
      userId,
      positionId,
      p.chain,
      p.ca,
      p.name,
      p.symbol,
      sellPercent,
      market.price,
      market.mcap || null,
      sellQty,
      sellValue,
      pnl,
      pnlPercent,
      now
    )
    .run();

  if (
    newQty <= 0.000000000001 ||
    sellPercent >= 99.999
  ) {
    await env.DB
      .prepare(`
        DELETE FROM positions
        WHERE id = ?
        AND user_id = ?
      `)
      .bind(
        positionId,
        userId
      )
      .run();
  } else {
    await env.DB
      .prepare(`
        UPDATE positions
        SET
          quantity = ?,
          invested_usd = ?,
          remaining_invested_usd = ?,
          current_price = ?,
          current_mcap = ?,
          updated_at = ?
        WHERE id = ?
        AND user_id = ?
      `)
      .bind(
        newQty,
        newInvested,
        newInvested,
        market.price,
        market.mcap || null,
        now,
        positionId,
        userId
      )
      .run();
  }

  await clearSession(
    env,
    userId
  );

  return sendMessage(
    env,
    chatId,
    `
✅ <b>PAPER SELL COMPLETE</b>

$${esc(p.symbol)}

Sold:
<b>${sellPercent}%</b>

Received:
<b>${money(sellValue)}</b>

PnL:
<b>${pnl >= 0 ? "+" : ""}${money(pnl)}</b>
<b>(${percent(pnlPercent)})</b>
`.trim(),
    [
      [
        {
          text: "📊 POSITIONS",
          callback_data:
            "positions"
        }
      ],
      [
        {
          text: "💰 WALLET",
          callback_data:
            "wallet"
        },
        {
          text: "🏠 HOME",
          callback_data:
            "home"
        }
      ]
    ]
  );
}


// ============================================================
// WALLET
// ============================================================

async function showWallet(
  env,
  chatId,
  userId
) {
  const wallet =
    await getWallet(
      env,
      userId
    );

  const rows =
    await env.DB
      .prepare(`
        SELECT *
        FROM positions
        WHERE user_id = ?
      `)
      .bind(userId)
      .all();

  let holdings = 0;
  let unrealized = 0;

  for (
    const p of
    rows.results || []
  ) {
    try {
      const market =
        await getTokenData(
          p.chain,
          p.ca
        );

      const value =
        Number(p.quantity) *
        Number(market.price);

      holdings += value;

      unrealized +=
        value -
        Number(p.invested_usd);
    } catch {}
  }

  const cash =
    Number(wallet.cash_balance);

  const total =
    cash +
    holdings;

  const totalPnl =
    Number(wallet.realized_pnl) +
    unrealized;

  return sendMessage(
    env,
    chatId,
    `
💰 <b>PAPER WALLET</b>

💵 Cash
<b>${money(cash)}</b>

📦 Holdings
<b>${money(holdings)}</b>

💼 Portfolio
<b>${money(total)}</b>

📈 Realized PnL
<b>${wallet.realized_pnl >= 0 ? "+" : ""}${money(wallet.realized_pnl)}</b>

📊 Unrealized PnL
<b>${unrealized >= 0 ? "+" : ""}${money(unrealized)}</b>

🔥 Total PnL
<b>${totalPnl >= 0 ? "+" : ""}${money(totalPnl)}</b>

Initial Capital
<b>${money(wallet.starting_balance)}</b>
`.trim(),
    [
      [
        {
          text: "💸 REQUEST FUNDS",
          callback_data: "funds"
        }
      ],
      [
        {
          text: "📊 POSITIONS",
          callback_data: "positions"
        },
        {
          text: "← Back",
          callback_data: "home"
        }
      ]
    ]
  );
}


// ============================================================
// PAPER FUNDS
// ============================================================

async function showFunds(
  env,
  chatId,
  userId
) {
  await setSession(
    env,
    userId,
    "fund_request",
    {}
  );

  return sendMessage(
    env,
    chatId,
    `
💸 <b>REQUEST PAPER FUNDS</b>

Choose amount:
`.trim(),
    [
      [
        {
          text: "$10",
          callback_data: "fund:10"
        },
        {
          text: "$25",
          callback_data: "fund:25"
        },
        {
          text: "$50",
          callback_data: "fund:50"
        }
      ],
      [
        {
          text: "$100",
          callback_data: "fund:100"
        },
        {
          text: "$250",
          callback_data: "fund:250"
        },
        {
          text: "Custom",
          callback_data: "fundcustom"
        }
      ],
      [
        {
          text: "← Back",
          callback_data: "wallet"
        }
      ]
    ]
  );
}


async function addFunds(
  env,
  chatId,
  userId,
  amount
) {
  amount =
    Number(amount);

  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    return sendMessage(
      env,
      chatId,
      "❌ Invalid amount.",
      backKeyboard()
    );
  }

  const wallet =
    await getWallet(
      env,
      userId
    );

  const now =
    Date.now();

  await env.DB
    .prepare(`
      UPDATE wallets
      SET
        cash_balance =
          cash_balance + ?,
        updated_at = ?
      WHERE user_id = ?
    `)
    .bind(
      amount,
      now,
      userId
    )
    .run();

  await env.DB
    .prepare(`
      INSERT INTO fund_requests
      (
        user_id,
        amount,
        status,
        created_at
      )
      VALUES (
        ?, ?, 'approved', ?
      )
    `)
    .bind(
      userId,
      amount,
      now
    )
    .run();

  await clearSession(
    env,
    userId
  );

  return sendMessage(
    env,
    chatId,
    `
💸 <b>PAPER FUNDS ADDED</b>

Added:
<b>${money(amount)}</b>

New Cash Balance:
<b>${money(
  Number(wallet.cash_balance) +
  amount
)}</b>
`.trim(),
    [
      [
        {
          text: "💰 WALLET",
          callback_data: "wallet"
        }
      ],
      [
        {
          text: "⚡ TRADE",
          callback_data: "trade"
        }
      ]
    ]
  );
}


// ============================================================
// HISTORY
// ============================================================

async function showHistory(
  env,
  chatId,
  userId
) {
  const rows =
    await env.DB
      .prepare(`
        SELECT *
        FROM trades
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT 30
      `)
      .bind(userId)
      .all();

  if (
    !rows.results?.length
  ) {
    return sendMessage(
      env,
      chatId,
      `
📜 <b>TRADE HISTORY</b>

No trades yet.
`.trim(),
      backKeyboard()
    );
  }

  let text =
    "📜 <b>TRADE HISTORY</b>\n\n";

  for (
    const t of
    rows.results
  ) {
    const icon =
      t.side === "BUY"
        ? "🟢"
        : "🔴";

    const date =
      new Date(
        t.created_at
      ).toLocaleString(
        "en-US",
        {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit"
        }
      );

    text +=
      `${icon} <b>${t.side}</b> $${esc(
        t.symbol
      )}\n` +
      `💵 ${money(
        t.usd_amount
      )} @ ${price(t.price)}\n`;

    if (
      t.side === "SELL"
    ) {
      text +=
        `📈 PnL: ${
          Number(t.pnl_usd) >= 0
            ? "+"
            : ""
        }${money(t.pnl_usd)} ` +
        `(${percent(
          t.pnl_percent
        )})\n`;
    }

    text +=
      `🕐 ${date}\n\n`;
  }

  return sendMessage(
    env,
    chatId,
    text,
    backKeyboard()
  );
}


// ============================================================
// CALLBACK HANDLER
// ============================================================

async function handleCallback(
  update,
  env
) {
  const query =
    update.callback_query;

  const tgUser =
    query.from;

  const chatId =
    query.message?.chat?.id;

  if (!chatId) return;

  const user =
    await ensureUser(
      env,
      tgUser
    );

  const data =
    query.data || "";

  await answerCallback(
    env,
    query.id
  );

  if (data === "home") {
    await clearSession(
      env,
      user.id
    );

    return showHome(
      env,
      chatId,
      user.id
    );
  }

  if (data === "trade") {
    await clearSession(
      env,
      user.id
    );

    return showChains(
      env,
      chatId
    );
  }

  if (
    data.startsWith(
      "chain:"
    )
  ) {
    const chain =
      data.split(":")[1];

    if (!CHAINS[chain]) {
      return;
    }

    return askCA(
      env,
      chatId,
      user.id,
      chain
    );
  }

  if (
    data.startsWith(
      "buyamt:"
    )
  ) {
    const amount =
      Number(
        data.split(":")[1]
      );

    return showBuyConfirm(
      env,
      chatId,
      user.id,
      amount
    );
  }

  if (
    data === "buycustom"
  ) {
    const session =
      await getSession(
        env,
        user.id
      );

    if (!session) return;

    const d =
      JSON.parse(
        session.data || "{}"
      );

    await setSession(
      env,
      user.id,
      "custom_buy",
      {
        token: d.token
      }
    );

    return sendMessage(
      env,
      chatId,
      "💵 Send the amount in USD.\n\nExample: <code>7.5</code>",
      backKeyboard()
    );
  }

  if (
    data === "confirmbuy"
  ) {
    return executeBuy(
      env,
      chatId,
      user.id
    );
  }

  if (
    data === "positions"
  ) {
    await clearSession(
      env,
      user.id
    );

    return showPositions(
      env,
      chatId,
      user.id
    );
  }

  if (
    data.startsWith(
      "pos:"
    )
  ) {
    const positionId =
      Number(
        data.split(":")[1]
      );

    return showPosition(
      env,
      chatId,
      user.id,
      positionId
    );
  }

  if (
    data.startsWith(
      "buypos:"
    )
  ) {
    const positionId =
      Number(
        data.split(":")[1]
      );

    return askBuyMore(
      env,
      chatId,
      user.id,
      positionId
    );
  }

  if (
    data.startsWith(
      "moreamt:"
    )
  ) {
    const amount =
      Number(
        data.split(":")[1]
      );

    return confirmBuyMore(
      env,
      chatId,
      user.id,
      amount
    );
  }

  if (
    data === "morecustom"
  ) {
    const session =
      await getSession(
        env,
        user.id
      );

    if (!session) return;

    const d =
      JSON.parse(
        session.data || "{}"
      );

    await setSession(
      env,
      user.id,
      "custom_more",
      {
        positionId:
          d.positionId
      }
    );

    return sendMessage(
      env,
      chatId,
      "💵 Send amount in USD.\n\nExample: <code>15</code>",
      backKeyboard()
    );
  }

  if (
    data === "confirmmore"
  ) {
    return executeBuyMore(
      env,
      chatId,
      user.id
    );
  }

  if (
    data.startsWith(
      "sell:"
    )
  ) {
    const positionId =
      Number(
        data.split(":")[1]
      );

    return showSellMenu(
      env,
      chatId,
      user.id,
      positionId
    );
  }

  if (
    data.startsWith(
      "dca:"
    )
  ) {
    const positionId =
      Number(
        data.split(":")[1]
      );

    return showDcaMenu(
      env,
      chatId,
      user.id,
      positionId
    );
  }

  if (
    data.startsWith(
      "sellconfirm:"
    )
  ) {
    const parts =
      data.split(":");

    const positionId =
      Number(parts[1]);

    const sellPercent =
      Number(parts[2]);

    return confirmSell(
      env,
      chatId,
      user.id,
      positionId,
      sellPercent
    );
  }

  if (
    data === "confirmsell"
  ) {
    return executeSell(
      env,
      chatId,
      user.id
    );
  }

  if (
    data === "wallet"
  ) {
    await clearSession(
      env,
      user.id
    );

    return showWallet(
      env,
      chatId,
      user.id
    );
  }

  if (
    data === "funds"
  ) {
    return showFunds(
      env,
      chatId,
      user.id
    );
  }

  if (
    data.startsWith(
      "fund:"
    )
  ) {
    const amount =
      Number(
        data.split(":")[1]
      );

    return addFunds(
      env,
      chatId,
      user.id,
      amount
    );
  }

  if (
    data === "fundcustom"
  ) {
    await setSession(
      env,
      user.id,
      "custom_fund",
      {}
    );

    return sendMessage(
      env,
      chatId,
      "💵 Send the amount you want to request.\n\nExample: <code>100</code>",
      backKeyboard()
    );
  }

  if (
    data === "history"
  ) {
    await clearSession(
      env,
      user.id
    );

    return showHistory(
      env,
      chatId,
      user.id
    );
  }
}


// ============================================================
// MESSAGE HANDLER
// ============================================================

async function handleMessage(
  update,
  env
) {
  const message =
    update.message;

  if (
    !message?.chat?.id
  ) {
    return;
  }

  const chatId =
    message.chat.id;

  const tgUser =
    message.from;

  if (
    message.chat.type !==
    "private"
  ) {
    return;
  }

  const user =
    await ensureUser(
      env,
      tgUser
    );

  const text =
    (
      message.text ||
      ""
    ).trim();

  if (
    text === "/start" ||
    text === "/menu"
  ) {
    await clearSession(
      env,
      user.id
    );

    return showHome(
      env,
      chatId,
      user.id
    );
  }

  const session =
    await getSession(
      env,
      user.id
    );

  if (!session) {
    return showHome(
      env,
      chatId,
      user.id
    );
  }

  const data =
    JSON.parse(
      session.data || "{}"
    );

  // ----------------------------------------------------------
  // TOKEN CA
  // ----------------------------------------------------------

  if (
    session.state ===
    "awaiting_ca"
  ) {
    const chain =
      data.chain;

    try {
      const token =
        await getTokenData(
          chain,
          text
        );

      return showToken(
        env,
        chatId,
        user.id,
        {
          ...token,
          chain,
          chainName:
            CHAINS[chain].name
        }
      );

    } catch {
      return sendMessage(
        env,
        chatId,
        `
❌ <b>Token / market not found</b>

Try the CA again.

The engine checks multiple market sources before giving up.
`.trim(),
        backKeyboard()
      );
    }
  }

  // ----------------------------------------------------------
  // CUSTOM BUY
  // ----------------------------------------------------------

  if (
    session.state ===
    "custom_buy"
  ) {
    const amount =
      Number(text);

    if (
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      return sendMessage(
        env,
        chatId,
        "❌ Enter a valid USD amount.",
        backKeyboard()
      );
    }

    await setSession(
      env,
      user.id,
      "awaiting_amount",
      {
        token: data.token,
        amount
      }
    );

    return showBuyConfirm(
      env,
      chatId,
      user.id,
      amount
    );
  }

  // ----------------------------------------------------------
  // CUSTOM BUY MORE
  // ----------------------------------------------------------

  if (
    session.state ===
    "custom_more"
  ) {
    const amount =
      Number(text);

    if (
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      return sendMessage(
        env,
        chatId,
        "❌ Enter a valid USD amount.",
        backKeyboard()
      );
    }

    await setSession(
      env,
      user.id,
      "buy_more",
      {
        positionId:
          data.positionId,
        amount
      }
    );

    return confirmBuyMore(
      env,
      chatId,
      user.id,
      amount
    );
  }

  // ----------------------------------------------------------
  // CUSTOM FUND
  // ----------------------------------------------------------

  if (
    session.state ===
    "custom_fund"
  ) {
    const amount =
      Number(text);

    if (
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      return sendMessage(
        env,
        chatId,
        "❌ Enter a valid amount.",
        backKeyboard()
      );
    }

    return addFunds(
      env,
      chatId,
      user.id,
      amount
    );
  }

  return sendMessage(
    env,
    chatId,
    "Use /start to open the paper trader.",
    mainKeyboard()
  );
}


// ============================================================
// HEALTH
// ============================================================

async function health(env) {
  let database =
    false;

  let users = 0;

  try {
    const result =
      await env.DB
        .prepare(
          "SELECT COUNT(*) AS count FROM users"
        )
        .first();

    database = true;

    users =
      Number(
        result?.count || 0
      );
  } catch {}

  return {
    ok: true,
    bot: "Degen Paper Trader",
    status: "online",
    database,
    users
  };
}


// ============================================================
// SETUP WEBHOOK
// ============================================================

async function setupWebhook(
  request,
  env
) {
  const url =
    new URL(request.url);

  const key =
    url.searchParams.get(
      "key"
    );

  if (
    !env.SETUP_KEY ||
    key !== env.SETUP_KEY
  ) {
    return new Response(
      "Unauthorized",
      {
        status: 401
      }
    );
  }

  const webhookSecret =
    env.WEBHOOK_SECRET;

  if (!webhookSecret) {
    return new Response(
      "Missing WEBHOOK_SECRET",
      {
        status: 500
      }
    );
  }

  const webhookURL =
    `${url.origin}/telegram`;

  const result =
    await telegram(
      env,
      "setWebhook",
      {
        url: webhookURL,
        secret_token:
          webhookSecret,

        allowed_updates: [
          "message",
          "callback_query"
        ],

        drop_pending_updates:
          true
      }
    );

  return Response.json({
    ok: true,
    webhook: webhookURL,
    telegram: result
  });
}


// ============================================================
// UPDATE ROUTER
// ============================================================

async function handleUpdate(update, env) {
  if (!update || typeof update !== "object") {
    console.log("TELEGRAM UPDATE: invalid update");
    return;
  }

  if (update.message) {
    return handleMessage(update, env);
  }

  if (update.callback_query) {
    return handleCallback(update, env);
  }

  console.log(
    "TELEGRAM UPDATE: unsupported type",
    Object.keys(update)
  );
}


// ============================================================
// TELEGRAM WEBHOOK
// ============================================================

async function telegramWebhook(
  request,
  env
) {
  const secret =
    request.headers.get(
      "X-Telegram-Bot-Api-Secret-Token"
    );

  if (
    !env.WEBHOOK_SECRET ||
    secret !== env.WEBHOOK_SECRET
  ) {
    console.log("WEBHOOK AUTH FAILED");
    return new Response(
      "Unauthorized",
      { status: 401 }
    );
  }

  let update;

  try {
    update = await request.json();
  } catch (error) {
    console.log("WEBHOOK JSON ERROR", String(error?.message || error));
    return new Response("Bad Request", { status: 400 });
  }

  const chatId =
    update?.message?.chat?.id ||
    update?.callback_query?.message?.chat?.id ||
    null;

  try {
    await handleUpdate(update, env);
  } catch (error) {
    const message =
      String(error?.message || error || "Unknown error");

    console.log("UPDATE ERROR", message);

    // Never leave Telegram updates completely silent. This makes a real
    // D1/API/runtime failure visible in the user's chat instead of only
    // appearing in Cloudflare logs.
    if (chatId) {
      try {
        await sendMessage(
          env,
          chatId,
          `⚠️ <b>BOT ERROR</b>\n\n<code>${esc(message).slice(0, 900)}</code>`,
          mainKeyboard()
        );
      } catch (sendError) {
        console.log("ERROR MESSAGE FAILED", String(sendError?.message || sendError));
      }
    }
  }

  return new Response("OK");
}


// ============================================================
// HTTP ROUTER
// ============================================================

export default {
  async fetch(
    request,
    env
  ) {
    const url =
      new URL(request.url);

    if (
      request.method ===
      "GET"
    ) {
      if (
        url.pathname ===
        "/"
      ) {
        return Response.json(
          await health(env)
        );
      }

      if (
        url.pathname ===
        "/setup"
      ) {
        return setupWebhook(
          request,
          env
        );
      }

      if (
        url.pathname ===
        "/market"
      ) {
        const chain =
          url.searchParams.get(
            "chain"
          );

        const ca =
          url.searchParams.get(
            "ca"
          );

        if (
          !chain ||
          !ca
        ) {
          return Response.json(
            {
              ok: false,
              error:
                "chain and ca required"
            },
            {
              status: 400
            }
          );
        }

        try {
          const market =
            await getTokenData(
              chain,
              ca
            );

          return Response.json({
            ok: true,
            market
          });
        } catch (error) {
          return Response.json(
            {
              ok: false,
              error:
                error?.message ||
                "Market unavailable"
            },
            {
              status: 404
            }
          );
        }
      }

      if (
        url.pathname ===
        "/test"
      ) {
        try {
          const result =
            await telegram(
              env,
              "sendMessage",
              {
                chat_id:
                  env.TELEGRAM_CHAT_ID,
                text:
                  "🟢 Degen Paper Trader test successful"
              }
            );

          return Response.json({
            ok: true,
            telegram: true,
            messageSent:
              result.ok
          });
        } catch (error) {
          return Response.json(
            {
              ok: false,
              telegram: false,
              error:
                error?.message ||
                String(error)
            },
            {
              status: 500
            }
          );
        }
      }

      if (
        url.pathname ===
        "/webhook-info"
      ) {
        try {
          const result =
            await telegram(
              env,
              "getWebhookInfo",
              {}
            );

          return Response.json(
            result
          );
        } catch (error) {
          return Response.json(
            {
              ok: false,
              error:
                error?.message ||
                String(error)
            },
            {
              status: 500
            }
          );
        }
      }
    }

    if (
      url.pathname ===
      "/telegram" &&
      request.method ===
      "POST"
    ) {
      return telegramWebhook(
        request,
        env
      );
    }

    return new Response(
      "Not Found",
      {
        status: 404
      }
    );
  }
};