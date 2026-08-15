// Mock of https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js
import { callableHandlers } from "../mockFirestoreState.mjs";

export function getFunctions(app, region)
{
  return { app, region, type: "mock-functions" };
}

export function httpsCallable(functionsInstance, name)
{
  return async (payload) =>
  {
    const handler = callableHandlers.get(name);
    if (!handler)
    {
      throw new Error(`No mock handler registered for callable '${name}'`);
    }
    return handler(payload);
  };
}
