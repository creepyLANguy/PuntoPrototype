export const ID_ALPHABET = "abcdefghjkmnpqrstuxyz";

export const ID_LENGTHS = Object.freeze({
  court: 4,
  tournament: 6,
  match: 8,
  club: 10,
});

export function isValidId(type, id) {
  return (
    Object.hasOwn(ID_LENGTHS, type) &&
    typeof id === "string" &&
    id.length === ID_LENGTHS[type] &&
    [...id].every((character) => ID_ALPHABET.includes(character))
  );
}

export function assertId(type, id) {
  if (!isValidId(type, id)) {
    throw new TypeError(`Invalid ${type} ID.`);
  }
  return id;
}
