// NFC tag format. A tag carries `KEY:value` segments separated by `;`
// (for example `EVENT:SPECTATE;COURTID:abcd`), or a bare event type. Pure
// functions: no DOM, no state, independently testable.

export function readNfcRecordText(record)
{
  if (!record || !record.data) return "";

  const decoder = new TextDecoder(record.encoding || "utf-8");
  const text = decoder.decode(record.data).trim();

  if (record.recordType === "text") return text;

  if (record.recordType === "url" || record.recordType === "absolute-url")
  {
    return text.replace(/^[\u0000-\u001f]+/, "").trim();
  }

  // Fallback for other types (like MIME) if they contain readable text
  if (text.length > 0) return text;

  return "";
}

export function parseNfcTagText(text)
{
  const fields = {};
  const rawText = text.trim();

  for (const segment of rawText.split(";"))
  {
    const separatorIndex = segment.indexOf(":");
    if (separatorIndex === -1) continue;

    const key = segment.slice(0, separatorIndex).trim().toUpperCase();
    const value = segment.slice(separatorIndex + 1).trim();

    if (key && value) fields[key] = value;
  }

  const eventType = (
    fields.EVENT ||
    fields.EVENTTYPE ||
    fields.EVENT_TYPE ||
    (Object.keys(fields).length ? "" : rawText)
  ).trim().toUpperCase();

  const courtId = fields.COURTID || fields.COURT_ID || "";
  const deviceId = fields.DEVICEID || fields.DEVICE_ID || "";

  return {
    rawText,
    fields,
    eventType,
    courtId,
    deviceId,
    ssid: fields.SSID || "",
    password: fields.PASS || fields.PASSWORD || ""
  };
}
