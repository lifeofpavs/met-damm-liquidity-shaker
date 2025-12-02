import { PublicKey } from "@solana/web3.js";
import { BN } from "bn.js";

// SOL-USDC DAMM v2 pool
export const SOL_USDC_POOL_PK = new PublicKey(
	"8Pm2kZpnxD3hoMmt4bjStX2Pw2Z9abpbHzZxMPqxPmie",
);

export const SLIPPAGE_BPS = 100; // 1% in basis points

// Liquidity amounts (in lamports/smallest unit)
export const DEPOSIT_AMOUNT = new BN(1_000_000); // 0.01 SOL (assuming 9 decimals)
export const MAX_TOKEN_A_AMOUNT = new BN(10_000_000); // Max token A amount for position creation

// Slippage thresholds for closing position (accept any amount)
export const ZERO_SLIPPAGE_THRESHOLD = new BN(0);
