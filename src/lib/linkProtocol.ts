export const LINK_PROTOCOL_MIN = 1;
export const LINK_PROTOCOL_MAX = 1;

export type LinkInfo = {
  product: "HomePlace";
  server: {
    id: string;
    name: string;
  };
  protocol: {
    min: number;
    max: number;
  };
  serverTime: string;
  features: {
    pairing: boolean;
    realtime: boolean;
  };
};

type LinkInfoInput = {
  serverId: string;
  serverName: string;
  now?: Date;
};

/** Builds the public installation description used before a device is paired. */
export function createLinkInfo(input: LinkInfoInput): LinkInfo {
  return {
    product: "HomePlace",
    server: {
      id: input.serverId,
      name: input.serverName,
    },
    protocol: {
      min: LINK_PROTOCOL_MIN,
      max: LINK_PROTOCOL_MAX,
    },
    serverTime: (input.now ?? new Date()).toISOString(),
    // These switches describe usable server features, not roadmap intent.
    features: {
      pairing: false,
      realtime: false,
    },
  };
}

/** Server IDs are UUIDs so clients can validate them without knowing the database. */
export function isLinkServerId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
