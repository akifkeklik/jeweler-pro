/**
 * Shared CRUD helpers with writable-field filtering and soft-delete support.
 * Financial and customer history must remain referentially intact.
 *
 * `scope` (optional) is a mandatory filter merged into every query — routes
 * pass { businessId } so a tenant can never read or modify another
 * tenant's documents (an out-of-scope id behaves exactly like a missing one).
 * New documents get the scope's fields assigned server-side.
 */
const PROTECTED_FIELDS = new Set([
  "_id", "id", "__v", "createdAt", "updatedAt",
  "role", "active", "tokenVersion", "passwordHash",
  // Tenancy is assigned by the server, never by the client.
  "businessId",
  // Projections of the ledger / inventory engine — only the financial services write them.
  "balanceTry", "balanceGold", "balanceTryMinor", "balanceGoldMg",
  "costPoolMinor",
  // Transfer reservations / branch-copy links — written only by the transfer service.
  "reservedStock", "transferOriginId",
]);

function hasArchive(Model) {
  return Boolean(Model.schema.path("isArchived"));
}

function writableData(Model, data, { extraProtected = [] } = {}) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    const error = new Error("İstek gövdesi bir JSON nesnesi olmalıdır");
    error.statusCode = 400;
    error.code = "INVALID_BODY";
    throw error;
  }
  const blocked = new Set(extraProtected);

  return Object.fromEntries(
    Object.entries(data).filter(([key]) =>
      !PROTECTED_FIELDS.has(key) &&
      !blocked.has(key) &&
      key !== "isArchived" &&
      !key.startsWith("$") &&
      !key.includes(".") &&
      Boolean(Model.schema.path(key))
    )
  );
}

function notFoundError(Model) {
  const error = new Error(`${Model.modelName} bulunamadı`);
  error.statusCode = 404;
  error.code = "NOT_FOUND";
  return error;
}

async function getAll(Model, scope = {}) {
  return Model.find(hasArchive(Model) ? { ...scope, isArchived: { $ne: true } } : { ...scope });
}

async function getById(Model, id, scope = {}) {
  const scoped = Object.keys(scope).length > 0;
  let item;
  if (hasArchive(Model)) item = await Model.findOne({ _id: id, ...scope, isArchived: { $ne: true } });
  else item = scoped ? await Model.findOne({ _id: id, ...scope }) : await Model.findById(id);
  if (!item) throw notFoundError(Model);
  return item;
}

async function create(Model, data, scope = {}, options = {}) {
  const item = new Model({ ...writableData(Model, data, options), ...scope });
  return item.save();
}

async function update(Model, id, data, scope = {}, options = {}) {
  const safeData = writableData(Model, data, options);
  if (Object.keys(safeData).length === 0) {
    const error = new Error("Güncellenecek geçerli alan bulunamadı");
    error.statusCode = 400;
    error.code = "NO_UPDATABLE_FIELDS";
    throw error;
  }

  const queryOptions = { new: true, runValidators: true, context: "query" };
  const scoped = Object.keys(scope).length > 0;
  let item;
  if (hasArchive(Model)) {
    item = await Model.findOneAndUpdate({ _id: id, ...scope, isArchived: { $ne: true } }, { $set: safeData }, queryOptions);
  } else if (scoped) {
    item = await Model.findOneAndUpdate({ _id: id, ...scope }, { $set: safeData }, queryOptions);
  } else {
    item = await Model.findByIdAndUpdate(id, { $set: safeData }, queryOptions);
  }

  if (!item) throw notFoundError(Model);
  return item;
}

async function deleteItem(Model, id, scope = {}) {
  const scoped = Object.keys(scope).length > 0;
  let item;
  if (hasArchive(Model)) {
    item = await Model.findOneAndUpdate(
      { _id: id, ...scope, isArchived: { $ne: true } },
      { $set: { isArchived: true } },
      { new: true }
    );
  } else if (scoped) {
    item = await Model.findOneAndDelete({ _id: id, ...scope });
  } else {
    item = await Model.findByIdAndDelete(id);
  }

  if (!item) throw notFoundError(Model);
  return item;
}

module.exports = { getAll, getById, create, update, deleteItem, writableData, PROTECTED_FIELDS };
