# On-premises: what runs at the plant

Status: **built, not live.** No plant runs any of this on its own premises yet (XE parity row 84). This page
describes what exists in the code today and what each part does when the internet is down. It does not
describe plans.

There are two ways to run orrn near the plant. They solve different problems:

| | Edge box + cloud orrn (this repo) | orrn-rs standalone (separate repo `fc/orrn-rs`) |
|---|---|---|
| Where the data lives | Cloudflare D1 (cloud). The edge box keeps a read cache. | The plant's own computer, on an encrypted USB stick. No cloud. |
| Who it is for | A plant on orrn SaaS that wants printing, devices and reads to work through a short internet cut. | A plant that wants no cloud at all. |
| Writes with the internet down | Labels and device readings queue on the edge box and replay. Office screens need the internet. | Everything works on plant Wi-Fi. |
| State | Edge v1 control plane on main since migration 0043. Device enrolment added by XE DEVICES (0067). | A Rust rewrite in progress (iced desktop app, Turso database). Not shipped. |

## 1. Edge box + cloud orrn

### What runs where

| Part | Runs on | Code |
|---|---|---|
| orrn web, phone app, server (tRPC on a Cloudflare Worker), database (D1), files (R2) | Cloudflare | `apps/web`, `apps/native`, `apps/server`, `packages/server` |
| Edge agent (Go): print queue, scale reader, press and spectro collectors, device adapters, local cache | One Windows or Linux PC on the plant LAN | orrn-spool repo (outside this repo) |
| Label printers | Plant LAN, driven by the edge agent | `printer_profile`, `print_log` |
| Weighbridge, profile scanner, tensile tester, PLC, oven controller, spectrometer PC | Plant LAN or serial, read by the edge agent | `plant_device` (this lane) and the collectors |

The edge box only makes outbound calls (security review 2026-11-04). It has no tunnel and no inbound port.
It enrols once with a 15-minute single-use code (`edge.enroll`, then `POST /api/edge/v1/enroll`) and
signs every call after that with its node secret (`X-ORRN-Node-ID` and `Authorization: Bearer v1:<ts>:<hmac>`).

### Edge endpoints the local cache uses

| Endpoint | What it gives the edge box |
|---|---|
| `GET /api/edge/v1/config` | Desired printers and the config version. |
| `POST /api/edge/v1/commands/poll`, `/commands/ack` | Print jobs and device actions, leased one minute at a time. |
| `POST /api/edge/v1/events` | Job results and printer reports, idempotent on the event id. |
| `GET /api/edge/v1/snapshots/manifest`, `/snapshots/:id/chunks/:seq` | Read-cache sections: `stock`, `orders`, `dies`, `print_status`, `company_format`. A section is rebuilt at most every 10 minutes; chunks are 64 KiB and carry a SHA-256. |
| `GET /api/edge/v1/devices/config` (new, row 84) | The plant devices enrolled on this edge box, with their adapter maps (Modbus TCP, OPC UA, file, serial, simulator). Never a token. The edge keeps it so it can go on reading devices while the internet is down. |
| `POST /api/edge/v1/devices/readings`, `/devices/heartbeat` (new, row 95) | Device readings and last-seen, signed by the node AND the device's own token. |

### What works with the internet down

| Works | How |
|---|---|
| Printing labels already queued | The edge agent holds leased jobs and prints them; results replay through `/events`. Print exactly once: the spool keeps `job_key` unique. |
| Reading stock, orders and dies on the edge's own page | From the last complete snapshot sections. They are as old as the last manifest (10 minutes before the cut at best). |
| Weighbridge tickets, scanner and tensile results | The edge agent keeps reading devices from its cached device config and buffers readings with a rising `seq` per device. On reconnect it replays them; orrn stores each (device, epoch, seq) once and answers a repeat as `duplicate`. A reinstalled edge starts a new epoch, so its seq 0 is a new reading, not a replay. |
| Press frames, spectro files, oven readings | The collectors buffer and replay on (node, seq) or the file's SHA-256, as before. |

| Does not work | Why |
|---|---|
| Office screens (orders, dispatch, purchase, QA, billing) | They are the cloud app. |
| New labels for bundles packed during the cut | Packing is a server write. The phone keeps an outbox for some floor writes (`clientRequestId`, see AGENTS.md "Replay-safe floor writes"); those land when the phone is back online. |
| Taking a weighbridge ticket onto a lot or a load | A person does that on the lot or dispatch page once the ticket has arrived. Until then the ticket waits, and the gate can type the weight with a reason (it is checked against the ticket later). |

### Clock skew

The server owns time. A device clock more than 2 minutes off (measured from the request's sent time, never
from an old buffered reading) moves the reading's time by the measured skew and marks it "time not
confirmed". A reading still more than 5 minutes in the future after that is refused.

### Data sync and backup

- The cloud database is the record. The edge cache is read-only and is thrown away and refetched when its
  SHA-256 does not match.
- Daily export: one JSON object per plant in the private R2 bucket `BACKUPS` (see `docs/RESTORE_DRILL.md`).
  It now includes `plant_device`, `device_reading` and `device_reading_use`; the `token_hash` column is dropped
  like every other `*_hash` column.
- Device tokens are shown once at enrolment or rotation and stored only as SHA-256. A lost edge box: revoke
  the box (`edge`) or one device (`devices.revoke`); its readings stay.

## 2. orrn-rs standalone

A separate repository (`fc/orrn-rs`, not edited by this lane). In short, from its design and the owner's
decisions of 2026-11-17 to 2026-11-21:

- One main computer at the plant runs the app (iced desktop UI on Windows, macOS and Linux). The data sits on a
  USB stick, encrypted with a master password, PIN or pattern.
- Workers get a link per shift and use plain web pages served by the main computer over HTTPS on plant Wi-Fi.
- The plant keeps working with the internet down, phones included.
- Backup: Turso encryption plus backups (owner decision 2026-11-20); the certificate sits under orrn's domain.
- It ports orrn main's rules and tests (upstream pin in its repo). It is not shipped and has no plant.

## 3. What is still owed (owner items)

- A plant to install in.
- The weighbridge indicator make and its register map or file export; the profile scanner make; the tensile
  tester make; the PLC make (Q46) and its protocol (Modbus TCP or OPC UA). Each device path in orrn ends at a
  typed adapter with a fake (`@orrn/edge-runtime/devices`) until one exists.
- The Go edge agent's device reader (orrn-spool). The TypeScript decoders and the buffer model in
  `@orrn/edge-runtime/devices` are the reference it follows.
- For orrn-rs: see `fc/orrn-rs/docs/owner-decisions-2026-11-20.md` and its open items.
