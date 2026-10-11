// A read pins an allocation, not just a reusable short id. Only an explicit
// new context may forget that pin; a listener must never upgrade it.
import { assertId, ID_LENGTHS } from "../config/idContract.js";

const assignments = new Map();

function keyFor(type, id) {
  assertId(type, id);
  return `${type}:${id}`;
}

export function rememberAssignment(type, id, data) {
  const key = keyFor(type, id);
  const allocationId = data?.allocationId;
  const previous = assignments.get(key);
  if (previous) {
    if (allocationId !== previous.allocationId) previous.invalidated = true;
    return previous.allocationId;
  }
  if (typeof allocationId !== "string" || !allocationId) return null;
  assignments.set(key, { allocationId, invalidated: false });
  return allocationId;
}

export function getAllocationId(type, id) {
  return assignments.get(keyFor(type, id))?.allocationId || null;
}

export function assertCurrentAssignment(type, id, expectedAllocationId) {
  const assignment = assignments.get(keyFor(type, id));
  if (
    !assignment ||
    assignment.invalidated ||
    (expectedAllocationId !== undefined &&
      expectedAllocationId !== assignment.allocationId)
  ) {
    throw Object.assign(
      new Error(
        `The ${type} assignment changed. Reopen it before making changes.`,
      ),
      { code: "assignment-changed" },
    );
  }
  return assignment.allocationId;
}

export function clearAssignment(type, id) {
  if (type === undefined) {
    assignments.clear();
    return;
  }
  assignments.delete(keyFor(type, id));
}

export function rememberSnapshot(type, id, snapshot) {
  rememberAssignment(type, id, snapshot.exists() ? snapshot.data() : null);
  return snapshot;
}

export function rememberQuerySnapshot(type, snapshot) {
  snapshot.forEach((entry) => rememberSnapshot(type, entry.id, entry));
  return snapshot;
}

// Capture synchronously before any async work. Supplied pins belong to the
// caller's draft/session and cannot be replaced with a freshly observed token.
export function captureExpectedAllocations(data = {}, credentials = {}) {
  const expected = {};
  const types = Object.keys(ID_LENGTHS);
  const add = (type, id, token) => {
    expected[type] ||= {};
    expected[type][id] = assertCurrentAssignment(
      type,
      id,
      token === undefined ? expected[type][id] : token,
    );
  };
  const addMaps = (source) => {
    for (const type of types) {
      for (const [id, token] of Object.entries(source?.[type] || {}))
        add(type, id, token);
    }
  };
  addMaps(credentials.expectedAllocations);
  const visit = (node, topLevel = false) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((entry) => visit(entry));
      return;
    }
    addMaps(node.expectedAllocations);
    const scalarTypes = types.filter((type) => node[`${type}Id`] != null);
    for (const type of types) {
      for (const [id, token] of Object.entries(
        node[`${type}AllocationIds`] || {},
      )) {
        add(type, id, token);
      }
    }
    for (const [field, value] of Object.entries(node)) {
      if (
        ["credentials", "expectedAllocations"].includes(field) ||
        field.endsWith("AllocationIds")
      ) {
        continue;
      }
      const reference =
        /^(?:(?:source|target|current|last|active|new)(Court|Match|Club|Tournament)|(court|match|club|tournament))Id$/.exec(
          field,
        );
      const type = reference
        ? (reference[1] || reference[2]).toLowerCase()
        : null;
      if (type && value != null) {
        let token = node[`${field.slice(0, -2)}AllocationId`];
        if (
          token === undefined &&
          field === `${type}Id` &&
          (scalarTypes.length === 1 || type === "match")
        )
          token = node.allocationId;
        if (token === undefined && topLevel && field === `${type}Id`) {
          token = credentials[`${type}AllocationId`];
        }
        add(type, value, token);
      } else if (
        field === "resourceId" &&
        value != null &&
        types.includes(node.resourceType)
      ) {
        add(
          node.resourceType,
          value,
          node.resourceAllocationId ?? node.allocationId,
        );
      } else if (
        ["courtIds", "courtPool", "selectedCourtIds"].includes(field) &&
        Array.isArray(value)
      ) {
        value.forEach((id) => add("court", id, node.courtAllocationIds?.[id]));
      } else if (value && typeof value === "object") {
        visit(value);
      }
    }
  };
  visit(data, true);
  return expected;
}
