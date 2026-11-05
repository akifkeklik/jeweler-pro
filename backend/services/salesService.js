function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function createSalesService({ Sale, Product, Customer }) {
  async function createSale(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw httpError('Geçerli bir satış bilgisi gönderilmelidir', 400);
    }

    const customerId = Number(payload.customerId);
    const productId = Number(payload.productId);
    const quantity = Number(payload.quantity ?? 1);

    if (!Number.isSafeInteger(customerId) || customerId <= 0) {
      throw httpError('Geçerli bir müşteri seçilmelidir', 400);
    }
    if (!Number.isSafeInteger(productId) || productId <= 0) {
      throw httpError('Geçerli bir ürün seçilmelidir', 400);
    }
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      throw httpError('Satış miktarı pozitif bir tam sayı olmalıdır', 400);
    }

    const paymentMethod = payload.paymentMethod ?? 'nakit';
    if (!['nakit', 'kredi kartı', 'havale'].includes(paymentMethod)) {
      throw httpError('Geçersiz ödeme yöntemi', 400);
    }

    const customer = await Customer.findById(customerId);
    if (!customer) throw httpError('Müşteri bulunamadı', 404);

    // The conditional update makes stock deduction safe against concurrent sales.
    const product = await Product.findOneAndUpdate(
      { _id: productId, stock: { $gte: quantity } },
      { $inc: { stock: -quantity } },
      { new: true }
    );

    if (!product) {
      const exists = await Product.exists({ _id: productId });
      if (!exists) throw httpError('Ürün bulunamadı', 404);
      throw httpError('Yetersiz stok: satış tamamlanamadı', 409);
    }

    const unitPrice = Number(product.price);
    if (product.price === null || product.price === undefined || !Number.isFinite(unitPrice) || unitPrice < 0) {
      await Product.updateOne({ _id: productId }, { $inc: { stock: quantity } });
      throw httpError('Ürünün geçerli bir satış fiyatı tanımlı değil', 422);
    }

    const unitCost = Number.isFinite(Number(product.costPrice)) && product.costPrice !== null
      ? Number(product.costPrice)
      : null;

    try {
      const sale = new Sale({
        customerId,
        productId,
        quantity,
        totalPrice: Math.round(unitPrice * quantity * 100) / 100,
        unitPriceAtSale: unitPrice,
        unitCostAtSale: unitCost,
        paymentMethod,
        date: payload.date ? new Date(payload.date) : new Date(),
      });
      if (Number.isNaN(sale.date.getTime())) throw httpError('Geçersiz satış tarihi', 400);
      await sale.save();
      return sale;
    } catch (error) {
      await Product.updateOne({ _id: productId }, { $inc: { stock: quantity } });
      throw error;
    }
  }

  async function cancelSale(id) {
    const sale = await Sale.findById(id);
    if (!sale) throw httpError('Satış bulunamadı', 404);
    if (sale.status === 'cancelled') throw httpError('Bu satış daha önce iptal edilmiş', 409);

    const updated = await Sale.findOneAndUpdate(
      { _id: id, status: { $ne: 'cancelled' } },
      { $set: { status: 'cancelled', cancelledAt: new Date() } },
      { new: true }
    );
    if (!updated) throw httpError('Satış başka bir işlem tarafından iptal edildi', 409);

    try {
      const stockUpdate = await Product.updateOne({ _id: sale.productId }, { $inc: { stock: sale.quantity } });
      if (!stockUpdate.matchedCount) throw httpError('Ürün kaydı bulunamadığı için stok geri yüklenemedi', 409);
    } catch (error) {
      await Sale.updateOne(
        { _id: id, status: 'cancelled' },
        { $set: { status: 'completed' }, $unset: { cancelledAt: 1 } }
      );
      throw error;
    }

    return updated;
  }

  async function updateSale(id, payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw httpError('Geçerli bir güncelleme gönderilmelidir', 400);
    }
    const allowed = {};
    if (payload.paymentMethod !== undefined) {
      if (!['nakit', 'kredi kartı', 'havale'].includes(payload.paymentMethod)) {
        throw httpError('Geçersiz ödeme yöntemi', 400);
      }
      allowed.paymentMethod = payload.paymentMethod;
    }
    if (payload.date !== undefined) {
      const date = new Date(payload.date);
      if (Number.isNaN(date.getTime())) throw httpError('Geçersiz satış tarihi', 400);
      allowed.date = date;
    }
    if (!Object.keys(allowed).length) {
      throw httpError('Satışın ürün, miktar ve tutar bilgileri sonradan değiştirilemez', 400);
    }

    const sale = await Sale.findOneAndUpdate(
      { _id: id, status: { $ne: 'cancelled' } },
      { $set: allowed },
      { new: true, runValidators: true }
    );
    if (!sale) throw httpError('Aktif satış bulunamadı', 404);
    return sale;
  }

  return { createSale, cancelSale, updateSale };
}

module.exports = { createSalesService, httpError };
