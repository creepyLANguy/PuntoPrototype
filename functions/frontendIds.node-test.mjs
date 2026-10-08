import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

import { callableHandlers, firestoreState } from "./frontendHarness/mockFirestoreState.mjs";

register("./frontendHarness/loaderHooks.mjs", import.meta.url);

const { ID_ALPHABET, ID_LENGTHS, assertId, isValidId } =
  await import("../app/js/config/idContract.js");
const { createWithUniqueId, createClub, manageMatch, manageTournament } =
  await import("../app/js/firebase/callables.js");

test("all four frontend ID contracts have distinct lengths and one alphabet", () => {
  assert.equal(ID_ALPHABET.length, 21);
  assert.equal(new Set(ID_ALPHABET).size, 21);
  assert.deepEqual(ID_LENGTHS, { court: 4, tournament: 6, match: 8, club: 10 });
  assert.equal(new Set(Object.values(ID_LENGTHS)).size, 4);
  for (const [type, length] of Object.entries(ID_LENGTHS)) {
    for (const letter of ID_ALPHABET) {
      assert.equal(assertId(type, letter.repeat(length)), letter.repeat(length));
    }
    for (const invalid of [
      "a".repeat(length - 1),
      "a".repeat(length + 1),
      "A".repeat(length),
      "i".repeat(length),
      "1".repeat(length),
      "/".repeat(length),
      ` ${"a".repeat(length)}`,
      null,
      undefined,
      123,
    ]) {
      assert.equal(isValidId(type, invalid), false);
      assert.throws(() => assertId(type, invalid));
    }
  }
});

test("typed creation dispatches to the backend and validates its response", async () => {
  const requests = [];
  for (const name of ["createCourt", "createClub", "manageMatch", "manageTournament"]) {
    callableHandlers.set(name, async (payload) => {
      requests.push({ name, payload });
      const type = {
        createCourt: "court",
        createClub: "club",
        manageMatch: "match",
        manageTournament: "tournament",
      }[name];
      return { data: { [`${type}Id`]: "a".repeat(ID_LENGTHS[type]), success: true } };
    });
  }
  const credentials = { adminKey: "test-admin-key" };
  for (const [type, length] of Object.entries(ID_LENGTHS)) {
    const result = await createWithUniqueId(type, { name: "Resource" }, credentials);
    assert.equal(result[`${type}Id`], "a".repeat(length));
    assert.deepEqual(requests.at(-1).payload.credentials, credentials);
  }
  assert.equal(requests[2].payload.operation, "createMatch");
  assert.equal(requests[1].payload.operation, "createTournament");
  assert.equal(firestoreState.docs.size, 0, "creation never writes from the frontend");
  const count = requests.length;
  await assert.rejects(createWithUniqueId("device", {}));
  await assert.rejects(createWithUniqueId("court", { courtId: "bad-id" }));
  assert.equal(requests.length, count, "invalid requests never reach the backend");
});

test("existing creation wrappers use the same typed path", async () => {
  const requests = [];
  callableHandlers.set("createClub", async (payload) => {
    requests.push(["club", payload]);
    return { data: { clubId: "abcdefghjk" } };
  });
  callableHandlers.set("manageTournament", async (payload) => {
    requests.push(["tournament", payload]);
    return { data: { tournamentId: "abcdef" } };
  });
  callableHandlers.set("manageMatch", async (payload) => {
    requests.push(["match", payload]);
    return { data: { matchId: "abcdefgh" } };
  });
  assert.equal((await createClub({ name: "Club" })).data.clubId, "abcdefghjk");
  assert.equal((await manageTournament("createTournament")).tournamentId, "abcdef");
  assert.equal((await manageMatch("createMatch")).matchId, "abcdefgh");
  await manageMatch("ensureCourtMatch", { courtId: "abcd" });
  assert.equal(requests.at(-1)[1].operation, "ensureCourtMatch");
});

test("all creation types reject malformed backend IDs and preserve backend errors", async () => {
  for (const type of Object.keys(ID_LENGTHS)) {
    const callable = {
      court: "createCourt",
      club: "createClub",
      match: "manageMatch",
      tournament: "manageTournament",
    }[type];
    for (const id of ["legacy123", "A".repeat(ID_LENGTHS[type]), "i".repeat(ID_LENGTHS[type])]) {
      callableHandlers.set(callable, async () => ({ data: { [`${type}Id`]: id } }));
      await assert.rejects(createWithUniqueId(type), TypeError);
    }
    const error = Object.assign(new Error("Allocation exhausted"), { code: "functions/aborted" });
    callableHandlers.set(callable, async () => {
      throw error;
    });
    await assert.rejects(createWithUniqueId(type), (received) => received === error);
  }
});
