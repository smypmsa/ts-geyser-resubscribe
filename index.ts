require('dotenv').config();
import Client, {
  CommitmentLevel,
  SubscribeRequest,
  SubscribeRequestFilterTransactions,
  SubscribeRequestFilterAccounts,
} from '@triton-one/yellowstone-grpc';
import { ClientDuplexStream } from '@grpc/grpc-js';
import { SubscribeUpdate } from '@triton-one/yellowstone-grpc/dist/types/grpc/geyser';

// Mode switch: true = destroy & recreate, false = update request
const USE_DESTROY_MODE = false;

const ALL_WALLETS: string[] = [
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    '5n2WeFEQbfV65niEP63sZc3VA7EgC4gxcTzsGGuXpump',
    '4oJh9x5Cr14bfaBtUsXN1YUZbxRhuae9nrkSyWGSpump',
    'GBpE12CEBFY9C74gRBuZMTPgy2BGEJNCn4cHbEPKpump',
    'oraim8c9d1nkfuQk9EzGYEUGxqL3MHQYndRw1huVo5h',
    '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
    'j1oeQoPeuEDmjvyMwBmCWexzCQup77kbKKxV59CnYbd',
    "4xxM4cdb6MEsCxM52xvYqkNbzvdeWWsPDZrBcTqVGUar",
    "5hWJUNTtEtKmKgDXpthJXXRRmJrz5vJ7uJzrUNVdrwLg",
    "Bzc9NZfMqkXR6fz1DBph7BDf9BroyEf6pnzESP7v5iiw",
    "63amWndBz75z2j7jyKDbzXvzt36L9qdGw7CZAXbD4KNe",
    "D6Rgz1JG2syjsTXGaSAZ39cLffWL4TfabEAAnJHGRrZC",
    "FyDF3vKQFbcvNTsBi7L7LremrFPmXKbQqgAgnPg1hXXd"
  ];  

const STREAM_COUNT = 3;
const RESUBSCRIBE_INTERVAL = 1 * 30 * 1000;
const PING_INTERVAL = 1 * 60 * 1000;

const clients: Client[] = [];
const reconnectNeeded: boolean[] = Array(STREAM_COUNT).fill(false);
const streams: ClientDuplexStream<SubscribeRequest, SubscribeUpdate>[] = Array(STREAM_COUNT).fill(null);

function log(message: string) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function shuffle<T>(array: T[]): T[] {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function partition<T>(array: T[], parts: number): T[][] {
  const shuffled = shuffle(array);
  const result = Array.from({ length: parts }, () => [] as T[]);
  shuffled.forEach((val, idx) => result[idx % parts].push(val));
  return result;
}

function createSubscribeRequest(wallets: string[]): SubscribeRequest {
  return {
    accounts: {},
    slots: {},
    transactions: {
      t: {
        vote: false,
        failed: false,
        accountInclude: wallets,
        accountExclude: [],
        accountRequired: [],
      },
    },
    transactionsStatus: {},
    blocks: {},
    blocksMeta: {},
    entry: {},
    accountsDataSlice: [],
    commitment: CommitmentLevel.PROCESSED,
  };
}

function createPingRequest(): SubscribeRequest {
  return {
    ping: { id: 1 },
    accounts: {},
    accountsDataSlice: [],
    transactions: {},
    transactionsStatus: {},
    blocks: {},
    blocksMeta: {},
    entry: {},
    slots: {},
  };
}

function cancelStream(idx: number): Promise<void> {
  return new Promise((resolve) => {
    const stream = streams[idx];
    if (!stream) return resolve();

    stream.on('close', () => {
      log(`[Stream ${idx}] Closed after destroy`);
      resolve();
    });

    stream.on('end', () => {
      log(`[Stream ${idx}] Ended after destroy`);
      resolve();
    });

    try {
      stream.destroy();
    } catch (e: any) {
      log(`[Stream ${idx}] Destroy error: code ${e.code}, details: ${e.details}`);
      resolve();
    }

    streams[idx] = null;
  })
}

async function startStream(idx: number, wallets: string[]) {
  const client = clients[idx];
  const req = createSubscribeRequest(wallets);

  await cancelStream(idx);

  try {
    log(`[Stream ${idx}] Starting stream with ${wallets.length} accounts`);
    const stream = await client.subscribe();
    streams[idx] = stream;

    stream.on('data', (data: any) => {
        if (data?.transaction?.accounts?.length) {
          log(`[Stream ${idx}] Received data involving: ${data.transaction.accounts.join(', ')}`);
        }
      });      

    stream.on('error', (err: any) => {
      log(`[Stream ${idx}] Error: code ${err.code}, details: ${err.details}`);
      reconnectNeeded[idx] = true;
    });

    stream.on('end', () => {
      log(`[Stream ${idx}] Ended`);
      reconnectNeeded[idx] = true;
    });

    await new Promise<void>((res, rej) => stream.write(req, (e: any) => (e ? rej(e) : res())));
    log(`[Stream ${idx}] Subscription sent`);
  } catch (err) {
    log(`[Stream ${idx}] Failed to start: code ${(err as any)?.code}, details: ${(err as any)?.details}`);
    reconnectNeeded[idx] = true;
  }
}

async function resubscribeAll(walletPartitions: string[][]) {
  log('🔄 Forcing full resubscription...');

  if (USE_DESTROY_MODE) {
    await Promise.all(
      Array.from({ length: STREAM_COUNT }, (_, i) => cancelStream(i))
    );
    for (let i = 0; i < STREAM_COUNT; i++) {
      reconnectNeeded[i] = true;
    }
    await resubscribeIfNeeded(walletPartitions);
  } else {
    for (let i = 0; i < STREAM_COUNT; i++) {
      const stream = streams[i];
      const req = createSubscribeRequest(walletPartitions[i]);
      if (stream) {
        try {
          stream.write(req);
          log(`[Stream ${i}] Updated subscription request (without destroying stream)`);
        } catch (e: any) {
          log(`[Stream ${i}] Failed to update request: code ${e.code}, details: ${e.details}`);
          reconnectNeeded[i] = true;
        }
      } else {
        reconnectNeeded[i] = true;
      }
    }
    await resubscribeIfNeeded(walletPartitions);
  }
}

async function resubscribeIfNeeded(walletPartitions: string[][]) {
  for (let i = 0; i < STREAM_COUNT; i++) {
    if (reconnectNeeded[i]) {
      log(`🔁 Resubscribing stream ${i}...`);
      reconnectNeeded[i] = false;
      await startStream(i, walletPartitions[i]);
    }
  }
}

async function sendPingRequests() {
  const ping = createPingRequest();
  for (let i = 0; i < STREAM_COUNT; i++) {
    const stream = streams[i];
    if (stream) {
      try {
        stream.write(ping);
        log(`[Stream ${i}] Sent ping`);
      } catch (e: any) {
        log(`[Stream ${i}] Failed to send ping: code ${e.code}, details: ${e.details}`);
        reconnectNeeded[i] = true;
      }
    }
  }
}

async function main() {
  const partitions = partition(ALL_WALLETS, STREAM_COUNT);
  for (let i = 0; i < STREAM_COUNT; i++) {
    clients[i] = new Client(process.env.GRPC_URL!, process.env.X_TOKEN!, {
      'grpc.keepalive_time_ms': 30000,
      'grpc.keepalive_timeout_ms': 43200000,
      'grpc.keepalive_permit_without_calls': 1,
      'grpc.http2.max_pings_without_data': 0,
    });
    await startStream(i, partitions[i]);
  }

  setInterval(sendPingRequests, PING_INTERVAL);
  setInterval(() => {
    const newPartitions = partition(ALL_WALLETS, STREAM_COUNT);
    resubscribeAll(newPartitions);
  }, RESUBSCRIBE_INTERVAL);
}

main().catch((err) => log(`Unhandled error in main(): ${err}`));
