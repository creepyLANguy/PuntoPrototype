// Mock of https://esm.sh/html-to-image@1.11.13

// Every call is recorded so tests can inspect the node and options the app
// hands to the real library, which is otherwise invisible from the DOM.
export const toBlobCalls = [];

export function resetToBlobCalls()
{
  toBlobCalls.length = 0;
}

export async function toBlob(node, options)
{
  toBlobCalls.push({ node, options });
  return new Blob(["mock-image"], { type: "image/png" });
}
