export const ID_ALPHABET = "abcdefghjkmnpqrstuxyz";

export const ID_LENGTHS = Object.freeze({
  court: 5,
  tournament: 7,
  match: 6,
  club: 4,
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
