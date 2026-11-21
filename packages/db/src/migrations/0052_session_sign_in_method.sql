-- How each session was made (council round 1, A4): passkey, google, totp, password, magicLink or other.
-- Additive: one nullable column, no default (Better Auth carries the value into a session it remakes).
-- Sessions made before it read as null, which a plant that requires secure sign-in does not accept.

ALTER TABLE `session` ADD `sign_in_method` text;
