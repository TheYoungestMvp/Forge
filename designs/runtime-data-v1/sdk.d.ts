/**
 * Proposed Forge runtime data SDK v1. Type contract only; no runtime is installed.
 * Collection declarations are generated from an approved version manifest.
 * Server validation and authorization remain mandatory for JavaScript callers.
 */
export type DataOutcome = "rejected" | "unknown";

export type DataErrorCode =
  | "AUTH_REQUIRED"
  | "SESSION_REVOKED"
  | "PROJECT_NOT_FOUND"
  | "DATA_CAPABILITY_DENIED"
  | "RUNTIME_EXPIRED"
  | "VERSION_STALE"
  | "SCHEMA_INCOMPATIBLE"
  | "REVISION_CONFLICT"
  | "OPERATION_ID_CONFLICT"
  | "OPERATION_CANCELLED"
  | "INVALID_DATA"
  | "DATA_RATE_LIMIT"
  | "DATA_QUOTA_EXCEEDED"
  | "DATA_UNAVAILABLE"
  | "DATA_TIMEOUT";

export interface DataError extends Error {
  code: DataErrorCode;
  /** Rejection of this call cannot resolve an earlier mutation with unknown status. */
  outcome: DataOutcome;
  /** Present on mutations, including failures whose commit status is unknown. */
  operationId?: string;
}

export interface DataRecord<Fields extends object> {
  id: string;
  /** Decimal BIGINT string: avoids JavaScript integer precision loss. */
  revision: string;
  fields: Fields;
  createdAt: string;
  updatedAt: string;
}

export interface ListOptions<Fields extends object> {
  /** Equality only; AND semantics; at most four readable fields. */
  where?: Partial<Fields>;
  cursor?: string;
  /** Default 25, maximum 100; additionally bounded by response byte limit. */
  limit?: number;
}

export interface ListPage<Fields extends object> {
  records: Array<DataRecord<Fields>>;
  nextCursor: string | null;
}

export interface MutationOptions {
  /** UUID. Omitted values are generated once and preserved for transport retries. */
  operationId?: string;
}

export interface RevisionMutationOptions extends MutationOptions {
  expectedRevision: string;
}

/** Minimal immutable acknowledgment; get(recordId) reads the current state. */
export interface MutationAck {
  operationId: string;
  recordId: string;
  revision: string;
}

export type OperationStatus =
  | { operationId: string; status: "applied"; ack: MutationAck }
  | {
      operationId: string;
      status: "rejected";
      code: DataErrorCode;
    }
  /** Absence does not prove an earlier request cannot arrive and commit later. */
  | { operationId: string; status: "absent" };

export interface CollectionContract<
  Readable extends object,
  Creatable extends object,
  Writable extends object,
> {
  readable: Readable;
  creatable: Creatable;
  writable: Writable;
}

export interface DataCollection<
  Readable extends object,
  Creatable extends object,
  Writable extends object,
> {
  list(options?: ListOptions<Readable>): Promise<ListPage<Readable>>;
  get(id: string): Promise<DataRecord<Readable> | null>;
  create(fields: Creatable, options?: MutationOptions): Promise<MutationAck>;
  /** Nonempty patch; unset/null/unknown fields are rejected in v1. */
  update(
    id: string,
    patch: Partial<Writable>,
    options: RevisionMutationOptions,
  ): Promise<MutationAck>;
  remove(id: string, options: RevisionMutationOptions): Promise<MutationAck>;
  operationStatus(operationId: string): Promise<OperationStatus>;
}

type CollectionFor<Contract> =
  Contract extends CollectionContract<infer R, infer C, infer W>
    ? DataCollection<R, C, W>
    : never;

export interface ForgeDataSDK {
  /** Only manifest-declared names are available to generated declarations. */
  collection<Name extends Extract<keyof ForgeDataCollections, string>>(
    name: Name,
  ): CollectionFor<ForgeDataCollections[Name]>;
}

export interface ForgeRuntimeSDK {
  readonly data: ForgeDataSDK;
}

declare global {
  /** Augmented by declarations generated from the approved immutable manifest. */
  // The intentionally empty interface is the manifest compiler's merge point.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ForgeDataCollections {}
  const forge: ForgeRuntimeSDK;
}
