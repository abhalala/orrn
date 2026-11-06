-- Security review 2026-11-04, CRITICAL 1 (sec/2026-11-04). Until this deploy the auth cookie was
-- `Domain=.orrn.in`, so every *.orrn.in host, plant-run *.spool.orrn.in tunnels included, received
-- every visitor's session token. The cookie is now a host-only `__Host-` cookie on the API host,
-- but a token copied before the deploy would still be a valid session under the new name. End
-- every session once: everyone signs in again (web and phone). Data change, no schema change;
-- named in docs/DEPLOY_PROMOTION.md. Nothing references `session` (device.auth_session_id is a
-- plain column), and every other auth row (users, passwords, authenticators) stays.
DELETE FROM `session`;
