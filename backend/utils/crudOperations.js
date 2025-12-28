/**
 * Utility functions for repeated CRUD operations
 */

/**
 * Generic GET all items
 */
async function getAll(Model) {
  return await Model.find();
}

/**
 * Generic GET by ID
 */
async function getById(Model, id) {
  const item = await Model.findById(id);
  if (!item) {
    const error = new Error(`${Model.modelName} bulunamadı`);
    error.statusCode = 404;
    throw error;
  }
  return item;
}

/**
 * Generic CREATE
 */
async function create(Model, data) {
  const item = new Model(data);
  return await item.save();
}

/**
 * Generic UPDATE
 */
async function update(Model, id, data) {
  const item = await Model.findByIdAndUpdate(id, data, { new: true, runValidators: true });
  if (!item) {
    const error = new Error(`${Model.modelName} bulunamadı`);
    error.statusCode = 404;
    throw error;
  }
  return item;
}

/**
 * Generic DELETE
 */
async function deleteItem(Model, id) {
  const item = await Model.findByIdAndDelete(id);
  if (!item) {
    const error = new Error(`${Model.modelName} bulunamadı`);
    error.statusCode = 404;
    throw error;
  }
  return item;
}

module.exports = {
  getAll,
  getById,
  create,
  update,
  deleteItem,
};
