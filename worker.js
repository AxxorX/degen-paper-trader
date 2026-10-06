// @ts-nocheck

// ============================================================
// DEGEN TERMINAL
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
// Simulated trading engine. No on-chain transactions are made.
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
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return `${n < 0 ? "-" : ""}$${abs}`;
}

function price(value) {
  return fmtPriceText(value);
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
let SCHEMA_READY = false;

async function ensurePaperTraderSchema(env) {
  if (SCHEMA_READY) return;
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

  // Take-profit, live-price hints, race-safe revision token
  additions.positions.push(
    ["tp_price", "REAL"], ["tp_sell_pct", "REAL DEFAULT 100"],
    ["tp_triggered_at", "INTEGER"], ["last_checked_at", "INTEGER"],
    ["price_source", "TEXT"], ["mcap_ratio", "REAL"], ["rev", "INTEGER DEFAULT 0"]
  );
  // Entry/exit data needed to rebuild PnL cards from history
  additions.trades.push(
    ["entry_price", "REAL"], ["entry_mcap", "REAL"], ["cost_basis", "REAL"],
    ["x_multiple", "REAL"], ["trigger_type", "TEXT"], ["logo_url", "TEXT"]
  );

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
  try {
    await env.DB.prepare(
      "CREATE INDEX IF NOT EXISTS idx_trades_user_time ON trades(user_id, created_at DESC)"
    ).run();
  } catch (e) {
    console.log("SCHEMA INDEX SKIP", String(e?.message || e));
  }

  SCHEMA_READY = true;
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
  p.baseToken?.address ||
  p.quoteToken?.address ||
  `${p.dexId || "unknown"}:${p.priceUsd || "unknown"}`;

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

  const result = {
    ...best,
    confidence: Math.min(confidence, 100),
    // Never attach the full market list to the selected market object.
    // The selected object is already an element of that list, so doing
    // best.markets = markets would create a circular JSON structure.
    markets: []
  };

  return result;
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
    .replace(/,/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/^\s*[<>~=]+\s*/, "")
    .replace(/^\s*(?:US)?\$\s*/i, "")
    .replace(/\s*(?:USD)\s*$/i, "")
    .trim()
    .toLowerCase();

  if (!raw) return null;

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
  let source = String(text || "")
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/`/g, "");

  if (!source) return null;

  const labelPatterns = {
    price: /(?:current\s+)?price/i,
    "market cap": /(?:onchain\s+)?market\s*cap(?:italization)?/i,
    "24h volume": /(?:24h\s*volume|volume\s*\(?\s*24h\s*\)?|volume\s*\(?\s*24\s*h\s*\)?)/i,
    liquidity: /liquidity/i,
    "24h trades": /(?:24h\s*trades|trades\s*\(?\s*24h\s*\)?|txns\s*\(?\s*24h\s*\)?|trades\s*\(?\s*24\s*h\s*\)?)/i
  };

  const key = String(label || "").trim().toLowerCase();
  const labelRegex = labelPatterns[key] || new RegExp(
    String(label || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    "i"
  );

  const numberPattern =
    "([<>~=]?[-]?(?:\\d+(?:,\\d{3})*(?:\\.\\d+)?|\\.\\d+)(?:[kKmMbB])?)";

  const currency = "(?:US\\$|\\$)?\\s*";

  // Markdown/table: | Price | $0.0000388 |
  let match = source.match(new RegExp(
    "(?:^|\\n|\\|)\\s*" + labelRegex.source +
    "\\s*\\|\\s*" + currency + numberPattern,
    "i"
  ));
  if (match) return parseHoodScanNumber(match[1]);

  // Label on one line, value on the next: Price\n$0.0000388
  match = source.match(new RegExp(
    "(?:^|\\n)\\s*" + labelRegex.source +
    "\\s*(?:[:|•\\-]\\s*)*(?:\\n\\s*)?" +
    currency + numberPattern,
    "i"
  ));
  if (match) return parseHoodScanNumber(match[1]);

  // Inline: Price: $0.0000388 / Market cap $38.8K
  match = source.match(new RegExp(
    labelRegex.source +
    "\\s*(?:[:|•\\-]\\s*)*" + currency + numberPattern,
    "i"
  ));
  if (match) return parseHoodScanNumber(match[1]);

  // Dynamic HoodScan pages can insert extra text between the label and value.
  // Keep the window bounded so we do not accidentally grab an unrelated number.
  match = source.match(new RegExp(
    labelRegex.source +
    "[^0-9$<>~=]{0,100}" + currency + numberPattern,
    "i"
  ));
  if (match) return parseHoodScanNumber(match[1]);

  return null;
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

async function getHoodScanMarket(chain, ca, fresh = false) {
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
    cf: fresh
      ? { cacheTtl: -1, cacheEverything: false }
      : { cacheTtl: 15, cacheEverything: true }
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
  ca,
  opts = {}
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
        normalizedCA,
        !!opts.fresh
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


// ============================================================
// EXECUTE BUY
// ============================================================


// ============================================================
// POSITIONS
// ============================================================


// ============================================================
// POSITION DETAIL
// ============================================================


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
      await getTokenData(p.chain, p.ca, { fresh: true });
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
      await getTokenData(p.chain, p.ca, { fresh: true });
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


// ============================================================
// EXECUTE SELL
// ============================================================


// ============================================================
// WALLET
// ============================================================


// ============================================================
// PAPER FUNDS
// ============================================================



// ============================================================
// HISTORY
// ============================================================


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

  if (
    await handleExtraCallbacks(
      env,
      chatId,
      user,
      data,
      query.message?.message_id
    )
  ) {
    return;
  }

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

  if (
    await handleExtraMessage(
      env,
      chatId,
      user,
      session,
      data,
      text
    )
  ) {
    return;
  }

  return sendMessage(
    env,
    chatId,
    "Use /start to open Degen Terminal.",
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
    bot: "Degen Terminal",
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

const BASE_HANDLER = {
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
                  "🟢 Degen Terminal test successful"
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

// ============================================================
// X TIER SYSTEM
// ============================================================
// One entry per performance tier (ascending minX).
// To add / retune a tier: edit one object. Nothing else changes.
// mascotKey -> built-in SVG pose, or MASCOT_BASE_URL/<mascotKey>.png
// when real artwork is provided.
// ============================================================

const TIERS = [
  {
    key: "rekt", minX: 0, loss: true, title: "REKT",
    mascotKey: "rekt", pattern: "glitch",
    p: {
      bg1: "#0c0407", bg2: "#2e0612", accent: "#ff3b5c", accent2: "#ff9aa9",
      num: "#ff4d6a", ink: "#ffffff", muted: "rgba(255,255,255,.58)",
      panel: "rgba(255,255,255,.06)", line: "rgba(255,59,92,.32)",
      glow: "rgba(255,59,92,.42)", pillInk: "#14040a"
    }
  },
  {
    key: "devastated", minX: 0.25, loss: true, title: "DEVASTATED",
    mascotKey: "devastated", pattern: "rain",
    p: {
      bg1: "#050b1a", bg2: "#12305c", accent: "#5aa9ff", accent2: "#a8d2ff",
      num: "#ff6b7d", ink: "#ffffff", muted: "rgba(255,255,255,.60)",
      panel: "rgba(255,255,255,.07)", line: "rgba(120,180,255,.30)",
      glow: "rgba(90,169,255,.38)", pillInk: "#04112a"
    }
  },
  {
    key: "down_bad", minX: 0.5, loss: true, title: "DOWN BAD",
    mascotKey: "down_bad", pattern: "fog",
    p: {
      bg1: "#0b0f15", bg2: "#222b38", accent: "#8fa2bf", accent2: "#c5d0e2",
      num: "#ff7f8a", ink: "#ffffff", muted: "rgba(255,255,255,.58)",
      panel: "rgba(255,255,255,.06)", line: "rgba(160,180,210,.28)",
      glow: "rgba(143,162,191,.30)", pillInk: "#0b1018"
    }
  },
  {
    key: "small_l", minX: 0.75, loss: true, title: "SMALL L",
    mascotKey: "small_l", pattern: "stripes",
    p: {
      bg1: "#101113", bg2: "#23252a", accent: "#b7bcc7", accent2: "#e3e6ec",
      num: "#ff9494", ink: "#ffffff", muted: "rgba(255,255,255,.56)",
      panel: "rgba(255,255,255,.06)", line: "rgba(200,205,215,.24)",
      glow: "rgba(183,188,199,.22)", pillInk: "#101113"
    }
  },
  {
    key: "green", minX: 1, loss: false, title: "GREEN",
    mascotKey: "green", pattern: "grid",
    p: {
      bg1: "#06100c", bg2: "#0d2d20", accent: "#34d399", accent2: "#a7f3d0",
      num: "#4ade9f", ink: "#ffffff", muted: "rgba(255,255,255,.60)",
      panel: "rgba(255,255,255,.06)", line: "rgba(52,211,153,.30)",
      glow: "rgba(52,211,153,.34)", pillInk: "#03150d"
    }
  },
  {
    key: "confident", minX: 2, loss: false, title: "CONFIDENT",
    mascotKey: "confident", pattern: "spotlight",
    p: {
      bg1: "#031317", bg2: "#0a3d44", accent: "#2dd4bf", accent2: "#99f6e4",
      num: "#5eead4", ink: "#ffffff", muted: "rgba(255,255,255,.62)",
      panel: "rgba(255,255,255,.07)", line: "rgba(45,212,191,.32)",
      glow: "rgba(45,212,191,.36)", pillInk: "#021618"
    }
  },
  {
    key: "celebrating", minX: 5, loss: false, title: "CELEBRATING",
    mascotKey: "celebrating", pattern: "confetti",
    p: {
      bg1: "#05130a", bg2: "#0d4a22", accent: "#4ade80", accent2: "#fde047",
      num: "#86efac", ink: "#ffffff", muted: "rgba(255,255,255,.64)",
      panel: "rgba(255,255,255,.08)", line: "rgba(250,204,21,.34)",
      glow: "rgba(74,222,128,.40)", pillInk: "#04170a"
    }
  },
  {
    key: "jumping", minX: 10, loss: false, title: "JUMPING",
    mascotKey: "jumping", pattern: "burst",
    p: {
      bg1: "#030d24", bg2: "#0c3a85", accent: "#38bdf8", accent2: "#c4b5fd",
      num: "#7dd3fc", ink: "#ffffff", muted: "rgba(255,255,255,.66)",
      panel: "rgba(255,255,255,.08)", line: "rgba(125,211,252,.36)",
      glow: "rgba(56,189,248,.44)", pillInk: "#031024"
    }
  },
  {
    key: "degen", minX: 20, loss: false, title: "DEGEN MODE",
    mascotKey: "degen", pattern: "flames",
    p: {
      bg1: "#15032a", bg2: "#52105f", accent: "#fb923c", accent2: "#f9a8d4",
      num: "#fdba74", ink: "#ffffff", muted: "rgba(255,255,255,.66)",
      panel: "rgba(255,255,255,.08)", line: "rgba(251,146,60,.40)",
      glow: "rgba(251,146,60,.46)", pillInk: "#1d0638"
    }
  },
  {
    key: "insane", minX: 50, loss: false, title: "INSANE",
    mascotKey: "insane", pattern: "lightning",
    p: {
      bg1: "#17001d", bg2: "#62074f", accent: "#ff2fd0", accent2: "#22d3ee",
      num: "#ff7ae6", ink: "#ffffff", muted: "rgba(255,255,255,.68)",
      panel: "rgba(255,255,255,.09)", line: "rgba(34,211,238,.42)",
      glow: "rgba(255,47,208,.50)", pillInk: "#14001a"
    }
  },
  {
    key: "legendary", minX: 100, loss: false, title: "LEGENDARY",
    mascotKey: "legendary", pattern: "rays",
    p: {
      bg1: "#080600", bg2: "#2e1f00", accent: "#fbbf24", accent2: "#fde68a",
      num: "#fcd34d", ink: "#fff8e1", muted: "rgba(255,248,225,.64)",
      panel: "rgba(255,230,150,.08)", line: "rgba(251,191,36,.46)",
      glow: "rgba(251,191,36,.50)", pillInk: "#150e00"
    }
  },
  {
    key: "god", minX: 500, loss: false, title: "GOD TIER",
    mascotKey: "god", pattern: "holy", light: true,
    p: {
      bg1: "#fffaf0", bg2: "#f5d982", accent: "#c98a0b", accent2: "#f6c453",
      num: "#a8690a", ink: "#2b1d00", muted: "rgba(43,29,0,.62)",
      panel: "rgba(255,255,255,.55)", line: "rgba(183,121,31,.40)",
      glow: "rgba(255,214,102,.75)", pillInk: "#fffaf0"
    }
  }
];

function tierFor(x) {
  let v = Number(x);
  if (!Number.isFinite(v) || v < 0) v = 0;
  let tier = TIERS[0];
  for (const t of TIERS) {
    if (v >= t.minX) tier = t;
  }
  return tier;
}

// ============================================================
// CARD FORMATTERS
// ============================================================

function fmtX(x) {
  const v = Number(x);
  if (!Number.isFinite(v) || v < 0) return "0.00x";
  if (v >= 1000) return `${Math.round(v).toLocaleString("en-US")}x`;
  if (v >= 100) return `${v.toFixed(0)}x`;
  if (v >= 10) return `${v.toFixed(1)}x`;
  return `${v.toFixed(2)}x`;
}

function smoney(value) {
  const n = Number(value || 0);
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return `${n < 0 ? "-" : "+"}$${abs}`;
}

function spercent(value) {
  const n = Number(value || 0);
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return `${n < 0 ? "-" : "+"}${abs}%`;
}

const SUBDIGITS = ["₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉"];

// Text version (Telegram messages): $0.0₅1234
function fmtPriceText(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "N/A";
  if (n >= 1) {
    return `$${n.toLocaleString("en-US", { maximumFractionDigits: 4 })}`;
  }
  if (n >= 0.0001) {
    return `$${n.toPrecision(4).replace(/0+$/, "").replace(/\.$/, "")}`;
  }
  const exp = Math.floor(Math.log10(n));
  const zeros = -exp - 1;
  let digits = Math.round((n / Math.pow(10, exp)) * 1000);
  if (digits >= 10000) digits = 1000;
  const sig = String(digits).replace(/0+$/, "") || "0";
  const sub = String(zeros).split("").map(d => SUBDIGITS[Number(d)]).join("");
  return `$0.0${sub}${sig}`;
}

// HTML version (cards): $0.0<sub>5</sub>1234
function fmtPriceHTML(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 0.0001) return esc(fmtPriceText(n));
  const exp = Math.floor(Math.log10(n));
  const zeros = -exp - 1;
  let digits = Math.round((n / Math.pow(10, exp)) * 1000);
  if (digits >= 10000) digits = 1000;
  const sig = String(digits).replace(/0+$/, "") || "0";
  return `$0.0<sub>${zeros}</sub>${sig}`;
}

function fmtMcapCard(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtUsdCard(value) {
  const n = Number(value || 0);
  return `$${Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function fmtCardDate(ts) {
  try {
    return new Date(Number(ts) || Date.now()).toLocaleString("en-US", {
      month: "short", day: "numeric", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC"
    }) + " UTC";
  } catch {
    return "";
  }
}

// ============================================================
// MASCOT ASSETS (built-in SVG placeholders, one pose per mascotKey)
// Replace later by hosting <mascotKey>.png at MASCOT_BASE_URL.
// ============================================================

function mascotSVG(key) {
  const FUR = "#6b4f3f";
  const FURD = "#523b2e";
  const SKIN = "#f3d5b5";
  const INK = "#1b1411";

  const star = (cx, cy, R, r, fill) => {
    let pts = "";
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 === 0 ? R : r;
      const a = (Math.PI / 5) * i - Math.PI / 2;
      pts += `${(cx + rad * Math.cos(a)).toFixed(1)},${(cy + rad * Math.sin(a)).toFixed(1)} `;
    }
    return `<polygon points="${pts.trim()}" fill="${fill}"/>`;
  };

  const sparkle = (cx, cy, s, fill) =>
    `<path d="M${cx} ${cy - s} Q${cx} ${cy} ${cx + s} ${cy} Q${cx} ${cy} ${cx} ${cy + s} Q${cx} ${cy} ${cx - s} ${cy} Q${cx} ${cy} ${cx} ${cy - s} Z" fill="${fill}"/>`;

  const defs = `
    <defs>
      <linearGradient id="m_gold" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#fff2a8"/>
        <stop offset=".5" stop-color="#f6c33b"/>
        <stop offset="1" stop-color="#c98a0b"/>
      </linearGradient>
      <linearGradient id="m_goldfur" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#f9d66b"/>
        <stop offset="1" stop-color="#d49a1a"/>
      </linearGradient>
      <linearGradient id="m_flame" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0" stop-color="#ff3d00" stop-opacity=".95"/>
        <stop offset=".6" stop-color="#ff9100" stop-opacity=".85"/>
        <stop offset="1" stop-color="#ffd54f" stop-opacity="0"/>
      </linearGradient>
      <filter id="m_glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="7" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>`;

  const body = (fur, skin) => `
    <path d="M64 580 C54 452 108 374 210 368 C312 374 366 452 356 580 Z" fill="${fur}"/>
    <ellipse cx="210" cy="486" rx="80" ry="102" fill="${skin}"/>`;

  const head = (fur, skin) => `
    <circle cx="88" cy="248" r="36" fill="${fur}"/><circle cx="88" cy="248" r="20" fill="${skin}"/>
    <circle cx="332" cy="248" r="36" fill="${fur}"/><circle cx="332" cy="248" r="20" fill="${skin}"/>
    <ellipse cx="210" cy="236" rx="122" ry="114" fill="${fur}"/>
    <path d="M210 172 C168 150 104 186 108 252 C112 322 166 352 210 352 C254 352 308 322 312 252 C316 186 252 150 210 172 Z" fill="${skin}"/>
    <ellipse cx="197" cy="291" rx="5" ry="7" fill="${INK}" opacity=".7"/>
    <ellipse cx="223" cy="291" rx="5" ry="7" fill="${INK}" opacity=".7"/>`;

  const arm = (d, fur) =>
    `<path d="${d}" stroke="${fur}" stroke-width="52" stroke-linecap="round" fill="none"/>`;
  const hand = (cx, cy, r, fur) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fur}"/>`;

  const A = {
    down: fur =>
      arm("M112 410 C76 456 70 514 82 566", fur) + arm("M308 410 C344 456 350 514 338 566", fur),
    up: fur =>
      arm("M112 404 C52 354 38 272 58 198", fur) + hand(58, 190, 33, fur) +
      arm("M308 404 C368 354 382 272 362 198", fur) + hand(362, 190, 33, fur),
    face: fur =>
      arm("M112 414 C58 384 92 302 158 254", fur) + hand(160, 246, 44, fur) +
      arm("M308 414 C362 384 328 302 262 254", fur) + hand(260, 246, 44, fur),
    crossed: fur =>
      arm("M118 414 C160 470 252 470 302 424", fur) + arm("M302 414 C260 470 168 470 118 424", fur) +
      hand(304, 420, 30, fur) + hand(116, 420, 30, fur),
    flex: fur =>
      arm("M112 408 C42 414 30 340 70 300", fur) + hand(72, 292, 36, fur) +
      arm("M308 408 C378 414 390 340 350 300", fur) + hand(348, 292, 36, fur),
    head: fur =>
      arm("M112 406 C38 362 38 292 84 254", fur) + hand(86, 250, 36, fur) +
      arm("M308 406 C382 362 382 292 336 254", fur) + hand(334, 250, 36, fur),
    wide: fur =>
      arm("M112 404 C58 392 24 342 8 292", fur) + hand(6, 286, 33, fur) +
      arm("M308 404 C362 392 396 342 412 292", fur) + hand(414, 286, 33, fur)
  };

  const eye = (cx, kind, side, cy = 240) => {
    switch (kind) {
      case "dot":
        return `<circle cx="${cx}" cy="${cy}" r="11" fill="${INK}"/><circle cx="${cx + 4}" cy="${cy - 4}" r="3.4" fill="#fff"/>`;
      case "flat":
        return `<path d="M${cx - 15} ${cy} H${cx + 15}" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>`;
      case "sad": {
        const o = cx + side * 20, i = cx - side * 16;
        return `<circle cx="${cx}" cy="${cy + 2}" r="11" fill="${INK}"/><circle cx="${cx + 4}" cy="${cy - 2}" r="3.4" fill="#fff"/>
                <path d="M${o} ${cy - 12} L${i} ${cy - 30}" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>`;
      }
      case "happy":
        return `<path d="M${cx - 17} ${cy + 8} Q${cx} ${cy - 18} ${cx + 17} ${cy + 8}" stroke="${INK}" stroke-width="8" stroke-linecap="round" fill="none"/>`;
      case "x":
        return `<path d="M${cx - 14} ${cy - 14} L${cx + 14} ${cy + 14} M${cx + 14} ${cy - 14} L${cx - 14} ${cy + 14}" stroke="${INK}" stroke-width="8" stroke-linecap="round"/>`;
      case "dollar":
        return `<circle cx="${cx}" cy="${cy}" r="21" fill="url(#m_gold)" stroke="#8a5a00" stroke-width="3"/>
                <text x="${cx}" y="${cy + 9}" text-anchor="middle" font-family="Arial,sans-serif" font-weight="900" font-size="28" fill="#6b4300">$</text>`;
      case "spiral":
        return `<circle cx="${cx}" cy="${cy}" r="21" fill="#fff" stroke="${INK}" stroke-width="3"/>
                <circle cx="${cx}" cy="${cy}" r="13" fill="none" stroke="${INK}" stroke-width="3.5"/>
                <circle cx="${cx}" cy="${cy}" r="6" fill="none" stroke="${INK}" stroke-width="3.5"/>
                <circle cx="${cx}" cy="${cy}" r="2.2" fill="${INK}"/>`;
      case "glow":
        return `<circle cx="${cx}" cy="${cy}" r="15" fill="#fff" filter="url(#m_glow)"/>`;
      default:
        return "";
    }
  };

  const shades = (lens, shine) => `
    <rect x="116" y="214" width="94" height="50" rx="18" fill="${lens}"/>
    <rect x="210" y="214" width="94" height="50" rx="18" fill="${lens}"/>
    <rect x="200" y="226" width="20" height="10" fill="${lens}"/>
    <path d="M128 226 L156 226" stroke="${shine}" stroke-opacity=".45" stroke-width="6" stroke-linecap="round"/>
    <path d="M222 226 L250 226" stroke="${shine}" stroke-opacity=".45" stroke-width="6" stroke-linecap="round"/>`;

  const M = {
    flat: `<path d="M190 326 H230" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>`,
    frown: `<path d="M184 334 Q210 306 236 334" stroke="${INK}" stroke-width="7" stroke-linecap="round" fill="none"/>`,
    smile: `<path d="M182 312 Q210 344 238 312" stroke="${INK}" stroke-width="7" stroke-linecap="round" fill="none"/>`,
    smirk: `<path d="M186 322 Q216 336 240 312" stroke="${INK}" stroke-width="7" stroke-linecap="round" fill="none"/>`,
    grin: `<path d="M170 308 Q210 366 250 308 Z" fill="${INK}"/><path d="M176 310 Q210 322 244 310 L242 318 Q210 330 178 318 Z" fill="#fff"/>`,
    goldgrin: `<path d="M170 308 Q210 366 250 308 Z" fill="${INK}"/><path d="M176 310 Q210 322 244 310 L242 318 Q210 330 178 318 Z" fill="#fff"/><rect x="204" y="311" width="14" height="10" rx="3" fill="url(#m_gold)"/>`,
    wail: `<ellipse cx="210" cy="330" rx="26" ry="28" fill="${INK}"/><ellipse cx="210" cy="346" rx="16" ry="10" fill="#e5707e"/>`,
    laugh: `<path d="M164 304 Q210 380 256 304 Z" fill="${INK}"/><path d="M174 307 Q210 321 246 307 L244 316 Q210 330 176 316 Z" fill="#fff"/><ellipse cx="210" cy="346" rx="22" ry="12" fill="#e5707e"/>`,
    tongue: `<path d="M176 318 Q210 340 244 318" stroke="${INK}" stroke-width="7" stroke-linecap="round" fill="none"/><path d="M200 328 Q210 366 224 328 Z" fill="#e5707e" stroke="${INK}" stroke-width="3"/>`
  };

  const tears = `
    <path d="M148 286 q-12 38 -6 74" stroke="#7cc8ff" stroke-width="10" stroke-linecap="round" fill="none" opacity=".9"/>
    <path d="M272 286 q12 38 6 74" stroke="#7cc8ff" stroke-width="10" stroke-linecap="round" fill="none" opacity=".9"/>
    <circle cx="140" cy="378" r="9" fill="#7cc8ff"/><circle cx="280" cy="378" r="9" fill="#7cc8ff"/>`;

  const confetti = (() => {
    const cols = ["#fbbf24", "#f472b6", "#22d3ee", "#4ade80", "#fff", "#fb7185"];
    const items = [
      [36, 70, 0], [96, 30, 1], [160, 90, 2], [250, 40, 3], [330, 84, 4], [388, 40, 5],
      [60, 150, 3], [372, 150, 0], [20, 230, 1], [398, 236, 2], [200, 20, 5], [300, 130, 1],
      [120, 130, 4], [350, 210, 3], [48, 300, 5], [380, 310, 2]
    ];
    return items.map(([x, y, c], i) =>
      i % 2 === 0
        ? `<rect x="${x}" y="${y}" width="14" height="22" rx="3" fill="${cols[c]}" transform="rotate(${(i * 37) % 90 - 40} ${x} ${y})"/>`
        : `<circle cx="${x}" cy="${y}" r="8" fill="${cols[c]}"/>`
    ).join("");
  })();

  const flameBlob = (x, w, h) =>
    `<path d="M${x} 580 C${x - w} 500 ${x - w / 2} 440 ${x} ${580 - h} C${x + w / 3} ${580 - h + 60} ${x + w} 500 ${x + w * 0.8} 580 Z" fill="url(#m_flame)"/>`;

  let inner = "";
  switch (key) {
    case "small_l":
      inner = body(FUR, SKIN) + A.down(FUR) + head(FUR, SKIN) +
        eye(165, "flat", -1) + eye(255, "flat", 1) + M.flat +
        `<path d="M340 150 q16 26 0 40 q-16 -14 0 -40 Z" fill="#7cc8ff"/>`;
      break;

    case "down_bad":
      inner =
        `<g opacity=".95"><ellipse cx="170" cy="60" rx="58" ry="30" fill="#6f7c90"/><ellipse cx="226" cy="48" rx="52" ry="34" fill="#7b889c"/><ellipse cx="270" cy="66" rx="48" ry="26" fill="#6f7c90"/>
         <path d="M170 100 l-6 26 M214 98 l-6 26 M258 100 l-6 26 M296 94 l-6 26" stroke="#7cc8ff" stroke-width="5" stroke-linecap="round"/></g>` +
        `<g transform="translate(0,10)">` + body(FUR, SKIN) + A.down(FUR) + head(FUR, SKIN) +
        eye(165, "sad", -1) + eye(255, "sad", 1) + M.frown + `</g>`;
      break;

    case "devastated":
      inner =
        `<ellipse cx="210" cy="572" rx="150" ry="16" fill="#5aa9ff" opacity=".28"/>` +
        `<g transform="translate(0,16)">` + body(FUR, SKIN) + head(FUR, SKIN) + M.wail + tears +
        A.face(FUR) + `</g>`;
      break;

    case "rekt":
      inner =
        `<g transform="translate(0,8)">` + body(FUR, SKIN) + head(FUR, SKIN) +
        eye(165, "x", -1) + eye(255, "x", 1) + M.tongue + A.head(FUR) + `</g>` +
        `<g transform="rotate(-10 330 500)">
           <rect x="246" y="446" width="156" height="104" rx="10" fill="#1e2127" stroke="#4a4f59" stroke-width="5"/>
           <rect x="256" y="456" width="136" height="84" rx="4" fill="#2a0b10"/>
           <polyline points="262,470 290,486 312,478 340,510 366,520 386,534" fill="none" stroke="#ff3b5c" stroke-width="5" stroke-linejoin="round"/>
           <polyline points="330,456 322,478 340,494 326,516 336,540" fill="none" stroke="#ffffff" stroke-width="3" opacity=".85"/>
           <path d="M236 552 H412 L424 568 H224 Z" fill="#3a3f48"/>
         </g>
         <path d="M300 430 q-6 -30 10 -46 q-4 30 18 40" stroke="#9aa0ac" stroke-width="6" fill="none" stroke-linecap="round" opacity=".7"/>
         <rect x="30" y="170" width="120" height="8" fill="#ff3b5c" opacity=".35"/><rect x="270" y="300" width="130" height="6" fill="#ff3b5c" opacity=".3"/>`;
      break;

    case "green":
      inner = body(FUR, SKIN) + A.down(FUR) + head(FUR, SKIN) +
        eye(165, "dot", -1) + eye(255, "dot", 1) + M.smile +
        `<circle cx="350" cy="96" r="38" fill="#34d399"/><path d="M350 118 V76 M332 94 L350 74 L368 94" stroke="#04281a" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
      break;

    case "confident":
      inner = body(FUR, SKIN) + head(FUR, SKIN) + shades("#101418", "#fff") + M.smirk + A.crossed(FUR);
      break;

    case "celebrating":
      inner = confetti + body(FUR, SKIN) + A.up(FUR) + head(FUR, SKIN) +
        eye(165, "happy", -1) + eye(255, "happy", 1) + M.grin;
      break;

    case "jumping":
      inner =
        `<ellipse cx="210" cy="560" rx="96" ry="13" fill="#000" opacity=".35"/>
         <path d="M120 548 v-18 M210 556 v-22 M300 548 v-18" stroke="#fff" stroke-opacity=".5" stroke-width="6" stroke-linecap="round"/>` +
        `<g transform="translate(0,-34)">` +
        `<ellipse cx="156" cy="572" rx="40" ry="24" fill="${FURD}"/><ellipse cx="264" cy="572" rx="40" ry="24" fill="${FURD}"/>` +
        body(FUR, SKIN) + A.up(FUR) + head(FUR, SKIN) +
        eye(165, "happy", -1) + eye(255, "happy", 1) + M.grin + `</g>` +
        sparkle(40, 120, 16, "#fff") + sparkle(384, 100, 20, "#fff") + sparkle(390, 300, 12, "#c4b5fd");
      break;

    case "degen":
      inner =
        flameBlob(70, 110, 190) + flameBlob(350, 120, 220) +
        body(FUR, SKIN) + A.flex(FUR) + head(FUR, SKIN) +
        eye(165, "dollar", -1) + eye(255, "dollar", 1) + M.goldgrin +
        `<path d="M122 392 Q210 480 298 392" stroke="url(#m_gold)" stroke-width="11" fill="none" stroke-linecap="round"/>
         <circle cx="210" cy="450" r="26" fill="url(#m_gold)" stroke="#8a5a00" stroke-width="3"/>
         <text x="210" y="461" text-anchor="middle" font-family="Arial,sans-serif" font-weight="900" font-size="32" fill="#6b4300">$</text>`;
      break;

    case "insane":
      inner =
        `<path d="M36 110 L70 40 L84 100 L124 20 L132 96 Z" fill="#facc15" filter="url(#m_glow)"/>
         <path d="M396 130 L360 52 L346 112 L306 36 L296 110 Z" fill="#22d3ee" filter="url(#m_glow)"/>
         <text x="18" y="300" font-family="Arial,sans-serif" font-weight="900" font-size="46" fill="#4ade80">$</text>
         <text x="372" y="330" font-family="Arial,sans-serif" font-weight="900" font-size="52" fill="#4ade80">$</text>` +
        body(FUR, SKIN) + A.up(FUR) +
        `<path d="M110 150 L132 80 L156 138 L186 62 L206 134 L238 58 L252 136 L288 76 L300 150 Z" fill="${FUR}"/>` +
        head(FUR, SKIN) + eye(165, "spiral", -1) + eye(255, "spiral", 1) + M.laugh +
        sparkle(60, 230, 16, "#fff") + sparkle(366, 250, 18, "#f9a8d4") + star(210, 28, 16, 7, "#fde047");
      break;

    case "legendary": {
      let rays = "";
      for (let i = 0; i < 18; i++) {
        const a = (Math.PI * 2 / 18) * i;
        const x1 = 210 + 120 * Math.cos(a), y1 = 250 + 120 * Math.sin(a);
        const x2 = 210 + 420 * Math.cos(a), y2 = 250 + 420 * Math.sin(a);
        rays += `<path d="M${x1.toFixed(0)} ${y1.toFixed(0)} L${x2.toFixed(0)} ${y2.toFixed(0)}" stroke="#fbbf24" stroke-opacity=".22" stroke-width="10"/>`;
      }
      inner = rays + body(FUR, SKIN) + head(FUR, SKIN) + shades("#d98a00", "#fff7c2") +
        `<path d="M163 239 L24 196" stroke="#ff3b3b" stroke-width="9" stroke-linecap="round" filter="url(#m_glow)" opacity=".9"/>
         <path d="M257 239 L396 196" stroke="#ff3b3b" stroke-width="9" stroke-linecap="round" filter="url(#m_glow)" opacity=".9"/>` +
        M.goldgrin + A.crossed(FUR) +
        `<path d="M130 138 L146 62 L180 108 L210 44 L240 108 L274 62 L290 138 Z" fill="url(#m_gold)" stroke="#8a5a00" stroke-width="4" stroke-linejoin="round"/>
         <circle cx="210" cy="96" r="9" fill="#ef4444"/><circle cx="160" cy="112" r="6" fill="#38bdf8"/><circle cx="260" cy="112" r="6" fill="#38bdf8"/>` +
        sparkle(50, 90, 18, "#fff7c2") + sparkle(34, 380, 16, "#fff7c2");
      break;
    }

    case "god": {
      let rays = "";
      for (let i = 0; i < 24; i++) {
        const a = (Math.PI * 2 / 24) * i;
        rays += `<path d="M${(210 + 90 * Math.cos(a)).toFixed(0)} ${(250 + 90 * Math.sin(a)).toFixed(0)} L${(210 + 440 * Math.cos(a)).toFixed(0)} ${(250 + 440 * Math.sin(a)).toFixed(0)}" stroke="#fff" stroke-opacity=".5" stroke-width="9"/>`;
      }
      const wingPath = `<path d="M112 360 C20 350 -26 262 -6 150 C26 190 52 196 84 196 C40 214 42 252 98 274 C58 290 70 322 118 332 Z" fill="#fff" stroke="#e8c15a" stroke-width="4"/>
           <path d="M84 196 C60 150 70 112 98 86 C98 130 118 160 140 190 Z" fill="#fff6d8" stroke="#e8c15a" stroke-width="3"/>`;
      const wingL = `<g>${wingPath}</g>`;
      const wingR = `<g transform="translate(420,0) scale(-1,1)">${wingPath}</g>`;
      inner = rays + wingL + wingR +
        body("url(#m_goldfur)", "#fff1cf") + A.wide("url(#m_goldfur)") + head("url(#m_goldfur)", "#fff1cf") +
        eye(165, "glow", -1) + eye(255, "glow", 1) + M.smile +
        `<ellipse cx="210" cy="84" rx="86" ry="22" fill="none" stroke="url(#m_gold)" stroke-width="12" filter="url(#m_glow)"/>` +
        sparkle(36, 60, 20, "#fff") + sparkle(388, 70, 22, "#fff") + sparkle(60, 400, 14, "#fff") + sparkle(372, 420, 16, "#fff");
      break;
    }

    default:
      inner = body(FUR, SKIN) + A.down(FUR) + head(FUR, SKIN) +
        eye(165, "dot", -1) + eye(255, "dot", 1) + M.smile;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 560" preserveAspectRatio="xMidYMax meet" style="overflow:visible">${defs}${inner}</svg>`;
}

// ============================================================
// BACKGROUND PATTERNS (one distinct treatment per tier)
// ============================================================

function seeded(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function patternSVG(tier) {
  const p = tier.p;
  const r = seeded(tier.key.length * 977 + tier.minX * 13 + 7);
  const W = 1080, H = 1350;
  let body = "";

  switch (tier.pattern) {
    case "glitch": {
      for (let i = 0; i < 16; i++) {
        body += `<rect x="${(r() * 900).toFixed(0)}" y="${(r() * 1250).toFixed(0)}" width="${(80 + r() * 260).toFixed(0)}" height="${(5 + r() * 14).toFixed(0)}" fill="${p.accent}" opacity="${(0.08 + r() * 0.16).toFixed(2)}"/>`;
      }
      body += `<polyline points="1040,0 980,160 1010,260 940,420 972,520" fill="none" stroke="${p.accent}" stroke-opacity=".35" stroke-width="3"/>`;
      body += `<polyline points="0,980 90,940 140,1010 230,960" fill="none" stroke="${p.accent}" stroke-opacity=".3" stroke-width="3"/>`;
      body += `<rect width="${W}" height="${H}" fill="url(#scan)"/>`;
      break;
    }
    case "rain": {
      for (let i = 0; i < 110; i++) {
        const x = r() * 1200, y = r() * 1350, l = 60 + r() * 90;
        body += `<line x1="${x.toFixed(0)}" y1="${y.toFixed(0)}" x2="${(x - l * 0.28).toFixed(0)}" y2="${(y + l).toFixed(0)}" stroke="${p.accent2}" stroke-opacity="${(0.08 + r() * 0.16).toFixed(2)}" stroke-width="2"/>`;
      }
      break;
    }
    case "fog": {
      for (let i = 0; i < 6; i++) {
        body += `<ellipse cx="${(r() * 1080).toFixed(0)}" cy="${(200 + r() * 1000).toFixed(0)}" rx="${(260 + r() * 220).toFixed(0)}" ry="${(70 + r() * 70).toFixed(0)}" fill="#fff" opacity=".05" filter="url(#blur)"/>`;
      }
      break;
    }
    case "stripes":
      body += `<rect width="${W}" height="${H}" fill="url(#diag)"/>`;
      break;
    case "grid": {
      for (let x = 0; x <= W; x += 60) body += `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="${p.accent}" stroke-opacity=".06"/>`;
      for (let y = 0; y <= H; y += 60) body += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${p.accent}" stroke-opacity=".06"/>`;
      body += `<polyline points="0,1000 140,960 260,990 400,880 540,920 700,760 860,800 1080,620" fill="none" stroke="${p.accent}" stroke-opacity=".18" stroke-width="4"/>`;
      break;
    }
    case "spotlight":
      body += `<polygon points="150,0 560,0 760,1350 -60,1350" fill="url(#cone)"/>`;
      body += `<ellipse cx="270" cy="1010" rx="300" ry="46" fill="${p.accent}" opacity=".14"/>`;
      break;
    case "confetti": {
      const cols = [p.accent, p.accent2, "#ffffff", "#f472b6", "#22d3ee"];
      for (let i = 0; i < 80; i++) {
        const x = r() * W, y = r() * 1000, c = cols[Math.floor(r() * cols.length)];
        if (i % 3 === 0) body += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${(4 + r() * 6).toFixed(0)}" fill="${c}" opacity=".75"/>`;
        else body += `<rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="${(8 + r() * 8).toFixed(0)}" height="${(16 + r() * 14).toFixed(0)}" rx="2" fill="${c}" opacity=".75" transform="rotate(${(r() * 180).toFixed(0)} ${x.toFixed(0)} ${y.toFixed(0)})"/>`;
      }
      break;
    }
    case "burst": {
      for (let i = 0; i < 28; i += 1) {
        const a1 = (Math.PI * 2 / 28) * i, a2 = a1 + Math.PI / 28;
        const cx = 270, cy = 700, R = 1600;
        body += `<polygon points="${cx},${cy} ${(cx + R * Math.cos(a1)).toFixed(0)},${(cy + R * Math.sin(a1)).toFixed(0)} ${(cx + R * Math.cos(a2)).toFixed(0)},${(cy + R * Math.sin(a2)).toFixed(0)}" fill="${i % 2 ? p.accent : p.accent2}" opacity=".07"/>`;
      }
      break;
    }
    case "flames": {
      for (let i = 0; i < 7; i++) {
        const x = 40 + i * 170 + r() * 60, h = 260 + r() * 260;
        body += `<path d="M${x - 90} 1350 C${x - 80} ${1350 - h * 0.6} ${x - 20} ${1350 - h * 0.7} ${x} ${1350 - h} C${x + 30} ${1350 - h * 0.6} ${x + 90} ${1350 - h * 0.4} ${x + 100} 1350 Z" fill="url(#flame)" opacity=".55"/>`;
      }
      for (let i = 0; i < 40; i++) body += `<circle cx="${(r() * W).toFixed(0)}" cy="${(700 + r() * 600).toFixed(0)}" r="${(2 + r() * 4).toFixed(0)}" fill="#ffd54f" opacity="${(0.3 + r() * 0.5).toFixed(2)}"/>`;
      break;
    }
    case "lightning": {
      body += `<polygon points="900,0 780,330 870,330 720,700 960,260 860,260 990,0" fill="${p.accent2}" opacity=".16"/>`;
      body += `<polygon points="70,380 20,640 90,640 30,900 170,560 100,560 150,380" fill="${p.accent}" opacity=".16"/>`;
      body += `<polygon points="-100,1100 500,860 520,900 -100,1180" fill="${p.accent2}" opacity=".10"/>`;
      for (let i = 0; i < 38; i++) {
        const x = r() * W, y = r() * 1350, s = 5 + r() * 10;
        body += `<path d="M${x.toFixed(0)} ${(y - s).toFixed(0)} L${(x + s * 0.3).toFixed(0)} ${(y - s * 0.3).toFixed(0)} L${(x + s).toFixed(0)} ${y.toFixed(0)} L${(x + s * 0.3).toFixed(0)} ${(y + s * 0.3).toFixed(0)} L${x.toFixed(0)} ${(y + s).toFixed(0)} L${(x - s * 0.3).toFixed(0)} ${(y + s * 0.3).toFixed(0)} L${(x - s).toFixed(0)} ${y.toFixed(0)} L${(x - s * 0.3).toFixed(0)} ${(y - s * 0.3).toFixed(0)} Z" fill="#fff" opacity="${(0.25 + r() * 0.5).toFixed(2)}"/>`;
      }
      break;
    }
    case "rays": {
      for (let i = 0; i < 36; i++) {
        const a1 = (Math.PI * 2 / 36) * i, a2 = a1 + Math.PI / 54;
        const cx = 270, cy = 700, R = 1700;
        body += `<polygon points="${cx},${cy} ${(cx + R * Math.cos(a1)).toFixed(0)},${(cy + R * Math.sin(a1)).toFixed(0)} ${(cx + R * Math.cos(a2)).toFixed(0)},${(cy + R * Math.sin(a2)).toFixed(0)}" fill="${p.accent}" opacity=".09"/>`;
      }
      for (let i = 0; i < 26; i++) body += `<circle cx="${(r() * W).toFixed(0)}" cy="${(r() * H).toFixed(0)}" r="${(1.5 + r() * 3).toFixed(1)}" fill="${p.accent2}" opacity="${(0.3 + r() * 0.6).toFixed(2)}"/>`;
      break;
    }
    case "holy": {
      for (let i = 0; i < 48; i++) {
        const a1 = (Math.PI * 2 / 48) * i, a2 = a1 + Math.PI / 80;
        const cx = 270, cy = 700, R = 1700;
        body += `<polygon points="${cx},${cy} ${(cx + R * Math.cos(a1)).toFixed(0)},${(cy + R * Math.sin(a1)).toFixed(0)} ${(cx + R * Math.cos(a2)).toFixed(0)},${(cy + R * Math.sin(a2)).toFixed(0)}" fill="#fff" opacity=".35"/>`;
      }
      for (let i = 0; i < 30; i++) body += `<circle cx="${(r() * W).toFixed(0)}" cy="${(r() * H).toFixed(0)}" r="${(2 + r() * 4).toFixed(1)}" fill="#fff" opacity="${(0.5 + r() * 0.5).toFixed(2)}"/>`;
      break;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
    <defs>
      <pattern id="scan" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="3" fill="#000" opacity=".22"/></pattern>
      <pattern id="diag" width="26" height="26" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="26" fill="#fff" opacity=".035"/></pattern>
      <linearGradient id="cone" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.accent}" stop-opacity=".22"/><stop offset="1" stop-color="${p.accent}" stop-opacity="0"/></linearGradient>
      <linearGradient id="flame" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ff3d00"/><stop offset=".55" stop-color="#ff9100"/><stop offset="1" stop-color="#ffd54f" stop-opacity="0"/></linearGradient>
      <filter id="blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="40"/></filter>
    </defs>${body}</svg>`;
}

// ============================================================
// CARD HTML (1080 x 1350)
// ============================================================

function buildCardHTML(env, card, opts = {}) {
  const x = Number(card.x) || 0;
  const tier = tierFor(x);
  const p = tier.p;
  const win = Number(card.pnl) >= 0;
  const xText = fmtX(x);
  const xSize = Math.min(220, Math.floor(496 / (xText.length * 0.62)));

  const base = String(env?.MASCOT_BASE_URL || "").trim().replace(/\/+$/, "");
  const mascotURL = base ? `${base}/${tier.mascotKey}.png` : "";
  const mascotImg = mascotURL
    ? `<img src="${esc(mascotURL)}" alt="" onload="var f=document.getElementById('mfb');if(f)f.style.display='none'" onerror="this.remove()">`
    : "";

  const logo = card.logo && /^https?:\/\//i.test(card.logo)
    ? `<img src="${esc(card.logo)}" alt="" onerror="this.remove()">`
    : "";
  const initial = esc(String(card.symbol || "?").replace(/^\$/, "").charAt(0).toUpperCase() || "?");

  const trigger = card.trigger === "TP"
    ? "TAKE PROFIT"
    : (Number(card.sellPercent) > 0 && Number(card.sellPercent) < 99.999
        ? `PARTIAL SELL · ${Number(card.sellPercent).toFixed(0)}%`
        : "CLOSED POSITION");

  const fontLink = opts.webfont === false
    ? ""
    : `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800;900&display=swap" rel="stylesheet">`;

  const pillColor = p.pillInk;

  return `<!doctype html>
<html><head><meta charset="utf-8">
${fontLink}
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1080px;height:1350px;background:${p.bg1}}
body{position:relative;overflow:hidden;color:${p.ink};font-family:Inter,-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI","Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}
.card{position:absolute;inset:0;background:linear-gradient(160deg,${p.bg1} 0%,${p.bg2} 100%);overflow:hidden}
.pattern{position:absolute;inset:0}
.vig{position:absolute;inset:0;background:radial-gradient(120% 90% at 30% 42%,transparent 45%,rgba(0,0,0,${tier.light ? ".10" : ".38"}) 100%)}
.frame{position:absolute;inset:22px;border:2px solid ${p.line};border-radius:46px}
.top{position:absolute;left:64px;right:64px;top:56px;display:flex;justify-content:space-between;align-items:center}
.brand{display:flex;align-items:center;gap:14px;font-weight:800;letter-spacing:.24em;font-size:21px}
.mark{width:42px;height:42px;border-radius:13px;background:linear-gradient(135deg,${p.accent},${p.accent2});display:flex;align-items:center;justify-content:center;color:${pillColor};font-weight:900;font-size:24px;letter-spacing:0}
.pill{padding:10px 22px;border-radius:999px;background:${p.panel};border:1px solid ${p.line};font-weight:700;font-size:20px;letter-spacing:.08em}
.glow{position:absolute;left:10px;top:280px;width:500px;height:500px;border-radius:50%;background:radial-gradient(circle,${p.glow},transparent 68%)}
.stage{position:absolute;left:-20px;top:210px;width:570px;height:830px}
.stage .art{position:absolute;inset:0}
.stage svg,.stage img{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:contain;object-position:center bottom}
.right{position:absolute;left:530px;right:60px;top:150px}
.token{display:flex;align-items:center;gap:20px}
.tlogo{width:88px;height:88px;border-radius:50%;background:${p.panel};border:2px solid ${p.line};position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:38px;color:${p.accent};flex:none}
.tlogo img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.tmeta{min-width:0}
.sym{font-size:54px;font-weight:800;letter-spacing:-.025em;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:380px}
.nm{font-size:23px;color:${p.muted};margin-top:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:380px;font-weight:500}
.tier{display:inline-block;margin-top:30px;padding:11px 24px;border-radius:999px;background:linear-gradient(90deg,${p.accent},${p.accent2});color:${pillColor};font-weight:800;letter-spacing:.16em;font-size:21px}
.x{margin-top:14px;font-weight:900;letter-spacing:-.045em;line-height:1;white-space:nowrap;font-size:${xSize}px;background:linear-gradient(180deg,${p.accent2} 0%,${p.accent} 100%);-webkit-background-clip:text;background-clip:text;color:transparent;padding-bottom:6px}
.pnl{margin-top:14px;font-size:66px;font-weight:800;letter-spacing:-.03em;color:${p.num};white-space:nowrap}
.roi{display:inline-block;margin-top:14px;padding:10px 24px;border-radius:999px;border:2px solid ${p.num};color:${p.num};font-weight:800;font-size:30px;letter-spacing:-.01em}
.panel{position:absolute;left:64px;right:64px;top:1018px;height:236px;border-radius:38px;background:${p.panel};border:1px solid ${p.line};-webkit-backdrop-filter:blur(22px);backdrop-filter:blur(22px);display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr}
.cell{padding:22px 34px;display:flex;flex-direction:column;justify-content:center;min-width:0}
.cell.r{border-left:1px solid ${p.line}}
.cell.b{border-top:1px solid ${p.line}}
.lb{font-size:17px;font-weight:700;letter-spacing:.18em;color:${p.muted}}
.val{font-size:38px;font-weight:800;letter-spacing:-.02em;margin-top:6px;white-space:nowrap}
.val sub{font-size:.58em;vertical-align:baseline;position:relative;top:.22em;font-weight:800}
.sub{font-size:21px;color:${p.muted};margin-top:2px;font-weight:600;white-space:nowrap}
.foot{position:absolute;left:64px;right:64px;bottom:50px;display:flex;justify-content:space-between;font-size:19px;color:${p.muted};font-weight:600;letter-spacing:.06em}
</style></head>
<body><div class="card">
  <div class="pattern">${patternSVG(tier)}</div>
  <div class="vig"></div>
  <div class="frame"></div>
  <div class="top">
    <div class="brand"><div class="mark">D</div>DEGEN TERMINAL</div>
    <div class="pill">${esc(String(card.chainName || "").toUpperCase())}</div>
  </div>
  <div class="glow"></div>
  <div class="stage"><div class="art" id="mfb">${mascotSVG(tier.mascotKey)}</div>${mascotImg ? `<div class="art">${mascotImg}</div>` : ""}</div>
  <div class="right">
    <div class="token">
      <div class="tlogo">${initial}${logo}</div>
      <div class="tmeta"><div class="sym">$${esc(String(card.symbol || "").replace(/^\$/, ""))}</div><div class="nm">${esc(card.name || "")}</div></div>
    </div>
    <div class="tier">${esc(tier.title)}</div>
    <div class="x">${esc(xText)}</div>
    <div class="pnl">${esc(smoney(card.pnl))}</div>
    <div class="roi">${esc(spercent(card.roi))} ROI</div>
  </div>
  <div class="panel">
    <div class="cell"><div class="lb">ENTRY</div><div class="val">${fmtPriceHTML(card.entryPrice)}</div><div class="sub">MC ${esc(fmtMcapCard(card.entryMcap))}</div></div>
    <div class="cell r"><div class="lb">EXIT</div><div class="val">${fmtPriceHTML(card.exitPrice)}</div><div class="sub">MC ${esc(fmtMcapCard(card.exitMcap))}</div></div>
    <div class="cell b"><div class="lb">INVESTED</div><div class="val">${esc(fmtUsdCard(card.costBasis))}</div></div>
    <div class="cell r b"><div class="lb">RETURNED</div><div class="val">${esc(fmtUsdCard(card.exitValue))}</div></div>
  </div>
  <div class="foot"><span>${esc(fmtCardDate(card.ts))}</span><span>${esc(trigger)}</span></div>
</div></body></html>`;
}

// ============================================================
// PNG RENDERING (Cloudflare Browser Rendering - quick action)
// Preferred: BROWSER binding (no token). Fallback: REST API with
// CF_API_TOKEN + CF_ACCOUNT_ID if those secrets/vars exist.
// ============================================================

class CardRenderError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status || 0;
  }
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new CardRenderError(`${label} timeout`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function screenshotHTML(env, html) {
  const options = {
    html,
    viewport: { width: 1080, height: 1350, deviceScaleFactor: 1 },
    gotoOptions: { waitUntil: "networkidle0", timeout: 15000 },
    screenshotOptions: { type: "png" }
  };

  let response;
  if (env.BROWSER && typeof env.BROWSER.quickAction === "function") {
    response = await env.BROWSER.quickAction("screenshot", options);
  } else if (env.CF_API_TOKEN && env.CF_ACCOUNT_ID) {
    response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/browser-run/screenshot`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.CF_API_TOKEN}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(options)
      }
    );
  } else {
    throw new CardRenderError("No browser binding configured");
  }

  if (!response || typeof response.arrayBuffer !== "function") {
    throw new CardRenderError("Unexpected renderer response");
  }
  if (response.ok === false) {
    throw new CardRenderError(`Renderer HTTP ${response.status}`, response.status);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  // PNG signature check
  if (
    bytes.length < 1000 ||
    bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47
  ) {
    throw new CardRenderError("Renderer did not return a PNG");
  }
  return bytes;
}

async function renderCardPNG(env, card) {
  try {
    return await withTimeout(
      screenshotHTML(env, buildCardHTML(env, card, { webfont: true })),
      28000,
      "render"
    );
  } catch (error) {
    // Rate limit / quota: do not burn more browser time.
    if (error?.status === 429 || error?.status === 403 || error?.status === 401) {
      throw error;
    }
    console.log("CARD RENDER RETRY (no webfont)", String(error?.message || error));
    return await withTimeout(
      screenshotHTML(env, buildCardHTML(env, card, { webfont: false })),
      20000,
      "render"
    );
  }
}

// ============================================================
// TELEGRAM FILE UPLOAD + CARD DELIVERY
// ============================================================

async function sendPhotoBytes(env, chatId, bytes, caption, keyboard = null) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Missing TELEGRAM_BOT_TOKEN");

  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("caption", caption);
  form.append("parse_mode", "HTML");
  if (keyboard) {
    form.append("reply_markup", JSON.stringify({ inline_keyboard: keyboard }));
  }
  form.append("photo", new Blob([bytes], { type: "image/png" }), "degen-terminal-card.png");

  const response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: "POST",
    body: form
  });
  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.description || "Telegram sendPhoto failed");
  }
  return data;
}

function cardCaption(headline, card) {
  const tier = tierFor(card.x);
  const sym = esc(String(card.symbol || "").replace(/^\$/, ""));
  return `
${headline}
<b>$${sym}</b> · ${esc(card.chainName || "")} · <b>${esc(tier.title)}</b>
━━━━━━━━━━━━
<b>${esc(fmtX(card.x))}</b>  ${esc(smoney(card.pnl))} (${esc(spercent(card.roi))})
Entry ${esc(fmtPriceText(card.entryPrice))} · MC ${esc(fmtMcapCard(card.entryMcap))}
Exit ${esc(fmtPriceText(card.exitPrice))} · MC ${esc(fmtMcapCard(card.exitMcap))}
Invested ${esc(fmtUsdCard(card.costBasis))} → Returned ${esc(fmtUsdCard(card.exitValue))}
`.trim();
}

// Never throws. Tries PNG card; falls back to the same info as text.
async function sendTradeCard(env, chatId, headline, card, keyboard = null) {
  const caption = cardCaption(headline, card);

  try {
    try {
      await telegram(env, "sendChatAction", { chat_id: chatId, action: "upload_photo" });
    } catch {}
    const bytes = await renderCardPNG(env, card);
    await sendPhotoBytes(env, chatId, bytes, caption, keyboard);
    return { mode: "png" };
  } catch (error) {
    console.log("CARD FALLBACK", String(error?.message || error));
  }

  try {
    await sendMessage(env, chatId, caption, keyboard);
    return { mode: "text" };
  } catch (error) {
    console.log("CARD TEXT FALLBACK FAILED", String(error?.message || error));
    return { mode: "none" };
  }
}


// ============================================================
// SHARED TRADING HELPERS
// ============================================================

function newToken() {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return (a[0] % 2097152) * 4294967296 + a[1];
}

function chainLabel(chain) {
  return CHAINS[chain]?.name || String(chain || "");
}

function shortCA(ca) {
  const s = String(ca || "");
  return s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-6)}` : s;
}

function utcClock() {
  return `${new Date().toISOString().slice(11, 19)} UTC`;
}

function fmtShortDate(ts) {
  try {
    return new Date(Number(ts) || Date.now()).toLocaleString("en-US", {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
      hour12: false, timeZone: "UTC"
    });
  } catch {
    return "";
  }
}

// Atomically take over a confirm-step session so a double tap
// cannot execute the same trade twice. Returns session data or null.
async function claimSession(env, userId, expectedState) {
  const res = await env.DB
    .prepare(`
      UPDATE user_sessions
      SET state = 'busy', updated_at = ?
      WHERE user_id = ? AND state = ?
    `)
    .bind(Date.now(), userId, expectedState)
    .run();

  if (!res?.meta?.changes) return null;

  const s = await getSession(env, userId);
  try {
    return JSON.parse(s?.data || "{}");
  } catch {
    return {};
  }
}

async function sendOrEdit(env, chatId, messageId, text, keyboard = null) {
  if (messageId) {
    try {
      return await editMessage(env, chatId, messageId, text, keyboard);
    } catch (error) {
      const msg = String(error?.message || error);
      if (msg.includes("not modified")) return null;
    }
  }
  return sendMessage(env, chatId, text, keyboard);
}

function parseHint(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function hintFromMarket(m) {
  return JSON.stringify({
    source: m?.source || null,
    pair: m?.pair || null,
    dex: m?.dex || null
  });
}

function ratioFromMarket(m) {
  const pr = Number(m?.price);
  const mc = Number(m?.mcap);
  return pr > 0 && mc > 0 ? mc / pr : null;
}

function positionMetrics(p, price, mcap) {
  const qty = Number(p.quantity);
  const invested = Number(p.invested_usd);
  const value = qty * Number(price || 0);
  const pnl = value - invested;
  return {
    value,
    pnl,
    pnlPct: invested > 0 ? (pnl / invested) * 100 : 0,
    x: invested > 0 ? value / invested : 0,
    mcap: validNumber(mcap) ? Number(mcap) : null
  };
}

// ------------------------------------------------------------
// Light single-source price lookup (1 subrequest).
// Uses the source/pair stored when the position was opened.
// ------------------------------------------------------------
async function quickPrice(chain, ca, hintRaw, fresh = true) {
  const hint = parseHint(hintRaw);
  const config = CHAINS[chain];
  if (!hint || !config) return null;

  if (hint.source === "dexscreener" && hint.pair) {
    const data = await fetchJSON(
      `https://api.dexscreener.com/latest/dex/pairs/${config.dex}/${encodeURIComponent(hint.pair)}`,
      { headers: { accept: "application/json" }, cf: { cacheTtl: -1 } },
      5000
    );
    const pair = data?.pair || (Array.isArray(data?.pairs) ? data.pairs[0] : null);
    const price = Number(pair?.priceUsd);
    if (!validNumber(price)) return null;
    const mcap = validNumber(pair.marketCap)
      ? Number(pair.marketCap)
      : validNumber(pair.fdv) ? Number(pair.fdv) : null;
    return { price, mcap };
  }

  if (hint.source === "hoodscan") {
    const list = await getHoodScanMarket(chain, ca, fresh);
    const m = list?.[0];
    if (m && validNumber(m.price)) {
      return { price: Number(m.price), mcap: validNumber(m.mcap) ? Number(m.mcap) : null };
    }
    return null;
  }

  if (hint.source === "geckoterminal" && hint.pair && config.gecko) {
    const poolId = String(hint.pair).replace(new RegExp(`^${config.gecko}_`), "");
    const data = await fetchJSON(
      `https://api.geckoterminal.com/api/v2/networks/${config.gecko}/pools/${encodeURIComponent(poolId)}`,
      { headers: { accept: "application/json" } },
      6000
    );
    const a = data?.data?.attributes || {};
    const price = Number(a.token_price_usd || a.base_token_price_usd || 0);
    if (!validNumber(price)) return null;
    const mcap = validNumber(a.market_cap_usd) ? Number(a.market_cap_usd) : null;
    return { price, mcap };
  }

  return null;
}

// Live price for lists / wallet while respecting the free-plan
// subrequest limit. budget.left is decremented BEFORE awaiting so
// parallel calls cannot overspend.
async function getLivePrice(p, budget, fresh = true) {
  const cp = Number(p.current_price);
  const cm = Number(p.current_mcap);
  const ratio =
    Number(p.mcap_ratio) > 0
      ? Number(p.mcap_ratio)
      : (cp > 0 && cm > 0 ? cm / cp : null);
  const derive = (price, fallback) =>
    ratio ? price * ratio : (validNumber(fallback) ? Number(fallback) : null);

  if (p.price_source && budget.left >= 1) {
    budget.left -= 1;
    try {
      const q = await quickPrice(p.chain, p.ca, p.price_source, fresh);
      if (q && validNumber(q.price)) {
        return { price: q.price, mcap: derive(q.price, q.mcap), live: true };
      }
    } catch (error) {
      console.log("QUICK PRICE ERROR", String(error?.message || error));
    }
  }

  if (budget.left >= 14) {
    budget.left -= 14;
    try {
      const m = await getTokenData(p.chain, p.ca, { fresh });
      if (validNumber(m.price)) {
        return {
          price: Number(m.price),
          mcap: validNumber(m.mcap) ? Number(m.mcap) : derive(Number(m.price), null),
          live: true,
          market: m
        };
      }
    } catch {}
  }

  return {
    price: cp > 0 ? cp : 0,
    mcap: cm > 0 ? cm : null,
    live: false
  };
}

async function portfolioSnapshot(env, userId) {
  const wallet = await getWallet(env, userId);
  const res = await env.DB
    .prepare(`SELECT * FROM positions WHERE user_id = ? ORDER BY created_at DESC`)
    .bind(userId)
    .all();
  const rows = res.results || [];
  const budget = { left: 34 };
  const live = await Promise.all(rows.map(p => getLivePrice(p, budget, true)));

  let holdings = 0;
  let unrealized = 0;
  rows.forEach((p, i) => {
    const m = positionMetrics(p, live[i].price, live[i].mcap);
    holdings += m.value;
    unrealized += m.pnl;
  });

  return { wallet, rows, live, holdings, unrealized };
}

// Builds "INSERT INTO t (cols) SELECT vals WHERE <guard>".
// A value may be {sql, binds} for an SQL expression.
function guardedInsert(env, table, row, whereSql, whereBinds) {
  const cols = Object.keys(row);
  const binds = [];
  const exprs = cols.map(c => {
    const v = row[c];
    if (v && typeof v === "object" && v.sql) {
      binds.push(...(v.binds || []));
      return v.sql;
    }
    binds.push(v === undefined ? null : v);
    return "?";
  });
  return env.DB
    .prepare(`INSERT INTO ${table} (${cols.join(", ")}) SELECT ${exprs.join(", ")} WHERE ${whereSql}`)
    .bind(...binds, ...whereBinds);
}

// ============================================================
// SHARED BUY (new position or buy more) - atomic in one D1 batch
// ============================================================

async function applyBuy(env, userId, info, market, amount, existing) {
  const execPrice = Number(market.price);
  const qty = amount / execPrice;
  const now = Date.now();
  const rev = newToken();
  const ratio = ratioFromMarket(market);
  const hint = hintFromMarket(market);
  const mcap = validNumber(market.mcap) ? Number(market.mcap) : null;
  const walletGuard = `EXISTS (SELECT 1 FROM wallets WHERE user_id = ? AND cash_balance >= ?)`;

  const tradeRow = (positionIdValue) => ({
    user_id: userId,
    position_id: positionIdValue,
    chain: info.chain,
    ca: info.ca,
    name: info.name,
    symbol: info.symbol,
    side: "BUY",
    sell_percent: null,
    price: execPrice,
    mcap,
    quantity: qty,
    usd_amount: amount,
    pnl_usd: 0,
    pnl_percent: 0,
    created_at: now,
    entry_price: execPrice,
    entry_mcap: mcap,
    cost_basis: amount,
    x_multiple: null,
    trigger_type: "MANUAL",
    logo_url: info.logo || null
  });

  if (existing) {
    const oldQty = Number(existing.quantity);
    const oldInvested = Number(existing.invested_usd);
    const newQty = oldQty + qty;
    const newInvested = oldInvested + amount;
    const avgPrice = newInvested / newQty;

    // Entry market cap must follow the average entry price:
    // avg price x supply (supply = mcap / price at execution).
    const oldEntryMcap = Number(existing.entry_mcap) || 0;
    const entryMcap = ratio ? avgPrice * ratio : (oldEntryMcap > 0 ? oldEntryMcap : null);

    const oldRev = Number(existing.rev || 0);
    const posGuard = `EXISTS (SELECT 1 FROM positions WHERE id = ? AND rev = ?)`;

    const results = await env.DB.batch([
      env.DB.prepare(`
        UPDATE positions
        SET entry_price = ?, current_price = ?, entry_mcap = ?, current_mcap = ?,
            quantity = ?, invested_usd = ?, remaining_invested_usd = ?,
            price_source = ?, mcap_ratio = ?, updated_at = ?, rev = ?
        WHERE id = ? AND user_id = ? AND COALESCE(rev, 0) = ? AND ${walletGuard}
      `).bind(
        avgPrice, execPrice, entryMcap, mcap,
        newQty, newInvested, newInvested,
        hint, ratio, now, rev,
        existing.id, userId, oldRev, userId, amount
      ),
      env.DB.prepare(`
        UPDATE wallets
        SET cash_balance = cash_balance - ?, updated_at = ?
        WHERE user_id = ? AND cash_balance >= ? AND ${posGuard}
      `).bind(amount, now, userId, amount, existing.id, rev),
      guardedInsert(env, "trades", tradeRow(existing.id), posGuard, [existing.id, rev])
    ]);

    if (results[0]?.meta?.changes !== 1) {
      return { ok: false, reason: "changed" };
    }
    return { ok: true, positionId: existing.id, avgPrice, entryMcap, qty, newQty, newInvested };
  }

  const posWhere = `user_id = ? AND chain = ? AND ca = ? AND rev = ?`;
  const posBinds = [userId, info.chain, info.ca, rev];

  const results = await env.DB.batch([
    guardedInsert(env, "positions", {
      user_id: userId,
      chain: info.chain,
      ca: info.ca,
      name: info.name,
      symbol: info.symbol,
      logo_url: info.logo || null,
      entry_price: execPrice,
      current_price: execPrice,
      entry_mcap: mcap,
      current_mcap: mcap,
      quantity: qty,
      invested_usd: amount,
      remaining_invested_usd: amount,
      created_at: now,
      updated_at: now,
      price_source: hint,
      mcap_ratio: ratio,
      tp_sell_pct: 100,
      rev
    }, walletGuard, [userId, amount]),
    env.DB.prepare(`
      UPDATE wallets
      SET cash_balance = cash_balance - ?, updated_at = ?
      WHERE user_id = ? AND cash_balance >= ?
        AND EXISTS (SELECT 1 FROM positions WHERE ${posWhere})
    `).bind(amount, now, userId, amount, ...posBinds),
    guardedInsert(
      env,
      "trades",
      tradeRow({ sql: `(SELECT id FROM positions WHERE ${posWhere})`, binds: posBinds }),
      `EXISTS (SELECT 1 FROM positions WHERE ${posWhere})`,
      posBinds
    )
  ]);

  if (results[0]?.meta?.changes !== 1) {
    return { ok: false, reason: "funds" };
  }
  return {
    ok: true,
    positionId: results[0].meta.last_row_id,
    avgPrice: execPrice,
    entryMcap: mcap,
    qty,
    newQty: qty,
    newInvested: amount
  };
}

// ============================================================
// SHARED CLOSE (manual sells + TP) - atomic, race-safe
// ============================================================
// Everything is guarded by the position's `rev` token. If anything
// changed the position meanwhile, NOTHING is applied (no double sell).

async function closePaper(env, { userId, position, sellPercent, market, trigger = "MANUAL" }) {
  const p = position;
  const pct = Number(sellPercent);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
    throw new Error("Invalid sell percent");
  }
  const execPrice = Number(market?.price);
  if (!validNumber(execPrice)) {
    throw new Error("No usable market price");
  }

  const oldQty = Number(p.quantity);
  const oldInvested = Number(p.invested_usd);
  if (!(oldQty > 0)) return { ok: false, reason: "empty" };

  const full = pct >= 99.999;
  const sellQty = full ? oldQty : (oldQty * pct) / 100;
  const costBasis = full ? oldInvested : (oldInvested * pct) / 100;
  const sellValue = sellQty * execPrice;
  const pnl = sellValue - costBasis;
  const roi = costBasis > 0 ? (pnl / costBasis) * 100 : 0;
  const x = costBasis > 0 ? sellValue / costBasis : 0;

  const exitMcap = validNumber(market.mcap) ? Number(market.mcap) : null;
  const entryMcap = validNumber(p.entry_mcap) ? Number(p.entry_mcap) : null;
  const entryPrice = Number(p.entry_price) || 0;

  const newQty = full ? 0 : oldQty - sellQty;
  const newInvested = full ? 0 : oldInvested - costBasis;

  const now = Date.now();
  const oldRev = Number(p.rev || 0);
  const newRev = newToken();
  const guard = `EXISTS (SELECT 1 FROM positions WHERE id = ? AND user_id = ? AND COALESCE(rev, 0) = ?)`;
  const guardBinds = [p.id, userId, oldRev];

  const statements = [
    env.DB.prepare(`
      UPDATE wallets
      SET cash_balance = cash_balance + ?, realized_pnl = realized_pnl + ?, updated_at = ?
      WHERE user_id = ? AND ${guard}
    `).bind(sellValue, pnl, now, userId, ...guardBinds),

    guardedInsert(env, "trades", {
      user_id: userId,
      position_id: p.id,
      chain: p.chain,
      ca: p.ca,
      name: p.name,
      symbol: p.symbol,
      side: "SELL",
      sell_percent: pct,
      price: execPrice,
      mcap: exitMcap,
      quantity: sellQty,
      usd_amount: sellValue,
      pnl_usd: pnl,
      pnl_percent: roi,
      created_at: now,
      entry_price: entryPrice,
      entry_mcap: entryMcap,
      cost_basis: costBasis,
      x_multiple: x,
      trigger_type: trigger,
      logo_url: p.logo_url || null
    }, guard, guardBinds)
  ];

  if (full) {
    statements.push(
      env.DB.prepare(`
        DELETE FROM positions
        WHERE id = ? AND user_id = ? AND COALESCE(rev, 0) = ?
      `).bind(p.id, userId, oldRev)
    );
  } else {
    statements.push(
      env.DB.prepare(`
        UPDATE positions
        SET quantity = ?, invested_usd = ?, remaining_invested_usd = ?,
            current_price = ?, current_mcap = ?, updated_at = ?, rev = ?
        WHERE id = ? AND user_id = ? AND COALESCE(rev, 0) = ?
      `).bind(
        newQty, newInvested, newInvested,
        execPrice, exitMcap, now, newRev,
        p.id, userId, oldRev
      )
    );
  }

  const results = await env.DB.batch(statements);
  if (results[2]?.meta?.changes !== 1) {
    return { ok: false, reason: "changed" };
  }

  return {
    ok: true,
    full,
    card: {
      symbol: p.symbol,
      name: p.name,
      chainKey: p.chain,
      chainName: chainLabel(p.chain),
      logo: p.logo_url || null,
      entryPrice,
      entryMcap,
      exitPrice: execPrice,
      exitMcap,
      costBasis,
      exitValue: sellValue,
      pnl,
      roi,
      x,
      ts: now,
      trigger,
      sellPercent: pct,
      closed: full
    }
  };
}

// ============================================================
// BUY CONFIRM + EXECUTE
// ============================================================

async function showBuyConfirm(env, chatId, userId, amount) {
  const session = await getSession(env, userId);
  if (!session) return showHome(env, chatId, userId);

  const data = JSON.parse(session.data || "{}");
  const token = data.token;
  if (!token) return showHome(env, chatId, userId);

  amount = Number(amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return sendMessage(env, chatId, "❌ Invalid amount.", backKeyboard());
  }

  await setSession(env, userId, "confirm_buy", { token, amount });

  return sendMessage(
    env,
    chatId,
    `
🟢 <b>CONFIRM BUY</b>

🪙 $${esc(token.symbol)} · ${esc(chainLabel(token.chain))}

Amount:
<b>${money(amount)}</b>
`.trim(),
    [
      [{ text: "✅ CONFIRM BUY", callback_data: "confirmbuy" }],
      [{ text: "❌ CANCEL", callback_data: "trade" }]
    ]
  );
}

async function executeBuy(env, chatId, userId) {
  const data = await claimSession(env, userId, "confirm_buy");
  if (!data) return;

  const token = data.token;
  const amount = Number(data.amount);
  if (!token || !Number.isFinite(amount) || amount <= 0) {
    await clearSession(env, userId);
    return;
  }

  const wallet = await getWallet(env, userId);
  if (amount > Number(wallet.cash_balance)) {
    await clearSession(env, userId);
    return sendMessage(env, chatId, "❌ Insufficient balance.", mainKeyboard());
  }

  let market;
  try {
    market = await getTokenData(token.chain, token.ca, { fresh: true });
  } catch {
    await setSession(env, userId, "confirm_buy", data);
    return sendMessage(env, chatId, "❌ Market data unavailable right now. Try again.", backKeyboard());
  }

  if (!validNumber(market.price)) {
    await clearSession(env, userId);
    return sendMessage(env, chatId, "❌ Token has no usable market price yet.", mainKeyboard());
  }

  const existing = await env.DB
    .prepare(`SELECT * FROM positions WHERE user_id = ? AND chain = ? AND ca = ? LIMIT 1`)
    .bind(userId, token.chain, token.ca)
    .first();

  const result = await applyBuy(
    env,
    userId,
    {
      chain: token.chain,
      ca: token.ca,
      name: token.name,
      symbol: token.symbol,
      logo: token.image || null
    },
    market,
    amount,
    existing
  );

  await clearSession(env, userId);

  if (!result.ok) {
    return sendMessage(
      env,
      chatId,
      result.reason === "funds"
        ? "❌ Insufficient balance."
        : "⚠️ Position changed while buying. Open it again and retry.",
      mainKeyboard()
    );
  }

  const execPrice = Number(market.price);

  return sendMessage(
    env,
    chatId,
    `
✅ <b>BUY COMPLETE</b>

🪙 $${esc(token.symbol)} · ${esc(chainLabel(token.chain))}

Entry:
<b>${price(result.avgPrice)}</b>

MCap:
<b>${fmtMcapCard(result.entryMcap)}</b>

Invested:
<b>${money(amount)}</b>

Tokens:
<b>${result.qty.toLocaleString()}</b>

📡 ${esc(market.source || "multi-source")}
`.trim(),
    [
      [{ text: "📊 VIEW POSITIONS", callback_data: "positions" }],
      [
        { text: "⚡ TRADE AGAIN", callback_data: "trade" },
        { text: "🏠 HOME", callback_data: "home" }
      ]
    ]
  );
}

// ============================================================
// BUY MORE
// ============================================================

async function confirmBuyMore(env, chatId, userId, amount) {
  const session = await getSession(env, userId);
  if (!session) return;

  const data = JSON.parse(session.data || "{}");
  const positionId = Number(data.positionId);

  const p = await env.DB
    .prepare(`SELECT * FROM positions WHERE id = ? AND user_id = ?`)
    .bind(positionId, userId)
    .first();
  if (!p) return;

  amount = Number(amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return sendMessage(env, chatId, "❌ Invalid amount.", backKeyboard());
  }

  let market;
  try {
    market = await getTokenData(p.chain, p.ca, { fresh: true });
  } catch {
    return sendMessage(env, chatId, "❌ Market data unavailable right now. Try again.", backKeyboard());
  }
  if (!validNumber(market.price)) {
    return sendMessage(env, chatId, "❌ Token has no usable market price yet.", backKeyboard());
  }

  const qty = amount / Number(market.price);

  await setSession(env, userId, "confirm_more", { positionId, amount });

  return sendMessage(
    env,
    chatId,
    `
🟢 <b>CONFIRM BUY MORE</b>

$${esc(p.symbol)}

Current Price:
<b>${price(market.price)}</b>

Current MCap:
<b>${fmtMcapCard(market.mcap)}</b>

Add:
<b>${money(amount)}</b>

Tokens:
<b>${qty.toLocaleString()}</b>
`.trim(),
    [
      [{ text: "✅ CONFIRM", callback_data: "confirmmore" }],
      [{ text: "❌ CANCEL", callback_data: `pos:${positionId}` }]
    ]
  );
}

async function executeBuyMore(env, chatId, userId) {
  const data = await claimSession(env, userId, "confirm_more");
  if (!data) return;

  const positionId = Number(data.positionId);
  const amount = Number(data.amount);

  const p = await env.DB
    .prepare(`SELECT * FROM positions WHERE id = ? AND user_id = ?`)
    .bind(positionId, userId)
    .first();
  if (!p || !Number.isFinite(amount) || amount <= 0) {
    await clearSession(env, userId);
    return;
  }

  const wallet = await getWallet(env, userId);
  if (amount > Number(wallet.cash_balance)) {
    await clearSession(env, userId);
    return sendMessage(env, chatId, "❌ Insufficient balance.", mainKeyboard());
  }

  let market;
  try {
    market = await getTokenData(p.chain, p.ca, { fresh: true });
  } catch {
    await setSession(env, userId, "confirm_more", data);
    return sendMessage(env, chatId, "❌ Market data unavailable right now. Try again.", backKeyboard());
  }
  if (!validNumber(market.price)) {
    await clearSession(env, userId);
    return sendMessage(env, chatId, "❌ Token has no usable market price yet.", mainKeyboard());
  }

  const result = await applyBuy(
    env,
    userId,
    { chain: p.chain, ca: p.ca, name: p.name, symbol: p.symbol, logo: p.logo_url },
    market,
    amount,
    p
  );

  await clearSession(env, userId);

  if (!result.ok) {
    return sendMessage(
      env,
      chatId,
      "⚠️ Position changed while buying. Open it again and retry.",
      [[{ text: "📊 POSITIONS", callback_data: "positions" }]]
    );
  }

  return sendMessage(
    env,
    chatId,
    `
✅ <b>BUY MORE COMPLETE</b>

$${esc(p.symbol)}

Added:
<b>${money(amount)}</b>

New Entry:
<b>${price(result.avgPrice)}</b>

New Entry MCap:
<b>${fmtMcapCard(result.entryMcap)}</b>
`.trim(),
    [
      [{ text: "📊 POSITION", callback_data: `pos:${positionId}` }],
      [{ text: "🏠 HOME", callback_data: "home" }]
    ]
  );
}

// ============================================================
// SELL CONFIRM + EXECUTE (+ PnL card on every sell)
// ============================================================

async function confirmSell(env, chatId, userId, positionId, sellPercent) {
  const p = await env.DB
    .prepare(`SELECT * FROM positions WHERE id = ? AND user_id = ?`)
    .bind(positionId, userId)
    .first();
  if (!p) return;

  const pct = Number(sellPercent);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return;

  let market;
  try {
    market = await getTokenData(p.chain, p.ca, { fresh: true });
  } catch {
    return sendMessage(env, chatId, "❌ Market data unavailable right now. Try again.", [
      [{ text: "← Back", callback_data: `pos:${positionId}` }]
    ]);
  }
  if (!validNumber(market.price)) {
    return sendMessage(env, chatId, "❌ Token has no usable market price right now.", [
      [{ text: "← Back", callback_data: `pos:${positionId}` }]
    ]);
  }

  const sellQty = (Number(p.quantity) * pct) / 100;
  const sellValue = sellQty * Number(market.price);
  const costBasis = (Number(p.invested_usd) * pct) / 100;
  const pnl = sellValue - costBasis;
  const x = costBasis > 0 ? sellValue / costBasis : 0;

  await setSession(env, userId, "confirm_sell", { positionId, sellPercent: pct });

  return sendMessage(
    env,
    chatId,
    `
🔴 <b>CONFIRM SELL</b>

$${esc(p.symbol)}

Sell:
<b>${pct}%</b>

Price:
<b>${price(market.price)}</b>

Value:
<b>${money(sellValue)}</b>

PnL:
<b>${smoney(pnl)}</b> · <b>${fmtX(x)}</b>
`.trim(),
    [
      [{ text: "✅ CONFIRM SELL", callback_data: "confirmsell" }],
      [{ text: "❌ CANCEL", callback_data: `pos:${positionId}` }]
    ]
  );
}

function sellKeyboard() {
  return [
    [{ text: "📊 POSITIONS", callback_data: "positions" }],
    [
      { text: "💰 WALLET", callback_data: "wallet" },
      { text: "🏠 HOME", callback_data: "home" }
    ]
  ];
}

async function executeSell(env, chatId, userId) {
  const data = await claimSession(env, userId, "confirm_sell");
  if (!data) return;

  const positionId = Number(data.positionId);
  const sellPercent = Number(data.sellPercent);

  const p = await env.DB
    .prepare(`SELECT * FROM positions WHERE id = ? AND user_id = ?`)
    .bind(positionId, userId)
    .first();

  if (!p) {
    await clearSession(env, userId);
    return sendMessage(env, chatId, "⚠️ Position not found.", [
      [{ text: "📊 POSITIONS", callback_data: "positions" }]
    ]);
  }

  let market;
  try {
    market = await getTokenData(p.chain, p.ca, { fresh: true });
  } catch {
    await setSession(env, userId, "confirm_sell", data);
    return sendMessage(env, chatId, "❌ Market data unavailable right now. Try again.", [
      [{ text: "← Back", callback_data: `pos:${positionId}` }]
    ]);
  }

  if (!validNumber(market.price)) {
    await setSession(env, userId, "confirm_sell", data);
    return sendMessage(env, chatId, "❌ Token has no usable market price right now.", [
      [{ text: "← Back", callback_data: `pos:${positionId}` }]
    ]);
  }

  let result;
  try {
    result = await closePaper(env, {
      userId,
      position: p,
      sellPercent,
      market,
      trigger: "MANUAL"
    });
  } catch (error) {
    await clearSession(env, userId);
    console.log("SELL ERROR", String(error?.message || error));
    return sendMessage(env, chatId, "❌ Sell failed. Nothing was changed.", sellKeyboard());
  }

  await clearSession(env, userId);

  if (!result.ok) {
    return sendMessage(
      env,
      chatId,
      "⚠️ Position changed before the sell executed. Nothing was sold.",
      sellKeyboard()
    );
  }

  // Trade is already committed. Card delivery can never undo it.
  await sendTradeCard(
    env,
    chatId,
    result.full ? "✅ <b>SELL COMPLETE</b>" : `✅ <b>SELL COMPLETE · ${sellPercent}%</b>`,
    result.card,
    sellKeyboard()
  );
}

// ============================================================
// HOME / WALLET / FUNDS
// ============================================================

async function showHome(env, chatId, userId, messageId = null) {
  const snap = await portfolioSnapshot(env, userId);
  const cash = Number(snap.wallet.cash_balance);
  const total = cash + snap.holdings;
  const totalPnl = Number(snap.wallet.realized_pnl) + snap.unrealized;

  const text = `
🦍 <b>DEGEN TERMINAL</b>

💰 Cash: <b>${money(cash)}</b>

📊 Portfolio: <b>${money(total)}</b>

📈 PnL: <b>${smoney(totalPnl)}</b>

🎯 Open positions: <b>${snap.rows.length}</b>
`.trim();

  return sendOrEdit(env, chatId, messageId, text, mainKeyboard());
}

async function showWallet(env, chatId, userId) {
  const snap = await portfolioSnapshot(env, userId);
  const cash = Number(snap.wallet.cash_balance);
  const realized = Number(snap.wallet.realized_pnl);
  const total = cash + snap.holdings;
  const totalPnl = realized + snap.unrealized;

  return sendMessage(
    env,
    chatId,
    `
💰 <b>WALLET</b>

💵 Cash
<b>${money(cash)}</b>

📦 Holdings
<b>${money(snap.holdings)}</b>

💼 Portfolio
<b>${money(total)}</b>

📈 Realized PnL
<b>${smoney(realized)}</b>

📊 Unrealized PnL
<b>${smoney(snap.unrealized)}</b>

🔥 Total PnL
<b>${smoney(totalPnl)}</b>
`.trim(),
    [
      [{ text: "💸 REQUEST FUNDS", callback_data: "funds" }],
      [
        { text: "📊 POSITIONS", callback_data: "positions" },
        { text: "← Back", callback_data: "home" }
      ]
    ]
  );
}

async function showFunds(env, chatId, userId) {
  await setSession(env, userId, "fund_request", {});

  return sendMessage(
    env,
    chatId,
    `
💸 <b>REQUEST FUNDS</b>

Choose amount:
`.trim(),
    [
      [
        { text: "$10", callback_data: "fund:10" },
        { text: "$25", callback_data: "fund:25" },
        { text: "$50", callback_data: "fund:50" }
      ],
      [
        { text: "$100", callback_data: "fund:100" },
        { text: "$250", callback_data: "fund:250" },
        { text: "Custom", callback_data: "fundcustom" }
      ],
      [{ text: "← Back", callback_data: "wallet" }]
    ]
  );
}

async function addFunds(env, chatId, userId, amount) {
  amount = Number(amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return sendMessage(env, chatId, "❌ Invalid amount.", backKeyboard());
  }

  const now = Date.now();

  await env.DB.batch([
    env.DB.prepare(`
      UPDATE wallets
      SET cash_balance = cash_balance + ?, updated_at = ?
      WHERE user_id = ?
    `).bind(amount, now, userId),
    env.DB.prepare(`
      INSERT INTO fund_requests (user_id, amount, status, created_at)
      VALUES (?, ?, 'approved', ?)
    `).bind(userId, amount, now)
  ]);

  const wallet = await getWallet(env, userId);
  await clearSession(env, userId);

  return sendMessage(
    env,
    chatId,
    `
💸 <b>FUNDS ADDED</b>

Added:
<b>${money(amount)}</b>

New Cash Balance:
<b>${money(Number(wallet.cash_balance))}</b>
`.trim(),
    [
      [{ text: "💰 WALLET", callback_data: "wallet" }],
      [{ text: "⚡ TRADE", callback_data: "trade" }]
    ]
  );
}

// ============================================================
// HISTORY (latest 30 trades shown)
// ============================================================

async function showHistory(env, chatId, userId) {
  const res = await env.DB
    .prepare(`
      SELECT * FROM trades
      WHERE user_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 30
    `)
    .bind(userId)
    .all();
  const rows = res.results || [];

  const nav = [
    [{ text: "📊 POSITIONS", callback_data: "positions" }],
    [{ text: "← Back", callback_data: "home" }]
  ];

  if (!rows.length) {
    return sendMessage(env, chatId, "📜 <b>HISTORY</b>\n\nNo trades yet.", [
      [{ text: "⚡ TRADE", callback_data: "trade" }],
      [{ text: "← Back", callback_data: "home" }]
    ]);
  }

  const entries = rows.map(t => {
    const sym = esc(String(t.symbol || "").replace(/^\$/, ""));
    const chain = esc(chainLabel(t.chain));
    const usd = Number(t.usd_amount || 0);
    const when = esc(fmtShortDate(t.created_at));

    if (t.side === "BUY") {
      return `🟢 <b>BUY</b> $${sym} · ${chain}
${money(usd)} @ ${price(t.price)} · MC ${fmtMcapCard(t.mcap)}
${when}`;
    }

    const pnl = Number(t.pnl_usd || 0);
    const cost = usd - pnl;
    const x = Number(t.x_multiple) > 0 ? Number(t.x_multiple) : (cost > 0 ? usd / cost : 0);
    const tag = t.trigger_type === "TP" ? " · 🎯 TP" : "";
    const pct = t.sell_percent ? ` ${Number(t.sell_percent).toFixed(0)}%` : "";

    return `🔴 <b>SELL${pct}</b> $${sym} · ${chain}${tag}
${money(usd)} @ ${price(t.price)} · MC ${fmtMcapCard(t.mcap)}
<b>${fmtX(x)}</b> · ${smoney(pnl)} (${spercent(t.pnl_percent)})
${when}`;
  });

  const chunks = [];
  let current = "📜 <b>HISTORY</b> · last 30";
  for (const entry of entries) {
    if ((current + "\n\n" + entry).length > 3700) {
      chunks.push(current);
      current = entry;
    } else {
      current += "\n\n" + entry;
    }
  }
  chunks.push(current);

  for (let i = 0; i < chunks.length; i++) {
    const last = i === chunks.length - 1;
    await sendMessage(env, chatId, chunks[i], last ? nav : null);
  }
}

// ============================================================
// POSITIONS (list + detail + refresh)
// ============================================================

async function showPositions(env, chatId, userId, messageId = null) {
  const res = await env.DB
    .prepare(`
      SELECT * FROM positions
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 15
    `)
    .bind(userId)
    .all();
  const rows = res.results || [];

  if (!rows.length) {
    return sendOrEdit(
      env,
      chatId,
      messageId,
      "📊 <b>POSITIONS</b>\n\nNo open positions.",
      [
        [{ text: "⚡ TRADE", callback_data: "trade" }],
        [{ text: "← Back", callback_data: "home" }]
      ]
    );
  }

  const budget = { left: 34 };
  const live = await Promise.all(rows.map(p => getLivePrice(p, budget, true)));

  let text = `📊 <b>POSITIONS</b> · ${rows.length} open\n\n━━━━━━━━━━━━`;
  const keyboard = [];
  let anyCached = false;

  rows.forEach((p, i) => {
    const l = live[i];
    if (!l.live) anyCached = true;
    const m = positionMetrics(p, l.price, l.mcap);
    const dot = m.pnl >= 0 ? "🟢" : "🔴";
    const sym = esc(String(p.symbol || "").replace(/^\$/, ""));

    const block = `

${dot} <b>$${sym}</b> · ${esc(chainLabel(p.chain))}
<b>${fmtX(m.x)}</b> · ${smoney(m.pnl)} (${spercent(m.pnlPct)})
${price(p.entry_price)} → ${price(l.price)}
MC ${fmtMcapCard(p.entry_mcap)} → ${fmtMcapCard(l.mcap)}
Invested ${money(p.invested_usd)} → <b>${money(m.value)}</b>${Number(p.tp_price) > 0 ? "\n🎯 TP " + fmtX(Number(p.entry_price) > 0 ? Number(p.tp_price) / Number(p.entry_price) : 0) : ""}`;

    if ((text + block).length < 3800) text += block;

    keyboard.push([{
      text: `${dot} $${String(p.symbol || "").replace(/^\$/, "")} · ${fmtX(m.x)} · ${spercent(m.pnlPct)}`,
      callback_data: `pos:${p.id}`
    }]);
  });

  text += `\n\n━━━━━━━━━━━━\n🕐 ${utcClock()}${anyCached ? " · ⚠️ some prices cached" : ""}`;

  keyboard.push([
    { text: "🔄 REFRESH", callback_data: "posall" },
    { text: "← Back", callback_data: "home" }
  ]);

  return sendOrEdit(env, chatId, messageId, text, keyboard);
}

function tpLine(p) {
  const tp = Number(p.tp_price);
  if (!(tp > 0)) return "🎯 TP: <b>not set</b>";
  const entry = Number(p.entry_price);
  const ratio = Number(p.mcap_ratio);
  const pct = Number(p.tp_sell_pct) || 100;
  return `🎯 TP: <b>${price(tp)}</b> · <b>${fmtX(entry > 0 ? tp / entry : 0)}</b>${ratio > 0 ? ` · MC ${fmtMcapCard(tp * ratio)}` : ""} · sells ${pct}%`;
}

async function showPosition(env, chatId, userId, positionId, messageId = null, refresh = false) {
  const p = await env.DB
    .prepare(`SELECT * FROM positions WHERE id = ? AND user_id = ?`)
    .bind(positionId, userId)
    .first();

  if (!p) {
    return sendOrEdit(env, chatId, messageId, "⚠️ Position not found.", [
      [{ text: "📊 POSITIONS", callback_data: "positions" }]
    ]);
  }

  let market = null;
  let cached = false;
  try {
    market = await getTokenData(p.chain, p.ca, { fresh: true });
    if (!validNumber(market.price)) {
      market = null;
      cached = true;
    }
  } catch {
    cached = true;
  }

  let curPrice = Number(p.current_price);
  let curMcap = validNumber(p.current_mcap) ? Number(p.current_mcap) : null;

  if (market) {
    curPrice = Number(market.price);
    curMcap = validNumber(market.mcap) ? Number(market.mcap) : null;
    const ratio = ratioFromMarket(market);

    await env.DB
      .prepare(`
        UPDATE positions
        SET current_price = ?, current_mcap = ?, price_source = ?,
            mcap_ratio = COALESCE(?, mcap_ratio), updated_at = ?
        WHERE id = ? AND user_id = ?
      `)
      .bind(curPrice, curMcap, hintFromMarket(market), ratio, Date.now(), p.id, userId)
      .run();

    // TP can fire from an explicit open/refresh as well as from the cron.
    if (Number(p.tp_price) > 0 && curPrice >= Number(p.tp_price)) {
      const fired = await executeTP(env, p.id, Number(p.tp_price), chatId, market);
      if (fired) return;
    }
  }

  const m = positionMetrics(p, curPrice, curMcap);
  const sym = esc(String(p.symbol || "").replace(/^\$/, ""));
  const fresh = await env.DB
    .prepare(`SELECT * FROM positions WHERE id = ? AND user_id = ?`)
    .bind(positionId, userId)
    .first();

  const text = `
📊 <b>$${sym}</b> · ${esc(chainLabel(p.chain))}
<i>${esc(p.name || "")}</i>

━━━━━━━━━━━━
Entry   <b>${price(p.entry_price)}</b>
        MC <b>${fmtMcapCard(p.entry_mcap)}</b>
Now     <b>${price(curPrice)}</b>
        MC <b>${fmtMcapCard(curMcap)}</b>
━━━━━━━━━━━━
Invested  <b>${money(p.invested_usd)}</b>
Value     <b>${money(m.value)}</b>
PnL       <b>${smoney(m.pnl)}</b> (${spercent(m.pnlPct)})
Multiple  <b>${fmtX(m.x)}</b>
━━━━━━━━━━━━
${tpLine(fresh || p)}

<code>${esc(p.ca)}</code>
🕐 ${utcClock()}${cached ? " · ⚠️ price cached" : ""}
`.trim();

  const hasTP = Number((fresh || p).tp_price) > 0;

  return sendOrEdit(env, chatId, messageId, text, [
    [
      { text: "➕ BUY MORE", callback_data: `buypos:${p.id}` },
      { text: "🔴 SELL", callback_data: `sell:${p.id}` }
    ],
    [
      { text: hasTP ? "🎯 EDIT TP" : "🎯 SET TP", callback_data: `tp:${p.id}` },
      { text: "🔄 REFRESH", callback_data: `posr:${p.id}` }
    ],
    [{ text: "← Back", callback_data: "positions" }]
  ]);
}

// ============================================================
// TAKE PROFIT (TP only - no stop loss)
// ============================================================

function parseSuffixNumber(text) {
  let t = String(text || "").trim().toLowerCase().replace(/[$,\s]/g, "");
  t = t.replace(/x$/, "");
  const m = t.match(/^(\d*\.?\d+(?:e[+-]?\d+)?)([kmbt])?$/);
  if (!m) return null;
  const mult = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[m[2]] || 1;
  const n = Number(m[1]) * mult;
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function showTPMenu(env, chatId, userId, positionId, messageId = null, note = "") {
  const p = await env.DB
    .prepare(`SELECT * FROM positions WHERE id = ? AND user_id = ?`)
    .bind(positionId, userId)
    .first();
  if (!p) return;

  const budget = { left: 20 };
  const l = await getLivePrice(p, budget, true);
  const m = positionMetrics(p, l.price, l.mcap);
  const sym = esc(String(p.symbol || "").replace(/^\$/, ""));
  const sellPct = Number(p.tp_sell_pct) || 100;
  const hasTP = Number(p.tp_price) > 0;

  const text = `
🎯 <b>TAKE PROFIT</b> · $${sym}
${note ? "\n" + note + "\n" : ""}
Entry <b>${price(p.entry_price)}</b>
Now   <b>${price(l.price)}</b> · <b>${fmtX(m.x)}</b>

${tpLine(p)}

Choose target:
`.trim();

  const tick = n => (sellPct === n ? "✓ " : "");

  const keyboard = [
    [
      { text: "2X", callback_data: `tpx:${p.id}:2` },
      { text: "3X", callback_data: `tpx:${p.id}:3` },
      { text: "5X", callback_data: `tpx:${p.id}:5` },
      { text: "10X", callback_data: `tpx:${p.id}:10` }
    ],
    [
      { text: "CUSTOM X", callback_data: `tpc:${p.id}:x` },
      { text: "PRICE", callback_data: `tpc:${p.id}:p` },
      { text: "MCAP", callback_data: `tpc:${p.id}:m` }
    ],
    [
      { text: `${tick(25)}25%`, callback_data: `tppct:${p.id}:25` },
      { text: `${tick(50)}50%`, callback_data: `tppct:${p.id}:50` },
      { text: `${tick(75)}75%`, callback_data: `tppct:${p.id}:75` },
      { text: `${tick(100)}100%`, callback_data: `tppct:${p.id}:100` }
    ]
  ];
  if (hasTP) keyboard.push([{ text: "❌ REMOVE TP", callback_data: `tprm:${p.id}` }]);
  keyboard.push([{ text: "← Back", callback_data: `pos:${p.id}` }]);

  return sendOrEdit(env, chatId, messageId, text, keyboard);
}

// mode: "x" (multiple of entry), "p" (USD price), "m" (market cap)
async function setTP(env, chatId, userId, positionId, mode, value, messageId = null) {
  const p = await env.DB
    .prepare(`SELECT * FROM positions WHERE id = ? AND user_id = ?`)
    .bind(positionId, userId)
    .first();
  if (!p) return;

  let market;
  try {
    market = await getTokenData(p.chain, p.ca, { fresh: true });
  } catch {
    return sendMessage(env, chatId, "❌ Market data unavailable right now. Try again.", [
      [{ text: "← Back", callback_data: `tp:${positionId}` }]
    ]);
  }
  if (!validNumber(market.price)) {
    return sendMessage(env, chatId, "❌ No usable market price right now.", [
      [{ text: "← Back", callback_data: `tp:${positionId}` }]
    ]);
  }

  const curPrice = Number(market.price);
  const ratio = ratioFromMarket(market) || (Number(p.mcap_ratio) > 0 ? Number(p.mcap_ratio) : null);
  let target;

  if (mode === "x") {
    target = Number(p.entry_price) * Number(value);
  } else if (mode === "p") {
    target = Number(value);
  } else if (mode === "m") {
    if (!ratio) {
      return sendMessage(env, chatId, "❌ Market cap is not available for this token. Use X or price.", [
        [{ text: "← Back", callback_data: `tp:${positionId}` }]
      ]);
    }
    target = Number(value) / ratio;
  }

  if (!Number.isFinite(target) || target <= 0) {
    return sendMessage(env, chatId, "❌ Invalid target.", [
      [{ text: "← Back", callback_data: `tp:${positionId}` }]
    ]);
  }

  if (target <= curPrice) {
    return sendMessage(
      env,
      chatId,
      `❌ TP must be above the current price (<b>${price(curPrice)}</b>).`,
      [[{ text: "← Back", callback_data: `tp:${positionId}` }]]
    );
  }

  const now = Date.now();
  await env.DB
    .prepare(`
      UPDATE positions
      SET tp_price = ?, tp_triggered_at = NULL, price_source = ?,
          mcap_ratio = COALESCE(?, mcap_ratio), current_price = ?, current_mcap = ?,
          last_checked_at = NULL, updated_at = ?
      WHERE id = ? AND user_id = ?
    `)
    .bind(
      target,
      hintFromMarket(market),
      ratio,
      curPrice,
      validNumber(market.mcap) ? Number(market.mcap) : null,
      now,
      positionId,
      userId
    )
    .run();

  await clearSession(env, userId);
  return showTPMenu(env, chatId, userId, positionId, messageId, "✅ <b>TP armed</b>");
}

async function rearmTP(env, positionId, tpPrice) {
  try {
    await env.DB
      .prepare(`
        UPDATE positions SET tp_price = ?, tp_triggered_at = NULL
        WHERE id = ? AND tp_price IS NULL
      `)
      .bind(tpPrice, positionId)
      .run();
  } catch (error) {
    console.log("TP REARM ERROR", String(error?.message || error));
  }
}

// Fires a TP exactly once. The atomic claim (tp_price -> NULL where it
// still equals the value we saw) means only one invocation can win.
async function executeTP(env, positionId, expectedTp, chatId, market) {
  const now = Date.now();

  const claim = await env.DB
    .prepare(`
      UPDATE positions
      SET tp_price = NULL, tp_triggered_at = ?, updated_at = ?
      WHERE id = ? AND tp_price IS NOT NULL AND tp_price = ?
    `)
    .bind(now, now, positionId, expectedTp)
    .run();

  if (!claim?.meta?.changes) return false;

  let closed = false;
  try {
    const p = await env.DB
      .prepare(`SELECT * FROM positions WHERE id = ?`)
      .bind(positionId)
      .first();
    if (!p) return false;

    const pct = Math.min(100, Math.max(1, Number(p.tp_sell_pct) || 100));

    const result = await closePaper(env, {
      userId: p.user_id,
      position: p,
      sellPercent: pct,
      market,
      trigger: "TP"
    });

    if (!result.ok) {
      await rearmTP(env, positionId, expectedTp);
      return false;
    }

    closed = true;

    await sendTradeCard(
      env,
      chatId,
      result.full
        ? "🎯 <b>TAKE PROFIT HIT</b>"
        : `🎯 <b>TAKE PROFIT HIT · ${pct}%</b>`,
      result.card,
      [
        [{ text: "📊 POSITIONS", callback_data: "positions" }],
        [
          { text: "📜 HISTORY", callback_data: "history" },
          { text: "🏠 HOME", callback_data: "home" }
        ]
      ]
    );
    return true;
  } catch (error) {
    console.log("TP EXECUTE ERROR", String(error?.message || error));
    if (!closed) await rearmTP(env, positionId, expectedTp);
    return closed;
  }
}

// ============================================================
// TP MONITOR (Cloudflare Cron, ~every minute)
// Designed for the free plan: <= 50 subrequests, tiny CPU.
//  - one D1 read of armed TPs, oldest-checked first
//  - dedupe by token, 1 light request per token (stored source/pair)
//  - the full engine is used only to CONFIRM a hit before selling
//  - unconfirmed / over-budget hits simply wait for the next run
// ============================================================

async function runTPMonitor(env) {
  const budget = { left: 42 };

  let rows;
  try {
    const res = await env.DB
      .prepare(`
        SELECT p.id, p.user_id, p.chain, p.ca, p.symbol, p.tp_price,
               p.price_source, p.mcap_ratio, u.telegram_id
        FROM positions p
        JOIN users u ON u.id = p.user_id
        WHERE p.tp_price IS NOT NULL AND p.tp_price > 0 AND p.quantity > 0
        ORDER BY COALESCE(p.last_checked_at, 0) ASC
        LIMIT 40
      `)
      .all();
    rows = res.results || [];
  } catch (error) {
    const msg = String(error?.message || error);
    if (/no such (column|table)/i.test(msg)) {
      await ensurePaperTraderSchema(env);
      return;
    }
    throw error;
  }

  if (!rows.length) return;

  const groups = new Map();
  for (const r of rows) {
    const key = `${r.chain}:${r.ca}`;
    if (!groups.has(key)) groups.set(key, { key, chain: r.chain, ca: r.ca, rows: [] });
    groups.get(key).rows.push(r);
  }

  const list = [...groups.values()];
  const checked = new Set();
  const hits = [];
  const heavy = [];

  // 1) light checks, 6 tokens in parallel
  for (let i = 0; i < list.length; i += 6) {
    if (budget.left < 16) break;
    const slice = list.slice(i, i + 6).slice(0, budget.left - 14);
    budget.left -= slice.length;

    const outcomes = await Promise.all(slice.map(async g => {
      const hint = g.rows.find(r => r.price_source)?.price_source;
      if (!hint) return { g, q: null };
      try {
        return { g, q: await quickPrice(g.chain, g.ca, hint, true) };
      } catch (error) {
        console.log("TP QUICK ERROR", g.key, String(error?.message || error));
        return { g, q: null };
      }
    }));

    for (const { g, q } of outcomes) {
      if (!q || !validNumber(q.price)) {
        heavy.push(g);
        continue;
      }
      for (const r of g.rows) {
        checked.add(r.id);
        if (q.price >= Number(r.tp_price)) hits.push({ row: r, group: g });
      }
    }
  }

  // 2) confirm hits with the real engine, then execute
  const confirmed = new Map();
  for (const h of hits) {
    let market = confirmed.get(h.group.key);
    if (market === undefined) {
      if (budget.left < 26) continue;
      budget.left -= 14;
      try {
        market = await getTokenData(h.group.chain, h.group.ca, { fresh: true });
      } catch {
        market = null;
      }
      confirmed.set(h.group.key, market);
    }
    if (!market || !validNumber(market.price)) continue;
    if (Number(market.price) < Number(h.row.tp_price)) continue;
    if (budget.left < 12) break;
    budget.left -= 10;
    await executeTP(env, h.row.id, Number(h.row.tp_price), h.row.telegram_id, market);
  }

  // 3) at most one token per run through the full engine (no stored source)
  if (heavy.length && budget.left >= 26) {
    const g = heavy[0];
    budget.left -= 14;
    try {
      const market = await getTokenData(g.chain, g.ca, { fresh: true });
      if (validNumber(market.price)) {
        for (const r of g.rows) {
          checked.add(r.id);
          if (Number(market.price) >= Number(r.tp_price) && budget.left >= 12) {
            budget.left -= 10;
            await executeTP(env, r.id, Number(r.tp_price), r.telegram_id, market);
          }
        }
      }
    } catch (error) {
      console.log("TP HEAVY ERROR", g.key, String(error?.message || error));
    }
  }

  if (checked.size) {
    const ids = [...checked];
    await env.DB
      .prepare(`UPDATE positions SET last_checked_at = ? WHERE id IN (${ids.map(() => "?").join(",")})`)
      .bind(Date.now(), ...ids)
      .run();
  }
}

// ============================================================
// EXTRA CALLBACK + MESSAGE ROUTES (refresh / TP)
// ============================================================

async function handleExtraCallbacks(env, chatId, user, data, messageId) {
  if (data.startsWith("posr:")) {
    await showPosition(env, chatId, user.id, Number(data.split(":")[1]), messageId, true);
    return true;
  }

  if (data === "posall") {
    await clearSession(env, user.id);
    await showPositions(env, chatId, user.id, messageId);
    return true;
  }

  if (data.startsWith("tp:")) {
    await clearSession(env, user.id);
    await showTPMenu(env, chatId, user.id, Number(data.split(":")[1]), messageId);
    return true;
  }

  if (data.startsWith("tpx:")) {
    const [, id, x] = data.split(":");
    await setTP(env, chatId, user.id, Number(id), "x", Number(x), messageId);
    return true;
  }

  if (data.startsWith("tpc:")) {
    const [, id, kind] = data.split(":");
    const positionId = Number(id);
    const states = { x: "tp_cx", p: "tp_cp", m: "tp_cm" };
    const prompts = {
      x: "🎯 Send your target multiple.\n\nExample: <code>7.5</code> or <code>25x</code>",
      p: "🎯 Send your target price in USD.\n\nExample: <code>0.0042</code>",
      m: "🎯 Send your target market cap.\n\nExample: <code>2.5m</code> or <code>750k</code>"
    };
    if (!states[kind]) return true;
    await setSession(env, user.id, states[kind], { positionId });
    await sendMessage(env, chatId, prompts[kind], [
      [{ text: "← Back", callback_data: `tp:${positionId}` }]
    ]);
    return true;
  }

  if (data.startsWith("tppct:")) {
    const [, id, pct] = data.split(":");
    const n = Number(pct);
    if ([25, 50, 75, 100].includes(n)) {
      await env.DB
        .prepare(`UPDATE positions SET tp_sell_pct = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
        .bind(n, Date.now(), Number(id), user.id)
        .run();
    }
    await showTPMenu(env, chatId, user.id, Number(id), messageId);
    return true;
  }

  if (data.startsWith("tprm:")) {
    const id = Number(data.split(":")[1]);
    await env.DB
      .prepare(`UPDATE positions SET tp_price = NULL, updated_at = ? WHERE id = ? AND user_id = ?`)
      .bind(Date.now(), id, user.id)
      .run();
    await showTPMenu(env, chatId, user.id, id, messageId, "🗑 <b>TP removed</b>");
    return true;
  }

  return false;
}

async function handleExtraMessage(env, chatId, user, session, data, text) {
  const state = session?.state;
  if (state !== "tp_cx" && state !== "tp_cp" && state !== "tp_cm") return false;

  const positionId = Number(data.positionId);
  const n = parseSuffixNumber(text);

  if (!n) {
    await sendMessage(env, chatId, "❌ Send a valid number.", [
      [{ text: "← Back", callback_data: `tp:${positionId}` }]
    ]);
    return true;
  }

  const mode = state === "tp_cx" ? "x" : state === "tp_cp" ? "p" : "m";
  await setTP(env, chatId, user.id, positionId, mode, n, null);
  return true;
}

// ============================================================
// CARD PREVIEW ROUTE  (GET /card?key=SETUP_KEY&x=3.5&fmt=png|html)
// x=all  -> gallery of every tier (open in a phone browser)
// ============================================================

function sampleCard(x, trigger = "TP") {
  const cost = 100;
  const entry = 0.000000412;
  return {
    symbol: "DEGEN",
    name: "Degen Terminal Demo",
    chainKey: "solana",
    chainName: "Solana",
    logo: null,
    entryPrice: entry,
    entryMcap: 412000,
    exitPrice: entry * x,
    exitMcap: 412000 * x,
    costBasis: cost,
    exitValue: cost * x,
    pnl: cost * x - cost,
    roi: (x - 1) * 100,
    x,
    ts: Date.now(),
    trigger,
    sellPercent: 100,
    closed: true
  };
}

async function cardPreview(request, env) {
  const url = new URL(request.url);
  if (!env.SETUP_KEY || url.searchParams.get("key") !== env.SETUP_KEY) {
    return new Response("Unauthorized", { status: 401 });
  }

  const fmt = (url.searchParams.get("fmt") || "html").toLowerCase();
  const xParam = url.searchParams.get("x") || "3.5";

  if (xParam === "all") {
    const frames = TIERS.map(t => {
      const x = t.minX === 0 ? 0.1 : t.minX * 1.4;
      const html = buildCardHTML(env, sampleCard(x), { webfont: true })
        .replaceAll("&", "&amp;")
        .replaceAll('"', "&quot;");
      return `<div style="width:270px;height:338px;overflow:hidden;border-radius:10px"><iframe srcdoc="${html}" style="width:1080px;height:1350px;border:0;transform:scale(.25);transform-origin:0 0"></iframe></div>`;
    }).join("");
    return new Response(
      `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;background:#111;display:flex;flex-wrap:wrap;gap:10px;padding:10px">${frames}</body>`,
      { headers: { "content-type": "text/html; charset=utf-8" } }
    );
  }

  const x = Number(xParam);
  if (!Number.isFinite(x) || x < 0) {
    return new Response("Bad x", { status: 400 });
  }
  const card = sampleCard(x);

  if (fmt === "png") {
    try {
      const bytes = await renderCardPNG(env, card);
      return new Response(bytes, { headers: { "content-type": "image/png" } });
    } catch (error) {
      return Response.json({ ok: false, error: String(error?.message || error) }, { status: 500 });
    }
  }

  return new Response(buildCardHTML(env, card, { webfont: true }), {
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}

// ============================================================
// WORKER ENTRY (wraps the original HTTP router + adds cron)
// ============================================================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/card") {
      return cardPreview(request, env);
    }
    return BASE_HANDLER.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      runTPMonitor(env).catch(error => {
        console.log("TP MONITOR ERROR", String(error?.message || error));
      })
    );
  }
};

