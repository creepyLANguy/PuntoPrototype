const crypto = require("crypto");
const fs = require("node:fs");
const path = require("node:path");
const { SourceTextModule } = require("node:vm");
const { FakeFirestore } = require("./testSupport/fakeFirestore");
const {
  ID_ALPHABET,
  ID_LENGTHS,
  MAX_ID_ALLOCATION_ATTEMPTS,
  allocateId,
  validateId,
  randomId,
} = require("./services/ids");
const { paths } = require("./services/firestorePaths");

describe("canonical typed IDs", () => {
  test("uses the exact letter-only alphabet and one retry limit", () => {
    expect(ID_ALPHABET).toBe("abcdefghjkmnpqrstuxyz");
    expect(ID_LENGTHS).toEqual({ court: 4, tournament: 6, match: 8, club: 10 });
    expect(MAX_ID_ALLOCATION_ATTEMPTS).toBe(5);
    const source = jest.fn((size) => source.mock.calls.length % size);
    const id = randomId(100, source);
    expect([...id].every((letter) => ID_ALPHABET.includes(letter))).toBe(true);
    expect(id).not.toMatch(/[0-9]/);
  });

  test("frontend and backend ID contracts cannot drift", async () => {
    const identifier = path.join(__dirname, "../app/js/config/idContract.js");
    const frontend = new SourceTextModule(fs.readFileSync(identifier, "utf8"), { identifier });
    await frontend.link(() => {
      throw new Error("The frontend ID contract must be standalone.");
    });
    await frontend.evaluate();
    const contract = frontend.namespace;
    expect(contract.ID_ALPHABET).toBe(ID_ALPHABET);
    expect(contract.ID_LENGTHS).toEqual(ID_LENGTHS);
    expect(Object.isFrozen(contract.ID_LENGTHS)).toBe(true);
    for (const [type, length] of Object.entries(ID_LENGTHS)) {
      const id = "a".repeat(length);
      expect(contract.assertId(type, id)).toBe(validateId(type, id));
      for (const invalid of [id.toUpperCase(), ` ${id} `, `${id}a`, `${id.slice(1)}2`]) {
        expect(contract.isValidId(type, invalid)).toBe(false);
        expect(() => validateId(type, invalid)).toThrow();
      }
    }
  });

  test.each(Object.entries(ID_LENGTHS))(
    "%s allocation has its exact length",
    async (type, length) => {
      const db = new FakeFirestore();
      const id = await db.runTransaction(async (tx) => {
        const candidate = await allocateId(tx, type, { db });
        tx.create(db.doc(paths[type](candidate)), { type });
        return candidate;
      });
      expect(id).toHaveLength(length);
      expect(validateId(type, id)).toBe(id);
      expect(db.get(paths[type](id))).toEqual({ type });
    },
  );

  test.each(Object.entries(ID_LENGTHS))(
    "%s rejects legacy, noncanonical and wrong-type IDs",
    (type, length) => {
      const valid = "a".repeat(length);
      expect(validateId(type, valid)).toBe(valid);
      for (const bad of [
        undefined,
        null,
        42,
        {},
        [],
        "",
        valid.toUpperCase(),
        ` ${valid}`,
        `${valid} `,
        valid.slice(1),
        `${valid}a`,
        `${valid.slice(1)}2`,
        `${valid.slice(1)}o`,
        `${valid.slice(1)}l`,
        `${valid.slice(1)}i`,
        `${valid.slice(1)}v`,
        "a/b",
        ...Object.values(ID_LENGTHS)
          .filter((n) => n !== length)
          .map((n) => "a".repeat(n)),
      ]) {
        expect(() => validateId(type, bad)).toThrow();
      }
      expect(() => validateId("device", valid)).toThrow();
    },
  );

  test("every typed path builder rejects malformed roots", () => {
    for (const [name, builder] of Object.entries(paths)) {
      if (["admin", "tournamentCreation"].includes(name)) continue;
      expect(() => builder("legacy", "safe-event", "safe-event")).toThrow();
      expect(() => builder("aaaa/../../admin", "safe-event", "safe-event")).toThrow();
    }
    expect(() => paths.matchEvent("abcdefgh", "a/b")).toThrow();
    expect(() => paths.tournamentCreation("a/b")).toThrow();
  });

  test.each(Object.keys(ID_LENGTHS))(
    "%s collision retries and never touches the existing doc",
    async (type) => {
      const length = ID_LENGTHS[type];
      const oldId = "a".repeat(length);
      const db = new FakeFirestore({ [paths[type](oldId)]: { historical: true } });
      const source = jest.fn().mockReturnValueOnce(0);
      source.mockImplementation(() => (source.mock.calls.length <= length ? 0 : 1));
      const id = await db.runTransaction(async (tx) => {
        const candidate = await allocateId(tx, type, { db, randomInt: source });
        tx.create(db.doc(paths[type](candidate)), { created: true });
        return candidate;
      });
      expect(id).toBe("b".repeat(length));
      expect(source).toHaveBeenCalledTimes(length * 2);
      expect(db.get(paths[type](oldId))).toEqual({ historical: true });
    },
  );

  test.each(Object.keys(ID_LENGTHS))(
    "%s gives up after exactly five collisions with no writes",
    async (type) => {
      const id = "a".repeat(ID_LENGTHS[type]);
      const db = new FakeFirestore({ [paths[type](id)]: { historical: true } });
      const source = jest.fn(() => 0);
      await expect(
        db.runTransaction(async (tx) => {
          const allocated = await allocateId(tx, type, { db, randomInt: source });
          tx.create(db.doc(paths[type](allocated)), { overwritten: true });
        }),
      ).rejects.toMatchObject({ code: "ABORTED" });
      expect(source).toHaveBeenCalledTimes(ID_LENGTHS[type] * MAX_ID_ALLOCATION_ATTEMPTS);
      expect([...db.docs.entries()]).toEqual([[paths[type](id), { historical: true }]]);
    },
  );

  test("reserves candidates before awaits in parallel allocations on the same transaction", async () => {
    const db = new FakeFirestore();
    const candidates = [..."aaaaaaaaaaaaaaaabbbbbbbb"].map((char) => ID_ALPHABET.indexOf(char));
    const ids = await db.runTransaction(async (tx) => {
      const allocated = await Promise.all([
        allocateId(tx, "match", { db, randomInt: () => candidates.shift() }),
        allocateId(tx, "match", { db, randomInt: () => candidates.shift() }),
      ]);
      allocated.forEach((id, index) => tx.create(db.doc(paths.match(id)), { index }));
      return allocated;
    });
    expect(ids).toEqual(["aaaaaaaa", "bbbbbbbb"]);
    expect(db.list("matches")).toHaveLength(2);
  });

  test("an in-transaction reservation collision uses the same five-attempt bound", async () => {
    const db = new FakeFirestore();
    const source = jest.fn(() => 0);
    await expect(
      db.runTransaction(async (tx) => {
        await allocateId(tx, "match", { db, randomInt: source });
        await allocateId(tx, "match", { db, randomInt: source });
      }),
    ).rejects.toMatchObject({ code: "ABORTED" });
    expect(source).toHaveBeenCalledTimes(8 * (1 + MAX_ID_ALLOCATION_ATTEMPTS));
    expect(db.docs.size).toBe(0);
  });

  test("failed reads release their own reservation without losing another allocation", async () => {
    const db = new FakeFirestore();
    let rejectRead;
    const tx = {
      get: jest.fn((ref) =>
        ref.id === "aaaaaaaa" && tx.get.mock.calls.length === 1
          ? new Promise((_resolve, reject) => {
              rejectRead = reject;
            })
          : Promise.resolve(db.snapshot(ref.path)),
      ),
    };
    const pending = allocateId(tx, "match", { db, randomInt: () => 0 });
    const second = await allocateId(tx, "match", { db, randomInt: () => 1 });
    rejectRead(new Error("read failed"));
    await expect(pending).rejects.toThrow("read failed");
    expect(await allocateId(tx, "match", { db, randomInt: () => 0 })).toBe("aaaaaaaa");
    await expect(allocateId(tx, "match", { db, randomInt: () => 1 })).rejects.toMatchObject({
      code: "ABORTED",
    });
    expect(second).toBe("bbbbbbbb");
  });

  test.each(Object.keys(ID_LENGTHS))(
    "%s concurrent transaction conflict retries with a fresh ID",
    async (type) => {
      const db = new FakeFirestore();
      const length = ID_LENGTHS[type];
      let retries = 0;
      const create = (value) =>
        db.runTransaction(async (tx) => {
          const candidate = await allocateId(tx, type, {
            db,
            randomInt: () => (value === "second" && ++retries > length ? 1 : 0),
          });
          tx.create(db.doc(paths[type](candidate)), { value });
          return candidate;
        });
      const result = await Promise.all([create("first"), create("second")]);
      expect(result).toEqual(["a".repeat(length), "b".repeat(length)]);
      expect(db.transactionAttempts).toBe(3);
      expect(db.get(paths[type](result[0]))).toEqual({ value: "first" });
      expect(db.get(paths[type](result[1]))).toEqual({ value: "second" });
    },
  );

  test("create preconditions and callback errors roll back every queued write", async () => {
    const db = new FakeFirestore({ "matches/aaaaaaaa": { historical: true } });
    const before = [...db.docs.entries()];
    await expect(
      db.runTransaction(async (tx) => {
        tx.create(db.doc("matches/bbbbbbbb"), { new: true });
        tx.create(db.doc("matches/aaaaaaaa"), { overwritten: true });
      }),
    ).rejects.toMatchObject({ code: 6 });
    expect([...db.docs.entries()]).toEqual(before);
    await expect(
      db.runTransaction(async (tx) => {
        const id = await allocateId(tx, "match", { db, randomInt: () => 1 });
        tx.create(db.doc(paths.match(id)), { new: true });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect([...db.docs.entries()]).toEqual(before);
    expect(
      await db.runTransaction((tx) => allocateId(tx, "match", { db, randomInt: () => 1 })),
    ).toBe("bbbbbbbb");
  });

  test("allocation cannot run after the caller starts writing", async () => {
    const db = new FakeFirestore();
    await expect(
      db.runTransaction(async (tx) => {
        tx.create(db.doc("matches/bbbbbbbb"), {});
        await allocateId(tx, "match", { db, randomInt: () => 0 });
      }),
    ).rejects.toThrow("reads must happen before writes");
    expect(db.docs.size).toBe(0);
  });

  test("crypto supplies the canonical generator, with no alternate alphabet option", () => {
    const source = jest.spyOn(crypto, "randomInt").mockReturnValue(ID_ALPHABET.length - 1);
    expect(randomId(8)).toBe("zzzzzzzz");
    expect(source).toHaveBeenCalledTimes(8);
    source.mockRestore();
  });
});
