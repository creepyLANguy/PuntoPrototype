// Loads every club and builds the club index. Club data only adds context to
// court and device lists, so a failed load is logged and yields an empty
// index rather than breaking the list it decorates.
import { buildClubIndex, clubFromData, EMPTY_CLUB_INDEX } from "./clubIndex.js";
import { getAllClubs } from "../firebase/clubRepository.js";

export async function loadClubIndex()
{
  try
  {
    const snapshot = await getAllClubs();
    return buildClubIndex(snapshot.docs.map((clubDoc) => clubFromData(clubDoc.id, clubDoc.data())));
  }
  catch (error)
  {
    console.warn("Could not load clubs:", error);
    return EMPTY_CLUB_INDEX;
  }
}
