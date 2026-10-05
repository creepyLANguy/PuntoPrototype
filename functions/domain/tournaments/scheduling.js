function assignCourts(
  fixtures,
  {
    courtPool = [],
    unavailableCourtIds = [],
    startAt = null,
    matchDurationMinutes = 0,
    changeoverMinutes = 0,
  } = {},
) {
  const unavailable = new Set(unavailableCourtIds || []);
  const courts = (courtPool || []).filter((courtId) => !unavailable.has(courtId));
  if (courts.length === 0) {
    return fixtures.map((fixture) => ({ ...fixture }));
  }

  let playableIndex = 0;
  const waveMinutes = Number(matchDurationMinutes || 0) + Number(changeoverMinutes || 0);
  return fixtures.map((fixture) => {
    if (fixture.status === "bye") return { ...fixture };
    const wave = Math.floor(playableIndex / courts.length) + 1;
    const courtId = courts[playableIndex % courts.length];
    playableIndex += 1;
    return {
      ...fixture,
      courtId,
      scheduledStartAt: startAt == null ? null : Number(startAt) + (wave - 1) * waveMinutes * 60000,
      wave,
    };
  });
}

module.exports = { assignCourts };
