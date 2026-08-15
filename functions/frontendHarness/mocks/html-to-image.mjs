// Mock of https://esm.sh/html-to-image@1.11.13
export async function toBlob()
{
  return new Blob(["mock-image"], { type: "image/png" });
}
