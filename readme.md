# Solana Geyser gRPC Client

A TypeScript implementation for subscribing to Solana accounts via Geyser gRPC API with automatic resubscription and connection management.

## Installation

```bash
# Clone the repository
git clone https://github.com/smypmsa/ts-geyser-resubscribe.git

# Navigate to project directory
cd ts-geyser-resubscribe

# Install dependencies
npm install
```

## Configuration

Create a `.env` file in the project root with the following content:

```
GRPC_URL=https://your_grpc_endpoint_url
X_TOKEN=your_geyser_api_access_token
```

## Usage

Edit the `ALL_WALLETS` array in `index.ts` to include the Solana account addresses you want to monitor.

You can also customize these configuration parameters:
- `STREAM_COUNT`: Number of parallel gRPC streams
- `RESUBSCRIBE_INTERVAL`: How often to resubscribe (in milliseconds)
- `PING_INTERVAL`: How often to send ping messages (in milliseconds)
- `USE_DESTROY_MODE`: Toggle between destroy/recreate or update subscription mode

## Running the Application

```bash
# Using npm script
npm start

# Or directly with ts-node
npx ts-node index.ts
```

## Testing

To verify the script is working:
1. Set up your `.env` file
2. Run the application
3. Check the logs for messages confirming stream setup and data reception