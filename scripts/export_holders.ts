import fs from 'fs/promises';

const TOKENS = [
  {
    name: '$applXTZ',
    address: '0xcFD2f5FAF6D92D963238E74321325A90BA67fCA3',
  },
  {
    name: '$applstXTZ',
    address: '0x0008b6C5b44305693bEB4Cd6E1A91b239D2A041E',
  },
];

interface HolderAddress {
  ens_domain_name: string | null;
  hash: string;
  implementations: any[];
  is_contract: boolean;
  is_scam: boolean;
  is_verified: boolean;
  metadata: any | null;
  name: string | null;
  private_tags: any[];
  proxy_type: string | null;
  public_tags: any[];
  reputation: string;
  watchlist_names: any[];
}

interface HolderItem {
  address: HolderAddress;
  token_id: string | null;
  value: string;
}

interface ApiResponse {
  items: HolderItem[];
  next_page_params?: {
    value: string;
    address_hash: string;
    items_count: number;
  } | null;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchAllHolders(tokenAddress: string): Promise<HolderItem[]> {
  const allHolders: HolderItem[] = [];
  let baseUrl = `https://explorer.etherlink.com/api/v2/tokens/${tokenAddress}/holders`;
  let apiUrl = baseUrl;

  console.log(`Fetching holders for ${tokenAddress}...`);

  while (true) {
    const response = await fetch(apiUrl);
    if (!response.ok) {
      console.error(`Error fetching from ${apiUrl}: ${response.status} ${response.statusText}`);
      break;
    }

    const data: ApiResponse = await response.json();
    if (!data.items || data.items.length === 0) {
      break;
    }

    allHolders.push(...data.items);
    process.stdout.write(`\rFetched ${allHolders.length} holders...`);

    if (data.next_page_params) {
      const params = new URLSearchParams({
        value: data.next_page_params.value,
        address_hash: data.next_page_params.address_hash,
        items_count: data.next_page_params.items_count.toString(),
      });
      apiUrl = `${baseUrl}?${params.toString()}`;
    } else {
      break; // No more pages
    }
  }

  console.log(`\nFinished fetching ${allHolders.length} holders for ${tokenAddress}.`);
  return allHolders;
}

function calculateAndPrintMetrics(tokenName: string, holders: HolderItem[]) {
  const totalHoldersCount = holders.length;
  const contractCount = holders.filter((h) => h.address.is_contract).length;

  let totalSupply = 0n;
  holders.forEach((h) => {
    totalSupply += BigInt(h.value);
  });

  const eoaHolders = holders.filter((h) => !h.address.is_contract);

  // Sort by balance descending
  const sortedEoaHolders = [...eoaHolders].sort((a, b) => {
    const bValue = BigInt(b.value);
    const aValue = BigInt(a.value);
    return bValue > aValue ? 1 : bValue < aValue ? -1 : 0;
  });

  const top1PercentCount = Math.max(1, Math.ceil(eoaHolders.length * 0.01));
  const top10PercentCount = Math.max(1, Math.ceil(eoaHolders.length * 0.10));

  let top1PercentSupply = 0n;
  let top10PercentSupply = 0n;

  for (let i = 0; i < eoaHolders.length; i++) {
    const val = BigInt(sortedEoaHolders[i].value);
    if (i < top1PercentCount) {
      top1PercentSupply += val;
    }
    if (i < top10PercentCount) {
      top10PercentSupply += val;
    }
  }

  const calcConcentration = (part: bigint, total: bigint) => {
    if (total === 0n) return "0.00";
    // multiple by 10000 to get percentages with 2 decimal places before division
    const pct = Number((part * 10000n) / total) / 100;
    return pct.toFixed(2);
  };

  console.log(`\nMetrics for ${tokenName}:`);
  console.log(`- Total Holders: ${totalHoldersCount}`);
  console.log(`- Contract Holders: ${contractCount}`);
  console.log(`- Top 1% Concentration (Top ${top1PercentCount} non-contract holders): ${calcConcentration(top1PercentSupply, totalSupply)}% of total supply`);
  console.log(`- Top 10% Concentration (Top ${top10PercentCount} non-contract holders): ${calcConcentration(top10PercentSupply, totalSupply)}% of total supply`);
}

async function exportToCsv(tokenName: string, holders: HolderItem[]) {
  const fileName = `${tokenName.replace('$', '')}_holders.csv`;
  const header = 'address,value,is_contract\n';
  const csvLines = holders.map((h) => `${h.address.hash},${h.value},${h.address.is_contract}`);
  const csvContent = header + csvLines.join('\n');
  await fs.writeFile(fileName, csvContent, 'utf-8');
  console.log(`Exported CSV to ${fileName}`);
}

async function exportToJsonl(tokenName: string, holders: HolderItem[]) {
  const fileName = `${tokenName.replace('$', '')}_holders.jsonl`;
  const jsonlLines = holders.map((h) => JSON.stringify({
    address: h.address.hash,
    value: h.value,
    is_contract: h.address.is_contract,
    address_data: h.address
  }));
  const jsonlContent = jsonlLines.join('\n');
  await fs.writeFile(fileName, jsonlContent, 'utf-8');
  console.log(`Exported JSONL to ${fileName}`);
}

async function main() {
  for (const token of TOKENS) {
    console.log(`\n--- Processing ${token.name} ---`);
    const holders = await fetchAllHolders(token.address);
    if (holders.length > 0) {
      calculateAndPrintMetrics(token.name, holders);
      await exportToCsv(token.name, holders);
      await exportToJsonl(token.name, holders);
    } else {
      console.log(`No holders found for ${token.name}.`);
    }
  }
}

main().catch((error) => {
  console.error("Error in main execution:", error);
  process.exit(1);
});
