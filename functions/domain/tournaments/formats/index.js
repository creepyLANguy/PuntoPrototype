const americano = require("./americano");
const mexicano = require("./mexicano");
const teamAmericano = require("./teamAmericano");
const teamMexicano = require("./teamMexicano");
const roundRobin = require("./roundRobin");
const swiss = require("./swiss");
const singleElimination = require("./singleElimination");
const doubleElimination = require("./doubleElimination");
const groupKnockout = require("./groupKnockout");
const kingCourt = require("./kingCourt");
const { TournamentDomainError } = require("../errors");

const formats = [
  americano,
  mexicano,
  teamAmericano,
  teamMexicano,
  roundRobin,
  swiss,
  singleElimination,
  doubleElimination,
  groupKnockout,
  kingCourt,
];

const registry = Object.fromEntries(formats.map((format) => [format.id, format]));
const FORMAT_IDS = Object.freeze(Object.keys(registry));

function getFormat(id) {
  const format = registry[id];
  if (!format)
    throw new TournamentDomainError("UNKNOWN_FORMAT", `Unknown tournament format: ${id}`);
  return format;
}

function listFormats() {
  return formats.map(({ id, label, entryMode, kind }) => ({ id, label, entryMode, kind }));
}

module.exports = { getFormat, listFormats, FORMAT_IDS };
