import type { Pool } from "pg";
import type { ItemType, ItemTypeSeed, ItemTypeUpdate } from "./types.js";

export interface ListItemTypesOptions {
  enabledOnly?: boolean | undefined;
}

export interface ItemTypeStore {
  listItemTypes(options?: ListItemTypesOptions): Promise<ItemType[]>;
  updateItemType(key: string, update: ItemTypeUpdate): Promise<ItemType | undefined>;
  /** Inserts missing entries only. Returns how many rows were actually added. */
  seedItemTypes(entries: ItemTypeSeed[]): Promise<number>;
}

interface ItemTypeRow {
  key: string;
  emoji: string;
  label: string;
  enabled: boolean;
  position: number;
}

const ITEM_TYPE_COLUMNS = "key, emoji, label, enabled, position";

export function createPostgresItemTypeStore(pool: Pool): ItemTypeStore {
  return {
    async listItemTypes(options) {
      const result = await pool.query<ItemTypeRow>(
        `SELECT ${ITEM_TYPE_COLUMNS} FROM item_types
         WHERE ($1::boolean IS NOT TRUE OR enabled)
         ORDER BY position, key`,
        [options?.enabledOnly ?? false],
      );
      return result.rows;
    },

    async updateItemType(key, update) {
      const result = await pool.query<ItemTypeRow>(
        `UPDATE item_types
         SET enabled = COALESCE($2, enabled),
             label = COALESCE($3, label),
             updated_at = now()
         WHERE key = $1
         RETURNING ${ITEM_TYPE_COLUMNS}`,
        [key, update.enabled ?? null, update.label ?? null],
      );
      return result.rows[0];
    },

    // DO NOTHING, never DO UPDATE: this runs on every deploy, and the Super
    // Admin's enable/disable and relabel edits must survive it.
    async seedItemTypes(entries) {
      let inserted = 0;
      for (const entry of entries) {
        const result = await pool.query(
          `INSERT INTO item_types (key, emoji, label, position)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (key) DO NOTHING`,
          [entry.key, entry.emoji, entry.label, entry.position],
        );
        inserted += result.rowCount ?? 0;
      }
      return inserted;
    },
  };
}
