# Fourcubes Staged Cutover Runbook (`CT 130` → Raspberry Pi ARM64)

## Overview

This runbook documents the staged production migration for Fourcubes plant label printing and local read-cache fallback from legacy `orrn-spool` to `orrn-edge` (`v1.0.0+`), keeping legacy BarTender intact as an immediate manual fallback throughout the transition.

---

## Stage 1: Deploy Additive ORRN Control Plane Changes

1. Apply the generated migrations in order: `0043_edge_v1_control_plane.sql`, `0044_label_studio.sql`, and `0045_printer_discovery.sql`. Inspect the migration journal and target database first; there is no separate `0044_edge_v1_snapshots.sql`.
2. Deploy `apps/server` with `/api/edge/v1/*` routes (`enroll`, `commands/poll`, `commands/ack`, `events`, `config`, `credentials/confirm`, `snapshots/manifest`, `snapshots/:snapshotId/chunks/:sequence`).
3. Leave legacy `/webhooks/spool` and `SpoolClient` routes active for unmigrated printer profiles during the cutover window.

---

## Stage 2: Provision & Enroll `orrn-edge` on Agni `CT 130`

1. In ORRN Platform Admin (`Printing`), create the `Fourcubes Surat Plant` Edge V1 node and copy the single-use 15-minute enrollment token (`enr_...`). No Cloudflare Tunnel or public DNS record is created.
2. Verify that an explicit immutable Edge release and the matching control-plane API/migrations are actually available. A successful local build is not a published release. CT 130 currently runs the legacy spool on port 8080: use an isolated pilot guest, or obtain an explicit stop/cutover window with rollback before installing a second service on that port.
3. In a deployment shell, export `ORRN_EDGE_VERSION`, `ORRN_EDGE_URL` and `ORRN_EDGE_SHA256` from the verified release manifest. Export `ORRN_API_ORIGIN=https://api.orrn.in` and `ORRN_ENROLL_TOKEN_FILE` pointing to the private token file. The Linux installer consumes environment variables, not `--version` flags:
   ```bash
   sudo --preserve-env=ORRN_EDGE_VERSION,ORRN_EDGE_URL,ORRN_EDGE_SHA256,ORRN_API_ORIGIN,ORRN_ENROLL_TOKEN_FILE bash packaging/linux/install.sh
   ```
4. Verify:
   - `/var/lib/orrn-edge/node.json` (or the explicitly configured state directory) is owned by `orrn-edge:orrn-edge` with mode `0600`.
   - `systemctl status orrn-edge.service` is `active (running)`.
   - Loopback admin listener (`http://127.0.0.1:8081/healthz`) reports `ready: true`, initial desired config applied, and all 5 snapshot sections (`stock`, `orders`, `dies`, `print_status`, `company_format`) complete.
   - LAN fallback listener (`http://<ct130-lan-ip>:8080/healthz`) responds `200 OK` and returns `404` for `/admin/*`.

---

## Stage 3: Verify TSC TA220 Printer Status & Test Profile

1. Bootstrap the local administrator on `127.0.0.1:8081` (via SSH port-forward) and create local plant fallback accounts (`printer` and `viewer` roles).
2. Assign only the **Fourcubes Test Printer Profile** (`deploymentId = <CT 130 deploymentId>`) to the new node.
3. Print the built-in **B (operations dense)**, **A (polished alternate)**, and **C (compact alternate)** documents from ORRN. Use B with two copies and C with three copies for the copy-count check.
   - Confirm every `print_log` transitions `queued -> accepted -> sent`; transport delivery alone is not physical-print evidence.
   - On each physical label, measure **102.25 × 76.20 mm** media and **2.00 mm** gap with a ruler; check that text and symbols remain inside the printable area.
   - Scan B and A QR codes and confirm they resolve to the expected bundle URL. Scan C's Code 128 barcode and confirm the exact bundle serial. Check serial, party/PO, and human-readable values against the source bundle.
   - Count physical labels: B must produce two and C must produce three. Check the second and third copies for identical content and alignment.
   - Record the printer MAC, verified endpoint, profile/media settings, operator, date, and photograph/reference for each observed label. Leave any unobserved field **pending**.
   - Confirm `bundle.stickerStale` clears only upon durable `accepted` acknowledgement.

---

## Stage 4: Controlled Outage, Crash, and Security Drills on `CT 130`

1. **Outage & Local Reprint Drill**:
   - Block outbound HTTPS to `api.orrn.in` on `CT 130` for 30 minutes.
   - Verify plant PCs can log into `http://<ct130-lan-ip>:8080`, browse cached `stock`, `orders` (with no prices/rates), `dies` (with no R2 keys), and `print_status` (with per-section **Cached as of** banners).
   - Trigger an offline reprint of a `sent` job as a `printer` user.
   - Restore outbound HTTPS and verify the `offline_reprint` event uploads once and records in ORRN `print_log` with `origin = "offline_reprint"`.
2. **Ambiguous Write / Crash Drill**:
   - Simulate process termination after `transmitting` begins; verify startup marks the job `outcome_unknown` (`process_interrupted`) and never automatically re-sends bytes.
3. **Overlapping Secret Rotation Drill**:
   - Trigger secret rotation in ORRN Platform Admin (`pendingCredentialVersion = 2`).
   - Verify `CT 130` downloads `pendingSecret`, confirms via `POST /api/edge/v1/credentials/confirm`, and switches to credential version 2 with zero failed polls.
4. **Upgrade & Health-Gated Rollback Drill**:
   - Run `orrn-edge` upgrade with a simulated unready candidate binary and confirm automatic rollback to `orrn-edge.previous` with the pre-upgrade `VACUUM INTO` SQLite backup intact.
5. **Native service and artifact gates** (cross-compilation and container health are not substitutes):
   - On a Windows VM, verify the AMD64 executable's SHA-256, then exercise real Service Control Manager install, service start, readiness after initialization, stop, restart recovery, and uninstall. Record the Windows build and service evidence.
   - On native Linux AMD64, execute the release binary, install/start the systemd unit, verify readiness and restart recovery, then exercise the unready-upgrade rollback. Repeat execution and systemd checks on native ARM64 or Raspberry Pi hardware.
   - With a digest-pinned Docker image, start the candidate, fail its actual readiness check, and verify the old container/configuration and consistent SQLite backup are restored. Record image digest and rollback evidence.
   - Keep every unexecuted item **pending**. Do not approve cutover from compilation, QEMU alone, or a healthy container with an unready agent.

---

## Stage 5: Production Cutover on `CT 130`

1. After human sign-off on Stage 3 and Stage 4, update the production Fourcubes packing printer profile `deploymentId` to `CT 130`.
2. Monitor the first 20 production bundle labels on the packing floor.
3. Keep legacy BarTender available on the packing PC as manual fallback; do not modify `VM 181`.

---

## Stage 6: Migrate State from `CT 130` to Raspberry Pi (`linux/arm64`)

1. Stop `orrn-edge.service` on `CT 130` after the packing shift finishes and outbox depth is `0`.
2. Create a consistent SQLite backup with SQLite's backup API/CLI or `VACUUM INTO`, and securely preserve `/var/lib/orrn-edge/node.json` and local configuration. There is no `orrn-edge backup` subcommand. Stop the old service before copying its state; never run both identities concurrently.
3. Install `orrn-edge-linux-arm64` on the Raspberry Pi appliance, restore `edge.db` and `node.json` with `0600` permissions, and start `orrn-edge.service`.
4. Verify poll heartbeat, TSC TA220 status, and a physical test label from the Raspberry Pi before retiring `CT 130`.

## Evidence Register

Populate a row only from direct observation. `pending` is not a failure and must not be converted from compiler output or a transport-level `sent` event.

| Gate | Required evidence | Current record |
|---|---|---|
| B physical label | Ruler dimensions/gap, QR scan, serial/PO, two copies, photo/reference, operator/date | pending |
| A physical label | Ruler dimensions/gap, QR scan, serial/PO, photo/reference, operator/date | pending |
| C physical label | Ruler dimensions/gap, Code 128 scan, serial, three copies, photo/reference, operator/date | pending |
| Windows AMD64 | Artifact SHA-256, native SCM install/start/stop/restart/uninstall and readiness evidence | pending |
| Linux AMD64 | Native execution, systemd lifecycle, readiness, rollback evidence | pending |
| Linux ARM64 / Pi | Native execution, systemd lifecycle, physical label evidence | pending |
| Docker rollback | Immutable image digest, failed-candidate readiness and restored previous container/state evidence | pending |

The live legacy Fourcubes spool, Agni deployment, CT 130, VM 181, and production Cloudflare resources remain unchanged until these gates are observed and a separate deployment is approved.
