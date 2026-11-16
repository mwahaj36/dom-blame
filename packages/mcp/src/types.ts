import type { BridgeState } from './bridge';

export interface BridgeHandle {
  port: number;
  url: string;
  isClientFallback: boolean;
  getState: () => Promise<BridgeState>;
  close: () => Promise<void>;
}
