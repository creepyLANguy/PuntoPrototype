const { Serializer } = require("@google-cloud/firestore/build/src/serializer");
const { Firestore } = require("@google-cloud/firestore");
const { Root } = require("protobufjs");
const { deflateRawSync, inflateRawSync } = require("zlib");

const MAX_DOCUMENT_BYTES = 1024 * 1024;
const CHUNK_BYTES = 256 * 1024;
const INLINE_BYTES = 768 * 1024;
const FORMAT = "firestore-document-protobuf-v1";
let documentType;

function documentCodec() {
  documentType ||= Root.fromJSON(
    require("@google-cloud/firestore/build/protos/v1.json"),
  ).lookupType("google.firestore.v1.Document");
  return documentType;
}

function isMap(value) {
  if (!value || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || Object.getPrototypeOf(proto) === null;
}

function valueBytes(value) {
  if (value == null) return 1;
  if (typeof value === "boolean") return 1;
  if (typeof value === "string") return Buffer.byteLength(value) + 1;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return value.byteLength;
  if (Array.isArray(value)) return value.reduce((sum, entry) => sum + valueBytes(entry), 0);
  if (!isMap(value)) {
    if (value?.firestore && typeof value.path === "string") {
      return (
        Buffer.byteLength(
          `projects/${value.firestore.projectId}/databases/${value.firestore.databaseId}/documents/${value.path}`,
        ) + 16
      );
    }
    if (typeof value?.toArray === "function") return value.toArray().length * 8 + 32;
    return typeof value === "object" ? 16 : 8;
  }
  return Object.entries(value).reduce(
    (sum, [key, entry]) => sum + Buffer.byteLength(key) + 1 + valueBytes(entry),
    32,
  );
}

function depthOf(value) {
  if (!Array.isArray(value) && !isMap(value)) return 0;
  return 1 + Object.values(value).reduce((depth, child) => Math.max(depth, depthOf(child)), 0);
}

function requiresProto(value, db) {
  if (
    !value ||
    typeof value !== "object" ||
    Buffer.isBuffer(value) ||
    value instanceof Uint8Array
  ) {
    return false;
  }
  if ("integerValue" in value && !Number.isSafeInteger(Number(value.integerValue))) return true;
  if (
    typeof value.referenceValue === "string" &&
    !value.referenceValue.startsWith(
      `projects/${db.projectId}/databases/${db.databaseId}/documents/`,
    )
  ) {
    return true;
  }
  return Object.values(value).some((child) => requiresProto(child, db));
}

function codec(db, useBigInt = false) {
  const serializer = new Serializer({ doc: db.doc.bind(db), _settings: { useBigInt } });
  const decode = serializer.decodeValue.bind(serializer);
  serializer.decodeValue = (value) => {
    if (!value.referenceValue) return decode(value);
    const match = /^projects\/([^/]+)\/databases\/([^/]+)\/documents\/(.+)$/.exec(
      value.referenceValue,
    );
    if (!match) throw new Error("Invalid archived Firestore reference.");
    const [, projectId, databaseId, path] = match;
    const referenceDb =
      projectId === db.projectId && databaseId === db.databaseId
        ? db
        : new Firestore({ projectId, databaseId });
    return referenceDb.doc(path);
  };
  return serializer;
}

// Default SDK decoding rounds unsafe int64s and drops a reference's database.
// Keep safe integers as Numbers so unrelated application data retains its shape.
function decodeSnapshot(snapshot, db) {
  if (typeof snapshot.toDocumentProto !== "function") return snapshot.data();
  const decoder = codec(db);
  const decode = decoder.decodeValue.bind(decoder);
  decoder.decodeValue = (value) => {
    if (value.integerValue !== undefined && value.integerValue !== null) {
      const integer = BigInt(value.integerValue.toString());
      return Number.isSafeInteger(Number(integer)) ? Number(integer) : integer;
    }
    return decode(value);
  };
  return Object.fromEntries(
    Object.entries(snapshot.toDocumentProto().fields).map(([key, value]) => [
      key,
      decoder.decodeValue(value),
    ]),
  );
}

// Isolate the SDK's protobuf codec here: it preserves nanoseconds, bytes,
// reference resource names, vectors and 64-bit integers rather than JSON data.
function encodeSnapshot(snapshot, db) {
  const document =
    typeof snapshot.toDocumentProto === "function"
      ? snapshot.toDocumentProto()
      : { fields: codec(db).encodeFields(snapshot.data()) };
  const type = documentCodec();
  return Buffer.from(type.encode(type.fromObject(document)).finish());
}

function writeBytes(data, db) {
  const type = documentCodec();
  return (
    type.encode(type.fromObject({ fields: codec(db).encodeFields(data) })).finish().length + 8192
  );
}

function snapshotBytes(snapshot, db) {
  return encodeSnapshot(snapshot, db).length + 8192;
}

// Small records retain the original archive schema. A source at Firestore's
// size/depth limit must not be nested under data/before; only its binary
// protobuf payload is split, with exact source path and times on the manifest.
function planArchive(snapshot, db, metadata, field = "data") {
  const data = snapshot.data();
  const inline = { ...metadata, [field]: data };
  const encoded = encodeSnapshot(snapshot, db);
  const sourceBytes = encoded.length + 8192;
  const preserveProto =
    typeof snapshot.toDocumentProto === "function" &&
    requiresProto(snapshot.toDocumentProto().fields, db);
  if (
    !preserveProto &&
    sourceBytes <= INLINE_BYTES &&
    depthOf(data) < 20 &&
    valueBytes(inline) <= INLINE_BYTES
  ) {
    const bytes = writeBytes(inline, db);
    if (bytes <= INLINE_BYTES)
      return { writes: [{ suffix: "", data: inline }], bytes, sourceBytes };
  }
  const compressed = deflateRawSync(encoded);
  const payload = compressed.length < encoded.length ? compressed : encoded;
  const chunkCount = Math.ceil(payload.length / CHUNK_BYTES);
  const manifest = {
    ...metadata,
    format: FORMAT,
    payloadField: field,
    chunkCount,
    payloadBytes: payload.length,
    payloadCompression: payload === compressed ? "deflate-raw" : "none",
  };
  const writes = [{ suffix: "", data: manifest }];
  for (let index = 0; index < chunkCount; index++) {
    writes.push({
      suffix: `/payload/${String(index).padStart(6, "0")}`,
      data: { bytes: payload.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES) },
    });
  }
  return {
    writes,
    sourceBytes,
    bytes: writes.reduce((sum, write) => sum + writeBytes(write.data, db), 0),
  };
}

function writeArchive(tx, db, path, plan) {
  plan.writes.forEach((write) => tx.set(db.doc(`${path}${write.suffix}`), write.data));
}

// Recovery: pass the archive document reference, not the live source reference.
// The result is {path, data, metadata}; useBigInt retains all int64 precision.
async function readArchive(db, ref, { useBigInt = true } = {}) {
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new Error(`Missing retention archive ${ref.path}.`);
  const metadata = snapshot.data();
  if (!metadata.format) {
    return { path: metadata.path, data: metadata.data ?? metadata.before, metadata };
  }
  if (metadata.format !== FORMAT) throw new Error(`Unknown retention archive ${metadata.format}.`);
  if (
    metadata.payloadCompression &&
    !["none", "deflate-raw"].includes(metadata.payloadCompression)
  ) {
    throw new Error("Unknown retention archive compression.");
  }
  const refs = Array.from({ length: metadata.chunkCount }, (_, index) =>
    db.doc(`${ref.path}/payload/${String(index).padStart(6, "0")}`),
  );
  const chunks = await db.getAll(...refs);
  if (chunks.some((chunk) => !chunk.exists))
    throw new Error("Incomplete retention archive payload.");
  const payload = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk.data().bytes)));
  if (payload.length !== metadata.payloadBytes)
    throw new Error("Invalid retention archive payload.");
  const type = documentCodec();
  const encoded =
    metadata.payloadCompression === "deflate-raw"
      ? inflateRawSync(payload, { maxOutputLength: 8 * MAX_DOCUMENT_BYTES })
      : payload;
  const document = type.toObject(type.decode(encoded), { longs: String, bytes: Buffer });
  const decoder = codec(db, useBigInt);
  const data = Object.fromEntries(
    Object.entries(document.fields).map(([key, value]) => [key, decoder.decodeValue(value)]),
  );
  return { path: metadata.path, data, metadata, document };
}

module.exports = {
  MAX_DOCUMENT_BYTES,
  CHUNK_BYTES,
  valueBytes,
  writeBytes,
  snapshotBytes,
  decodeSnapshot,
  planArchive,
  writeArchive,
  readArchive,
};
