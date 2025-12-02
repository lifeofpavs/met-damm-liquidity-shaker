MetDamm Liquidity Shakes helps interact with Meteora DAMM v2 and shake liquidity on the SOL-USDC pool.

For the moment, it just creates a position, adds liquidity to it, removed liquidity and closes it.
## Usage

### Running scripts
- One timer
```bash
bun run main.ts
```

- Loop
```bash
bun run main.ts --loop
```

### Helper Functions

The key helper functions include:

- `loadEnv()`: Loads and validates your RPC and wallet secret.
- `addSlippage(amount, slippageBps)`: Adds slippage to a BN amount.
- `createPosition(...)`: Creates a new position in the AMM and adds liquidity.
- `prepareAndSignTransaction(...)`: Prepares and signs a transaction using your keypair.
- `closePosition(...)`: Removes all liquidity and closes a position.
- `retry(callback, options)`: Retries an async function with exponential backoff (helpful for reading state after writes).

See code comments and function JSdoc for further usage details.

## Example Workflow

1. Create a position and provide liquidity to the pool.
2. Optionally, check status or fetch pool states.
3. Remove liquidity and close the position.


