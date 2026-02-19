
export {};

const DEFAULT_N = 1000;
const API_URL = "https://api.tzkt.io/v1/blocks";

// Parse command line arguments
const args = process.argv.slice(2);
const nArg = args.find(arg => !isNaN(parseInt(arg)));
const N = nArg ? parseInt(nArg) : DEFAULT_N;

const BATCH_SIZE = 1000;
const DELAY_MS = 100;

interface Producer {
    alias?: string;
    address: string;
}

interface Block {
    level: number;
    producer: Producer;
    lbToggle: boolean;
    timestamp: string;
}

// Function to fetch data from API using Bun's native fetch
async function fetchBlocks(limit: number, maxLevel?: number): Promise<Block[]> {
    let url = `${API_URL}?sort.desc=level&limit=${limit}&select=level,producer,lbToggle,timestamp`;
    if (maxLevel !== undefined) {
        url += `&level.lt=${maxLevel}`;
    }

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        return data as Block[];
    } catch (error) {
        console.error("Fetch error:", error);
        throw error;
    }
}

async function main() {
    try {
        let remaining = N;
        let lastLevel: number | undefined;
        let blocks: Block[] = [];

        console.log(`Checking the last ${N} blocks...`);

        while (remaining > 0) {
            const batchSize = Math.min(remaining, BATCH_SIZE);
            const batch = await fetchBlocks(batchSize, lastLevel);
            
            if (batch.length === 0) break;

            blocks = blocks.concat(batch);
            lastLevel = batch[batch.length - 1].level;
            remaining -= batch.length;
            
            process.stdout.write(`\rFetched ${blocks.length} / ${N} blocks...`);
            
            if (remaining > 0) {
                await new Promise(resolve => setTimeout(resolve, DELAY_MS));
            }
        }
        console.log(""); // New line after progress
        
        // Filter for blocks that have an explicit vote (true or false)
        // Some blocks might not have lbToggle set if it's null/undefined, though API usually returns it.
        const votedBlocks = blocks.filter((b) => b.lbToggle !== null && b.lbToggle !== undefined);
        
        console.log(`Found ${votedBlocks.length} blocks with 'lbToggle' votes in the last ${N} blocks.`);

        // Aggregage unique bakers
        const bakerMap = new Map<string, {
            alias?: string;
            address: string;
            offCount: number;
            onCount: number;
            total: number;
            lastLevel: number;
            lastVote?: "ON" | "OFF";
            lastVoteDate?: string;
        }>();

        votedBlocks.forEach((b) => {
            const baker = b.producer;
            if (baker && baker.address) {
                if (!bakerMap.has(baker.address)) {
                    bakerMap.set(baker.address, {
                        alias: baker.alias,
                        address: baker.address,
                        offCount: 0,
                        onCount: 0,
                        total: 0,
                        lastLevel: b.level,
                        // Since we iterate newest -> oldest (desc sort), the first time we see a baker is their latest vote
                        lastVote: b.lbToggle ? "ON" : "OFF",
                        lastVoteDate: b.timestamp
                    });
                }
                const entry = bakerMap.get(baker.address)!;
                
                if (b.lbToggle === true) {
                    entry.onCount++;
                } else if (b.lbToggle === false) {
                    entry.offCount++;
                }
                entry.total++;

                // update last level if we found a more recent one (though we sort desc, so usually first one is highest)
                if (b.level > entry.lastLevel) {
                    entry.lastLevel = b.level;
                    // In case blocks weren't sorted perfectly, update lastVote
                    entry.lastVote = b.lbToggle ? "ON" : "OFF";
                    entry.lastVoteDate = b.timestamp;
                }
            }
        });

        if (bakerMap.size === 0) {
            console.log("No bakers found voting on LB toggle.");
            return;
        }

        const bakers = Array.from(bakerMap.values());
        
        // OFF VOTES
        const offBakers = bakers.filter(b => b.offCount > 0).sort((a, b) => b.offCount - a.offCount);
        console.log("\nBakers voting 'OFF':");
        console.log("────────────────────────────────────────────────────────────────");
        console.log("Count | Baker Name (Address)");
        console.log("────────────────────────────────────────────────────────────────");
        if (offBakers.length === 0) {
            console.log("No 'OFF' votes found.");
        } else {
            offBakers.forEach(b => {
                 const name = b.alias ? `${b.alias} (${b.address})` : b.address;
                 console.log(`${b.offCount.toString().padEnd(5)} | ${name}`);
            });
        }
        console.log("────────────────────────────────────────────────────────────────");

        // ON VOTES
        const onBakers = bakers.filter(b => b.onCount > 0).sort((a, b) => b.onCount - a.onCount);
        console.log("\nBakers voting 'ON':");
        console.log("────────────────────────────────────────────────────────────────");
        console.log("Count | Baker Name (Address)");
        console.log("────────────────────────────────────────────────────────────────");
        if (onBakers.length === 0) {
            console.log("No 'ON' votes found.");
        } else {
            onBakers.forEach(b => {
                 const name = b.alias ? `${b.alias} (${b.address})` : b.address;
                 console.log(`${b.onCount.toString().padEnd(5)} | ${name}`);
            });
        }
        console.log("────────────────────────────────────────────────────────────────");

        // MIXED VOTES (Bakers who voted both ON and OFF)
        const mixedBakers = bakers.filter(b => b.offCount > 0 && b.onCount > 0).sort((a, b) => b.total - a.total);
        if (mixedBakers.length > 0) {
            console.log("\n⚠️  Bakers with MIXED votes (both ON and OFF):");
            console.log("───────────────────────────────────────────────────────────────────────────────────────────");
            console.log("OFF   | ON    | Total | Last Vote | Date       | Baker Name (Address)");
            console.log("───────────────────────────────────────────────────────────────────────────────────────────");
            mixedBakers.forEach(b => {
                 const name = b.alias ? `${b.alias} (${b.address})` : b.address;
                 const lastVote = b.lastVote || "?";
                 const dateCmd = b.lastVoteDate ? b.lastVoteDate.split('T')[0] : "N/A";
                 console.log(`${b.offCount.toString().padEnd(5)} | ${b.onCount.toString().padEnd(5)} | ${b.total.toString().padEnd(5)} | ${lastVote.padEnd(9)} | ${dateCmd.padEnd(10)} | ${name}`);
            });
            console.log("───────────────────────────────────────────────────────────────────────────────────────────");
        } else {
             console.log("\nNo bakers found with mixed votes in this period.");
        }

    } catch (error: any) {
        console.error("Error fetching or processing blocks:", error.message || error);
    }
}

main();
