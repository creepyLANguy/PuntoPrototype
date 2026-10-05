class TournamentDomainError extends Error {
  constructor(code, message, details = undefined) {
    super(message || code);
    this.name = "TournamentDomainError";
    this.code = code;
    this.details = details;
  }
}

module.exports = { TournamentDomainError };
