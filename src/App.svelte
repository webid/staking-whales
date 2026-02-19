<script>
  /**
   * @typedef {Object} Account
   * @property {string} address
   * @property {number} balance
   * @property {number} stakedBalance
   * @property {number} unstakedBalance
   * @property {{ active: boolean, alias?: string, address?: string } | null} [delegate]
   */

  let threshold = 5000;
  /** @type {Account[]} */
  let accounts = [];
  let loading = false;
  /** @type {string | null} */
  let error = null;
  let progress = "";

  const TZKT_API = "https://api.tzkt.io/v1/accounts";

  async function fetchAccounts() {
    loading = true;
    error = null;
    accounts = [];
    progress = "Starting fetch...";
    
    try {
      let offset = 0;
      const limit = 1000;
      let keepFetching = true;
      /** @type {Account[]} */
      let allAccounts = [];

      // Convert XTZ threshold to mutez (1 XTZ = 1,000,000 mutez)
      const balanceMutez = threshold * 1000000;

      while (keepFetching) {
        progress = `Fetching records... (Current count: ${allAccounts.length})`;
        
        const response = await fetch(
          `${TZKT_API}?balance.ge=${balanceMutez}&limit=${limit}&offset=${offset}`
        );

        if (!response.ok) {
          throw new Error(`API Error: ${response.statusText}`);
        }

        const data = await response.json();
        
        if (data.length < limit) {
          keepFetching = false;
        }

        allAccounts = [...allAccounts, ...data];
        offset += limit;
      }

      // Filter: only tz-addresses with active delegate, sorted by balance desc
      accounts = allAccounts
        .filter(acc => acc.address.startsWith('tz') && acc.delegate && acc.delegate.active === true)
        .sort((a, b) => b.balance - a.balance);
      progress = `Finished! Found ${accounts.length} accounts.`;
    } catch (err) {
      if (err instanceof Error) {
        error = err.message;
      } else {
        error = "An unknown error occurred";
      }
      progress = "Error occurred.";
    } finally {
      loading = false;
    }
  }

  function downloadCSV() {
    if (accounts.length === 0) return;

    const headers = ["Address", "Balance (XTZ)", "Delegate"];
    const rows = accounts.map(acc => [
      acc.address,
      (acc.balance / 1000000).toFixed(6),
      acc.delegate ? (acc.delegate.alias || acc.delegate.address || '') : ''
    ]);

    const csvString = [headers, ...rows].map(e => e.join(",")).join("\n");
    const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `tezos_sardines_${threshold}xtz.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  /**
   * @param {number} mutez
   * @returns {string}
   */
  function formatXTZ(mutez) {
    if (isNaN(mutez)) return "NaN";
    return (mutez / 1000000).toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  }

  /**
   * @param {string} addr
   * @returns {string}
   */
  function shortenAddr(addr) {
    if (!addr || addr.length <= 12) return addr;
    return addr.slice(0, 5) + '…' + addr.slice(-5);
  }
</script>

<main>
  <h1>Tezos Sardines</h1>
  
  <div class="controls">
    <label>
      Minimum Balance (XTZ):
      <input type="number" bind:value={threshold} min="0" />
    </label>
    <button on:click={fetchAccounts} disabled={loading}>
      {loading ? "Searching..." : "Search"}
    </button>
    <button on:click={downloadCSV} disabled={accounts.length === 0 || loading}>
      Export CSV
    </button>
  </div>

  {#if error}
    <p class="error">{error}</p>
  {/if}

  {#if progress}
    <p class="status">{progress}</p>
  {/if}
  
  {#if accounts.length > 0}
    <div class="results-header">
      <p>Total wallets found: <strong>{accounts.length}</strong></p>
    </div>

    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Address</th>
            <th class="hide-mobile">Delegate</th>
            <th>Balance</th>
            <th>Staked</th>
            <th class="hide-mobile">Unstaked</th>
          </tr>
        </thead>
        <tbody>
          {#each accounts as acc}
            <tr>
              <td class="addr">
                <a href={`https://tzkt.io/${acc.address}`} target="_blank" rel="noreferrer" title={acc.address}>
                  {shortenAddr(acc.address)}
                </a>
              </td>
              <td class="addr hide-mobile">
                {#if acc.delegate && acc.delegate.address}
                  <a href={`https://tzkt.io/${acc.delegate.address}`} target="_blank" rel="noreferrer" title={acc.delegate.address}>
                    {acc.delegate.alias || shortenAddr(acc.delegate.address)}
                  </a>
                {:else}
                  —
                {/if}
              </td>
              <td>{formatXTZ(acc.balance)}</td>
              <td>{formatXTZ(acc.stakedBalance)}</td>
              <td class="hide-mobile">{formatXTZ(acc.unstakedBalance)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</main>

<style>
  main {
    font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
    max-width: 1200px;
    margin: 0 auto;
    padding: 2rem;
    text-align: center;
    color: #e0e0e0;
  }

  h1 {
    margin-bottom: 2rem;
    font-weight: 300;
    letter-spacing: -0.05rem;
    color: #ffffff;
  }

  .controls {
    display: flex;
    justify-content: center;
    gap: 1rem;
    align-items: center;
    margin-bottom: 2rem;
    flex-wrap: wrap;
    background: #1e1e1e;
    padding: 1.5rem;
    border-radius: 8px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
  }

  label {
    font-size: 0.9rem;
    color: #b0b0b0;
    margin-right: 0.5rem;
  }

  input {
    padding: 0.6rem;
    font-size: 1rem;
    border: 1px solid #333;
    border-radius: 4px;
    width: 150px;
    background-color: #2c2c2c;
    color: #fff;
    outline: none;
    transition: border-color 0.2s;
  }

  input:focus {
    border-color: #4a90e2;
  }

  button {
    padding: 0.6rem 1.2rem;
    font-size: 0.95rem;
    background-color: #333;
    color: #fff;
    border: 1px solid #444;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.2s ease;
    text-transform: uppercase;
    letter-spacing: 0.05rem;
    font-weight: 500;
  }

  button:disabled {
    background-color: #222;
    color: #555;
    border-color: #333;
    cursor: not-allowed;
  }

  button:hover:not(:disabled) {
    background-color: #444;
    border-color: #666;
  }

  .error {
    color: #ff6b6b;
    font-weight: 500;
    margin: 1rem 0;
    padding: 1rem;
    background: rgba(255, 107, 107, 0.1);
    border-radius: 4px;
  }

  .status {
    color: #888;
    font-style: italic;
    margin-bottom: 1rem;
    font-size: 0.9rem;
  }

  .results-header {
    margin: 2rem 0 1rem;
    font-size: 1rem;
    color: #888;
    text-align: left;
    border-bottom: 1px solid #333;
    padding-bottom: 0.5rem;
  }
  
  .results-header strong {
    color: #fff;
  }

  .table-container {
    overflow-x: auto;
    border-radius: 8px;
    background: #1e1e1e;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8rem;
    table-layout: fixed;
  }
  
  th, td {
    padding: 0.45rem 0.5rem;
    text-align: left;
    border-bottom: 1px solid #2a2a2a;
    white-space: nowrap;
  }

  th {
    background-color: #252525;
    font-weight: 600;
    color: #aaa;
    text-transform: uppercase;
    font-size: 0.7rem;
    letter-spacing: 0.05rem;
  }

  .addr {
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  tr:last-child td {
    border-bottom: none;
  }

  tr:hover td {
    background-color: #2a2a2a;
    color: #fff;
  }

  a {
    color: #4a90e2;
    text-decoration: none;
    transition: color 0.2s;
  }

  a:hover {
    color: #6ab0ff;
    text-decoration: underline;
  }

  @media (max-width: 640px) {
    main {
      padding: 1rem;
    }

    .controls {
      padding: 0.75rem;
      gap: 0.5rem;
    }

    table {
      font-size: 0.7rem;
    }

    th, td {
      padding: 0.3rem 0.35rem;
    }

    .hide-mobile {
      display: none;
    }
  }
</style>
