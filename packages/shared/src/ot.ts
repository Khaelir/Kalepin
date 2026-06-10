export type OTOpComponent =
  | { type: 'insert'; text: string }
  | { type: 'delete'; count: number }
  | { type: 'retain'; count: number };

export type OTOperation = OTOpComponent[];

export interface OTMessage {
  type: 'op';
  docId: string;
  ops: OTOperation;
  rev: number;
}

export interface OTAck {
  type: 'ack';
  docId: string;
  rev: number;
}
