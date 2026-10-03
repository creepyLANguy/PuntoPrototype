// The "Club" cell shared by the admin court and device lists.

// Shows the club name (or a dash when there is none). The cell is marked
// .is-empty so compact layouts can hide it.
export function fillAdminClubCell(cell, club)
{
  if (!cell) return;
  const value = cell.querySelector(".aci-value");
  cell.classList.toggle("is-empty", !club);
  value.textContent = club ? club.name : "—";
  value.title = club ? `${club.name} (${club.id.toUpperCase()})` : "";
}
