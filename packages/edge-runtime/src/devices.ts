/**
 * Plant device contract between ORRN and the edge box (XE parity lane DEVICES, row 95). Exported from
 * `@orrn/edge-runtime/devices`, never from the package root: the root is imported on the Worker's start
 * path (lib/edge-v1.ts) and these schemas are only needed when a device request arrives.
 *
 * Wire:
 *   POST /api/edge/v1/devices/readings   up to 100 readings of ONE device
 *   POST /api/edge/v1/devices/heartbeat  the device's last-seen, buffered count and clock
 *   GET  /api/edge/v1/devices/config     the devices enrolled on this edge node (no tokens)
 * Every call is signed by the edge node (edge v1 `X-ORRN-Node-ID` + `Bearer v1:` HMAC) AND names the device
 * with its own token (`X-ORRN-Device`, `X-ORRN-Device-Token`; config needs only the node). A revoked device
 * token stops working at once; the node keeps working for its other devices.
 *
 * Replay: each reading carries `seq`, rising per device within one `epoch`. The edge starts a new epoch
 * whenever it loses its buffer (reinstall, new disk), so a sequence that restarts at 0 is never mistaken
 * for a replay. The server keeps (device, token version, epoch, seq) unique and answers a repeat as
 * `duplicate` without writing.
 *
 * Adapters: the edge reads a device over Modbus TCP or OPC UA through a typed map. The decoders below are
 * the reference the Go agent follows, and the fakes are the only "devices" anything talks to today.
 */
import { z } from "zod";

export const DEVICE_READINGS_PATH = "/api/edge/v1/devices/readings";
export const DEVICE_HEARTBEAT_PATH = "/api/edge/v1/devices/heartbeat";
export const DEVICE_CONFIG_PATH = "/api/edge/v1/devices/config";
export const DEVICE_MAX_READINGS = 100;

const isoTime = z.string().datetime({ offset: true });
const grams = z.number().int().min(0).max(200_000_000);
const um = z.number().int().min(0).max(10_000_000);

const readingBase = {
  seq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  sampledAt: isoTime,
};

export const deviceWeighReadingSchema = z.object({
  ...readingBase,
  kind: z.literal("weighbridge"),
  ticketNo: z.string().trim().min(1).max(40),
  vehicleNo: z.string().trim().max(20).nullable().optional(),
  grossG: grams,
  tareG: grams,
});

export const deviceScanPointSchema = z.object({
  name: z.string().trim().min(1).max(40),
  measuredUm: um,
  nominalUm: um.nullable().optional(),
  minusUm: um.nullable().optional(),
  plusUm: um.nullable().optional(),
});

export const deviceDimensionReadingSchema = z.object({
  ...readingBase,
  kind: z.literal("dimension"),
  sampleCode: z.string().trim().min(1).max(40),
  points: z.array(deviceScanPointSchema).min(1).max(20),
});

export const deviceMechanicalReadingSchema = z.object({
  ...readingBase,
  kind: z.literal("mechanical"),
  sampleCode: z.string().trim().min(1).max(40),
  tensileMpa: z.number().int().min(0).max(2000).nullable().optional(),
  yieldMpa: z.number().int().min(0).max(2000).nullable().optional(),
  elongationX10: z.number().int().min(0).max(1000).nullable().optional(),
});

export const deviceReadingSchema = z.discriminatedUnion("kind", [deviceWeighReadingSchema, deviceDimensionReadingSchema, deviceMechanicalReadingSchema]);
export type DeviceReadingWire = z.infer<typeof deviceReadingSchema>;

export const deviceReadingsRequestSchema = z.object({
  /** The edge's clock when it sent this request; ORRN measures the device clock's skew from it. */
  sentAt: isoTime,
  /** The edge buffer's epoch (see the header). */
  epoch: z.string().trim().min(1).max(64),
  /** The edge simulator made these readings. A simulated reading is never a weight or a quality check. */
  simulated: z.boolean().optional(),
  readings: z.array(deviceReadingSchema).min(1).max(DEVICE_MAX_READINGS),
});
export type DeviceReadingsRequest = z.infer<typeof deviceReadingsRequestSchema>;

export const deviceReadingsResponseSchema = z.object({
  accepted: z.array(z.number().int()),
  duplicate: z.array(z.number().int()),
  rejected: z.array(z.object({ seq: z.number().int(), code: z.string() })),
  /** Lab readings that became a quality check right away (matched by the sample code). */
  captured: z.number().int(),
});
export type DeviceReadingsResponse = z.infer<typeof deviceReadingsResponseSchema>;

export const deviceHeartbeatRequestSchema = z.object({
  sentAt: isoTime,
  epoch: z.string().trim().min(1).max(64),
  /** Highest seq the edge has handed to ORRN in this epoch. */
  lastSeq: z.number().int().min(0).nullable().optional(),
  /** Readings waiting in the edge buffer (network down, ORRN refused). */
  buffered: z.number().int().min(0).max(10_000_000).optional(),
  simulated: z.boolean().optional(),
  /** What the adapter last said, in the edge's own words ("ok", "timeout", "crc"). */
  linkState: z.string().trim().max(40).optional(),
});
export type DeviceHeartbeatRequest = z.infer<typeof deviceHeartbeatRequestSchema>;

// ---------------------------------------------------------------------------
// Protocol adapters (typed maps; no live device anywhere)
// ---------------------------------------------------------------------------

/** One holding register field: `words` 1 = 16 bit, 2 = 32 bit (high word first unless `swap`). */
export const modbusFieldSchema = z.object({
  field: z.string().trim().min(1).max(40),
  address: z.number().int().min(0).max(65535),
  words: z.union([z.literal(1), z.literal(2)]).default(1),
  signed: z.boolean().default(false),
  swap: z.boolean().default(false),
  /** Multiply the raw integer by this to get the field's integer unit (grams, micrometres, MPa). */
  scale: z.number().int().min(1).max(1_000_000).default(1),
});

export const modbusTcpConfigSchema = z.object({
  protocol: z.literal("modbus_tcp"),
  host: z.string().trim().min(1).max(253),
  port: z.number().int().min(1).max(65535).default(502),
  unitId: z.number().int().min(0).max(255).default(1),
  pollMs: z.number().int().min(200).max(600_000).default(1000),
  fields: z.array(modbusFieldSchema).min(1).max(32),
});
export type ModbusTcpConfig = z.infer<typeof modbusTcpConfigSchema>;

export const opcUaNodeSchema = z.object({
  field: z.string().trim().min(1).max(40),
  nodeId: z.string().trim().min(1).max(200),
  scale: z.number().int().min(1).max(1_000_000).default(1),
});

export const opcUaConfigSchema = z.object({
  protocol: z.literal("opc_ua"),
  endpoint: z.string().trim().regex(/^opc\.tcp:\/\//, "an opc.tcp:// endpoint").max(253),
  securityMode: z.enum(["None", "Sign", "SignAndEncrypt"]).default("SignAndEncrypt"),
  pollMs: z.number().int().min(200).max(600_000).default(1000),
  nodes: z.array(opcUaNodeSchema).min(1).max(32),
});
export type OpcUaConfig = z.infer<typeof opcUaConfigSchema>;

/** A device the PC writes files for (`watchDir` on the edge), or the simulator. */
export const fileConfigSchema = z.object({ protocol: z.literal("file"), watchDir: z.string().trim().min(1).max(260), pattern: z.string().trim().max(60).default("*.csv") });
export const serialConfigSchema = z.object({ protocol: z.literal("serial"), port: z.string().trim().min(1).max(60), baud: z.number().int().min(1200).max(921_600).default(9600) });
export const simConfigSchema = z.object({ protocol: z.literal("sim") });

export const deviceAdapterConfigSchema = z.discriminatedUnion("protocol", [modbusTcpConfigSchema, opcUaConfigSchema, fileConfigSchema, serialConfigSchema, simConfigSchema]);
export type DeviceAdapterConfig = z.infer<typeof deviceAdapterConfigSchema>;

/** What one enrolled device looks like to its edge node (`GET /api/edge/v1/devices/config`). Never a token. */
export const deviceConfigItemSchema = z.object({
  id: z.string(),
  code: z.string(),
  kind: z.string(),
  protocol: z.string(),
  simulated: z.boolean(),
  heartbeatSec: z.number().int(),
  tokenVersion: z.number().int(),
  config: deviceAdapterConfigSchema.nullable(),
});
export type DeviceConfigItem = z.infer<typeof deviceConfigItemSchema>;

export const deviceConfigResponseSchema = z.object({ devices: z.array(deviceConfigItemSchema), generatedAt: isoTime });

/** Reads `count` 16-bit holding registers from `address` (function 03). */
export type ModbusRead = (address: number, count: number) => Promise<number[]>;
/** Reads one OPC UA node's value. */
export type OpcUaRead = (nodeId: string) => Promise<number>;

export type DeviceFields = Record<string, number>;

/** Decode one Modbus field from its registers. */
export function decodeModbusField(field: z.infer<typeof modbusFieldSchema>, words: readonly number[]): number {
  const w = words.map((x) => x & 0xffff);
  let raw: number;
  if (field.words === 1) {
    raw = w[0]!;
    if (field.signed && raw >= 0x8000) raw -= 0x10000;
  } else {
    const [hi, lo] = field.swap ? [w[1]!, w[0]!] : [w[0]!, w[1]!];
    raw = hi * 0x10000 + lo;
    if (field.signed && raw >= 0x80000000) raw -= 0x100000000;
  }
  return raw * field.scale;
}

/** Read every field of a Modbus map through `read`. A failed read throws; the edge buffers nothing for it. */
export async function readModbus(config: ModbusTcpConfig, read: ModbusRead): Promise<DeviceFields> {
  const out: DeviceFields = {};
  for (const f of config.fields) {
    const regs = await read(f.address, f.words);
    if (regs.length < f.words) throw new Error(`short read at ${f.address}`);
    out[f.field] = decodeModbusField(f, regs);
  }
  return out;
}

export async function readOpcUa(config: OpcUaConfig, read: OpcUaRead): Promise<DeviceFields> {
  const out: DeviceFields = {};
  for (const n of config.nodes) {
    const v = await read(n.nodeId);
    if (!Number.isFinite(v)) throw new Error(`bad value at ${n.nodeId}`);
    out[n.field] = Math.round(v * n.scale);
  }
  return out;
}

/** A fake Modbus device: a register bank. `fail` makes every read throw (link down). */
export class FakeModbusDevice {
  readonly registers = new Map<number, number>();
  fail = false;
  reads = 0;
  set(address: number, ...words: number[]): this {
    words.forEach((w, i) => this.registers.set(address + i, w & 0xffff));
    return this;
  }
  read: ModbusRead = async (address, count) => {
    this.reads += 1;
    if (this.fail) throw new Error("timeout");
    return Array.from({ length: count }, (_, i) => this.registers.get(address + i) ?? 0);
  };
}

/** A fake OPC UA server: node values by id. */
export class FakeOpcUaDevice {
  readonly nodes = new Map<string, number>();
  fail = false;
  read: OpcUaRead = async (nodeId) => {
    if (this.fail) throw new Error("BadCommunicationError");
    const v = this.nodes.get(nodeId);
    if (v === undefined) throw new Error(`BadNodeIdUnknown ${nodeId}`);
    return v;
  };
}

/**
 * A weighbridge indicator's fields as one reading. The map names `grossG` and `tareG` (and `ticketNo` as a
 * number register when the indicator counts tickets). Returns null until both weights are in and stable.
 */
export function weighReadingFromFields(fields: DeviceFields, o: { seq: number; sampledAt: string; vehicleNo?: string | null }): DeviceReadingWire | null {
  const gross = fields.grossG;
  const tare = fields.tareG;
  const ticket = fields.ticketNo;
  if (gross == null || tare == null || ticket == null || gross <= 0 || tare < 0 || tare >= gross) return null;
  return { kind: "weighbridge", seq: o.seq, sampledAt: o.sampledAt, ticketNo: String(ticket), vehicleNo: o.vehicleNo ?? null, grossG: gross, tareG: tare };
}

/**
 * The edge buffer, as the Go agent keeps it (reference model for tests): readings get a rising seq, wait
 * while ORRN cannot be reached, and are replayed in order. A reading ORRN answered (accepted, duplicate or
 * rejected) leaves the buffer; anything else stays.
 */
export class EdgeDeviceBuffer {
  private next = 0;
  readonly pending: DeviceReadingWire[] = [];
  constructor(readonly epoch: string) {}
  push(r: Omit<DeviceReadingWire, "seq">): DeviceReadingWire {
    const reading = { ...r, seq: this.next } as DeviceReadingWire;
    this.next += 1;
    this.pending.push(reading);
    return reading;
  }
  batch(max: number = DEVICE_MAX_READINGS): DeviceReadingWire[] {
    return this.pending.slice(0, max);
  }
  settle(res: Pick<DeviceReadingsResponse, "accepted" | "duplicate" | "rejected">): void {
    const done = new Set([...res.accepted, ...res.duplicate, ...res.rejected.map((r) => r.seq)]);
    for (let i = this.pending.length - 1; i >= 0; i -= 1) if (done.has(this.pending[i]!.seq)) this.pending.splice(i, 1);
  }
}
