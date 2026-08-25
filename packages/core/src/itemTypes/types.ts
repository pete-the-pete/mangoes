/** A countable thing a cycle can track. Domain-free by construction: core never
 *  knows what the emoji depicts — the seed data lives in the app layer. */
export interface ItemType {
  key: string;
  emoji: string;
  label: string;
  enabled: boolean;
  position: number;
}

export type ItemTypeSeed = Omit<ItemType, "enabled">;

export interface ItemTypeUpdate {
  enabled?: boolean | undefined;
  label?: string | undefined;
}
