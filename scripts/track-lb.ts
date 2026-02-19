const WS_URL = "wss://api.tzkt.io/v1/ws";
const TERMINATOR = String.fromCharCode(30);
const THRESHOLD = 1_000_000_000;

// State for TUI
let isConnected = false;
let latestBlock: any = null;
const blockHistory: any[] = [];
const HISTORY_LIMIT = 10;

// Configuration: Control which blocks are logged based on the vote.
// Options: "ALL", "ON_OFF", "OFF_ONLY"
const DISPLAY_MODE: "ALL" | "ON_OFF" | "OFF_ONLY" = "ALL" as "ALL" | "ON_OFF" | "OFF_ONLY";

const EXPORT_OFF_VOTES = true;
const LOG_FILE = "off_votes.jsonl";
const LEGACY_LOG_FILE = "off_votes.json";

const fs = require('fs');
let lastLoggedLevel = -1;

// Load existing logs on startup to initialize state
if (EXPORT_OFF_VOTES) {
    try {
        // Migration: If legacy JSON file exists and new JSONL doesn't
        if (fs.existsSync(LEGACY_LOG_FILE) && !fs.existsSync(LOG_FILE)) {
             try {
                 const content = fs.readFileSync(LEGACY_LOG_FILE, 'utf8');
                 if (content.trim()) {
                     const json = JSON.parse(content);
                     const jsonl = json.map((entry: any) => JSON.stringify(entry)).join('\n') + '\n';
                     fs.writeFileSync(LOG_FILE, jsonl);
                     // console.log("Migrated legacy log file to JSONL format.");
                 }
             } catch (e) {
                 console.error("Error migrating legacy log file:", e);
             }
        }

        if (fs.existsSync(LOG_FILE)) {
            const content = fs.readFileSync(LOG_FILE, 'utf8');
            const lines = content.trim().split('\n');
            if (lines.length > 0) {
                 // Get last non-empty line
                 const lastLine = lines[lines.length - 1];
                 try {
                    const lastEntry = JSON.parse(lastLine);
                    lastLoggedLevel = lastEntry.level;
                 } catch (e) { 
                     // subtle error logging if needed
                 }
            }
        }
    } catch (e) {
        console.error("Error loading log file:", e);
    }
}

const socket = new WebSocket(WS_URL);

/**
 * Resets the terminal screen and prints the dashboard.
 */
function renderDashboard() {
    // Clear screen and move cursor to (0,0)
    process.stdout.write("\x1b[2J\x1b[0f");

    console.log("┌──────────────────────────────────────────────────────────────┐");
    console.log("│             🦁 Tezos Liquidity Baking Tracker                │");
    console.log("│             " + (isConnected ? "🟢 Connected" : "🔴 Disconnected") + "                                     │");
    console.log("└──────────────────────────────────────────────────────────────┘");

    if (!latestBlock) {
        console.log("\n⏳ Waiting for the first block...");
        return;
    }

    const { level, ema, pct, progress, vote, baker } = latestBlock;

    console.log(`\n📊  Current EMA Status`);
    console.log("────────────────────────────────────────────────────────────────");
    // Always show current block height, especially useful when filtering
    console.log(`Current Block:        ${level.toLocaleString()}`);
    console.log(`Current EMA:          ${ema.toLocaleString()}`);
    console.log(`% of Max (2B):        ${pct.toFixed(1)}%`);
    console.log(`Deactivation Prog:    ${progress.toFixed(2)}% (Threshold: 50.0%)`);
    
    // Status Bar
    let status = "✅ SUBSIDIES ACTIVE";
    let color = "\x1b[32m"; // Green
    if (progress >= 100) {
        status = "🚨 SUBSIDY DISABLED";
        color = "\x1b[31m"; // Red
    } else if (progress > 80) {
        status = "⚠️  CLOSE TO DEACTIVATION";
        color = "\x1b[33m"; // Yellow
    }
    console.log(`Status:               ${color}${status}\x1b[0m`); 
    console.log("────────────────────────────────────────────────────────────────");

    let historyHeader = `Recent Blocks (Last ${HISTORY_LIMIT})`;
    if (DISPLAY_MODE !== "ALL") {
        historyHeader += ` [Filter: ${DISPLAY_MODE}]`;
    }

    console.log(`\n📜  ${historyHeader}`);
    console.log("Level       | Vote | Baker                                      ");
    console.log("------------|------|--------------------------------------------");

    // Print history (newest first)
    // History is stored oldest -> newest. We reverse for display.
    [...blockHistory].reverse().forEach(b => {
                
        let vColorOutput = "\x1b[37m"; // White default
        if (b.vote === "ON") vColorOutput = "\x1b[32m"; // Green
        if (b.vote === "OFF") vColorOutput = "\x1b[31m"; // Red

        const vStr = `${vColorOutput}${b.vote.padEnd(4)}\x1b[0m`;
        console.log(`${b.level.toLocaleString().padEnd(11)} | ${vStr} | ${b.baker}`);
    });
}

socket.onopen = () => {
  isConnected = true;
  const handshake = { protocol: "json", version: 1 };
  socket.send(JSON.stringify(handshake) + TERMINATOR);
  renderDashboard();
};

socket.onclose = () => {
    isConnected = false;
    renderDashboard();
};

socket.onmessage = (event) => {
  const messages = event.data.toString().split(TERMINATOR);

  for (const rawMessage of messages) {
    if (!rawMessage) continue;

    try {
      const msg = JSON.parse(rawMessage);

      // Handshake response
      if (Object.keys(msg).length === 0) {
        const subscribeMsg = {
          type: 1,
          target: "SubscribeToBlocks", 
          arguments: []
        };
        socket.send(JSON.stringify(subscribeMsg) + TERMINATOR);
        continue;
      }
      
      if (msg.type === 6) continue; // Ping

      if (msg.type === 1 && msg.target === "blocks") {
        if (msg.arguments && msg.arguments[0]) {
            const update = msg.arguments[0];
            
            if (update.data && Array.isArray(update.data) && update.data.length > 0) {
                const block = update.data[0];
                const ema = block.lbToggleEma;
                
                if (ema === undefined) continue;

                const level = block.level;
                
                let vote = "PASS";
                if (block.lbToggleVote) {
                    vote = block.lbToggleVote;
                } else if (block.lbToggle === true) {
                    vote = "ON";
                } else if (block.lbToggle === false) {
                    vote = "OFF";
                }
                vote = vote.toUpperCase();

                
                const shouldTrack = 
                    DISPLAY_MODE == "ALL" ||
                    (DISPLAY_MODE == "ON_OFF" && (vote === "ON" || vote === "OFF")) ||
                    (DISPLAY_MODE == "OFF_ONLY" && vote === "OFF");


                const baker = block.proposer;
                const bakerName = baker.alias || baker.address;

                const MAX_EMA = 2_000_000_000;
                const currentPct = (ema / MAX_EMA) * 100;
                const deactivationProgress = (ema / THRESHOLD) * 100;

                const blockData = {
                    level,
                    ema,
                    pct: currentPct,
                    progress: deactivationProgress,
                    vote,
                    baker: bakerName
                };

                // Always update latest block stats (EMA etc)
                latestBlock = blockData;

                // But only add to history if it matches filter
                if (shouldTrack) {
                    blockHistory.push(blockData);
                    if (blockHistory.length > HISTORY_LIMIT) {
                        blockHistory.shift();
                    }
                }

                // Log OFF votes to file if enabled
                if (EXPORT_OFF_VOTES && vote === "OFF") {
                    try {
                        // Check if block is already logged (using in-memory tracker)
                        if (level > lastLoggedLevel) {
                            const entry = {
                                level,
                                vote,
                                baker: bakerName,
                                ema,
                                timestamp: new Date().toISOString()
                            };
                            
                            fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n");
                            lastLoggedLevel = level;
                        }
                    } catch (err) {
                        // silently fail to maintain TUI
                    }
                }

                // Render!
                renderDashboard();
            } 
        }
      }
    } catch (error: any) {
      // console.error("Error parsing message:", error.message);
    }
  }
};