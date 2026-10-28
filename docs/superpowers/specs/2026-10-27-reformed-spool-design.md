# Reformed ORRN Spool and Label Studio Design

Date: 2026-10-27
Status: approved for specification review; implementation not started
Products: ORRN control plane, ORRN Spool (legacy tunnel), and ORRN Edge V1

## 1. Outcome

Build one shared printing core with two compatible transports:

- `cmd/spool` remains the signed inbound/tunnel runtime used by the live legacy spool;
- `cmd/orrn-edge` provides outbound-only V1 enrollment, polling, snapshots, and offline fallback.

Both runtimes use the same TSPL2 generator, printer profiles, capability validation, job state machine, and label documents. The legacy system remains available as backup. No production migration is authorized by this design.

The release also provides a tenant-scoped label studio on `orrn.in`, refined built-in labels, printer tracking, and MAC-locked DHCP recovery.

## 2. Approved label direction

The default built-in label is **B — Operations dense**. It preserves the polished legacy hierarchy while using the complete operational field set:

- large bundle serial and QR anchor;
- quantity, cut length, PO, series, cast, sales order, BIS/CML fields;
- weight per 12 ft, weight per cut, and total weight;
- aligned columns and clear field labels.

**A — Polished classic** and **C — Compact label** remain alternate built-ins. Built-ins are cloned into tenant drafts; they are not changed or published automatically in production.

The photographs are layout references only, not dimensional evidence. Final geometry requires a physical TA220 proof with a ruler and scanner.

There is no `compat.layout_map` or `fcms-layout-*` default. Built-ins and configuration are ORRN-native. Legacy inspiration never redirects production labels.

## 3. Non-goals

- Seagull/BarTender driver emulation or a Windows compatibility layer.
- RFID encoding, firmware updates, arbitrary printer drivers, or arbitrary TSPL injection.
- Automatic factory reset, `AUTO.BAS`, font/template download, calibration, or cutter activation.
- Routed/L3 discovery, Internet-wide scanning, or printing to an unverified endpoint.
- Production cutover, live Agni/CT 130 changes, or changes to legacy credentials/resources.
- Client-side calculation of stock, weight, order, price, or other business values.

## 4. Architecture

### 4.1 Shared printing core

The Go core owns:

- versioned label-document interpretation and deterministic TSPL2 rendering;
- TA220/TE200 capability profiles and feature discovery;
- serialized printer sessions, status decoding, and outcome classification;
- durable acceptance, cancellation, retry, crash recovery, and offline reprints;
- printer endpoint verification and DHCP recovery.

`cmd/spool` is a thin legacy composition root. It keeps legacy machine authentication, routes, templates, webhooks, and compatibility behavior. `cmd/orrn-edge` keeps signed outbound V1 transport and local fallback. Device and label behavior must not diverge between them.

### 4.2 Control plane

ORRN owns:

- tenant-scoped template drafts, published versions, and built-in templates;
- server-side validation and variable projection;
- printer profiles, desired configuration, and reported status;
- versioned print commands and immutable print payloads;
- printer discovery evidence and endpoint history.

Existing tenant isolation and `spool.push_templates` authorization apply. New studio reads use authenticated company context. Publish uses that same permission; no client-supplied `companyId` is trusted.

### 4.3 Label studio

The studio is an online application. Offline fallback uses frozen payloads and does not edit templates.

It provides:

- drag, resize, rotate, align, distribute, snap-to-grid, zoom, duplicate, and delete;
- undo/redo, layers, keyboard operation, and accessible property editing;
- millimetre rulers, printable-area guides, and alternate design selection;
- field insertion from the frozen catalog only;
- text, font, size, position, rotation, and symbology-specific settings;
- draft preview, server validation, clone, and explicit publish.

Preview is a design aid, not proof of physical output. TSPL rendering and validation remain authoritative on the server and agent.

## 5. Label document and rendering

### 5.1 Compatibility

Existing label schema JSON remains readable. A versioned label document is introduced without migrating queued jobs. Every publish creates a new template version; print commands freeze the document, variables, printer/profile references, and payload hash at acceptance.

Documents contain page settings and an ordered element list. Coordinates and sizes use millimetres with at most two decimal places. Conversion to dots is deterministic for the profile DPI. TSPL uses CRLF and the official command forms.

The document rejects more than 64 elements and rendered payloads larger than 64 KiB. It also rejects empty required fields, unsupported fonts, invalid rotations, out-of-bounds geometry, unsupported symbologies, and elements outside the printable area.

### 5.2 Elements

Initial elements:

- `text`: static text or a frozen variable, font, size, position, rotation, and alignment;
- `barcode`: TSC type, height, rotation, narrow/wide values, human-readable setting, and content;
- `qrcode`: error level, cell size, model, mask, rotation, and content;
- `datamatrix`: width, height, module size, rotation, and content;
- `aztec`, `maxicode`, `pdf417`, `composite`, and `rss`: only their profile-supported options;
- `line` and `box`: position, dimensions, and stroke;
- `bitmap`: approved image content, dimensions, and dithering, added after the text/symbol path is proven.

No element may name `uuid`, `id`, or `bundleId`. QR content for bundle labels uses the frozen `qr` variable. Arbitrary database identifiers and arbitrary TSPL are forbidden.

### 5.3 Validation

Validation runs in the studio, at publish, and again before printing. It checks:

- media width/height and printable bounds;
- decimal precision, DPI, speed, density, gap, and post-print action;
- supported fonts and minimum readable sizes;
- barcode type, rotation, narrow/wide ratios, quiet zones, and content length;
- QR model/mask/cell, Data Matrix modules, and symbology-specific options;
- required variables, forbidden identifiers, and static content safety.

TE200/TA220 limits from the approved research include 203 DPI, 2–6 in/sec, 5–112 mm media widths, direct thermal and thermal-transfer, gap/black-mark sensors, and optional cutter/peeler behavior. Optional hardware is enabled only after read-only feature discovery confirms it.

## 6. Studio administration and printer preferences

Printer profiles are company- and deployment-scoped. They store:

- profile identity, model/profile, MAC address, and last verified endpoint;
- media dimensions, gap, DPI, speed, density, direction, and print method;
- post-print mode and discovered optional features;
- last verified status, endpoint evidence, and last-seen timestamp.

Container health never substitutes for printer health. Status timestamps update only on a genuine printer response.

Configuration is desired-state. A tenant edit creates a new config version, which the assigned agent validates and applies atomically. Queued jobs retain their frozen endpoint and payload until a new verified endpoint is eligible for use.

## 7. MAC-locked DHCP recovery

The agent maintains a per-printer discovery worker with capped backoff and jitter.

1. Read the local ARP/neighbor table and retain the profile's current endpoint and MAC.
2. Probe candidates on TCP 9100 with a bounded status request.
3. Accept an endpoint only after both a successful TSPL status response and a MAC match.
4. Report verification evidence and update the eligible endpoint without exposing credentials.
5. Continue work with capped retry scheduling. Never redirect a job after its first byte.

A MAC mismatch, timeout, ambiguous response, or unsupported model leaves the previous endpoint unchanged and the printer unavailable. Accepted jobs may redirect only after successful verification. `transmitting` and `outcome_unknown` jobs never redirect.

Initial support is directly connected IPv4 networks. Routed networks require a local discovery relay. Docker host-network/L2 support requires a separate authorized design and is not silently enabled.

## 8. Safety and failure behavior

Existing invariants remain:

- one durable logical attempt per job key;
- atomic compare-and-claim before any device write;
- zero-byte failures retry with capped jittered backoff;
- any post-byte ambiguity becomes `outcome_unknown`, never an automatic duplicate;
- cancellation wins only before transmission;
- process interruption during `transmitting` recovers as `outcome_unknown`;
- offline reprints require a terminal source job, frozen payload, and intact destination.

`IgnorePrinterResponse`, automatic `AUTO.BAS`, factory reset, firmware changes, and unverified downloads are forbidden. Calibration, cutter, RTC, and font/template downloads are separate audited administrator features introduced only after the core label path passes.

## 9. Rollout

1. Implement the shared label document and built-ins A/B/C; prove B with a ruler and scanner.
2. Add studio draft/edit/preview/publish and alternate designs.
3. Add read-only feature discovery, printer tracking, and MAC-locked DHCP recovery.
4. Add administrator-controlled calibration, cutter, RTC, and download features incrementally.
5. Complete native Windows SCM, Linux systemd, Docker rollback, and native AMD64 artifact checks before production migration.

Every stage keeps the legacy spool operational as backup. Live Agni, CT 130, legacy credentials, and production Cloudflare resources require a separate explicit request.

## 10. Verification and acceptance

Required evidence:

- exact TSPL fixtures for A/B/C, decimal geometry, CRLF, symbologies, and invalid options;
- tenant isolation, permissions, forbidden identifiers, and server-derived values;
- studio browser tests for editing, undo/redo, validation, accessibility, and publish;
- fake TA220 acceptance for status, zero-byte retry, partial writes, restart, and offline reprint;
- physical B-label inspection with ruler, QR scan, barcode scan, and copy count;
- simulated DHCP change, MAC mismatch, delayed status, and no-duplicate-print checks;
- full TypeScript and Go suites, concurrent-package race tests, typechecks, and release builds;
- compiled-agent acceptance from enrollment through revocation, with no regression in existing flows;
- native Windows, Linux, Docker, and ARM64 lifecycle verification on authorized runners.

The feature is not production-ready from compilation, container health, or preview screenshots alone.
