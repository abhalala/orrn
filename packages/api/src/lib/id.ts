const crockford = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function createId(date = Date.now()) {
  let timestamp = date;
  let id = "";

  for (let index = 0; index < 10; index += 1) {
    id = crockford[timestamp % 32] + id;
    timestamp = Math.floor(timestamp / 32);
  }

  for (let index = 0; index < 16; index += 1) {
    id += crockford[Math.floor(Math.random() * 32)];
  }

  return id;
}
