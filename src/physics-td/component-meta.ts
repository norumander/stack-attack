export interface ComponentMeta {
  readonly displayName: string;
  readonly description: string;
  readonly capabilitiesHuman: readonly string[];
  readonly dossier: {
    readonly body: string;
    readonly wire: string;
    readonly handles: string;
    readonly tip?: string;
  };
}

export const COMPONENT_META: Readonly<Record<string, ComponentMeta>> = {
  server: {
    displayName: "Server",
    description: "Request router — takes reads and forwards them downstream, sends responses back.",
    capabilitiesHuman: [
      "Forwards reads to downstream components (Data Cache, Database)",
      "Forwards writes to a Database",
    ],
    dossier: {
      body: "Servers are the workhorses of your stack. They take a request from a user, do the work, and send a response back.",
      wire: "Client → Server → Database",
      handles: "Read requests (and writes, if forwarded to a Database)",
      tip: "You always need at least one. Without a Server in the read path, your users have nowhere to go.",
    },
  },
  database: {
    displayName: "Database",
    description: "Persistent store. Answers reads from storage and terminates writes with revenue.",
    capabilitiesHuman: [
      "Stores data persistently",
      "Serves reads from storage",
      "Terminates writes with revenue",
    ],
    dossier: {
      body: "Databases store your data. They accept writes from Servers and hold onto them for later reads. Databases don't answer user requests directly — they sit behind a Server.",
      wire: "Server → Database",
      handles: "Read and write requests forwarded from a Server",
      tip: "A Database alone can't serve users — it needs a Server in front of it to route traffic.",
    },
  },
  data_cache: {
    displayName: "Data Cache",
    description: "LRU read cache — absorbs repeated reads between Server and Database.",
    capabilitiesHuman: [
      "Caches hot reads in an LRU slot set (32 slots)",
      "Responds directly on cache hit",
      "Forwards misses downstream, populates on the return trip",
    ],
    dossier: {
      body: "Sits between your Server and Database to absorb repeated read queries — like Redis or Memcached in a real backend. Responds directly on a cache hit (skipping the Database) and forwards misses through.",
      wire: "Server → Data Cache → Database",
      handles: "Repeated read requests forwarded from a Server (best with hot keys; doesn't accelerate writes)",
      tip: "When your Database is the bottleneck and reads repeat, drop a Data Cache in front of it to absorb the duplicates.",
    },
  },
  load_balancer: {
    displayName: "Load Balancer",
    description: "Splits a request batch across N healthy egresses; waits for all responses before returning.",
    capabilitiesHuman: [
      "Splits incoming batches across all healthy downstream egresses",
      "Merges responses (wait-all) before returning",
    ],
    dossier: {
      body: "Distributes traffic across multiple downstream components. Each incoming batch is split N ways; the response waits on all children before merging upward.",
      wire: "Server → Load Balancer → [Server-A, Server-B]",
      handles: "Any traffic that needs to be spread across duplicate downstream components",
      tip: "Add a Load Balancer when one Server saturates and you want to spread the same role across multiple instances.",
    },
  },
  cdn: {
    displayName: "CDN",
    description: "Edge cache for large static assets — images, video, downloads. Caches large reads only.",
    capabilitiesHuman: [
      "Caches large assets in an LRU slot set (24 slots)",
      "Passes non-large requests through unchanged",
    ],
    dossier: {
      body: "A Content Delivery Network sits at the edge of your stack — the first component traffic hits. It caches heavy static assets like images and video, so they never touch your Server.",
      wire: "Client → CDN → Server",
      handles: "Large-asset reads (bypasses non-large requests unchanged)",
      tip: "Use a CDN when a wave is heavy on images or blobs. It absorbs the large stuff before it reaches the rest of your stack.",
    },
  },
  api_gateway: {
    displayName: "API Gateway",
    description: "Terminates authentication at the edge. Auth-tagged requests stop here; non-auth passes through.",
    capabilitiesHuman: [
      "Terminates auth-tagged requests at the edge",
      "Forwards non-auth requests unchanged",
    ],
    dossier: {
      body: "An API Gateway handles authentication before traffic reaches your Servers. Auth-tagged requests get verified and responded to here; everything else passes through unchanged.",
      wire: "Client → API Gateway → Server",
      handles: "Auth-required requests (terminates); other requests pass through",
      tip: "Place an API Gateway in front when a wave brings auth traffic — it stops those requests from burning Server capacity.",
    },
  },
  queue: {
    displayName: "Queue",
    description: "FIFO buffer that holds requests until a connected Worker pulls one.",
    capabilitiesHuman: [
      "Holds up to 64 requests in FIFO order",
      "Released to a Worker that pulls from it",
    ],
    dossier: {
      body: "A Queue is a buffer between fast-arriving requests and slow consumers. It holds requests in order until a connected Worker pulls one off. A Queue by itself processes nothing.",
      wire: "Server → Queue → Worker",
      handles: "Async or batch requests that don't need an immediate response",
      tip: "Pair a Queue with a Worker for async work. The Queue absorbs traffic spikes; the Worker drains at its own pace.",
    },
  },
  worker: {
    displayName: "Worker",
    description: "Pulls buffered requests from a connected Queue at its own rate.",
    capabilitiesHuman: [
      "Pulls buffered requests from a connected Queue (30/sec)",
      "Terminates each pulled request with revenue",
    ],
    dossier: {
      body: "A Worker consumes held requests from a Queue, one by one, at its own pace. It does nothing on its own — you must connect it downstream of a Queue.",
      wire: "Queue → Worker",
      handles: "Requests buffered in the connected Queue",
      tip: "A Worker is inert without a Queue in front of it. Wire them together to drain batch traffic.",
    },
  },
  streaming_server: {
    displayName: "Streaming Server",
    description: "Handles long-lived streams — reserves bandwidth for the stream's duration.",
    capabilitiesHuman: [
      "Handles stream requests with reserved bandwidth for the stream's duration",
    ],
    dossier: {
      body: "Streams — like video playback or live broadcasts — hold a connection open for seconds, not milliseconds. A Streaming Server reserves bandwidth on its ingress for each stream's duration.",
      wire: "Client → Streaming Server",
      handles: "Stream requests with a declared duration and bandwidth",
      tip: "Streams are expensive — each one ties up a bandwidth slot. Place a Streaming Server when a wave brings video traffic.",
    },
  },
  dns_gtm: {
    displayName: "DNS / GTM",
    description: "Global Traffic Manager — routes each request to its origin zone deterministically.",
    capabilitiesHuman: [
      "Routes each request to the egress matching its origin zone",
      "Deterministic per-request; no splitting",
    ],
    dossier: {
      body: "A Global Traffic Manager sits in front of a multi-zone stack and routes each request to the zone it came from. Used to keep latency low when your stack spans regions.",
      wire: "Client → DNS/GTM → [na-east Server, eu-west Server]",
      handles: "Zone-tagged requests — routed to the matching zone's egress",
      tip: "Place a DNS/GTM at the front of a multi-zone topology so each region's traffic lands on its own stack.",
    },
  },
};
