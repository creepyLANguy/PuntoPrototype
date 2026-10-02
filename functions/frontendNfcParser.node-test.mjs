// Unit tests: the NFC tag format (app/js/nfc/parser.js). The format written to
// physical tags must keep parsing exactly as before.
import assert from "node:assert/strict";
import test from "node:test";

import { parseNfcTagText, readNfcRecordText } from "../app/js/nfc/parser.js";

const encode = (text) => new TextEncoder().encode(text);

test("key:value tags are parsed case-insensitively by key", () => {
  assert.deepEqual(parseNfcTagText(" event:spectate; CourtId: abcd ;deviceid:pulse-1 "), {
    rawText: "event:spectate; CourtId: abcd ;deviceid:pulse-1",
    fields: { EVENT: "spectate", COURTID: "abcd", DEVICEID: "pulse-1" },
    eventType: "SPECTATE",
    courtId: "abcd",
    deviceId: "pulse-1",
    ssid: "",
    password: "",
  });
});

test("every supported key alias is honoured", () => {
  const tag = parseNfcTagText("EVENT_TYPE:register;COURT_ID:c1;DEVICE_ID:d1;SSID:club;PASS:secret");
  assert.equal(tag.eventType, "REGISTER");
  assert.equal(tag.courtId, "c1");
  assert.equal(tag.deviceId, "d1");
  assert.equal(tag.ssid, "club");
  assert.equal(tag.password, "secret");

  assert.equal(parseNfcTagText("EVENTTYPE:undo").eventType, "UNDO");
  assert.equal(parseNfcTagText("EVENT:reset;PASSWORD:pw").password, "pw");
});

test("a bare tag is its own event type; values may contain colons", () => {
  assert.equal(parseNfcTagText("  point_team_a ").eventType, "POINT_TEAM_A");
  assert.equal(parseNfcTagText("EVENT:SPECTATE;COURTID:a:b").courtId, "a:b");
  assert.equal(parseNfcTagText("COURTID:abcd").eventType, "", "fields without an event key");
  assert.deepEqual(parseNfcTagText("EVENT:;COURTID:x").fields, { COURTID: "x" });
});

test("record text is decoded for text, URL and other record types", () => {
  assert.equal(
    readNfcRecordText({ recordType: "text", data: encode("  EVENT:UNDO ") }),
    "EVENT:UNDO",
  );
  assert.equal(
    readNfcRecordText({ recordType: "url", data: encode("\u0004padelpush.co.za/c/abcd") }),
    "padelpush.co.za/c/abcd",
  );
  assert.equal(readNfcRecordText({ recordType: "mime", data: encode("payload") }), "payload");
  assert.equal(readNfcRecordText({ recordType: "mime", data: encode("   ") }), "");
  assert.equal(readNfcRecordText({ recordType: "text" }), "");
  assert.equal(readNfcRecordText(null), "");
});
