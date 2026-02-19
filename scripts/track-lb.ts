const WS_URL = "wss://api.tzkt.io/v1/ws";
const TERMINATOR = String.fromCharCode(30);
const THRESHOLD = 1_000_000_000;

// Configuration: Control which blocks are logged based on the vote.
// Options: "ALL", "ON_OFF", "OFF_ONLY"
const DISPLAY_MODE: "ALL" | "ON_OFF" | "OFF_ONLY" = "OFF_ONLY";

const socket = new WebSocket(WS_URL);

console.log("--- Tezos Liquidity Baking Tracker ---");
console.log("Tracking via WebSocket:", WS_URL);
console.log(`Deactivation Threshold: ${THRESHOLD.toLocaleString()}`);
console.log(`Display Mode: ${DISPLAY_MODE}`);

socket.onopen = () => {
  console.log("✅ Connected to TzKT WebSocket");
  const handshake = { protocol: "json", version: 1 };
  socket.send(JSON.stringify(handshake) + TERMINATOR);
};

socket.onmessage = (event) => {
  const messages = event.data.toString().split(TERMINATOR);

  for (const rawMessage of messages) {
    if (!rawMessage) continue;
    
    // console.log("Received:", rawMessage); // Debug: see everything

    try {
      const msg = JSON.parse(rawMessage);

      // Handshake response is empty object {}
      if (Object.keys(msg).length === 0) {
        console.log("✅ Handshake successful. Subscribing to blocks...");
        console.log("⏳ Waiting for next block (approx 6s)...");
        const subscribeMsg = {
          type: 1,
          target: "SubscribeToBlocks", 
          arguments: []
        };
        socket.send(JSON.stringify(subscribeMsg) + TERMINATOR);
        continue;
      }
      
      // Keep alive / Ping (type 6)
      if (msg.type === 6) {
          continue;
      }

      if (msg.type === 1 && msg.target === "blocks") {
        if (msg.arguments && msg.arguments[0]) {
            const update = msg.arguments[0];
            
            // Only process if we have data (type 1 = added)
            // blocks channel 'data' is an array of blocks
            if (update.data && Array.isArray(update.data) && update.data.length > 0) {
                const block = update.data[0];
                
                const ema = block.lbToggleEma;
                const level = block.level;
                
                // If ema is unavailable, we can't track.
                if (ema === undefined) {
                    // console.warn("Block received without lbToggleEma");
                    continue;
                }

                // 'lbToggleVote' is string (on/off/pass) in some contexts.
                // 'lbToggle' boolean appears to map to:
                // true  -> ON
                // false -> OFF
                // undefined -> PASS
                
                let vote = "PASS";
                if (block.lbToggleVote) {
                    vote = block.lbToggleVote;
                } else if (block.lbToggle === true) {
                    vote = "ON";
                } else if (block.lbToggle === false) {
                    vote = "OFF";
                }
                
                // Baker info (proposer)
                const baker = block.proposer;
                const bakerName = baker.alias || baker.address;

                // TzKT Display Logic:
                // Max EMA is 2,000,000,000 (2 * Threshold).
                // Percentages are relative to Max EMA.
                // Threshold is 50% of Max EMA.
                const MAX_EMA = 2_000_000_000;
                const currentPct = (ema / MAX_EMA) * 100;
                
                // Progress to deactivation is how close we are to Threshold (1B)
                // (ema / THRESHOLD) * 100
                const deactivationProgress = (ema / THRESHOLD) * 100;
                
                // Filter output based on DISPLAY_MODE
                const shouldLog = 
                    DISPLAY_MODE === "ALL" ||
                    (DISPLAY_MODE === "ON_OFF" && (vote === "ON" || vote === "OFF")) ||
                    (DISPLAY_MODE === "OFF_ONLY" && vote === "OFF");

                if (!shouldLog) {
                    return; // Skip logging for this block
                }

                console.log(`\n📦 Block: ${level.toLocaleString()}`);
                console.log(`   Baker: ${bakerName}`);
                console.log(`   Vote:  ${vote.toUpperCase()}`); 
                console.log(`   EMA:   ${ema.toLocaleString()} (${currentPct.toFixed(1)}%)`);
                console.log(`   Deactivation Progress: ${deactivationProgress.toFixed(2)}% (Threshold: 50.0%)`);
                
                if (deactivationProgress >= 100) {
                    console.log("🚨 SUBSIDY DISABLED (EMA >= Threshold)");
                } else if (deactivationProgress > 80) {
                    console.log("⚠️  CLOSE TO DEACTIVATION! (>80%)");
                } else if (deactivationProgress > 50) {
                     console.log("⚠️  Sentiment leaning 'OFF'");
                } else {
                    console.log("✅ Subsidies active.");
                }
            } 
        }
      }
    } catch (e) {
      console.error("Error parsing message:", e);
    }
  }
};

socket.onerror = (error) => console.error("WebSocket Error:", error);
socket.onclose = () => console.log("Connection closed.");