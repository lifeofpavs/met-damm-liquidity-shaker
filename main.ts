import { Connection, Keypair } from "@solana/web3.js";

import { CpAmm } from "@meteora-ag/cp-amm-sdk";
import * as dotenv from "dotenv";
import { DEPOSIT_AMOUNT, SOL_USDC_POOL_PK } from "./consts";
import {
	closePosition,
	createPosition,
	loadEnv,
	sleep,
	type UserPosition,
} from "./helpers";

dotenv.config();

/**
 * This script connects to the Solana blockchain using a wallet specified in environment variables,
 * checks if the user already has an open liquidity position in the SOL-USDC pool, creates one if needed,
 * and then closes the position—removing all liquidity and cleaning up.
 * It demonstrates the full lifecycle of a liquidity position: open (if required) and close.
 */

async function main() {
	const args = process.argv.slice(2);
	// You can access CLI arguments via the `args` array, e.g. args[0], args[1], etc.
	// Extend this as needed to handle CLI args in your script.
	// Example: console.log("Parsed CLI args:", args);

	let loop = false;

	if (args.includes("--loop")) {
		console.log("🔁 Running in loop mode ");
		loop = true;
	}

	while (true) {
		try {
			const { rpcUrl, secretKey } = loadEnv();
			const connection = new Connection(rpcUrl);
			const user = Keypair.fromSecretKey(secretKey);
			const cpAmm = new CpAmm(connection);

			console.log(`Using wallet: ${user.publicKey.toBase58()}`);

			// Fetch existing positions
			const userPositions = await cpAmm.getPositionsByUser(user.publicKey);
			let position: UserPosition | undefined;

			if (userPositions.length > 0) {
				console.log(
					`Found existing position: ${userPositions[0].position.toBase58()}`,
				);
				position = userPositions[0];
			} else {
				const poolState = await cpAmm.fetchPoolState(SOL_USDC_POOL_PK);

				// Deposit quote is used for calculating amounts in and out when adding liquidity
				const depositQuote = cpAmm.getDepositQuote({
					inAmount: DEPOSIT_AMOUNT,
					isTokenA: true,
					minSqrtPrice: poolState.sqrtMinPrice,
					maxSqrtPrice: poolState.sqrtMaxPrice,
					sqrtPrice: poolState.sqrtPrice,
				});

				position = await createPosition(
					cpAmm,
					connection,
					user,
					poolState,
					depositQuote,
				);
			}

			if (!position) {
				throw new Error("Failed to obtain position");
			}

			// Sleep one second before closing position
			await sleep(1000);

			// Close the position
			const poolState = await cpAmm.fetchPoolState(SOL_USDC_POOL_PK);
			await closePosition(cpAmm, connection, user, position, poolState);

			console.log("🎉 Completed successfully 🚀");
		} catch (error) {
			console.error("❌ Failed:", error);
			process.exit(1);
		}

		if (!loop) {
			break;
		}
	}
}

main();
