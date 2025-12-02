import { BN } from "bn.js";
import {
	Connection,
	Keypair,
	PublicKey,
	sendAndConfirmTransaction,
	Transaction,
} from "@solana/web3.js";
import {
	MAX_TOKEN_A_AMOUNT,
	SLIPPAGE_BPS,
	SOL_USDC_POOL_PK,
	ZERO_SLIPPAGE_THRESHOLD,
} from "./consts";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { CpAmm, PositionState } from "@meteora-ag/cp-amm-sdk";

export interface UserPosition {
	positionNftAccount: PublicKey;
	position: PublicKey;
	positionState: PositionState;
}

/**
 * Validates and loads environment variables
 */
export function loadEnv(): { rpcUrl: string; secretKey: Uint8Array } {
	const rpcUrl = process.env.RPC_URL;
	if (!rpcUrl) {
		throw new Error("RPC_URL environment variable is not set");
	}

	const secretKeyStr = process.env.SECRET_KEY;
	if (!secretKeyStr) {
		throw new Error("SECRET_KEY environment variable is not set");
	}

	let secretKey: Uint8Array;
	try {
		secretKey = Uint8Array.from(
			secretKeyStr.split(",").map((v) => Number(v.trim())),
		);
		if (secretKey.length !== 64) {
			throw new Error("Invalid secret key length");
		}
	} catch (error) {
		throw new Error(
			`Failed to parse SECRET_KEY: ${error instanceof Error ? error.message : "Unknown error"}`,
		);
	}

	return { rpcUrl, secretKey };
}

export function addSlippage(amount: BN, slippageBps: number): BN {
	// Add slippage TO the required threshold for "at most" checks
	return amount.muln(10_000 + slippageBps).divn(10_000);
}

/**
 * Creates a new position and adds liquidity
 */
export async function createPosition(
	cpAmm: CpAmm,
	connection: Connection,
	user: Keypair,
	poolState: Awaited<ReturnType<typeof cpAmm.fetchPoolState>>,
	depositQuote: ReturnType<typeof cpAmm.getDepositQuote>,
): Promise<UserPosition> {
	console.log("Creating new position...");

	const positionNft = Keypair.generate();
	const createPositionTx = await cpAmm.createPositionAndAddLiquidity({
		owner: user.publicKey,
		pool: SOL_USDC_POOL_PK,
		positionNft: positionNft.publicKey,
		liquidityDelta: depositQuote.liquidityDelta,
		maxAmountTokenA: MAX_TOKEN_A_AMOUNT,
		maxAmountTokenB: depositQuote.outputAmount,
		tokenAAmountThreshold: addSlippage(
			depositQuote.actualInputAmount,
			SLIPPAGE_BPS,
		),
		tokenBAmountThreshold: addSlippage(depositQuote.outputAmount, SLIPPAGE_BPS),
		tokenAMint: poolState.tokenAMint,
		tokenBMint: poolState.tokenBMint,
		tokenAProgram: TOKEN_PROGRAM_ID,
		tokenBProgram: TOKEN_PROGRAM_ID,
	});

	await prepareAndSignTransaction(connection, createPositionTx, user, [
		user,
		positionNft,
	]);

	const signature = await sendAndConfirmTransaction(
		connection,
		createPositionTx,
		[user, positionNft],
	);
	console.log(`✓ Position created: ${signature}`);

	// Fetch position state with retry due to slot latency
	const position = await retry(
		async () => {
			const userPositions = await cpAmm.getPositionsByUser(user.publicKey);
			if (userPositions.length === 0) {
				throw new Error("Position not found after creation");
			}
			return userPositions[0];
		},
		{
			maxRetries: 3,
			initialDelay: 1000,
			maxDelay: 30000,
			backoffMultiplier: 2,
		},
	);

	return position;
}

/**
 * Prepares and signs a transaction with the latest blockhash
 */
export async function prepareAndSignTransaction(
	connection: Connection,
	transaction: Transaction,
	feePayer: Keypair,
	signers: Keypair[],
): Promise<Transaction> {
	const blockhash = await connection.getLatestBlockhash();

	transaction.recentBlockhash = blockhash.blockhash;
	transaction.feePayer = feePayer.publicKey;
	transaction.lastValidBlockHeight = blockhash.lastValidBlockHeight;
	transaction.sign(...signers);

	return transaction;
}

/**
 * Removes all liquidity and closes a position
 */
export async function closePosition(
	cpAmm: CpAmm,
	connection: Connection,
	user: Keypair,
	position: UserPosition,
	poolState: Awaited<ReturnType<typeof cpAmm.fetchPoolState>>,
): Promise<void> {
	console.log("Removing all liquidity and closing position...");

	// CAUTION: Slippage thresholds are set to ZERO to accept any output
	// and bypass slippage errors when closing positions
	const closePositionTx = await cpAmm.removeAllLiquidityAndClosePosition({
		owner: user.publicKey,
		position: position.position,
		positionNftAccount: position.positionNftAccount,
		poolState,
		positionState: position.positionState,
		tokenAAmountThreshold: ZERO_SLIPPAGE_THRESHOLD,
		tokenBAmountThreshold: ZERO_SLIPPAGE_THRESHOLD,
		vestings: [],
		currentPoint: new BN(0),
	});

	await prepareAndSignTransaction(connection, closePositionTx, user, [user]);

	const signature = await sendAndConfirmTransaction(
		connection,
		closePositionTx,
		[user],
	);
	console.log(`✓ Position closed: ${signature}`);

	// Verify position was closed
	const userPositions = await cpAmm.getPositionsByUser(user.publicKey);
	if (userPositions.length > 0) {
		throw new Error(
			`Position still exists after close attempt. Found ${userPositions.length} position(s)`,
		);
	}
}

export interface RetryOptions {
	maxRetries: number;
	initialDelay?: number; // in milliseconds
	maxDelay?: number; // in milliseconds
	backoffMultiplier?: number; // default is 2 for exponential backoff
	debug?: boolean;
}

/**
 * Retry a callback function with exponential backoff
 * @param callback - The function to retry (can be sync or async)
 * @param options - Retry configuration options
 * @returns The result of the callback function
 * @throws The last error if all retries fail
 */
export async function retry<T>(
	callback: () => T | Promise<T>,
	options: RetryOptions,
): Promise<T> {
	const {
		maxRetries,
		initialDelay = 100,
		maxDelay = 30000,
		backoffMultiplier = 2,
		debug = false,
	} = options;

	let lastError: unknown;
	let delay = initialDelay;

	if (debug) {
		console.log({
			maxRetries,
		});
	}

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			const result = await callback();
			if (debug) {
				console.log("result...", result);
			}
			return result;
		} catch (error) {
			console.log("Retry failed...");
			lastError = error;

			// If this was the last attempt, throw the error
			if (attempt === maxRetries) {
				throw lastError;
			}

			// Wait before retrying with exponential backoff
			await sleep(Math.min(delay, maxDelay));

			// Increase delay exponentially for next retry
			delay *= backoffMultiplier;
		}
	}

	// This should never be reached, but TypeScript needs it
	throw lastError;
}

/**
 * Helper function to sleep for a given duration
 */
export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
