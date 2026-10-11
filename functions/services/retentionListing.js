const { v1 } = require("@google-cloud/firestore");

const clients = new WeakMap();

function listingClient(db, listingClientOptions) {
  let client = clients.get(db);
  if (!client) {
    const options = { projectId: db.projectId, ...listingClientOptions };
    if (process.env.FIRESTORE_EMULATOR_HOST) {
      const endpoint = new URL(`http://${process.env.FIRESTORE_EMULATOR_HOST}`);
      options.servicePath = endpoint.hostname;
      options.port = Number(endpoint.port);
      options.sslCreds = require("google-gax").grpc.credentials.createInsecure();
    }
    client = new v1.FirestoreClient(options);
    clients.set(db, client);
  }
  return client;
}

function createDocumentListing(db, { listDocumentsPage, listingClientOptions = {} } = {}) {
  if (listDocumentsPage) return listDocumentsPage;
  if (typeof db.retentionListDocuments === "function") return db.retentionListDocuments.bind(db);
  return async ({ collectionPath, pageSize, pageToken = "" }) => {
    const client = listingClient(db, listingClientOptions);
    const segments = collectionPath.split("/");
    const collectionId = segments.pop();
    const prefix = `projects/${db.projectId}/databases/${db.databaseId}/documents`;
    const parent = segments.length ? `${prefix}/${segments.join("/")}` : prefix;
    // CollectionReference.listDocuments auto-paginates every child. This RPC
    // returns one name-only page, including missing ancestors, and its durable
    // server cursor survives deletion of previously visited documents.
    const [documents, , response] = await client.listDocuments(
      { parent, collectionId, pageSize, pageToken, showMissing: true, mask: { fieldPaths: [] } },
      { autoPaginate: false },
    );
    return {
      paths: documents.map((document) => {
        if (!document.name.startsWith(`${prefix}/`))
          throw new Error("Invalid retention listing path.");
        return document.name.slice(prefix.length + 1);
      }),
      nextPageToken: response.nextPageToken || "",
    };
  };
}

function createCollectionListing(db, { listCollectionIdsPage, listingClientOptions = {} } = {}) {
  if (listCollectionIdsPage) return listCollectionIdsPage;
  if (typeof db.retentionListCollectionIds === "function") {
    return db.retentionListCollectionIds.bind(db);
  }
  return async ({ documentPath, pageSize, pageToken = "" }) => {
    const client = listingClient(db, listingClientOptions);
    const parent = `projects/${db.projectId}/databases/${db.databaseId}/documents/${documentPath}`;
    const [ids, , response] = await client.listCollectionIds(
      { parent, pageSize, pageToken },
      { autoPaginate: false },
    );
    return { ids, nextPageToken: response.nextPageToken || "" };
  };
}

module.exports = { createDocumentListing, createCollectionListing };
