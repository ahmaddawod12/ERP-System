import {
  InventoryMovementResultSchema,
  InventoryPartSummarySchema,
  InventoryPickResultSchema,
  InventoryTransferResultSchema,
  type InventoryAdjustmentRequest,
  type InventoryMovementResult,
  type InventoryPartCreateRequest,
  type InventoryPartSummary,
  type InventoryPartUpdateRequest,
  type InventoryPickRequest,
  type InventoryPickResult,
  type InventoryTransferRequest,
  type InventoryTransferResult,
} from "@smart-job/api-contracts";
import type { QueryResultRow } from "pg";
import { z } from "zod";

import type { DatabaseQueryable } from "../database/runtime.js";
import { encodeEntityVersion } from "../entities/version.js";

const dateValueSchema = z.union([z.date(), z.iso.datetime({ offset: true })]);
const decimalSchema = z.union([z.number().finite(), z.string().regex(/^-?\d+(?:\.\d+)?$/)]);
const versionValueSchema = z.union([
  z.string().regex(/^[1-9]\d*$/),
  z.number().int().positive(),
  z.bigint().positive(),
]);
const inventoryPartMutationRowSchema = z.object({
  part_id: z.uuid(),
  part_no: z.number().int().positive(),
  status: z.enum(["active", "inactive", "archived"]),
  name: z.string(),
  active: z.boolean(),
  quantity_on_hand: decimalSchema,
  low_threshold: decimalSchema,
  unit: z.string().nullable(),
  entity_version: versionValueSchema,
  stock_entity_version: versionValueSchema,
  created_at: dateValueSchema,
  updated_at: dateValueSchema,
  archived_at: dateValueSchema.nullable(),
}).strict();

interface InventoryPartMutationRow extends QueryResultRow {
  readonly part_id: string;
  readonly part_no: number;
  readonly status: "active" | "inactive" | "archived";
  readonly name: string;
  readonly active: boolean;
  readonly quantity_on_hand: number | string;
  readonly low_threshold: number | string;
  readonly unit: string | null;
  readonly entity_version: bigint | number | string;
  readonly stock_entity_version: bigint | number | string;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
  readonly archived_at: Date | string | null;
}

const inventoryMovementRowSchema = z.object({
  movement_id: z.uuid(),
  part_id: z.uuid(),
  part_no: z.number().int().positive(),
  quantity: decimalSchema,
  source_quantity: decimalSchema,
  source_stock_entity_version: versionValueSchema,
  destination_quantity: decimalSchema,
  destination_stock_entity_version: versionValueSchema,
}).strict();

interface InventoryMovementRow extends QueryResultRow {
  readonly movement_id: string;
  readonly part_id: string;
  readonly part_no: number;
  readonly quantity: number | string;
  readonly source_quantity: number | string;
  readonly source_stock_entity_version: bigint | number | string;
  readonly destination_quantity: number | string;
  readonly destination_stock_entity_version: bigint | number | string;
}

export const CREATE_INVENTORY_PART_SQL = `
  SELECT * FROM private.create_api_inventory_part($1::uuid, $2::jsonb, $3::timestamptz)
`;
export const UPDATE_INVENTORY_PART_SQL = `
  SELECT * FROM private.update_api_inventory_part(
    $1::uuid, $2::uuid, $3::bigint, $4::jsonb, $5::timestamptz
  )
`;
export const ARCHIVE_INVENTORY_PART_SQL = `
  SELECT * FROM private.archive_api_inventory_part(
    $1::uuid, $2::uuid, $3::bigint, $4::timestamptz
  )
`;
export const ADJUST_INVENTORY_STOCK_SQL = `
  SELECT * FROM private.adjust_api_inventory_stock(
    $1::uuid, $2::uuid, $3::text, $4::bigint, $5::numeric, $6::text, $7::timestamptz
  )
`;
export const TRANSFER_INVENTORY_STOCK_SQL = `
  SELECT * FROM private.transfer_api_inventory_stock(
    $1::uuid, $2::uuid, $3::integer, $4::text, $5::numeric, $6::bigint,
    $7::text, $8::timestamptz
  )
`;
export const PICK_INVENTORY_STOCK_SQL = `
  SELECT * FROM private.pick_api_inventory_stock($1::uuid, $2::integer, $3::jsonb, $4::timestamptz)
`;

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toNumber(value: number | string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new TypeError("Invalid inventory decimal returned by database");
  return parsed;
}

function mapPartRow(unknownRow: unknown): InventoryPartSummary {
  const row = inventoryPartMutationRowSchema.parse(unknownRow);
  return InventoryPartSummarySchema.parse({
    partId: row.part_id,
    partNo: row.part_no,
    status: row.status,
    name: row.name,
    active: row.active,
    quantity: toNumber(row.quantity_on_hand),
    lowThreshold: toNumber(row.low_threshold),
    unit: row.unit,
    entityVersion: encodeEntityVersion(row.entity_version),
    stockEntityVersion: encodeEntityVersion(row.stock_entity_version),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    archivedAt: row.archived_at === null ? null : toIso(row.archived_at),
  });
}

function mapMovementRow(unknownRow: unknown): InventoryMovementResult {
  const row = inventoryMovementRowSchema.parse(unknownRow);
  return InventoryMovementResultSchema.parse({
    movementId: row.movement_id,
    partId: row.part_id,
    partNo: row.part_no,
    quantity: toNumber(row.quantity),
    sourceQuantity: toNumber(row.source_quantity),
    sourceStockEntityVersion: encodeEntityVersion(row.source_stock_entity_version),
    destinationQuantity: toNumber(row.destination_quantity),
    destinationStockEntityVersion: encodeEntityVersion(row.destination_stock_entity_version),
  });
}

export async function createInventoryPart(
  transaction: DatabaseQueryable,
  input: {
    readonly internalCompanyId: string;
    readonly request: InventoryPartCreateRequest;
    readonly createdAt: Date;
  },
): Promise<InventoryPartSummary> {
  const result = await transaction.query<InventoryPartMutationRow>(CREATE_INVENTORY_PART_SQL, [
    input.internalCompanyId,
    JSON.stringify(input.request),
    input.createdAt,
  ]);
  return mapPartRow(result.rows[0]);
}

export async function updateInventoryPart(
  transaction: DatabaseQueryable,
  input: {
    readonly internalCompanyId: string;
    readonly partId: string;
    readonly expectedEntityVersion: bigint;
    readonly request: InventoryPartUpdateRequest;
    readonly updatedAt: Date;
  },
): Promise<InventoryPartSummary> {
  const { entityVersion: _entityVersion, ...patch } = input.request;
  const result = await transaction.query<InventoryPartMutationRow>(UPDATE_INVENTORY_PART_SQL, [
    input.internalCompanyId,
    input.partId,
    input.expectedEntityVersion.toString(),
    JSON.stringify(patch),
    input.updatedAt,
  ]);
  return mapPartRow(result.rows[0]);
}

export async function archiveInventoryPart(
  transaction: DatabaseQueryable,
  input: {
    readonly internalCompanyId: string;
    readonly partId: string;
    readonly expectedEntityVersion: bigint;
    readonly archivedAt: Date;
  },
): Promise<InventoryPartSummary> {
  const result = await transaction.query<InventoryPartMutationRow>(ARCHIVE_INVENTORY_PART_SQL, [
    input.internalCompanyId,
    input.partId,
    input.expectedEntityVersion.toString(),
    input.archivedAt,
  ]);
  return mapPartRow(result.rows[0]);
}

export async function adjustInventoryStock(
  transaction: DatabaseQueryable,
  input: {
    readonly internalCompanyId: string;
    readonly partId: string;
    readonly scope: "company" | "member";
    readonly expectedStockEntityVersion: bigint;
    readonly request: InventoryAdjustmentRequest;
    readonly adjustedAt: Date;
  },
): Promise<InventoryPartSummary> {
  const result = await transaction.query<InventoryPartMutationRow>(ADJUST_INVENTORY_STOCK_SQL, [
    input.internalCompanyId,
    input.partId,
    input.scope,
    input.expectedStockEntityVersion.toString(),
    input.request.quantityDelta,
    input.request.note ?? null,
    input.adjustedAt,
  ]);
  return mapPartRow(result.rows[0]);
}

export async function transferInventoryStock(
  transaction: DatabaseQueryable,
  input: {
    readonly internalCompanyId: string;
    readonly expectedSourceStockEntityVersion: bigint;
    readonly request: InventoryTransferRequest;
    readonly transferredAt: Date;
  },
): Promise<InventoryTransferResult> {
  const result = await transaction.query<InventoryMovementRow>(TRANSFER_INVENTORY_STOCK_SQL, [
    input.internalCompanyId,
    input.request.partId,
    input.request.memberNo,
    input.request.direction,
    input.request.quantity,
    input.expectedSourceStockEntityVersion.toString(),
    input.request.note ?? null,
    input.transferredAt,
  ]);
  return InventoryTransferResultSchema.parse({ movement: mapMovementRow(result.rows[0]) });
}

export async function pickInventoryStock(
  transaction: DatabaseQueryable,
  input: {
    readonly internalCompanyId: string;
    readonly request: InventoryPickRequest;
    readonly expectedVersions: ReadonlyMap<string, bigint>;
    readonly pickedAt: Date;
  },
): Promise<InventoryPickResult> {
  const picks = input.request.items.map((item) => ({
    partId: item.partId,
    quantity: item.quantity,
    expectedStockEntityVersion: input.expectedVersions.get(item.partId)?.toString(),
  }));
  const result = await transaction.query<InventoryMovementRow>(PICK_INVENTORY_STOCK_SQL, [
    input.internalCompanyId,
    input.request.memberNo,
    JSON.stringify(picks),
    input.pickedAt,
  ]);
  return InventoryPickResultSchema.parse({ movements: result.rows.map(mapMovementRow) });
}
