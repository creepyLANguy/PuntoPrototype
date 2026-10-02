// Admin configuration: admin/goodies holds the skeleton (admin) key.
import { doc, getDoc } from "./firestore.js";
import { db } from "./client.js";

export async function getSkeleton()
{
  const adminref = doc(db, "admin", "goodies");
  const adminSnap = await getDoc(adminref);
  const data = adminSnap.data();
  if (!data || !data.skeletonKey) {
    throw new Error("Admin document missing or skeletonKey not found");
  }
  return data.skeletonKey;
}
