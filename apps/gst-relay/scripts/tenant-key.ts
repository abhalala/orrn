/**
 * Print one tenant's relay key (review S2): `GST_RELAY_SECRET=... bun run tenant-key <companyId>`.
 * Run it where the Worker's GST_RELAY_SECRET is known; put the output in the relay's credentials file under
 * that tenant. The relay never needs the master secret.
 */
import { relayTenantKey } from "@orrn/domain";

const tenant = process.argv[2] ?? "";
const master = process.env.GST_RELAY_SECRET ?? "";
if (!tenant || !master) {
  console.error("usage: GST_RELAY_SECRET=... bun run tenant-key <orrn company id>");
  process.exit(1);
}
console.log(await relayTenantKey(master, tenant));
