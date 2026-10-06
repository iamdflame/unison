/** Minimal ABI fragments the workflows read. */
export const OPERATOR_REFERENCE_ABI = [
  {
    type: "function",
    name: "last",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [
      { name: "price", type: "uint256" },
      { name: "publishTimeMs", type: "uint64" },
      { name: "batch", type: "uint64" },
      { name: "status", type: "uint8" },
    ],
  },
] as const;

export const EXCHANGE_ABI = [
  {
    type: "function",
    name: "regimeOf",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "extBandBps", type: "uint16" },
          { name: "reopenBandBps", type: "uint16" },
          { name: "discFloorBps", type: "uint16" },
          { name: "discCapBps", type: "uint16" },
          { name: "discHorizonSec", type: "uint32" },
          { name: "discCadence", type: "uint32" },
          { name: "halted", type: "bool" },
          { name: "closedSince", type: "uint64" },
          { name: "lastDiscoveryBatch", type: "uint64" },
        ],
      },
    ],
  },
] as const;

/** ChainlinkCausalReference.latest: the latest observation, stamped with the time Chainlink's quorum signed. */
export const CAUSAL_REFERENCE_ABI = [
  {
    type: "function",
    name: "latest",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [
      { name: "price", type: "uint256" },
      { name: "observedAt", type: "uint256" },
      { name: "status", type: "uint8" },
      { name: "round", type: "uint80" },
    ],
  },
] as const;
